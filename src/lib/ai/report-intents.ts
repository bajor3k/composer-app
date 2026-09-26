// Query vocabulary for the Composer agent's run_report tool.
//
// Generated from the intent catalogue that previously lived only inside the legacy
// provider's system prompt. It ships from code rather than the Foundry portal so the enum can
// never drift from what `executeQuery` implements — verified in sync at extraction:
// 47 usable intents, with "general" and "dynamic_query" excluded.
//
// dynamic_query executes model-authored SQL through the execute_readonly_query RPC
// behind only a keyword blocklist. Its documented use case was calendar_events, which
// nothing in chat depends on. If a calendar need appears, add a real intent for it.

export const REPORT_INTENTS = [
  "accounts_list",
  "account_detail",
  "accounts_summary",
  "holdings",
  "top_holdings",
  "holdings_by_symbol",
  "transactions",
  "cash_analysis",
  "search_clients",
  "rep_codes",
  "crm_contacts",
  "advisor_directory",
  "crm_client_contacts",
  "firm_aum",
  "advisory_fees",
  "transfers",
  "account_applications",
  "sales_credits",
  "outside_business",
  "account_trade_counts",
  "concentration_risk",
  "daily_recap",
  "pending_actions",
  "margin_check",
  "tax_1099_review",
  "cost_basis_audit",
  "wash_sale_check",
  "fee_review",
  "cash_drag",
  "dividend_summary",
  "ira_contribution_check",
  "suitability_review",
  "stale_accounts",
  "client_birthdays",
  "client_directory",
  "household_summary",
  "kyc_gaps",
  "account_performance",
  "underperformers",
  "revenue_by_rep",
  "firm_expenses",
  "pt8_conversion",
  "sector_exposure",
  "asset_class_breakdown",
  "large_positions",
  "unrealized_gains_losses",
  "transfer_pipeline",
  "application_pipeline",
  "new_accounts"
] as const;

export type ReportIntent = (typeof REPORT_INTENTS)[number];

const INTENT_SET: ReadonlySet<string> = new Set(REPORT_INTENTS);

export function isReportIntent(value: unknown): value is ReportIntent {
  return typeof value === "string" && INTENT_SET.has(value);
}

