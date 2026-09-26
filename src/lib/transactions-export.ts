// Workspace-chat action: export an account's transactions (all types) to Excel
// for a chosen timeframe. Triggered by the `/transactions` slash command in
// src/app/chat/page.tsx, which first asks the user to pick a timeframe.

import { supabase } from "@/lib/supabase";
import { exportToExcel } from "@/lib/report-export";

// Timeframe presets offered as chips after `/transactions`. `days` is the trailing
// window; omit it (All time) to pull every transaction. Adding more is one line.
export type Timeframe = { id: string; label: string; days?: number };

export const TIMEFRAMES: Timeframe[] = [
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "all", label: "All time" },
];

// Column order for the exported sheet. report-export's formatKey/formatValue
// handle display + currency formatting (price/amount get $; quantity stays numeric).
const TXN_COLUMNS = [
  "date",
  "type",
  "symbol",
  "name",
  "description",
  "quantity",
  "price",
  "amount",
];

export type TransactionsExportResult = {
  rows: Record<string, unknown>[];
  columns: string[];
  title: string;
  count: number;
  accountNumber: string;
  timeframeLabel: string;
};

type AccountLike = { accountNumber: string };

/**
 * Resolve an account number to its transactions for the given timeframe, fire the
 * Excel download, and return the payload so the chat can show a confirmation +
 * re-download chip. Returns null when there are no transactions in the window.
 */
export async function exportAccountTransactions(
  account: AccountLike,
  timeframeId: string,
): Promise<TransactionsExportResult | null> {
  const timeframe = TIMEFRAMES.find((t) => t.id === timeframeId) ?? TIMEFRAMES[0];

  // 1. accountNumber → account id (account_transactions is keyed by account_id).
  const { data: acctRow, error: acctErr } = await supabase
    .from("portfolio_accounts")
    .select("id")
    .eq("account_number", account.accountNumber)
    .maybeSingle();

  if (acctErr) throw new Error(acctErr.message);
  if (!acctRow?.id) throw new Error(`Account ${account.accountNumber} not found`);

  // 2. Transactions for the account, newest first, optionally windowed by date.
  let query = supabase
    .from("account_transactions")
    .select("date, type, symbol, name, description, quantity, price, amount")
    .eq("account_id", acctRow.id)
    .order("date", { ascending: false });

  if (timeframe.days != null) {
    const from = new Date();
    from.setDate(from.getDate() - timeframe.days);
    query = query.gte("date", from.toISOString().slice(0, 10));
  }

  const { data: txns, error: txnErr } = await query;
  if (txnErr) throw new Error(txnErr.message);
  if (!txns || txns.length === 0) return null;

  const rows: Record<string, unknown>[] = txns.map((t) => ({
    date: t.date,
    type: t.type,
    symbol: t.symbol,
    name: t.name,
    description: t.description,
    quantity: t.quantity != null ? Number(t.quantity) : null,
    price: t.price != null ? Number(t.price) : null,
    amount: t.amount != null ? Number(t.amount) : null,
  }));

  const title = `Transactions ${account.accountNumber}`;

  // 3. Fire the download (report-export handles workbook + filename + click).
  await exportToExcel(rows, title, TXN_COLUMNS);

  return {
    rows,
    columns: TXN_COLUMNS,
    title,
    count: rows.length,
    accountNumber: account.accountNumber,
    timeframeLabel: timeframe.label,
  };
}
