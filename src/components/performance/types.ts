// Performance page domain types + filter constants. Rows join the AccountPerformance
// table (camelCase Prisma columns) with the portfolio_accounts view (snake_case).

// Trailing return windows stored in AccountPerformance (1, 3, and 12 months, all
// ending on the same as-of date) — labeled as trailing periods, not MTD/QTD/YTD.
export type Period = "1M" | "3M" | "1Y";

export type PerformanceRow = {
  id: string; // portfolio_accounts.id (= Account.id)
  account_number: string;
  account_name: string;
  household_name: string;
  custodian: string;
  beginning_value: number;
  ending_value: number;
  net_flows: number;
  twr: number; // fraction: 0.0825 = 8.25%
  benchmark: number | null; // fraction
  alpha: number | null; // percentage points: (twr - benchmark) * 100
  period_end: string; // ISO date, drives the "As of" chip
};

export const PERIOD_FILTERS: { value: Period; label: string }[] = [
  { value: "1M", label: "1M" },
  { value: "3M", label: "3M" },
  { value: "1Y", label: "1Y" },
];

export type AlphaFilter = "all" | "outperforming" | "underperforming";

export const ALPHA_FILTERS: { value: AlphaFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "outperforming", label: "Outperforming" },
  { value: "underperforming", label: "Underperforming" },
];

// AUM-weighted TWR/benchmark over the benchmark-non-null subset — same subset and
// denominator for both so the derived alpha compares like with like.
export function weightedStats(rows: PerformanceRow[]): {
  twr: number | null;
  benchmark: number | null;
  alpha: number | null;
} {
  const subset = rows.filter((r) => r.benchmark !== null);
  const denom = subset.reduce((s, r) => s + r.ending_value, 0);
  if (denom <= 0) return { twr: null, benchmark: null, alpha: null };
  const twr = subset.reduce((s, r) => s + r.ending_value * r.twr, 0) / denom;
  const benchmark = subset.reduce((s, r) => s + r.ending_value * (r.benchmark as number), 0) / denom;
  return { twr, benchmark, alpha: (twr - benchmark) * 100 };
}

export function formatPct(fraction: number | null): string {
  if (fraction === null) return "—";
  return `${(fraction * 100).toFixed(2)}%`;
}

// Signed percentage-point figure for alpha, e.g. "+1.34 pp" / "-0.87 pp".
export function formatPp(pp: number | null): string {
  if (pp === null) return "—";
  return `${pp >= 0 ? "+" : ""}${pp.toFixed(2)} pp`;
}
