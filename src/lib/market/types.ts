/**
 * Shared types for the live market data layer.
 *
 * Isomorphic — imported by both server modules and "use client" components,
 * so this file must stay free of any Node or Next imports.
 */

/** Where a price came from. Surfaced to the UI so simulated data is always labelled. */
export type QuoteSource = "yahoo" | "simulated" | "db";

export type MarketPhase = "pre" | "open" | "post" | "closed" | "holiday";

/** "live" only ever means phase === "open". Everything else is simulated. */
export type MarketMode = "live" | "simulated";

export interface MarketStatus {
  phase: MarketPhase;
  mode: MarketMode;
  isOpen: boolean;
  /** ms epoch, quantized to the tick grid so every caller in a window agrees. */
  asOf: number;
  /** ms epoch of the next phase flip, so clients can anticipate the open. */
  nextChangeAt: number;
  /** Human label, e.g. "Simulated — market closed". Rendered verbatim. */
  label: string;
}

export interface LiveQuote {
  /** Always the DB form (BRK.B), never the Yahoo form (BRK-B). */
  symbol: string;
  price: number;
  /**
   * Live: Yahoo's regularMarketPreviousClose.
   * Simulated: the real last close, which is also the drift anchor.
   */
  previousClose: number;
  change: number;
  changePercent: number;
  source: QuoteSource;
  /** True when the last successful real fetch is older than the staleness bound. */
  stale: boolean;
}

export type QuoteMap = Record<string, LiveQuote>;

export interface LiveAccountValue {
  totalValue: number;
  dayChange: number;
  dayChangePct: number;
  /** How many of the account's symbols actually had a quote — a coverage signal. */
  pricedSymbols: number;
}

export type AccountValueMap = Record<string, LiveAccountValue>;

export interface MarketSnapshot {
  asOf: number;
  status: MarketStatus;
  /** True when Yahoo is unreachable or the circuit is open — values are last-good. */
  degraded: boolean;
  quotes: QuoteMap;
  /** Only present when the caller asked for account revaluation. */
  accounts?: AccountValueMap;
}
