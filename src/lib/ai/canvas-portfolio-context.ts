import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPct(value: number): string {
  return `${value.toFixed(2)}%`;
}

export interface PortfolioCanvasContext {
  context: string;
  accountNumber: string;
  accountName: string;
  holdings: Record<string, unknown>[];
  account: Record<string, unknown>;
}

export async function buildPortfolioCanvasContext(
  accountNumber: string
): Promise<PortfolioCanvasContext | null> {
  // Look up the account
  const { data: account, error: acctError } = await supabase
    .from("portfolio_accounts")
    .select("*")
    .eq("account_number", accountNumber)
    .single();

  if (acctError || !account) return null;

  const isRetirement = ["ira", "roth_ira", "sep_ira", "simple_ira", "401k", "403b"].includes(
    String(account.account_type || "").toLowerCase()
  );

  // Gather household account IDs first (needed to fetch household holdings)
  let householdAcctIds: string[] = [];
  let householdAccountsList: Record<string, unknown>[] = [];
  if (account.household_id) {
    const { data: hhAccts } = await supabase
      .from("portfolio_accounts")
      .select("id, account_number, account_name, account_type, total_value, cash_balance, client_name")
      .eq("household_id", account.household_id);
    householdAccountsList = hhAccts || [];
    householdAcctIds = householdAccountsList.map((a) => String(a.id));
  }

  // Fetch all data in parallel
  const [
    holdingsRes,
    transactionsRes,
    balancesRes,
    feeRes,
    rmdRes,
    householdHoldingsRes,
    crmRes,
  ] = await Promise.all([
    supabase
      .from("holdings_enriched")
      .select("*")
      .eq("accountId", account.id)
      .order("marketValue", { ascending: false }),
    supabase
      .from("account_transactions")
      .select("*")
      .eq("account_id", account.id)
      .order("date", { ascending: false })
      .limit(100),
    supabase
      .from("account_balances")
      .select("*")
      .eq("account_id", account.id)
      .maybeSingle(),
    supabase
      .from("Account")
      .select("feeRate, feeSchedule, billingFrequency, isManaged, balance")
      .eq("accountNumber", accountNumber)
      .maybeSingle(),
    isRetirement
      ? supabase
          .from("retirement_rmd_view")
          .select("*")
          .eq("account_id", account.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    householdAcctIds.length > 1
      ? supabase
          .from("holdings_enriched")
          .select("accountId, symbol, name, assetClass, quantity, price, marketValue, costBasis")
          .in("accountId", householdAcctIds)
          .order("marketValue", { ascending: false })
      : Promise.resolve({ data: null }),
    supabase.from("crm_contacts").select("full_name, role"),
  ]);

  const holdings = holdingsRes.data || [];
  const transactions = transactionsRes.data || [];
  const balances = balancesRes.data || null;
  const feeInfo = feeRes.data || null;
  const rmdData = rmdRes.data || null;
  const householdHoldings = householdHoldingsRes.data || [];
  const advisorList = (crmRes.data || [])
    .map((c: Record<string, unknown>) => `${c.full_name} (${c.role || "Advisor"})`)
    .join(", ");

  const lines: string[] = [];

  // ── Account Overview ──
  lines.push("=== ACCOUNT OVERVIEW ===");
  lines.push(`Account: ${account.account_number} | Name: ${account.account_name}`);
  lines.push(`Type: ${account.account_type} | Custodian: ${account.custodian}`);
  lines.push(`Client: ${account.client_name || "N/A"} | Household: ${account.household_name || "N/A"}`);
  lines.push(`Rep Code: ${account.rep_code || "N/A"} | Firm: ${account.firm_name || "N/A"}`);
  lines.push(`Model: ${account.model_name || "None"} | Managed: ${account.is_managed ? "Yes" : "No"}`);
  // Calculate total value from holdings + cash (matches what the portfolio page displays)
  const holdingsTotal = holdings.reduce((s: number, h: Record<string, unknown>) => s + (Number(h.marketValue) || 0), 0);
  const cashBalance = Number(account.cash_balance) || 0;
  const accountTotal = holdingsTotal + cashBalance;
  lines.push(`Total Value: ${formatCurrency(accountTotal)} (${formatCurrency(holdingsTotal)} in holdings + ${formatCurrency(cashBalance)} cash)`);
  const cashPct = accountTotal > 0 ? (cashBalance / accountTotal) * 100 : 0;
  lines.push(`Cash Balance: ${formatCurrency(cashBalance)} (${formatPct(cashPct)})`);
  if (advisorList) lines.push(`Known Advisors: ${advisorList}`);
  lines.push("");

  // ── Client Info ──
  lines.push("=== CLIENT INFORMATION ===");
  lines.push(`Name: ${account.client_name || "N/A"}`);
  if (account.date_of_birth) lines.push(`Date of Birth: ${account.date_of_birth}`);
  if (account.ssn) {
    const ssn = String(account.ssn);
    lines.push(`SSN: ***-**-${ssn.slice(-4)}`);
  }
  if (account.address) lines.push(`Address: ${account.address}, ${account.city || ""} ${account.state || ""} ${account.zip_code || ""}`);
  lines.push("");

  // ── Suitability ──
  lines.push("=== SUITABILITY PROFILE ===");
  lines.push(`Risk Tolerance: ${account.risk_tolerance || "N/A"}`);
  lines.push(`Investment Objective: ${account.investment_objective || "N/A"}`);
  lines.push(`Time Horizon: ${account.time_horizon || "N/A"}`);
  if (account.net_worth) lines.push(`Net Worth: ${formatCurrency(Number(account.net_worth))}`);
  if (account.annual_income) lines.push(`Annual Income: ${formatCurrency(Number(account.annual_income))}`);
  lines.push("");

  // ── Holdings ──
  lines.push(`=== HOLDINGS (${holdings.length} positions) ===`);
  if (holdings.length === 0) {
    lines.push("No holdings on file.");
  } else {
    for (const h of holdings) {
      const gainLoss = Number(h.marketValue) - Number(h.costBasis || 0);
      const gainPct = Number(h.costBasis) > 0 ? (gainLoss / Number(h.costBasis)) * 100 : 0;
      lines.push(
        `${h.symbol} | ${h.name} | ${h.assetClass} | ${Number(h.quantity).toLocaleString()} shares | ` +
        `Price: $${Number(h.price).toFixed(2)} | Value: ${formatCurrency(Number(h.marketValue))} | ` +
        `Cost: ${h.costBasis ? formatCurrency(Number(h.costBasis)) : "N/A"} | ` +
        `Gain/Loss: ${h.costBasis ? `${formatCurrency(gainLoss)} (${formatPct(gainPct)})` : "N/A"} | ` +
        `Day Change: ${h.day_change_pct != null ? formatPct(Number(h.day_change_pct)) : "N/A"}`
      );
    }
    const totalValue = holdings.reduce((s: number, h: Record<string, unknown>) => s + (Number(h.marketValue) || 0), 0);
    const totalCost = holdings.reduce((s: number, h: Record<string, unknown>) => s + (Number(h.costBasis) || 0), 0);
    lines.push(`--- Total Holdings Value: ${formatCurrency(totalValue)} | Total Cost Basis: ${formatCurrency(totalCost)} | Total Gain/Loss: ${formatCurrency(totalValue - totalCost)}`);
  }
  lines.push("");

  // ── Transactions ──
  lines.push(`=== RECENT TRANSACTIONS (${transactions.length}) ===`);
  if (transactions.length === 0) {
    lines.push("No recent transactions.");
  } else {
    for (const t of transactions) {
      lines.push(
        `${t.date} | ${String(t.type).toUpperCase()} | ${t.symbol || ""} ${t.name || ""} | ` +
        `Qty: ${t.quantity || ""} | Price: ${t.price ? `$${Number(t.price).toFixed(2)}` : ""} | ` +
        `Amount: ${formatCurrency(Number(t.amount) || 0)} | ${t.status || ""}`
      );
    }
  }
  lines.push("");

  // ── Margin & Balances ──
  lines.push("=== MARGIN & BALANCES ===");
  if (!balances) {
    lines.push("No margin/balance data on file.");
  } else {
    lines.push(`Total Equity: ${formatCurrency(Number(balances.total_equity) || 0)}`);
    lines.push(`Long Market Value: ${formatCurrency(Number(balances.long_market_value) || 0)}`);
    lines.push(`Short Market Value: ${formatCurrency(Number(balances.short_market_value) || 0)}`);
    lines.push(`House Requirement: ${formatCurrency(Number(balances.total_house_requirement) || 0)}`);
    lines.push(`House Surplus: ${formatCurrency(Number(balances.house_surplus) || 0)}`);
    lines.push(`SMA: ${formatCurrency(Number(balances.total_sma) || 0)}`);
    lines.push(`Federal Call: ${formatCurrency(Number(balances.today_federal_call) || 0)}`);
    lines.push(`Funds Available to Trade: ${formatCurrency(Number(balances.funds_available_to_trade) || 0)}`);
    lines.push(`Day Trade Buying Power: ${formatCurrency(Number(balances.day_trade_buying_power) || 0)}`);
    lines.push(`Cash: ${formatCurrency(Number(balances.cash) || 0)}`);
    const equity = Number(balances.total_equity) || 0;
    const houseReq = Number(balances.total_house_requirement) || 0;
    if (equity > 0 && houseReq > 0) {
      lines.push(`Margin Utilization: ${formatPct((houseReq / equity) * 100)}`);
    }
  }
  lines.push("");

  // ── Fee Information ──
  lines.push("=== FEE INFORMATION ===");
  if (!feeInfo) {
    lines.push("No fee data on file.");
  } else {
    const rate = Number(feeInfo.feeRate) || 0;
    const balance = Number(feeInfo.balance) || 0;
    lines.push(`Fee Rate: ${formatPct(rate * 100)} (${(rate * 10000).toFixed(0)} bps)`);
    lines.push(`Account Balance (billing): ${formatCurrency(balance)}`);
    lines.push(`Estimated Annual Fee: ${formatCurrency(balance * rate)}`);
    lines.push(`Fee Schedule: ${feeInfo.feeSchedule || "N/A"}`);
    lines.push(`Billing Frequency: ${feeInfo.billingFrequency || "N/A"}`);
    lines.push(`Managed: ${feeInfo.isManaged ? "Yes" : "No"}`);
  }
  lines.push("");

  // ── RMD Data (retirement accounts only) ──
  if (isRetirement && rmdData) {
    lines.push("=== RMD INFORMATION ===");
    lines.push(`Prior Year-End Balance: ${formatCurrency(Number(rmdData.prior_year_end_balance) || 0)}`);
    lines.push(`YTD Distributions: ${formatCurrency(Number(rmdData.ytd_distributions) || 0)}`);
    lines.push("");
  }

  // ── Household Summary ──
  if (householdAccountsList.length > 1) {
    // Calculate household AUM from holdings (matches what the portfolio page shows)
    const totalHouseholdHoldingsValue = householdHoldings.reduce((s: number, h: Record<string, unknown>) => s + (Number(h.marketValue) || 0), 0);
    const totalHouseholdCash = householdAccountsList.reduce((s: number, a: Record<string, unknown>) => s + (Number(a.cash_balance) || 0), 0);
    const totalHouseholdAUM = totalHouseholdHoldingsValue + totalHouseholdCash;
    lines.push("=== HOUSEHOLD SUMMARY ===");
    lines.push(`Household: ${account.household_name}`);
    lines.push(`Total Household Value: ${formatCurrency(totalHouseholdAUM)} (${formatCurrency(totalHouseholdHoldingsValue)} in holdings + ${formatCurrency(totalHouseholdCash)} cash)`);
    lines.push(`Accounts in Household (${householdAccountsList.length}):`);
    for (const a of householdAccountsList) {
      // Per-account value from holdings
      const acctHoldings = householdHoldings.filter((h: Record<string, unknown>) => h.accountId === a.id);
      const acctHoldingsValue = acctHoldings.reduce((s: number, h: Record<string, unknown>) => s + (Number(h.marketValue) || 0), 0);
      const acctCash = Number(a.cash_balance) || 0;
      const acctTotal = acctHoldingsValue + acctCash;
      const marker = a.account_number === accountNumber ? " ← current" : "";
      lines.push(`  ${a.account_number} | ${a.account_name} | ${a.account_type} | Value: ${formatCurrency(acctTotal)} (${formatCurrency(acctHoldingsValue)} holdings + ${formatCurrency(acctCash)} cash)${marker}`);
    }
  }

  return {
    context: lines.join("\n"),
    accountNumber: account.account_number,
    accountName: account.account_name,
    holdings,
    account,
  };
}
