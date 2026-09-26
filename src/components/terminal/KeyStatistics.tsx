"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface KeyStatisticsProps {
  stats: Record<string, any> | null;
  quoteType?: string;
}

function fmt(val: any, type: "currency" | "percent" | "number" | "ratio" = "number"): string {
  if (val == null) return "—";
  const n = Number(val);
  if (isNaN(n)) return "—";
  switch (type) {
    case "currency":
      if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
      if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
      if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
      return `$${n.toFixed(2)}`;
    case "percent":
      return `${(n * 100).toFixed(2)}%`;
    case "ratio":
      return n.toFixed(2);
    default:
      return n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n.toLocaleString();
  }
}

const FUND_TYPES = new Set(["ETF", "MUTUALFUND"]);

export default function KeyStatistics({ stats, quoteType }: KeyStatisticsProps) {
  if (!stats) {
    return <div className="text-sm text-black/30 dark:text-white/30 py-8 text-center">No statistics available</div>;
  }

  const isFund = FUND_TYPES.has(quoteType ?? "");

  const sections = [
    {
      title: "Valuation",
      stockOnly: true,
      items: [
        { label: "Market Cap", value: fmt(stats.totalRevenue ? null : stats.marketCap, "currency") === "—" ? fmt(stats.sharesOutstanding, "number") : fmt(stats.marketCap, "currency") },
        { label: "Enterprise Value", value: fmt(stats.enterpriseValue, "currency") },
        { label: "Trailing P/E", value: fmt(stats.trailingPE, "ratio") },
        { label: "Forward P/E", value: fmt(stats.forwardPE, "ratio") },
        { label: "PEG Ratio", value: fmt(stats.pegRatio, "ratio") },
        { label: "Price/Book", value: fmt(stats.priceToBook, "ratio") },
      ],
    },
    {
      title: "Profitability",
      stockOnly: true,
      items: [
        { label: "Revenue", value: fmt(stats.totalRevenue, "currency") },
        { label: "Revenue Growth", value: fmt(stats.revenueGrowth, "percent") },
        { label: "Profit Margin", value: fmt(stats.profitMargins, "percent") },
        { label: "Operating Margin", value: fmt(stats.operatingMargins, "percent") },
        { label: "ROE", value: fmt(stats.returnOnEquity, "percent") },
        { label: "ROA", value: fmt(stats.returnOnAssets, "percent") },
      ],
    },
    {
      title: "Financial Health",
      stockOnly: true,
      items: [
        { label: "Debt/Equity", value: fmt(stats.debtToEquity, "ratio") },
        { label: "Current Ratio", value: fmt(stats.currentRatio, "ratio") },
        { label: "Beta", value: fmt(stats.beta, "ratio") },
        { label: "Short Ratio", value: fmt(stats.shortRatio, "ratio") },
        { label: "Trailing EPS", value: fmt(stats.trailingEps, "ratio") },
        { label: "Forward EPS", value: fmt(stats.forwardEps, "ratio") },
      ],
    },
    {
      title: "Analyst Targets",
      stockOnly: true,
      items: [
        { label: "Target Low", value: stats.targetLowPrice ? `$${Number(stats.targetLowPrice).toFixed(2)}` : "—" },
        { label: "Target Mean", value: stats.targetMeanPrice ? `$${Number(stats.targetMeanPrice).toFixed(2)}` : "—" },
        { label: "Target High", value: stats.targetHighPrice ? `$${Number(stats.targetHighPrice).toFixed(2)}` : "—" },
        { label: "# Analysts", value: stats.numberOfAnalystOpinions?.toString() ?? "—" },
        { label: "Consensus", value: stats.recommendationKey ?? "—" },
        { label: "Dividend Yield", value: stats.dividendYield ? `${(stats.dividendYield * 100).toFixed(2)}%` : "—" },
      ],
    },
  ].filter((s) => !(s.stockOnly && isFund));

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
      {sections.map((section) => (
        <div key={section.title} className="bg-black/[0.02] dark:bg-white/[0.02] rounded-lg p-4">
          <h4 className="text-xs font-semibold text-black dark:text-white uppercase tracking-wider mb-3">{section.title}</h4>
          <div className="space-y-2">
            {section.items.map((item) => (
              <div key={item.label} className="flex items-center justify-between">
                <span className="text-xs text-black/40 dark:text-white/40">{item.label}</span>
                <span className="text-sm font-medium text-black/70 dark:text-white/70 tabular-nums">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
