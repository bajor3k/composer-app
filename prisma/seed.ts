import "dotenv/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, UserRole, CustodialPlatform, AccountType } from "../src/generated/prisma";
// @ts-ignore
import cuid from "cuid";

// Use session mode pooler (port 6543) for long-running seed operations
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}
const dbUrl = process.env.DATABASE_URL.includes(":6543/")
  ? process.env.DATABASE_URL
  : process.env.DATABASE_URL.replace(":5432/", ":6543/");

function createPrismaClient() {
  const p = new Pool({
    connectionString: dbUrl,
    max: 1,
    idleTimeoutMillis: 0,
    connectionTimeoutMillis: 30000,
    keepAlive: true,
  });
  const a = new PrismaPg(p);
  return { prisma: new PrismaClient({ adapter: a }), pool: p };
}

let { prisma, pool } = createPrismaClient();

async function reconnect() {
  try { await prisma.$disconnect(); } catch { }
  try { await pool.end(); } catch { }
  await new Promise(r => setTimeout(r, 1000));
  const fresh = createPrismaClient();
  prisma = fresh.prisma;
  pool = fresh.pool;
  console.log("  (reconnected)");
}

function createDirectPool() {
  return new Pool({
    connectionString: dbUrl,
    max: 1,
    idleTimeoutMillis: 0,
    connectionTimeoutMillis: 30000,
    keepAlive: true,
  });
}

// ============================================================================
// CONFIGURATION — Exact counts
// ============================================================================

const CONFIG = {
  firmCount: 1,                   // 1 advisory firm (Granite Falls Wealth)
  advisorsPerFirm: 5,            // 5 advisors = 5 total
  clientAssociatesPerFirm: 5,    // 5 client associates (no rep codes)
  householdsPerAdvisor: 12,      // 60 households total (12 × 5)
  accountsPerHousehold: 5,       // 300 accounts total (60/advisor)
  holdingsPerAccount: 10,        // 12,000 total
  transactionsPerAccount: 25,    // 30,000 total
  operationsStaffCount: 25,
  portfoliosPerAdvisor: 3,
};
const TOTAL_ADVISORS = CONFIG.firmCount * CONFIG.advisorsPerFirm;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number, decimals: number = 2): number {
  return Number((Math.random() * (max - min) + min).toFixed(decimals));
}

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomElements<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

const usedAccountNumbers = new Set<string>();
function generateAccountNumber(isManaged: boolean, custodian: CustodialPlatform): string {
  // Each custodian has its own realistic number format. Managed/non-managed is NOT encoded in the
  // number (that lives on the is_managed column) — only Pershing keeps the legacy ABC/XYZ prefix.
  let num: string;
  do {
    if (custodian === CustodialPlatform.SCHWAB) {
      // Schwab brokerage accounts: 8 digits formatted 1234-5678
      const digits = String(randomInt(10000000, 99999999));
      num = `${digits.slice(0, 4)}-${digits.slice(4)}`;
    } else if (custodian === CustodialPlatform.FIDELITY) {
      // Fidelity: two digits starting with 7, a dash, then six digits — e.g. 77-123456.
      // The dash sits at index 2, where Schwab's sits at index 4, so the two formats
      // cannot collide. Kept in step with supabase/migrations/0006_fidelity_account_format.sql,
      // which converted the existing book from the old Z######## form.
      num = `7${randomInt(0, 9)}-${String(randomInt(100000, 999999))}`;
    } else {
      // Pershing: ABC (managed) / XYZ (non-managed) + 6 digits
      num = isManaged
        ? `ABC${String(randomInt(100000, 999999))}`
        : `XYZ${String(randomInt(100000, 999999))}`;
    }
  } while (usedAccountNumbers.has(num));
  usedAccountNumbers.add(num);
  return num;
}

// Custodians to seed. Each gets its own clients + households + accounts under the same advisors,
// so a firm realistically custodies across multiple platforms.
const SEED_CUSTODIANS: CustodialPlatform[] = [
  CustodialPlatform.PERSHING,
  CustodialPlatform.SCHWAB,
  CustodialPlatform.FIDELITY,
];

// Cash-sweep money-market fund per custodian (kept in sync with SECURITIES.cash and the
// holdings_enriched day-change whitelist). Managed accounts hold their custodian's own sweep.
const SWEEP_FUND: Record<string, { symbol: string; name: string }> = {
  PERSHING: { symbol: "VMFXX", name: "Vanguard Federal Money Market" },
  SCHWAB: { symbol: "SWVXX", name: "Schwab Value Advantage Money Fund" },
  FIDELITY: { symbol: "SPAXX", name: "Fidelity Government Money Market" },
};

// Custodian display name (matches the portfolio_accounts view CASE mapping).
const CUSTODIAN_NAME: Record<string, string> = {
  PERSHING: "Pershing",
  SCHWAB: "Schwab",
  FIDELITY: "Fidelity",
};

// Unique household last name across the entire platform — all custodians draw from one shared,
// shuffled pool so we never get a "Smith Household" at two different custodians. Lazily initialized
// so it can reference LAST_NAMES (defined later in the file).
let _shuffledHouseholdLastNames: string[] | null = null;
let _householdLastNameCursor = 0;
function nextHouseholdLastName(): string {
  if (!_shuffledHouseholdLastNames) {
    _shuffledHouseholdLastNames = [...LAST_NAMES].sort(() => Math.random() - 0.5);
  }
  if (_householdLastNameCursor >= _shuffledHouseholdLastNames.length) {
    throw new Error(
      `Ran out of unique household last names (have ${_shuffledHouseholdLastNames.length}). ` +
      `Reduce custodians/households or expand LAST_NAMES.`
    );
  }
  return _shuffledHouseholdLastNames[_householdLastNameCursor++];
}

function generatePhoneNumber(): string {
  return `(${randomInt(200, 999)}) ${randomInt(200, 999)}-${randomInt(1000, 9999)}`;
}

function generateSSN(): string {
  return `${randomInt(100, 999)}-${randomInt(10, 99)}-${randomInt(1000, 9999)}`;
}

function randomDate(startYear: number, endYear: number): Date {
  const start = new Date(startYear, 0, 1);
  const end = new Date(endYear, 11, 31);
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

// ============================================================================
// DATA CONSTANTS
// ============================================================================

const FIRST_NAMES = [
  "James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael", "Linda",
  "David", "Elizabeth", "William", "Barbara", "Richard", "Susan", "Joseph", "Jessica",
  "Thomas", "Sarah", "Christopher", "Karen", "Charles", "Lisa", "Daniel", "Nancy",
  "Matthew", "Betty", "Anthony", "Margaret", "Mark", "Sandra", "Donald", "Ashley",
  "Steven", "Kimberly", "Paul", "Emily", "Andrew", "Donna", "Joshua", "Michelle",
  "Kenneth", "Dorothy", "Kevin", "Carol", "Brian", "Amanda", "George", "Melissa",
  "Timothy", "Deborah", "Ronald", "Stephanie", "Edward", "Rebecca", "Jason", "Sharon",
  "Jeffrey", "Laura", "Ryan", "Cynthia", "Jacob", "Kathleen", "Gary", "Amy",
  "Nicholas", "Angela", "Eric", "Shirley", "Jonathan", "Anna", "Stephen", "Brenda",
  "Larry", "Pamela", "Justin", "Emma", "Scott", "Nicole", "Brandon", "Helen",
];

const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
  "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson",
  "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson",
  "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Walker",
  "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores",
  "Green", "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell",
  "Carter", "Roberts", "Chen", "Kim", "Patel", "Shah", "Cohen", "Goldberg",
  "Silverman", "Rosenberg", "O'Brien", "Murphy", "Sullivan", "McCarthy", "Walsh",
  "Hoffman", "Brennan", "Crawford", "Fitzgerald", "Grant", "Hayes", "Jennings",
  "Keller", "Lambert", "Marsh", "Norris", "Owens", "Palmer", "Quinn", "Reed",
  "Schneider", "Tucker", "Underwood", "Vaughn", "Warren", "Yates", "Zimmerman",
  "Abbott", "Barrett", "Chandler", "Donovan", "Ellis", "Foster", "Gibson", "Harper",
  "Ingram", "Jacobs", "Knox", "Lawson", "Mercer", "Nash", "Ortiz", "Pierce",
  "Ramsey", "Shelton", "Tanner", "Vance", "Webb", "York", "Blake", "Carpenter",
  "Dawson", "Emerson", "Fleming", "Garrison", "Hawkins", "Irving", "Jordan",
  "Kemp", "Larson", "Maxwell", "Newton", "Osborne", "Preston", "Reeves", "Stafford",
  "Thornton", "Valencia", "Whitaker", "Aldridge", "Blackwell", "Callahan", "Drake",
  "Everett", "Finch", "Graves", "Holden", "Keating", "Livingston", "Monroe",
  "Nolan", "Oakes", "Pennington", "Rollins", "Sinclair", "Townsend", "Upton",
  "Weston", "Ashford", "Benson", "Colton", "Dalton", "Easton", "Farrell",
  "Gentry", "Hayward", "Ives", "Jarvis", "Kendall", "Langley", "Maddox",
  "Noble", "Odell", "Paxton", "Ridley", "Stanton", "Truitt", "Wainwright",
  "Archer", "Baldwin", "Cantrell", "Dunn", "Ellison", "Frost", "Goodwin",
  "Harding", "Irwin", "Jensen", "Kirkland", "Lowe", "Moran", "Norwood",
  "Pace", "Rao", "Sutton", "Trejo", "Vega", "Walters", "Yoder", "Zuniga",
  "Acosta", "Braun", "Cline", "Dorsey", "Eaton", "Fulton", "Greer",
  "Hensley", "Ibarra", "Juarez", "Klein", "Lester", "McBride", "Navarro",
  "Odom", "Padilla", "Raines", "Sexton", "Trujillo", "Underhill", "Villanueva",
  "Woodard", "Xiong", "Yeager", "Zamora", "Adkins", "Bloom", "Conway",
  "Delaney", "Egan", "Foley", "Gibbons", "Harmon", "Ivory", "Jacobsen",
  "Kline", "Lund", "Meyers", "Newcomb", "Orozco", "Pruitt", "Rankin",
  "Sharpe", "Talbot", "Urbina", "Vargas", "Whitfield", "Yarbrough", "Ziegler",
  "Alcorn", "Bowen", "Crosby", "Devlin", "Engel", "Faulkner",
];

const STREETS = [
  "Main St", "Oak Ave", "Maple Dr", "Cedar Ln", "Pine St", "Elm Rd", "Park Ave",
  "Lake Dr", "River Rd", "Hill St", "Valley Way", "Forest Ln", "Meadow Dr",
  "Spring St", "Summit Ave", "Garden Way", "Sunset Blvd", "Ocean Dr", "Beach Rd",
];

const CITIES = [
  "New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "Philadelphia",
  "San Antonio", "San Diego", "Dallas", "San Jose", "Austin", "Jacksonville",
  "Fort Worth", "Columbus", "San Francisco", "Charlotte", "Indianapolis", "Seattle",
  "Denver", "Boston", "Nashville", "Baltimore", "Oklahoma City", "Louisville",
  "Portland", "Las Vegas", "Milwaukee", "Albuquerque", "Tucson", "Fresno",
];

const STATES = [
  "NY", "CA", "TX", "FL", "IL", "PA", "OH", "GA", "NC", "MI", "NJ", "VA", "WA",
  "AZ", "MA", "TN", "IN", "MO", "MD", "WI", "CO", "MN", "SC", "AL", "LA",
];

const TEAMS = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"];

const FIRM_NAMES = [
  "Granite Falls Wealth",
];

// Each advisor has their own rep code
const FIRM_REP_CODES: Record<string, string[]> = {
  "Granite Falls Wealth": ["GF1", "GF2", "GF3", "GF4", "GF5"],
};

const RISK_TOLERANCES = ["conservative", "moderate", "aggressive", "moderately_aggressive"];
const INVESTMENT_OBJECTIVES = ["growth", "income", "balanced", "preservation", "speculation"];
const EMPLOYMENT_STATUSES = ["employed", "self_employed", "retired", "unemployed", "homemaker"];
const SUFFIXES = [null, null, null, null, null, null, null, null, "Jr.", "Sr.", "II", "III"];
const CITIZENSHIPS = ["US", "US", "US", "US", "US", "US", "US", "US", "CA", "GB", "DE", "MX"];
const ID_TYPES = ["drivers_license", "drivers_license", "drivers_license", "passport", "state_id"];
const SOURCE_OF_FUNDS = ["employment", "employment", "employment", "inheritance", "investment", "gift", "other"];
const TIME_HORIZONS = ["less_than_1_year", "1_3_years", "3_5_years", "5_10_years", "over_10_years"];
const LIQUIDITY_NEEDS = ["very_important", "somewhat_important", "not_important"];
const INVESTMENT_EXPERIENCES = ["none", "limited", "moderate", "extensive"];
const ONBOARDING_STATUSES = ["active", "active", "active", "active", "active", "in_progress", "prospect"];
const TRUSTED_RELATIONSHIPS = ["spouse", "parent", "child", "sibling", "friend", "attorney"];
const OCCUPATIONS = [
  "Software Engineer", "Attorney", "Physician", "Dentist", "Accountant", "Financial Analyst",
  "Business Owner", "Real Estate Agent", "Teacher", "Professor", "Nurse", "Pharmacist",
  "Marketing Director", "Sales Manager", "Consultant", "Architect", "Civil Engineer",
  "Project Manager", "VP of Operations", "Chief Financial Officer",
];
const EMPLOYERS = [
  "Google", "Microsoft", "Amazon", "Apple", "JPMorgan Chase", "Goldman Sachs",
  "Deloitte", "McKinsey", "Mayo Clinic", "Johns Hopkins", "Self-Employed",
  "Baker McKenzie", "KPMG", "EY", "PwC", "Lockheed Martin", "Boeing",
  "Tesla", "Merck", "Pfizer",
];


// ============================================================================
// SECURITIES DATA
// ============================================================================

