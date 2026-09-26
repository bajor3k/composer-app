import { supabase } from "@/lib/supabase";

/**
 * Assembles the account context block the Foundry workspace agent is instructed to
 * expect. Section headers here are a contract with the agent's instructions — the
 * agent is told it will receive ACCOUNT OVERVIEW / HOLDINGS / MARGIN & BALANCES /
 * RECENT TRANSACTIONS / FEE INFORMATION / HOUSEHOLD SUMMARY / FLAGS. Renaming a
 * section here without updating the agent in Foundry will silently degrade answers.
 *
 * Anomaly detection stays in code rather than being left to the model: deterministic
 * thresholds are auditable and cost no tokens, and the model is measurably better at
 * explaining a flag than at finding one.
 */

const TRANSACTION_LIMIT = 100;
const HOLDINGS_LISTED = 60;

/** Above this unrealized gain, the basis is more likely wrong than the gain real. */
const IMPLAUSIBLE_GAIN_PCT = 500;
/** Below this, the position has almost certainly lost its basis rather than its value. */
const IMPLAUSIBLE_LOSS_PCT = -95;

type Row = Record<string, unknown>;

function currency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function pct(value: number): string {
  return `${value.toFixed(2)}%`;
}

function num(value: unknown): number {
  return Number(value) || 0;
}

interface HoldingFlag {
  symbol: string;
  note: string;
}

/** Cost-basis integrity check. Returns a flag note, or null when the position is clean. */
function flagHolding(holding: Row): string | null {
  const marketValue = num(holding.market_value);
  const rawCost = holding.cost_basis;

  if (rawCost == null) return "MISSING cost basis";
  const cost = Number(rawCost);
  if (cost === 0) return "ZERO cost basis";
  if (cost < 0) return "NEGATIVE cost basis";

  const gainPct = ((marketValue - cost) / cost) * 100;
  if (gainPct > IMPLAUSIBLE_GAIN_PCT) return `implausible gain (${pct(gainPct)})`;
  if (gainPct < IMPLAUSIBLE_LOSS_PCT) return `implausible loss (${pct(gainPct)})`;
  return null;
}

export interface CaseContextResult {
  context: string;
  accountNumber: string;
}

/**
 * Builds the full context block for a case-scoped account.
 * Returns null when the case's account number does not resolve to an account.
 */
