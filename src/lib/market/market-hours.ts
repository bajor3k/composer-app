/**
 * US equity market session detection, in America/New_York.
 *
 * Isomorphic — no Node or Next imports. The server is the sole authority on
 * market status; clients read it off every snapshot rather than computing it,
 * which is what stops a page opened before 09:30 from never going live.
 */

import type { MarketMode, MarketPhase, MarketStatus } from "./types";

/** The tick grid. Every price is quantized to this so all callers agree. */
export const TICK_MS = 5_000;

const OPEN_MIN = 9 * 60 + 30; // 09:30 ET
const CLOSE_MIN = 16 * 60; // 16:00 ET
const PRE_MIN = 4 * 60; // 04:00 ET
const POST_MIN = 20 * 60; // 20:00 ET

/**
 * NYSE full closures for 2026. Half-days (early 13:00 close) are listed
 * separately because the session still opens normally.
 */
const HOLIDAYS_2026 = new Set([
  "2026-01-01", // New Year's Day
  "2026-01-19", // MLK Jr. Day
  "2026-02-16", // Washington's Birthday
  "2026-04-03", // Good Friday
  "2026-05-25", // Memorial Day
  "2026-06-19", // Juneteenth
  "2026-07-03", // Independence Day (observed)
  "2026-09-07", // Labor Day
  "2026-11-26", // Thanksgiving
  "2026-12-25", // Christmas
]);

const HALF_DAYS_2026 = new Set([
  "2026-11-27", // day after Thanksgiving
  "2026-12-24", // Christmas Eve
]);

/** Floor a timestamp to the tick grid. */
export function quantize(atMs: number, gridMs: number = TICK_MS): number {
  return Math.floor(atMs / gridMs) * gridMs;
}

interface EtParts {
  year: number;
  month: number;
  day: number;
  weekday: number; // 0 = Sunday
  minutes: number; // minutes since ET midnight
  dateKey: string; // YYYY-MM-DD
}

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Decompose a timestamp into Eastern-time parts.
 *
 * Uses formatToParts rather than the `new Date(d.toLocaleString("en-US", ...))`
 * round-trip used elsewhere in the app: that trick depends on the host locale
 * producing a string Date can re-parse, which is not guaranteed.
 */
function etParts(atMs: number): EtParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(atMs))) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }

  // hour12:false can render midnight as "24" in some ICU versions.
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: WEEKDAYS[parts.weekday ?? "Mon"] ?? 1,
    minutes: hour * 60 + minute,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function closeMinuteFor(dateKey: string): number {
  return HALF_DAYS_2026.has(dateKey) ? 13 * 60 : CLOSE_MIN;
}

function phaseFor(p: EtParts): MarketPhase {
  if (p.weekday === 0 || p.weekday === 6) return "closed";
  if (HOLIDAYS_2026.has(p.dateKey)) return "holiday";

  const close = closeMinuteFor(p.dateKey);
  if (p.minutes >= OPEN_MIN && p.minutes < close) return "open";
  if (p.minutes >= PRE_MIN && p.minutes < OPEN_MIN) return "pre";
  if (p.minutes >= close && p.minutes < POST_MIN) return "post";
  return "closed";
}

/**
 * Next boundary at which the phase changes, so clients can anticipate the flip.
 * Approximate past the current day — it only needs to be soon enough that a
 * client re-polls and picks up the real transition.
 */
function nextChangeAt(atMs: number, p: EtParts): number {
  const close = closeMinuteFor(p.dateKey);
  const boundaries = [PRE_MIN, OPEN_MIN, close, POST_MIN];
  for (const b of boundaries) {
    if (p.minutes < b) return atMs + (b - p.minutes) * 60_000;
  }
  // Past the post-market close: next boundary is tomorrow's pre-open.
  return atMs + (24 * 60 - p.minutes + PRE_MIN) * 60_000;
}

const LABELS: Record<MarketPhase, string> = {
  open: "Live — market open",
  pre: "Simulated — pre-market",
  post: "Simulated — after hours",
  closed: "Simulated — market closed",
  holiday: "Simulated — market holiday",
};

/**
 * Current market status. `mode` is "live" only during the regular session:
 * pre- and post-market are treated as simulated because Yahoo's free quote
 * feed does not reliably tick outside regular hours.
 */
export function getMarketStatus(nowMs: number = Date.now()): MarketStatus {
  const p = etParts(nowMs);
  const phase = phaseFor(p);
  const mode: MarketMode = phase === "open" ? "live" : "simulated";

  return {
    phase,
    mode,
    isOpen: phase === "open",
    asOf: quantize(nowMs),
    nextChangeAt: nextChangeAt(nowMs, p),
    label: LABELS[phase],
  };
}