const SECURITIES = {
  equity: [
    { symbol: "AAPL", name: "Apple Inc.", price: 178.50, sector: "Technology", yield: 0.0055 },
    { symbol: "MSFT", name: "Microsoft Corp.", price: 378.25, sector: "Technology", yield: 0.0075 },
    { symbol: "GOOGL", name: "Alphabet Inc.", price: 141.80, sector: "Technology", yield: 0 },
    { symbol: "AMZN", name: "Amazon.com Inc.", price: 178.90, sector: "Consumer Discretionary", yield: 0 },
    { symbol: "NVDA", name: "NVIDIA Corp.", price: 495.50, sector: "Technology", yield: 0.0003 },
    { symbol: "META", name: "Meta Platforms Inc.", price: 505.75, sector: "Technology", yield: 0.0035 },
    { symbol: "TSLA", name: "Tesla Inc.", price: 248.50, sector: "Consumer Discretionary", yield: 0 },
    { symbol: "BRK.B", name: "Berkshire Hathaway", price: 363.20, sector: "Financials", yield: 0 },
    { symbol: "JPM", name: "JPMorgan Chase", price: 198.40, sector: "Financials", yield: 0.0250 },
    { symbol: "JNJ", name: "Johnson & Johnson", price: 156.80, sector: "Healthcare", yield: 0.0300 },
    { symbol: "V", name: "Visa Inc.", price: 281.50, sector: "Financials", yield: 0.0076 },
    { symbol: "PG", name: "Procter & Gamble", price: 160.25, sector: "Consumer Staples", yield: 0.0240 },
    { symbol: "UNH", name: "UnitedHealth Group", price: 528.90, sector: "Healthcare", yield: 0.0150 },
    { symbol: "HD", name: "Home Depot", price: 345.60, sector: "Consumer Discretionary", yield: 0.0250 },
    { symbol: "MA", name: "Mastercard Inc.", price: 456.80, sector: "Financials", yield: 0.0055 },
    { symbol: "DIS", name: "Walt Disney Co.", price: 112.40, sector: "Communication Services", yield: 0.0070 },
    { symbol: "ADBE", name: "Adobe Inc.", price: 578.90, sector: "Technology", yield: 0 },
    { symbol: "CRM", name: "Salesforce Inc.", price: 278.50, sector: "Technology", yield: 0.0055 },
    { symbol: "NFLX", name: "Netflix Inc.", price: 485.20, sector: "Communication Services", yield: 0 },
    { symbol: "KO", name: "Coca-Cola Co.", price: 60.45, sector: "Consumer Staples", yield: 0.0310 },
    { symbol: "PEP", name: "PepsiCo Inc.", price: 172.80, sector: "Consumer Staples", yield: 0.0275 },
    { symbol: "MRK", name: "Merck & Co.", price: 105.60, sector: "Healthcare", yield: 0.0240 },
    { symbol: "ABBV", name: "AbbVie Inc.", price: 178.90, sector: "Healthcare", yield: 0.0360 },
    { symbol: "CVX", name: "Chevron Corp.", price: 158.40, sector: "Energy", yield: 0.0420 },
    { symbol: "XOM", name: "Exxon Mobil", price: 112.30, sector: "Energy", yield: 0.0350 },
  ],
  fixed_income: [
    { symbol: "BND", name: "Vanguard Total Bond Market ETF", price: 72.50, expenseRatio: 0.0003, yield: 0.0450 },
    { symbol: "AGG", name: "iShares Core US Aggregate Bond", price: 98.20, expenseRatio: 0.0003, yield: 0.0440 },
    { symbol: "VCIT", name: "Vanguard Intermediate-Term Corp Bond", price: 82.40, expenseRatio: 0.0004, yield: 0.0510 },
    { symbol: "LQD", name: "iShares Investment Grade Corp Bond", price: 108.60, expenseRatio: 0.0014, yield: 0.0500 },
    { symbol: "TLT", name: "iShares 20+ Year Treasury Bond", price: 92.80, expenseRatio: 0.0015, yield: 0.0430 },
    { symbol: "VCSH", name: "Vanguard Short-Term Corp Bond", price: 77.90, expenseRatio: 0.0004, yield: 0.0480 },
    { symbol: "MUB", name: "iShares National Muni Bond", price: 107.50, expenseRatio: 0.0005, yield: 0.0340 },
    { symbol: "HYG", name: "iShares High Yield Corporate Bond", price: 76.40, expenseRatio: 0.0049, yield: 0.0650 },
    { symbol: "TIPS", name: "iShares TIPS Bond ETF", price: 110.20, expenseRatio: 0.0019, yield: 0.0490 },
    { symbol: "SHY", name: "iShares 1-3 Year Treasury Bond", price: 81.60, expenseRatio: 0.0015, yield: 0.0480 },
  ],
  alternative: [
    { symbol: "VNQ", name: "Vanguard Real Estate ETF", price: 86.50, expenseRatio: 0.0012, yield: 0.0380 },
    { symbol: "GLD", name: "SPDR Gold Shares", price: 188.40, expenseRatio: 0.004, yield: 0 },
    { symbol: "DBC", name: "Invesco DB Commodity Index", price: 23.80, expenseRatio: 0.0085, yield: 0 },
    { symbol: "PDBC", name: "Invesco Optimum Yield Diversified", price: 14.20, expenseRatio: 0.0059, yield: 0 },
    { symbol: "IYR", name: "iShares US Real Estate ETF", price: 89.60, expenseRatio: 0.0039, yield: 0.0260 },
  ],
  cash: [
    { symbol: "VMFXX", name: "Vanguard Federal Money Market", price: 1.00, yield: 0.0525 },
    { symbol: "SPAXX", name: "Fidelity Government Money Market", price: 1.00, yield: 0.0498 },
    { symbol: "SWVXX", name: "Schwab Value Advantage Money Fund", price: 1.00, yield: 0.0515 },
  ],
};

// ----------------------------------------------------------------------------
// MUTUAL FUNDS
// Real fund share classes (8 families, sourced from SEC 485BPOS prospectus data —
// see src/lib/share-class/data/real.ts). Both the expensive classes clients tend to
// hold (A/C/Investor) and their cheaper siblings (I/R6/F) are present so share-class
// review has real convertible pairs to work with.
//
// assetClass is the strategy the fund HOLDS, not the wrapper: an equity fund is
// `equity`, an income/bond fund is `fixed_income`, real-estate / global-allocation is
// `alternative`. That keeps allocation charts correct and means no new asset-class
// value (and therefore no chart/schema/view changes) is needed.
//
// expenseRatio is a fraction to match the existing convention (BND = 0.0003 = 0.03%);
// the prospectus CSV expresses percent, so it is divided by 100 here.
// ----------------------------------------------------------------------------
const MUTUAL_FUNDS = [
  { symbol: "TWRCX", name: "American Century Growth Fund C Class", price: 38.2, expenseRatio: 0.0183, yield: 0.011, assetClass: "equity" as const },
  { symbol: "AGRDX", name: "American Century Growth Fund R6 Class", price: 51.1, expenseRatio: 0.0048, yield: 0.011, assetClass: "equity" as const },
  { symbol: "TWCGX", name: "American Century Growth Fund Investor Class", price: 41.85, expenseRatio: 0.0083, yield: 0.011, assetClass: "equity" as const },
  { symbol: "TWHIX", name: "American Century Heritage Fund Investor Class", price: 28.6, expenseRatio: 0.01, yield: 0.011, assetClass: "equity" as const },
  { symbol: "ATHDX", name: "American Century Heritage Fund R6 Class", price: 29.15, expenseRatio: 0.0065, yield: 0.011, assetClass: "equity" as const },
  { symbol: "GFACX", name: "American Funds The Growth Fund of America Class C", price: 71.25, expenseRatio: 0.0135, yield: 0.011, assetClass: "equity" as const },
  { symbol: "AGTHX", name: "American Funds The Growth Fund of America Class A", price: 74.2, expenseRatio: 0.0059, yield: 0.011, assetClass: "equity" as const },
  { symbol: "RGAGX", name: "American Funds The Growth Fund of America Class R-6", price: 79.35, expenseRatio: 0.0029, yield: 0.011, assetClass: "equity" as const },
  { symbol: "ABALX", name: "American Balanced Fund Class A", price: 33.1, expenseRatio: 0.0055, yield: 0.011, assetClass: "equity" as const },
  { symbol: "AFMBX", name: "American Balanced Fund Class F-3", price: 33.45, expenseRatio: 0.0025, yield: 0.011, assetClass: "equity" as const },
  { symbol: "LBSAX", name: "Columbia Dividend Income Fund Class A", price: 32.15, expenseRatio: null, yield: 0.011, assetClass: "equity" as const },
  { symbol: "GSFTX", name: "Columbia Dividend Income Fund Class Inst", price: 31.9, expenseRatio: null, yield: 0.011, assetClass: "equity" as const },
  { symbol: "CREAX", name: "Columbia Real Estate Equity Fund Class A", price: 24.8, expenseRatio: 0.0119, yield: 0.028, assetClass: "alternative" as const },
  { symbol: "CREYX", name: "Columbia Real Estate Equity Fund Class Inst3", price: 25.3, expenseRatio: 0.0079, yield: 0.028, assetClass: "alternative" as const },
  { symbol: "FKDNX", name: "Franklin DynaTech Fund Class A", price: 158.9, expenseRatio: 0.0077, yield: 0.011, assetClass: "equity" as const },
  { symbol: "FDTRX", name: "Franklin DynaTech Fund Class R6", price: 45.6, expenseRatio: 0.0044, yield: 0.011, assetClass: "equity" as const },
  { symbol: "FKIQX", name: "Franklin Income Fund Class A", price: 2.42, expenseRatio: 0.0071, yield: 0.042, assetClass: "fixed_income" as const },
  { symbol: "FKINX", name: "Franklin Income Fund Class A1", price: 2.35, expenseRatio: 0.0061, yield: 0.042, assetClass: "fixed_income" as const },
  { symbol: "FKGRX", name: "Franklin Growth Fund Class A", price: 138.4, expenseRatio: 0.0078, yield: 0.011, assetClass: "equity" as const },
  { symbol: "GAOAX", name: "JPMorgan Global Allocation Fund Class A", price: 18.75, expenseRatio: 0.0103, yield: 0.028, assetClass: "alternative" as const },
  { symbol: "GAOZX", name: "JPMorgan Global Allocation Fund Class R6", price: 18.9, expenseRatio: 0.0065, yield: 0.028, assetClass: "alternative" as const },
  { symbol: "JNBAX", name: "JPMorgan Income Builder Fund Class A", price: 9.05, expenseRatio: 0.0075, yield: 0.042, assetClass: "fixed_income" as const },
  { symbol: "JNBZX", name: "JPMorgan Income Builder Fund Class R6", price: 9.1, expenseRatio: 0.0052, yield: 0.042, assetClass: "fixed_income" as const },
  { symbol: "LAFFX", name: "Lord Abbett Affiliated Fund Class A", price: 16.84, expenseRatio: 0.0069, yield: 0.011, assetClass: "equity" as const },
  { symbol: "LAFVX", name: "Lord Abbett Affiliated Fund Class R6", price: 19.85, expenseRatio: 0.0039, yield: 0.011, assetClass: "equity" as const },
  { symbol: "MFEGX", name: "MFS Growth Fund Class A", price: 132.4, expenseRatio: 0.0086, yield: 0.011, assetClass: "equity" as const },
  { symbol: "MFEKX", name: "MFS Growth Fund Class R6", price: 145.55, expenseRatio: 0.0052, yield: 0.011, assetClass: "equity" as const },
  { symbol: "MFEIX", name: "MFS Growth Fund Class I", price: 172.3, expenseRatio: 0.0061, yield: 0.011, assetClass: "equity" as const },
  { symbol: "TRBCX", name: "T. Rowe Price Blue Chip Growth Fund Investor Class", price: 158.3, expenseRatio: 0.007, yield: 0.011, assetClass: "equity" as const },
  { symbol: "TBCIX", name: "T. Rowe Price Blue Chip Growth Fund I Class", price: 168.9, expenseRatio: 0.0057, yield: 0.011, assetClass: "equity" as const },
];

// Fund placement is deliberate (see injectMutualFunds), so funds are kept out of the
// non-managed accounts' random draw pool.
const MUTUAL_FUND_SYMBOLS = new Set(MUTUAL_FUNDS.map(f => f.symbol));

const ALL_SECURITIES = [
  ...SECURITIES.equity.map(s => ({ ...s, assetClass: "equity" as const })),
  ...SECURITIES.fixed_income.map(s => ({ ...s, assetClass: "fixed_income" as const })),
  ...SECURITIES.alternative.map(s => ({ ...s, assetClass: "alternative" as const })),
  ...SECURITIES.cash.map(s => ({ ...s, assetClass: "cash" as const })),
  ...MUTUAL_FUNDS,
];

// ============================================================================
// MODEL PORTFOLIO TEMPLATES
// ============================================================================

const MODEL_TEMPLATES = [
  {
    name: "Growth 80/20",
    description: "80% equity, 20% fixed income for long-term growth",
    riskLevel: "aggressive",
    allocations: [
      { symbol: "VTI", name: "Vanguard Total Stock Market", targetPct: 50, assetClass: "equity" },
      { symbol: "VXUS", name: "Vanguard Total Intl Stock", targetPct: 20, assetClass: "equity" },
      { symbol: "VNQ", name: "Vanguard Real Estate", targetPct: 10, assetClass: "alternative" },
      { symbol: "BND", name: "Vanguard Total Bond Market", targetPct: 15, assetClass: "fixed_income" },
      { symbol: "VMFXX", name: "Vanguard Money Market", targetPct: 5, assetClass: "cash" },
    ],
  },
  {
    name: "Balanced 60/40",
    description: "Classic balanced portfolio for moderate risk tolerance",
    riskLevel: "moderate",
    allocations: [
      { symbol: "VTI", name: "Vanguard Total Stock Market", targetPct: 40, assetClass: "equity" },
      { symbol: "VXUS", name: "Vanguard Total Intl Stock", targetPct: 15, assetClass: "equity" },
      { symbol: "VNQ", name: "Vanguard Real Estate", targetPct: 5, assetClass: "alternative" },
      { symbol: "BND", name: "Vanguard Total Bond Market", targetPct: 30, assetClass: "fixed_income" },
      { symbol: "VCSH", name: "Vanguard Short-Term Corp Bond", targetPct: 5, assetClass: "fixed_income" },
      { symbol: "VMFXX", name: "Vanguard Money Market", targetPct: 5, assetClass: "cash" },
    ],
  },
  {
    name: "Conservative 40/60",
    description: "40% equity, 60% bonds for capital preservation with some growth",
    riskLevel: "conservative",
    allocations: [
      { symbol: "VTI", name: "Vanguard Total Stock Market", targetPct: 25, assetClass: "equity" },
      { symbol: "VXUS", name: "Vanguard Total Intl Stock", targetPct: 10, assetClass: "equity" },
      { symbol: "VNQ", name: "Vanguard Real Estate", targetPct: 5, assetClass: "alternative" },
      { symbol: "BND", name: "Vanguard Total Bond Market", targetPct: 35, assetClass: "fixed_income" },
      { symbol: "VCSH", name: "Vanguard Short-Term Corp Bond", targetPct: 15, assetClass: "fixed_income" },
      { symbol: "VMFXX", name: "Vanguard Money Market", targetPct: 10, assetClass: "cash" },
    ],
  },
  {
    name: "Income Focus",
    description: "Dividend and income-oriented portfolio",
    riskLevel: "moderate",
    allocations: [
      { symbol: "VYM", name: "Vanguard High Dividend Yield", targetPct: 25, assetClass: "equity" },
      { symbol: "SCHD", name: "Schwab US Dividend Equity", targetPct: 15, assetClass: "equity" },
      { symbol: "VNQ", name: "Vanguard Real Estate", targetPct: 10, assetClass: "alternative" },
      { symbol: "BND", name: "Vanguard Total Bond Market", targetPct: 25, assetClass: "fixed_income" },
      { symbol: "VCIT", name: "Vanguard Intermediate Corp Bond", targetPct: 15, assetClass: "fixed_income" },
      { symbol: "VMFXX", name: "Vanguard Money Market", targetPct: 10, assetClass: "cash" },
    ],
  },
  {
    name: "All Equity Growth",
    description: "100% equity portfolio for maximum long-term growth",
    riskLevel: "aggressive",
    allocations: [
      { symbol: "VTI", name: "Vanguard Total Stock Market", targetPct: 50, assetClass: "equity" },
      { symbol: "VXUS", name: "Vanguard Total Intl Stock", targetPct: 25, assetClass: "equity" },
      { symbol: "VGT", name: "Vanguard Information Technology", targetPct: 15, assetClass: "equity" },
      { symbol: "VNQ", name: "Vanguard Real Estate", targetPct: 10, assetClass: "alternative" },
    ],
  },
  {
    name: "ESG Sustainable",
    description: "Socially responsible investing with ESG focus",
    riskLevel: "moderate",
    allocations: [
      { symbol: "ESGU", name: "iShares ESG Aware MSCI USA", targetPct: 40, assetClass: "equity" },
      { symbol: "ESGD", name: "iShares ESG Aware MSCI EAFE", targetPct: 15, assetClass: "equity" },
      { symbol: "EAGG", name: "iShares ESG Aware US Aggregate Bond", targetPct: 30, assetClass: "fixed_income" },
      { symbol: "ICLN", name: "iShares Global Clean Energy", targetPct: 10, assetClass: "equity" },
      { symbol: "VMFXX", name: "Vanguard Money Market", targetPct: 5, assetClass: "cash" },
    ],
  },
];

