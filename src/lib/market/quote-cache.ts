// SERVER ONLY — never import from a "use client" module.
/**
 * In-memory quote cache with stale-while-error semantics.
 *
 * The governing rule for every function here: a demo must never see an error.
 * An entry is never deleted on failure, `getSnapshot` never throws and never
 * returns empty once hydrated, and the worst case a caller can observe is
 * `degraded: true` with last-good values.
 */

import { supabase } from "@/lib/supabase";

import { getMarketStatus, quantize } from "./market-hours";
import { estimateVolatility, simulatePrice } from "./simulate";
import { isCashLike, normalizeSymbols } from "./symbols";
import type { LiveQuote, MarketSnapshot, QuoteMap, QuoteSource } from "./types";
import { fetchQuotesChunked } from "./yahoo";

interface CacheEntry {
  symbol: string;
  /** Last real regular-market price. The simulation oscillates around this. */
  anchor: number;
  previousClose: number;
  /** Daily volatility as a decimal fraction. 0 for cash-like instruments. */
  sigma: number;
  name: string;
  source: QuoteSource;
  /** ms of the last SUCCESSFUL real fetch. */
  fetchedAt: number;
  consecutiveFailures: number;
  lastError?: string;
}

/** A quote older than this is flagged stale to the UI (but still served). */
const STALE_MS = 5 * 60_000;

/** Ad-hoc symbols (terminal, watchlist) stay tracked this long after last use. */
const ADHOC_TTL_MS = 10 * 60_000;
const ADHOC_MAX = 100;

/** Book universe is re-read from Supabase at most this often. */
const UNIVERSE_TTL_MS = 5 * 60_000;

const FAILURES_BEFORE_CIRCUIT_OPEN = 3;
const CIRCUIT_BACKOFF_MS = 5 * 60_000;
const RATE_LIMIT_BACKOFF_MS = 10 * 60_000;

/**
 * Survives HMR and lazy per-route compilation in `next dev`, which re-evaluate
 * module scope and would otherwise silently drop the whole cache mid-session.
 */
const STATE_KEY = Symbol.for("composer.market.cache");

interface CacheState {
  entries: Map<string, CacheEntry>;
  adhoc: Map<string, number>; // symbol -> last requested at
  universe: string[];
  universeLoadedAt: number;
  hydrated: boolean;
  cycleFailures: number;
  circuitOpenUntil: number;
  inFlight: Promise<unknown> | null;
}

function state(): CacheState {
  const g = globalThis as unknown as Record<symbol, CacheState | undefined>;
  if (!g[STATE_KEY]) {
    g[STATE_KEY] = {
      entries: new Map(),
      adhoc: new Map(),
      universe: [],
      universeLoadedAt: 0,
      hydrated: false,
      cycleFailures: 0,
      circuitOpenUntil: 0,
      inFlight: null,
    };
  }
  return g[STATE_KEY]!;
}

/** Register symbols for refresh that aren't part of the book (terminal, watchlist). */
export function trackSymbols(symbols: string[]): void {
  const s = state();
  const now = Date.now();
  for (const sym of normalizeSymbols(symbols)) {
    s.adhoc.set(sym, now);
  }
  // Bound the set: drop the least recently requested first.
  if (s.adhoc.size > ADHOC_MAX) {
    const sorted = [...s.adhoc.entries()].sort((a, b) => a[1] - b[1]);
    for (const [sym] of sorted.slice(0, s.adhoc.size - ADHOC_MAX)) s.adhoc.delete(sym);
  }
}

/** The full set we refresh: the book universe plus live ad-hoc requests. */
export function getTrackedSymbols(): string[] {
  const s = state();
  const now = Date.now();
  const out = new Set(s.universe);
  for (const [sym, at] of s.adhoc) {
    if (now - at > ADHOC_TTL_MS) s.adhoc.delete(sym);
    else out.add(sym);
  }
  return [...out];
}

/** Reload the set of symbols the book actually holds. */
export async function loadUniverse(force = false): Promise<string[]> {
  const s = state();
  const now = Date.now();
  if (!force && s.universe.length > 0 && now - s.universeLoadedAt < UNIVERSE_TTL_MS) {
    return s.universe;
  }

  try {
    const { data } = await supabase.from("Security").select("symbol");
    if (data?.length) {
      s.universe = normalizeSymbols(data.map((r: { symbol: string }) => r.symbol));
      s.universeLoadedAt = now;
    }
  } catch (e) {
    console.error("[market] failed to load symbol universe:", e);
  }
  return s.universe;
}

/**
 * Seed the cache from the DB so the very first paint has numbers before Yahoo
 * answers. Also the fallback whenever Yahoo is unreachable at boot.
 */
