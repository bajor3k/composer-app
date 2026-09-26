import { createClient } from "@supabase/supabase-js";
import { sanitizePostgrestSearch } from "@/lib/sanitize";

// Server-side Supabase client for API routes
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export type QueryIntent =
  | { intent: "accounts_list"; params: { limit?: number; search?: string; managedOnly?: boolean; accountType?: string; custodian?: string; repCode?: string; repCodes?: string; minValue?: number; maxValue?: number } }
  | { intent: "account_detail"; params: { accountNumber: string } }
  | { intent: "accounts_summary"; params: Record<string, never> }
  | { intent: "holdings"; params: { accountNumber: string } }
  | { intent: "top_holdings"; params: { limit?: number } }
  | { intent: "transactions"; params: { accountNumber?: string; limit?: number; type?: string; types?: string[]; dateFrom?: string; dateTo?: string } }
  | { intent: "holdings_by_symbol"; params: { symbol: string; limit?: number } }
  | { intent: "cash_analysis"; params: { minPct?: number; maxPct?: number; limit?: number; sort?: string } }
  | { intent: "search_clients"; params: { query: string } }
  | { intent: "rep_codes"; params: { search?: string } }
  | { intent: "crm_contacts"; params: { search?: string; limit?: number } }
  | { intent: "advisor_directory"; params: { search?: string; limit?: number } }
  | { intent: "crm_client_contacts"; params: { search?: string; repCode?: string; limit?: number } }
  | { intent: "firm_aum"; params: { search?: string } }
  | { intent: "advisory_fees"; params: { limit?: number; sort?: "fee" | "rate" | "aum" } }
  | { intent: "transfers"; params: { status?: string; type?: string; limit?: number } }
  | { intent: "account_applications"; params: { status?: string; limit?: number } }
  | { intent: "sales_credits"; params: { status?: string; creditType?: string; limit?: number } }
  | { intent: "outside_business"; params: { approvalStatus?: string; limit?: number } }
  | { intent: "account_trade_counts"; params: { managedOnly?: boolean; sort?: "most" | "least"; limit?: number; dateFrom?: string; dateTo?: string; types?: string[]; repCode?: string } }
  | { intent: "concentration_risk"; params: { limit?: number } }
  | { intent: "daily_recap"; params: { date?: string } }
  | { intent: "pending_actions"; params: Record<string, never> }
  | { intent: "margin_check"; params: { accountNumber: string } }
  | { intent: "tax_1099_review"; params: { accountNumber: string; year?: number } }
  | { intent: "cost_basis_audit"; params: { accountNumber: string } }
  | { intent: "wash_sale_check"; params: { accountNumber: string; year?: number } }
  | { intent: "fee_review"; params: { accountNumber: string } }
  | { intent: "cash_drag"; params: { accountNumber: string } }
  | { intent: "dividend_summary"; params: { accountNumber: string } }
  | { intent: "ira_contribution_check"; params: { accountNumber?: string } }
  | { intent: "suitability_review"; params: { repCode?: string; limit?: number } }
  | { intent: "stale_accounts"; params: { daysSinceLastTrade?: number; repCode?: string; limit?: number } }
  | { intent: "client_birthdays"; params: { daysAhead?: number; repCode?: string } }
  | { intent: "client_directory"; params: { repCode?: string; riskTolerance?: string; limit?: number } }
  | { intent: "household_summary"; params: { repCode?: string; minAum?: number; limit?: number; sort?: string } }
  | { intent: "kyc_gaps"; params: { repCode?: string; limit?: number } }
  | { intent: "account_performance"; params: { accountNumber?: string; period?: string; repCode?: string; limit?: number } }
  | { intent: "underperformers"; params: { minNegativeAlpha?: number; repCode?: string; limit?: number } }
  | { intent: "revenue_by_rep"; params: { limit?: number } }
  | { intent: "firm_expenses"; params: { year?: number; month?: number } }
  | { intent: "pt8_conversion"; params: { minAum?: number; limit?: number } }
  | { intent: "sector_exposure"; params: { accountNumber?: string; repCode?: string } }
  | { intent: "asset_class_breakdown"; params: { accountNumber?: string; repCode?: string } }
  | { intent: "large_positions"; params: { minValue?: number; limit?: number } }
  | { intent: "unrealized_gains_losses"; params: { accountNumber?: string; gainOrLoss?: "gain" | "loss" | "all"; repCode?: string; limit?: number } }
  | { intent: "transfer_pipeline"; params: { type?: string; limit?: number } }
  | { intent: "application_pipeline"; params: { custodian?: string; limit?: number } }
  | { intent: "new_accounts"; params: { dateFrom?: string; dateTo?: string; repCode?: string; custodian?: string; limit?: number } }
  | { intent: "dynamic_query"; params: { sql: string; description?: string } }
  | { intent: "general"; params: Record<string, never> };

export interface QueryResult {
  data: Record<string, unknown>[] | Record<string, unknown> | null;
  error?: string;
}

const MAX_RESULTS = 2000;

// Account review intents that support ALL / rep code
const ACCOUNT_REVIEW_INTENTS = new Set([
  "margin_check", "tax_1099_review", "cost_basis_audit", "wash_sale_check",
  "fee_review", "cash_drag", "dividend_summary",
]);

/**
 * Advisor ids for a rep code. Client-scoped reports filter on `Client.advisorId`,
 * so a rep code has to be resolved through Advisor first. Returns an empty array
 * for an unknown code, which callers treat as "no matches" rather than "no filter" —
 * silently widening to the whole firm is how a scoped report leaks the full book.
 */
async function advisorIdsForRepCode(repCode: string): Promise<string[]> {
  const { data } = await supabase.from("Advisor").select("id").ilike("repCode", repCode.trim());
  return (data ?? []).map((a: { id: string }) => a.id);
}

/**
 * Resolves an accountNumber param into a list of target accounts.
 * Supports: "ALL" → all accounts, a rep code → accounts under that rep, or a single account number.
 * Returns { mode, accounts } where accounts have id, account_number, account_name.
 */
type AccountTargets = {
  mode: "all" | "rep_code" | "single";
  repCode?: string;
  accounts: { id: string; account_number: string; account_name: string }[];
};

/**
 * Ceiling on how many accounts an unbatched account-review intent will attempt.
 *
 * These reviews issue two to four Supabase round-trips PER ACCOUNT inside a
 * sequential loop. Against the whole book that is well over a thousand queries:
 * `cash_drag` with accountNumber "ALL" ran past 120 seconds without returning.
 * That matters beyond a slow report — when the agent calls one of these as a
 * tool, the Foundry run sits waiting on the tool output and eventually fails,
 * so the user sees the chat error rather than a slow answer.
 *
 * Failing fast with an actionable message is better than hanging. Intents that
 * have been rewritten to batch their queries opt out with `maxAccounts`.
 */
const REVIEW_SCOPE_LIMIT = 150;

async function resolveAccountTargets(
  accountNumber: string,
  opts: { maxAccounts?: number } = {},
): Promise<AccountTargets> {
  const resolved = await resolveAccountTargetsUnbounded(accountNumber);
  const limit = opts.maxAccounts ?? REVIEW_SCOPE_LIMIT;

  if (resolved.accounts.length > limit) {
    throw new Error(
      `This review runs per account, and that scope resolved to ${resolved.accounts.length} accounts — ` +
        `more than it can process in one pass. Narrow it to a single account number or a rep code ` +
        `(for example GF1) and run it again.`,
    );
  }

  return resolved;
}

async function resolveAccountTargetsUnbounded(
  accountNumber: string
): Promise<AccountTargets> {
  // ALL mode
  if (accountNumber === "ALL") {
    const { data } = await supabase
      .from("portfolio_accounts")
      .select("id, account_number, account_name")
      .order("account_number")
      .limit(MAX_RESULTS);
    return { mode: "all", accounts: data || [] };
  }

  // Check if this is a rep code (look for accounts with this rep_code)
  const { data: repAccounts } = await supabase
    .from("portfolio_accounts")
    .select("id, account_number, account_name")
    .ilike("rep_code", accountNumber)
    .order("account_number")
    .limit(MAX_RESULTS);

  if (repAccounts && repAccounts.length > 0) {
    return { mode: "rep_code", repCode: accountNumber, accounts: repAccounts };
  }

  // Single account lookup
  const { data: single } = await supabase
    .from("portfolio_accounts")
    .select("id, account_number, account_name")
    .eq("account_number", accountNumber)
    .single();

  if (single) {
    return { mode: "single", accounts: [single] };
  }

  // Household name lookup — find all accounts in a household matching the name
  const { data: householdAccounts } = await supabase
    .from("portfolio_accounts")
    .select("id, account_number, account_name")
    .ilike("household_name", `%${accountNumber}%`)
    .order("account_number")
    .limit(MAX_RESULTS);

  if (householdAccounts && householdAccounts.length > 0) {
    return { mode: "all", accounts: householdAccounts };
  }

  return { mode: "single", accounts: [] };
}