// ============================================================================
// SEEDING FUNCTIONS
// ============================================================================

async function clearDatabase() {
  console.log("Clearing existing data...");
  // Tickets are a Supabase-only table whose creatorId references User via RESTRICT,
  // so they must be removed before users are deleted below. DELETE cascades to
  // TicketMessage / TicketActivity. (Without this, a reseed throws on user deletion.)
  await prisma.$executeRawUnsafe('DELETE FROM "Ticket"');
  await prisma.transaction.deleteMany();
  await prisma.accountPerformance.deleteMany();
  await prisma.holding.deleteMany();
  await prisma.allocation.deleteMany();
  await prisma.account.deleteMany();
  await prisma.portfolio.deleteMany();
  await prisma.client.deleteMany();
  await prisma.household.deleteMany();
  await prisma.advisor.deleteMany();
  await prisma.user.deleteMany();
  await prisma.security.deleteMany();
  console.log("Database cleared.");
}

async function seedSecurities() {
  console.log("Seeding securities...");
  const securities = ALL_SECURITIES.map(sec => ({
    symbol: sec.symbol,
    name: sec.name,
    assetClass: sec.assetClass,
    sector: (sec as any).sector || null,
    price: sec.price,
    // Seeded equal to price, so day change reads a truthful 0 rather than
    // leaving the column NULL. A NULL previousClose makes holdings_enriched
    // and portfolio_accounts short-circuit their day_change CASE expressions,
    // which silently zeroed the day change on every page book-wide.
    // `npm run db:update-prices` replaces both with real market values.
    previousClose: sec.price,
    priceDate: new Date(),
    expenseRatio: (sec as any).expenseRatio || null,
    dividendYield: (sec as any).yield || null,
  }));

  const additionalSecurities = [
    { symbol: "VTI", name: "Vanguard Total Stock Market ETF", assetClass: "equity", price: 248.50, yield: 0.0135 },
    { symbol: "VXUS", name: "Vanguard Total International Stock ETF", assetClass: "equity", price: 58.90, yield: 0.0310 },
    { symbol: "VYM", name: "Vanguard High Dividend Yield ETF", assetClass: "equity", price: 118.40, yield: 0.0310 },
    { symbol: "SCHD", name: "Schwab US Dividend Equity ETF", assetClass: "equity", price: 78.60, yield: 0.0360 },
    { symbol: "VGT", name: "Vanguard Information Technology ETF", assetClass: "equity", price: 498.20, yield: 0.0070 },
    { symbol: "ESGU", name: "iShares ESG Aware MSCI USA ETF", assetClass: "equity", price: 108.50, yield: 0.0140 },
    { symbol: "ESGD", name: "iShares ESG Aware MSCI EAFE ETF", assetClass: "equity", price: 72.30, yield: 0.0280 },
    { symbol: "EAGG", name: "iShares ESG Aware US Aggregate Bond ETF", assetClass: "fixed_income", price: 48.60, yield: 0.0390 },
    { symbol: "ICLN", name: "iShares Global Clean Energy ETF", assetClass: "equity", price: 14.80, yield: 0.0050 },
  ];

  const allSecs = [
    ...securities,
    ...additionalSecurities.map(({ yield: y, ...s }) => ({ ...s, previousClose: s.price, priceDate: new Date(), sector: null, expenseRatio: null, dividendYield: y || null })),
  ];

  for (const sec of allSecs) {
    await prisma.security.upsert({
      where: { symbol: sec.symbol },
      update: sec,
      create: sec,
    });
  }

  console.log(`  ${allSecs.length} securities created.`);
  console.log("  Prices are placeholders — run `npm run db:update-prices` for real market data.");
}

async function seedOperationsStaff(): Promise<string[]> {
  console.log("Seeding operations staff...");
  const userIds: string[] = [];
  const teams = ["Advisor Services", "Compliance", "Direct Business", "Asset Movement", "Managed Accounts", "Principal Review"];

  for (let i = 0; i < CONFIG.operationsStaffCount; i++) {
    const firstName = randomElement(FIRST_NAMES);
    const lastName = randomElement(LAST_NAMES);
    const user = await prisma.user.create({
      data: {
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${randomInt(100, 999)}@example.com`,
        name: `${firstName} ${lastName}`,
        role: UserRole.OPERATIONS,
      },
    });
    userIds.push(user.id);
  }

  console.log(`  ${userIds.length} operations staff created.`);
  return userIds;
}

async function seedAdvisors(): Promise<{ advisorIds: string[], advisorUserIds: string[], allEmployeeUserIds: string[] }> {
  console.log("Seeding advisors (5 per firm) + client associates (5 per firm)...");
  const advisorIds: string[] = [];
  const advisorUserIds: string[] = [];
  const allEmployeeUserIds: string[] = [];

  let globalIdx = 0;
  for (let firmIdx = 0; firmIdx < CONFIG.firmCount; firmIdx++) {
    const firmName = FIRM_NAMES[firmIdx];
    const repCodes = FIRM_REP_CODES[firmName] || [`R${firmIdx}A`, `R${firmIdx}B`, `R${firmIdx}C`, `R${firmIdx}D`, `R${firmIdx}E`];

    for (let slot = 0; slot < CONFIG.advisorsPerFirm; slot++) {
      const firstName = randomElement(FIRST_NAMES);
      const lastName = randomElement(LAST_NAMES);
      const seniority = slot === 0 ? "lead" : slot < 3 ? "senior" : "junior";
      const team = TEAMS[globalIdx % TEAMS.length];

      const user = await prisma.user.create({
        data: {
          email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${randomInt(100, 999)}@example.com`,
          name: `${firstName} ${lastName}`,
          role: UserRole.ADVISOR,
          advisor: {
            create: {
              firmName,
              repCode: repCodes[slot],
              phone: generatePhoneNumber(),
              team,
              seniorityLevel: seniority,
            },
          },
        },
        include: { advisor: true },
      });

      advisorIds.push(user.advisor!.id);
      advisorUserIds.push(user.id);
      allEmployeeUserIds.push(user.id);
      globalIdx++;
    }

    // Add client associates (no rep code, no accounts)
    for (let ca = 0; ca < CONFIG.clientAssociatesPerFirm; ca++) {
      const caFirst = randomElement(FIRST_NAMES);
      const caLast = randomElement(LAST_NAMES);
      const caUser = await prisma.user.create({
        data: {
          email: `${caFirst.toLowerCase()}.${caLast.toLowerCase()}.${randomInt(100, 999)}@example.com`,
          name: `${caFirst} ${caLast}`,
          role: UserRole.ADVISOR,
          advisor: {
            create: {
              firmName,
              phone: generatePhoneNumber(),
              team: TEAMS[(globalIdx + ca) % TEAMS.length],
              seniorityLevel: "associate",
            },
          },
        },
      });
      allEmployeeUserIds.push(caUser.id);
    }
  }

  console.log(`  ${advisorIds.length} advisors + ${CONFIG.clientAssociatesPerFirm} client associates created.`);
  return { advisorIds, advisorUserIds, allEmployeeUserIds };
}

async function seedPortfolios(advisorIds: string[]): Promise<string[]> {
  console.log("Seeding model portfolios...");
  const portfolioIds: string[] = [];

  for (const advisorId of advisorIds) {
    const templates = randomElements(MODEL_TEMPLATES, CONFIG.portfoliosPerAdvisor);
    for (const template of templates) {
      const portfolio = await prisma.portfolio.create({
        data: {
          advisorId,
          name: template.name,
          description: template.description,
          riskLevel: template.riskLevel,
          benchmarkSymbol: "SPY",
          allocations: {
            create: template.allocations.map(alloc => ({
              symbol: alloc.symbol,
              name: alloc.name,
              assetClass: alloc.assetClass,
              targetPct: alloc.targetPct,
              toleranceBand: 2.0,
            })),
          },
        },
      });
      portfolioIds.push(portfolio.id);
    }
  }

  console.log(`  ${portfolioIds.length} model portfolios created.`);
  return portfolioIds;
}

