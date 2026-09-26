"use client";

import { formatTimeAgo } from "@/lib/format-utils";
import type { ReportRunRow } from "@/lib/reports/types";

const PAD = "px-2 lg:px-3";
const PAD_L = "pl-3 lg:pl-4 pr-2";
const PAD_R = "pr-3 lg:pr-4 pl-2";

const PILL = "px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap";

interface Props {
  rows: ReportRunRow[];
  /** Re-executes a past run. History stores metadata only, so "view" means "run
   *  it again" — the numbers are always current rather than a stale snapshot. */
  onRerun: (run: ReportRunRow) => void;
  rerunningId: string | null;
}

export default function ReportRunsTable({ rows, onRerun, rerunningId }: Props) {
  if (rows.length === 0) {
    return (
      <div className="py-12 text-center text-black/40 dark:text-white/40 text-sm">
        Nothing has run yet
      </div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 z-10">
        <tr className="border-b border-black/5 dark:border-white/5 bg-[#f2f2f2] dark:bg-[#0a0a0a] medium:bg-[#bcbcbc]">
          <Th className={PAD_L}>Report</Th>
          <Th className={PAD}>Result</Th>
          <Th className={`${PAD} hidden md:table-cell`}>Run by</Th>
          <Th className={`${PAD} hidden lg:table-cell text-right`}>Took</Th>
          <Th className={PAD}>When</Th>
          <Th className={`${PAD_R} text-right`}>{""}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((run) => (
          <tr
            key={run.id}
            className="border-b border-black/5 dark:border-white/5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
          >
            <td className={`${PAD_L} py-3.5`}>
              <span className="font-medium text-black dark:text-white whitespace-nowrap">
                {run.label}
              </span>
            </td>

            <td className={`${PAD} py-3.5`}>
              {run.status === "error" ? (
                <span
                  className={`${PILL} bg-red-500/10 text-red-700 dark:text-red-300`}
                  title={run.error ?? undefined}
                >
                  Failed
                </span>
              ) : (
                <span className="text-black/70 dark:text-white/70 tabular-nums whitespace-nowrap">
                  {(run.row_count ?? 0).toLocaleString()} row
                  {run.row_count === 1 ? "" : "s"}
                </span>
              )}
            </td>

            <td
              className={`${PAD} py-3.5 hidden md:table-cell text-black/50 dark:text-white/50 whitespace-nowrap`}
            >
              {run.trigger === "schedule" ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-black/5 dark:bg-white/5 medium:bg-[#e4e4e4]">
                  Scheduled
                </span>
              ) : (
                (run.ran_by_name ?? "—")
              )}
            </td>

            <td
              className={`${PAD} py-3.5 hidden lg:table-cell text-right tabular-nums text-black/50 dark:text-white/50`}
            >
              {run.duration_ms === null ? "—" : `${run.duration_ms.toLocaleString()}ms`}
            </td>

            <td
              className={`${PAD} py-3.5 text-black/50 dark:text-white/50 tabular-nums whitespace-nowrap`}
            >
              {formatTimeAgo(run.ran_at)}
            </td>

            <td className={`${PAD_R} py-3.5 text-right`}>
              {run.saved_report_id && (
                <button
                  type="button"
                  onClick={() => onRerun(run)}
                  disabled={rerunningId === run.id}
                  className="px-2.5 py-1 rounded-md text-xs font-medium bg-black/5 dark:bg-white/5 text-black dark:text-white hover:bg-black/10 dark:hover:bg-white/10 transition-colors disabled:opacity-40"
                >
                  {rerunningId === run.id ? "Running…" : "View"}
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