export async function hydrateFromDb(): Promise<number> {
  const s = state();
  try {
    const { data } = await supabase
      .from("Security")
      .select("symbol, name, price, previousClose, assetClass");
    if (!data?.length) return 0;

    let n = 0;
    for (const row of data as Array<{
      symbol: string;
      name?: string | null;
      price?: number | string | null;
      previousClose?: number | string | null;
      assetClass?: string | null;
    }>) {
      const symbol = row.symbol?.toUpperCase();
      if (!symbol) continue;
      const price = Number(row.price);
      if (!Number.isFinite(price) || price <= 0) continue;

      // Only seed symbols we have nothing better for — never clobber a real
      // Yahoo fetch with a stale DB row.
      if (s.entries.has(symbol)) continue;

      // previousClose is NULL for every row in the seeded DB until
      // `npm run db:update-prices` runs, so fall back to price: a zero day
      // change is honest, a fabricated one is not.
      const prevRaw = Number(row.previousClose);
      const previousClose = Number.isFinite(prevRaw) && prevRaw > 0 ? prevRaw : price;

      s.entries.set(symbol, {
        symbol,
        anchor: price,
        previousClose,
        sigma: isCashLike(symbol)
          ? 0
          : estimateVolatility({ assetClass: row.assetClass ?? null }),
        name: row.name ?? symbol,
        source: "db",
        fetchedAt: 0, // never fetched for real — reported as stale
        consecutiveFailures: 0,
      });
      n++;
    }
    s.hydrated = true;
    return n;
  } catch (e) {
    console.error("[market] hydrateFromDb failed:", e);
    return 0;
  }
}

/**
 * Pull fresh quotes from Yahoo into the cache.
 *
 * Writes only on success. A failure bumps the failure counter and leaves the
 * previous value in place, which is what makes a network blip invisible to the
 * UI rather than a blank table.
 */
export async function refreshQuotes(
  symbols?: string[],
): Promise<{ ok: number; failed: number; rateLimited: boolean; skipped?: boolean }> {
  const s = state();
  const now = Date.now();

  if (now < s.circuitOpenUntil) {
    return { ok: 0, failed: 0, rateLimited: false, skipped: true };
  }

  const targets = symbols?.length ? normalizeSymbols(symbols) : getTrackedSymbols();
  if (targets.length === 0) return { ok: 0, failed: 0, rateLimited: false };

  const { quotes, failures, rateLimited } = await fetchQuotesChunked(targets);

  for (const [symbol, raw] of quotes) {
    const price = Number(raw.regularMarketPrice);
    if (!Number.isFinite(price) || price <= 0) continue;

    const prev = Number(raw.regularMarketPreviousClose);
    const existing = s.entries.get(symbol);

    s.entries.set(symbol, {
      symbol,
      anchor: price,
      previousClose: Number.isFinite(prev) && prev > 0 ? prev : price,
      sigma: isCashLike(symbol)
        ? 0
        : estimateVolatility({
            regularMarketDayHigh: raw.regularMarketDayHigh,
            regularMarketDayLow: raw.regularMarketDayLow,
            regularMarketPrice: raw.regularMarketPrice,
            regularMarketChangePercent: raw.regularMarketChangePercent,
            quoteType: raw.quoteType,
          }),
      name: raw.shortName || raw.longName || existing?.name || symbol,
      source: "yahoo",
      fetchedAt: now,
      consecutiveFailures: 0,
    });
  }

  for (const symbol of failures) {
    const e = s.entries.get(symbol);
    if (e) {
      e.consecutiveFailures++;
      e.lastError = "fetch failed";
    }
  }

  // Circuit breaker: a whole cycle returning nothing means Yahoo is down or
  // throttling us. Back off rather than hammering it for the rest of the demo.
  if (quotes.size === 0 && targets.length > 0) {
    s.cycleFailures++;
    if (rateLimited) {
      s.circuitOpenUntil = now + RATE_LIMIT_BACKOFF_MS;
      console.error("[market] rate limited by Yahoo — backing off 10m");
    } else if (s.cycleFailures >= FAILURES_BEFORE_CIRCUIT_OPEN) {
      s.circuitOpenUntil = now + CIRCUIT_BACKOFF_MS;
      console.error("[market] circuit open after 3 failed cycles — backing off 5m");
    }
  } else {
    s.cycleFailures = 0;
  }

  return { ok: quotes.size, failed: failures.length, rateLimited };
}

/**
 * Symbols currently being filled on demand, so two callers asking for the same
 * new symbol at the same moment share one upstream request instead of racing.
 */
const pendingFills = new Map<string, Promise<unknown>>();

/** Bounds a cold-start burst — a caller cannot turn one request into 200 upstream calls. */
const MAX_ONDEMAND_FILL = 50;