// 8 households per advisor, 5 accounts per household = 40 accounts per advisor
async function seedAccountsPerAdvisor(advisorIds: string[], portfolioIds: string[], custodian: CustodialPlatform): Promise<string[]> {
  console.log(`Seeding ${CUSTODIAN_NAME[custodian]} households, clients & accounts (${CONFIG.householdsPerAdvisor} households × 5 accounts per advisor, 4 managed + 1 non-managed each)...`);
  const allAccountIds: string[] = [];

  const accountTypes: AccountType[] = [
    AccountType.INDIVIDUAL,
    AccountType.JOINT,
    AccountType.IRA,
    AccountType.ROTH_IRA,
    AccountType.TRUST,
  ];

  // Get advisor-specific portfolios
  const advisorPortfolios = await prisma.portfolio.findMany({ select: { id: true, advisorId: true } });
  const portfoliosByAdvisor = new Map<string, string[]>();
  for (const p of advisorPortfolios) {
    const list = portfoliosByAdvisor.get(p.advisorId) || [];
    list.push(p.id);
    portfoliosByAdvisor.set(p.advisorId, list);
  }

  // Household last names come from a shared platform-wide pool (nextHouseholdLastName) so names stay
  // unique across every custodian, not just within this call.
  for (let aIdx = 0; aIdx < advisorIds.length; aIdx++) {
    const advisorId = advisorIds[aIdx];
    const myPortfolios = portfoliosByAdvisor.get(advisorId) || portfolioIds.slice(0, 3);
    console.log(`  Advisor ${aIdx + 1}/${advisorIds.length}: ${CONFIG.householdsPerAdvisor} households × 5 accounts...`);
    for (let hIdx = 0; hIdx < CONFIG.householdsPerAdvisor; hIdx++) {
      // Each household gets a unique last name — no duplicates across the entire platform
      const householdLastName = nextHouseholdLastName();
      const householdName = `${householdLastName} Household`;
      const city = randomElement(CITIES);
      const state = randomElement(STATES);
      const street = `${randomInt(100, 9999)} ${randomElement(STREETS)}`;
      const zipCode = String(randomInt(10000, 99999));

      const household = await prisma.household.create({
        data: { name: householdName, advisorId },
      });

      // Create 2 clients (married couple) per household, then 5 accounts
      const lastName = householdLastName;
      const firstName1 = randomElement(FIRST_NAMES);
      let firstName2: string;
      do {
        firstName2 = randomElement(FIRST_NAMES);
      } while (firstName2 === firstName1);

      const age1 = randomInt(28, 85);
      const age2 = age1 + randomInt(-5, 5);
      const dob1 = new Date();
      dob1.setFullYear(dob1.getFullYear() - age1);
      const dob2 = new Date();
      dob2.setFullYear(dob2.getFullYear() - age2);
      const sharedRiskTolerance = randomElement(RISK_TOLERANCES);
      const sharedObjective = randomElement(INVESTMENT_OBJECTIVES);

      // Shared household data
      const empStatus1 = age1 > 62 ? "retired" : randomElement(EMPLOYMENT_STATUSES);
      const empStatus2 = age2 > 62 ? "retired" : randomElement(EMPLOYMENT_STATUSES);
      const occupation1 = empStatus1 === "retired" ? null : randomElement(OCCUPATIONS);
      const occupation2 = empStatus2 === "retired" ? null : randomElement(OCCUPATIONS);
      const employer1 = empStatus1 === "retired" || empStatus1 === "unemployed" || empStatus1 === "homemaker" ? null : randomElement(EMPLOYERS);
      const employer2 = empStatus2 === "retired" || empStatus2 === "unemployed" || empStatus2 === "homemaker" ? null : randomElement(EMPLOYERS);
      const income1 = randomInt(50000, 500000);
      const income2 = randomInt(50000, 500000);
      const netWorth1 = randomInt(100000, 10000000);
      const netWorth2 = randomInt(100000, 10000000);
      const mailingStreet = `${randomInt(100, 9999)} ${randomElement(STREETS)}`;
      const mailingCity = randomElement(CITIES);
      const mailingState = randomElement(STATES);
      const mailingZip = String(randomInt(10000, 99999));
      const sharedTimeHorizon = randomElement(TIME_HORIZONS);
      const sharedExperience = randomElement(INVESTMENT_EXPERIENCES);
      const sharedLiquidity = randomElement(LIQUIDITY_NEEDS);
      const idState1 = randomElement(STATES);
      const idState2 = randomElement(STATES);
      const idExpDate = new Date();
      idExpDate.setFullYear(idExpDate.getFullYear() + randomInt(1, 8));

      const spouse1 = await prisma.client.create({
        data: {
          advisorId,
          householdId: household.id,
          firstName: firstName1,
          middleName: Math.random() > 0.5 ? randomElement(FIRST_NAMES) : null,
          lastName,
          suffix: randomElement(SUFFIXES),
          email: `${firstName1.toLowerCase()}.${lastName.toLowerCase()}${randomInt(1, 9999)}@email.com`,
          phone: generatePhoneNumber(),
          secondaryPhone: Math.random() > 0.7 ? generatePhoneNumber() : null,
          dateOfBirth: dob1,
          ssn: generateSSN(),
          citizenshipCountry: randomElement(CITIZENSHIPS),
          address: street,
          city,
          state,
          zipCode,
          mailingAddress: mailingStreet,
          mailingCity,
          mailingState,
          mailingZipCode: mailingZip,
          idType: randomElement(ID_TYPES),
          idNumber: `${randomElement(STATES)}${randomInt(100000, 999999)}`,
          idIssuingState: idState1,
          idExpirationDate: idExpDate,
          riskTolerance: sharedRiskTolerance,
          investmentObjective: sharedObjective,
          employmentStatus: empStatus1,
          occupation: occupation1,
          employer: employer1,
          isAssociatedPerson: Math.random() > 0.95,
          annualIncome: income1,
          netWorth: netWorth1,
          liquidNetWorth: Math.round(netWorth1 * randomFloat(0.3, 0.7, 2)),
          sourceOfFunds: randomElement(SOURCE_OF_FUNDS),
          timeHorizon: sharedTimeHorizon,
          liquidityNeeds: sharedLiquidity,
          investmentExperience: sharedExperience,
          trustedContactName: `${randomElement(FIRST_NAMES)} ${randomElement(LAST_NAMES)}`,
          trustedContactPhone: generatePhoneNumber(),
          trustedContactRelationship: randomElement(TRUSTED_RELATIONSHIPS),
          onboardingStatus: randomElement(ONBOARDING_STATUSES),
          notes: Math.random() > 0.7 ? `Client since ${randomInt(2010, 2024)}. ${randomElement(["Prefers email communication.", "High-touch client.", "Quarterly review preferred.", "Referred by existing client.", "Interested in ESG investing."])}` : null,
        },
      });

      const spouse2 = await prisma.client.create({
        data: {
          advisorId,
          householdId: household.id,
          firstName: firstName2,
          middleName: Math.random() > 0.5 ? randomElement(FIRST_NAMES) : null,
          lastName,
          suffix: null,
          email: `${firstName2.toLowerCase()}.${lastName.toLowerCase()}${randomInt(1, 9999)}@email.com`,
          phone: generatePhoneNumber(),
          secondaryPhone: Math.random() > 0.7 ? generatePhoneNumber() : null,
          dateOfBirth: dob2,
          ssn: generateSSN(),
          citizenshipCountry: randomElement(CITIZENSHIPS),
          address: street,
          city,
          state,
          zipCode,
          mailingAddress: mailingStreet,
          mailingCity,
          mailingState,
          mailingZipCode: mailingZip,
          idType: randomElement(ID_TYPES),
          idNumber: `${randomElement(STATES)}${randomInt(100000, 999999)}`,
          idIssuingState: idState2,
          idExpirationDate: idExpDate,
          riskTolerance: sharedRiskTolerance,
          investmentObjective: sharedObjective,
          employmentStatus: empStatus2,
          occupation: occupation2,
          employer: employer2,
          isAssociatedPerson: false,
          annualIncome: income2,
          netWorth: netWorth2,
          liquidNetWorth: Math.round(netWorth2 * randomFloat(0.3, 0.7, 2)),
          sourceOfFunds: randomElement(SOURCE_OF_FUNDS),
          timeHorizon: sharedTimeHorizon,
          liquidityNeeds: sharedLiquidity,
          investmentExperience: sharedExperience,
          trustedContactName: `${firstName1} ${lastName}`,
          trustedContactPhone: generatePhoneNumber(),
          trustedContactRelationship: "spouse",
          onboardingStatus: randomElement(ONBOARDING_STATUSES),
          notes: null,
        },
      });

      // Map each account type to the appropriate spouse and registration name
      const accountConfigs: { type: AccountType; clientId: string; accountName: string }[] = [
        { type: AccountType.INDIVIDUAL, clientId: spouse1.id, accountName: `${firstName1} ${lastName} INDIVIDUAL` },
        { type: AccountType.JOINT, clientId: spouse1.id, accountName: `${firstName1} & ${firstName2} ${lastName} JOINT` },
        { type: AccountType.IRA, clientId: spouse2.id, accountName: `${firstName2} ${lastName} IRA` },
        { type: AccountType.ROTH_IRA, clientId: spouse1.id, accountName: `${firstName1} ${lastName} ROTH IRA` },
        { type: AccountType.TRUST, clientId: spouse1.id, accountName: `${firstName1} & ${firstName2} ${lastName} TRUST` },
      ];

      for (let acctIdx = 0; acctIdx < accountConfigs.length; acctIdx++) {
        const config = accountConfigs[acctIdx];
        // Per-household: first 4 accounts = ABC (managed), last 1 = XYZ (non-managed)
        const isManaged = acctIdx < 4;
        const accountNumber = generateAccountNumber(isManaged, custodian);
        const balance = randomFloat(50000, 2000000, 2);
        const cashBalance = randomFloat(balance * 0.01, balance * 0.1, 2);
        const modelPortfolioId = isManaged ? randomElement(myPortfolios) : null;

        const account = await prisma.account.create({
          data: {
            accountNumber,
            accountName: config.accountName,
            custodialPlatform: custodian,
            clientId: config.clientId,
            advisorId,
            householdId: household.id,
            accountType: config.type,
            isManaged,
            balance,
            cashBalance,
            status: "active",
            openDate: randomDate(2015, 2024),
            feeSchedule: isManaged ? "tiered" : "flat",
            feeRate: isManaged
              ? balance >= 1500000
                ? randomFloat(0.005, 0.007, 4)   // $1.5M+ → 0.50–0.70%
                : balance >= 1000000
                  ? randomFloat(0.006, 0.008, 4)   // $1M–$1.5M → 0.60–0.80%
                  : balance >= 500000
                    ? randomFloat(0.008, 0.010, 4)   // $500K–$1M → 0.80–1.00%
                    : balance >= 250000
                      ? randomFloat(0.010, 0.012, 4)   // $250K–$500K → 1.00–1.20%
                      : randomFloat(0.012, 0.015, 4)   // Under $250K → 1.20–1.50%
              : 0,
            billingFrequency: randomElement(["monthly", "quarterly"]),
            modelPortfolioId,
          },
        });
        allAccountIds.push(account.id);
      }
    }

    // Reconnect every 5 advisors to avoid connection drops
    if ((aIdx + 1) % 5 === 0 && aIdx < advisorIds.length - 1) {
      await reconnect();
    }
  }

  console.log(`  ${allAccountIds.length} accounts created.`);
  return allAccountIds;
}

// Deterministic 32-bit string hash (FNV-1a) — stable, evenly spread fund placement.
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Convert a slice of selected accounts' positions into mutual fund positions.
 *
 * Funds REPLACE an existing position of the SAME asset class rather than being added on
 * top: market value, cost basis, and purchase date are preserved, so every account's
 * holdings still sum to its balance and the asset allocation is unchanged — only the
 * instrument (symbol/name/NAV/share count) differs. That keeps the book internally
 * consistent and means no allocation chart, view, or schema change is needed.
 *
 * Selection hashes the account id, which spreads funds evenly across all custodians,
 * registration types, and managed/non-managed accounts. Swapping a model sleeve for a
 * same-asset-class fund is safe: drift/tolerance logic only inspects cash allocations.
 *
 * Runs before the holdings insert, so seedTransactions() — which reads holdings back
 * from the DB — emits a matching buy for every fund position automatically.
 */
function injectMutualFunds(holdingRows: any[][]): number {
  const SHARE_OF_ACCOUNTS = 40; // % of accounts that end up holding at least one fund
  const MIN_POSITION = 5000;    // skip trivial positions

  // Row layout: [id, accountId, symbol, name, assetClass, quantity, costBasis, price, marketValue, purchaseDate]
  const byAccount = new Map<string, number[]>();
  holdingRows.forEach((row, i) => {
    const list = byAccount.get(row[1]);
    if (list) list.push(i);
    else byAccount.set(row[1], [i]);
  });

  let converted = 0;
  for (const [accountId, rowIdxs] of byAccount) {
    const h = hashString(accountId);
    if (h % 100 >= SHARE_OF_ACCOUNTS) continue;
    const wanted = 1 + ((h >>> 8) % 2); // 1–2 fund positions per selected account

    const candidates = rowIdxs.filter((i) => {
      const r = holdingRows[i];
      return r[4] !== "cash" && r[2] !== "CASH" && Number(r[8]) >= MIN_POSITION;
    });
    if (!candidates.length) continue;

    const usedFunds = new Set<string>();
    const usedRows = new Set<number>();
    for (let n = 0; n < wanted; n++) {
      // Pick an as-yet-unconverted position.
      let rowIdx = -1;
      for (let attempt = 0; attempt < candidates.length; attempt++) {
        const c = candidates[((h >>> (4 * (n + 1))) + attempt) % candidates.length];
        if (!usedRows.has(c)) { rowIdx = c; break; }
      }
      if (rowIdx < 0) break;
      usedRows.add(rowIdx);

      const row = holdingRows[rowIdx];
      // Match the fund to the position's asset class so allocation is untouched.
      const pool = MUTUAL_FUNDS.filter(
        (f) => f.assetClass === row[4] && !usedFunds.has(f.symbol),
      );
      if (!pool.length) continue;
      const fund = pool[(h >>> (3 * (n + 1))) % pool.length];
      usedFunds.add(fund.symbol);

      const marketValue = Number(row[8]);
      row[2] = fund.symbol;
      row[3] = fund.name;
      row[7] = fund.price;               // NAV
      row[5] = marketValue / fund.price; // shares — market value preserved
      converted++;
    }
  }
  return converted;
}

