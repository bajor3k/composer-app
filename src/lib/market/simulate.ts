/**
 * Intraday price simulation for when the market is closed.
 *
 * Isomorphic — no Node or Next imports.
 *
 * Design constraint that drives everything here: price is a PURE FUNCTION of
 * (symbol, anchor, sigma, quantized time). It is not an accumulating random
 * walk. A walk would break three things we need:
 *
 *   1. Two clients polling 400ms apart would see different prices for the same
 *      symbol, and the six account pages would stop agreeing.
 *   2. A dev-server restart or HMR reload would reset the walk and make every
 *      position jump mid-demo.
 *   3. Drift would be unbounded — a long session could wander a position 40%.
 *
 * Because every term below is zero-mean and oscillatory with no cumulative
 * component, mean reversion is free and the excursion is bounded by
 * construction at |drift| <= 1.35 * sigma.
 */

import { TICK_MS } from "./market-hours";
import { isCashLike } from "./symbols";

export { TICK_MS };

/** Noise evolves on a slower grid than the tick, so 5s samples interpolate it smoothly. */
const NOISE_PERIOD_MS = 30_000;

/**
 * Base oscillator periods in seconds. Chosen mutually indivisible so the
 * composite waveform has no visible repeat inside a demo-length window.
 *
 * These are only a base: each symbol gets its periods jittered (see
 * `periodFor`). Shared frequencies with per-symbol phase offsets are NOT
 * enough to decorrelate — two symbols that happen to draw similar phases stay
 * locked together for the whole session. The self-test caught exactly that,
 * with NVDA and QQQ correlating at 0.996.
 */
const P1 = 137;
const P2 = 419;
const P3 = 1301;

/** Amplitudes sum to 1.35 — this sum IS the drift bound. */
const A1 = 0.4;
const A2 = 0.25;
const A3 = 0.15;
/**
 * The noise term is the largest single contributor because it is the only
 * fully independent one: it is seeded per symbol AND per time bucket, so it
 * cannot phase-lock with another symbol the way a sinusoid can.
 */
const A_NOISE = 0.55;

export const MAX_DRIFT_MULTIPLE = A1 + A2 + A3 + A_NOISE;

export const SIGMA_MIN = 0.0015;
export const SIGMA_MAX = 0.04;

