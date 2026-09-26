// SERVER ONLY — never import from a "use client" module.
/**
 * Server-side revaluation of the whole book.
 *
 * This is what lets pages that never load a single holding row — /accounts/cash,
 * /households, /billing — show exactly the same account total as the portfolio
 * page that does. The book is ~6,500 rows and reloads every few minutes; the
 * revaluation itself is a few thousand multiplications, so it can run on every
 * request without caching.
 */

import { paginateQuery } from "@/lib/supabase-paginate";
import { supabase } from "@/lib/supabase";

import { isCashLike } from "./symbols";
import type { AccountValueMap, QuoteMap } from "./types";

interface BookRow {
  accountId: string;
  symbol: string;
  quantity: number;
  /** Authoritative dollar value for cash-like rows, and the fallback for the rest. */
  marketValue: number;
}

export interface BookIndex {
  byAccount: Map<string, BookRow[]>;
  loadedAt: number;
  rows: number;
}

const BOOK_TTL_MS = 5 * 60_000;
const STATE_KEY = Symbol.for("composer.market.book");

function slot(): { book: BookIndex | null } {
  const g = globalThis as unknown as Record<symbol, { book: BookIndex | null } | undefined>;
  if (!g[STATE_KEY]) g[STATE_KEY] = { book: null };
  return g[STATE_KEY]!;
}

/**
 * Load every holding, keyed by account.
 *
 * Uses paginateQuery because Holding is well past Supabase's 1000-row default
 * limit — a plain select would silently return the first 1000 and every
 * account past that would price at zero.
 */
export async function loadBook(force = false): Promise<BookIndex> {
  const s = slot();
  const now = Date.now();
  if (!force && s.book && now - s.book.loadedAt < BOOK_TTL_MS) return s.book;

  try {
    const rows = await paginateQuery<{
      accountId: string;
      symbol: string;
      quantity: number | string | null;
      marketValue: number | string | null;
    }>((from, to) =>
      supabase
        .from("Holding")
        .select("accountId, symbol, quantity, marketValue")
        .range(from, to),
    );

    const byAccount = new Map<string, BookRow[]>();
    for (const r of rows) {
      if (!r.accountId || !r.symbol) continue;
      const list = byAccount.get(r.accountId) ?? [];
      list.push({
        accountId: r.accountId,
        symbol: r.symbol.toUpperCase(),
        quantity: Number(r.quantity) || 0,
        marketValue: Number(r.marketValue) || 0,
      });
      byAccount.set(r.accountId, list);
    }

    s.book = { byAccount, loadedAt: now, rows: rows.length };
    return s.book;
  } catch (e) {
    console.error("[market] loadBook failed:", e);
    // Keep serving the previous book rather than dropping every account total.
    return s.book ?? { byAccount: new Map(), loadedAt: 0, rows: 0 };
  }
}

/**
 * Revalue accounts against a quote map.
 *
 * Cash-like rows contribute their stored dollar value rather than
 * quantity × price: the quantity/cashBalance relationship is only guaranteed
 * immediately after `db:update-prices` runs, whereas marketValue is always the
 * dollar figure the rest of the app treats as the cash position.
 *
 * A holding with no quote falls back to its stored marketValue, so an account
 * is never partially priced — it either reflects live data or the last known
 * value, never a zero.
 */
export function revalueBook(
  book: BookIndex,
  quotes: QuoteMap,
  accountIds?: string[],
): AccountValueMap {
  const out: AccountValueMap = {};
  const ids = accountIds?.length ? accountIds : [...book.byAccount.keys()];

  for (const id of ids) {
    const rows = book.byAccount.get(id);
    if (!rows) continue;

    let totalValue = 0;
    let dayChange = 0;
    let pricedSymbols = 0;

    for (const row of rows) {
      if (isCashLike(row.symbol)) {
        totalValue += row.marketValue || row.quantity;
        continue;
      }

      const q = quotes[row.symbol];
      if (q && Number.isFinite(q.price) && q.price > 0) {
        totalValue += row.quantity * q.price;
        dayChange += row.quantity * q.change;
        pricedSymbols++;
      } else {
        totalValue += row.marketValue;
      }
    }

    const base = totalValue - dayChange;
    out[id] = {
      totalValue: Math.round(totalValue * 100) / 100,
      dayChange: Math.round(dayChange * 100) / 100,
      dayChangePct: base > 0 ? Math.round((dayChange / base) * 10000) / 100 : 0,
      pricedSymbols,
    };
  }

  return out;
}
