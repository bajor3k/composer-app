"use client";

import { useMemo, useRef, useEffect, useState } from "react";
import { type Holding, type PortfolioAccount } from "./types";
import IncomeView from "./IncomeView";
import AdvisoryFeesView from "./AdvisoryFeesView";

type ChartView = "allocation" | "income" | "fees";

// Fixed colors per asset class
export const ASSET_CLASS_COLORS: Record<string, string> = {
  equity: "#3B82F6",       // Blue
  fixed_income: "#10B981", // Green
  cash: "#EF4444",         // Red
  alternative: "#F59E0B",  // Yellow/Amber
  other: "#6B7280",        // Gray
};

export const ASSET_CLASS_LABELS: Record<string, string> = {
  equity: "US Equity",
  fixed_income: "Fixed Income",
  cash: "Cash",
  alternative: "Alternatives",
  other: "Other",
};

export default function AllocationChart({
  holdings,
  selectedClass,
  onSelectClass,
  accountId,
  account,
  householdAccounts,
  isHouseholdView,
}: {
  holdings: Holding[];
  selectedClass: string | null;
  onSelectClass: (cls: string | null) => void;
  accountId?: string;
  account?: PortfolioAccount | null;
  householdAccounts?: PortfolioAccount[];
  isHouseholdView?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeView, setActiveView] = useState<ChartView>("allocation");

  // Click outside to deselect
  useEffect(() => {
    if (!selectedClass) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onSelectClass(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [selectedClass]);

  // Reset view when account changes
  useEffect(() => {
    setActiveView("allocation");
  }, [accountId]);

  const allocations = useMemo(() => {
    const totalValue = holdings.reduce((sum, h) => sum + h.market_value, 0);
    if (totalValue === 0) return [];

    // Group holdings by asset class
    const grouped = new Map<string, number>();
    for (const h of holdings) {
      const cls = h.asset_class || "other";
      grouped.set(cls, (grouped.get(cls) || 0) + h.market_value);
    }

    return [...grouped.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([cls, value]) => ({
        asset_class: cls,
        label: ASSET_CLASS_LABELS[cls] || cls,
        value,
        percentage: (value / totalValue) * 100,
        color: ASSET_CLASS_COLORS[cls] || ASSET_CLASS_COLORS.other,
      }));
  }, [holdings]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  // Calculate SVG donut chart segments
  const getDonutSegments = () => {
    const segments: { offset: number; length: number; color: string; asset_class: string }[] = [];
    let cumulativePercent = 0;

    allocations.forEach((alloc) => {
      segments.push({
        offset: cumulativePercent,
        length: alloc.percentage,
        color: alloc.color,
        asset_class: alloc.asset_class,
      });
      cumulativePercent += alloc.percentage;
    });

    return segments;
  };

  const segments = getDonutSegments();
  const totalValue = holdings.reduce((sum, h) => sum + h.market_value, 0);

  const handleSegmentClick = (assetClass: string) => {
    onSelectClass(selectedClass === assetClass ? null : assetClass);
  };

  const handleToggle = (view: ChartView) => {
    setActiveView(view);
    if (view !== "allocation") onSelectClass(null);
  };

  return (
    <div ref={containerRef} className="@container">
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => handleToggle("allocation")}
          className={`text-xs font-semibold uppercase tracking-wider transition-colors ${
            activeView === "allocation"
              ? "text-black dark:text-white"
              : "text-black/40 dark:text-white/40 hover:text-black/60 dark:hover:text-white/60"
          }`}
        >
          Asset Allocation
        </button>
        <button
          onClick={() => handleToggle("income")}
          className={`text-xs font-semibold uppercase tracking-wider transition-colors ${
            activeView === "income"
              ? "text-black dark:text-white"
              : "text-black/40 dark:text-white/40 hover:text-black/60 dark:hover:text-white/60"
          }`}
        >
          Income
        </button>
        <button
          onClick={() => handleToggle("fees")}
          className={`text-xs font-semibold uppercase tracking-wider transition-colors ${
            activeView === "fees"
              ? "text-black dark:text-white"
              : "text-black/40 dark:text-white/40 hover:text-black/60 dark:hover:text-white/60"
          }`}
        >
          Advisory Fees
          {isHouseholdView && (
            <span className="ml-1.5 px-1.5 py-0.5 text-xs font-semibold rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 uppercase tracking-wider">Household</span>
          )}
        </button>
      </div>

      {activeView === "fees" && account ? (
        /* ── Advisory Fees View ── */
        <AdvisoryFeesView
          account={account}
          householdAccounts={householdAccounts || [account]}
          isHouseholdView={isHouseholdView ?? false}
        />
      ) : activeView === "income" ? (
        /* ── Income View ── */
        <IncomeView accountId={accountId!} holdings={holdings} />
      ) : (
        /* ── Asset Allocation View (original) ── */
        <div className="flex flex-col @[20rem]:flex-row items-center gap-6 @lg:gap-10">
          {/* Donut Chart — shrinks with the column before the legend gives up space */}
          <div className="relative w-56 min-w-36 aspect-square">
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
              {segments.map((segment, index) => {
                const circumference = 2 * Math.PI * 35;
                const strokeLength = (segment.length / 100) * circumference;
                const strokeOffset = (segment.offset / 100) * circumference;
                const isSelected = selectedClass === segment.asset_class;
                const isDimmed = selectedClass !== null && !isSelected;

                return (
                  <circle
                    key={index}
                    cx="50"
                    cy="50"
                    r="35"
                    fill="none"
                    stroke={segment.color}
                    strokeWidth={isSelected ? "7" : "5"}
                    strokeDasharray={`${strokeLength} ${circumference}`}
                    strokeDashoffset={-strokeOffset}
                    opacity={isDimmed ? 0.3 : 1}
                    className="transition-all duration-300 cursor-pointer"
                    onClick={() => handleSegmentClick(segment.asset_class)}
                  />
                );
              })}
            </svg>
            {/* Center text */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              {selectedClass ? (
                <>
                  <span className="text-xs text-black/40 dark:text-white/40">
                    {ASSET_CLASS_LABELS[selectedClass] || selectedClass}
                  </span>
                  <span className="text-base font-semibold text-black dark:text-white">
                    {formatCurrency(allocations.find((a) => a.asset_class === selectedClass)?.value || 0)}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-xs text-black/40 dark:text-white/40 uppercase tracking-wider">Total</span>
                  <span className="text-base font-semibold text-black dark:text-white">
                    {formatCurrency(totalValue)}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Legend */}
          <div className="w-full @[20rem]:w-auto @[20rem]:flex-1 @[20rem]:min-w-36 space-y-2.5">
            {allocations.map((alloc) => {
              const isSelected = selectedClass === alloc.asset_class;
              const isDimmed = selectedClass !== null && !isSelected;

              return (
                <div
                  key={alloc.asset_class}
                  className={`flex items-center justify-between cursor-pointer rounded-lg px-2 py-1.5 -mx-2 transition-all duration-200 ${
                    isSelected
                      ? "bg-black/5 dark:bg-white/5"
                      : "hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                  }`}
                  onClick={() => handleSegmentClick(alloc.asset_class)}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-2.5 h-2.5 rounded-full transition-opacity duration-200"
                      style={{ backgroundColor: alloc.color, opacity: isDimmed ? 0.3 : 1 }}
                    />
                    <span className={`text-sm transition-opacity duration-200 ${isDimmed ? "text-black/30 dark:text-white/30" : "text-black/70 dark:text-white/70"}`}>
                      {alloc.label}
                    </span>
                  </div>
                  <span className={`text-sm font-medium transition-opacity duration-200 ${isDimmed ? "text-black/30 dark:text-white/30" : "text-black dark:text-white"}`}>
                    {alloc.percentage.toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
