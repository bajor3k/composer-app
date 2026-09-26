/**
 * The single derivation layer: turns a quote map into revalued rows.
 *
 * Isomorphic — no Node or Next imports.
 *
 * Every account surface routes through these functions rather than doing its
 * own arithmetic. That is the whole point: before this existed, /accounts/portfolio
 * computed `quantity * livePrice` client-side while /accounts/holdings, /cash,
 * /households and /billing each rendered a different stored scalar, so the same
 * account showed different totals depending on which page you were looking at.
 *
 * Rounding also lives here and nowhere else, at the precisions declared in
 * prisma/schema.prisma. One rounding site is what guarantees a roll-up and a
 * drill-down cannot disagree by a cent.
 */

import { isCashLike } from "./symbols";
import type { AccountValueMap, LiveQuote, QuoteMap } from "./types";

/** Holding.marketValue is Decimal(18,2); day change is a dollar amount. */
const MONEY_DP = 2;
/** Holding.price is Decimal(18,4). */
const PRICE_DP = 4;
const PCT_DP = 2;

function round(n: number, dp: number): number {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export interface HoldingLike {
  symbol: string;
  quantity: number;
  price: number;
  market_value: number;
  day_change: number;
  day_change_pct: number;
}

/**
 * Revalue one holding against a live quote.
 *
 * Cash-like symbols are skipped entirely — their price is a NAV, and drifting
 * it would invent gains and losses on a client's cash. Skipping here also makes
 * the app immune to a long-standing asymmetry in the DB views, where
 * holdings_enriched excludes CASH/VMFXX/SPAXX/SWVXX from day_change but
 * portfolio_accounts excludes only CASH.
 */
export function applyQuote<T extends HoldingLike>(row: T, q: LiveQuote | undefined): T {
  if (!q || isCashLike(row.symbol)) return row;
  if (!Number.isFinite(q.price) || q.price <= 0) return row;

  return {
    ...row,
    price: round(q.price, PRICE_DP),
    market_value: round(row.quantity * q.price, MONEY_DP),
    day_change: round(row.quantity * q.change, MONEY_DP),
    day_change_pct: round(q.changePercent, PCT_DP),
  };
}

/** Revalue a list of holdings. Rows without a quote pass through untouched. */
export function reviveHoldings<T extends HoldingLike>(rows: T[], quotes: QuoteMap): T[] {
  if (!rows.length || !quotes || Object.keys(quotes).length === 0) return rows;
  return rows.map((r) => applyQuote(r, quotes[r.symbol]));
}

/**
 * Roll a set of revalued holdings up to a total.
 *
 * day_change_pct is computed against the opening base (total minus the day's
 * change), not against the current total — the same convention the existing
 * views and tables use.
 */
export function totalFromHoldings(rows: HoldingLike[]): {
  totalValue: number;
  dayChange: number;
  dayChangePct: number;
} {
  let totalValue = 0;
  let dayChange = 0;

  for (const r of rows) {
    totalValue += r.market_value || 0;
    dayChange += r.day_change || 0;
  }

  const base = totalValue - dayChange;
  return {
    totalValue: round(totalValue, MONEY_DP),
    dayChange: round(dayChange, MONEY_DP),
    dayChangePct: base > 0 ? round((dayChange / base) * 100, PCT_DP) : 0,
  };
}

/**
 * Day-change fields are optional: the Cash and Households pages carry only a
 * total_value, and injecting fields they never render would just be noise.
 */
export interface AccountLike {
  id: string;
  total_value: number;
  day_change?: number;
  day_change_pct?: number;
}

/**
 * Overlay server-computed account values.
 *
 * Pages take totals from this map rather than summing holdings themselves, so
 * a page that never loads a single holding row (/cash, /households, /billing)
 * shows exactly the same number as the portfolio page that does.
 */
export function applyAccountValues<T extends AccountLike>(
  rows: T[],
  accounts: AccountValueMap,
): T[] {
  if (!rows.length || !accounts || Object.keys(accounts).length === 0) return rows;

  return rows.map((row) => {
    const v = accounts[row.id];
    if (!v) return row;

    const next: T = { ...row, total_value: round(v.totalValue, MONEY_DP) };
    // Only overwrite day-change fields the row actually declares.
    if ("day_change" in row) (next as AccountLike).day_change = round(v.dayChange, MONEY_DP);
    if ("day_change_pct" in row) {
      (next as AccountLike).day_change_pct = round(v.dayChangePct, PCT_DP);
    }
    return next;
  });
}

/** Sum a set of account values — used for household and firm-wide roll-ups. */
export function totalFromAccounts(
  ids: string[],
  accounts: AccountValueMap,
): { totalValue: number; dayChange: number; dayChangePct: number } {
  let totalValue = 0;
  let dayChange = 0;

  for (const id of ids) {
    const v = accounts[id];
    if (!v) continue;
    totalValue += v.totalValue;
    dayChange += v.dayChange;
  }

  const base = totalValue - dayChange;
  return {
    totalValue: round(totalValue, MONEY_DP),
    dayChange: round(dayChange, MONEY_DP),
    dayChangePct: base > 0 ? round((dayChange / base) * 100, PCT_DP) : 0,
  };
}
