// Workspace-chat action: pull every account that holds a given symbol (e.g. NVDA)
// across ALL custodians, and shape it for an in-chat table + Excel export.
// Triggered by the `/NVDA` slash command in src/app/chat/page.tsx.

import { supabase } from "@/lib/supabase";
import { exportToExcel } from "@/lib/report-export";

// Column order for the exported sheet / in-chat table source. report-export's
// formatKey/formatValue auto-applies currency formatting to keys containing
// value/price/cost; quantity stays a plain number.
export const SYMBOL_HOLDINGS_COLUMNS = [
  "account_number",
  "account_name",
  "client_name",
  "household_name",
  "custodian",
  "quantity",
  "price",
  "market_value",
  "cost_basis",
  "unrealized_value",
];

export type SymbolHoldingsRow = {
  account_number: string;
  account_name: string;
  client_name: string;
  household_name: string;
  custodian: string;
  quantity: number;
  price: number;
  market_value: number;
  cost_basis: number | null;
  unrealized_value: number | null;
};

export type SymbolHoldingsResult = {
  rows: SymbolHoldingsRow[];
  columns: string[];
  title: string;
  symbol: string;
  count: number; // accounts holding the symbol (= rows.length)
  totalMarketValue: number;
};

const BATCH = 1000; // Supabase caps a query at 1000 rows — page through with .range()

/**
 * Resolve a ticker to every account holding it (all custodians), newest price /
 * value first. Does NOT trigger a download — the chat renders a table and a
 * Download button that calls exportToExcel on the returned rows.
 *
 * Returns null when no account holds the symbol (caller shows an empty-state msg).
 */
export async function exportSymbolHoldings(symbolRaw: string): Promise<SymbolHoldingsResult | null> {
  const symbol = symbolRaw.trim().toUpperCase();
  if (!symbol) return null;

  // 1. Every holding of this symbol, across all accounts (holdings_enriched is
  //    keyed by accountId, so we resolve account metadata in step 2).
  const holdings: Record<string, unknown>[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("holdings_enriched")
      .select("accountId, symbol, quantity, price, marketValue, costBasis")
      .eq("symbol", symbol)
      .range(from, from + BATCH - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    holdings.push(...(data as Record<string, unknown>[]));
    if (data.length < BATCH) break;
    from += BATCH;
  }
  if (holdings.length === 0) return null;

  // 2. accountId → account metadata (number, holder, household, custodian).
  const accountIds = [...new Set(holdings.map((h) => String(h.accountId)))];
  const acctById = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < accountIds.length; i += BATCH) {
    const chunk = accountIds.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from("portfolio_accounts")
      .select("id, account_number, account_name, client_name, household_name, custodian")
      .in("id", chunk);
    if (error) throw new Error(error.message);
    for (const a of (data ?? []) as Record<string, unknown>[]) acctById.set(String(a.id), a);
  }

  // 3. Map holding + account → export/table row.
  const rows: SymbolHoldingsRow[] = holdings.map((h) => {
    const acct = acctById.get(String(h.accountId));
    const marketValue = Number(h.marketValue ?? 0);
    const costBasis = h.costBasis != null ? Number(h.costBasis) : null;
    return {
      account_number: String(acct?.account_number ?? "—"),
      account_name: String(acct?.account_name ?? ""),
      client_name: String(acct?.client_name ?? ""),
      household_name: String(acct?.household_name ?? ""),
      custodian: String(acct?.custodian ?? ""),
      quantity: Number(h.quantity ?? 0),
      price: Number(h.price ?? 0),
      market_value: marketValue,
      cost_basis: costBasis,
      unrealized_value: costBasis != null ? marketValue - costBasis : null,
    };
  });

  // Largest position first.
  rows.sort((a, b) => b.market_value - a.market_value);

  return {
    rows,
    columns: SYMBOL_HOLDINGS_COLUMNS,
    title: `${symbol} Holders`,
    symbol,
    count: rows.length,
    totalMarketValue: rows.reduce((s, r) => s + r.market_value, 0),
  };
}

/** Fire the Excel download for a previously-fetched symbol report. */
export function downloadSymbolHoldings(result: SymbolHoldingsResult): Promise<void> {
  return exportToExcel(result.rows, result.title, result.columns);
}
