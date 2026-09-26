"use client";

import { useState, useEffect } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface InsightsTabProps {
  symbol: string;
  recommendationTrend?: any[];
  upgradeDowngradeHistory?: any[];
  keyStats?: any;
}

interface InsightsData {
  developments: any[];
  recommendation: any;
  technicalEvents: any;
}

export default function InsightsTab({ symbol, recommendationTrend, upgradeDowngradeHistory, keyStats }: InsightsTabProps) {
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchInsights() {
      setLoading(true);
      try {
        const res = await fetch(`/api/terminal/insights?symbol=${encodeURIComponent(symbol)}`);
        if (res.ok) {
          setInsights(await res.json());
        }
      } catch { /* ignore */ }
      setLoading(false);
    }
    fetchInsights();
  }, [symbol]);

  if (loading) {
    return (
      <div className="space-y-6" aria-hidden="true">
        <div className="h-3 w-32 rounded bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
        <div className="flex items-center gap-8">
          <div className="h-24 w-24 shrink-0 rounded-full bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
          <div className="flex-1 space-y-3.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-3 w-8 rounded bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
                <div className="h-2.5 flex-1 rounded-full bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
                <div className="h-3 w-14 rounded bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const currentRec = recommendationTrend?.[0];

  return (
    <div className="space-y-6">
      {/* Analyst Ratings — Robinhood-style */}
      {currentRec && (() => {
        const buyCount = (currentRec.strongBuy || 0) + (currentRec.buy || 0);
        const holdCount = currentRec.hold || 0;
        const sellCount = (currentRec.sell || 0) + (currentRec.strongSell || 0);
        const total = buyCount + holdCount + sellCount;

        const buyPct = total > 0 ? (buyCount / total) * 100 : 0;
        const holdPct = total > 0 ? (holdCount / total) * 100 : 0;
        const sellPct = total > 0 ? (sellCount / total) * 100 : 0;

        // Consensus percentage = buy percentage (the dominant "positive" signal)
        const consensusPct = Math.round(buyPct);

        const bars = [
          { label: "Buy", pct: buyPct, color: "bg-emerald-500", textColor: "text-emerald-600 dark:text-emerald-500" },
          { label: "Hold", pct: holdPct, color: "bg-black/20 dark:bg-white/30", textColor: "text-black/50 dark:text-white/50" },
          { label: "Sell", pct: sellPct, color: "bg-[#FF2D2D]", textColor: "text-[#FF2D2D]" },
        ];

        const hasPriceTargets = keyStats?.targetMeanPrice && keyStats?.targetLowPrice && keyStats?.targetHighPrice;
        const low = hasPriceTargets ? Number(keyStats.targetLowPrice) : 0;
        const high = hasPriceTargets ? Number(keyStats.targetHighPrice) : 0;
        const mean = hasPriceTargets ? Number(keyStats.targetMeanPrice) : 0;
        const median = hasPriceTargets ? Number(keyStats.targetMedianPrice ?? mean) : 0;

        return (
          <div className={`grid gap-4 ${hasPriceTargets ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}>
            {/* Analyst Ratings */}
            <div>
              <h4 className="text-xs font-semibold text-black dark:text-white uppercase tracking-wider mb-4">Analyst Ratings</h4>
              <div className="h-[calc(100%-28px)]">
                <div className="flex items-center gap-8 h-full">
                  {/* Circular consensus badge */}
                  <div className="shrink-0">
                    <div className="relative w-24 h-24">
                      <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="6" className="text-black/5 dark:text-white/5" />
                        <circle
                          cx="50" cy="50" r="42" fill="none" strokeWidth="6"
                          className="text-emerald-500"
                          stroke="currentColor"
                          strokeDasharray={`${consensusPct * 2.64} ${264 - consensusPct * 2.64}`}
                          strokeLinecap="round"
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-500 leading-none tabular-nums">{consensusPct}%</span>
                        <span className="text-[9px] text-black/30 dark:text-white/30 mt-0.5 tabular-nums">of {total} ratings</span>
                      </div>
                    </div>
                  </div>

                  {/* Horizontal bars */}
                  <div className="flex-1 space-y-3.5">
                    {bars.map((bar) => (
                      <div key={bar.label} className="flex items-center gap-3">
                        <span className={`text-sm font-medium w-8 ${bar.textColor}`}>{bar.label}</span>
                        <div className="flex-1 h-2.5 bg-black/5 dark:bg-white/5 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${bar.color} transition-all duration-700`}
                            style={{ width: `${Math.max(bar.pct, bar.pct > 0 ? 2 : 0)}%` }}
                          />
                        </div>
                        <span className="text-sm text-black/40 dark:text-white/40 tabular-nums w-14 text-right">{bar.pct.toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Price Targets — stacked rows */}
            {hasPriceTargets && (
              <div>
                <h4 className="text-xs font-semibold text-black dark:text-white uppercase tracking-wider mb-4">Price Targets</h4>
                <div className="h-[calc(100%-28px)] flex flex-col justify-center">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-black/40 dark:text-white/40">High</span>
                      <span className="text-sm tabular-nums text-black/60 dark:text-white/60">${high.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-black/40 dark:text-white/40">Median</span>
                      <span className="text-base font-semibold tabular-nums text-black dark:text-white">${median.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-black/40 dark:text-white/40">Low</span>
                      <span className="text-sm tabular-nums text-black/60 dark:text-white/60">${low.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Rating Changes */}
      {upgradeDowngradeHistory && upgradeDowngradeHistory.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-black dark:text-white uppercase tracking-wider mb-3">Rating Changes</h4>
          <div>
            {/* Table header */}
            <div className="grid grid-cols-[1fr_1fr_1fr_120px] gap-4 px-4 py-3 bg-black/[0.03] dark:bg-white/[0.03] rounded-t-lg">
              <span className="text-[11px] text-black/40 dark:text-white/40 font-semibold uppercase tracking-wider">Firm</span>
              <span className="text-[11px] text-black/40 dark:text-white/40 font-semibold uppercase tracking-wider">Action</span>
              <span className="text-[11px] text-black/40 dark:text-white/40 font-semibold uppercase tracking-wider">Rating</span>
              <span className="text-[11px] text-black/40 dark:text-white/40 font-semibold uppercase tracking-wider text-right">Date</span>
            </div>

            {/* Rows */}
            {upgradeDowngradeHistory.slice(0, 10).map((u: any, i: number) => {
              const actionRaw = (u.action || "").toLowerCase();
              const actionLabels: Record<string, string> = {
                upgrade: "Upgrade",
                downgrade: "Downgrade",
                init: "New Coverage",
                reiterated: "Reiterated",
                reit: "Reiterated",
                main: "Maintained",
                maintained: "Maintained",
              };
              const actionLabel = actionLabels[actionRaw] || u.action;
              let dateStr = "";
              if (u.date) {
                const d = typeof u.date === "number"
                  ? new Date(u.date < 1e12 ? u.date * 1000 : u.date)
                  : new Date(u.date);
                if (!isNaN(d.getTime())) {
                  dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                }
              }

              return (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_1fr_1fr_120px] gap-4 px-4 py-4 border-b border-black/5 dark:border-white/5 last:border-0"
                >
                  {/* Firm */}
                  <div className="text-sm text-black/80 dark:text-white/80 font-medium truncate">
                    {u.firm}
                  </div>

                  {/* Action */}
                  <div className="text-sm text-black/60 dark:text-white/60">
                    {actionLabel}
                  </div>

                  {/* Grade change */}
                  <div className="flex items-center text-sm text-black/50 dark:text-white/50">
                    {u.fromGrade && u.toGrade ? (
                      <span className="flex items-center gap-1.5">
                        <span>{u.fromGrade}</span>
                        <svg className="w-3 h-3 shrink-0 text-black/20 dark:text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                        </svg>
                        <span className="font-medium text-black/80 dark:text-white/80">{u.toGrade}</span>
                      </span>
                    ) : u.toGrade ? (
                      <span className="font-medium text-black/80 dark:text-white/80">{u.toGrade}</span>
                    ) : (
                      <span className="text-black/20 dark:text-white/20">—</span>
                    )}
                  </div>

                  {/* Date */}
                  <div className="text-sm text-black/40 dark:text-white/40 text-right tabular-nums">
                    {dateStr}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Significant Developments */}
      {insights?.developments && insights.developments.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-black dark:text-white uppercase tracking-wider mb-3">Recent Developments</h4>
          <div className="space-y-3">
            {insights.developments.map((d: any, i: number) => (
              <div key={i} className="py-2 border-b border-black/5 dark:border-white/5 last:border-0">
                <div className="flex items-center gap-2 mb-1">
                  {d.date && (
                    <span className="text-[10px] text-black/30 dark:text-white/30">
                      {new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  )}
                </div>
                <p className="text-sm text-black/60 dark:text-white/60">{d.headline}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
