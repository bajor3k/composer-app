"use client";

/**
 * Market status indicator.
 *
 * Three visually distinct states, and the distinction is not cosmetic:
 *
 *   Live      green, pulsing  — real Yahoo quotes, market open
 *   Simulated amber           — prices are generated, market closed
 *   Delayed   grey            — upstream is unreachable, showing last known
 *
 * The word "Simulated" is always spelled out. Synthetic prices in a financial
 * tool must never be mistakable for real ones, so this label is deliberately
 * not abbreviated and deliberately not green.
 */

import type { MarketStatus } from "@/lib/market/types";

function agoLabel(asOf: number): string {
  if (!asOf) return "";
  const secs = Math.max(0, Math.round((Date.now() - asOf) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

export default function MarketStatusPill({
  status,
  degraded = false,
  asOf = 0,
  className = "",
}: {
  status: MarketStatus | null;
  degraded?: boolean;
  asOf?: number;
  className?: string;
}) {
  if (!status) return null;

  const isLive = status.mode === "live" && !degraded;
  const isSimulated = status.mode === "simulated" && !degraded;

  const dot = degraded
    ? "bg-neutral-400"
    : isLive
      ? "bg-[#10B981]"
      : "bg-[#F59E0B]";

  const text = degraded
    ? "text-neutral-500 dark:text-neutral-400"
    : isLive
      ? "text-[#10B981]"
      : "text-[#F59E0B]";

  const label = degraded ? "Delayed" : isLive ? "Live · Market open" : status.label;

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider ${text} ${className}`}
      title={degraded ? "Upstream data unavailable — showing last known values" : status.label}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot} ${isLive ? "animate-pulse" : ""}`} />
      {label}
      {asOf > 0 && !isSimulated ? (
        <span className="text-neutral-400 dark:text-neutral-500 normal-case tracking-normal">
          · {agoLabel(asOf)}
        </span>
      ) : null}
    </span>
  );
}
