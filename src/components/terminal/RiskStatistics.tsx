"use client";

interface RiskPeriod {
  year: string | null;
  alpha: number | null;
  beta: number | null;
  rSquared: number | null;
  stdDev: number | null;
  sharpeRatio: number | null;
  treynorRatio: number | null;
}

interface RiskStatisticsProps {
  stats: {
    fund: RiskPeriod[];
    category: RiskPeriod[];
  } | null;
}

const PERIOD_ORDER = ["3y", "5y", "10y"];
const PERIOD_LABELS: Record<string, string> = { "3y": "3Y", "5y": "5Y", "10y": "10Y" };

const METRICS: { key: keyof RiskPeriod; label: string; format: (v: number) => string; description: string }[] = [
  { key: "beta", label: "Beta", format: (v) => v.toFixed(2), description: "Sensitivity to market movements" },
  { key: "alpha", label: "Alpha", format: (v) => v.toFixed(2), description: "Excess return vs benchmark" },
  { key: "sharpeRatio", label: "Sharpe Ratio", format: (v) => v.toFixed(2), description: "Risk-adjusted return" },
  { key: "stdDev", label: "Std Deviation", format: (v) => `${v.toFixed(2)}%`, description: "Annualized volatility" },
  { key: "rSquared", label: "R-Squared", format: (v) => v.toFixed(2), description: "Correlation to benchmark" },
  { key: "treynorRatio", label: "Treynor Ratio", format: (v) => v.toFixed(2), description: "Return per unit of systematic risk" },
];

export default function RiskStatistics({ stats }: RiskStatisticsProps) {
  if (!stats || stats.fund.length === 0) return null;

  const fundByYear = new Map(stats.fund.map((r) => [r.year, r]));
  const catByYear = new Map(stats.category.map((r) => [r.year, r]));
  const periods = PERIOD_ORDER.filter((p) => fundByYear.has(p));

  if (periods.length === 0) return null;

  return (
    <div>
      <h4 className="text-xs font-semibold text-black dark:text-white uppercase tracking-wider mb-4">Risk & Volatility</h4>
      <table className="w-full">
        <thead>
          <tr>
            <th className="text-left text-[10px] font-medium text-black/30 dark:text-white/30 uppercase tracking-wider pb-3 w-32" />
            {periods.map((p) => (
              <th key={p} colSpan={2} className="text-center text-[10px] font-medium text-black dark:text-white uppercase tracking-wider pb-3">
                {PERIOD_LABELS[p]}
              </th>
            ))}
          </tr>
          <tr>
            <th />
            {periods.map((p) => (
              <th key={p + "-sub"} colSpan={2} className="pb-2">
                <div className="flex">
                  <span className="flex-1 text-center text-[9px] text-black/30 dark:text-white/30 uppercase">Fund</span>
                  <span className="flex-1 text-center text-[9px] text-black/30 dark:text-white/30 uppercase">Cat</span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {METRICS.map((metric) => (
            <tr key={metric.key} className="border-t border-black/[0.04] dark:border-white/[0.04]">
              <td className="py-3 text-xs text-black/50 dark:text-white/50" title={metric.description}>
                {metric.label}
              </td>
              {periods.map((p) => {
                const fundVal = fundByYear.get(p)?.[metric.key] as number | null;
                const catVal = catByYear.get(p)?.[metric.key] as number | null;
                return (
                  <td key={p} colSpan={2} className="py-3">
                    <div className="flex">
                      <span className="flex-1 text-center text-sm font-medium text-black/70 dark:text-white/70 tabular-nums">
                        {fundVal != null ? metric.format(fundVal) : "—"}
                      </span>
                      <span className="flex-1 text-center text-sm text-black/30 dark:text-white/30 tabular-nums">
                        {catVal != null ? metric.format(catVal) : "—"}
                      </span>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
