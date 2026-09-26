/**
 * Self-test for the pure market modules.
 *
 * Runs without a server, a database, or a network — and crucially, without the
 * market being open, which is when this work has to be built and verified.
 *
 *   npx tsx scripts/market-selftest.ts
 */

import { getMarketStatus, quantize, TICK_MS } from "../src/lib/market/market-hours";
import {
  estimateVolatility,
  MAX_DRIFT_MULTIPLE,
  simulatePrice,
} from "../src/lib/market/simulate";
import { buildSymbolMap, isCashLike, toYahooSymbol } from "../src/lib/market/symbols";
import { applyAccountValues, reviveHoldings, totalFromHoldings } from "../src/lib/market/apply";
import type { QuoteMap } from "../src/lib/market/types";

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

const SYMBOLS = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "BRK.B", "JPM", "V",
  "SPY", "QQQ", "VTI", "BND", "AGG", "VOO", "IWM", "GLD", "XLF", "XLE",
];

// A fixed reference instant so the run is reproducible: 2026-08-03T14:00:00Z.
const T0 = quantize(Date.UTC(2026, 7, 3, 14, 0, 0));

// ---------------------------------------------------------------- determinism
section("Determinism (two clients must never see a jump)");

{
  const a = simulatePrice("AAPL", 200, 0.012, T0);
  const b = simulatePrice("AAPL", 200, 0.012, T0 + 3800);
  check("same 5s bucket → bit-identical", a === b, `${a} === ${b}`);
}

{
  const a = simulatePrice("AAPL", 200, 0.012, T0);
  const b = simulatePrice("AAPL", 200, 0.012, T0 + TICK_MS);
  check("next bucket → price moves", a !== b, `${a.toFixed(4)} → ${b.toFixed(4)}`);
}

{
  // Simulates a dev-server restart: same inputs, fresh call, no retained state.
  const first = SYMBOLS.map((s) => simulatePrice(s, 100, 0.012, T0));
  const second = SYMBOLS.map((s) => simulatePrice(s, 100, 0.012, T0));
  check(
    "stateless across calls (restart-safe)",
    first.every((v, i) => v === second[i]),
  );
}

// ------------------------------------------------------------- bounded drift
section("Bounded drift (a 30-min demo must not move a position 40%)");

{
  let maxDev = 0;
  let worst = "";
  const steps = (30 * 60 * 1000) / TICK_MS; // 30 minutes of ticks

  for (const sym of SYMBOLS) {
    for (let i = 0; i <= steps; i++) {
      const p = simulatePrice(sym, 100, 0.012, T0 + i * TICK_MS);
      const dev = Math.abs(p / 100 - 1);
      if (dev > maxDev) {
        maxDev = dev;
        worst = sym;
      }
    }
  }
  check(
    "max excursion < 3% over 30min × 20 symbols",
    maxDev < 0.03,
    `${(maxDev * 100).toFixed(3)}% (worst: ${worst})`,
  );
}

{
  // The theoretical bound, probed hard at the maximum allowed sigma.
  const sigma = 0.04;
  let maxDev = 0;
  const steps = (6 * 60 * 60 * 1000) / TICK_MS; // 6 hours
  for (let i = 0; i <= steps; i++) {
    const p = simulatePrice("NVDA", 500, sigma, T0 + i * TICK_MS);
    maxDev = Math.max(maxDev, Math.abs(p / 500 - 1));
  }
  const bound = sigma * MAX_DRIFT_MULTIPLE;
  check(
    "respects |drift| <= 1.35·sigma at sigma max, over 6h",
    maxDev <= bound + 1e-9,
    `${(maxDev * 100).toFixed(3)}% <= ${(bound * 100).toFixed(3)}%`,
  );
}

{
  // Mean reversion: the long-run average should sit on the anchor.
  let sum = 0;
  const steps = (4 * 60 * 60 * 1000) / TICK_MS;
  for (let i = 0; i <= steps; i++) sum += simulatePrice("AAPL", 200, 0.012, T0 + i * TICK_MS);
  const mean = sum / (steps + 1);
  check(
    "mean reverts to anchor over 4h",
    Math.abs(mean / 200 - 1) < 0.005,
    `mean ${mean.toFixed(4)} vs anchor 200`,
  );
}

