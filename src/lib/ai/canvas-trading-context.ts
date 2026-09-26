import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPct(value: number): string {
  return `${value.toFixed(2)}%`;
}

export interface TradingCanvasContext {
  context: string;
}

export async function buildTradingCanvasContext(): Promise<TradingCanvasContext | null> {
  // Fetch recent trades (last 90 days) and supporting data in parallel
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const [tradesRes, accountsRes, crmRes] = await Promise.all([
    supabase
      .from("transactions_view")
      .select("*")
      .gte("created_at", threeMonthsAgo.toISOString())
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("portfolio_accounts")
      .select("account_number, account_name, account_type, rep_code, total_value, cash_balance, is_managed, model_name, household_name, fee_rate, fee_schedule, billing_frequency")
      .order("account_name"),
    supabase.from("crm_contacts").select("full_name, role"),
  ]);

  const trades = tradesRes.data || [];
  const accounts = accountsRes.data || [];
  const advisorList = (crmRes.data || [])
    .map((c: Record<string, unknown>) => `${c.full_name} (${c.role || "Advisor"})`)
    .join(", ");

  if (trades.length === 0 && accounts.length === 0) return null;

  const lines: string[] = [];

  // ── Summary Stats ──
  const buys = trades.filter((t) => t.transaction_type === "buy");
  const sells = trades.filter((t) => t.transaction_type === "sell");
  const dividends = trades.filter((t) => t.transaction_type === "dividend");
  const interest = trades.filter((t) => t.transaction_type === "interest");
  const fees = trades.filter((t) => t.transaction_type === "fee");

  const buyVolume = buys.reduce((s: number, t: Record<string, unknown>) => s + Math.abs(Number(t.amount) || 0), 0);
  const sellVolume = sells.reduce((s: number, t: Record<string, unknown>) => s + Math.abs(Number(t.amount) || 0), 0);
  const dividendTotal = dividends.reduce((s: number, t: Record<string, unknown>) => s + Math.abs(Number(t.amount) || 0), 0);
  const interestTotal = interest.reduce((s: number, t: Record<string, unknown>) => s + Math.abs(Number(t.amount) || 0), 0);
  const feeTotal = fees.reduce((s: number, t: Record<string, unknown>) => s + Math.abs(Number(t.amount) || 0), 0);

  lines.push("=== TRADE BLOTTER SUMMARY (Last 90 Days) ===");
  lines.push(`Total Transactions: ${trades.length}`);
  lines.push(`Buys: ${buys.length} trades, ${formatCurrency(buyVolume)} volume`);
  lines.push(`Sells: ${sells.length} trades, ${formatCurrency(sellVolume)} volume`);
  lines.push(`Dividends: ${dividends.length} payments, ${formatCurrency(dividendTotal)} total`);
  lines.push(`Interest: ${interest.length} payments, ${formatCurrency(interestTotal)} total`);
  lines.push(`Fees: ${fees.length} charges, ${formatCurrency(feeTotal)} total`);
  lines.push(`Net Trade Volume: ${formatCurrency(buyVolume + sellVolume)}`);
  if (advisorList) lines.push(`Known Advisors: ${advisorList}`);
  lines.push("");

  // ── Activity by Account ──
  const accountMap = new Map<string, { number: string; name: string; total: number; buys: number; sells: number; buyVol: number; sellVol: number; divs: number; divVol: number }>();
  for (const t of trades) {
    const key = t.account_number as string;
    if (!accountMap.has(key)) {
      accountMap.set(key, { number: key, name: t.account_name as string, total: 0, buys: 0, sells: 0, buyVol: 0, sellVol: 0, divs: 0, divVol: 0 });
    }
    const a = accountMap.get(key)!;
    a.total++;
    const amt = Math.abs(Number(t.amount) || 0);
    if (t.transaction_type === "buy") { a.buys++; a.buyVol += amt; }
    else if (t.transaction_type === "sell") { a.sells++; a.sellVol += amt; }
    else if (t.transaction_type === "dividend") { a.divs++; a.divVol += amt; }
  }

  lines.push(`=== ACTIVITY BY ACCOUNT (${accountMap.size} active accounts) ===`);
  const sortedAccounts = [...accountMap.values()].sort((a, b) => (b.buyVol + b.sellVol) - (a.buyVol + a.sellVol));
  for (const a of sortedAccounts) {
    lines.push(`${a.number} | ${a.name} | Total Txns: ${a.total} | Buys: ${a.buys} (${formatCurrency(a.buyVol)}) | Sells: ${a.sells} (${formatCurrency(a.sellVol)}) | Dividends: ${a.divs} (${formatCurrency(a.divVol)})`);
  }
  lines.push("");

  // ── Most Traded Securities ──
  const symbolMap = new Map<string, { symbol: string; name: string; buys: number; sells: number; buyVol: number; sellVol: number; totalQty: number }>();
  for (const t of trades) {
    if (!t.symbol || t.transaction_type === "fee" || t.transaction_type === "interest") continue;
    const sym = t.symbol as string;
    if (!symbolMap.has(sym)) {
      symbolMap.set(sym, { symbol: sym, name: (t.security_name || sym) as string, buys: 0, sells: 0, buyVol: 0, sellVol: 0, totalQty: 0 });
    }
    const s = symbolMap.get(sym)!;
    const amt = Math.abs(Number(t.amount) || 0);
    const qty = Math.abs(Number(t.quantity) || 0);
    if (t.transaction_type === "buy") { s.buys++; s.buyVol += amt; s.totalQty += qty; }
    else if (t.transaction_type === "sell") { s.sells++; s.sellVol += amt; s.totalQty += qty; }
  }

  lines.push(`=== MOST TRADED SECURITIES (${symbolMap.size} symbols) ===`);
  const sortedSymbols = [...symbolMap.values()].sort((a, b) => (b.buyVol + b.sellVol) - (a.buyVol + a.sellVol));
  for (const s of sortedSymbols.slice(0, 30)) {
    lines.push(`${s.symbol} | ${s.name} | Buys: ${s.buys} (${formatCurrency(s.buyVol)}) | Sells: ${s.sells} (${formatCurrency(s.sellVol)}) | Total Shares Traded: ${s.totalQty.toLocaleString()}`);
  }
  lines.push("");

  // ── Recent Trades (last 200 individual transactions) ──
  lines.push(`=== RECENT TRANSACTIONS (showing ${Math.min(trades.length, 200)} of ${trades.length}) ===`);
  for (const t of trades.slice(0, 200)) {
    const date = new Date(t.created_at as string);
    const dateStr = `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}/${date.getFullYear()}`;
    lines.push(
      `${dateStr} | ${String(t.transaction_type).toUpperCase()} | ${t.account_number} ${t.account_name} | ` +
      `${t.symbol || ""} ${t.security_name || ""} | ` +
      `Qty: ${t.quantity || ""} | Price: ${t.price ? `$${Number(t.price).toFixed(2)}` : ""} | ` +
      `Amount: ${formatCurrency(Number(t.amount) || 0)} | Fees: ${t.fees ? formatCurrency(Number(t.fees)) : "$0.00"} | ` +
      `Settled: ${t.settled_date || "Pending"}`
    );
  }
  lines.push("");

  // ── Account Reference (only accounts with recent trades, for focused context) ──
  const activeAccountNumbers = new Set(trades.map((t) => t.account_number as string));
  const activeAccounts = accounts.filter((a) => activeAccountNumbers.has(a.account_number as string));
  lines.push(`=== ACCOUNT REFERENCE (${activeAccounts.length} accounts with recent activity) ===`);
  lines.push("Use this section to answer questions about any account mentioned in the trades above (model, rep code, household, type, value, etc.).");
  for (const a of activeAccounts) {
    const feeRate = Number(a.fee_rate) || 0;
    const balance = Number(a.total_value) || 0;
    const annualFee = balance * feeRate;
    const feeStr = feeRate > 0
      ? `Fee: ${formatPct(feeRate * 100)} (${formatCurrency(annualFee)}/yr) | Schedule: ${a.fee_schedule || "N/A"} | Billing: ${a.billing_frequency || "N/A"}`
      : "Fee: N/A (non-managed)";
    lines.push(`${a.account_number} | ${a.account_name} | ${a.account_type} | Rep: ${a.rep_code || "N/A"} | Value: ${formatCurrency(balance)} | Cash: ${formatCurrency(Number(a.cash_balance) || 0)} | ${a.is_managed ? `Managed (${a.model_name})` : "Non-managed"} | ${feeStr} | Household: ${a.household_name || "N/A"}`);
  }

  return { context: lines.join("\n") };
}
