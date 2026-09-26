"use client";

import { useEffect, useRef, useState } from "react";
import Toggle from "@/components/ui/Toggle";
import ScopeChip from "@/components/alerts/ScopeChip";
import { formatTimeAgo } from "@/lib/format-utils";
import {
  SCHEDULE_LABELS,
  describeReport,
  describeReportScope,
  type SavedReportRow,
} from "@/lib/reports/types";

const PAD = "px-2 lg:px-3";
const PAD_L = "pl-3 lg:pl-4 pr-2";
const PAD_R = "pr-3 lg:pr-4 pl-2";

const PILL = "px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap";

interface Props {
  rows: SavedReportRow[];
  runningId: string | null;
  onRun: (report: SavedReportRow) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (report: SavedReportRow) => void;
  onDelete: (id: string) => void;
  onArchive: (id: string, archived: boolean) => void;
  onOpenAccount: (accountNumber: string) => void;
}

export default function SavedReportsTable({ rows, ...handlers }: Props) {
  if (rows.length === 0) {
    return (
      <div className="py-12 text-center text-black/40 dark:text-white/40 text-sm">
        No reports match this filter
      </div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 z-10">
        <tr className="border-b border-black/5 dark:border-white/5 bg-[#f2f2f2] dark:bg-[#0a0a0a] medium:bg-[#bcbcbc]">
          <Th className={PAD_L}>Status</Th>
          <Th className={PAD}>Report</Th>
          <Th className={PAD}>Pulls</Th>
          <Th className={PAD}>Applied</Th>
          <Th className={`${PAD} text-right hidden lg:table-cell`}>Rows</Th>
          <Th className={`${PAD} text-right hidden xl:table-cell`}>Last run</Th>
          <Th className={`${PAD} w-[60px]`}>On</Th>
          <Th className={`${PAD_R} w-20`}>{""}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <Row key={r.id} report={r} {...handlers} />
        ))}
      </tbody>
    </table>
  );
}

function Row({
  report,
  runningId,
  onRun,
  onToggle,
  onEdit,
  onDelete,
  onArchive,
  onOpenAccount,
}: { report: SavedReportRow } & Omit<Props, "rows">) {
  const pulls = describeReport(report);
  const where = describeReportScope(report);
  const running = runningId === report.id;

  return (
    <tr className="border-b border-black/5 dark:border-white/5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
      <td className={`${PAD_L} py-3.5`}>
        <StatusPill report={report} />
      </td>

      <td className={`${PAD} py-3.5`}>
        <span className="font-medium text-black dark:text-white whitespace-nowrap">
          {report.name}
        </span>
      </td>

      {/* What this report actually pulls — the catalog report plus bound params.
          Single line; the full text is in the tooltip when it overflows. */}
      <td className={`${PAD} py-3.5 text-black/70 dark:text-white/70`}>
        <span
          className="block max-w-[24ch] lg:max-w-[34ch] truncate whitespace-nowrap"
          title={`${pulls} · runs ${SCHEDULE_LABELS[report.schedule]}`}
        >
          {pulls}
        </span>
      </td>

      <td className={`${PAD} py-3.5`}>
        <ScopeChip
          label={where}
          accountNumber={report.scope_mode === "account" ? report.account_number : null}
          onOpenAccount={onOpenAccount}
        />
      </td>

      <td
        className={`${PAD} py-3.5 text-right tabular-nums hidden lg:table-cell text-black/50 dark:text-white/50`}
      >
        {report.last_row_count === null ? (
          <span className="text-black/25 dark:text-white/25">—</span>
        ) : (
          report.last_row_count.toLocaleString()
        )}
      </td>

      <td
        className={`${PAD} py-3.5 text-right tabular-nums hidden xl:table-cell text-black/50 dark:text-white/50`}
      >
        {report.last_run_at ? (
          formatTimeAgo(report.last_run_at)
        ) : (
          <span className="text-black/25 dark:text-white/25">Never</span>
        )}
      </td>

      <td className={`${PAD} py-3.5`}>
        <Toggle checked={report.enabled} onChange={(v) => onToggle(report.id, v)} />
      </td>

      <td className={`${PAD_R} py-3.5`}>
        <div className="flex items-center justify-end gap-1">
          {/* A report is something you RUN — that's the primary verb here, so it
              gets a real button rather than hiding in the kebab. */}
          <button
            type="button"
            onClick={() => onRun(report)}
            disabled={running}
            className="px-2.5 py-1 rounded-md text-xs font-medium bg-black/5 dark:bg-white/5 text-black dark:text-white hover:bg-black/10 dark:hover:bg-white/10 transition-colors disabled:opacity-40"
          >
            {running ? "Running…" : "Run"}
          </button>
          <RowMenu report={report} onEdit={onEdit} onDelete={onDelete} onArchive={onArchive} />
        </div>
      </td>
    </tr>
  );
}

/** `last_error` wins — a report that failed on its last run must never read as
 *  healthy, because a scheduled report nobody watched is exactly what goes stale. */
function StatusPill({ report }: { report: SavedReportRow }) {
  if (report.last_error) {
    return (
      <span
        className={`${PILL} bg-red-500/10 text-red-700 dark:text-red-300`}
        title={report.last_error}
      >
        Failed
      </span>
    );
  }
  if (!report.enabled) {
    return (
      <span className={`${PILL} bg-black/5 dark:bg-white/10 text-black/50 dark:text-white/50`}>
        Paused
      </span>
    );
  }
  if (report.schedule === "manual") {
    return (
      <span className={`${PILL} bg-black/5 dark:bg-white/10 text-black/60 dark:text-white/60`}>
        On demand
      </span>
    );
  }
  return (
    <span className={`${PILL} bg-emerald-500/10 text-emerald-600 dark:text-emerald-500`}>
      Runs {SCHEDULE_LABELS[report.schedule]}
    </span>
  );
}

function RowMenu({
  report,
  onEdit,
  onDelete,
  onArchive,
}: {
  report: SavedReportRow;
  onEdit: (r: SavedReportRow) => void;
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
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Report actions"
        onClick={() => setOpen((v) => !v)}
        className="p-1 rounded-md text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
      >
        <KebabIcon className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[9rem] py-1 rounded-lg border border-border dark:border-white/10 bg-sidebar dark:bg-[#242424] medium:bg-[#c2c2c2] shadow-xl">
          {!report.archived && (
            <button
              type="button"
              className={ITEM}
              onClick={() => {
                setOpen(false);
                onEdit(report);
              }}
            >
              Edit
            </button>
          )}
          <button
            type="button"
            className={ITEM}
            onClick={() => {
              setOpen(false);
              onArchive(report.id, !report.archived);
            }}
          >
            {report.archived ? "Restore" : "Archive"}
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
              onDelete(report.id);
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
