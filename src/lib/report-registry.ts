// Shared report catalog — single source of truth for the Reports page and AI chat slash commands

export type ReportParam = {
  key: string;
  label: string;
  type: "text" | "date" | "select";
  placeholder?: string;
  options?: { label: string; value: string }[];
  required?: boolean;
};

export type ReportDefinition = {
  id: string;
  command: string;           // Slash command, e.g. "/accounts"
  label: string;
  // Typed against REPORT_CATEGORIES rather than a bare string: the Report Center
  // renders by iterating that list, so a category outside it makes the report
  // silently invisible in the UI while still being runnable by id.
  category: ReportCategory;
  description: string;
  intent: string;            // QueryIntent intent string
  defaultParams: Record<string, unknown>;
  params?: ReportParam[];    // Optional user-supplied parameters
};

export const REPORT_CATEGORIES = [
  "Accounts",
  "Portfolio",
  "Trading",
  "Operations",
  "Risk",
  "Account Review",
  "Recap",
  "Compliance",
  "Client",
  "Performance",
  "Revenue",
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

const accountInput: ReportParam = {
  key: "accountNumber",
  label: "Account",
  type: "text",
  placeholder: "Account #, rep code, or ALL",
  required: true,
};

/** Account-value floor. "Trusts over $500K" is a routine ask and needed a home. */
const minValueParam: ReportParam = {
  key: "minValue",
  label: "Min Account Value",
  type: "text",
  placeholder: "e.g. 500000 — leave blank for all",
};

export const REPORT_CATALOG: ReportDefinition[] = [
  // ── Accounts ──────────────────────────────────────────────────
  {
    id: "accounts",
    command: "/accounts",
    label: "All Accounts",
    category: "Accounts",
    description: "List all accounts",
    intent: "accounts_list",
    defaultParams: {},
    params: [
      {
        key: "repCodes",
        label: "Scope",
        type: "text",
        placeholder: "Rep codes (e.g. LB1, NC2)",
      },
      minValueParam,
    ],
  },
  {
    id: "trusts",
    command: "/trusts",
    label: "Trust Accounts",
    category: "Accounts",
    description: "Show all trust accounts, optionally above a value threshold",
    intent: "accounts_list",
    defaultParams: { accountType: "trust" },
    params: [minValueParam],
  },
  {
    id: "iras",
    command: "/iras",
    label: "IRA Accounts",
    category: "Accounts",
    description: "Show all IRA accounts",
    intent: "accounts_list",
    defaultParams: { accountType: "ira" },
  },
  {
    id: "contributions",
    command: "/contributions",
    label: "IRA Contributions",
    category: "Accounts",
    description: "IRAs not maxed out",
    intent: "ira_contribution_check",
    defaultParams: {},
  },

  // ── Portfolio ─────────────────────────────────────────────────
  {
    id: "top-holdings",
    command: "/top-holdings",
    label: "Top Holdings",
    category: "Portfolio",
    description: "Largest positions by value",
    intent: "top_holdings",
    defaultParams: { limit: 20 },
  },
  {
    id: "holding",
    command: "/holding",
    label: "Find Ticker",
    category: "Portfolio",
    description: "Which accounts hold a ticker",
    intent: "holdings_by_symbol",
    defaultParams: {},
    params: [
      { key: "symbol", label: "Ticker", type: "text", placeholder: "Enter ticker symbol...", required: true },
    ],
  },
  {
    id: "cash",
    command: "/cash",
    label: "Cash Analysis",
    category: "Portfolio",
    description: "Accounts ranked by cash %",
    intent: "cash_analysis",
    defaultParams: {},
  },

  // ── Trading ───────────────────────────────────────────────────
  {
    id: "trades",
    command: "/trades",
    label: "Recent Trades",
    category: "Trading",
    description: "Latest buy and sell orders",
    intent: "transactions",
    defaultParams: { types: ["buy", "sell"], limit: 100 },
    params: [
      { key: "dateFrom", label: "From", type: "date" },
      { key: "dateTo", label: "To", type: "date" },
    ],
  },
  {
    id: "dividends",
    command: "/dividends",
    label: "Recent Dividends",
    category: "Trading",
    description: "Latest dividend payments",
    intent: "transactions",
    defaultParams: { types: ["dividend"], limit: 100 },
    params: [
      { key: "dateFrom", label: "From", type: "date" },
      { key: "dateTo", label: "To", type: "date" },
    ],
  },
  {
    id: "trade-counts",
    command: "/trade-counts",
    label: "Trade Volume",
    category: "Trading",
    description: "Accounts by # of trades",
    intent: "account_trade_counts",
    defaultParams: { sort: "most" },
    params: [
      { key: "dateFrom", label: "From", type: "date" },
      { key: "dateTo", label: "To", type: "date" },
    ],
  },

  // ── Operations ────────────────────────────────────────────────
  {
    id: "transfers",
    command: "/transfers",
    label: "Pending Transfers",
    category: "Operations",
    description: "Transfers awaiting action",
    intent: "transfers",
    defaultParams: { status: "pending" },
  },
  {
    id: "fees",
    command: "/fees",
    label: "Advisory Fees",
    category: "Operations",
    description: "Highest advisory fees",
    intent: "advisory_fees",
    defaultParams: { sort: "fee" },
  },
  {
    id: "applications",
    command: "/applications",
    label: "New Account Apps",
    category: "Operations",
    description: "Account applications",
    intent: "account_applications",
    defaultParams: {},
  },

  // ── Risk ──────────────────────────────────────────────────────
  {
    id: "concentration",
    command: "/concentration",
    label: "Concentration Risk",
    category: "Risk",
    description: "Accounts heavy in one position",
    intent: "concentration_risk",
    defaultParams: {},
  },
  {
    id: "low-cash",
    command: "/low-cash",
    label: "Low Cash Alerts",
    category: "Risk",
    description: "Accounts under 2% cash",
    intent: "cash_analysis",
    defaultParams: { maxPct: 2 },
  },

  // ── Account Review ────────────────────────────────────────────
  {
    id: "margin-check",
    command: "/margin-check",
    label: "Margin Review",
    category: "Account Review",
    description: "Check margin health & call risk",
    intent: "margin_check",
    defaultParams: {},
    params: [accountInput],
  },
  {
    id: "1099-review",
    command: "/1099-review",
    label: "1099 Reconciliation",
    category: "Account Review",
    description: "Reconcile 1099 vs transactions",
    intent: "tax_1099_review",
    defaultParams: {},
    params: [accountInput],
  },
  {
    id: "cost-basis",
    command: "/cost-basis",
    label: "Cost Basis Audit",
    category: "Account Review",
    description: "Flag cost basis issues",
    intent: "cost_basis_audit",
    defaultParams: {},
    params: [accountInput],
  },
  {
    id: "wash-sales",
    command: "/wash-sales",
    label: "Wash Sale Detector",
    category: "Account Review",
    description: "Detect potential wash sales",
    intent: "wash_sale_check",
    defaultParams: {},
    params: [accountInput],
  },
  {
    id: "fee-review",
    command: "/fee-review",
    label: "Fee Analysis",
    category: "Account Review",
    description: "Audit advisory fees & expenses",
    intent: "fee_review",
    defaultParams: {},
    params: [accountInput],
  },
  {
    id: "cash-drag",
    command: "/cash-drag",
    label: "Cash Drag",
    category: "Account Review",
    description: "Analyze uninvested cash impact",
    intent: "cash_drag",
    defaultParams: {},
    params: [accountInput],
  },
  {
    id: "div-summary",
    command: "/div-summary",
    label: "Dividend Summary",
    category: "Account Review",
    description: "Dividend income breakdown",
    intent: "dividend_summary",
    defaultParams: {},
    params: [accountInput],
  },

  // ── Recap ─────────────────────────────────────────────────────
  {
    id: "recap",
    command: "/recap",
    label: "Daily Recap",
    category: "Recap",
    description: "End-of-day summary",
    intent: "daily_recap",
    defaultParams: {},
  },
  {
    id: "pending",
    command: "/pending",
    label: "Pending Actions",
    category: "Recap",
    description: "Items needing attention",
    intent: "pending_actions",
    defaultParams: {},
  },

  // ── Compliance ──────────────────────────────────────────────
  {
    id: "sales-credits",
    command: "/sales-credits",
    label: "Sales Credits",
    category: "Compliance",
    description: "12b-1 fees, revenue sharing, and trail commissions from fund companies",
    intent: "sales_credits",
    defaultParams: {},
  },
  {
    id: "oba",
    command: "/oba",
    label: "Outside Business Activities",
    category: "Compliance",
    description: "OBA disclosures for FINRA reporting",
    intent: "outside_business",
    defaultParams: {},
  },
  {
    id: "suitability",
    command: "/suitability",
    label: "Suitability Review",
    category: "Compliance",
    description: "Accounts where holdings may not match client risk tolerance",
    intent: "suitability_review",
    defaultParams: {},
    params: [
      { key: "repCode", label: "Rep Code", type: "text", placeholder: "Rep code or leave blank for all" },
    ],
  },
  {
    id: "stale-accounts",
    command: "/stale-accounts",
    label: "Stale Accounts",
    category: "Compliance",
    description: "Managed accounts with no trades in 90+ days",
    intent: "stale_accounts",
    defaultParams: { daysSinceLastTrade: 90 },
    params: [
      { key: "repCode", label: "Rep Code", type: "text", placeholder: "Rep code or leave blank for all" },
    ],
  },

  // ── Client ──────────────────────────────────────────────────
  {
    id: "birthdays",
    command: "/birthdays",
    label: "Upcoming Birthdays",
    category: "Client",
    description: "Client birthdays in the next 30 days with milestone flags",
    intent: "client_birthdays",
    defaultParams: { daysAhead: 30 },
  },
  {
    id: "clients",
    command: "/clients",
    label: "Client Directory",
    category: "Client",
    description: "Full client listing with demographics and risk profile",
    intent: "client_directory",
    defaultParams: {},
    params: [
      { key: "repCode", label: "Rep Code", type: "text", placeholder: "Rep code or leave blank for all" },
    ],
  },
  {
    id: "households",
    command: "/households",
    label: "Household Summary",
    category: "Client",
    description: "Household-level AUM, account count, and cash totals",
    intent: "household_summary",
    defaultParams: {},
    params: [
      { key: "repCode", label: "Rep Code", type: "text", placeholder: "Rep code or leave blank for all" },
    ],
  },
  {
    id: "kyc-gaps",
    command: "/kyc-gaps",
    label: "KYC Data Gaps",
    category: "Client",
    description: "Clients missing risk tolerance, income, or other required fields",
    intent: "kyc_gaps",
    defaultParams: {},
  },
  {
    id: "contacts",
    command: "/contacts",
    label: "Client Contacts",
    category: "Client",
    description: "Client contact sheet — phone, email and address for your book",
    intent: "crm_client_contacts",
    defaultParams: {},
    params: [
      { key: "repCode", label: "Rep Code", type: "text", placeholder: "Rep code or leave blank for all" },
    ],
  },
  {
    // The firm's own advisor/staff roster. Previously this was what /contacts
    // returned, filed under "Client" and labelled "CRM Contacts" — so an
    // advisor pulling their book got ten colleagues instead of 360 clients.
    id: "advisors",
    command: "/advisors",
    label: "Advisor Directory",
    category: "Operations",
    description: "Internal advisor and staff roster — not clients",
    intent: "advisor_directory",
    defaultParams: {},
  },

  // ── Performance ─────────────────────────────────────────────
  {
    id: "performance",
    command: "/performance",
    label: "Account Performance",
    category: "Performance",
    description: "TWR/MWR returns with benchmark comparison and alpha",
    intent: "account_performance",
    defaultParams: {},
    params: [
      { key: "accountNumber", label: "Account", type: "text", placeholder: "Account # or leave blank for all" },
    ],
  },
  {
    id: "underperformers",
    command: "/underperformers",
    label: "Underperforming Accounts",
    category: "Performance",
    description: "Accounts trailing their benchmark",
    intent: "underperformers",
    defaultParams: {},
  },
  {
    id: "firm-aum",
    command: "/firm-aum",
    label: "Firm AUM",
    category: "Performance",
    description: "AUM breakdown by firm with account counts",
    intent: "firm_aum",
    defaultParams: {},
  },
  {
    id: "rep-codes",
    command: "/rep-codes",
    label: "Rep Codes",
    category: "Performance",
    description: "All rep codes with firm names and account counts",
    intent: "rep_codes",
    defaultParams: {},
  },

  // ── Revenue ─────────────────────────────────────────────────
  {
    id: "revenue-by-rep",
    command: "/revenue-by-rep",
    label: "Revenue by Rep",
    category: "Revenue",
    description: "Estimated annual advisory revenue per rep code",
    intent: "revenue_by_rep",
    defaultParams: {},
  },
  {
    id: "expenses",
    command: "/expenses",
    label: "Firm Expenses",
    category: "Revenue",
    description: "House account expense breakdown by category",
    intent: "firm_expenses",
    defaultParams: {},
  },
  {
    id: "pt8-opportunity",
    command: "/pt8-opportunity",
    label: "XYZ Conversion Potential",
    category: "Revenue",
    description: "Non-managed accounts ranked by AUM for advisory conversion",
    intent: "pt8_conversion",
    defaultParams: {},
  },

  // ── Risk (additional) ──────────────────────────────────────
  {
    id: "sector-exposure",
    command: "/sector-exposure",
    label: "Sector Exposure",
    category: "Risk",
    description: "Aggregate sector allocation across all holdings",
    intent: "sector_exposure",
    defaultParams: {},
    params: [
      { key: "accountNumber", label: "Account", type: "text", placeholder: "Account # or leave blank for all" },
    ],
  },
  {
    id: "asset-breakdown",
    command: "/asset-breakdown",
    label: "Asset Class Breakdown",
    category: "Risk",
    description: "Equity, fixed income, cash, and alternatives allocation",
    intent: "asset_class_breakdown",
    defaultParams: {},
    params: [
      { key: "accountNumber", label: "Account", type: "text", placeholder: "Account # or leave blank for all" },
    ],
  },
  {
    id: "large-positions",
    command: "/large-positions",
    label: "Large Position Alerts",
    category: "Risk",
    description: "Positions exceeding a dollar threshold",
    intent: "large_positions",
    defaultParams: { minValue: 500000 },
  },
  {
    id: "unrealized-gl",
    command: "/unrealized-gl",
    label: "Unrealized Gains/Losses",
    category: "Risk",
    description: "Holdings ranked by unrealized P&L for tax planning",
    intent: "unrealized_gains_losses",
    defaultParams: {},
    params: [
      { key: "accountNumber", label: "Account", type: "text", placeholder: "Account # or leave blank for all" },
    ],
  },

  // ── Operations (additional) ─────────────────────────────────
  {
    id: "transfer-pipeline",
    command: "/transfer-pipeline",
    label: "Transfer Pipeline",
    category: "Operations",
    description: "All in-flight transfers by status stage with aging",
    intent: "transfer_pipeline",
    defaultParams: {},
  },
  {
    id: "app-pipeline",
    command: "/app-pipeline",
    label: "Application Pipeline",
    category: "Operations",
    description: "New account applications by status with time-in-stage tracking",
    intent: "application_pipeline",
    defaultParams: {},
  },

  // ── Accounts (additional) ──────────────────────────────────
  {
    id: "new-accounts",
    command: "/new-accounts",
    label: "New Accounts",
    category: "Accounts",
    description: "Recently opened accounts with opening balance details",
    intent: "new_accounts",
    defaultParams: {},
    params: [
      { key: "dateFrom", label: "From", type: "date" },
      { key: "dateTo", label: "To", type: "date" },
      { key: "repCode", label: "Rep Code", type: "text", placeholder: "Rep code or leave blank for all" },
    ],
  },
];

export function getReportById(id: string): ReportDefinition | undefined {
  return REPORT_CATALOG.find((r) => r.id === id);
}

export function getReportsByCategory(category: string): ReportDefinition[] {
  return REPORT_CATALOG.filter((r) => r.category === category);
}
