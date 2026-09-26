// SERVER ONLY — never import from a "use client" module.
/**
 * The single Yahoo Finance seam.
 *
 * Before this, nine separate route files each constructed their own
 * `new YahooFinance(...)` at module scope, so the crumb/cookie handshake, the
 * error handling and the symbol mapping were all duplicated and subtly
 * divergent. Everything that talks to Yahoo should come through here.
 */

// @ts-ignore — the package ships its own types but not an ESM default export signature
import YahooFinance from "yahoo-finance2";

import { buildSymbolMap } from "./symbols";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

/**
 * Yahoo changes response shapes without warning, and a schema mismatch throws
 * by default. Validation off means a drifted field degrades to undefined
 * instead of taking a page down. The terminal routes already did this; the
 * quote routes did not.
 */
export const YF_OPTS = { validateResult: false as const };

/** Fetch in chunks so one oversized request cannot fail the whole set. */
const CHUNK_SIZE = 40;
const CHUNK_STAGGER_MS = 150;

export interface RawQuote {
  symbol: string;
  regularMarketPrice?: number | null;
  regularMarketPreviousClose?: number | null;
  regularMarketChange?: number | null;
  regularMarketChangePercent?: number | null;
  regularMarketDayHigh?: number | null;
  regularMarketDayLow?: number | null;
  shortName?: string | null;
  longName?: string | null;
  quoteType?: string | null;
}

export type YahooErrorKind = "rate-limit" | "not-found" | "network" | "schema" | "unknown";

/**
 * Classify a Yahoo failure so callers can respond correctly.
 *
 * This exists because /api/quote collapsed every error class — including a
 * Yahoo 429 — into `404 "Symbol not found"` with no logging, which made a
 * rate-limit indistinguishable from a bad ticker at the client.
 */
export function classifyYahooError(e: unknown): {
  kind: YahooErrorKind;
  status: number;
  message: string;
} {
  const msg = e instanceof Error ? e.message : String(e);
  const lower = msg.toLowerCase();

  if (lower.includes("429") || lower.includes("too many requests") || lower.includes("rate limit")) {
    return { kind: "rate-limit", status: 429, message: msg };
  }
  if (lower.includes("404") || lower.includes("not found") || lower.includes("no data found")) {
    return { kind: "not-found", status: 404, message: msg };
  }
  if (
    lower.includes("etimedout") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("econnreset") ||
    lower.includes("fetch failed") ||
    lower.includes("network") ||
    lower.includes("timeout")
  ) {
    return { kind: "network", status: 502, message: msg };
  }
  if (lower.includes("validation") || lower.includes("schema") || lower.includes("failed to parse")) {
    return { kind: "schema", status: 502, message: msg };
  }
  return { kind: "unknown", status: 502, message: msg };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch quotes for a set of DB symbols.
 *
 * Never throws. Partial success is the normal case and is reported rather than
 * discarded — the previous batch route returned a blanket 500 when any single
 * symbol failed, which blanked the entire portfolio page.
 */
export async function fetchQuotesChunked(dbSymbols: string[]): Promise<{
  quotes: Map<string, RawQuote>;
  failures: string[];
  rateLimited: boolean;
}> {
  const out = new Map<string, RawQuote>();
  const failures: string[] = [];
  let rateLimited = false;

  if (dbSymbols.length === 0) return { quotes: out, failures, rateLimited };

  const { yahooSymbols, toDb } = buildSymbolMap(dbSymbols);

  for (let i = 0; i < yahooSymbols.length; i += CHUNK_SIZE) {
    const chunk = yahooSymbols.slice(i, i + CHUNK_SIZE);

    try {
      // validateResult belongs in the third argument (moduleOptions); passing
      // it as query options is a silent no-op at best and a type error here.
      const res = await yf.quote(chunk, undefined, YF_OPTS);
      const rows: RawQuote[] = Array.isArray(res) ? res : [res];
      for (const r of rows) {
        if (!r?.symbol) continue;
        const db = toDb.get(r.symbol) ?? r.symbol;
        out.set(db, r);
      }
    } catch (e) {
      const { kind } = classifyYahooError(e);
      if (kind === "rate-limit") rateLimited = true;
      console.error(`[market] chunk failed (${kind}), retrying individually:`, chunk.join(","));

      // Retry the chunk symbol-by-symbol so one bad ticker cannot cost us the
      // other 39.
      for (const y of chunk) {
        try {
          const one = await yf.quote(y, undefined, YF_OPTS);
          const r: RawQuote | undefined = Array.isArray(one) ? one[0] : one;
          if (r?.symbol) out.set(toDb.get(r.symbol) ?? r.symbol, r);
          else failures.push(toDb.get(y) ?? y);
        } catch (inner) {
          const c = classifyYahooError(inner);
          if (c.kind === "rate-limit") rateLimited = true;
          failures.push(toDb.get(y) ?? y);
        }
      }
    }

    if (i + CHUNK_SIZE < yahooSymbols.length) await sleep(CHUNK_STAGGER_MS);
  }

  // Any symbol we asked for and never saw is a failure, even if no error threw.
  for (const db of dbSymbols) {
    if (!out.has(db) && !failures.includes(db)) failures.push(db);
  }

  return { quotes: out, failures, rateLimited };
}

export { yf };
