"use client";

import { useState } from "react";
import { type MonthBucket } from "./types";

const SERIES = [
  { key: "commissions", label: "Commissions", color: "#10B981" },
  { key: "salesCredits", label: "Sales Credits", color: "#F59E0B" },
  { key: "expenses", label: "Expenses", color: "#EF4444" },
] as const;

// Trailing-12-month revenue vs expenses from stored data: commissions bucketed by
// trade date, received sales credits spread across their period months, house
// expenses by period month. Advisory fees are excluded — they are computed from
// current balances and have no stored monthly history.
export default function MonthlyTrendChart({ months }: { months: MonthBucket[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const W = 720;
  const H = 232;
  const TOP = 12;
  const CHART_H = 180;
  const LABEL_Y = H - 8;
  const maxPositive = Math.max(1, ...months.map((m) => m.commissions + m.salesCredits));
  const maxNegative = Math.max(1, ...months.map((m) => m.expenses));
  const unit = CHART_H / (maxPositive + maxNegative);
  const baselineY = TOP + maxPositive * unit;
  const slot = W / Math.max(1, months.length);
  const barWidth = Math.min(30, slot * 0.5);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);

  const hovered = hoverIdx !== null ? months[hoverIdx] : null;

  return (
    <div className="relative">
      {/* Legend */}
      <div className="flex items-center gap-4 mb-3">
        {SERIES.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="text-xs text-black/50 dark:text-white/50">{s.label}</span>
          </div>
        ))}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <line
          x1="0"
          y1={baselineY}
          x2={W}
          y2={baselineY}
          stroke="currentColor"
          className="text-black/10 dark:text-white/10"
        />
        {months.map((m, i) => {
          const x = i * slot + (slot - barWidth) / 2;
          const commissionsH = m.commissions * unit;
          const creditsH = m.salesCredits * unit;
          const expensesH = m.expenses * unit;
          const baseOpacity = m.partial ? 0.6 : 1;
          const opacity = hoverIdx === null || hoverIdx === i ? baseOpacity : baseOpacity * 0.45;
          return (
            <g key={m.key} opacity={opacity} className="transition-opacity duration-150">
              <rect x={x} y={baselineY - commissionsH} width={barWidth} height={commissionsH} fill="#10B981" rx="1" />
              <rect x={x} y={baselineY - commissionsH - creditsH} width={barWidth} height={creditsH} fill="#F59E0B" rx="1" />
              <rect x={x} y={baselineY} width={barWidth} height={expensesH} fill="#EF4444" rx="1" />
            </g>
          );
        })}
        {months.map((m, i) => (
          <text
            key={m.key}
            x={i * slot + slot / 2}
            y={LABEL_Y}
            textAnchor="middle"
            fontSize="10"
            className="fill-current text-black/40 dark:text-white/40"
          >
            {m.label}
          </text>
        ))}
        {/* Invisible hover targets */}
        {months.map((m, i) => (
          <rect
            key={m.key}
            x={i * slot}
            y="0"
            width={slot}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx(null)}
          />
        ))}
      </svg>

      {/* Tooltip */}
      {hovered && hoverIdx !== null && (
        <div
          className="absolute z-20 pointer-events-none -translate-x-1/2 bg-white dark:bg-zinc-900 rounded-lg shadow-xl border border-black/10 dark:border-white/10 p-3 min-w-[190px]"
          style={{ left: `${((hoverIdx + 0.5) / months.length) * 100}%`, top: 24 }}
        >
          <div className="text-xs font-medium text-black/50 dark:text-white/50 uppercase tracking-wider mb-2">
            {hovered.label} {hovered.year}
            {hovered.partial ? " (MTD)" : ""}
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <div className="flex items-center justify-between gap-6">
              <span className="text-black/50 dark:text-white/50">Commissions</span>
              <span className="text-black dark:text-white">{formatCurrency(hovered.commissions)}</span>
            </div>
            <div className="flex items-center justify-between gap-6">
              <span className="text-black/50 dark:text-white/50">Sales Credits</span>
              <span className="text-black dark:text-white">{formatCurrency(hovered.salesCredits)}</span>
            </div>
            <div className="flex items-center justify-between gap-6">
              <span className="text-black/50 dark:text-white/50">Expenses</span>
              <span className="text-[#FF2D2D]">-{formatCurrency(hovered.expenses)}</span>
            </div>
            <div className="flex items-center justify-between gap-6 pt-1 mt-0.5 border-t border-black/5 dark:border-white/5">
              <span className="text-black/50 dark:text-white/50">Net</span>
              <span className={`font-semibold ${hovered.net < 0 ? "text-[#FF2D2D]" : "text-black dark:text-white"}`}>
                {formatCurrency(hovered.net)}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="mt-2 text-xs text-black/30 dark:text-white/30">
        Advisory fees excluded — computed from current balances; no monthly history.
      </div>
    </div>
  );
}
