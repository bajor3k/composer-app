/**
 * Shared types + describe helpers for the Report Center.
 * Row shapes mirror supabase/migrations/0005_saved_reports.sql.
 *
 * `describeReport` / `describeReportScope` are the SINGLE source of the
 * plain-English summary lines, the same way describeCondition/describeScope are
 * for alerts — the saved list, the builder preview and the chat confirm-card all
 * call them, so the sentence a user approves is the one they later read.
 */

import { getReportById, type ReportDefinition } from "@/lib/report-registry";

export const SCHEDULES = ["manual", "daily", "weekly", "monthly"] as const;
export type Schedule = (typeof SCHEDULES)[number];

export const SCOPE_MODES = ["account", "household", "book"] as const;
export type ScopeMode = (typeof SCOPE_MODES)[number];

export const SCHEDULE_LABELS: Record<Schedule, string> = {
  manual: "on demand",
  daily: "daily",
  weekly: "weekly",
  monthly: "monthly",
};

/** How stale a scheduled report may be before the sweep re-runs it, in hours. */
export const SCHEDULE_INTERVAL_HOURS: Record<Schedule, number> = {
  manual: Infinity, // never picked up by the cron
  daily: 24,
  weekly: 168,
  monthly: 720,
};

export interface SavedReportRow {
  id: string;
  name: string;
  report_id: string;
  params: Record<string, unknown>;
  scope_mode: ScopeMode;
  account_number: string | null;
  account_numbers: string[];
  household_id: string | null;
  household_name: string | null;
  schedule: Schedule;
  enabled: boolean;
  archived: boolean;
  last_run_at: string | null;
  last_row_count: number | null;
  last_error: string | null;
  run_count: number;
  source: "builder" | "chat" | "imported";
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface ReportRunRow {
  id: string;
  saved_report_id: string | null;
  report_id: string;
  label: string;
  row_count: number | null;
  status: "success" | "error";
  error: string | null;
  duration_ms: number | null;
  trigger: "manual" | "schedule";
  ran_by: string | null;
  ran_by_name: string | null;
  ran_at: string;
}

// ── describeReport — what this report actually pulls ──────────────────────────

/**
 * A one-line summary of a saved report: the catalog report it runs plus any
 * parameters bound to it. Reads naturally after the report's name.
 *
 *   "Trust Accounts"
 *   "Low Cash Alerts · max 2%"
 *   "Account Review · account ABC481174"
 */
export function describeReport(saved: Pick<SavedReportRow, "report_id" | "params">): string {
  const report: ReportDefinition | undefined = getReportById(saved.report_id);
  if (!report) return "Unknown report — it may have been removed from the catalog";

  const declared = report.params ?? [];
  const bound = declared
    .map((p) => {
      const v = saved.params?.[p.key];
      if (v === undefined || v === null || v === "") return null;
      // Prefer the human label of a select option over its raw value.
      const pretty =
        p.type === "select" ? (p.options?.find((o) => o.value === v)?.label ?? String(v)) : String(v);
      return `${p.label.toLowerCase()} ${pretty}`;
    })
    .filter(Boolean);

  return bound.length ? `${report.label} · ${bound.join(" · ")}` : report.label;
}

/** Renders a saved report's scope: which account(s), household, or the whole book. */
export function describeReportScope(
  saved: Pick<SavedReportRow, "scope_mode" | "account_number" | "household_name"> & {
    account_numbers?: string[];
  },
): string {
  switch (saved.scope_mode) {
    case "account": {
      const list = saved.account_numbers?.length
        ? saved.account_numbers
        : saved.account_number
          ? [saved.account_number]
          : [];
      if (list.length === 0) return "No account selected";
      if (list.length === 1) return list[0];
      return `${list[0]} +${list.length - 1} more`;
    }
    case "household":
      return saved.household_name ? `${saved.household_name} household` : "No household selected";
    case "book":
      return "Entire book";
  }
}

/** One-line summary for the chat confirm-card and the builder preview. */
export function describeSavedReport(
  saved: Pick<
    SavedReportRow,
    "report_id" | "params" | "scope_mode" | "account_number" | "household_name" | "schedule"
  > & { account_numbers?: string[] },
): string {
  return `${describeReport(saved)} · ${describeReportScope(saved)} · ${SCHEDULE_LABELS[saved.schedule]}`;
}