// ------------------------------------------------------------------ cash pin
section("Cash and money-market positions never drift");

{
  const ok = Array.from({ length: 500 }, (_, i) =>
    simulatePrice("VMFXX", 1, 0, T0 + i * TICK_MS),
  ).every((p) => p === 1);
  check("VMFXX with sigma 0 pinned at 1.00", ok);
}

{
  // Even if a nonzero sigma leaks in, cash-like symbols must not move.
  const ok = Array.from({ length: 500 }, (_, i) =>
    simulatePrice("SPAXX", 1, 0.02, T0 + i * TICK_MS),
  ).every((p) => p === 1);
  check("SPAXX pinned even with nonzero sigma", ok);
}

check("isCashLike covers all four", ["CASH", "VMFXX", "SPAXX", "SWVXX"].every(isCashLike));

// ---------------------------------------------------------------- decorrelation
section("Symbols move independently (the #1 tell of a fake feed)");

function correlation(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i]! - ma;
    const xb = b[i]! - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

{
  const steps = (30 * 60 * 1000) / TICK_MS;
  const series = (sym: string) =>
    Array.from({ length: steps }, (_, i) => simulatePrice(sym, 100, 0.012, T0 + i * TICK_MS));

  const rho = Math.abs(correlation(series("AAPL"), series("MSFT")));
  check("|corr(AAPL, MSFT)| < 0.5", rho < 0.5, `rho = ${rho.toFixed(3)}`);

  // Every pair, not just the one we happened to pick. Note that real equities
  // ARE correlated — sector peers routinely run 0.5-0.8 — so the goal is not
  // zero correlation, it is the absence of lockstep.
  let worstPair = "";
  let worstRho = 0;
  let sumRho = 0;
  let pairs = 0;
  const cached = SYMBOLS.map(series);
  for (let i = 0; i < SYMBOLS.length; i++) {
    for (let j = i + 1; j < SYMBOLS.length; j++) {
      const r = Math.abs(correlation(cached[i]!, cached[j]!));
      sumRho += r;
      pairs++;
      if (r > worstRho) {
        worstRho = r;
        worstPair = `${SYMBOLS[i]}/${SYMBOLS[j]}`;
      }
    }
  }
  const meanRho = sumRho / pairs;
  check(
    `mean |corr| across ${pairs} pairs < 0.35`,
    meanRho < 0.35,
    `mean = ${meanRho.toFixed(3)}`,
  );
  check(
    "no pair is in lockstep (worst < 0.9)",
    worstRho < 0.9,
    `${worstPair} = ${worstRho.toFixed(3)}`,
  );
}

// ---------------------------------------------------------------- volatility
section("Volatility estimation from real Yahoo fields");

{
  // Parkinson: 0.6006 * ln(202/198) = ~0.01201
  const s = estimateVolatility({ regularMarketDayHigh: 202, regularMarketDayLow: 198 });
  check("Parkinson estimator from high/low", Math.abs(s - 0.01201) < 0.0005, `sigma = ${s.toFixed(5)}`);
}

check(
  "falls back to day move when no high/low",
  Math.abs(estimateVolatility({ regularMarketChangePercent: 1.5 }) - 0.015) < 1e-9,
);
check("ETF default when nothing usable", estimateVolatility({ quoteType: "ETF" }) === 0.008);
check("equity default when nothing usable", estimateVolatility({ quoteType: "EQUITY" }) === 0.012);
check("money market → sigma 0", estimateVolatility({ assetClass: "cash" }) === 0);
check(
  "clamped to sigma max",
  estimateVolatility({ regularMarketDayHigh: 200, regularMarketDayLow: 100 }) === 0.04,
);

// ------------------------------------------------------------------- symbols
section("Symbol mapping");

check("BRK.B → BRK-B", toYahooSymbol("BRK.B") === "BRK-B");
check(
  "multi-dot maps every occurrence (the replace/replaceAll bug)",
  toYahooSymbol("A.B.C") === "A-B-C",
  toYahooSymbol("A.B.C"),
);

