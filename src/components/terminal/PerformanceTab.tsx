"use client";

type ReturnPeriods = {
  ytd: number | null;
  oneYear: number | null;
  threeYear: number | null;
  fiveYear: number | null;
  tenYear: number | null;
};

interface FundPerformance {
  asOfDate: string | null;
  trailingReturns: ReturnPeriods;
  benchmark: ReturnPeriods;
  annualReturns: { year: number | null; annualValue: number | null }[];
}

interface PerformanceTabProps {
  performance: FundPerformance | null;
}

const PERIODS: { key: keyof ReturnPeriods; label: string }[] = [
  { key: "oneYear", label: "1Y" },
  { key: "threeYear", label: "3Y" },
  { key: "fiveYear", label: "5Y" },
  { key: "tenYear", label: "10Y" },
];

function formatPct(val: number | null): string {
  if (val == null) return "—";
  return `${val >= 0 ? "+" : ""}${(val * 100).toFixed(2)}%`;
}

function pctColor(val: number | null): string {
  if (val == null) return "text-black/30 dark:text-white/30";
  return val >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-[#FF2D2D]";
}

export default function PerformanceTab({ performance }: PerformanceTabProps) {
  if (!performance) {
    return (
      <div className="text-sm text-black/30 dark:text-white/30 py-8 text-center">
        No performance data available
      </div>
    );
  }

  const { trailingReturns, benchmark, annualReturns, asOfDate } = performance;

  // Build 10 years of annual returns, filling missing years with dashes
  const currentYear = new Date().getFullYear();
  const tenYears: { year: number; annualValue: number | null }[] = [];
  const returnsByYear = new Map(
    annualReturns.filter((r) => r.year != null).map((r) => [r.year!, r.annualValue])
  );
  for (let i = 0; i < 10; i++) {
    const year = currentYear - 1 - i;
    tenYears.push({ year, annualValue: returnsByYear.get(year) ?? null });
  }

  return (
    <div className="flex gap-10">
      {/* Average Annual Return — left side */}
      <div className="w-1/2 min-w-0">
        <div className="flex items-baseline gap-3 mb-6">
          <h3 className="text-xs font-semibold text-black dark:text-white uppercase tracking-wider">
            Average Annual Return
          </h3>
          {asOfDate && (
            <span className="text-[10px] text-black/30 dark:text-white/30">
              As of {new Date(asOfDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>
          )}
        </div>

        <table className="w-full">
          <thead>
            <tr>
              <th className="text-left text-[10px] font-medium text-black/30 dark:text-white/30 uppercase tracking-wider pb-3 w-1/5" />
              {PERIODS.map((p) => (
                <th key={p.key} className="text-right text-[10px] font-medium text-black dark:text-white uppercase tracking-wider pb-3 w-1/5">
                  {p.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-black/[0.04] dark:border-white/[0.04]">
              <td className="py-4 text-sm font-medium text-black/70 dark:text-white/70">% Price Return</td>
              {PERIODS.map((p) => (
                <td key={p.key} className={`py-4 text-right text-sm font-medium tabular-nums ${pctColor(trailingReturns[p.key])}`}>
                  {formatPct(trailingReturns[p.key])}
                </td>
              ))}
            </tr>
            <tr className="border-t border-black/[0.04] dark:border-white/[0.04]">
              <td className="py-4 text-sm font-medium text-black/70 dark:text-white/70">% S&P 500</td>
              {PERIODS.map((p) => (
                <td key={p.key} className={`py-4 text-right text-sm font-medium tabular-nums ${pctColor(benchmark[p.key])}`}>
                  {formatPct(benchmark[p.key])}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Annual Returns — right side */}
      <div className="w-1/2 min-w-0">
        <h3 className="text-xs font-semibold text-black dark:text-white uppercase tracking-wider mb-6">
          Annual Returns
        </h3>
        <div className="flex gap-8">
          {[tenYears.slice(0, 5), tenYears.slice(5, 10)].map((col, ci) => (
            <div key={ci} className="flex-1 space-y-2">
              {col.map((r) => (
                <div key={r.year} className="flex items-baseline justify-between">
                  <span className="text-[10px] text-black dark:text-white tabular-nums">
                    {r.year}
                  </span>
                  <span className={`text-sm font-medium tabular-nums ${pctColor(r.annualValue)}`}>
                    {formatPct(r.annualValue)}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