/**
 * Fetch any requested symbols that aren't in the cache yet.
 *
 * `trackSymbols` only registers a symbol for the NEXT scheduled refresh, which
 * is up to 15 minutes away while the market is closed. Without this, a symbol
 * newly added to a watchlist had no price until that cycle ran and the UI
 * rendered a dash in the meantime.
 *
 * Time-budgeted and fail-soft: if the fill is slow or fails, the caller still
 * gets whatever the cache already holds rather than an error or a hang.
 */
export async function ensureSymbols(symbols: string[], budgetMs = 2500): Promise<void> {
  const s = state();
  if (Date.now() < s.circuitOpenUntil) return;

  const missing = normalizeSymbols(symbols)
    .filter((sym) => !s.entries.has(sym))
    .slice(0, MAX_ONDEMAND_FILL);
  if (missing.length === 0) return;

  const waits: Promise<unknown>[] = [];
  const toFetch: string[] = [];

  for (const sym of missing) {
    const inflight = pendingFills.get(sym);
    if (inflight) waits.push(inflight);
    else toFetch.push(sym);
  }

  if (toFetch.length > 0) {
    const p = refreshQuotes(toFetch)
      .catch((e) => {
        console.error("[market] on-demand fill failed:", e);
      })
      .finally(() => {
        for (const sym of toFetch) pendingFills.delete(sym);
      });
    for (const sym of toFetch) pendingFills.set(sym, p);
    waits.push(p);
  }

  // Never let a slow upstream stall a 5s poll.
  await Promise.race([
    Promise.all(waits),
    new Promise((resolve) => setTimeout(resolve, budgetMs)),
  ]).catch(() => {});
}

/** Build the outward-facing quote for one entry at a point in time. */
function toLiveQuote(e: CacheEntry, mode: "live" | "simulated", asOf: number): LiveQuote {
  const stale = e.fetchedAt === 0 || asOf - e.fetchedAt > STALE_MS;

  // Cash and money-market positions hold their NAV in every mode.
  if (isCashLike(e.symbol) || e.sigma <= 0) {
    return {
      symbol: e.symbol,
      price: e.anchor,
      previousClose: e.previousClose,
      change: 0,
      changePercent: 0,
      source: e.source,
      stale,
    };
  }

  if (mode === "live") {
    const change = e.anchor - e.previousClose;
    return {
      symbol: e.symbol,
      price: e.anchor,
      previousClose: e.previousClose,
      change,
      changePercent: e.previousClose > 0 ? (change / e.previousClose) * 100 : 0,
      source: e.source,
      stale,
    };
  }

  // Simulated: the real last close is the reference for the session in
  // progress. Differencing against the prior close instead would bake in
  // yesterday's real move and make the number jump at midnight.
  const price = simulatePrice(e.symbol, e.anchor, e.sigma, asOf);
  const change = price - e.anchor;
  return {
    symbol: e.symbol,
    price,
    previousClose: e.anchor,
    change,
    changePercent: e.anchor > 0 ? (change / e.anchor) * 100 : 0,
    source: "simulated",
    stale,
  };
}

/**
 * Read the cache. Pure and synchronous — never fetches, never throws.
 */
export function getSnapshot(opts?: { symbols?: string[]; atMs?: number }): MarketSnapshot {
  const s = state();
  const status = getMarketStatus(opts?.atMs ?? Date.now());
  const asOf = quantize(opts?.atMs ?? Date.now());

  const wanted = opts?.symbols?.length ? new Set(normalizeSymbols(opts.symbols)) : null;

  const quotes: QuoteMap = {};
  for (const [symbol, entry] of s.entries) {
    if (wanted && !wanted.has(symbol)) continue;
    quotes[symbol] = toLiveQuote(entry, status.mode, asOf);
  }

  const degraded = Date.now() < s.circuitOpenUntil || s.cycleFailures > 0;

  return { asOf, status, degraded, quotes };
}

export function isHydrated(): boolean {
  return state().hydrated || state().entries.size > 0;
}

/** Track the in-flight bootstrap so concurrent callers await it instead of racing. */
export function setInFlight(p: Promise<unknown> | null): void {
  state().inFlight = p;
}

export function getInFlight(): Promise<unknown> | null {
  return state().inFlight;
}

export function cacheStats(): {
  size: number;
  oldestFetchMs: number;
  circuitOpen: boolean;
  universe: number;
  adhoc: number;
} {
  const s = state();
  let oldest = 0;
  const now = Date.now();
  for (const e of s.entries.values()) {
    if (e.fetchedAt > 0) oldest = Math.max(oldest, now - e.fetchedAt);
  }
  return {
    size: s.entries.size,
    oldestFetchMs: oldest,
    circuitOpen: now < s.circuitOpenUntil,
    universe: s.universe.length,
    adhoc: s.adhoc.size,
  };
}