export async function executeQuery(query: QueryIntent): Promise<QueryResult> {
  try {
    // Normalize account number to uppercase for case-insensitive matching
    if ("accountNumber" in query.params && query.params.accountNumber) {
      query.params.accountNumber = query.params.accountNumber.toUpperCase();
    }

    switch (query.intent) {
      case "accounts_list": {
        const limit = Math.min(query.params.limit || MAX_RESULTS, MAX_RESULTS);
        let q = supabase
          .from("portfolio_accounts")
          .select("account_number, account_name, custodian, account_type, total_value, cash_balance, model_name, client_name, firm_name, rep_code")
          .order("total_value", { ascending: false })
          .limit(limit);

        if (query.params.search) {
          const s = sanitizePostgrestSearch(query.params.search);
          q = q.or(`account_name.ilike.%${s}%,account_number.ilike.%${s}%,household_name.ilike.%${s}%`);
        }

        if (query.params.managedOnly) {
          q = q.eq("is_managed", true);
        }

        if (query.params.accountType) {
          q = q.eq("account_type", query.params.accountType.toLowerCase());
        }

        if (query.params.custodian) {
          q = q.ilike("custodian", `%${query.params.custodian}%`);
        }

        if (query.params.repCode) {
          q = q.ilike("rep_code", query.params.repCode);
        }

        if (query.params.repCodes) {
          const codes = query.params.repCodes.split(",").map((c) => c.trim()).filter(Boolean);
          if (codes.length > 0) {
            q = q.in("rep_code", codes);
          }
        }

        // Account-value thresholds. "Trusts over $500K", "accounts under $50K"
        // and similar are among the most natural things to ask for, and without
        // these the only honest answer was to list the whole book and tell the
        // user to sort the table themselves.
        const minValue = Number(query.params.minValue);
        if (Number.isFinite(minValue)) {
          q = q.gte("total_value", minValue);
        }

        const maxValue = Number(query.params.maxValue);
        if (Number.isFinite(maxValue)) {
          q = q.lte("total_value", maxValue);
        }

        const { data, error } = await q;
        if (error) return { data: null, error: error.message };
        return { data };
      }

      case "account_detail": {
        const { data, error } = await supabase
          .from("portfolio_accounts")
          .select("*")
          .eq("account_number", query.params.accountNumber)
          .single();

        if (error) return { data: null, error: error.message };
        return { data };
      }

      case "accounts_summary": {
        const { count, error } = await supabase
          .from("portfolio_accounts")
          .select("*", { count: "exact", head: true });

        if (error) return { data: null, error: error.message };

        // Paginate to avoid Supabase 1000-row cap
        let totalAum = 0;
        let totalCash = 0;
        const BATCH = 1000;
        let from = 0;
        while (true) {
          const { data: batch, error: aggError } = await supabase
            .from("portfolio_accounts")
            .select("total_value, cash_balance")
            .range(from, from + BATCH - 1);

          if (aggError) return { data: null, error: aggError.message };
          if (!batch || batch.length === 0) break;

          for (const a of batch) {
            totalAum += Number(a.total_value) || 0;
            totalCash += Number(a.cash_balance) || 0;
          }

          if (batch.length < BATCH) break;
          from += BATCH;
        }

        return {
          data: {
            total_accounts: count,
            total_aum: totalAum,
            total_cash: totalCash,
          },
        };
      }

      case "holdings": {
        // First get the account ID from account number
        const { data: account } = await supabase
          .from("portfolio_accounts")
          .select("id")
          .eq("account_number", query.params.accountNumber)
          .single();

        if (!account) return { data: null, error: "Account not found" };

        const { data, error } = await supabase
          .from("holdings")
          .select("symbol, name, asset_class, quantity, price, market_value, cost_basis, day_change_pct")
          .eq("account_id", account.id)
          .order("market_value", { ascending: false })
          .limit(MAX_RESULTS);

        if (error) return { data: null, error: error.message };
        return { data };
      }

      case "top_holdings": {
        const limit = Math.min(query.params.limit || MAX_RESULTS, MAX_RESULTS);
        const { data, error } = await supabase
          .from("holdings")
          .select("symbol, name, asset_class, quantity, price, market_value")
          .order("market_value", { ascending: false })
          .limit(limit);

        if (error) return { data: null, error: error.message };
        return { data };
      }

      case "holdings_by_symbol": {
        const limit = Math.min(query.params.limit || MAX_RESULTS, MAX_RESULTS);
        const symbol = query.params.symbol.toUpperCase();

        // Get holdings matching the symbol, then look up account info
        const { data: holdings, error } = await supabase
          .from("holdings")
          .select("account_id, symbol, name, quantity, price, market_value, cost_basis")
          .eq("symbol", symbol)
          .order("market_value", { ascending: false })
          .limit(limit);

        if (error) return { data: null, error: error.message };
        if (!holdings || holdings.length === 0) return { data: [], error: undefined };

        // Get account details for each holding
        const accountIds = [...new Set(holdings.map((h) => h.account_id))];
        const { data: accounts } = await supabase
          .from("portfolio_accounts")
          .select("id, account_number, account_name, custodian")
          .in("id", accountIds);

        const accountMap = new Map((accounts || []).map((a) => [a.id, a]));

        const enriched = holdings.map((h) => {
          const acct = accountMap.get(h.account_id);
          return {
            account_number: acct?.account_number,
            account_name: acct?.account_name,
            custodian: acct?.custodian,
            symbol: h.symbol,
            name: h.name,
            quantity: h.quantity,
            price: h.price,
            market_value: h.market_value,
            cost_basis: h.cost_basis,
          };
        });

        return { data: enriched };
      }

      case "transactions": {
        const limit = Math.min(query.params.limit || MAX_RESULTS, MAX_RESULTS);
        let q = supabase
          .from("account_transactions")
          .select("account_id, date, type, symbol, name, quantity, price, amount, description, status")
          .order("date", { ascending: false })
          .limit(limit);

        if (query.params.accountNumber) {
          // Get account ID first
          const { data: account } = await supabase
            .from("portfolio_accounts")
            .select("id")
            .eq("account_number", query.params.accountNumber)
            .single();

          if (account) {
            q = q.eq("account_id", account.id);
          }
        }

        if (query.params.types && query.params.types.length > 0) {
          q = q.in("type", query.params.types);
        } else if (query.params.type) {
          q = q.eq("type", query.params.type);
        }

        if (query.params.dateFrom) {
          q = q.gte("date", query.params.dateFrom);
        }
        if (query.params.dateTo) {
          // If dateTo is a plain date (YYYY-MM-DD), extend to end of day so timestamps within that day are included
          const dateTo = String(query.params.dateTo);
          const endOfDay = dateTo.length === 10 ? `${dateTo}T23:59:59` : dateTo;
          q = q.lte("date", endOfDay);
        }

        const { data, error } = await q;
        if (error) return { data: null, error: error.message };

        // Enrich with account numbers
        if (data && data.length > 0) {
          const accountIds = [...new Set(data.map((t: { account_id: string }) => t.account_id))];
          const { data: accounts } = await supabase
            .from("portfolio_accounts")
            .select("id, account_number, account_name")
            .in("id", accountIds);

          const accountMap = new Map(
            (accounts || []).map((a: { id: string; account_number: string; account_name: string }) => [a.id, a])
          );

          const enriched = data.map((t: { account_id: string }) => {
            const acct = accountMap.get(t.account_id) as { account_number: string; account_name: string } | undefined;
            const { account_id: _, ...rest } = t;
            return {
              ...rest,
              account_number: acct?.account_number || "Unknown",
              account_name: acct?.account_name || "Unknown",
            };
          });

          return { data: enriched };
        }

        return { data };
      }

      case "cash_analysis": {
        const limit = Math.min(query.params.limit || MAX_RESULTS, MAX_RESULTS);
        const sortCol = query.params.sort === "total_liquid" ? "total_liquid"
          : query.params.sort === "cash_balance" ? "cash_balance"
          : "liquid_pct";
        let q = supabase
          .from("cash_accounts")
          .select("account_number, account_name, account_type, custodian, total_value, cash_balance, mmf_balance, total_liquid, liquid_pct")
          .order(sortCol, { ascending: false })
          .limit(limit);

        if (query.params.minPct !== undefined) {
          q = q.gte("liquid_pct", query.params.minPct);
        }
        if (query.params.maxPct !== undefined) {
          q = q.lte("liquid_pct", query.params.maxPct);
        }

        const { data, error } = await q;
        if (error) return { data: null, error: error.message };
        return { data };
      }

      case "search_clients": {
        const s = sanitizePostgrestSearch(query.params.query || "");
        const { data, error } = await supabase
          .from("portfolio_accounts")
          .select("account_number, account_name, client_name, household_name, firm_name, rep_code, total_value, cash_balance")
          .or(`client_name.ilike.%${s}%,account_name.ilike.%${s}%,household_name.ilike.%${s}%`)
          .order("total_value", { ascending: false })
          .limit(MAX_RESULTS);

        if (error) return { data: null, error: error.message };
        return { data };
      }

      case "rep_codes": {
        let q = supabase
          .from("portfolio_accounts")
          .select("rep_code, firm_name")
          .order("rep_code");

        const { data: accounts, error } = await q;
        if (error) return { data: null, error: error.message };

        // Aggregate unique rep codes with firm names and account counts
        const repMap = new Map<string, { rep_code: string; firm_name: string; account_count: number }>();
        (accounts || []).forEach((a) => {
          const code = a.rep_code || "N/A";
          const existing = repMap.get(code);
          if (existing) {
            existing.account_count++;
          } else {
            repMap.set(code, { rep_code: code, firm_name: a.firm_name || "N/A", account_count: 1 });
          }
        });

        let results = Array.from(repMap.values()).sort((a, b) => a.rep_code.localeCompare(b.rep_code));

        if (query.params.search) {
          const s = query.params.search.toLowerCase();
          results = results.filter((r) => r.rep_code.toLowerCase().includes(s) || r.firm_name.toLowerCase().includes(s));
        }

        return { data: results };
      }

      // The firm's own advisor/staff roster — NOT clients. The `crm_contacts`
      // view is built over User + Advisor and holds ~10 rows. Client contact
      // data lives in the "Client" table and is served by `crm_client_contacts`
      // below. These were confused once already: the /contacts report was
      // wired here, so an advisor asking for their book got their colleagues.
      case "advisor_directory":
      case "crm_contacts": {
        const limit = Math.min(query.params.limit || MAX_RESULTS, MAX_RESULTS);
        let q = supabase
          .from("crm_contacts")
          .select("full_name, email, phone, title, crd, firm_id")
          .order("full_name")
          .limit(limit);

        if (query.params.search) {
          const s = sanitizePostgrestSearch(query.params.search);
          q = q.or(`full_name.ilike.%${s}%,email.ilike.%${s}%,crd.ilike.%${s}%,title.ilike.%${s}%`);
        }

        const { data, error } = await q;
        if (error) return { data: null, error: error.message };

        // Enrich with firm names
        const firmIds = [...new Set((data || []).map((c) => c.firm_id).filter(Boolean))];
        let firmMap = new Map<string, string>();
        if (firmIds.length > 0) {
          const { data: firms } = await supabase
            .from("crm_firms")
            .select("id, firm_name")
            .in("id", firmIds);
          firmMap = new Map((firms || []).map((f) => [f.id, f.firm_name]));
        }

        const enriched = (data || []).map((c) => ({
          full_name: c.full_name,
          email: c.email,
          phone: c.phone,
          title: c.title,
          crd: c.crd,
          firm_name: firmMap.get(c.firm_id) || "N/A",
        }));

        return { data: enriched };
      }

      case "firm_aum": {
        const { data: accounts, error } = await supabase
          .from("portfolio_accounts")
          .select("firm_name, total_value, cash_balance");

        if (error) return { data: null, error: error.message };

        const firmMap = new Map<string, { firm_name: string; total_aum: number; total_cash: number; account_count: number }>();
        (accounts || []).forEach((a) => {
          const firm = a.firm_name || "Unknown";
          const existing = firmMap.get(firm);
          const value = Number(a.total_value) || 0;
          const cash = Number(a.cash_balance) || 0;
          if (existing) {
            existing.total_aum += value;
            existing.total_cash += cash;
            existing.account_count++;
          } else {
            firmMap.set(firm, { firm_name: firm, total_aum: value, total_cash: cash, account_count: 1 });
          }
        });

        let results = Array.from(firmMap.values()).sort((a, b) => b.total_aum - a.total_aum);

        if (query.params.search) {
          const s = query.params.search.toLowerCase();
          results = results.filter((r) => r.firm_name.toLowerCase().includes(s));
        }

        return { data: results };
      }

      case "advisory_fees": {
        const limit = Math.min(query.params.limit || MAX_RESULTS, MAX_RESULTS);
        const { data: accts, error } = await supabase
          .from("Account")
          .select("accountNumber, accountName, accountType, balance, feeRate, feeSchedule, billingFrequency")
          .eq("isManaged", true)
          .order("balance", { ascending: false })
          .limit(MAX_RESULTS);

        if (error) return { data: null, error: error.message };

        const enriched = (accts || []).map((a) => {
          const balance = Number(a.balance) || 0;
          const feeRate = Number(a.feeRate) || 0;
          const annualFee = balance * feeRate;
          return {
            account_number: a.accountNumber,
            account_name: a.accountName,
            account_type: a.accountType,
            aum: balance,
            fee_rate_pct: +(feeRate * 100).toFixed(4),
            fee_rate_bps: Math.round(feeRate * 10000),
            annual_fee: +annualFee.toFixed(2),
            fee_schedule: a.feeSchedule,
            billing_frequency: a.billingFrequency,
          };
        });

        const sortBy = query.params.sort || "fee";
        if (sortBy === "fee") {
          enriched.sort((a, b) => b.annual_fee - a.annual_fee);
        } else if (sortBy === "rate") {
          enriched.sort((a, b) => b.fee_rate_bps - a.fee_rate_bps);
        }
        // "aum" already sorted by balance desc

        return { data: enriched.slice(0, limit) };
      }

      case "transfers": {
        const limit = Math.min(query.params.limit || MAX_RESULTS, MAX_RESULTS);
        let q = supabase
          .from("transfers")
          .select("reference_number, type, direction, status, from_account_name, from_institution, to_account_name, to_institution, amount, assets, initiated_at, estimated_completion, completed_at, initiated_by, notes")
          .order("initiated_at", { ascending: false })
          .limit(limit);

        if (query.params.status) q = q.eq("status", query.params.status);
        if (query.params.type) q = q.eq("type", query.params.type);

        const { data, error } = await q;
        if (error) return { data: null, error: error.message };
        return { data };
      }

      case "account_applications": {
        const limit = Math.min(query.params.limit || MAX_RESULTS, MAX_RESULTS);
        let q = supabase
          .from("account_applications")
          .select("client_first_name, client_last_name, account_type, custodian, status, current_step, total_steps, submitted_at, reviewed_at, reviewer_notes")
          .order("updated_at", { ascending: false })
          .limit(limit);

        if (query.params.status) q = q.eq("status", query.params.status);

        const { data, error } = await q;
        if (error) return { data: null, error: error.message };
        return { data };
      }

      case "sales_credits": {
        const limit = Math.min(query.params.limit || MAX_RESULTS, MAX_RESULTS);
        let q = supabase
          .from("sales_credits")
          .select("account_number, credit_type, source, fund_symbol, fund_name, period, credit_amount, status, received_date")
          .order("period_start", { ascending: false })
          .limit(limit);

        if (query.params.status) q = q.eq("status", query.params.status);
        if (query.params.creditType) q = q.eq("credit_type", query.params.creditType);

        const { data, error } = await q;
        if (error) return { data: null, error: error.message };
        return { data };
      }

      case "outside_business": {
        const limit = Math.min(query.params.limit || MAX_RESULTS, MAX_RESULTS);
        let q = supabase
          .from("outside_business_activities")
          .select("activity_type, description, client_name, gross_income, expenses, net_income, date_received, period, approval_status")
          .order("date_received", { ascending: false })
          .limit(limit);

        if (query.params.approvalStatus) q = q.eq("approval_status", query.params.approvalStatus);

        const { data, error } = await q;
        if (error) return { data: null, error: error.message };
        return { data };
      }

      case "account_trade_counts": {
        const limit = Math.min(query.params.limit || MAX_RESULTS, MAX_RESULTS);
        const ascending = query.params.sort === "least";

        // Get all accounts (optionally managed only, optionally filtered by rep code)
        let acctQuery = supabase
          .from("portfolio_accounts")
          .select("id, account_number, account_name, custodian, account_type, total_value, is_managed, rep_code");

        if (query.params.managedOnly) {
          acctQuery = acctQuery.eq("is_managed", true);
        }
        if (query.params.repCode) {
          acctQuery = acctQuery.ilike("rep_code", query.params.repCode);
        }

        const { data: accounts, error: acctError } = await acctQuery;
        if (acctError) return { data: null, error: acctError.message };
        if (!accounts || accounts.length === 0) return { data: [] };

        // Get trade transactions (buy/sell by default, or custom types)
        const tradeTypes = query.params.types || ["buy", "sell"];
        let txQuery = supabase
          .from("account_transactions")
          .select("account_id, type");

        txQuery = txQuery.in("type", tradeTypes);

        if (query.params.dateFrom) {
          txQuery = txQuery.gte("date", query.params.dateFrom);
        }
        if (query.params.dateTo) {
          const dateTo = String(query.params.dateTo);
          const endOfDay = dateTo.length === 10 ? `${dateTo}T23:59:59` : dateTo;
          txQuery = txQuery.lte("date", endOfDay);
        }

        const { data: txs, error: txError } = await txQuery;
        if (txError) return { data: null, error: txError.message };

        // Count trades per account
        const tradeCounts = new Map<string, number>();
        (txs || []).forEach((tx) => {
          tradeCounts.set(tx.account_id, (tradeCounts.get(tx.account_id) || 0) + 1);
        });

        // Build results
        const accountIds = new Set(accounts.map((a) => a.id));
        const results = accounts.map((a) => ({
          account_number: a.account_number,
          account_name: a.account_name,
          rep_code: a.rep_code,
          custodian: a.custodian,
          account_type: a.account_type,
          total_value: a.total_value,
          trade_count: tradeCounts.get(a.id) || 0,
        }));

        results.sort((a, b) => ascending ? a.trade_count - b.trade_count : b.trade_count - a.trade_count);

        return { data: results.slice(0, limit) };
      }

      case "concentration_risk": {
        const limit = Math.min(query.params.limit || MAX_RESULTS, MAX_RESULTS);

        // Get all holdings across all accounts
        const { data: allHoldings, error: holdError } = await supabase
          .from("holdings")
          .select("account_id, symbol, name, asset_class, market_value")
          .order("market_value", { ascending: false });

        if (holdError) return { data: null, error: holdError.message };
        if (!allHoldings || allHoldings.length === 0) return { data: [] };

        // Get account details
        const holdAcctIds = [...new Set(allHoldings.map((h) => h.account_id))];
        const { data: holdAccts } = await supabase
          .from("portfolio_accounts")
          .select("id, account_number, account_name, total_value")
          .in("id", holdAcctIds);

        const holdAcctMap = new Map((holdAccts || []).map((a) => [a.id, a]));

        // Group by account, find largest NON-CASH position as % of account
        // Exclude cash and money market funds since those aren't meaningful concentration risk
        const isCashOrMoneyMarket = (h: { asset_class: string | null; symbol: string }) =>
          h.asset_class === "cash" || /^(VMFXX|SPAXX|SWVXX|FDRXX|SPRXX|TTTXX)$/i.test(h.symbol);

        // Find the largest non-cash position per account
        const acctLargest = new Map<string, { symbol: string; name: string; market_value: number }>();
        allHoldings.forEach((h) => {
          if (isCashOrMoneyMarket(h)) return;
          const mv = Number(h.market_value) || 0;
          const existing = acctLargest.get(h.account_id);
          if (!existing || mv > existing.market_value) {
            acctLargest.set(h.account_id, { symbol: h.symbol, name: h.name, market_value: mv });
          }
        });

        const riskResults = Array.from(acctLargest.entries())
          .map(([acctId, largest]) => {
            const acct = holdAcctMap.get(acctId);
            const totalValue = Number(acct?.total_value) || 0;
            const concentrationPct = totalValue > 0 ? +(largest.market_value / totalValue * 100).toFixed(1) : 0;
            return {
              account_number: acct?.account_number,
              account_name: acct?.account_name,
              total_value: acct?.total_value,
              largest_position: largest.symbol,
              largest_position_name: largest.name,
              largest_position_value: largest.market_value,
              concentration_pct: concentrationPct,
            };
          });

        riskResults.sort((a, b) => b.concentration_pct - a.concentration_pct);
        return { data: riskResults.slice(0, limit) };
      }

      case "daily_recap": {
        const targetDate = query.params.date || new Date().toISOString().split("T")[0];

        // Run all recap queries in parallel
        const [txResult, transferResult, appResult] = await Promise.all([
          // Today's transactions
          supabase
            .from("account_transactions")
            .select("type, symbol, name, amount, status")
            .gte("date", targetDate)
            .lte("date", `${targetDate}T23:59:59`),

          // Pending transfers
          supabase
            .from("transfers")
            .select("reference_number, type, direction, status, amount, from_account_name, to_account_name")
            .in("status", ["pending_approval", "submitted", "in_review", "in_transit"])
            .limit(MAX_RESULTS),

          // Pending applications
          supabase
            .from("account_applications")
            .select("client_first_name, client_last_name, account_type, status, custodian")
            .in("status", ["draft", "submitted", "in_review"])
            .limit(MAX_RESULTS),
        ]);

        // Summarize transactions by type
        const txs = txResult.data || [];
        const txByType: Record<string, number> = {};
        let txTotalAmount = 0;
        txs.forEach((tx) => {
          const type = (tx.type || "other").replace(/_/g, " ");
          txByType[type] = (txByType[type] || 0) + 1;
          txTotalAmount += Math.abs(Number(tx.amount) || 0);
        });
        const txBreakdown = Object.entries(txByType).map(([t, c]) => `${c} ${t}`).join(", ") || "none";

        // Transfer stats
        const transfers = transferResult.data || [];
        const transferTotal = transfers.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

        // App stats
        const apps = appResult.data || [];

        // Build a clean summary object with scalar fields + action-item tables
        const summary: Record<string, unknown> = {
          date: targetDate,
          transactions_today: txs.length,
          transaction_volume: txTotalAmount,
          transaction_breakdown: txBreakdown,
          pending_transfers: transfers.length,
          transfer_amount_pending: transferTotal,
          pending_applications: apps.length,
        };

        // Add pending transfers as a table
        if (transfers.length > 0) {
          summary.pending_transfer_details = transfers.slice(0, 10).map((t) => ({
            reference: t.reference_number,
            type: t.type,
            status: t.status,
            amount: Number(t.amount) || 0,
            from: t.from_account_name,
            to: t.to_account_name,
          }));
        }

        // Add pending applications as a table
        if (apps.length > 0) {
          summary.application_details = apps.slice(0, 10).map((a) => ({
            client: `${a.client_first_name} ${a.client_last_name}`,
            account_type: a.account_type,
            status: a.status,
            custodian: a.custodian,
          }));
        }

        return { data: summary };
      }

      case "pending_actions": {
        // Get all items requiring attention
        const [paTransferResult, paAppResult] = await Promise.all([
          supabase
            .from("transfers")
            .select("reference_number, type, direction, status, amount, from_account_name, to_account_name, initiated_at")
            .in("status", ["pending_approval", "submitted", "in_review"])
            .order("initiated_at", { ascending: true })
            .limit(MAX_RESULTS),

          supabase
            .from("account_applications")
            .select("client_first_name, client_last_name, account_type, status, custodian, submitted_at")
            .in("status", ["submitted", "in_review"])
            .order("submitted_at", { ascending: true })
            .limit(MAX_RESULTS),
        ]);

        const paTransfers = paTransferResult.data || [];
        const paApps = paAppResult.data || [];

        const paSummary: Record<string, unknown> = {
          total_action_items: paTransfers.length + paApps.length,
          pending_transfers: paTransfers.length,
          pending_applications: paApps.length,
        };

        // Transfers as a table
        if (paTransfers.length > 0) {
          paSummary.pending_transfer_details = paTransfers.slice(0, 10).map((t) => ({
            reference: t.reference_number,
            type: t.type,
            status: t.status,
            amount: Number(t.amount) || 0,
            from: t.from_account_name,
            to: t.to_account_name,
          }));
        }

        // Applications as a table
        if (paApps.length > 0) {
          paSummary.application_details = paApps.slice(0, 10).map((a) => ({
            client: `${a.client_first_name} ${a.client_last_name}`,
            account_type: a.account_type,
            status: a.status,
            custodian: a.custodian,
          }));
        }

        return { data: paSummary };
      }

      case "margin_check": {
        const { mode, repCode, accounts: marginTargets } = await resolveAccountTargets(query.params.accountNumber);
        if (marginTargets.length === 0) return { data: null, error: "Account not found" };

        const marginResults: Record<string, unknown>[] = [];
        for (const marginAcct of marginTargets) {
          const { data: balances } = await supabase
            .from("account_balances")
            .select("*")
            .eq("account_id", marginAcct.id)
            .single();

          if (!balances) {
            marginResults.push({
              account_number: marginAcct.account_number,
              account_name: marginAcct.account_name,
              margin_data_available: false,
              health_status: "NO DATA",
            });
            continue;
          }

          const totalEquity = Number(balances.total_equity) || 0;
          const longMv = Number(balances.long_market_value) || 0;
          const houseReq = Number(balances.total_house_requirement) || 0;
          const houseSurplus = Number(balances.house_surplus) || 0;
          const federalCall = Number(balances.today_federal_call) || 0;
          const sma = Number(balances.total_sma) || 0;
          const marginUtilization = longMv > 0 ? +((houseReq / longMv) * 100).toFixed(1) : 0;

          const flags: string[] = [];
          if (federalCall > 0) flags.push(`FEDERAL CALL: $${federalCall.toFixed(2)}`);
          if (houseSurplus < 0) flags.push(`HOUSE DEFICIT: $${Math.abs(houseSurplus).toFixed(2)}`);
          if (marginUtilization > 80) flags.push(`HIGH MARGIN UTILIZATION: ${marginUtilization}%`);
          if (sma < 0) flags.push(`NEGATIVE SMA: $${sma.toFixed(2)}`);

          marginResults.push({
            account_number: marginAcct.account_number,
            account_name: marginAcct.account_name,
            total_equity: totalEquity,
            long_market_value: longMv,
            short_market_value: Number(balances.short_market_value) || 0,
            house_requirement: houseReq,
            house_surplus: houseSurplus,
            sma: sma,
            federal_call: federalCall,
            margin_utilization_pct: marginUtilization,
            funds_available_to_trade: Number(balances.funds_available_to_trade) || 0,
            day_trade_buying_power: Number(balances.day_trade_buying_power) || 0,
            cash: Number(balances.cash) || 0,
            health_status: flags.length === 0 ? "HEALTHY" : "ATTENTION NEEDED",
            flags: flags.length > 0 ? flags : ["No margin issues detected"],
          });
        }

        if (mode === "single") return { data: marginResults[0] };
        return {
          data: {
            scope: mode === "all" ? "ALL ACCOUNTS" : `REP CODE: ${repCode}`,
            total_accounts_reviewed: marginResults.length,
            accounts_with_issues: marginResults.filter((r) => r.health_status === "ATTENTION NEEDED").length,
            results: marginResults,
          },
        };
      }

      case "tax_1099_review": {
        const { mode, repCode, accounts: taxTargets } = await resolveAccountTargets(query.params.accountNumber);
        if (taxTargets.length === 0) return { data: null, error: "Account not found" };

        const year = query.params.year || new Date().getFullYear();
        const dateFrom = `${year}-01-01`;
        const dateTo = `${year}-12-31T23:59:59`;

        const taxResults: Record<string, unknown>[] = [];
        for (const taxAcct of taxTargets) {
          const { data: txs } = await supabase
            .from("account_transactions")
            .select("type, date, symbol, name, quantity, price, amount, description")
            .eq("account_id", taxAcct.id)
            .in("type", ["sell", "dividend", "interest", "fee"])
            .gte("date", dateFrom)
            .lte("date", dateTo)
            .order("date", { ascending: false })
            .limit(MAX_RESULTS);

          const summary: Record<string, { count: number; total_amount: number }> = {};
          (txs || []).forEach((tx) => {
            const t = tx.type;
            if (!summary[t]) summary[t] = { count: 0, total_amount: 0 };
            summary[t].count++;
            summary[t].total_amount += Math.abs(Number(tx.amount) || 0);
          });

          const totalReportable = Object.values(summary).reduce((sum, s) => sum + s.total_amount, 0);

          taxResults.push({
            account_number: taxAcct.account_number,
            account_name: taxAcct.account_name,
            tax_year: year,
            total_reportable_amount: +totalReportable.toFixed(2),
            sell_proceeds: +(summary["sell"]?.total_amount || 0).toFixed(2),
            sell_count: summary["sell"]?.count || 0,
            dividend_income: +(summary["dividend"]?.total_amount || 0).toFixed(2),
            dividend_count: summary["dividend"]?.count || 0,
            interest_income: +(summary["interest"]?.total_amount || 0).toFixed(2),
            interest_count: summary["interest"]?.count || 0,
            fees_paid: +(summary["fee"]?.total_amount || 0).toFixed(2),
            fee_count: summary["fee"]?.count || 0,
            total_transactions: (txs || []).length,
            ...(mode === "single" ? { transactions: txs || [] } : {}),
          });
        }

        if (mode === "single") return { data: taxResults[0] };
        return {
          data: {
            scope: mode === "all" ? "ALL ACCOUNTS" : `REP CODE: ${repCode}`,
            tax_year: year,
            total_accounts_reviewed: taxResults.length,
            results: taxResults,
          },
        };
      }

      case "cost_basis_audit": {
        const { mode, repCode, accounts: cbTargets } = await resolveAccountTargets(query.params.accountNumber);
        if (cbTargets.length === 0) return { data: null, error: "Account not found" };

        const cbResults: Record<string, unknown>[] = [];
        for (const cbAcct of cbTargets) {
          const { data: cbHoldings } = await supabase
            .from("Holding")
            .select("symbol, name, quantity, price, marketValue, costBasis, assetClass")
            .eq("accountId", cbAcct.id)
            .order("marketValue", { ascending: false });

          const issues: Record<string, unknown>[] = [];
          (cbHoldings || []).forEach((h) => {
            const mv = Number(h.marketValue) || 0;
            const cb = Number(h.costBasis);
            const gainLoss = mv - cb;
            const gainLossPct = cb !== 0 ? +((gainLoss / Math.abs(cb)) * 100).toFixed(1) : null;
            const flags: string[] = [];

            if (h.costBasis === null || h.costBasis === undefined) flags.push("MISSING_COST_BASIS");
            else if (cb === 0) flags.push("ZERO_COST_BASIS");
            else if (cb < 0) flags.push("NEGATIVE_COST_BASIS");

            if (gainLossPct !== null && Math.abs(gainLossPct) > 500) flags.push(`EXTREME_GAIN_LOSS: ${gainLossPct}%`);

            if (flags.length > 0) {
              issues.push({
                symbol: h.symbol,
                name: h.name,
                quantity: h.quantity,
                market_value: mv,
                cost_basis: cb,
                gain_loss: +gainLoss.toFixed(2),
                gain_loss_pct: gainLossPct,
                issues: flags,
              });
            }
          });

          cbResults.push({
            account_number: cbAcct.account_number,
            account_name: cbAcct.account_name,
            total_holdings: (cbHoldings || []).length,
            holdings_with_issues: issues.length,
            status: issues.length === 0 ? "ALL CLEAR" : "ISSUES FOUND",
            flagged_holdings: issues,
          });
        }

        if (mode === "single") return { data: cbResults[0] };
        return {
          data: {
            scope: mode === "all" ? "ALL ACCOUNTS" : `REP CODE: ${repCode}`,
            total_accounts_reviewed: cbResults.length,
            accounts_with_issues: cbResults.filter((r) => r.status === "ISSUES FOUND").length,
            results: cbResults,
          },
        };
      }

      case "wash_sale_check": {
        const { mode, repCode, accounts: wsTargets } = await resolveAccountTargets(query.params.accountNumber);
        if (wsTargets.length === 0) return { data: null, error: "Account not found" };

        const year = query.params.year || new Date().getFullYear();
        const dateFrom = `${year - 1}-12-01`;
        const dateTo = `${year + 1}-01-31T23:59:59`;

        const wsResults: Record<string, unknown>[] = [];
        for (const wsAcct of wsTargets) {
          const { data: wsTxs } = await supabase
            .from("account_transactions")
            .select("type, date, symbol, name, quantity, price, amount")
            .eq("account_id", wsAcct.id)
            .in("type", ["buy", "sell"])
            .gte("date", dateFrom)
            .lte("date", dateTo)
            .order("date", { ascending: true });

          const sells = (wsTxs || []).filter((t) => t.type === "sell");
          const buys = (wsTxs || []).filter((t) => t.type === "buy");
          const potentialWashSales: Record<string, unknown>[] = [];

          for (const sell of sells) {
            const sellAmount = Number(sell.amount) || 0;
            if (sellAmount >= 0) continue;

            const sellDate = new Date(sell.date);
            const matchingBuys = buys.filter((b) => {
              if (b.symbol !== sell.symbol) return false;
              const buyDate = new Date(b.date);
              const diffDays = Math.abs((buyDate.getTime() - sellDate.getTime()) / (1000 * 60 * 60 * 24));
              return diffDays <= 30 && !(b.date === sell.date && b.type === sell.type);
            });

            if (matchingBuys.length > 0) {
              potentialWashSales.push({
                symbol: sell.symbol,
                name: sell.name,
                sell_date: sell.date,
                sell_quantity: sell.quantity,
                sell_amount: sellAmount,
                repurchases: matchingBuys.map((b) => ({
                  buy_date: b.date,
                  buy_quantity: b.quantity,
                  buy_amount: Number(b.amount) || 0,
                  days_apart: Math.round(Math.abs((new Date(b.date).getTime() - sellDate.getTime()) / (1000 * 60 * 60 * 24))),
                })),
              });
            }
          }

          wsResults.push({
            account_number: wsAcct.account_number,
            account_name: wsAcct.account_name,
            tax_year: year,
            total_sells_at_loss: sells.filter((s) => (Number(s.amount) || 0) < 0).length,
            potential_wash_sales: potentialWashSales.length,
            status: potentialWashSales.length === 0 ? "NO WASH SALES DETECTED" : "POTENTIAL WASH SALES FOUND",
            flagged_transactions: potentialWashSales,
          });
        }

        if (mode === "single") return { data: wsResults[0] };
        return {
          data: {
            scope: mode === "all" ? "ALL ACCOUNTS" : `REP CODE: ${repCode}`,
            tax_year: year,
            total_accounts_reviewed: wsResults.length,
            accounts_with_wash_sales: wsResults.filter((r) => r.status === "POTENTIAL WASH SALES FOUND").length,
            results: wsResults,
          },
        };
      }

      case "fee_review": {
        const { mode, repCode, accounts: feeTargetsRaw } = await resolveAccountTargets(query.params.accountNumber);
        if (feeTargetsRaw.length === 0) return { data: null, error: "Account not found" };

        // For multi-account mode, only review managed accounts — non-managed accounts don't have
        // advisory fees. Filtered below by the real is_managed flag (not the account-number prefix,
        // which is custodian-specific and not universal across Pershing/Schwab/Fidelity).
        const feeTargets = feeTargetsRaw;

        const now = new Date();
        const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24));
        const yearStart = `${now.getFullYear()}-01-01`;

        const feeResults: Record<string, unknown>[] = [];
        for (const target of feeTargets) {
          const { data: feeAcct } = await supabase
            .from("Account")
            .select("id, accountNumber, accountName, balance, feeRate, feeSchedule, billingFrequency, isManaged")
            .eq("accountNumber", target.account_number)
            .single();

          if (!feeAcct) continue;
          // Skip non-managed accounts in multi-account mode (no advisory fee). Uses the real
          // is_managed flag so it works for every custodian, not just Pershing's XYZ prefix.
          if (mode !== "single" && !feeAcct.isManaged) continue;

          const balance = Number(feeAcct.balance) || 0;
          const feeRate = Number(feeAcct.feeRate) || 0;
          const expectedAnnualFee = balance * feeRate;

          let actualFeesCharged = 0;
          let feeTransactions: Record<string, unknown>[] = [];

          const { data: feeTxs } = await supabase
            .from("account_transactions")
            .select("date, amount, description")
            .eq("account_id", target.id)
            .eq("type", "fee")
            .gte("date", yearStart)
            .order("date", { ascending: false });

          feeTransactions = (feeTxs || []) as Record<string, unknown>[];
          actualFeesCharged = (feeTxs || []).reduce((sum, t) => sum + Math.abs(Number(t.amount) || 0), 0);

          const expectedYtdFee = +(expectedAnnualFee * (dayOfYear / 365)).toFixed(2);

          // Calculate how many billing periods have elapsed to determine expected fees paid so far.
          // Fees are billed in advance (monthly or quarterly), so compare actual fees against
          // the number of billing periods that have passed, not a daily proration.
          const freq = (feeAcct.billingFrequency || "quarterly").toLowerCase();
          const currentMonth = now.getMonth(); // 0-indexed
          let periodsElapsed = 0;
          let feePerPeriod = 0;
          if (freq === "monthly") {
            periodsElapsed = currentMonth + 1; // Jan = 1 period elapsed
            feePerPeriod = expectedAnnualFee / 12;
          } else {
            // quarterly: Q1 = months 0-2, Q2 = 3-5, Q3 = 6-8, Q4 = 9-11
            periodsElapsed = Math.floor(currentMonth / 3) + 1;
            feePerPeriod = expectedAnnualFee / 4;
          }
          const expectedFeesBilled = +(feePerPeriod * periodsElapsed).toFixed(2);

          // Variance: compare actual fees charged vs expected fees billed for elapsed periods
          const variance = expectedFeesBilled > 0 ? +(((actualFeesCharged - expectedFeesBilled) / expectedFeesBilled) * 100).toFixed(1) : 0;

          const flags: string[] = [];
          if (!feeAcct.isManaged) flags.push("NON-MANAGED ACCOUNT (no advisory fee expected)");
          if (feeRate === 0 && feeAcct.isManaged) flags.push("ZERO FEE RATE on managed account");
          const feeRatePct = feeRate * 100;
          if (feeRatePct < 0.5 && feeRate > 0) flags.push(`FEE RATE BELOW RANGE: ${feeRatePct.toFixed(2)}% (minimum 0.50%)`);
          if (feeRatePct > 1.5) flags.push(`FEE RATE ABOVE RANGE: ${feeRatePct.toFixed(2)}% (maximum 1.50%)`);

          feeResults.push({
            account_number: feeAcct.accountNumber,
            account_name: feeAcct.accountName,
            is_managed: feeAcct.isManaged,
            account_value: balance,
            fee_rate_pct: +(feeRate * 100).toFixed(4),
            fee_rate_bps: Math.round(feeRate * 10000),
            expected_annual_fee: +expectedAnnualFee.toFixed(2),
            expected_ytd_fee: expectedYtdFee,
            status: flags.length === 0 ? "FEES IN LINE" : "REVIEW RECOMMENDED",
            flags: flags.length > 0 ? flags : ["Fees are within expected range"],
            ...(mode === "single" ? { actual_fees_charged_ytd: +actualFeesCharged.toFixed(2), variance_pct: variance, fee_schedule: feeAcct.feeSchedule, billing_frequency: feeAcct.billingFrequency, fee_transactions: feeTransactions } : {}),
          });
        }

        if (mode === "single") return { data: feeResults[0] || null };
        return {
          data: {
            scope: mode === "all" ? "ALL ACCOUNTS" : `REP CODE: ${repCode}`,
            total_accounts_reviewed: feeResults.length,
            accounts_with_issues: feeResults.filter((r) => r.status === "REVIEW RECOMMENDED").length,
            results: feeResults,
          },
        };
      }

      case "cash_drag": {
        // Batched below, so it opts out of REVIEW_SCOPE_LIMIT and genuinely
        // supports the whole book.
        const { mode, repCode, accounts: cdTargets } = await resolveAccountTargets(
          query.params.accountNumber,
          { maxAccounts: Infinity },
        );
        if (cdTargets.length === 0) return { data: null, error: "Account not found" };

        const SP500_AVG_RETURN = 0.10;
        const cdResults: Record<string, unknown>[] = [];

        // Two bulk reads instead of two per account. This used to issue a
        // portfolio_accounts lookup and an Allocation lookup for every target
        // in sequence — roughly 1,800 round-trips for the full book, which
        // never came back.
        const CHUNK = 200;
        const cdAccounts: Record<string, unknown>[] = [];
        for (let i = 0; i < cdTargets.length; i += CHUNK) {
          const { data: chunk } = await supabase
            .from("portfolio_accounts")
            .select("id, account_number, account_name, total_value, cash_balance, model_portfolio_id, model_name, is_managed")
            .in("id", cdTargets.slice(i, i + CHUNK).map((t) => t.id));
          if (chunk) cdAccounts.push(...chunk);
        }

        const modelIds = [...new Set(cdAccounts.map((a) => a.model_portfolio_id).filter(Boolean))] as string[];
        const cashAllocByPortfolio = new Map<string, { targetPct: unknown; toleranceBand: unknown }>();
        for (let i = 0; i < modelIds.length; i += CHUNK) {
          const { data: allocs } = await supabase
            .from("Allocation")
            .select("portfolioId, targetPct, toleranceBand")
            .eq("assetClass", "cash")
            .in("portfolioId", modelIds.slice(i, i + CHUNK));
          for (const a of allocs ?? []) {
            cashAllocByPortfolio.set(a.portfolioId as string, a);
          }
        }

        // Preserve the caller's ordering.
        const cdById = new Map(cdAccounts.map((a) => [a.id as string, a]));
        for (const target of cdTargets) {
          const cdAcct = cdById.get(target.id) as {
            account_number: string; account_name: string; total_value: unknown;
            cash_balance: unknown; model_portfolio_id: string | null; model_name: string | null;
          } | undefined;
          if (!cdAcct) continue;

          const totalValue = Number(cdAcct.total_value) || 0;
          const cashBalance = Number(cdAcct.cash_balance) || 0;
          const cashPct = totalValue > 0 ? +((cashBalance / totalValue) * 100).toFixed(2) : 0;

          const cashAlloc = cdAcct.model_portfolio_id
            ? cashAllocByPortfolio.get(cdAcct.model_portfolio_id)
            : undefined;
          const modelCashTarget: number | null = cashAlloc ? Number(cashAlloc.targetPct) || null : null;
          const modelCashTolerance: number | null = cashAlloc ? Number(cashAlloc.toleranceBand) || null : null;

          const excessCash = modelCashTarget !== null
            ? Math.max(0, cashBalance - (totalValue * (modelCashTarget / 100)))
            : cashBalance;
          const estimatedOpportunityCost = +(excessCash * SP500_AVG_RETURN).toFixed(2);

          const flags: string[] = [];
          if (cashPct > 20) flags.push(`VERY HIGH CASH: ${cashPct}% of portfolio`);
          else if (cashPct > 10) flags.push(`HIGH CASH: ${cashPct}% of portfolio`);
          if (modelCashTarget !== null && cashPct > modelCashTarget + (modelCashTolerance || 0)) {
            flags.push(`ABOVE MODEL TARGET: ${cashPct}% vs ${modelCashTarget}% target (±${modelCashTolerance || 0}%)`);
          }

          cdResults.push({
            account_number: cdAcct.account_number,
            account_name: cdAcct.account_name,
            total_value: totalValue,
            cash_balance: cashBalance,
            cash_pct: cashPct,
            model_name: cdAcct.model_name,
            excess_cash: +excessCash.toFixed(2),
            estimated_annual_opportunity_cost: estimatedOpportunityCost,
            status: flags.length === 0 ? "CASH LEVELS NORMAL" : "REVIEW RECOMMENDED",
            flags: flags.length > 0 ? flags : ["Cash is within acceptable range"],
          });
        }

        if (mode === "single") return { data: cdResults[0] || null };
        return {
          data: {
            scope: mode === "all" ? "ALL ACCOUNTS" : `REP CODE: ${repCode}`,
            total_accounts_reviewed: cdResults.length,
            accounts_with_issues: cdResults.filter((r) => r.status === "REVIEW RECOMMENDED").length,
            results: cdResults,
          },
        };
      }

      case "dividend_summary": {
        const { mode, repCode, accounts: divTargets } = await resolveAccountTargets(query.params.accountNumber);
        if (divTargets.length === 0) return { data: null, error: "Account not found" };

        const now = new Date();
        const ytdStart = `${now.getFullYear()}-01-01`;
        const trailing12Start = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString().split("T")[0];

        const divResults: Record<string, unknown>[] = [];
        for (const target of divTargets) {
          const { data: divAcct } = await supabase
            .from("portfolio_accounts")
            .select("id, account_number, account_name, total_value")
            .eq("id", target.id)
            .single();

          if (!divAcct) continue;

          const { data: divTxs } = await supabase
            .from("account_transactions")
            .select("date, symbol, name, amount")
            .eq("account_id", divAcct.id)
            .eq("type", "dividend")
            .gte("date", trailing12Start)
            .order("date", { ascending: false })
            .limit(MAX_RESULTS);

          const bySymbol = new Map<string, { symbol: string; name: string; ytd_income: number; trailing_12m_income: number; count: number }>();

          (divTxs || []).forEach((tx) => {
            const sym = tx.symbol || "Unknown";
            const amt = Math.abs(Number(tx.amount) || 0);
            const isYtd = tx.date >= ytdStart;

            const existing = bySymbol.get(sym);
            if (existing) {
              existing.trailing_12m_income += amt;
              if (isYtd) existing.ytd_income += amt;
              existing.count++;
            } else {
              bySymbol.set(sym, {
                symbol: sym,
                name: tx.name || sym,
                ytd_income: isYtd ? amt : 0,
                trailing_12m_income: amt,
                count: 1,
              });
            }
          });

          const symbolSummaries = Array.from(bySymbol.values())
            .map((s) => ({
              ...s,
              ytd_income: +s.ytd_income.toFixed(2),
              trailing_12m_income: +s.trailing_12m_income.toFixed(2),
            }))
            .sort((a, b) => b.trailing_12m_income - a.trailing_12m_income);

          const totalYtd = symbolSummaries.reduce((sum, s) => sum + s.ytd_income, 0);
          const totalTrailing = symbolSummaries.reduce((sum, s) => sum + s.trailing_12m_income, 0);
          const estimatedYield = Number(divAcct.total_value) > 0 ? +((totalTrailing / Number(divAcct.total_value)) * 100).toFixed(2) : 0;

          divResults.push({
            account_number: divAcct.account_number,
            account_name: divAcct.account_name,
            total_value: divAcct.total_value,
            total_ytd_income: +totalYtd.toFixed(2),
            total_trailing_12m_income: +totalTrailing.toFixed(2),
            estimated_yield_pct: estimatedYield,
            dividend_paying_holdings: symbolSummaries.length,
            total_dividend_transactions: (divTxs || []).length,
            ...(mode === "single" ? { by_symbol: symbolSummaries } : {}),
          });
        }

        if (mode === "single") return { data: divResults[0] || null };
        return {
          data: {
            scope: mode === "all" ? "ALL ACCOUNTS" : `REP CODE: ${repCode}`,
            total_accounts_reviewed: divResults.length,
            results: divResults,
          },
        };
      }

      case "ira_contribution_check": {
        // Fetch all IRA and Roth IRA accounts with client details
        const { data: iraAccounts, error: iraErr } = await supabase
          .from("portfolio_accounts")
          .select("id, account_number, account_name, account_type, total_value, client_name, date_of_birth, annual_income, rep_code, firm_name")
          .in("account_type", ["ira", "roth_ira"])
          .order("account_name");

        if (iraErr) return { data: null, error: iraErr.message };
        if (!iraAccounts || iraAccounts.length === 0) return { data: null, error: "No IRA accounts found" };

        // Filter by account number or rep code if provided
        let targets = iraAccounts;
        if (query.params.accountNumber && query.params.accountNumber !== "ALL") {
          const param = query.params.accountNumber.toUpperCase();
          targets = iraAccounts.filter(a =>
            a.account_number?.toUpperCase() === param ||
            a.rep_code?.toUpperCase() === param
          );
          if (targets.length === 0) return { data: null, error: `No IRA accounts found for "${query.params.accountNumber}"` };
        }

        // Exclude Roth IRA accounts with income > $165K (ineligible for contributions)
        const eligible = targets.filter(a => {
          if (a.account_type === "roth_ira" && a.annual_income && Number(a.annual_income) > 165000) return false;
          return true;
        });

        // Get 2026 contribution totals for eligible accounts (batch to avoid URL length limits)
        const accountIds = eligible.map(a => a.id);
        const BATCH_SIZE = 50;
        const contribByAccount = new Map<string, number>();

        for (let i = 0; i < accountIds.length; i += BATCH_SIZE) {
          const batch = accountIds.slice(i, i + BATCH_SIZE);
          const { data: contribData } = await supabase
            .from("account_transactions")
            .select("account_id, amount")
            .in("account_id", batch)
            .eq("type", "contribution")
            .eq("contribution_year", 2026);

          for (const row of contribData ?? []) {
            contribByAccount.set(row.account_id, (contribByAccount.get(row.account_id) || 0) + Number(row.amount));
          }
        }

        // Build results
        const results = eligible.map(a => {
          const dob = a.date_of_birth ? new Date(a.date_of_birth) : null;
          const age = dob ? Math.floor((new Date(2026, 11, 31).getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : null;
          const limit = age !== null && age >= 50 ? 8500 : 7500;
          const contributed = contribByAccount.get(a.id) || 0;
          const remaining = Math.max(0, limit - contributed);

          return {
            account_number: a.account_number,
            account_name: a.account_name,
            account_type: a.account_type === "roth_ira" ? "Roth IRA" : "Traditional IRA",
            client_name: a.client_name,
            age,
            annual_income: a.annual_income ? Number(a.annual_income) : null,
            contribution_limit: limit,
            contributed: Math.round(contributed * 100) / 100,
            remaining: Math.round(remaining * 100) / 100,
            pct_of_limit: Math.round((contributed / limit) * 10000) / 100,
            status: remaining === 0 ? "Maxed Out" : "Room to Contribute",
            rep_code: a.rep_code,
          };
        })
        .sort((a, b) => a.pct_of_limit - b.pct_of_limit);

        return { data: results.slice(0, MAX_RESULTS) };
      }

      case "suitability_review": {
        const limit = Math.min(query.params.limit || MAX_RESULTS, MAX_RESULTS);

        // Get all clients with risk tolerance
        let clientQuery = supabase
          .from("portfolio_accounts")
          .select("id, account_number, account_name, client_name, total_value, risk_tolerance, investment_objective, rep_code, is_managed")
          .eq("is_managed", true);

        if (query.params.repCode) {
          clientQuery = clientQuery.ilike("rep_code", query.params.repCode);
        }

        const { data: suitAccounts, error: suitErr } = await clientQuery;
        if (suitErr) return { data: null, error: suitErr.message };
        if (!suitAccounts || suitAccounts.length === 0) return { data: [] };

        // Get holdings grouped by asset class per account
        const suitIds = suitAccounts.map((a) => a.id);
        const { data: suitHoldings } = await supabase
          .from("holdings")
          .select("account_id, asset_class, market_value")
          .in("account_id", suitIds);

        // Aggregate by account
        const holdingsByAcct = new Map<string, Map<string, number>>();
        (suitHoldings || []).forEach((h) => {
          if (!holdingsByAcct.has(h.account_id)) holdingsByAcct.set(h.account_id, new Map());
          const classMap = holdingsByAcct.get(h.account_id)!;
          const cls = h.asset_class || "other";
          classMap.set(cls, (classMap.get(cls) || 0) + (Number(h.market_value) || 0));
        });

        // Risk tolerance to max equity % mapping
        const riskLimits: Record<string, number> = {
          conservative: 40, moderately_conservative: 50, moderate: 65,
          moderately_aggressive: 80, aggressive: 95,
        };

        const suitResults: Record<string, unknown>[] = [];
        for (const acct of suitAccounts) {
          const classMap = holdingsByAcct.get(acct.id);
          if (!classMap) continue;
          const totalMv = Array.from(classMap.values()).reduce((s, v) => s + v, 0);
          if (totalMv === 0) continue;

          const equityValue = classMap.get("equity") || 0;
          const equityPct = +((equityValue / totalMv) * 100).toFixed(1);
          const risk = (acct.risk_tolerance || "").toLowerCase().replace(/\s+/g, "_");
          const maxEquity = riskLimits[risk];

          if (maxEquity !== undefined && equityPct > maxEquity) {
            suitResults.push({
              account_number: acct.account_number,
              account_name: acct.account_name,
              client_name: acct.client_name,
              risk_tolerance: acct.risk_tolerance || "Not Set",
              investment_objective: acct.investment_objective || "Not Set",
              equity_pct: equityPct,
              max_equity_pct: maxEquity,
              excess_equity_pct: +(equityPct - maxEquity).toFixed(1),
              total_value: acct.total_value,
              status: "MISMATCH",
            });
          }
        }

        suitResults.sort((a, b) => Number(b.excess_equity_pct) - Number(a.excess_equity_pct));
        return { data: suitResults.slice(0, limit) };
      }

      case "stale_accounts": {
        const limit = Math.min(query.params.limit || MAX_RESULTS, MAX_RESULTS);
        const threshold = query.params.daysSinceLastTrade || 90;

        let acctQuery = supabase
          .from("portfolio_accounts")
          .select("id, account_number, account_name, total_value, client_name, rep_code, model_name")
          .eq("is_managed", true);

        if (query.params.repCode) {
          acctQuery = acctQuery.ilike("rep_code", query.params.repCode);
        }

        const { data: staleAccts, error: staleErr } = await acctQuery;
        if (staleErr) return { data: null, error: staleErr.message };
        if (!staleAccts || staleAccts.length === 0) return { data: [] };

        // Get most recent trade per account
        const staleIds = staleAccts.map((a) => a.id);
        const { data: recentTrades } = await supabase
          .from("account_transactions")
          .select("account_id, date")
          .in("account_id", staleIds)
          .in("type", ["buy", "sell"])
          .order("date", { ascending: false });

        const lastTradeMap = new Map<string, string>();
        (recentTrades || []).forEach((tx) => {
          if (!lastTradeMap.has(tx.account_id)) {
            lastTradeMap.set(tx.account_id, tx.date);
          }
        });

        const now = new Date();
        const staleResults: Record<string, unknown>[] = [];
        for (const acct of staleAccts) {
          const lastTrade = lastTradeMap.get(acct.id);
          const daysSince = lastTrade
            ? Math.floor((now.getTime() - new Date(lastTrade).getTime()) / (1000 * 60 * 60 * 24))
            : 9999;

          if (daysSince >= threshold) {
            staleResults.push({
              account_number: acct.account_number,
              account_name: acct.account_name,
              client_name: acct.client_name,
              total_value: acct.total_value,
              model_name: acct.model_name,
              rep_code: acct.rep_code,
              last_trade_date: lastTrade || "Never",
              days_since_last_trade: lastTrade ? daysSince : "N/A",
            });
          }
        }

        staleResults.sort((a, b) => {
          const aVal = typeof a.days_since_last_trade === "number" ? a.days_since_last_trade : 99999;
          const bVal = typeof b.days_since_last_trade === "number" ? b.days_since_last_trade : 99999;
          return (bVal as number) - (aVal as number);
        });
        return { data: staleResults.slice(0, limit) };
      }

      case "client_birthdays": {
        const daysAhead = query.params.daysAhead || 30;

        let clientQ = supabase
          .from("portfolio_accounts")
          .select("account_number, account_name, client_name, date_of_birth, rep_code")
          .not("date_of_birth", "is", null);

        if (query.params.repCode) {
          clientQ = clientQ.ilike("rep_code", query.params.repCode);
        }

        const { data: bdayAccts, error: bdayErr } = await clientQ;
        if (bdayErr) return { data: null, error: bdayErr.message };

        const now = new Date();
        const results: Record<string, unknown>[] = [];
        const seen = new Set<string>();

        (bdayAccts || []).forEach((a) => {
          if (!a.date_of_birth || seen.has(a.client_name)) return;
          seen.add(a.client_name);

          const dob = new Date(a.date_of_birth);
          const thisYear = new Date(now.getFullYear(), dob.getMonth(), dob.getDate());
          const nextBday = thisYear >= now ? thisYear : new Date(now.getFullYear() + 1, dob.getMonth(), dob.getDate());
          const daysUntil = Math.floor((nextBday.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

          if (daysUntil <= daysAhead) {
            const age = now.getFullYear() - dob.getFullYear() + (nextBday.getFullYear() > now.getFullYear() ? 1 : 0);
            const milestones: string[] = [];
            if (age === 50) milestones.push("IRA Catch-up Eligible");
            if (age === 59 || (age === 60 && dob.getMonth() <= 5)) milestones.push("Penalty-Free IRA Withdrawals (59½)");
            if (age === 65) milestones.push("Medicare Eligible");
            if (age === 73) milestones.push("RMD Required");

            results.push({
              client_name: a.client_name,
              date_of_birth: a.date_of_birth,
              turning_age: age,
              birthday: nextBday.toISOString().split("T")[0],
              days_until: daysUntil,
              milestones: milestones.length > 0 ? milestones.join(", ") : "None",
              rep_code: a.rep_code,
            });
          }
        });

        results.sort((a, b) => Number(a.days_until) - Number(b.days_until));
        return { data: results };
      }

      case "client_directory": {
        const limit = Math.min(query.params.limit || MAX_RESULTS, MAX_RESULTS);

        let dirQuery = supabase
          .from("Client")
          .select("firstName, lastName, email, phone, dateOfBirth, riskTolerance, investmentObjective, employmentStatus, annualIncome, netWorth, state, city, advisorId");

        if (query.params.riskTolerance) {
          dirQuery = dirQuery.ilike("riskTolerance", query.params.riskTolerance);
        }

        // repCode was declared as a parameter on this report and offered in the
        // UI, but never applied — scoping a client report to a rep silently
        // returned the whole firm.
        if (query.params.repCode) {
          const advisorIds = await advisorIdsForRepCode(query.params.repCode);
          if (advisorIds.length === 0) return { data: [] };
          dirQuery = dirQuery.in("advisorId", advisorIds);
        }

        const { data: clients, error: clientErr } = await dirQuery.order("lastName").limit(limit);
        if (clientErr) return { data: null, error: clientErr.message };

        const enriched = (clients || []).map((c) => ({
          name: `${c.firstName} ${c.lastName}`,
          email: c.email,
          phone: c.phone,
          date_of_birth: c.dateOfBirth,
          risk_tolerance: c.riskTolerance || "Not Set",
          investment_objective: c.investmentObjective || "Not Set",
          employment_status: c.employmentStatus || "Not Set",
          annual_income: c.annualIncome ? Number(c.annualIncome) : null,
          net_worth: c.netWorth ? Number(c.netWorth) : null,
          city: c.city,
          state: c.state,
        }));

        return { data: enriched };
      }

      /**
       * Client contact sheet — what an advisor means by "CRM contacts": the
       * people they serve, with how to reach them.
       *
       * Distinct from `client_directory`, which is the demographics and
       * suitability view (risk tolerance, income, net worth). This one is
       * name / phone / email / address, plus the household and rep it rolls up to.
       */
      case "crm_client_contacts": {
        const limit = Math.min(query.params.limit || MAX_RESULTS, MAX_RESULTS);

        let cq = supabase
          .from("Client")
          .select(
            "firstName, lastName, email, phone, secondaryPhone, address, city, state, zipCode, onboardingStatus, advisorId, householdId",
          );

        if (query.params.repCode) {
          const advisorIds = await advisorIdsForRepCode(query.params.repCode);
          if (advisorIds.length === 0) return { data: [] };
          cq = cq.in("advisorId", advisorIds);
        }

        if (query.params.search) {
          const s = sanitizePostgrestSearch(query.params.search);
          cq = cq.or(`firstName.ilike.%${s}%,lastName.ilike.%${s}%,email.ilike.%${s}%`);
        }

        const { data: rows, error: cErr } = await cq.order("lastName").limit(limit);
        if (cErr) return { data: null, error: cErr.message };

        // Resolve household names and rep codes in bulk rather than per row.
        const hhIds = [...new Set((rows || []).map((r) => r.householdId).filter(Boolean))];
        const advIds = [...new Set((rows || []).map((r) => r.advisorId).filter(Boolean))];

        const [hhRes, advRes] = await Promise.all([
          hhIds.length
            ? supabase.from("Household").select("id, name").in("id", hhIds)
            : Promise.resolve({ data: [] as { id: string; name: string }[] }),
          advIds.length
            ? supabase.from("Advisor").select("id, repCode").in("id", advIds)
            : Promise.resolve({ data: [] as { id: string; repCode: string | null }[] }),
        ]);

        const hhMap = new Map((hhRes.data ?? []).map((h) => [h.id, h.name]));
        const advMap = new Map((advRes.data ?? []).map((a) => [a.id, a.repCode]));

        return {
          data: (rows || []).map((c) => ({
            name: `${c.firstName} ${c.lastName}`,
            email: c.email,
            phone: c.phone,
            secondary_phone: c.secondaryPhone,
            address: [c.address, c.city, c.state, c.zipCode].filter(Boolean).join(", ") || null,
            household: c.householdId ? hhMap.get(c.householdId) ?? null : null,
            rep_code: c.advisorId ? advMap.get(c.advisorId) ?? null : null,
            status: c.onboardingStatus || "Not Set",
          })),
        };
      }

      case "household_summary": {
        let hhQuery = supabase
          .from("portfolio_accounts")
          .select("household_name, total_value, cash_balance, account_type, rep_code");

        if (query.params.repCode) {
          hhQuery = hhQuery.ilike("rep_code", query.params.repCode);
        }

        const { data: hhAccts, error: hhErr } = await hhQuery;
        if (hhErr) return { data: null, error: hhErr.message };

        const hhMap = new Map<string, { household: string; total_aum: number; total_cash: number; account_count: number; account_types: Set<string>; rep_code: string }>();
        (hhAccts || []).forEach((a) => {
          const hh = a.household_name || "Unassigned";
          const existing = hhMap.get(hh);
          const val = Number(a.total_value) || 0;
          const cash = Number(a.cash_balance) || 0;
          if (existing) {
            existing.total_aum += val;
            existing.total_cash += cash;
            existing.account_count++;
            if (a.account_type) existing.account_types.add(a.account_type);
          } else {
            hhMap.set(hh, {
              household: hh,
              total_aum: val,
              total_cash: cash,
              account_count: 1,
              account_types: new Set(a.account_type ? [a.account_type] : []),
              rep_code: a.rep_code || "N/A",
            });
          }
        });

        let hhResults = Array.from(hhMap.values()).map((h) => ({
          household: h.household,
          total_aum: +h.total_aum.toFixed(2),
          total_cash: +h.total_cash.toFixed(2),
          cash_pct: h.total_aum > 0 ? +((h.total_cash / h.total_aum) * 100).toFixed(1) : 0,
          account_count: h.account_count,
          account_types: Array.from(h.account_types).join(", "),
          rep_code: h.rep_code,
        }));

        if (query.params.minAum) {
          hhResults = hhResults.filter((h) => h.total_aum >= query.params.minAum!);
        }

        const sortField = query.params.sort === "cash" ? "total_cash"
          : query.params.sort === "cash_pct" ? "cash_pct"
          : query.params.sort === "accounts" ? "account_count"
          : "total_aum";
        hhResults.sort((a, b) => (b as unknown as Record<string, number>)[sortField] - (a as unknown as Record<string, number>)[sortField]);
        const limit = Math.min(query.params.limit || MAX_RESULTS, MAX_RESULTS);
        return { data: hhResults.slice(0, limit) };
      }

      case "kyc_gaps": {
        const limit = Math.min(query.params.limit || MAX_RESULTS, MAX_RESULTS);

        const { data: kycClients, error: kycErr } = await supabase
          .from("Client")
          .select("firstName, lastName, email, phone, dateOfBirth, riskTolerance, investmentObjective, employmentStatus, annualIncome, netWorth")
          .limit(MAX_RESULTS);

        if (kycErr) return { data: null, error: kycErr.message };

        const kycFields = ["email", "phone", "dateOfBirth", "riskTolerance", "investmentObjective", "employmentStatus", "annualIncome", "netWorth"];
        const kycResults: Record<string, unknown>[] = [];

        (kycClients || []).forEach((c) => {
          const missing: string[] = [];
          for (const field of kycFields) {
            const val = (c as Record<string, unknown>)[field];
            if (val === null || val === undefined || val === "") {
              missing.push(field.replace(/([A-Z])/g, " $1").trim());
            }
          }
          if (missing.length > 0) {
            kycResults.push({
              client_name: `${c.firstName} ${c.lastName}`,
              missing_fields: missing.join(", "),
              missing_count: missing.length,
              email: c.email || "Missing",
              phone: c.phone || "Missing",
            });
          }
        });

        kycResults.sort((a, b) => Number(b.missing_count) - Number(a.missing_count));
        return { data: kycResults.slice(0, limit) };
      }

      case "account_performance": {
        const limit = Math.min(query.params.limit || MAX_RESULTS, MAX_RESULTS);

        let perfQuery = supabase
          .from("AccountPerformance")
          .select("accountId, periodStart, periodEnd, beginningValue, endingValue, netFlows, twrReturn, mwrReturn, benchmarkReturn")
          .order("periodEnd", { ascending: false });

        const { data: perfData, error: perfErr } = await perfQuery.limit(MAX_RESULTS);
        if (perfErr) return { data: null, error: perfErr.message };
        if (!perfData || perfData.length === 0) return { data: [] };

        // Get most recent period per account
        const latestPerf = new Map<string, typeof perfData[0]>();
        perfData.forEach((p) => {
          if (!latestPerf.has(p.accountId)) {
            latestPerf.set(p.accountId, p);
          }
        });

        // Get account details
        const perfAcctIds = Array.from(latestPerf.keys());
        const { data: perfAccts } = await supabase
          .from("Account")
          .select("id, accountNumber, accountName, balance")
          .in("id", perfAcctIds);

        const perfAcctMap = new Map((perfAccts || []).map((a) => [a.id, a]));

        const perfResults = Array.from(latestPerf.entries()).map(([acctId, perf]) => {
          const acct = perfAcctMap.get(acctId);
          const twr = Number(perf.twrReturn) || 0;
          const benchmark = Number(perf.benchmarkReturn) || 0;
          const alpha = +(twr - benchmark).toFixed(2);

          return {
            account_number: acct?.accountNumber || "Unknown",
            account_name: acct?.accountName || "Unknown",
            period: `${perf.periodStart} to ${perf.periodEnd}`,
            beginning_value: perf.beginningValue,
            ending_value: perf.endingValue,
            net_flows: perf.netFlows,
            twr_return_pct: +(twr * 100).toFixed(2),
            mwr_return_pct: +((Number(perf.mwrReturn) || 0) * 100).toFixed(2),
            benchmark_return_pct: +(benchmark * 100).toFixed(2),
            alpha_pct: +(alpha * 100).toFixed(2),
            status: alpha >= 0 ? "OUTPERFORMING" : "UNDERPERFORMING",
          };
        });

        perfResults.sort((a, b) => b.alpha_pct - a.alpha_pct);
        return { data: perfResults.slice(0, limit) };
      }

      case "underperformers": {
        const limit = Math.min(query.params.limit || MAX_RESULTS, MAX_RESULTS);
        const minAlpha = query.params.minNegativeAlpha || 0;

        const { data: upData, error: upErr } = await supabase
          .from("AccountPerformance")
          .select("accountId, periodStart, periodEnd, twrReturn, benchmarkReturn, beginningValue, endingValue")
          .order("periodEnd", { ascending: false })
          .limit(MAX_RESULTS);

        if (upErr) return { data: null, error: upErr.message };
        if (!upData || upData.length === 0) return { data: [] };

        const latestUp = new Map<string, typeof upData[0]>();
        upData.forEach((p) => {
          if (!latestUp.has(p.accountId)) latestUp.set(p.accountId, p);
        });

        const upAcctIds = Array.from(latestUp.keys());
        const { data: upAccts } = await supabase
          .from("Account")
          .select("id, accountNumber, accountName")
          .in("id", upAcctIds);

        const upAcctMap = new Map((upAccts || []).map((a) => [a.id, a]));

        const upResults: Record<string, unknown>[] = [];
        latestUp.forEach((perf, acctId) => {
          const twr = Number(perf.twrReturn) || 0;
          const benchmark = Number(perf.benchmarkReturn) || 0;
          const alpha = twr - benchmark;

          if (alpha < -minAlpha) {
            const acct = upAcctMap.get(acctId);
            upResults.push({
              account_number: acct?.accountNumber || "Unknown",
              account_name: acct?.accountName || "Unknown",
              period: `${perf.periodStart} to ${perf.periodEnd}`,
              twr_return_pct: +(twr * 100).toFixed(2),
              benchmark_return_pct: +(benchmark * 100).toFixed(2),
              alpha_pct: +(alpha * 100).toFixed(2),
              ending_value: perf.endingValue,
            });
          }
        });

        upResults.sort((a, b) => Number(a.alpha_pct) - Number(b.alpha_pct));
        return { data: upResults.slice(0, limit) };
      }

      case "revenue_by_rep": {
        const limit = Math.min(query.params.limit || MAX_RESULTS, MAX_RESULTS);

        const { data: revAccts, error: revErr } = await supabase
          .from("portfolio_accounts")
          .select("rep_code, firm_name, total_value, is_managed");

        if (revErr) return { data: null, error: revErr.message };

        const { data: feeAccts } = await supabase
          .from("Account")
          .select("accountNumber, balance, feeRate, isManaged")
          .eq("isManaged", true);

        const feeMap = new Map((feeAccts || []).map((a) => [a.accountNumber, a]));

        const repRevMap = new Map<string, { rep_code: string; firm_name: string; total_aum: number; managed_aum: number; estimated_revenue: number; managed_accounts: number; total_accounts: number }>();

        (revAccts || []).forEach((a) => {
          const code = a.rep_code || "N/A";
          const existing = repRevMap.get(code);
          const val = Number(a.total_value) || 0;

          if (existing) {
            existing.total_aum += val;
            existing.total_accounts++;
            if (a.is_managed) {
              existing.managed_aum += val;
              existing.managed_accounts++;
            }
          } else {
            repRevMap.set(code, {
              rep_code: code,
              firm_name: a.firm_name || "N/A",
              total_aum: val,
              managed_aum: a.is_managed ? val : 0,
              estimated_revenue: 0,
              managed_accounts: a.is_managed ? 1 : 0,
              total_accounts: 1,
            });
          }
        });

        // Calculate estimated revenue from fee rates
        (feeAccts || []).forEach((a) => {
          const balance = Number(a.balance) || 0;
          const feeRate = Number(a.feeRate) || 0;
          // Find which rep code this account belongs to
          for (const [, rep] of repRevMap) {
            // Match by checking managed accounts
            rep.estimated_revenue += 0; // placeholder — we aggregate below
          }
        });

        // Simpler approach: use portfolio_accounts to get rep_code, then Account to get fee info
        // Re-aggregate revenue from the Account table
        const revResults = Array.from(repRevMap.values());
        // Reset revenue and recalculate
        for (const rep of revResults) {
          rep.estimated_revenue = 0;
        }

        // Get account-to-rep mapping
        const { data: acctRepData } = await supabase
          .from("portfolio_accounts")
          .select("account_number, rep_code")
          .eq("is_managed", true);

        const acctRepMap = new Map((acctRepData || []).map((a) => [a.account_number, a.rep_code]));

        (feeAccts || []).forEach((a) => {
          const repCode = acctRepMap.get(a.accountNumber) || "N/A";
          const rep = repRevMap.get(repCode);
          if (rep) {
            rep.estimated_revenue += (Number(a.balance) || 0) * (Number(a.feeRate) || 0);
          }
        });

        const revFinal = Array.from(repRevMap.values()).map((r) => ({
          rep_code: r.rep_code,
          firm_name: r.firm_name,
          total_aum: +r.total_aum.toFixed(2),
          managed_aum: +r.managed_aum.toFixed(2),
          estimated_annual_revenue: +r.estimated_revenue.toFixed(2),
          managed_accounts: r.managed_accounts,
          total_accounts: r.total_accounts,
        }));

        revFinal.sort((a, b) => b.estimated_annual_revenue - a.estimated_annual_revenue);
        return { data: revFinal.slice(0, limit) };
      }

      case "firm_expenses": {
        let expQuery = supabase
          .from("house_account_expenses")
          .select("category, amount, period_month, period_year")
          .order("period_year", { ascending: false })
          .order("period_month", { ascending: false })
          .limit(MAX_RESULTS);

        if (query.params.year) expQuery = expQuery.eq("period_year", query.params.year);
        if (query.params.month) expQuery = expQuery.eq("period_month", query.params.month);

        const { data: expenses, error: expErr } = await expQuery;
        if (expErr) return { data: null, error: expErr.message };

        // Aggregate by category
        const catMap = new Map<string, { category: string; total_amount: number; entries: number }>();
        (expenses || []).forEach((e) => {
          const cat = e.category || "Unknown";
          const existing = catMap.get(cat);
          const amt = Number(e.amount) || 0;
          if (existing) {
            existing.total_amount += amt;
            existing.entries++;
          } else {
            catMap.set(cat, { category: cat, total_amount: amt, entries: 1 });
          }
        });

        const expResults = Array.from(catMap.values()).map((c) => ({
          category: c.category.replace(/_/g, " "),
          total_amount: +c.total_amount.toFixed(2),
          entries: c.entries,
        }));

        expResults.sort((a, b) => b.total_amount - a.total_amount);
        return { data: expResults };
      }

      case "pt8_conversion": {
        const limit = Math.min(query.params.limit || MAX_RESULTS, MAX_RESULTS);
        const minAum = query.params.minAum || 0;

        const { data: pt8Accts, error: pt8Err } = await supabase
          .from("portfolio_accounts")
          .select("account_number, account_name, client_name, account_type, total_value, cash_balance, rep_code, household_name")
          .eq("is_managed", false)
          .order("total_value", { ascending: false })
          .limit(limit);

        if (pt8Err) return { data: null, error: pt8Err.message };

        const pt8Results = (pt8Accts || [])
          .filter((a) => (Number(a.total_value) || 0) >= minAum)
          .map((a) => {
            const val = Number(a.total_value) || 0;
            return {
              account_number: a.account_number,
              account_name: a.account_name,
              client_name: a.client_name,
              account_type: a.account_type,
              total_value: val,
              cash_balance: a.cash_balance,
              household_name: a.household_name,
              rep_code: a.rep_code,
              potential_annual_fee_1pct: +(val * 0.01).toFixed(2),
            };
          });

        return { data: pt8Results };
      }

      case "sector_exposure": {
        // Get holdings, optionally scoped to an account
        let secQuery = supabase
          .from("holdings")
          .select("account_id, symbol, market_value")
          .order("market_value", { ascending: false });

        if (query.params.accountNumber) {
          const { data: secAcct } = await supabase
            .from("portfolio_accounts")
            .select("id")
            .eq("account_number", query.params.accountNumber)
            .single();
          if (secAcct) secQuery = secQuery.eq("account_id", secAcct.id);
        }

        const { data: secHoldings, error: secErr } = await secQuery.limit(MAX_RESULTS);
        if (secErr) return { data: null, error: secErr.message };
        if (!secHoldings || secHoldings.length === 0) return { data: [] };

        // Get sector data from Security table
        const symbols = [...new Set(secHoldings.map((h) => h.symbol))];
        const { data: securities } = await supabase
          .from("Security")
          .select("symbol, sector")
          .in("symbol", symbols);

        const sectorMap = new Map((securities || []).map((s) => [s.symbol, s.sector || "Unknown"]));

        // Aggregate by sector
        const sectorAgg = new Map<string, { sector: string; market_value: number; holding_count: number }>();
        let totalMv = 0;

        secHoldings.forEach((h) => {
          const mv = Number(h.market_value) || 0;
          totalMv += mv;
          const sector = sectorMap.get(h.symbol) || "Unknown";
          const existing = sectorAgg.get(sector);
          if (existing) {
            existing.market_value += mv;
            existing.holding_count++;
          } else {
            sectorAgg.set(sector, { sector, market_value: mv, holding_count: 1 });
          }
        });

        const secResults = Array.from(sectorAgg.values()).map((s) => ({
          sector: s.sector,
          market_value: +s.market_value.toFixed(2),
          allocation_pct: totalMv > 0 ? +((s.market_value / totalMv) * 100).toFixed(1) : 0,
          holding_count: s.holding_count,
        }));

        secResults.sort((a, b) => b.market_value - a.market_value);
        return { data: secResults };
      }

      case "asset_class_breakdown": {
        let acbQuery = supabase
          .from("holdings")
          .select("account_id, asset_class, market_value");

        if (query.params.accountNumber) {
          const { data: acbAcct } = await supabase
            .from("portfolio_accounts")
            .select("id")
            .eq("account_number", query.params.accountNumber)
            .single();
          if (acbAcct) acbQuery = acbQuery.eq("account_id", acbAcct.id);
        }

        const { data: acbHoldings, error: acbErr } = await acbQuery.limit(MAX_RESULTS);
        if (acbErr) return { data: null, error: acbErr.message };
        if (!acbHoldings || acbHoldings.length === 0) return { data: [] };

        const classAgg = new Map<string, { asset_class: string; market_value: number; holding_count: number }>();
        let acbTotal = 0;

        acbHoldings.forEach((h) => {
          const mv = Number(h.market_value) || 0;
          acbTotal += mv;
          const cls = h.asset_class || "other";
          const existing = classAgg.get(cls);
          if (existing) {
            existing.market_value += mv;
            existing.holding_count++;
          } else {
            classAgg.set(cls, { asset_class: cls, market_value: mv, holding_count: 1 });
          }
        });

        const acbResults = Array.from(classAgg.values()).map((c) => ({
          asset_class: c.asset_class,
          market_value: +c.market_value.toFixed(2),
          allocation_pct: acbTotal > 0 ? +((c.market_value / acbTotal) * 100).toFixed(1) : 0,
          holding_count: c.holding_count,
        }));

        acbResults.sort((a, b) => b.market_value - a.market_value);
        return { data: acbResults };
      }

      case "large_positions": {
        const limit = Math.min(query.params.limit || MAX_RESULTS, MAX_RESULTS);
        const minValue = query.params.minValue || 500000;

        const { data: lgHoldings, error: lgErr } = await supabase
          .from("holdings")
          .select("account_id, symbol, name, asset_class, quantity, price, market_value, cost_basis")
          .gte("market_value", minValue)
          .order("market_value", { ascending: false })
          .limit(limit);

        if (lgErr) return { data: null, error: lgErr.message };
        if (!lgHoldings || lgHoldings.length === 0) return { data: [] };

        const lgAcctIds = [...new Set(lgHoldings.map((h) => h.account_id))];
        const { data: lgAccts } = await supabase
          .from("portfolio_accounts")
          .select("id, account_number, account_name, total_value")
          .in("id", lgAcctIds);

        const lgAcctMap = new Map((lgAccts || []).map((a) => [a.id, a]));

        const lgResults = lgHoldings.map((h) => {
          const acct = lgAcctMap.get(h.account_id);
          const totalVal = Number(acct?.total_value) || 0;
          const mv = Number(h.market_value) || 0;
          return {
            account_number: acct?.account_number || "Unknown",
            account_name: acct?.account_name || "Unknown",
            symbol: h.symbol,
            name: h.name,
            quantity: h.quantity,
            market_value: mv,
            pct_of_account: totalVal > 0 ? +((mv / totalVal) * 100).toFixed(1) : 0,
            cost_basis: h.cost_basis,
            unrealized_gl: +((mv) - (Number(h.cost_basis) || 0)).toFixed(2),
          };
        });

        return { data: lgResults };
      }

      case "unrealized_gains_losses": {
        const limit = Math.min(query.params.limit || MAX_RESULTS, MAX_RESULTS);

        let uglQuery = supabase
          .from("holdings")
          .select("account_id, symbol, name, quantity, price, market_value, cost_basis")
          .not("cost_basis", "is", null)
          .order("market_value", { ascending: false });

        if (query.params.accountNumber) {
          const { data: uglAcct } = await supabase
            .from("portfolio_accounts")
            .select("id")
            .eq("account_number", query.params.accountNumber)
            .single();
          if (uglAcct) uglQuery = uglQuery.eq("account_id", uglAcct.id);
        }

        const { data: uglHoldings, error: uglErr } = await uglQuery.limit(MAX_RESULTS);
        if (uglErr) return { data: null, error: uglErr.message };
        if (!uglHoldings || uglHoldings.length === 0) return { data: [] };

        const uglAcctIds = [...new Set(uglHoldings.map((h) => h.account_id))];
        const { data: uglAccts } = await supabase
          .from("portfolio_accounts")
          .select("id, account_number, account_name")
          .in("id", uglAcctIds);

        const uglAcctMap = new Map((uglAccts || []).map((a) => [a.id, a]));

        let uglResults = uglHoldings.map((h) => {
          const mv = Number(h.market_value) || 0;
          const cb = Number(h.cost_basis) || 0;
          const gl = mv - cb;
          const glPct = cb !== 0 ? +((gl / Math.abs(cb)) * 100).toFixed(1) : 0;
          const acct = uglAcctMap.get(h.account_id);

          return {
            account_number: acct?.account_number || "Unknown",
            account_name: acct?.account_name || "Unknown",
            symbol: h.symbol,
            name: h.name,
            quantity: h.quantity,
            market_value: mv,
            cost_basis: cb,
            unrealized_gl: +gl.toFixed(2),
            unrealized_gl_pct: glPct,
          };
        });

        if (query.params.gainOrLoss === "gain") {
          uglResults = uglResults.filter((r) => r.unrealized_gl > 0);
        } else if (query.params.gainOrLoss === "loss") {
          uglResults = uglResults.filter((r) => r.unrealized_gl < 0);
        }

        uglResults.sort((a, b) => Math.abs(b.unrealized_gl) - Math.abs(a.unrealized_gl));
        return { data: uglResults.slice(0, limit) };
      }

      case "transfer_pipeline": {
        const limit = Math.min(query.params.limit || MAX_RESULTS, MAX_RESULTS);

        let tpQuery = supabase
          .from("transfers")
          .select("reference_number, type, direction, status, from_account_name, from_institution, to_account_name, to_institution, amount, assets, initiated_at, estimated_completion")
          .not("status", "in", "(completed,cancelled,rejected)")
          .order("initiated_at", { ascending: true })
          .limit(limit);

        if (query.params.type) tpQuery = tpQuery.eq("type", query.params.type);

        const { data: tpData, error: tpErr } = await tpQuery;
        if (tpErr) return { data: null, error: tpErr.message };

        const now = new Date();
        const tpResults = (tpData || []).map((t) => {
          const daysInTransit = t.initiated_at
            ? +((now.getTime() - new Date(t.initiated_at).getTime()) / (1000 * 60 * 60 * 24)).toFixed(1)
            : 0;
          return {
            reference_number: t.reference_number,
            type: t.type,
            direction: t.direction,
            status: t.status,
            from: t.from_account_name || t.from_institution,
            to: t.to_account_name || t.to_institution,
            amount: t.amount,
            initiated_at: t.initiated_at,
            estimated_completion: t.estimated_completion,
            days_in_transit: daysInTransit,
            stale: daysInTransit > 14,
          };
        });

        return { data: tpResults };
      }

      case "application_pipeline": {
        const limit = Math.min(query.params.limit || MAX_RESULTS, MAX_RESULTS);

        let apQuery = supabase
          .from("account_applications")
          .select("client_first_name, client_last_name, account_type, custodian, status, current_step, total_steps, submitted_at, reviewed_at, reviewer_notes")
          .not("status", "in", "(approved,rejected)")
          .order("submitted_at", { ascending: true })
          .limit(limit);

        if (query.params.custodian) apQuery = apQuery.ilike("custodian", `%${query.params.custodian}%`);

        const { data: apData, error: apErr } = await apQuery;
        if (apErr) return { data: null, error: apErr.message };

        const now = new Date();
        const apResults = (apData || []).map((a) => {
          const daysSinceSubmit = a.submitted_at
            ? +((now.getTime() - new Date(a.submitted_at).getTime()) / (1000 * 60 * 60 * 24)).toFixed(1)
            : 0;
          const progress = a.total_steps > 0 ? +((a.current_step / a.total_steps) * 100).toFixed(0) : 0;
          return {
            client_name: `${a.client_first_name} ${a.client_last_name}`,
            account_type: a.account_type,
            custodian: a.custodian,
            status: a.status,
            progress_pct: progress,
            step: `${a.current_step}/${a.total_steps}`,
            submitted_at: a.submitted_at,
            days_since_submitted: daysSinceSubmit,
            reviewer_notes: a.reviewer_notes,
          };
        });

        return { data: apResults };
      }

      case "new_accounts": {
        const limit = Math.min(query.params.limit || MAX_RESULTS, MAX_RESULTS);
        const now = new Date();
        const defaultFrom = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()).toISOString().split("T")[0];

        let naQuery = supabase
          .from("portfolio_accounts")
          .select("account_number, account_name, client_name, account_type, custodian, total_value, cash_balance, rep_code, household_name, open_date")
          .not("open_date", "is", null)
          .order("open_date", { ascending: false })
          .limit(limit);

        if (query.params.dateFrom) {
          naQuery = naQuery.gte("open_date", query.params.dateFrom);
        } else {
          naQuery = naQuery.gte("open_date", defaultFrom);
        }

        if (query.params.dateTo) {
          naQuery = naQuery.lte("open_date", query.params.dateTo);
        }

        if (query.params.repCode) {
          naQuery = naQuery.ilike("rep_code", query.params.repCode);
        }

        if (query.params.custodian) {
          naQuery = naQuery.ilike("custodian", `%${query.params.custodian}%`);
        }

        const { data: naData, error: naErr } = await naQuery;
        if (naErr) return { data: null, error: naErr.message };

        return { data: naData };
      }

      case "dynamic_query": {
        const sql = (query.params.sql || "").trim();

        if (!sql) {
          return { data: null, error: "No SQL query provided" };
        }

        // Validate it starts with SELECT or WITH (CTE)
        const normalized = sql.replace(/^\s*\(?\s*/i, "").toUpperCase();
        if (!normalized.startsWith("SELECT") && !normalized.startsWith("WITH")) {
          return { data: null, error: "Only SELECT queries are allowed" };
        }

        // Reject dangerous keywords
        const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|EXECUTE|COPY)\b/i;
        if (forbidden.test(sql)) {
          return { data: null, error: "Query contains forbidden operations. Only SELECT is allowed." };
        }

        const { data, error } = await supabase.rpc("execute_readonly_query", {
          query_sql: sql,
        });

        if (error) {
          return { data: null, error: `Query failed: ${error.message}` };
        }

        return { data: (data as Record<string, unknown>[]) || [] };
      }

      case "general":
        return { data: null };

      default:
        return { data: null, error: "Unknown query type" };
    }
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
