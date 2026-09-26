// Workspace-chat action: export all holdings for a single account to Excel.
// Triggered by the `/holdings` slash command in src/app/chat/page.tsx.

import { supabase } from "@/lib/supabase";
import { exportToExcel } from "@/lib/report-export";

// Column order for the exported sheet. Keys map into the row objects built below;
// report-export's formatKey/formatValue handle the display + currency formatting
// (anything containing value/price/cost gets $ formatting automatically).
const HOLDINGS_COLUMNS = [
  "symbol",
  "name",
  "asset_class",
  "quantity",
  "price",
  "market_value",
  "cost_basis",
  "unrealized_value",
  "day_change",
  "day_change_pct",
];

export type HoldingsExportResult = {
  rows: Record<string, unknown>[];
  columns: string[];
  title: string;
  count: number;
  accountNumber: string;
};

type AccountLike = { accountNumber: string };

/**
 * Resolve an account number to its holdings, fire the Excel download, and return
 * the payload so the chat can show a confirmation + re-download chip.
 *
 * Returns null when the account has no holdings (caller shows an empty-state msg).
 */
export async function exportAccountHoldings(
  account: AccountLike,
): Promise<HoldingsExportResult | null> {
  // 1. accountNumber → account id (holdings_enriched is keyed by accountId only).
  const { data: acctRow, error: acctErr } = await supabase
    .from("portfolio_accounts")
    .select("id")
    .eq("account_number", account.accountNumber)
    .maybeSingle();

  if (acctErr) throw new Error(acctErr.message);
  if (!acctRow?.id) throw new Error(`Account ${account.accountNumber} not found`);

  // 2. All holdings for the account, largest position first.
  const { data: holdings, error: holdErr } = await supabase
    .from("holdings_enriched")
    .select("*")
    .eq("accountId", acctRow.id)
    .order("marketValue", { ascending: false });

  if (holdErr) throw new Error(holdErr.message);
  if (!holdings || holdings.length === 0) return null;

  // 3. Map view rows → export rows (view uses camelCase column aliases).
  const rows: Record<string, unknown>[] = holdings.map((h) => {
    const marketValue = Number(h.market_value ?? h.marketValue ?? 0);
    const costBasis =
      h.cost_basis ?? h.costBasis ? Number(h.cost_basis ?? h.costBasis) : null;
    return {
      symbol: h.symbol,
      name: h.name,
      asset_class: h.asset_class ?? h.assetClass ?? "",
      quantity: Number(h.quantity ?? 0),
      price: Number(h.price ?? 0),
      market_value: marketValue,
      cost_basis: costBasis,
      unrealized_value: costBasis != null ? marketValue - costBasis : null,
      day_change: Number(h.day_change ?? 0),
      day_change_pct: Number(h.day_change_pct ?? 0),
    };
  });

  const title = `Holdings ${account.accountNumber}`;

  // 4. Fire the download (report-export handles workbook + filename + click).
  await exportToExcel(rows, title, HOLDINGS_COLUMNS);

  return {
    rows,
    columns: HOLDINGS_COLUMNS,
    title,
    count: rows.length,
    accountNumber: account.accountNumber,
  };
}
