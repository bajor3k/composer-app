"use client";

import { useEffect, useRef, useState } from "react";
import Toggle from "@/components/ui/Toggle";
import ScopeChip from "@/components/alerts/ScopeChip";
import { formatTimeAgo } from "@/lib/format-utils";
import {
  FREQUENCY_LABELS,
  describeCondition,
  describeScope,
  type AlertRow,
} from "@/lib/alerts/types";

// Shared cell padding, matching every other table in the app.
const PAD = "px-2 lg:px-3";
const PAD_L = "pl-3 lg:pl-4 pr-2";
const PAD_R = "pr-3 lg:pr-4 pl-2";

const PILL = "px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap";

interface Props {
  rows: AlertRow[];
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (alert: AlertRow) => void;
  onDelete: (id: string) => void;
  onArchive: (id: string, archived: boolean) => void;
  onViewActivity: (alertId: string) => void;
  /** Opens that account's Portfolio in the drawer with the chat in the center. */
  onOpenAccount: (accountNumber: string) => void;
}

export default function AlertRulesTable({
  rows,
  onToggle,
  onEdit,
  onDelete,
  onArchive,
  onViewActivity,
  onOpenAccount,
}: Props) {
  if (rows.length === 0) {
    return (
      <div className="py-12 text-center text-black/40 dark:text-white/40 text-sm">
        No alerts match this filter
      </div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 z-10">
        <tr className="border-b border-black/5 dark:border-white/5 bg-[#f2f2f2] dark:bg-[#0a0a0a] medium:bg-[#bcbcbc]">
          <Th className={PAD_L}>Status</Th>
          <Th className={PAD}>Alert</Th>
          <Th className={PAD}>Trigger</Th>
          <Th className={PAD}>Applied</Th>
          <Th className={`${PAD} text-right hidden xl:table-cell`}>Last scan</Th>
          <Th className={`${PAD} w-[60px]`}>On</Th>
          <Th className={`${PAD_R} w-8`}>{""}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((a) => (
          <Row
            key={a.id}
            alert={a}
            onToggle={onToggle}
            onEdit={onEdit}
            onDelete={onDelete}
            onArchive={onArchive}
            onViewActivity={onViewActivity}
            onOpenAccount={onOpenAccount}
          />
        ))}
      </tbody>
    </table>
  );
}

function Row({
  alert,
  onToggle,
  onEdit,
  onDelete,
  onArchive,
  onViewActivity,
  onOpenAccount,
}: { alert: AlertRow } & Omit<Props, "rows">) {
  const when = describeCondition(alert.condition);
  const where = describeScope(alert);

  return (
    <tr className="border-b border-black/5 dark:border-white/5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
      <td className={`${PAD_L} py-3.5`}>
        <StatusPill alert={alert} onViewActivity={onViewActivity} />
      </td>

      {/* items-start plus the dot's own 7px offset keeps the severity dot centred
          on the NAME line instead of drifting between the two lines when the
          provenance sub-label is present. Rules with no sub-label are unchanged:
          on a single 20px line a 6px dot at mt-[7px] lands exactly where
          items-center put it. */}
      <td className={`${PAD} py-3.5`}>
        <div className="flex items-start gap-2">
          <SeverityDot severity={alert.severity} className="mt-[7px]" />
          <div>
            <span className="block font-medium text-black dark:text-white whitespace-nowrap">
              {alert.name}
            </span>
            {/* Provenance, not status — which rules the agent proposed rather than
                how they're doing; the status pill owns health. "builder" is the
                norm and gets nothing, so only agent-authored rules carry a mark. */}
            {alert.source === "chat" && (
              <span className="block text-xs text-black/40 dark:text-white/40 whitespace-nowrap">
                Created in chat
              </span>
            )}
          </div>
        </div>
      </td>

      {/* The WHEN — the single most important cell on this page. Rendered from
          describeCondition so it is byte-identical to the builder's preview. */}
      <td className={`${PAD} py-3.5 text-black/70 dark:text-white/70`}>
        {/* Single line, always. The full sentence is in the title attribute when
            it overflows; the cadence lives in the builder rather than adding a
            second line here. */}
        <span
          className="block max-w-[26ch] lg:max-w-[38ch] truncate whitespace-nowrap"
          title={`${when} · checked ${FREQUENCY_LABELS[alert.frequency]}`}
        >
          {when}
        </span>
      </td>

      {/* The WHERE. Account-scoped alerts make the chip a live handoff — click it
          and that account's Portfolio opens in the drawer with the chat centered.
          Household and book scopes have no single account to open, so they stay
          static rather than offering a control that does nothing. */}
      <td className={`${PAD} py-3.5`}>
        <ScopeChip
          label={where}
          accountNumber={alert.scope_mode === "account" ? alert.account_number : null}
          onOpenAccount={onOpenAccount}
        />
      </td>

      {/* Last scan = when the sweep last CHECKED this rule (last_evaluated_at) —
          "is this thing still running?". The fire time is NOT repeated here: the
          status pill already carries it, and right after a trigger the two values
          are identical, which just reads as an echo. */}
      <td className={`${PAD} py-3.5 text-right tabular-nums hidden xl:table-cell`}>
        {alert.last_evaluated_at ? (
          <span className="text-black/50 dark:text-white/50">
            {formatTimeAgo(alert.last_evaluated_at)}
          </span>
        ) : (
          <span className="text-black/25 dark:text-white/25">Not yet</span>
        )}
      </td>

      <td className={`${PAD} py-3.5`}>
        <Toggle checked={alert.enabled} onChange={(v) => onToggle(alert.id, v)} />
      </td>

      <td className={`${PAD_R} py-3.5`}>
        <RowMenu alert={alert} onEdit={onEdit} onDelete={onDelete} onArchive={onArchive} />
      </td>
    </tr>
  );
}