/** Per-intent guidance handed to the model as the `intent` parameter description. */
export const REPORT_INTENT_GUIDE = `- "accounts_list" - List all accounts, params: { limit?: number, search?: string, managedOnly?: boolean (set true to exclude non-managed accounts (is_managed=false), e.g. for advisory fee queries), accountType?: string (filter by account type: "ira", "individual", "joint", "trust", "roth_ira" — values are lowercase), custodian?: string (filter by custodian name e.g. "Pershing", "Schwab", "Fidelity"), repCode?: string (filter by rep code e.g. "AK1", "GF1", "ABC"), minValue?: number (only accounts worth at least this much, e.g. 500000 for "trusts over $500K"), maxValue?: number (only accounts worth at most this much) }
- "account_detail" - Get account details, params: { accountNumber: string }
- "accounts_summary" - Get total account count and AUM summary stats (use for "how many accounts", "total AUM", etc.), params: {}
- "holdings" - Get holdings for an account, params: { accountNumber: string }
- "top_holdings" - Get top holdings across all accounts, params: { limit?: number }
- "holdings_by_symbol" - Find which accounts hold a specific stock/security by ticker symbol (use for "which accounts hold AAPL", "who owns META", etc.), params: { symbol: string, limit?: number }
- "transactions" - Get recent transactions, params: { accountNumber?: string, limit?: number, type?: string, types?: string[] (use for multiple types e.g. ["buy","sell"]), dateFrom?: string (YYYY-MM-DD), dateTo?: string (YYYY-MM-DD) }. IMPORTANT: When the user says "trades" or "trading activity", ALWAYS set types to ["buy","sell"]. Trades are NOT transfers, contributions, or distributions — only buys and sells.
- "cash_analysis" - Get accounts by cash/liquidity (use for "high cash", "low cash", "most cash", "accounts with more than X% cash"), params: { minPct?: number, maxPct?: number, limit?: number, sort?: "liquid_pct" (default, by percentage) | "total_liquid" (by dollar amount of cash+MMF) | "cash_balance" (by cash only) }
- "search_clients" - Search for clients by name, account name, or household name, params: { query: string }
- "rep_codes" - List all rep codes with their associated firm names and account counts (use for "show rep codes", "list all rep codes", "what are the rep codes"), params: { search?: string }
- "crm_client_contacts" - Contact sheet for CLIENTS: name, phone, email, address, household, rep code. This is what "CRM contacts", "my contacts" or "contact list" means to an advisor — the people they serve. params: { search?: string, repCode?: string, limit?: number }
- "advisor_directory" - The firm's INTERNAL advisor/staff roster (~10 people). Only for "show me all advisors", "who works at firm X", "list our staff". Never use this for a client or book-of-business request. params: { search?: string, limit?: number }
- "crm_contacts" - Deprecated alias of "advisor_directory"; prefer that name. params: { search?: string, limit?: number }
- "firm_aum" - Get AUM breakdown by firm (use for "AUM per firm", "AUM by firm", "which firm has the most assets", "firm breakdown"), params: { search?: string }
- "advisory_fees" - Get managed accounts with their advisory fee rates and calculated annual fees (use for "highest advisory fees", "fee rates", "what are clients paying", "advisory fee breakdown"). Returns actual fee amounts calculated from AUM × fee rate. params: { limit?: number, sort?: "fee" (by annual fee amount) | "rate" (by fee rate) | "aum" (by account value) }
- "transfers" - Get transfers/asset movements (use for "pending transfers", "recent transfers", "ACAT transfers", "wire transfers"), params: { status?: string, type?: string, limit?: number }
- "account_applications" - Get new account opening applications (use for "new account applications", "pending applications", "submitted applications"), params: { status?: string, limit?: number }
- "sales_credits" - Get sales credits from fund companies (use for "sales credits", "12b-1 fees", "revenue sharing"), params: { status?: string, creditType?: string, limit?: number }
- "outside_business" - Get outside business activities (use for "OBAs", "outside business", "insurance income", "consulting income"), params: { approvalStatus?: string, limit?: number }
- "account_trade_counts" - Get accounts ranked by number of trades placed (use for "which account has the most/least trades", "how many trades per account", "accounts by trade volume", "list accounts with trade count", "which ABC account traded the least", "trade counts for rep code AK1"). Returns each account with its trade_count and rep_code. params: { managedOnly?: boolean (set true to only include managed/ABC accounts), sort?: "most" (default, highest first) | "least" (lowest first), limit?: number, dateFrom?: string (YYYY-MM-DD), dateTo?: string (YYYY-MM-DD), types?: string[] (defaults to ["buy","sell"]), repCode?: string (filter to accounts under this rep code, e.g. "AK1") }
- "concentration_risk" - Find accounts with the highest single-position concentration (use for "concentration risk", "overweight positions", "most concentrated accounts", "which accounts are too heavy in one stock"). Returns each account's largest holding as % of total. params: { limit?: number }
- "daily_recap" - Get an end-of-day or daily operations summary (use for "daily recap", "EOD summary", "end of business recap", "what happened today", "today's summary"). Aggregates transactions, pending transfers, and pending applications for the day. params: { date?: string (YYYY-MM-DD, defaults to today) }
- "pending_actions" - Get all items requiring attention across the platform (use for "what needs attention", "pending items", "action items", "what's outstanding", "to-do list"). Returns pending transfers and applications awaiting review. params: {}
- "margin_check" - Check margin health for one or more accounts (use for "margin check", "margin call risk", "margin review", "is this account in a margin call"). Analyzes margin utilization, house surplus, SMA, federal calls, and buying power. params: { accountNumber: string } — accountNumber can be a specific account number, "ALL" to review all accounts, or a rep code (e.g. "ABC") to review all accounts under that rep
- "tax_1099_review" - Reconcile 1099 reportable transactions for one or more accounts (use for "1099 review", "1099 reconciliation", "tax review", "check the 1099"). Aggregates taxable transactions (sells, dividends, interest, fees) by type for the tax year so the advisor can compare against the 1099. params: { accountNumber: string, year?: number (defaults to current year) } — accountNumber can be a specific account number, "ALL", or a rep code
- "cost_basis_audit" - Audit cost basis for holdings in one or more accounts (use for "cost basis check", "cost basis audit", "cost basis issues", "bad cost basis"). Flags holdings with missing/zero/negative cost basis or unrealistic gain/loss percentages. params: { accountNumber: string } — accountNumber can be a specific account number, "ALL", or a rep code
- "wash_sale_check" - Detect potential wash sales for one or more accounts (use for "wash sale", "wash sales", "30 day rule", "repurchase after loss"). Scans for sells at a loss followed by buys of the same symbol within 30 days. params: { accountNumber: string, year?: number (defaults to current year) } — accountNumber can be a specific account number, "ALL", or a rep code
- "fee_review" - Audit advisory fees for one or more accounts (use for "fee review", "fee audit", "are we overcharging", "fee check", "billing review on account"). Compares actual fees charged vs expected based on balance and fee rate. params: { accountNumber: string } — accountNumber can be a specific account number, "ALL", or a rep code
- "cash_drag" - Analyze uninvested cash drag for one or more accounts (use for "cash drag", "too much cash", "uninvested cash", "cash sitting idle on account"). Calculates cash weight, compares to model target, estimates opportunity cost. params: { accountNumber: string } — accountNumber can be a specific account number, "ALL", or a rep code
- "dividend_summary" - Dividend income breakdown for one or more accounts (use for "dividend summary", "dividend income", "how much in dividends", "dividend yield for account"). Aggregates dividends by symbol with YTD and trailing 12-month totals. params: { accountNumber: string } — accountNumber can be a specific account number, "ALL", a rep code, or a household name (e.g. "Schneider Household"). When the user says "this household" or "the entire household", pass the household name.
- "ira_contribution_check" - Find IRA and Roth IRA accounts that have NOT maxed out their 2026 contributions (use for "which IRAs haven't maxed out", "IRA contributions", "accounts not maxed", "contribution room", "who can still contribute"). Shows contribution limit, amount contributed, remaining room, and eligibility status. 2026 limits: $7,500 (under 50), $8,500 (50+ catch-up). Roth IRA income limit: $165,000. params: { accountNumber?: string } — optional, can be a specific account number, "ALL", or a rep code. Defaults to all IRA accounts.
- "suitability_review" - Flag managed accounts where holdings risk profile may not align with client risk tolerance (use for "suitability review", "are any accounts unsuitable", "risk mismatch"). params: { repCode?: string, limit?: number }
- "stale_accounts" - Find managed accounts with no trading activity in 90+ days (use for "stale accounts", "inactive accounts", "accounts with no trades"). params: { daysSinceLastTrade?: number (default 90), repCode?: string, limit?: number }
- "client_birthdays" - Upcoming client birthdays with age milestone flags like 59½, 65, 73 RMD (use for "upcoming birthdays", "client birthdays this month"). params: { daysAhead?: number (default 30), repCode?: string }
- "client_directory" - Full client listing with demographics, risk profile, income, net worth (use for "client list", "all clients", "client directory"). params: { repCode?: string, riskTolerance?: string, limit?: number }
- "household_summary" - Household-level AUM, account count, cash totals (use for "household summary", "AUM by household", "household breakdown", "which household has the most cash", "household cash"). params: { repCode?: string, minAum?: number, limit?: number, sort?: "total_aum" (default) | "cash" (by total cash dollars) | "cash_pct" (by cash percentage) | "accounts" (by account count) }
- "kyc_gaps" - Clients missing required KYC fields like risk tolerance, income, net worth (use for "KYC gaps", "missing client data", "incomplete profiles"). params: { repCode?: string, limit?: number }
- "account_performance" - TWR/MWR returns by account with benchmark comparison and alpha (use for "account performance", "returns", "how did accounts perform"). params: { accountNumber?: string, period?: string, repCode?: string, limit?: number }
- "underperformers" - Accounts trailing their benchmark over the most recent period (use for "underperformers", "which accounts are lagging", "negative alpha"). params: { minNegativeAlpha?: number, repCode?: string, limit?: number }
- "revenue_by_rep" - Estimated annual advisory revenue per rep code based on AUM and fee rates (use for "revenue by rep", "how much does each rep generate", "advisory revenue"). params: { limit?: number }
- "firm_expenses" - House account expense breakdown by category (use for "firm expenses", "operating costs", "platform fees"). params: { year?: number, month?: number }
- "pt8_conversion" - Non-managed XYZ accounts ranked by AUM showing potential advisory conversion revenue (use for "XYZ conversion opportunity", "non-managed accounts to convert", "brokerage to advisory"). params: { minAum?: number, limit?: number }
- "sector_exposure" - Aggregate sector allocation across holdings using Security master data (use for "sector exposure", "sector breakdown", "which sectors are we in"). params: { accountNumber?: string, repCode?: string }
- "asset_class_breakdown" - Firm-wide or per-account asset class allocation: equity, fixed income, cash, alternatives (use for "asset class breakdown", "allocation breakdown", "how much in equities"). params: { accountNumber?: string, repCode?: string }
- "large_positions" - Individual positions exceeding a dollar threshold (use for "large positions", "big holdings", "positions over $500K"). params: { minValue?: number (default 500000), limit?: number }
- "unrealized_gains_losses" - Holdings ranked by unrealized P&L for tax planning (use for "unrealized gains", "unrealized losses", "tax loss harvesting candidates", "biggest winners/losers"). params: { accountNumber?: string, gainOrLoss?: "gain"/"loss"/"all", repCode?: string, limit?: number }
- "transfer_pipeline" - All in-flight transfers by status stage with aging analysis (use for "transfer pipeline", "where are transfers stuck", "transfer aging"). params: { type?: string, limit?: number }
- "application_pipeline" - New account applications by status stage with time-in-stage tracking (use for "application pipeline", "where are applications stuck", "app status"). params: { custodian?: string, limit?: number }
- "new_accounts" - Recently opened accounts within a date range (use for "new accounts", "accounts opened this month", "recent account openings"). params: { dateFrom?: string, dateTo?: string, repCode?: string, custodian?: string, limit?: number }`;
