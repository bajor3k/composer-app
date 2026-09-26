"use client";

import { useMemo, useRef, useEffect, useState } from "react";

interface SectorData {
  name: string;
  weight: number; // decimal, e.g. 0.50 = 50%
}

interface SectorBreakdownProps {
  sectors: SectorData[];
}

const SECTOR_LABELS: Record<string, string> = {
  technology: "Technology",
  communication_services: "Communication Services",
  consumer_cyclical: "Consumer Cyclical",
  consumer_defensive: "Consumer Defensive",
  healthcare: "Healthcare",
  industrials: "Industrials",
  utilities: "Utilities",
  basic_materials: "Basic Materials",
  energy: "Energy",
  financial_services: "Financial Services",
  realestate: "Real Estate",
};

const SECTOR_COLORS: Record<string, string> = {
  technology: "#3B82F6",
  communication_services: "#8B5CF6",
  consumer_cyclical: "#EC4899",
  consumer_defensive: "#F472B6",
  healthcare: "#F59E0B",
  industrials: "#F97316",
  utilities: "#EAB308",
  basic_materials: "#84CC16",
  energy: "#6B7280",
  financial_services: "#6366F1",
  realestate: "#A78BFA",
};

const DEFAULT_COLOR = "#9CA3AF";

export default function SectorBreakdown({ sectors }: SectorBreakdownProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const MAX_VISIBLE = 5;

  // Click outside to deselect
  useEffect(() => {
    if (!selectedSector) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setSelectedSector(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [selectedSector]);

  const allocations = useMemo(() => {
    const totalWeight = sectors.reduce((sum, s) => sum + s.weight, 0);
    if (totalWeight === 0) return [];

    return sectors
      .filter((s) => s.weight > 0)
      .sort((a, b) => b.weight - a.weight)
      .map((s) => ({
        key: s.name,
        label: SECTOR_LABELS[s.name] || s.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        percentage: (s.weight / totalWeight) * 100,
        color: SECTOR_COLORS[s.name] || DEFAULT_COLOR,
      }));
  }, [sectors]);

  const segments = useMemo(() => {
    const result: { offset: number; length: number; color: string; key: string }[] = [];
    let cumulativePercent = 0;
    allocations.forEach((alloc) => {
      result.push({
        offset: cumulativePercent,
        length: alloc.percentage,
        color: alloc.color,
        key: alloc.key,
      });
      cumulativePercent += alloc.percentage;
    });
    return result;
  }, [allocations]);

  const handleClick = (key: string) => {
    setSelectedSector(selectedSector === key ? null : key);
  };

  if (allocations.length === 0) return null;

  return (
    <div ref={containerRef}>
      <h4 className="text-xs font-semibold text-black dark:text-white uppercase tracking-wider mb-4">Sector Breakdown</h4>
      <div className="flex items-center gap-8">
        {/* Donut Chart */}
        <div className="relative w-44 h-44 flex-shrink-0">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            {segments.map((segment, index) => {
              const circumference = 2 * Math.PI * 35;
              const strokeLength = (segment.length / 100) * circumference;
              const strokeOffset = (segment.offset / 100) * circumference;
              const isSelected = selectedSector === segment.key;
              const isDimmed = selectedSector !== null && !isSelected;

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
                  onClick={() => handleClick(segment.key)}
                />
              );
            })}
          </svg>
          {/* Center text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            {selectedSector ? (
              <>
                <span className="text-[10px] text-black/40 dark:text-white/40 text-center px-2 leading-tight">
                  {allocations.find((a) => a.key === selectedSector)?.label}
                </span>
                <span className="text-sm font-semibold text-black dark:text-white mt-0.5">
                  {allocations.find((a) => a.key === selectedSector)?.percentage.toFixed(1)}%
                </span>
              </>
            ) : (
              <span className="text-[10px] text-black/40 dark:text-white/40 uppercase tracking-wider">Sectors</span>
            )}
          </div>
        </div>

        {/* Legend */}
        <div className="flex-1">
          <div className="space-y-1.5">
            {(expanded ? allocations : allocations.slice(0, MAX_VISIBLE)).map((alloc) => {
              const isSelected = selectedSector === alloc.key;
              const isDimmed = selectedSector !== null && !isSelected;

              return (
                <div
                  key={alloc.key}
                  className={`flex items-center justify-between cursor-pointer rounded-lg px-2 py-1 -mx-2 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15 dark:focus-visible:ring-white/15 ${
                    isSelected
                      ? "bg-black/5 dark:bg-white/5"
                      : "hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                  }`}
                  onClick={() => handleClick(alloc.key)}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2 h-2 rounded-full transition-opacity duration-200 flex-shrink-0"
                      style={{ backgroundColor: alloc.color, opacity: isDimmed ? 0.3 : 1 }}
                    />
                    <span className={`text-xs transition-opacity duration-200 ${isDimmed ? "text-black/30 dark:text-white/30" : "text-black/70 dark:text-white/70"}`}>
                      {alloc.label}
                    </span>
                  </div>
                  <span className={`text-xs font-medium tabular-nums transition-opacity duration-200 ${isDimmed ? "text-black/30 dark:text-white/30" : "text-black dark:text-white"}`}>
                    {alloc.percentage.toFixed(2)}%
                  </span>
                </div>
              );
            })}
          </div>
          {allocations.length > MAX_VISIBLE && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-2 text-xs font-medium text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15 dark:focus-visible:ring-white/15"
            >
              {expanded ? "Show less" : `+${allocations.length - MAX_VISIBLE} more`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