async function seedHoldings(accountIds: string[]) {
  console.log("Seeding holdings (model-aligned for managed accounts)...");

  // Fetch accounts with model info
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds } },
    include: { modelPortfolio: { include: { allocations: true } } },
  });
  const securities = await prisma.security.findMany();
  const secMap = new Map(securities.map(s => [s.symbol, Number(s.price)]));

  const holdingRows: any[][] = [];

  for (const account of accounts) {
    const balance = Number(account.balance) || 100000;
    const cashBalance = Number(account.cashBalance) || balance * 0.05;
    const investableBalance = balance - cashBalance;

    if (account.modelPortfolio?.allocations.length) {
      // === MANAGED ACCOUNT (ABC): holdings EXACTLY match model allocations ===
      const allocs = account.modelPortfolio.allocations;
      // Separate cash allocations (VMFXX etc.) from investable allocations
      const cashAllocs = allocs.filter(a => a.assetClass === "cash");
      const investableAllocs = allocs.filter(a => a.assetClass !== "cash");
      // Total investable % in model (exclude cash allocs)
      const totalInvestablePct = investableAllocs.reduce((s, a) => s + Number(a.targetPct), 0) || 100;

      // Purchase date: 1–3 years ago
      const purchaseDate = new Date();
      purchaseDate.setFullYear(purchaseDate.getFullYear() - randomInt(1, 3));
      purchaseDate.setMonth(randomInt(0, 11));
      purchaseDate.setDate(randomInt(1, 28));

      for (const alloc of investableAllocs) {
        const targetPct = Number(alloc.targetPct) / totalInvestablePct; // normalize to investable portion
        const marketValue = Math.round(investableBalance * targetPct * 100) / 100;
        if (marketValue < 1) continue;
        const price = secMap.get(alloc.symbol) || 100;
        const quantity = marketValue / price;
        // Cost basis: purchase price was 85–105% of current price (slight drift)
        const purchasePrice = price * randomFloat(0.85, 1.05, 4);
        const costBasis = quantity * purchasePrice;
        holdingRows.push([cuid(), account.id, alloc.symbol, alloc.name || alloc.symbol, alloc.assetClass || "equity", quantity, costBasis, price, marketValue, purchaseDate.toISOString()]);
      }

      // Cash allocation positions (money market funds) from model. Use the custodian's own sweep
      // fund (Pershing→VMFXX, Schwab→SWVXX, Fidelity→SPAXX) instead of the model's generic VMFXX,
      // so each account holds a custodian-appropriate sweep. Falls back to the model symbol.
      const sweep = SWEEP_FUND[account.custodialPlatform];
      for (const alloc of cashAllocs) {
        const targetPct = Number(alloc.targetPct) / 100;
        const mmfValue = Math.round(balance * targetPct * 100) / 100;
        if (mmfValue < 1) continue;
        const sweepSymbol = sweep?.symbol ?? alloc.symbol;
        const sweepName = sweep?.name ?? (alloc.name || alloc.symbol);
        holdingRows.push([cuid(), account.id, sweepSymbol, sweepName, "cash", mmfValue, mmfValue, 1, mmfValue, purchaseDate.toISOString()]);
      }

    } else {
      // === NON-MANAGED ACCOUNT (XYZ): random diversified holdings ===
      // Exclude proprietary cash-sweep money funds (VMFXX/SPAXX/SWVXX) from the investable pool —
      // they're custodian-specific sweep vehicles, not positions a brokerage account would hold at a
      // different custodian. The generic CASH holding below covers cash for non-managed accounts.
      const investablePool = ALL_SECURITIES.filter(
        (s) => s.assetClass !== "cash" && !MUTUAL_FUND_SYMBOLS.has(s.symbol),
      );
      const selectedSecurities = randomElements(investablePool, 9).map(s => ({
        symbol: s.symbol, name: s.name, assetClass: s.assetClass, price: secMap.get(s.symbol) || s.price,
      }));
      let remaining = investableBalance;
      for (let i = 0; i < selectedSecurities.length; i++) {
        const sec = selectedSecurities[i];
        const isLast = i === selectedSecurities.length - 1;
        const pct = isLast ? 1.0 : randomFloat(0.05, 0.20, 4);
        const marketValue = isLast ? remaining : Math.min(remaining * 0.95, investableBalance * pct);
        remaining -= marketValue;
        if (marketValue < 10) continue;
        const quantity = marketValue / sec.price;
        const costBasis = marketValue * randomFloat(0.80, 1.15, 2);
        holdingRows.push([cuid(), account.id, sec.symbol, sec.name, sec.assetClass, quantity, costBasis, sec.price, marketValue, randomDate(2018, 2024).toISOString()]);
      }
    }

    // Always add CASH holding
    holdingRows.push([cuid(), account.id, "CASH", "Cash & Cash Equivalents", "cash", cashBalance, null, 1, cashBalance, null]);
  }

  // Swap a slice of selected accounts' positions into mutual funds. Market value is
  // preserved, so account totals and allocation percentages are unchanged.
  const fundPositions = injectMutualFunds(holdingRows);
  console.log(`  ${fundPositions} positions converted to mutual funds.`);

  // Batch insert
  const dp = createDirectPool();
  const batchSize = 30;
  for (let i = 0; i < holdingRows.length; i += batchSize) {
    const batch = holdingRows.slice(i, i + batchSize);
    const values: any[] = [];
    const placeholders = batch.map((h, idx) => {
      const b = idx * 10;
      values.push(...h);
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}::timestamptz, now())`;
    });
    try {
      await dp.query(
        `INSERT INTO "Holding" (id, "accountId", symbol, name, "assetClass", quantity, "costBasis", price, "marketValue", "purchaseDate", "updatedAt") VALUES ${placeholders.join(", ")} ON CONFLICT ("accountId", symbol) DO NOTHING`,
        values
      );
    } catch (e: any) {
      // Fallback to individual inserts
      for (const h of batch) {
        try {
          await dp.query(
            `INSERT INTO "Holding" (id, "accountId", symbol, name, "assetClass", quantity, "costBasis", price, "marketValue", "purchaseDate", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, now()) ON CONFLICT ("accountId", symbol) DO NOTHING`,
            h
          );
        } catch { }
      }
    }
    if (i > 0 && i % 500 === 0) console.log(`  (holdings: ${i}/${holdingRows.length})`);
  }
  await dp.end();

  console.log(`  ${holdingRows.length} holdings created.`);
}

async function seedTransactions(accountIds: string[]) {
  console.log("Seeding transactions (funding + position buys + ongoing activity)...");

  // Fetch accounts with holdings for realistic transactions
  const batchFetchSize = 100;
  const txRows: any[][] = [];

  for (let bStart = 0; bStart < accountIds.length; bStart += batchFetchSize) {
    const batchIds = accountIds.slice(bStart, bStart + batchFetchSize);
    const accounts = await prisma.account.findMany({
      where: { id: { in: batchIds } },
      include: { holdings: true },
    });

    for (const account of accounts) {
      const balance = Number(account.balance) || 100000;
      const holdingSymbols = account.holdings.filter(h => h.symbol !== "CASH" && h.assetClass !== "cash");

      // Establish account open date: 2–4 years ago
      const openDate = new Date();
      openDate.setFullYear(openDate.getFullYear() - randomInt(2, 4));
      openDate.setMonth(randomInt(0, 5));
      openDate.setDate(randomInt(1, 15));
      const openDateStr = openDate.toISOString();
      // Cap ongoing-activity date offsets so no transaction is ever dated in the future
      const maxOffsetDays = Math.floor((Date.now() - openDate.getTime()) / 86_400_000);

      // === 1. INITIAL FUNDING: transfer_in on account open date ===
      const fundingInstitutions = ["Chase Bank", "Bank of America", "Wells Fargo", "Fidelity", "Charles Schwab"];
      const fundingAmount = balance * randomFloat(0.95, 1.05, 4); // roughly equal to current balance
      txRows.push([cuid(), account.id, "transfer_in", null, null, null, fundingAmount, null, openDateStr,
        `ACH transfer from ${randomElement(fundingInstitutions)}`, openDateStr]);

      // === 2. INITIAL POSITION BUYS: one buy per holding, shortly after funding ===
      for (const holding of holdingSymbols) {
        const buyDate = new Date(openDate);
        buyDate.setDate(buyDate.getDate() + randomInt(1, 5)); // 1–5 days after funding
        const qty = Number(holding.quantity);
        const price = Number(holding.price) * randomFloat(0.90, 1.02, 4); // purchase price near current
        const amount = qty * price;
        txRows.push([cuid(), account.id, "buy", holding.symbol, qty, price, amount, randomFloat(0, 5, 2),
          buyDate.toISOString(), `BUY ${qty.toFixed(2)} shares of ${holding.symbol} @ $${price.toFixed(2)}`, buyDate.toISOString()]);
      }

      // === 3. ONGOING ACTIVITY: dividends, interest, fees, occasional rebalance trades ===
      // Calculate remaining transaction budget (25 total - 1 transfer_in - N buys)
      const establishingTxCount = 1 + holdingSymbols.length;
      const ongoingCount = Math.max(0, CONFIG.transactionsPerAccount - establishingTxCount);

      // Quarterly dividends for equity holdings (realistic)
      const eqHoldings = holdingSymbols.filter(h => h.assetClass === "equity" || h.assetClass === "alternative");
      const divCount = Math.min(Math.floor(ongoingCount * 0.4), eqHoldings.length * 4);
      for (let d = 0; d < divCount; d++) {
        const holding = randomElement(eqHoldings.length > 0 ? eqHoldings : holdingSymbols);
        const divDate = new Date(openDate);
        divDate.setDate(divDate.getDate() + randomInt(90, Math.min(900, maxOffsetDays)));
        const divAmount = Number(holding.marketValue) * randomFloat(0.004, 0.012, 4); // ~0.4–1.2% yield per quarter
        txRows.push([cuid(), account.id, "dividend", holding.symbol, null, null, divAmount, null,
          divDate.toISOString(), `Dividend payment from ${holding.symbol}`, divDate.toISOString()]);
      }

      // Monthly interest on cash
      const interestCount = Math.min(Math.floor(ongoingCount * 0.2), 12);
      for (let i = 0; i < interestCount; i++) {
        const intDate = new Date(openDate);
        intDate.setDate(intDate.getDate() + randomInt(30, Math.min(800, maxOffsetDays)));
        const intAmount = Number(account.cashBalance || 1000) * randomFloat(0.001, 0.004, 4);
        txRows.push([cuid(), account.id, "interest", null, null, null, intAmount, null,
          intDate.toISOString(), "Interest payment", intDate.toISOString()]);
      }

      // Quarterly advisory fees
      const feeCount = Math.min(Math.floor(ongoingCount * 0.2), 8);
      for (let f = 0; f < feeCount; f++) {
        const feeDate = new Date(openDate);
        feeDate.setDate(feeDate.getDate() + randomInt(90, Math.min(900, maxOffsetDays)));
        const feeAmount = balance * randomFloat(0.001, 0.003, 4); // ~0.1–0.3% per quarter
        txRows.push([cuid(), account.id, "fee", null, null, null, -feeAmount, null,
          feeDate.toISOString(), randomElement(["Advisory fee", "Platform fee", "Custodian fee"]), feeDate.toISOString()]);
      }

      // Occasional rebalance trades (buy/sell pairs)
      const tradeCount = Math.max(0, ongoingCount - divCount - interestCount - feeCount);
      for (let t = 0; t < tradeCount && holdingSymbols.length > 0; t++) {
        const holding = randomElement(holdingSymbols);
        const tradeDate = new Date(openDate);
        tradeDate.setDate(tradeDate.getDate() + randomInt(180, Math.min(1000, maxOffsetDays)));
        const type = Math.random() < 0.5 ? "buy" : "sell";
        const qty = Number(holding.quantity) * randomFloat(0.02, 0.08, 4); // small rebalance amount
        const price = Number(holding.price) * randomFloat(0.95, 1.05, 4);
        const amount = qty * price;
        txRows.push([cuid(), account.id, type, holding.symbol, qty, price, type === "sell" ? -amount : amount,
          randomFloat(0, 5, 2), tradeDate.toISOString(),
          `${type.toUpperCase()} ${qty.toFixed(2)} shares of ${holding.symbol} @ $${price.toFixed(2)}`,
          tradeDate.toISOString()]);
      }
    }

    if (bStart > 0 && bStart % 300 === 0) {
      console.log(`  (built tx rows for ${bStart}/${accountIds.length} accounts)`);
    }
  }

  console.log(`  Inserting ${txRows.length} transactions...`);

  // Batch insert
  const dp = createDirectPool();
  const batchSize = 50;
  for (let i = 0; i < txRows.length; i += batchSize) {
    const batch = txRows.slice(i, i + batchSize);
    const values: any[] = [];
    const placeholders = batch.map((t, idx) => {
      const b = idx * 11;
      values.push(...t);
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}::timestamptz, $${b + 10}, $${b + 11}::timestamptz)`;
    });
    try {
      await dp.query(
        `INSERT INTO "Transaction" (id, "accountId", "transactionType", symbol, quantity, price, amount, fees, "settledDate", description, "createdAt") VALUES ${placeholders.join(", ")}`,
        values
      );
    } catch (e: any) {
      for (const t of batch) {
        try {
          await dp.query(
            `INSERT INTO "Transaction" (id, "accountId", "transactionType", symbol, quantity, price, amount, fees, "settledDate", description, "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10, $11::timestamptz)`,
            t
          );
        } catch { }
      }
    }
    if (i > 0 && i % 5000 === 0) console.log(`  (transactions: ${i}/${txRows.length})`);
  }
  await dp.end();

  console.log(`  ${txRows.length} transactions created.`);
}

async function seedRetirementData(accountIds: string[]) {
  console.log("Seeding retirement data (contributions + distributions + priorYearEndBalance)...");

  const CURRENT_YEAR = 2026;
  const dp = createDirectPool();

  // Fetch IRA/ROTH accounts + client DOB
  const { rows: retirementAccounts } = await dp.query(`
    SELECT a.id, a."accountType", a.balance, c."dateOfBirth"
    FROM "Account" a
    JOIN "Client" c ON a."clientId" = c.id
    WHERE a.id = ANY($1::text[])
      AND lower(a."accountType"::text) IN ('ira', 'roth_ira', 'sep_ira', 'simple_ira')
      AND a.status = 'active'
  `, [accountIds]);

  const contribRows: unknown[][] = [];
  const distRows: unknown[][] = [];
  const rmdAccountUpdates: { id: string; balance: number }[] = [];

  const UNIFORM_LIFETIME: Record<number, number> = {
    72: 27.4, 73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9,
    78: 22.0, 79: 21.1, 80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7,
    84: 16.8, 85: 16.0, 86: 15.2, 87: 14.4, 88: 13.7, 89: 12.9,
    90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1, 94: 9.5, 95: 8.9,
  };

  function calcAge(dob: Date): number {
    const asOf = new Date(CURRENT_YEAR, 11, 31);
    let age = asOf.getFullYear() - dob.getFullYear();
    const m = asOf.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && asOf.getDate() < dob.getDate())) age--;
    return age;
  }

  for (const acct of retirementAccounts) {
    const type = acct.accountType.toLowerCase();
    const balance = Number(acct.balance) || 100000;
    const dob = new Date(acct.dateOfBirth);
    const age = calcAge(dob);

    // Contribution limit by type
    const contribLimit = type === "sep_ira" ? 70000 : type === "simple_ira" ? (age >= 50 ? 20000 : 16500) : (age >= 50 ? 8500 : 7500);

    // Seed contributions for IRA/ROTH_IRA (not SEP/SIMPLE — employer-driven)
    if (type === "ira" || type === "roth_ira") {
      const roll = Math.random();
      let totalContrib: number;
      if (roll < 0.20) totalContrib = contribLimit; // maxed out
      else if (roll < 0.25) totalContrib = contribLimit * randomFloat(1.01, 1.05, 4); // over limit
      else totalContrib = contribLimit * randomFloat(0.30, 0.95, 4); // on track

      // Split into 1-3 transactions
      const splits = randomInt(1, 3);
      let remaining = totalContrib;
      for (let s = 0; s < splits; s++) {
        const amt = s === splits - 1 ? remaining : remaining * randomFloat(0.3, 0.7, 4);
        remaining -= amt;
        const txDate = new Date(CURRENT_YEAR, randomInt(0, 1), randomInt(1, 28));
        const dateStr = txDate.toISOString();
        contribRows.push([cuid(), acct.id, "contribution", null, null, null, amt, null, dateStr, "IRA contribution", dateStr, CURRENT_YEAR]);
      }
    }

    // Seed distributions for 73+ clients (RMD eligible): IRA, SEP_IRA, SIMPLE_IRA
    if (age >= 73 && (type === "ira" || type === "sep_ira" || type === "simple_ira")) {
      // Set priorYearEndBalance = 85-115% of current balance
      const priorBalance = balance * randomFloat(0.85, 1.15, 2);
      rmdAccountUpdates.push({ id: acct.id, balance: priorBalance });

      const period = UNIFORM_LIFETIME[Math.min(age, 95)] ?? 8.9;
      const rmdAmount = priorBalance / period;
      if (rmdAmount < 100) continue;

      // Distribute 0-80% of RMD
      const pctDistributed = randomFloat(0, 0.80, 4);
      const totalDist = rmdAmount * pctDistributed;
      if (totalDist < 100) continue;

      const splits = randomInt(1, 3);
      let remaining = totalDist;
      for (let s = 0; s < splits; s++) {
        const amt = s === splits - 1 ? remaining : remaining * randomFloat(0.3, 0.7, 4);
        remaining -= amt;
        const txDate = new Date(CURRENT_YEAR, 0, randomInt(15, 28));
        const dateStr = txDate.toISOString();
        distRows.push([cuid(), acct.id, "distribution", null, null, null, -amt, null, dateStr, "Required Minimum Distribution", dateStr]);
      }
    }
  }

  // Batch insert contributions
  const BATCH = 500;
  for (let i = 0; i < contribRows.length; i += BATCH) {
    const chunk = contribRows.slice(i, i + BATCH);
    const placeholders = chunk.map((_, j) => `($${j * 12 + 1}, $${j * 12 + 2}, $${j * 12 + 3}, $${j * 12 + 4}, $${j * 12 + 5}, $${j * 12 + 6}, $${j * 12 + 7}, $${j * 12 + 8}, $${j * 12 + 9}::timestamptz, $${j * 12 + 10}, $${j * 12 + 11}::timestamptz, $${j * 12 + 12})`).join(", ");
    const values = chunk.flat();
    await dp.query(
      `INSERT INTO "Transaction" (id, "accountId", "transactionType", symbol, quantity, price, amount, fees, "settledDate", description, "createdAt", "contributionYear") VALUES ${placeholders}`,
      values
    );
  }

  // Batch insert distributions
  for (let i = 0; i < distRows.length; i += BATCH) {
    const chunk = distRows.slice(i, i + BATCH);
    const placeholders = chunk.map((_, j) => `($${j * 11 + 1}, $${j * 11 + 2}, $${j * 11 + 3}, $${j * 11 + 4}, $${j * 11 + 5}, $${j * 11 + 6}, $${j * 11 + 7}, $${j * 11 + 8}, $${j * 11 + 9}::timestamptz, $${j * 11 + 10}, $${j * 11 + 11}::timestamptz)`).join(", ");
    const values = chunk.flat();
    await dp.query(
      `INSERT INTO "Transaction" (id, "accountId", "transactionType", symbol, quantity, price, amount, fees, "settledDate", description, "createdAt") VALUES ${placeholders}`,
      values
    );
  }

  // Update priorYearEndBalance on RMD accounts
  for (const upd of rmdAccountUpdates) {
    await dp.query(`UPDATE "Account" SET "priorYearEndBalance" = $1 WHERE id = $2`, [upd.balance, upd.id]);
  }

  await dp.end();
  console.log(`  ${contribRows.length} contribution transactions, ${distRows.length} distribution transactions, ${rmdAccountUpdates.length} accounts with priorYearEndBalance.`);
}