/** FNV-1a. Cheap, well-distributed, and identical across every JS runtime. */
function hash32(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic hash in [0, 1). */
function unitHash(str: string): number {
  return hash32(str) / 4294967296;
}

/** Hermite smoothstep — C1-continuous, so interpolated noise has no kinks. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Value noise in [-1, 1]: smoothly interpolated between per-bucket hashes.
 * Sampling this at the 5s tick grid over a 30s bucket yields a visibly
 * different value every tick while staying continuous.
 */
function valueNoise(symbol: string, atMs: number): number {
  const pos = atMs / NOISE_PERIOD_MS;
  const idx = Math.floor(pos);
  const frac = pos - idx;

  const a = unitHash(`${symbol}#${idx}`) * 2 - 1;
  const b = unitHash(`${symbol}#${idx + 1}`) * 2 - 1;

  return a + (b - a) * smoothstep(frac);
}

/**
 * Per-symbol phase offset for oscillator k.
 *
 * This is what stops every position moving in lockstep, which is the single
 * most obvious tell that a price feed is fake.
 */
function phase(symbol: string, k: number): number {
  return unitHash(`${symbol}|${k}`) * 2 * Math.PI;
}

/**
 * Per-symbol period for oscillator k, jittered to +/-30% of the base.
 *
 * Distinct frequencies are what actually decorrelate two symbols: with a
 * shared frequency, a phase offset only slides one curve along the other and
 * the correlation over a fixed window stays near 1. With different periods the
 * two drift in and out of phase and cannot stay locked.
 */
function periodFor(symbol: string, k: number, base: number): number {
  return base * (0.55 + 0.9 * unitHash(`${symbol}~${k}`));
}

/**
 * Simulated price for a symbol at a point in time.
 *
 * @param symbol  DB symbol — also the seed for phase offsets and noise.
 * @param anchor  The real last close. The price oscillates around this and
 *                never wanders away from it.
 * @param sigma   Daily volatility as a decimal fraction (0.012 = 1.2%).
 * @param atMs    Timestamp. Quantized internally, so callers within the same
 *                5s window get a bit-identical result.
 */
export function simulatePrice(
  symbol: string,
  anchor: number,
  sigma: number,
  atMs: number,
): number {
  if (!Number.isFinite(anchor) || anchor <= 0) return anchor;
  // Cash and money-market positions hold their NAV exactly.
  if (sigma <= 0 || isCashLike(symbol)) return anchor;

  const t = Math.floor(atMs / TICK_MS) * TICK_MS;
  const s = t / 1000;

  const drift =
    sigma *
    (A1 * Math.sin((2 * Math.PI * s) / periodFor(symbol, 1, P1) + phase(symbol, 1)) +
      A2 * Math.sin((2 * Math.PI * s) / periodFor(symbol, 2, P2) + phase(symbol, 2)) +
      A3 * Math.sin((2 * Math.PI * s) / periodFor(symbol, 3, P3) + phase(symbol, 3)) +
      A_NOISE * valueNoise(symbol, t));

  const price = anchor * (1 + drift);
  // Guard against a pathological sigma driving a non-positive price.
  return price > 0 ? price : anchor;
}

/** Default daily volatility by instrument type, used when Yahoo gives us nothing to measure. */
function defaultSigma(quoteType?: string, assetClass?: string): number {
  const t = (quoteType ?? "").toUpperCase();
  const a = (assetClass ?? "").toLowerCase();

  if (a === "cash" || t === "MONEYMARKET") return 0;
  if (a === "fixed_income" || a === "bond") return 0.003;
  if (t === "ETF" || t === "MUTUALFUND" || a === "etf") return 0.008;
  return 0.012;
}

export interface VolatilityInput {
  regularMarketDayHigh?: number | null;
  regularMarketDayLow?: number | null;
  regularMarketPrice?: number | null;
  regularMarketChangePercent?: number | null;
  quoteType?: string | null;
  assetClass?: string | null;
}

/**
 * Estimate daily volatility from fields already present in the batch quote —
 * so this costs zero extra Yahoo requests.
 *
 * Primary estimator is Parkinson's high-low range:
 *
 *     sigma ~= ln(high / low) / (2 * sqrt(ln 2))  ~=  0.601 * ln(high / low)
 *
 * which is materially more efficient than a close-to-close estimate off a
 * single observation. Falls back to the day's own move, then to a type default.
 */
export function estimateVolatility(q: VolatilityInput): number {
  const high = q.regularMarketDayHigh ?? 0;
  const low = q.regularMarketDayLow ?? 0;

  if (
    (q.assetClass ?? "").toLowerCase() === "cash" ||
    (q.quoteType ?? "").toUpperCase() === "MONEYMARKET"
  ) {
    return 0;
  }

  let sigma: number;

  if (high > 0 && low > 0 && high > low) {
    sigma = 0.6005612 * Math.log(high / low);
  } else if (q.regularMarketChangePercent != null && q.regularMarketChangePercent !== 0) {
    sigma = Math.abs(q.regularMarketChangePercent) / 100;
  } else {
    sigma = defaultSigma(q.quoteType ?? undefined, q.assetClass ?? undefined);
  }

  if (!Number.isFinite(sigma) || sigma <= 0) {
    sigma = defaultSigma(q.quoteType ?? undefined, q.assetClass ?? undefined);
  }
  if (sigma === 0) return 0;

  return Math.min(SIGMA_MAX, Math.max(SIGMA_MIN, sigma));
}
