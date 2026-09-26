"use client";

import { useMemo } from "react";
import type { PerformanceRow } from "./types";

// Fixed bins from -10% to +20% in 2.5% steps; out-of-range returns clamp into the
// edge bins so every account is represented.
const BIN_MIN = -10;
const BIN_MAX = 20;
const BIN_STEP = 2.5;
const BIN_COUNT = (BIN_MAX - BIN_MIN) / BIN_STEP;

/**
 * Compact histogram of per-account TWR for the selected period — the one honest
 * visual available from the DB (no historical value series exists for a line chart).
 */
export default function ReturnDistribution({ rows }: { rows: PerformanceRow[] }) {
  const bins = useMemo(() => {
    const counts = new Array<number>(BIN_COUNT).fill(0);
    for (const r of rows) {
      const pct = r.twr * 100;
      const idx = Math.min(BIN_COUNT - 1, Math.max(0, Math.floor((pct - BIN_MIN) / BIN_STEP)));
      counts[idx]++;
    }
    return counts;
  }, [rows]);

  const maxCount = Math.max(...bins);
  if (rows.length === 0 || maxCount === 0) return null;

  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40 mb-2">
        Return Distribution
      </div>
      <div className="flex items-end gap-1 h-16">
        {bins.map((count, i) => {
          const lo = BIN_MIN + i * BIN_STEP;
          const hi = lo + BIN_STEP;
          return (
            <div
              key={i}
              className={`flex-1 rounded-sm ${hi <= 0 ? "bg-[#FF2D2D]/60" : "bg-emerald-500/60"}`}
              style={{ height: `${(count / maxCount) * 100}%`, minHeight: count > 0 ? 2 : 0 }}
              title={`${lo}% to ${hi}%: ${count.toLocaleString()} account${count === 1 ? "" : "s"}`}
            />
          );
        })}
      </div>
      <div className="relative mt-1 h-4 text-[10px] text-black/40 dark:text-white/40 tabular-nums">
        <span className="absolute left-0">{BIN_MIN}%</span>
        <span
          className="absolute -translate-x-1/2"
          style={{ left: `${((0 - BIN_MIN) / (BIN_MAX - BIN_MIN)) * 100}%` }}
        >
          0%
        </span>
        <span className="absolute right-0">+{BIN_MAX}%</span>
      </div>
    </div>
  );
}