async function seedTransferTransactions(accountIds: string[]) {
  console.log("Seeding transfer transactions (transfer_in/transfer_out)...");

  const EXT_INSTITUTIONS = ["Chase Bank", "Bank of America", "Wells Fargo", "Citibank", "US Bank", "Fidelity", "Charles Schwab", "Vanguard", "TD Ameritrade", "E*TRADE"];
  const METHODS = ["ACH", "Wire", "ACH", "ACAT", "ACH", "Wire"]; // weighted toward ACH

  // Fetch all active accounts with their household IDs
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds }, status: "active" },
    select: { id: true, accountName: true, householdId: true },
  });

  // Build household → accounts map for internal transfer pairs
  const householdAccounts: Record<string, { id: string; accountName: string }[]> = {};
  for (const acct of accounts) {
    if (acct.householdId) {
      if (!householdAccounts[acct.householdId]) householdAccounts[acct.householdId] = [];
      householdAccounts[acct.householdId].push({ id: acct.id, accountName: acct.accountName });
    }
  }

  const txRows: any[][] = [];

  for (const acct of accounts) {
    const daysAgo = (d: number) => {
      const dt = new Date();
      dt.setDate(dt.getDate() - d);
      dt.setHours(9 + Math.floor(Math.random() * 8));
      return dt.toISOString();
    };

    // ~40% external inbound
    if (Math.random() < 0.40) {
      const method = randomElement(METHODS);
      const inst = randomElement(EXT_INSTITUTIONS);
      const amount = randomFloat(1000, 46000, 2);
      const date = daysAgo(randomInt(1, 60));
      txRows.push([cuid(), acct.id, "transfer_in", null, null, null, amount, null, date, `${method} transfer from ${inst}`, date]);
    }

    // ~20% external outbound
    if (Math.random() < 0.20) {
      const method = randomElement(METHODS);
      const inst = randomElement(EXT_INSTITUTIONS);
      const amount = randomFloat(500, 30000, 2);
      const date = daysAgo(randomInt(1, 60));
      txRows.push([cuid(), acct.id, "transfer_out", null, null, null, -amount, null, date, `${method} transfer to ${inst}`, date]);
    }

    // ~15% internal transfer pair (same household)
    if (Math.random() < 0.15 && acct.householdId) {
      const partners = (householdAccounts[acct.householdId] || []).filter(a => a.id !== acct.id);
      if (partners.length > 0) {
        const partner = randomElement(partners);
        const amount = randomFloat(500, 15000, 2);
        const date = daysAgo(randomInt(1, 45));
        txRows.push([cuid(), acct.id, "transfer_out", null, null, null, -amount, null, date, `Internal transfer to ${partner.accountName}`, date]);
        txRows.push([cuid(), partner.id, "transfer_in", null, null, null, amount, null, date, `Internal transfer from ${acct.accountName}`, date]);
      }
    }
  }

  console.log(`  Inserting ${txRows.length} transfer transactions...`);

  const dp = createDirectPool();
  const batchSize = 50;
  for (let i = 0; i < txRows.length; i += batchSize) {
    const batch = txRows.slice(i, i + batchSize);
    const values: any[] = [];
    const placeholders = batch.map((t, idx) => {
      const b = idx * 11;
      values.push(...t);
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}::timestamptz, $${b + 10}, $${b + 11}::timestamptz)`;
    });
    try {
      await dp.query(
        `INSERT INTO "Transaction" (id, "accountId", "transactionType", symbol, quantity, price, amount, fees, "settledDate", description, "createdAt") VALUES ${placeholders.join(", ")}`,
        values
      );
    } catch (e: any) {
      for (const t of batch) {
        try {
          await dp.query(
            `INSERT INTO "Transaction" (id, "accountId", "transactionType", symbol, quantity, price, amount, fees, "settledDate", description, "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10, $11::timestamptz)`,
            t
          );
        } catch { }
      }
    }
  }
  await dp.end();

  console.log(`  ${txRows.length} transfer transactions created.`);
}

async function seedPerformanceRecords(accountIds: string[]) {
  console.log("Seeding performance records...");

  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds } },
  });

  const periods = [
    { name: "MTD", months: 1 },
    { name: "QTD", months: 3 },
    { name: "YTD", months: 12 },
  ];

  const perfRows: any[][] = [];
  for (const account of accounts) {
    const balance = Number(account.balance) || 100000;
    for (const period of periods) {
      const periodEnd = new Date();
      const periodStart = new Date();
      periodStart.setMonth(periodStart.getMonth() - period.months);
      const marketReturn = randomFloat(-0.05, 0.15, 6);
      const alpha = randomFloat(-0.03, 0.03, 6);
      const twrReturn = marketReturn + alpha;
      const mwrReturn = twrReturn + randomFloat(-0.01, 0.01, 6);
      const beginningValue = balance / (1 + twrReturn);
      const netFlows = randomFloat(-10000, 50000, 2);
      perfRows.push([cuid(), account.id, periodStart.toISOString(), periodEnd.toISOString(), beginningValue, balance, netFlows, twrReturn, mwrReturn, marketReturn]);
    }
  }

  const dp = createDirectPool();
  const batchSize = 50;
  for (let i = 0; i < perfRows.length; i += batchSize) {
    const batch = perfRows.slice(i, i + batchSize);
    const values: any[] = [];
    const placeholders = batch.map((p, idx) => {
      const b = idx * 10;
      values.push(...p);
      return `($${b + 1}, $${b + 2}, $${b + 3}::timestamptz, $${b + 4}::timestamptz, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, now())`;
    });
    try {
      await dp.query(
        `INSERT INTO "AccountPerformance" (id, "accountId", "periodStart", "periodEnd", "beginningValue", "endingValue", "netFlows", "twrReturn", "mwrReturn", "benchmarkReturn", "createdAt") VALUES ${placeholders.join(", ")} ON CONFLICT ("accountId", "periodStart", "periodEnd") DO NOTHING`,
        values
      );
    } catch { }
  }
  await dp.end();

  console.log(`  ${perfRows.length} performance records created.`);
}


