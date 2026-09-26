"use client";

import { useState } from "react";
import ScopeChip from "@/components/alerts/ScopeChip";
import { formatKey, formatTimeAgo, formatValue } from "@/lib/format-utils";
import type { AlertEventRow, Severity } from "@/lib/alerts/types";

const PAD = "px-2 lg:px-3";
const PAD_L = "pl-3 lg:pl-4 pr-2";
const PAD_R = "pr-3 lg:pr-4 pl-2";

const PILL = "px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap";

interface Props {
  rows: AlertEventRow[];
  onAcknowledge: (id: string) => void;
  /** Opens that account's Portfolio in the drawer with the chat in the center. */
  onOpenAccount: (accountNumber: string) => void;
}

export default function AlertEventsTable({ rows, onAcknowledge, onOpenAccount }: Props) {
  if (rows.length === 0) {
    return (
      <div className="py-12 text-center text-black/40 dark:text-white/40 text-sm">
        No activity matches this filter
      </div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 z-10">
        <tr className="border-b border-black/5 dark:border-white/5 bg-[#f2f2f2] dark:bg-[#0a0a0a] medium:bg-[#bcbcbc]">
          <Th className={PAD_L}>What happened</Th>
          <Th className={PAD}>Where</Th>
          <Th className={`${PAD} hidden md:table-cell`}>When</Th>
          <Th className={`${PAD_R} text-right`}>Status</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((e) => (
          <EventRow
            key={e.id}
            event={e}
            onAcknowledge={onAcknowledge}
            onOpenAccount={onOpenAccount}
          />
        ))}
      </tbody>
    </table>
  );
}

function EventRow({
  event,
  onAcknowledge,
  onOpenAccount,
}: {
  event: AlertEventRow;
  onAcknowledge: (id: string) => void;
  onOpenAccount: (accountNumber: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const observed = event.observed && typeof event.observed === "object" ? event.observed : null;
  const acknowledged = event.status === "acknowledged";

  // Acknowledged rows dim rather than disappear — nothing should vanish on the user.
  const dim = acknowledged ? "opacity-55" : "";

  return (
    <>
      <tr
        onClick={() => observed && setExpanded((v) => !v)}
        className={`border-b border-black/5 dark:border-white/5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors ${observed ? "cursor-pointer" : ""} ${dim}`}
      >
        {/* One line per event. `detail` is still available — expanding the row
            shows it alongside the observed values. */}
        <td className={`${PAD_L} py-3.5`}>
          <div className="flex items-center gap-2 min-w-0">
            <SeverityDot severity={event.severity} />
            <span
              className="font-medium text-black dark:text-white truncate whitespace-nowrap"
              title={event.detail ? `${event.title} · ${event.detail}` : event.title}
            >
              {event.title}
            </span>
          </div>
        </td>

        <td className={`${PAD} py-3.5`}>
          <ScopeChip
            label={
              event.symbol
                ? `${event.symbol} · ${event.affected_count} account${event.affected_count === 1 ? "" : "s"}`
                : event.account_number || "Entire book"
            }
            accountNumber={event.account_number}
            onOpenAccount={onOpenAccount}
          />
        </td>

        <td
          className={`${PAD} py-3.5 text-black/50 dark:text-white/50 tabular-nums hidden md:table-cell`}
        >
          {formatTimeAgo(event.triggered_at)}
        </td>

        <td className={`${PAD_R} py-3.5 text-right`}>
          {acknowledged ? (
            <span className={`${PILL} bg-black/5 dark:bg-white/10 text-black/50 dark:text-white/50`}>
              Reviewed
            </span>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAcknowledge(event.id);
              }}
              className="px-3 py-1 rounded-lg text-xs font-medium bg-black/5 dark:bg-white/5 text-black dark:text-white hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
            >
              Mark reviewed
            </button>
          )}
        </td>
      </tr>

      {expanded && observed && (
        <tr className="border-b border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02]">
          <td colSpan={4} className="p-0">
            <div className="px-4 lg:px-5 py-3 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2">
              {Object.entries(observed).map(([k, v]) => (
                <div key={k}>
                  <div className="text-[10px] uppercase tracking-wider text-black/40 dark:text-white/40">
                    {formatKey(k)}
                  </div>
                  <div className="text-sm text-black dark:text-white tabular-nums">
                    {formatValue(k, v)}
                  </div>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function SeverityDot({ severity }: { severity: Severity }) {
  const tone =
    severity === "critical"
      ? "bg-[#FF2D2D]"
      : severity === "warning"
        ? "bg-[#F59E0B]"
        : "bg-black/25 dark:bg-white/25";
  return (
    <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${tone}`} aria-hidden="true" />
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider whitespace-nowrap text-left ${className}`}
    >
      {children}
    </th>
  );
}
