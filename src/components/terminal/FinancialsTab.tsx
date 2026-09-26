"use client";

import { useState, useEffect } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface FinancialsTabProps {
  symbol: string;
}

function fmtCurrency(val: any): string {
  if (val == null) return "—";
  const n = Number(val);
  if (isNaN(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtEps(val: any): string {
  if (val == null) return "—";
  const n = Number(val);
  return isNaN(n) ? "—" : `$${n.toFixed(2)}`;
}

export default function FinancialsTab({ symbol }: FinancialsTabProps) {
  const [period, setPeriod] = useState<"annual" | "quarterly">("annual");
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchFinancials() {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/terminal/financials?symbol=${encodeURIComponent(symbol)}&period=${period}`
        );
        if (res.ok) {
          const json = await res.json();
          setData(json.data ?? []);
        }
      } catch { /* ignore */ }
      setLoading(false);
    }
    fetchFinancials();
  }, [symbol, period]);

  const rows = [
    { label: "Revenue", key: "totalRevenue", fmt: fmtCurrency },
    { label: "Cost of Revenue", key: "costOfRevenue", fmt: fmtCurrency },
    { label: "Gross Profit", key: "grossProfit", fmt: fmtCurrency },
    { label: "Operating Income", key: "operatingIncome", fmt: fmtCurrency },
    { label: "Net Income", key: "netIncome", fmt: fmtCurrency },
    { label: "EBITDA", key: "ebitda", fmt: fmtCurrency },
    { label: "Diluted EPS", key: "dilutedEPS", fmt: fmtEps },
    { label: "divider", key: "divider", fmt: () => "" },
    { label: "Total Assets", key: "totalAssets", fmt: fmtCurrency },
    { label: "Total Liabilities", key: "totalLiabilities", fmt: fmtCurrency },
    { label: "Stockholders Equity", key: "totalEquity", fmt: fmtCurrency },
    { label: "Total Debt", key: "totalDebt", fmt: fmtCurrency },
    { label: "Cash & Equivalents", key: "cashAndEquivalents", fmt: fmtCurrency },
    { label: "divider2", key: "divider2", fmt: () => "" },
    { label: "Operating Cash Flow", key: "operatingCashFlow", fmt: fmtCurrency },
    { label: "Capital Expenditure", key: "capitalExpenditure", fmt: fmtCurrency },
    { label: "Free Cash Flow", key: "freeCashFlow", fmt: fmtCurrency },
  ];

  const formatDate = (d: string) => {
    if (!d) return "—";
    const date = new Date(d);
    return period === "quarterly"
      ? `Q${Math.ceil((date.getMonth() + 1) / 3)} ${date.getFullYear()}`
      : date.getFullYear().toString();
  };

  return (
    <div>
      <div className="flex items-center gap-0.5 bg-black/5 dark:bg-white/5 rounded-lg p-1 w-fit mb-4">
        <button
          onClick={() => setPeriod("annual")}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15 dark:focus-visible:ring-white/15 ${
            period === "annual"
              ? "bg-white dark:bg-black medium:bg-[#e4e4e4] text-black dark:text-white shadow-sm"
              : "text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white"
          }`}
        >
          Annual
        </button>
        <button
          onClick={() => setPeriod("quarterly")}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15 dark:focus-visible:ring-white/15 ${
            period === "quarterly"
              ? "bg-white dark:bg-black medium:bg-[#e4e4e4] text-black dark:text-white shadow-sm"
              : "text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white"
          }`}
        >
          Quarterly
        </button>
      </div>

      {loading ? (
        <div className="space-y-2" aria-hidden="true">
          <div className="flex items-center gap-3">
            <div className="h-3 w-40 shrink-0 rounded bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
            <div className="ml-auto flex gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-3 w-16 rounded bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
              ))}
            </div>
          </div>
          {Array.from({ length: 12 }).map((_, r) => (
            <div key={r} className="flex items-center gap-3 py-1">
              <div className="h-3 w-32 shrink-0 rounded bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
              <div className="ml-auto flex gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-3 w-16 rounded bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : data.length === 0 ? (
        <div className="py-12 text-center text-sm text-black/30 dark:text-white/30">No financial data available</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-black/5 dark:border-white/5">
                <th className="text-left py-2 pr-4 text-xs font-medium text-black/40 dark:text-white/40 uppercase tracking-wider w-48 bg-[#f2f2f2] dark:bg-[#0a0a0a] medium:bg-[#bcbcbc]"></th>
                {data.map((d, i) => (
                  <th key={i} className="text-right py-2 px-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider bg-[#f2f2f2] dark:bg-[#0a0a0a] medium:bg-[#bcbcbc]">
                    {formatDate(d.date)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                if (row.key.startsWith("divider")) {
                  return (
                    <tr key={row.key}>
                      <td colSpan={data.length + 1} className="py-1">
                        <div className="border-t border-black/5 dark:border-white/5" />
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={row.key} className="hover:bg-black/[0.01] dark:hover:bg-white/[0.01]">
                    <td className="py-2 pr-4 text-xs text-black/50 dark:text-white/50">{row.label}</td>
                    {data.map((d, i) => {
                      const val = d[row.key];
                      const isNeg = val != null && Number(val) < 0;
                      return (
                        <td
                          key={i}
                          className={`py-2 px-3 text-right text-sm tabular-nums ${isNeg ? "text-[#FF2D2D]" : "text-black/70 dark:text-white/70"}`}
                        >
                          {row.fmt(val)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