/** Health at a glance. `last_error` wins — a rule that cannot evaluate must never
 *  read as "Active", because silence is this feature's worst failure mode.
 *  The "Fired" state is the only clickable one: it jumps to that rule's activity. */
function StatusPill({
  alert,
  onViewActivity,
}: {
  alert: AlertRow;
  onViewActivity: (alertId: string) => void;
}) {
  if (alert.last_error) {
    return (
      <span className={`${PILL} bg-red-500/10 text-red-700 dark:text-red-300`} title={alert.last_error}>
        Needs attention
      </span>
    );
  }
  if (!alert.enabled) {
    return (
      <span className={`${PILL} bg-black/5 dark:bg-white/10 text-black/50 dark:text-white/50`}>
        Paused
      </span>
    );
  }
  if (alert.last_triggered_at && Date.now() - new Date(alert.last_triggered_at).getTime() < 864e5) {
    return (
      <button
        type="button"
        title="See what this alert caught"
        onClick={() => onViewActivity(alert.id)}
        className={`${PILL} bg-[#F59E0B]/10 text-[#B45309] dark:text-[#F59E0B] hover:bg-[#F59E0B]/20 transition-colors`}
      >
        Fired {formatTimeAgo(alert.last_triggered_at)}
      </button>
    );
  }
  return (
    <span className={`${PILL} bg-emerald-500/10 text-emerald-600 dark:text-emerald-500`}>Active</span>
  );
}

function SeverityDot({
  severity,
  className = "",
}: {
  severity: AlertRow["severity"];
  className?: string;
}) {
  const tone =
    severity === "critical"
      ? "bg-[#FF2D2D]"
      : severity === "warning"
        ? "bg-[#F59E0B]"
        : "bg-black/25 dark:bg-white/25";
  return (
    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tone} ${className}`} aria-hidden="true" />
  );
}

/**
 * Kebab menu. Delete is a two-step inside the popover — the app has no dialog
 * primitive, and inventing one here would be the only instance in the codebase.
 */
function RowMenu({
  alert,
  onEdit,
  onDelete,
  onArchive,
}: {
  alert: AlertRow;
  onEdit: (a: AlertRow) => void;
  onDelete: (id: string) => void;
  onArchive: (id: string, archived: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false);
        setConfirming(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setConfirming(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const ITEM =
    "w-full text-left px-3 py-1.5 text-[13px] text-black/70 dark:text-white/70 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors";

  return (
    <div ref={ref} className="relative flex justify-end">
      <button
        type="button"
        aria-label="Alert actions"
        onClick={() => setOpen((v) => !v)}
        className="p-1 rounded-md text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
      >
        <KebabIcon className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[9rem] py-1 rounded-lg border border-border dark:border-white/10 bg-sidebar dark:bg-[#242424] medium:bg-[#c2c2c2] shadow-xl">
          {!alert.archived && (
            <button
              type="button"
              className={ITEM}
              onClick={() => {
                setOpen(false);
                onEdit(alert);
              }}
            >
              Edit
            </button>
          )}
          {/* Archive is the safe middle ground between pausing and deleting: the
              rule stops being evaluated and leaves the working list, but every
              setting survives so it can be switched back on later. */}
          <button
            type="button"
            className={ITEM}
            onClick={() => {
              setOpen(false);
              onArchive(alert.id, !alert.archived);
            }}
          >
            {alert.archived ? "Restore" : "Archive"}
          </button>
          <button
            type="button"
            className={
              confirming
                ? "w-full text-left px-3 py-1.5 text-[13px] font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors"
                : ITEM
            }
            onClick={() => {
              if (!confirming) {
                setConfirming(true);
                return;
              }
              setOpen(false);
              setConfirming(false);
              onDelete(alert.id);
            }}
          >
            {confirming ? "Confirm delete" : "Delete"}
          </button>
        </div>
      )}
    </div>
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

function KebabIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}
