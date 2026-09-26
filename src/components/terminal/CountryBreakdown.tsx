"use client";

import { useMemo, useRef, useEffect, useState } from "react";

interface CountryData {
  name: string;
  weight: number; // decimal, e.g. 0.50 = 50%
}

interface CountryBreakdownProps {
  countries: CountryData[];
}

const COUNTRY_COLORS: Record<string, string> = {
  "United States": "#3B82F6",
  "China": "#EF4444",
  "Japan": "#F59E0B",
  "United Kingdom": "#8B5CF6",
  "Germany": "#6366F1",
  "France": "#EC4899",
  "Canada": "#10B981",
  "Switzerland": "#F97316",
  "Australia": "#84CC16",
  "South Korea": "#06B6D4",
  "Taiwan": "#A78BFA",
  "India": "#F472B6",
  "Netherlands": "#EAB308",
  "Sweden": "#14B8A6",
  "Brazil": "#22C55E",
  "Ireland": "#0EA5E9",
  "Denmark": "#D946EF",
  "Italy": "#FB923C",
  "Spain": "#FBBF24",
  "Other": "#6B7280",
};

const PALETTE = ["#60A5FA", "#A78BFA", "#F472B6", "#FBBF24", "#34D399", "#FB923C", "#818CF8", "#F87171", "#38BDF8", "#4ADE80"];

function getColor(name: string, index: number): string {
  return COUNTRY_COLORS[name] ?? PALETTE[index % PALETTE.length];
}

export default function CountryBreakdown({ countries }: CountryBreakdownProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedCountry) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setSelectedCountry(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [selectedCountry]);

  const allocations = useMemo(() => {
    const totalWeight = countries.reduce((sum, c) => sum + c.weight, 0);
    if (totalWeight === 0) return [];

    return countries
      .filter((c) => c.weight > 0)
      .sort((a, b) => b.weight - a.weight)
      .map((c, i) => ({
        key: c.name,
        label: c.name,
        percentage: (c.weight / totalWeight) * 100,
        color: getColor(c.name, i),
      }));
  }, [countries]);

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
    setSelectedCountry(selectedCountry === key ? null : key);
  };

  if (allocations.length === 0) return null;

  return (
    <div ref={containerRef}>
      <h4 className="text-xs font-semibold text-black dark:text-white uppercase tracking-wider mb-4">Country Exposure</h4>
      <div className="flex items-center gap-8">
        {/* Donut Chart */}
        <div className="relative w-44 h-44 flex-shrink-0">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            {segments.map((segment, index) => {
              const circumference = 2 * Math.PI * 35;
              const strokeLength = (segment.length / 100) * circumference;
              const strokeOffset = (segment.offset / 100) * circumference;
              const isSelected = selectedCountry === segment.key;
              const isDimmed = selectedCountry !== null && !isSelected;

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
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            {selectedCountry ? (
              <>
                <span className="text-[10px] text-black/40 dark:text-white/40 text-center px-2 leading-tight">
                  {allocations.find((a) => a.key === selectedCountry)?.label}
                </span>
                <span className="text-sm font-semibold text-black dark:text-white mt-0.5">
                  {allocations.find((a) => a.key === selectedCountry)?.percentage.toFixed(1)}%
                </span>
              </>
            ) : (
              <span className="text-[10px] text-black/40 dark:text-white/40 uppercase tracking-wider">Countries</span>
            )}
          </div>
        </div>

        {/* Legend */}
        <div className="flex-1 space-y-1.5">
          {allocations.map((alloc) => {
            const isSelected = selectedCountry === alloc.key;
            const isDimmed = selectedCountry !== null && !isSelected;

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
      </div>
    </div>
  );
}