{
  const { yahooSymbols, toDb } = buildSymbolMap(["AAPL", "BRK.B", "A.B.C", "BTC-USD"]);
  check("map produces Yahoo forms", yahooSymbols.join(",") === "AAPL,BRK-B,A-B-C,BTC-USD");
  check("reverse lookup is exact for multi-dot", toDb.get("A-B-C") === "A.B.C");
  check(
    "already-hyphenated tickers survive the round trip",
    toDb.get("BTC-USD") === "BTC-USD",
    "an inverse un-hyphenate would have corrupted this",
  );
}

// --------------------------------------------------------------------- apply
section("Derivation (why the six pages agree)");

{
  const quotes: QuoteMap = {
    AAPL: {
      symbol: "AAPL", price: 210.5, previousClose: 208, change: 2.5,
      changePercent: 1.2019, source: "simulated", stale: false,
    },
    CASH: {
      symbol: "CASH", price: 1, previousClose: 1, change: 0,
      changePercent: 0, source: "db", stale: false,
    },
  };

  const rows = [
    { symbol: "AAPL", quantity: 100, price: 178.5, market_value: 17850, day_change: 0, day_change_pct: 0 },
    { symbol: "CASH", quantity: 5000, price: 1, market_value: 5000, day_change: 0, day_change_pct: 0 },
    { symbol: "ZZZZ", quantity: 10, price: 50, market_value: 500, day_change: 0, day_change_pct: 0 },
  ];

  const revived = reviveHoldings(rows, quotes);
  check("holding revalued as quantity × live price", revived[0]!.market_value === 21050);
  check("day change is quantity × per-share change", revived[0]!.day_change === 250);
  check("CASH untouched by revaluation", revived[1]!.market_value === 5000 && revived[1]!.day_change === 0);
  check("unquoted symbol passes through", revived[2]!.market_value === 500);

  const t = totalFromHoldings(revived);
  check("roll-up equals sum of parts", t.totalValue === 21050 + 5000 + 500, `${t.totalValue}`);
  check("roll-up day change", t.dayChange === 250);

  // The consistency guarantee: a page that sums holdings and a page that reads
  // the account map must produce the same number.
  const accounts = applyAccountValues(
    [{ id: "acct1", total_value: 0, day_change: 0, day_change_pct: 0 }],
    { acct1: { totalValue: t.totalValue, dayChange: t.dayChange, dayChangePct: t.dayChangePct, pricedSymbols: 2 } },
  );
  check(
    "account overlay matches the holdings roll-up to the cent",
    accounts[0]!.total_value === t.totalValue && accounts[0]!.day_change === t.dayChange,
  );
}

// -------------------------------------------------------------- market hours
section("Market hours (America/New_York)");

{
  // 2026-08-03 is a Monday. 13:30 UTC = 09:30 ET (EDT).
  const open = getMarketStatus(Date.UTC(2026, 7, 3, 14, 0));
  check("Mon 10:00 ET → open/live", open.phase === "open" && open.mode === "live", open.label);

  const preOpen = getMarketStatus(Date.UTC(2026, 7, 3, 12, 0));
  check("Mon 08:00 ET → pre/simulated", preOpen.phase === "pre" && preOpen.mode === "simulated");

  const evening = getMarketStatus(Date.UTC(2026, 7, 4, 1, 0));
  check("Mon 21:00 ET → closed/simulated", evening.phase === "closed" && evening.mode === "simulated");

  const sat = getMarketStatus(Date.UTC(2026, 7, 1, 16, 0));
  check("Saturday → closed", sat.phase === "closed" && !sat.isOpen);

  const july4 = getMarketStatus(Date.UTC(2026, 6, 3, 15, 0));
  check("2026-07-03 holiday → holiday", july4.phase === "holiday", july4.label);

  const xmasEve = getMarketStatus(Date.UTC(2026, 11, 24, 19, 0));
  check("Christmas Eve 14:00 ET → post (early close)", xmasEve.phase === "post");

  check("label always names simulation when closed", evening.label.includes("Simulated"), evening.label);
  check("asOf is quantized to the tick grid", open.asOf % TICK_MS === 0);
}

// -------------------------------------------------------------------- report
const total = passed + failed;
console.log(
  `\n\x1b[1m${failed === 0 ? "\x1b[32mPASS" : "\x1b[31mFAIL"}\x1b[0m  ${passed}/${total} checks passed\n`,
);
process.exit(failed === 0 ? 0 : 1);