export async function buildCaseContext(
  accountNumber: string
): Promise<CaseContextResult | null> {
  const { data: account } = await supabase
    .from("portfolio_accounts")
    .select("*")
    .eq("account_number", accountNumber)
    .maybeSingle();

  if (!account) return null;

  const [balancesRes, holdingsRes, transactionsRes, feeRes, siblingsRes] = await Promise.all([
    supabase.from("account_balances").select("*").eq("account_id", account.id).maybeSingle(),
    supabase
      .from("holdings")
      .select("symbol, name, asset_class, quantity, price, market_value, cost_basis, day_change_pct")
      .eq("account_id", account.id)
      .order("market_value", { ascending: false }),
    supabase
      .from("account_transactions")
      .select("date, type, symbol, name, quantity, price, amount, status")
      .eq("account_id", account.id)
      .order("date", { ascending: false })
      .limit(TRANSACTION_LIMIT),
    supabase
      .from("Account")
      .select("feeRate, feeSchedule, billingFrequency, isManaged, balance")
      .eq("accountNumber", accountNumber)
      .maybeSingle(),
    account.household_id
      ? supabase
          .from("portfolio_accounts")
          .select("account_number, account_name, account_type, total_value, cash_balance")
          .eq("household_id", account.household_id)
      : Promise.resolve({ data: null }),
  ]);

  const balances = balancesRes.data as Row | null;
  const holdings = (holdingsRes.data ?? []) as Row[];
  const transactions = (transactionsRes.data ?? []) as Row[];
  const fees = feeRes.data as Row | null;
  const siblings = (siblingsRes.data ?? []) as Row[];

  const lines: string[] = [];
  const flags: HoldingFlag[] = [];

  lines.push("=== ACCOUNT OVERVIEW ===");
  lines.push(`Account: ${account.account_number} | Name: ${account.account_name}`);
  lines.push(`Type: ${account.account_type} | Custodian: ${account.custodian}`);
  lines.push(`Client: ${account.client_name || "N/A"} | Household: ${account.household_name || "N/A"}`);
  lines.push(`Total Value: ${currency(num(account.total_value))}`);
  lines.push(`Cash Balance: ${currency(num(account.cash_balance))}`);
  lines.push("");

  const totalMarketValue = holdings.reduce((sum, h) => sum + num(h.market_value), 0);
  let totalCost = 0;

  lines.push(`=== HOLDINGS (${holdings.length} positions) ===`);
  if (holdings.length === 0) {
    lines.push("No holdings on file.");
  } else {
    for (const [index, holding] of holdings.entries()) {
      const marketValue = num(holding.market_value);
      const cost = holding.cost_basis == null ? null : Number(holding.cost_basis);
      totalCost += cost ?? 0;

      // Flag every position, but only list the largest ones — a flagged position is
      // worth reporting whether or not it made the listing cut.
      const flag = flagHolding(holding);
      if (flag) flags.push({ symbol: String(holding.symbol), note: flag });
      if (index >= HOLDINGS_LISTED) continue;

      const weight = totalMarketValue > 0 ? (marketValue / totalMarketValue) * 100 : 0;
      const gainLoss = cost == null ? null : marketValue - cost;
      const gainPct = cost != null && cost > 0 ? ((marketValue - cost) / cost) * 100 : null;

      lines.push(
        `${holding.symbol} | ${holding.name} | ${holding.asset_class} | ` +
          `Qty: ${Number(holding.quantity).toLocaleString()} | Value: ${currency(marketValue)} | ` +
          `${pct(weight)} of account | Cost: ${cost == null ? "MISSING" : currency(cost)} | ` +
          `Unrealized G/L: ${gainLoss == null ? "N/A" : currency(gainLoss)}` +
          `${gainPct == null ? "" : ` (${pct(gainPct)})`}`
      );
    }
    if (holdings.length > HOLDINGS_LISTED) {
      lines.push(`… ${holdings.length - HOLDINGS_LISTED} smaller positions not listed.`);
    }
    lines.push(
      `--- Totals: Value ${currency(totalMarketValue)} | Cost Basis ${currency(totalCost)} | ` +
        `Unrealized G/L ${currency(totalMarketValue - totalCost)}`
    );
  }
  lines.push("");

  lines.push("=== MARGIN & BALANCES ===");
  if (!balances) {
    lines.push("No margin/balance data on file for this account.");
  } else {
    const equity = num(balances.total_equity);
    const houseRequirement = num(balances.total_house_requirement);
    const houseSurplus = num(balances.house_surplus);
    const federalCall = num(balances.today_federal_call);

    lines.push(`Total Equity: ${currency(equity)}`);
    lines.push(`Liquidating Equity: ${currency(num(balances.liquidating_equity))}`);
    lines.push(`Long Market Value: ${currency(num(balances.long_market_value))}`);
    lines.push(`Short Market Value: ${currency(num(balances.short_market_value))}`);
    lines.push(`House Requirement: ${currency(houseRequirement)}`);
    lines.push(`House Surplus: ${currency(houseSurplus)}`);
    lines.push(`FINRA Surplus: ${currency(num(balances.finra_surplus))}`);
    lines.push(`SMA: ${currency(num(balances.total_sma))}`);
    lines.push(`Today's Federal Call: ${currency(federalCall)}`);
    lines.push(`Funds Available to Trade: ${currency(num(balances.funds_available_to_trade))}`);
    lines.push(`Funds Available to Withdraw: ${currency(num(balances.funds_available_to_withdraw))}`);
    lines.push(`Day Trade Buying Power: ${currency(num(balances.day_trade_buying_power))}`);
    lines.push(`Funds Unavailable: ${currency(num(balances.funds_unavailable))}`);
    lines.push(`Funds Due: ${currency(num(balances.funds_due))}`);

    if (equity > 0 && houseRequirement > 0) {
      lines.push(`Margin Utilization (house req / equity): ${pct((houseRequirement / equity) * 100)}`);
    }
    if (federalCall > 0) flags.push({ symbol: "ACCOUNT", note: `active federal call — ${currency(federalCall)} due` });
    if (houseSurplus < 0) flags.push({ symbol: "ACCOUNT", note: `house deficit — ${currency(houseSurplus)}` });
  }
  lines.push("");

  lines.push("=== FEE INFORMATION ===");
  if (!fees) {
    lines.push("No fee record on file for this account.");
  } else {
    lines.push(`Fee Rate: ${pct(num(fees.feeRate) * 100)}`);
    lines.push(`Fee Schedule: ${fees.feeSchedule || "N/A"}`);
    lines.push(`Billing Frequency: ${fees.billingFrequency || "N/A"}`);
    lines.push(`Managed: ${fees.isManaged ? "Yes" : "No"}`);
  }
  lines.push("");

  lines.push(`=== RECENT TRANSACTIONS (${transactions.length}) ===`);
  if (transactions.length === 0) {
    lines.push("No recent transactions.");
  } else {
    for (const transaction of transactions) {
      lines.push(
        `${transaction.date} | ${String(transaction.type).toUpperCase()} | ` +
          `${transaction.symbol || ""} ${transaction.name || ""} | ` +
          `Qty: ${transaction.quantity ?? ""} | Amount: ${currency(num(transaction.amount))} | ` +
          `${transaction.status || ""}`
      );
    }
  }
  lines.push("");

  lines.push("=== HOUSEHOLD SUMMARY ===");
  if (siblings.length <= 1) {
    lines.push("This account is not grouped with other accounts in a household.");
  } else {
    lines.push(`Household: ${account.household_name} (${siblings.length} accounts)`);
    for (const sibling of siblings) {
      const isThis = sibling.account_number === account.account_number;
      lines.push(
        `${sibling.account_number} | ${sibling.account_name} | ${sibling.account_type} | ` +
          `Value: ${currency(num(sibling.total_value))} | Cash: ${currency(num(sibling.cash_balance))}` +
          `${isThis ? "  <- this case" : ""}`
      );
    }
  }
  lines.push("");

  lines.push("=== FLAGS ===");
  if (flags.length === 0) {
    lines.push("No anomalies detected by automated checks.");
  } else {
    for (const flag of flags) {
      lines.push(`${flag.symbol}: ${flag.note}`);
    }
  }

  return { context: lines.join("\n"), accountNumber: String(account.account_number) };
}