async function seedCalendarEvents() {
  console.log("Seeding calendar events (8 meetings linked to real clients)...");
  const dp = createDirectPool();

  // Fetch up to 8 distinct clients that have accounts
  const { rows: clients } = await dp.query(`
    SELECT DISTINCT ON (c.id)
      c.id AS client_id,
      c."firstName" || ' ' || c."lastName" AS client_name
    FROM "Client" c
    JOIN "Account" a ON a."clientId" = c.id
    ORDER BY c.id
    LIMIT 8
  `);

  if (clients.length === 0) {
    console.log("  No clients found — skipping calendar events.");
    await dp.end();
    return;
  }

  const meetingConfigs = [
    { title: "Annual Portfolio Review",   meetingType: "annual_review",    hour: 9,  duration: 60,  location: "Office - Conference Room A", tags: ["HIGH NET WORTH"],              dayOffset: 0 },
    { title: "Portfolio Check-In",        meetingType: "check_in",         hour: 10, duration: 45,  location: "Zoom",                       tags: ["RETIREE"],                     dayOffset: 0 },
    { title: "Prospect Discovery Meeting",meetingType: "prospect",         hour: 14, duration: 60,  location: "Office - Conference Room B", tags: ["PROSPECT", "HIGH NET WORTH"],  dayOffset: 0 },
    { title: "Estate Planning Review",    meetingType: "estate_planning",  hour: 16, duration: 60,  location: "Zoom",                       tags: ["ESTATE PLANNING"],             dayOffset: 0 },
    { title: "Tax Strategy Session",      meetingType: "tax_planning",     hour: 10, duration: 60,  location: "Office",                     tags: ["TAX SENSITIVE"],               dayOffset: 1 },
    { title: "Quarterly Review",          meetingType: "check_in",         hour: 14, duration: 60,  location: "Zoom",                       tags: ["CONSERVATIVE"],                dayOffset: 1 },
    { title: "Annual Review & Planning",  meetingType: "annual_review",    hour: 11, duration: 90,  location: "Office - Conference Room A", tags: ["BUSINESS OWNER"],              dayOffset: 2 },
    { title: "Retirement Income Review",  meetingType: "check_in",         hour: 9,  duration: 45,  location: "Zoom",                       tags: ["RETIREE", "INCOME FOCUSED"],   dayOffset: 2 },
  ];

  const statuses = ["completed", "in_progress", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming"];

  // Delete old calendar events (both unlinked and previously linked) so reseed is clean
  await dp.query(`DELETE FROM calendar_events`);

  let count = 0;
  for (let i = 0; i < clients.length; i++) {
    const client = clients[i];
    const cfg = meetingConfigs[i];
    const status = statuses[i];
    const id = `mtg_${String(i + 1).padStart(3, "0")}`;
    const tagsLiteral = `{${cfg.tags.map((t) => `"${t}"`).join(",")}}`;

    await dp.query(
      `INSERT INTO calendar_events (
        id, title, description, type, start_time, end_time, all_day,
        location, attendees, color, client_id, meeting_type, tags, status
      ) VALUES (
        $1, $2, $3, 'meeting',
        CURRENT_DATE + ($4 * INTERVAL '1 day') + ($5 * INTERVAL '1 hour'),
        CURRENT_DATE + ($4 * INTERVAL '1 day') + ($5 * INTERVAL '1 hour') + ($6 * INTERVAL '1 minute'),
        false, $7, $8, '#3B82F6', $9, $10, $11, $12
      ) ON CONFLICT (id) DO UPDATE SET
        client_id = EXCLUDED.client_id,
        meeting_type = EXCLUDED.meeting_type,
        tags = EXCLUDED.tags,
        status = EXCLUDED.status,
        start_time = EXCLUDED.start_time,
        end_time = EXCLUDED.end_time,
        attendees = EXCLUDED.attendees,
        title = EXCLUDED.title,
        location = EXCLUDED.location`,
      [
        id,
        cfg.title,
        `${cfg.title} with ${client.client_name}`,
        cfg.dayOffset,
        cfg.hour,
        cfg.duration,
        cfg.location,
        client.client_name,
        client.client_id,
        cfg.meetingType,
        tagsLiteral,
        status,
      ]
    );
    count++;
  }

  await dp.end();
  console.log(`  ${count} calendar meeting events created.`);
}

// ============================================================================
// MAIN
// ============================================================================

const AGENT_ROSTER: {
  name: string;
  rule: string;
  description: string;
  instructions: string;
  tools: string[];
  trigger_type: string;
  schedule: string | null;
  enabled: boolean;
}[] = [
  { name: "Cash Sweep", rule: "cash_drag", description: "Surfaces accounts holding excess uninvested cash above model target.", instructions: "You are Cash Sweep. Flag managed accounts with elevated cash so advisors can put it to work.", tools: ["cash-analysis", "low-cash"], trigger_type: "scheduled", schedule: "0 7 * * 1-5", enabled: true },
  { name: "Compliance Watch", rule: "compliance", description: "Watches for pending outside business activities and missing KYC fields.", instructions: "You are Compliance Watch. Surface pending OBAs and KYC gaps that need operations attention.", tools: ["outside-business", "kyc-gaps"], trigger_type: "scheduled", schedule: "0 6 * * 1", enabled: true },
  { name: "Performance Watch", rule: "performance", description: "Flags accounts trailing their benchmark.", instructions: "You are Performance Watch. Identify underperforming accounts for review.", tools: ["underperformers", "account-performance"], trigger_type: "scheduled", schedule: "0 8 * * 1", enabled: true },
  { name: "Transfer Watch", rule: "operations", description: "Finds transfers stalled in-flight for several days.", instructions: "You are Transfer Watch. Surface stuck transfers so ops can chase them.", tools: ["transfers", "transfer-pipeline"], trigger_type: "manual", schedule: null, enabled: false },
  { name: "Fee Auditor", rule: "fees", description: "Reviews managed accounts for zero, high, or unusually low fees.", instructions: "You are Fee Auditor. Flag fee anomalies on managed accounts.", tools: ["advisory-fees", "fee-review"], trigger_type: "manual", schedule: null, enabled: false },
];

// Agents + agent_runs live in raw Supabase tables (migration 089), which clearDatabase()
// does not touch. Self-clear here so repeat seeds don't accumulate duplicate rosters.
async function seedAgents() {
  console.log("Seeding agents + agent_runs...");
  const dp = createDirectPool();
  await dp.query(`DELETE FROM agent_runs`);
  await dp.query(`DELETE FROM agents`);

  const now = Date.now();
  for (const a of AGENT_ROSTER) {
    const id = cuid();
    const lastRun = a.enabled ? new Date(now - randomInt(1, 120) * 60_000).toISOString() : null;
    await dp.query(
      `INSERT INTO agents (id, name, description, instructions, rule, tools, scope, status, trigger_type, schedule, enabled, last_run_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,'{}'::jsonb,'active',$7,$8,$9,$10,now(),now())`,
      [id, a.name, a.description, a.instructions, a.rule, JSON.stringify(a.tools), a.trigger_type, a.schedule, a.enabled, lastRun],
    );

    const runCount = randomInt(2, 4);
    for (let i = 0; i < runCount; i++) {
      const flagged = randomInt(0, 6);
      const urgent = flagged > 0 ? randomInt(0, Math.min(2, flagged)) : 0;
      const summary =
        flagged === 0
          ? "No issues found — all clear."
          : `Flagged ${flagged} item${flagged === 1 ? "" : "s"}${urgent ? ` (${urgent} urgent)` : ""}.`;
      const started = new Date(now - (i + 1) * randomInt(18, 30) * 3_600_000);
      const completed = new Date(started.getTime() + randomInt(2, 6) * 1000);
      await dp.query(
        `INSERT INTO agent_runs (id, agent_id, trigger, status, summary, output, items_count, flagged_count, started_at, completed_at)
         VALUES ($1,$2,$3,'completed',$4,$5::jsonb,$6,$7,$8,$9)`,
        [
          cuid(),
          id,
          a.enabled ? "scheduled" : "manual",
          summary,
          JSON.stringify({ summary, items: [], counts: { flagged, urgent } }),
          flagged,
          flagged,
          started.toISOString(),
          completed.toISOString(),
        ],
      );
    }
  }

  await dp.end();
  console.log(`  ${AGENT_ROSTER.length} agents + sample runs created.`);
}

// ============================================================================
// FEATURE TABLES — sales_credits, transfers,
// account_participant, planning_profiles and Ticket(+messages/activities).
// These are Supabase-only tables (not in the Prisma schema) that previously held
// standalone demo data with FABRICATED account ids. We regenerate them here tied
// to the real seeded accounts so every reference resolves — important now that an
// AI model queries this data. clearDatabase() does not touch most of them, so this
// function self-clears first. Runs after accounts + users exist.
// ============================================================================
async function seedFeatureTables() {
  console.log("Seeding feature tables (sales credits, OBA, house expenses, transfers, participants, planning, tickets)...");
  const dp = createDirectPool();

  // Self-clear (Ticket DELETE cascades to TicketMessage/TicketActivity)
  await dp.query(`DELETE FROM sales_credits`);
  await dp.query(`DELETE FROM outside_business_activities`);
  await dp.query(`DELETE FROM house_account_expenses`);
  await dp.query(`DELETE FROM transfers`);
  await dp.query(`DELETE FROM account_participant`);
  await dp.query(`DELETE FROM planning_profiles`);
  await dp.query(`DELETE FROM "Ticket"`);

  // Real accounts + owning client / household / advisor
  const { rows: accounts } = await dp.query(`
    SELECT a.id, a."accountNumber" AS account_number,
           COALESCE(a."accountName", c."firstName" || ' ' || c."lastName") AS account_name,
           lower(a."accountType"::text) AS account_type, a."isManaged" AS is_managed,
           a."custodialPlatform"::text AS custodial_platform,
           a."householdId" AS household_id, h.name AS household_name,
           (c."firstName" || ' ' || c."lastName") AS client_name,
           c."dateOfBirth" AS date_of_birth, COALESCE(c."annualIncome", 0)::float AS annual_income,
           COALESCE(c.state, 'NY') AS state, adv."repCode" AS rep_code, au.name AS advisor_name
    FROM "Account" a
    JOIN "Client" c ON c.id = a."clientId"
    LEFT JOIN "Household" h ON h.id = a."householdId"
    JOIN "Advisor" adv ON adv.id = a."advisorId"
    JOIN "User" au ON au.id = adv."userId"
  `);
  if (accounts.length === 0) { console.log("  No accounts — skipping feature tables."); await dp.end(); return; }

  const { rows: staff } = await dp.query(`SELECT id, name FROM "User" WHERE role IN ('OPERATIONS','ADVISOR') ORDER BY id`);
  const initials = (name: string) => (name || "").split(/\s+/).map((p) => p[0] || "").join("").slice(0, 2).toUpperCase() || "OP";
  const isoDaysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
  const managed = accounts.filter((a: any) => a.is_managed);

  // ---- account_participant: ~40% of accounts get 1-2 participants -----------
  const PART_ROLES = ["beneficiary", "interested_party", "lpoa", "poa", "trusted_contact"];
  const PART_RELS = ["spouse", "child", "parent", "sibling", "grandchild", "friend", "attorney", "accountant", "financial_planner", "tax_advisor", "trustee"];
  let partCount = 0;
  for (const a of accounts) {
    if (Math.random() > 0.4) continue;
    for (let i = 0; i < randomInt(1, 2); i++) {
      await dp.query(
        `INSERT INTO account_participant (account_id, name, role, relationship) VALUES ($1,$2,$3,$4)`,
        [a.id, `${randomElement(FIRST_NAMES)} ${randomElement(LAST_NAMES)}`, randomElement(PART_ROLES), randomElement(PART_RELS)]
      );
      partCount++;
    }
  }

  // ---- sales_credits: ~24 rows ----------------------------------------------
  const CREDIT_TYPES = ["12b-1", "trail", "sub_ta", "revenue_share", "marketing"];
  const FUND_SOURCES = ["American Funds", "BlackRock", "Vanguard", "PIMCO", "Franklin Templeton", "T. Rowe Price", "Invesco", "MFS", "JP Morgan", "Goldman Sachs"];
  const FUNDS: [string, string][] = [
    ["AGTHX", "Growth Fund of America"], ["ANCFX", "American New Perspective"], ["FKIQX", "Franklin Income Fund"],
    ["PTTRX", "PIMCO Total Return Fund"], ["TRBCX", "Blue Chip Growth Fund"], ["VFIAX", "Vanguard 500 Index Admiral"],
    ["MFEKX", "MFS Value Fund"], ["IVV", "Invesco S&P 500 ETF"],
  ];
  // Rolling trailing-4-quarter windows (3 closed + the current open quarter) so
  // period views stay populated no matter when the reseed runs.
  const toIsoDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const seedNow = new Date();
  const CREDIT_QUARTERS = Array.from({ length: 4 }, (_, i) => {
    const back = 3 - i;
    const qStart = new Date(seedNow.getFullYear(), (Math.floor(seedNow.getMonth() / 3) - back) * 3, 1);
    const qEnd = new Date(qStart.getFullYear(), qStart.getMonth() + 3, 0);
    const paidAt = new Date(qEnd.getTime() + 10 * 86400000);
    return {
      label: `Q${Math.floor(qStart.getMonth() / 3) + 1} ${qStart.getFullYear()}`,
      start: toIsoDate(qStart),
      end: toIsoDate(qEnd),
      // Date-level comparison: on the quarter's last day it is still open
      closed: toIsoDate(qEnd) < toIsoDate(seedNow),
      // Fund companies pay ~10 days after quarter close; a credit may only be
      // "received" once that payout date has actually passed (never future-dated)
      paidAt,
      payoutPassed: paidAt.getTime() <= seedNow.getTime(),
    };
  });
  let creditCount = 0;
  for (const a of randomElements(accounts, Math.min(24, accounts.length))) {
    const [sym, fname] = randomElement(FUNDS);
    const basis = randomInt(40000, 2000000);
    const rate = randomFloat(0.0005, 0.0025, 4);
    const q = randomElement(CREDIT_QUARTERS);
    // Paid-out quarters are mostly received; closed-but-unpaid are pending; the
    // open quarter is still accruing
    const status = q.closed && q.payoutPassed
      ? randomElement(["received", "received", "received", "pending"])
      : q.closed
        ? "pending"
        : randomElement(["pending", "expected"]);
    const receivedDate = status === "received" ? toIsoDate(q.paidAt) : null;
    await dp.query(
      `INSERT INTO sales_credits (account_number, credit_type, source, fund_symbol, fund_name, period, period_start, period_end, assets_basis, credit_rate, credit_amount, status, received_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [a.account_number, randomElement(CREDIT_TYPES), randomElement(FUND_SOURCES), sym, fname, q.label, q.start, q.end, basis, rate, Number((basis * rate).toFixed(2)), status, receivedDate]
    );
    creditCount++;
  }

  // ---- outside_business_activities: 10 disclosures, rolling dates ------------
  const OBA_ROSTER: { activity: string; description: string; income: string; grossMin: number; grossMax: number; hasClient: boolean }[] = [
    { activity: "insurance", description: "Term life insurance placement", income: "commission", grossMin: 1800, grossMax: 5500, hasClient: true },
    { activity: "insurance", description: "Long-term care policy sale", income: "commission", grossMin: 1200, grossMax: 4000, hasClient: true },
    { activity: "tax_prep", description: "Individual tax return preparation", income: "fee", grossMin: 900, grossMax: 2500, hasClient: true },
    { activity: "tax_prep", description: "Small business tax filing", income: "fee", grossMin: 1500, grossMax: 3500, hasClient: true },
    { activity: "speaking", description: "Financial literacy workshop", income: "fee", grossMin: 1000, grossMax: 3000, hasClient: false },
    { activity: "speaking", description: "Retirement planning seminar keynote", income: "fee", grossMin: 1500, grossMax: 4500, hasClient: false },
    { activity: "consulting", description: "401(k) plan design consulting", income: "retainer", grossMin: 2000, grossMax: 5000, hasClient: true },
    { activity: "consulting", description: "Family office investment committee retainer", income: "retainer", grossMin: 2500, grossMax: 5500, hasClient: true },
    { activity: "estate_planning", description: "Estate settlement advisory", income: "fee", grossMin: 1800, grossMax: 4800, hasClient: true },
    { activity: "estate_planning", description: "Trust administration support", income: "fee", grossMin: 1200, grossMax: 3600, hasClient: true },
  ];
  let obaCount = 0;
  for (const oba of OBA_ROSTER) {
    const receivedOn = new Date(Date.now() - randomInt(5, 330) * 86400000);
    const gross = randomInt(oba.grossMin, oba.grossMax);
    const obaExpenses = randomInt(0, Math.round(gross * 0.2));
    await dp.query(
      `INSERT INTO outside_business_activities (activity_type, description, client_name, income_type, gross_income, expenses, net_income, date_received, period, disclosed, approval_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10)`,
      [
        oba.activity,
        oba.description,
        oba.hasClient ? `${randomElement(FIRST_NAMES)} ${randomElement(LAST_NAMES)}` : null,
        oba.income,
        gross,
        obaExpenses,
        gross - obaExpenses,
        toIsoDate(receivedOn),
        `Q${Math.floor(receivedOn.getMonth() / 3) + 1} ${receivedOn.getFullYear()}`,
        randomElement(["approved", "approved", "approved", "pending"]),
      ]
    );
    obaCount++;
  }

  // ---- house_account_expenses: 6 categories × 13 months ending current month --
  const EXPENSE_BASE: [string, number, string][] = [
    ["platform_fees", 340, "Monthly platform subscription"],
    ["custodian_fees", 820, "Custodial service charges"],
    ["clearing_fees", 115, "Trade clearing costs"],
    ["e_and_o_insurance", 450, "Errors & omissions insurance premium"],
    ["compliance_costs", 1100, "Compliance monitoring & reporting"],
    ["technology_costs", 800, "Software licenses & IT services"],
  ];
  let expenseCount = 0;
  for (let back = 12; back >= 0; back--) {
    const m = new Date(seedNow.getFullYear(), seedNow.getMonth() - back, 1);
    for (const [category, base, description] of EXPENSE_BASE) {
      // Flat E&O premium; other categories drift up slightly month over month
      const amount = category === "e_and_o_insurance"
        ? base
        : Math.round(base * (1 + (12 - back) * 0.006)) + randomInt(-15, 15);
      await dp.query(
        `INSERT INTO house_account_expenses (category, amount, period_month, period_year, description)
         VALUES ($1,$2,$3,$4,$5)`,
        [category, amount, m.getMonth() + 1, m.getFullYear(), description]
      );
      expenseCount++;
    }
  }

  // ---- transfers: ~15 (inbound / outbound / internal) -----------------------
  const EXT_BANKS = ["Chase Bank", "Citibank", "Bank of America", "Wells Fargo", "Fidelity", "Charles Schwab", "Vanguard"];
  const NOTE: Record<string, string> = {
    pending_approval: "Awaiting client authorization", submitted: "Transfer initiated, processing",
    in_transit: "In transit, expected shortly", completed: "Transfer completed", rejected: "Rejected — see notes",
  };
  const histThrough = (final: string) => {
    const chain = ["pending_approval", "submitted", "in_transit", "completed"];
    const end = final === "rejected" ? 2 : chain.indexOf(final);
    const steps = chain.slice(0, end + 1);
    if (final === "rejected") steps.push("rejected");
    return steps.map((s, i) => ({ status: s, note: NOTE[s], timestamp: isoDaysAgo(steps.length - i) }));
  };
  const byHousehold: Record<string, any[]> = {};
  for (const a of accounts) if (a.household_id) (byHousehold[a.household_id] ||= []).push(a);
  const internalPairs = Object.values(byHousehold).filter((g) => g.length >= 2);
  const STATUS_POOL = ["pending_approval", "submitted", "in_transit", "completed", "completed", "rejected"];
  let transferCount = 0;
  const insertTransfer = async (t: any) => {
    await dp.query(
      `INSERT INTO transfers (reference_number, type, direction, status, from_account_id, from_account_name, from_account_number, from_institution,
        to_account_id, to_account_name, to_account_number, to_institution, amount, initiated_at, completed_at, initiated_by, notes, status_history)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)`,
      [t.ref, t.type, t.direction, t.status, t.from_id, t.from_name, t.from_num, t.from_inst,
       t.to_id, t.to_name, t.to_num, t.to_inst, t.amount, t.initiated_at, t.completed_at, t.initiated_by, t.notes, JSON.stringify(t.history)]
    );
    transferCount++;
  };
  for (let i = 0; i < 6; i++) { // inbound: external -> our account
    const a = randomElement(accounts); const status = randomElement(STATUS_POOL); const bank = randomElement(EXT_BANKS);
    await insertTransfer({ ref: `TRF-${randomInt(100000, 999999)}`, type: randomElement(["ach", "wire"]), direction: "inbound", status,
      from_id: null, from_name: `${a.client_name} (external)`, from_num: null, from_inst: bank,
      to_id: a.id, to_name: a.account_name, to_num: a.account_number, to_inst: CUSTODIAN_NAME[a.custodial_platform] ?? "—",
      amount: randomInt(5000, 250000), initiated_at: isoDaysAgo(randomInt(1, 20)), completed_at: status === "completed" ? isoDaysAgo(randomInt(0, 1)) : null,
      initiated_by: a.advisor_name, notes: `Incoming ${bank} funds`, history: histThrough(status) });
  }
  for (let i = 0; i < 5; i++) { // outbound: our account -> external
    const a = randomElement(accounts); const status = randomElement(STATUS_POOL); const bank = randomElement(EXT_BANKS);
    await insertTransfer({ ref: `TRF-${randomInt(100000, 999999)}`, type: randomElement(["ach", "wire", "acat"]), direction: "outbound", status,
      from_id: a.id, from_name: a.account_name, from_num: a.account_number, from_inst: CUSTODIAN_NAME[a.custodial_platform] ?? "—",
      to_id: null, to_name: `${a.client_name} (external)`, to_num: null, to_inst: bank,
      amount: randomInt(5000, 150000), initiated_at: isoDaysAgo(randomInt(1, 20)), completed_at: status === "completed" ? isoDaysAgo(randomInt(0, 1)) : null,
      initiated_by: a.advisor_name, notes: `Outgoing transfer to ${bank}`, history: histThrough(status) });
  }
  for (let i = 0; i < 4 && internalPairs.length; i++) { // internal: between two accounts in a household
    const grp = randomElement(internalPairs); const [from, to] = randomElements(grp, 2); const status = randomElement(STATUS_POOL);
    await insertTransfer({ ref: `TRF-${randomInt(100000, 999999)}`, type: "internal", direction: "internal", status,
      from_id: from.id, from_name: from.account_name, from_num: from.account_number, from_inst: CUSTODIAN_NAME[from.custodial_platform] ?? "—",
      to_id: to.id, to_name: to.account_name, to_num: to.account_number, to_inst: CUSTODIAN_NAME[to.custodial_platform] ?? "—",
      amount: randomInt(2000, 80000), initiated_at: isoDaysAgo(randomInt(1, 15)), completed_at: status === "completed" ? isoDaysAgo(randomInt(0, 1)) : null,
      initiated_by: from.advisor_name, notes: "Internal household transfer", history: histThrough(status) });
  }

  // ---- planning_profiles: one per ~15 distinct households -------------------
  const STATES = ["NY", "CA", "TX", "FL", "WA", "IL", "MA", "CO"];
  const FILINGS = ["married_filing_jointly", "single", "married_filing_jointly"];
  const planHouseholds = randomElements(Object.values(byHousehold), Math.min(15, internalPairs.length || Object.keys(byHousehold).length));
  let planCount = 0;
  for (const grp of planHouseholds) {
    const a = grp[0];
    const income = a.annual_income > 0 ? Math.round(a.annual_income) : randomInt(120000, 400000);
    const dob = a.date_of_birth ? new Date(a.date_of_birth).toISOString().slice(0, 10) : `19${randomInt(55, 75)}-0${randomInt(1, 9)}-15`;
    await dp.query(
      `INSERT INTO planning_profiles (household_id, client_name, date_of_birth, retirement_age, life_expectancy, state_of_residence, filing_status,
        current_annual_income, social_security_benefit, current_annual_expenses, expected_return, inflation_rate)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [a.household_id, a.client_name, dob, randomInt(62, 67), randomInt(88, 92), randomElement(STATES), randomElement(FILINGS),
       income, randomInt(2000, 3500), Math.round(income * 0.7), randomFloat(0.06, 0.08, 4), randomFloat(0.025, 0.035, 4)]
    );
    planCount++;
  }

  // ---- Ticket (+ messages / activities): ~18 ops tickets --------------------
  let ticketCount = 0;
  if (staff.length) {
    const T = (team: string, title: string, priority: string, desc: (c: string, n: string) => string) => ({ team, title, priority, desc });
    const TEMPLATES = [
      T("PRD", "Principal trade approval — fixed income", "LOW", (c, n) => `Principal trade for ${c} (account ${n}) requires trading desk approval before execution.`),
      T("PRD", "Cross trade review between client accounts", "MEDIUM", (c, n) => `Proposed cross trade involving ${c}'s account ${n} needs compliance review.`),
      T("ORI", "Orion household grouping incorrect", "URGENT", (c, n) => `${c}'s account ${n} is grouped under the wrong Orion household. Please correct the grouping.`),
      T("ORI", "Orion performance data mismatch", "HIGH", (c, n) => `Performance figures for ${c} (account ${n}) do not reconcile with custodial data.`),
      T("ASH", "Advisor transition — account reassignment", "HIGH", (c, n) => `${c} (account ${n}) is moving to a new advisor. Reassign and confirm billing.`),
      T("NB", "New account — missing documents", "MEDIUM", (c, n) => `New account ${n} for ${c} is missing signed advisory disclosures.`),
      T("CS", "Beneficiary update request", "LOW", (c, n) => `${c} requested a beneficiary update on account ${n}.`),
      T("CS", "Address change request", "LOW", (c, n) => `${c} submitted an address change affecting account ${n}.`),
      T("OPS", "Wire transfer verification", "HIGH", (c, n) => `Outgoing wire on account ${n} (${c}) is pending verbal verification.`),
      T("OPS", "Cost basis correction", "MEDIUM", (c, n) => `Cost basis discrepancy reported on account ${n} for ${c}.`),
    ];
    const TStatuses = ["OPEN", "OPEN", "IN_PROGRESS", "IN_PROGRESS", "RESOLVED", "CLOSED"];
    const teamCounters: Record<string, number> = {};
    for (let i = 0; i < 18; i++) {
      const tpl = randomElement(TEMPLATES);
      const a = randomElement(accounts);
      const status = randomElement(TStatuses);
      const creator = randomElement(staff);
      const assignee = Math.random() < 0.8 ? randomElement(staff) : null;
      teamCounters[tpl.team] = (teamCounters[tpl.team] || 0) + 1;
      const ticketNumber = `${tpl.team}-${String(teamCounters[tpl.team]).padStart(5, "0")}`;
      const createdDays = randomInt(1, 45);
      const createdAt = isoDaysAgo(createdDays);
      const resolved = status === "RESOLVED" || status === "CLOSED";
      const resolvedAt = resolved ? isoDaysAgo(randomInt(0, Math.max(1, createdDays - 1))) : null;
      const id = cuid();
      await dp.query(
        `INSERT INTO "Ticket" (id, "ticketNumber", team, title, description, status, priority, "creatorId", "assigneeId", "accountNumber", "clientName", "resolvedAt", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6::"TicketStatus",$7::"TicketPriority",$8,$9,$10,$11,$12,$13,$14)`,
        [id, ticketNumber, tpl.team, tpl.title, tpl.desc(a.client_name, a.account_number), status, tpl.priority,
         creator.id, assignee ? assignee.id : null, a.account_number, a.client_name, resolvedAt, createdAt, resolvedAt || createdAt]
      );
      // opening message + (sometimes) a reply
      await dp.query(
        `INSERT INTO "TicketMessage" (id, "ticketId", author, "authorInitials", body, "isInternal", "createdAt") VALUES ($1,$2,$3,$4,$5,false,$6)`,
        [cuid(), id, creator.name, initials(creator.name), tpl.desc(a.client_name, a.account_number), createdAt]
      );
      if (assignee && Math.random() < 0.6) {
        await dp.query(
          `INSERT INTO "TicketMessage" (id, "ticketId", author, "authorInitials", body, "isInternal", "createdAt") VALUES ($1,$2,$3,$4,$5,true,$6)`,
          [cuid(), id, assignee.name, initials(assignee.name), "Reviewing now — will follow up with the custodian and update this ticket.", isoDaysAgo(Math.max(0, createdDays - 1))]
        );
      }
      await dp.query(
        `INSERT INTO "TicketActivity" (id, "ticketId", action, actor, note, "targetTeam", "createdAt") VALUES ($1,$2,'created',$3,$4,$5,$6)`,
        [cuid(), id, creator.name, `Ticket opened for account ${a.account_number}`, tpl.team, createdAt]
      );
      if (resolved) {
        await dp.query(
          `INSERT INTO "TicketActivity" (id, "ticketId", action, actor, note, "targetTeam", "createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [cuid(), id, status === "CLOSED" ? "closed" : "resolved", (assignee || creator).name, "Resolved and verified.", tpl.team, resolvedAt]
        );
      }
      ticketCount++;
    }
  }

  await dp.end();
  console.log(`  Feature tables: ${partCount} participants, ${creditCount} sales credits, ${obaCount} OBA, ${expenseCount} house expenses, ${transferCount} transfers, ${planCount} planning profiles, ${ticketCount} tickets.`);
}

// ============================================================================
// account_balances — margin/balance figures for taxable accounts, read by the
// Margin Agent (@margin) and @audit's margin section. Raw Supabase table, so
// clearDatabase() doesn't touch it: self-clears here, then derives figures from
// the freshly seeded Account.balance. Deterministic per-account pseudo-randomness
// (hashtext of the account id): ~35% margined, ~15% of those in an active call.
// Retirement accounts get NO row — "no margin data on file" is correct for IRAs.
// Keep in sync with supabase/migrations/0003_backfill_account_balances.sql.
// ============================================================================
async function seedAccountBalances() {
  console.log("Seeding account balances (margin data)...");
  const dp = createDirectPool();

  await dp.query(`DELETE FROM account_balances`);
  const { rowCount } = await dp.query(`
    INSERT INTO account_balances (
      id, account_id, total_equity, liquidating_equity, long_market_value, short_market_value,
      cash_management_balance, credit_debit_balance, total_house_requirement, house_surplus,
      finra_surplus, total_sma, today_federal_call, foreign_ccy_house_req,
      funds_available_to_trade, funds_available_to_withdraw, day_trade_buying_power,
      funds_unavailable, funds_due, cash, created_at, updated_at
    )
    SELECT
      gen_random_uuid(),
      s.id,
      round(s.eq, 2),
      round(s.eq * 0.995, 2),
      round(s.lmv, 2),
      0,
      round(s.cash, 2),
      round(CASE WHEN s.margined THEN -s.debit ELSE s.cash END, 2),
      round(s.house_req, 2),
      round(s.eq - s.house_req, 2),
      round(CASE WHEN s.margined THEN s.eq - 0.25 * s.lmv ELSE s.eq END, 2),
      round(CASE WHEN s.margined THEN s.eq * (0.05 + s.r2 * 0.20) ELSE 0 END, 2),
      round(s.fed_call, 2),
      0,
      round(CASE WHEN s.margined THEN GREATEST(s.eq - s.house_req, 0) * 2 ELSE s.cash END, 2),
      round(CASE WHEN s.margined THEN GREATEST(s.eq - s.house_req, 0) * 0.5 ELSE s.cash END, 2),
      round(CASE WHEN s.margined THEN GREATEST(s.eq - s.house_req, 0) * 4 ELSE 0 END, 2),
      0,
      round(s.fed_call, 2),
      round(s.cash, 2),
      now(), now()
    FROM (
      SELECT b.*,
        CASE WHEN b.in_call THEN b.eq * (1.005 + b.r2 * 0.03)
             WHEN b.margined THEN 0.30 * b.lmv
             ELSE 0 END AS house_req,
        CASE WHEN b.in_call THEN b.eq * (0.01 + b.r2 * 0.05) ELSE 0 END AS fed_call
      FROM (
        SELECT a2.*,
          CASE WHEN a2.margined THEN a2.eq + a2.debit ELSE a2.eq - a2.cash END AS lmv
        FROM (
          SELECT a1.*,
            CASE WHEN a1.margined THEN a1.eq * (0.10 + a1.r2 * 0.45) ELSE 0 END AS debit,
            CASE WHEN a1.margined THEN 0 ELSE a1.eq * (0.02 + a1.r2 * 0.08) END AS cash,
            (a1.margined AND a1.r3 < 0.15) AS in_call
          FROM (
            SELECT a.id,
              GREATEST(COALESCE(a.balance, 0)::numeric, 10000) AS eq,
              (abs(hashtext(a.id || 'm2')) % 1000) / 1000.0 AS r2,
              (abs(hashtext(a.id || 'm3')) % 1000) / 1000.0 AS r3,
              ((abs(hashtext(a.id || 'm1')) % 1000) / 1000.0) < 0.35 AS margined
            FROM "Account" a
            WHERE lower(a."accountType"::text) IN ('individual', 'joint', 'trust')
          ) a1
        ) a2
      ) b
    ) s
  `);

  await dp.end();
  console.log(`  ${rowCount ?? 0} account balance rows created.`);
}

async function main() {
  console.log("Starting database seed...\n");
  const numCustodians = SEED_CUSTODIANS.length;
  const perCustodianAccounts = TOTAL_ADVISORS * CONFIG.householdsPerAdvisor * CONFIG.accountsPerHousehold;
  const totalAccounts = perCustodianAccounts * numCustodians;
  console.log("Target counts:");
  console.log(`  Firms: ${CONFIG.firmCount} (${CONFIG.advisorsPerFirm} advisors + ${CONFIG.clientAssociatesPerFirm} client associates)`);
  console.log(`  Advisors: ${TOTAL_ADVISORS}`);
  console.log(`  Custodians: ${numCustodians} (${SEED_CUSTODIANS.map((c) => CUSTODIAN_NAME[c]).join(", ")})`);
  console.log(`  Households: ${TOTAL_ADVISORS * CONFIG.householdsPerAdvisor * numCustodians} (${CONFIG.householdsPerAdvisor}/advisor × ${numCustodians} custodians)`);
  console.log(`  Accounts: ${totalAccounts} (${perCustodianAccounts}/custodian, ${CONFIG.accountsPerHousehold}/household)`);
  console.log(`  Holdings: ${totalAccounts * CONFIG.holdingsPerAccount} (${CONFIG.holdingsPerAccount}/account)`);
  console.log(`  Transactions: ${totalAccounts * CONFIG.transactionsPerAccount} (${CONFIG.transactionsPerAccount}/account)\n`);

  const startTime = Date.now();

  try {
    await clearDatabase();

    await seedSecurities();
    await reconnect();

    const operationsUserIds = await seedOperationsStaff();
    const { advisorIds } = await seedAdvisors();
    await reconnect();

    const portfolioIds = await seedPortfolios(advisorIds);
    await reconnect();

    const accountIds: string[] = [];
    for (const custodian of SEED_CUSTODIANS) {
      const ids = await seedAccountsPerAdvisor(advisorIds, portfolioIds, custodian);
      accountIds.push(...ids);
      await reconnect();
    }

    await seedHoldings(accountIds);
    await reconnect();

    await seedTransactions(accountIds);
    await reconnect();

    await seedTransferTransactions(accountIds);
    await reconnect();

    await seedRetirementData(accountIds);
    await reconnect();

    await seedPerformanceRecords(accountIds);
    await reconnect();

    await seedAccountBalances();
    await reconnect();

    await seedCalendarEvents();

    await seedAgents();

    // The fixed demo identity every request runs as (src/lib/auth.ts). Survives reseeds.
    await prisma.user.upsert({
      where: { id: "user_demo" },
      update: {},
      create: { id: "user_demo", name: "Demo User", email: "demo.advisor@example.com", role: UserRole.ADVISOR },
    });

    await seedFeatureTables();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\nSeeding completed in ${elapsed}s.`);

    console.log("\n=== SEED SUMMARY ===");
    console.log(`Firms: ${CONFIG.firmCount} (Granite Falls Wealth)`);
    console.log(`Advisors: ${advisorIds.length} (${CONFIG.advisorsPerFirm} advisors + ${CONFIG.clientAssociatesPerFirm} client associates = 10 employees)`);
    console.log(`Rep Codes: ${CONFIG.advisorsPerFirm} (one per advisor)`);
    console.log(`Households: ${TOTAL_ADVISORS * CONFIG.householdsPerAdvisor * SEED_CUSTODIANS.length} (${CONFIG.householdsPerAdvisor}/advisor × ${SEED_CUSTODIANS.length} custodians, 5 accounts each)`);
    console.log(`Accounts: ${accountIds.length} (80% managed, 20% non-managed)`);
    console.log(`Holdings: ~${accountIds.length * CONFIG.holdingsPerAccount} (10/account)`);
    console.log(`Transactions: ~${accountIds.length * CONFIG.transactionsPerAccount} (25/account, buy/sell/dividend/interest/fee)`);
    console.log(`Transfer transactions: ~${Math.round(accountIds.length * 0.75)} (transfer_in/transfer_out, seeds Transfers page)`);
    console.log(`Performance records: ~${accountIds.length * 3} (3/account)`);
    console.log(`Calendar events: 8 meeting events linked to real clients (seeds Meeting Prep page)`);
    console.log(`Operations staff: ${operationsUserIds.length}`);
    console.log(`Custodians: ${SEED_CUSTODIANS.map((c) => CUSTODIAN_NAME[c]).join(", ")} (~${perCustodianAccounts} accounts each; managed flag = is_managed column, not the account-number prefix)`);
    console.log(`Feature tables: advisory reviews, sales credits, transfers, participants, planning profiles & tickets — all linked to real accounts`);

  } catch (error) {
    console.error("Error during seeding:", error);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    try { await prisma.$disconnect(); } catch { }
    try { await pool.end(); } catch { }
  });
