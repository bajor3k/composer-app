"use client";

import { type RevenueSlice } from "./types";

// SVG donut of period revenue by source (same technique as AllocationChart).
// Container queries scale the donut, text, and gaps down with the card width so
// the legend always stays beside the donut instead of wrapping or overflowing.
export default function RevenueBreakdownChart({ slices }: { slices: RevenueSlice[] }) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const circumference = 2 * Math.PI * 35;

  let cumulative = 0;
  const segments = slices
    .filter((s) => s.value > 0)
    .map((s) => {
      const percentage = (s.value / total) * 100;
      const segment = { key: s.key, color: s.color, offset: cumulative, length: percentage };
      cumulative += percentage;
      return segment;
    });

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);

  return (
    <div className="@container">
      <div className="flex items-center gap-8 @max-[432px]:gap-4 @max-[304px]:gap-3">
        {/* Donut */}
        <div className="relative w-44 h-44 @max-[432px]:w-28 @max-[432px]:h-28 @max-[304px]:w-20 @max-[304px]:h-20 flex-shrink-0">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            <circle
              cx="50"
              cy="50"
              r="35"
              fill="none"
              stroke="currentColor"
              strokeWidth="5"
              className="text-black/5 dark:text-white/5"
            />
            {segments.map((segment) => (
              <circle
                key={segment.key}
                cx="50"
                cy="50"
                r="35"
                fill="none"
                stroke={segment.color}
                strokeWidth="5"
                strokeDasharray={`${(segment.length / 100) * circumference} ${circumference}`}
                strokeDashoffset={-((segment.offset / 100) * circumference)}
                className="transition-all duration-300"
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            {total === 0 ? (
              <>
                <span className="text-xs @max-[432px]:text-[10px] @max-[304px]:hidden text-black/40 dark:text-white/40">No Revenue</span>
                <span className="text-base @max-[432px]:text-sm @max-[304px]:text-[10px] font-semibold text-black dark:text-white">$0</span>
              </>
            ) : (
              <>
                <span className="text-xs @max-[432px]:text-[10px] @max-[304px]:hidden text-black/40 dark:text-white/40 uppercase tracking-wider">Revenue</span>
                <span className="text-base @max-[432px]:text-sm @max-[304px]:text-[10px] font-semibold text-black dark:text-white">
                  {formatCurrency(total)}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Legend */}
        <div className="flex-1 min-w-0 space-y-2.5 @max-[432px]:space-y-1.5">
          {slices.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 @max-[432px]:gap-1.5 min-w-0">
                <div className="w-2.5 h-2.5 @max-[432px]:w-2 @max-[432px]:h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                <span className="text-sm @max-[432px]:text-xs text-black/70 dark:text-white/70 truncate">{s.label}</span>
              </div>
              <div className="flex items-baseline gap-3 @max-[432px]:gap-1.5 flex-shrink-0">
                <span className="text-sm @max-[432px]:text-xs font-medium text-black dark:text-white">{formatCurrency(s.value)}</span>
                <span className="text-xs @max-[432px]:text-[10px] @max-[304px]:hidden text-black/40 dark:text-white/40 w-11 @max-[432px]:w-9 text-right tabular-nums">
                  {total > 0 ? `${((s.value / total) * 100).toFixed(1)}%` : "—"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
