/**
 * Symbol normalization between the DB form and the Yahoo form.
 *
 * Isomorphic — no Node or Next imports.
 */

/**
 * Symbols that represent cash or money-market positions. These are never
 * simulated and never carry a day change: their price is a NAV that sits at
 * or near 1.00, so drifting them would invent losses on a client's cash.
 */
export const CASH_LIKE = new Set(["CASH", "VMFXX", "SPAXX", "SWVXX"]);

export function isCashLike(symbol: string): boolean {
  return CASH_LIKE.has(symbol.toUpperCase());
}

/**
 * DB symbol → Yahoo symbol. Yahoo uses hyphens where the DB uses dots.
 *
 * Uses replaceAll, not replace: `String.replace` with a string pattern only
 * substitutes the first occurrence, so a multi-dot ticker silently produced a
 * malformed Yahoo symbol.
 */
export function toYahooSymbol(symbol: string): string {
  return symbol.replaceAll(".", "-");
}

/**
 * Build a per-request Yahoo → DB lookup.
 *
 * This deliberately replaces a `fromYahooSymbol` inverse, which is not
 * recoverable in general: un-hyphenating would corrupt legitimately hyphenated
 * tickers like BTC-USD or RDS-A. The caller always knows which DB symbols it
 * asked for, so the reverse mapping is a fact rather than a guess.
 *
 * Duplicate Yahoo forms keep the first DB symbol that produced them.
 */
export function buildSymbolMap(dbSymbols: string[]): {
  yahooSymbols: string[];
  toDb: Map<string, string>;
} {
  const toDb = new Map<string, string>();
  const yahooSymbols: string[] = [];

  for (const db of dbSymbols) {
    const y = toYahooSymbol(db);
    if (toDb.has(y)) continue;
    toDb.set(y, db);
    yahooSymbols.push(y);
  }

  return { yahooSymbols, toDb };
}

/** De-duplicate and normalize a caller-supplied symbol list. */
export function normalizeSymbols(symbols: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of symbols) {
    const s = raw.trim().toUpperCase();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}
