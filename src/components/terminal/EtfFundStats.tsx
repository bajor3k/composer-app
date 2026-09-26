"use client";

interface EtfFundStatsProps {
  stats: {
    expenseRatio: number | null;
    secYield: number | null;
    totalAssets: number | null;
    nav: number | null;
    dividendYield: number | null;
    inceptionDate: string | null;
    fundFamily: string | null;
    fiftyTwoWeekHigh: number | null;
    fiftyTwoWeekLow: number | null;
    beta3Year: number | null;
    avgVolume: number | null;
    category: string | null;
    trailingPE: number | null;
  } | null;
}

function fmtCurrency(val: number | null): string {
  if (val == null) return "—";
  if (val >= 1e12) return `$${(val / 1e12).toFixed(2)}T`;
  if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
  return `$${val.toFixed(2)}`;
}

function fmtPercent(val: number | null): string {
  if (val == null) return "—";
  return `${(val * 100).toFixed(2)}%`;
}

function fmtNumber(val: number | null): string {
  if (val == null) return "—";
  if (val >= 1e9) return `${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `${(val / 1e6).toFixed(1)}M`;
  return val.toLocaleString();
}

function fmtDate(val: string | null): string {
  if (!val) return "—";
  const d = new Date(val);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function EtfFundStats({ stats }: EtfFundStatsProps) {
  if (!stats) return null;

  const items = [
    { label: "Fund Family", value: stats.fundFamily ?? "—" },
    { label: "Category", value: stats.category ?? "—" },
    { label: "Inception Date", value: fmtDate(stats.inceptionDate) },
    { label: "Total Assets", value: fmtCurrency(stats.totalAssets) },
    { label: "NAV", value: stats.nav != null ? `$${stats.nav.toFixed(2)}` : "—" },
    { label: "Expense Ratio", value: stats.expenseRatio != null ? fmtPercent(stats.expenseRatio) : "—" },
    { label: "SEC Yield", value: stats.secYield != null ? fmtPercent(stats.secYield) : "—" },
    { label: "Dividend Yield", value: stats.dividendYield != null ? fmtPercent(stats.dividendYield) : "—" },
    { label: "P/E Ratio", value: stats.trailingPE != null ? stats.trailingPE.toFixed(2) : "—" },
    { label: "Beta (3Y)", value: stats.beta3Year != null ? stats.beta3Year.toFixed(2) : "—" },
    { label: "52-Week Range", value: stats.fiftyTwoWeekLow != null && stats.fiftyTwoWeekHigh != null ? `$${stats.fiftyTwoWeekLow.toFixed(2)} – $${stats.fiftyTwoWeekHigh.toFixed(2)}` : "—" },
    { label: "Avg Volume", value: fmtNumber(stats.avgVolume) },
  ];

  return (
    <div>
      <h4 className="text-xs font-semibold text-black dark:text-white uppercase tracking-wider mb-3">Fund Stats</h4>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-8 gap-y-3">
        {items.map((item) => (
          <div key={item.label} className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-black/40 dark:text-white/40 whitespace-nowrap">{item.label}</span>
            <span className="text-sm font-medium text-black/70 dark:text-white/70 tabular-nums text-right">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
