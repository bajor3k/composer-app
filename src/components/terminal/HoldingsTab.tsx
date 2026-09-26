"use client";

import { useState, useEffect, useCallback } from "react";

interface Holding {
  symbol: string | null;
  holdingName: string | null;
  holdingPercent: number;
}

interface FullHolding {
  symbol: string | null;
  name: string | null;
  weight: number;
  value: number | null;
  shares: number | null;
  country: string | null;
  cusip?: string | null;
}

interface HoldingsTabProps {
  holdings: Holding[];
  etfSymbol?: string;
  onSelect?: (symbol: string, name: string) => void;
}

export default function HoldingsTab({ holdings, etfSymbol, onSelect }: HoldingsTabProps) {
  const [showAll, setShowAll] = useState(false);
  const [fullHoldings, setFullHoldings] = useState<FullHolding[] | null>(null);
  const [loadingFull, setLoadingFull] = useState(false);
  const [fullError, setFullError] = useState<string | null>(null);

  const fetchFullHoldings = useCallback(async () => {
    if (!etfSymbol || fullHoldings) return;
    setLoadingFull(true);
    setFullError(null);
    const fallbackToTop = () => {
      setFullError("Full holdings are temporarily unavailable. Showing the top 10.");
      setFullHoldings(
        holdings.map((h) => ({
          symbol: h.symbol,
          name: h.holdingName,
          weight: h.holdingPercent,
          value: null,
          shares: null,
          country: null,
        }))
      );
    };
    try {
      const res = await fetch(`/api/terminal/holdings?symbol=${encodeURIComponent(etfSymbol)}`);
      if (res.ok) {
        const json = await res.json();
        setFullHoldings(json.holdings ?? []);
      } else {
        fallbackToTop();
      }
    } catch {
      fallbackToTop();
    }
    setLoadingFull(false);
  }, [etfSymbol, fullHoldings, holdings]);

  const handleSeeAll = () => {
    setShowAll(true);
    fetchFullHoldings();
  };

  // Close on Escape
  useEffect(() => {
    if (!showAll) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowAll(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKey);
    };
  }, [showAll]);

  if (!holdings || holdings.length === 0) {
    return (
      <div className="text-sm text-black/30 dark:text-white/30 py-8 text-center">
        No holdings data available
      </div>
    );
  }

  const top10 = holdings.slice(0, 10);
  const totalWeight = top10.reduce((sum, h) => sum + h.holdingPercent, 0);

  const displayHoldings = fullHoldings ?? [];
  const fullTotalWeight = displayHoldings.reduce((sum, h) => sum + h.weight, 0);

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-4">
        <h3 className="text-xs font-semibold text-black dark:text-white uppercase tracking-wider">
          Top Holdings
        </h3>
        <span className="text-xs text-black dark:text-white tabular-nums">
          {(totalWeight * 100).toFixed(1)}% of fund
        </span>
      </div>
      <div className="space-y-1">
        {top10.map((h, i) => (
          <HoldingRow key={h.symbol ?? i} holding={h} index={i} onSelect={onSelect} />
        ))}
      </div>

      <button
        onClick={handleSeeAll}
        className="mt-4 text-xs font-medium text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15 dark:focus-visible:ring-white/15"
      >
        See All →
      </button>

      {/* Full Holdings Modal */}
      {showAll && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setShowAll(false); }}
        >
          <div className="bg-white dark:bg-[#111] rounded-xl shadow-2xl border border-black/10 dark:border-white/10 w-full max-w-2xl max-h-[80vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.06] dark:border-white/[0.06]">
              <div className="flex items-baseline gap-2">
                <h3 className="text-sm font-semibold text-black dark:text-white">
                  All Holdings
                </h3>
                {fullHoldings && (
                  <span className="text-xs text-black/40 dark:text-white/40 tabular-nums">
                    {fullHoldings.length} positions · {(fullTotalWeight * 100).toFixed(1)}%
                  </span>
                )}
              </div>
              <button
                onClick={() => setShowAll(false)}
                className="text-black/30 dark:text-white/30 hover:text-black dark:hover:text-white transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15 dark:focus-visible:ring-white/15"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="overflow-y-auto flex-1 px-2 py-2">
              {loadingFull && (
                <div aria-hidden="true">
                  {/* Column-header placeholder */}
                  <div className="flex items-center gap-4 py-2 px-3">
                    <span className="w-4 h-2 rounded bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
                    <span className="w-48 h-2 rounded bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
                    <span className="w-16 h-2 rounded bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
                    <span className="w-24 h-2 rounded bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
                    <span className="w-20 h-2 rounded bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
                    <span className="ml-auto w-14 h-2 rounded bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
                  </div>
                  {/* Row placeholders */}
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4 py-2 px-3">
                      <span className="w-4 h-3 rounded bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
                      <span className="w-48 h-3 rounded bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
                      <span className="w-16 h-3 rounded bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
                      <span className="w-24 h-3 rounded bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
                      <span className="w-20 h-3 rounded bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
                      <span className="ml-auto w-14 h-3 rounded bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
                    </div>
                  ))}
                </div>
              )}

              {fullError && (
                <div className="mx-1 mt-1 mb-2 px-3 py-2 rounded-md text-xs text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/20">
                  {fullError}
                </div>
              )}

              {fullHoldings && fullHoldings.length > 0 && (
                <>
                  {/* Column Headers */}
                  <div className="flex items-center gap-4 py-2 px-3 text-[10px] font-medium text-black/30 dark:text-white/30 uppercase tracking-wider">
                    <span className="w-4 text-right">#</span>
                    <span className="w-48">Name</span>
                    <span className="w-16 text-right">Weight</span>
                    <span className="w-24 text-right">Value</span>
                    <span className="w-20 text-right">Shares</span>
                    <span className="ml-auto">Country</span>
                  </div>
                  {displayHoldings.map((h, i) => (
                    <FullHoldingRow key={i} holding={h} index={i} onSelect={(name) => { setShowAll(false); onSelect?.(name, name); }} />
                  ))}
                </>
              )}

              {fullHoldings && fullHoldings.length === 0 && !loadingFull && (
                <div className="text-sm text-black/30 dark:text-white/30 py-8 text-center">
                  No published holdings for {etfSymbol ?? "this fund"} yet.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HoldingRow({ holding: h, index: i, onSelect }: { holding: Holding; index: number; onSelect?: (symbol: string, name: string) => void }) {
  return (
    <div
      onClick={() => h.symbol && onSelect?.(h.symbol, h.holdingName ?? h.symbol)}
      className={`flex items-center gap-4 py-2.5 px-3 rounded-lg hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors ${h.symbol ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15 dark:focus-visible:ring-white/15" : ""}`}
    >
      <span className="text-[10px] text-black/20 dark:text-white/20 w-4 text-right tabular-nums">
        {i + 1}
      </span>
      <span className="text-sm font-semibold text-black dark:text-white w-16 shrink-0">
        {h.symbol ?? "—"}
      </span>
      <span className="text-sm text-black/50 dark:text-white/50 truncate shrink-0">
        {h.holdingName ?? "—"}
      </span>
      <span className="text-sm font-medium text-black/70 dark:text-white/70 tabular-nums ml-auto shrink-0 pl-3">
        {(h.holdingPercent * 100).toFixed(2)}%
      </span>
    </div>
  );
}

function fmtValue(val: number | null): string {
  if (val == null) return "—";
  if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
  return `$${val.toLocaleString()}`;
}

function fmtShares(val: number | null): string {
  if (val == null) return "—";
  if (val >= 1e6) return `${(val / 1e6).toFixed(1)}M`;
  return val.toLocaleString();
}

function FullHoldingRow({ holding: h, index: i, onSelect }: { holding: FullHolding; index: number; onSelect?: (name: string) => void }) {
  return (
    <div
      className="flex items-center gap-4 py-2 px-3 rounded-lg hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
    >
      <span className="text-[10px] text-black/20 dark:text-white/20 w-4 text-right tabular-nums">
        {i + 1}
      </span>
      <span className="text-sm text-black/70 dark:text-white/70 w-48 truncate" title={h.name ?? undefined}>
        {h.name ?? "—"}
      </span>
      <span className="text-sm font-medium text-black/70 dark:text-white/70 tabular-nums w-16 text-right">
        {(h.weight * 100).toFixed(2)}%
      </span>
      <span className="text-xs text-black/40 dark:text-white/40 tabular-nums w-24 text-right">
        {fmtValue(h.value)}
      </span>
      <span className="text-xs text-black/40 dark:text-white/40 tabular-nums w-20 text-right">
        {fmtShares(h.shares)}
      </span>
      <span className="text-xs text-black/40 dark:text-white/40 ml-auto">
        {h.country ?? "—"}
      </span>
    </div>
  );
}
