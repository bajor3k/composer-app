import { randomUUID } from "node:crypto";
import { supabase } from "@/lib/supabase";
import { getReportById } from "@/lib/report-registry";
import { executeQuery } from "@/lib/ai/query-builder";
import type { QueryIntent } from "@/lib/ai/query-builder";
import type { ReportRunRow, SavedReportRow } from "@/lib/reports/types";

/**
 * Executes one saved report and records the attempt in `report_runs`.
 *
 * Deliberately mirrors POST /api/reports rather than reimplementing it: the
 * catalog supplies the intent and defaultParams, the saved row supplies only
 * allowlisted user params, and scope is folded in on top. Storing the intent on
 * the row would let a stale row outlive a catalog change; resolving it fresh on
 * every run means the catalog stays the single source of truth.
 *
 * A run is ALWAYS recorded — success or failure. A report that silently stopped
 * returning rows is the failure mode worth surfacing, so the error lands in both
 * the run feed and the saved row's `last_error`.
 */

export interface RunResult {
  run: ReportRunRow;
  rows: Record<string, unknown>[] | Record<string, unknown> | null;
  label: string;
}

export async function runSavedReport(
  saved: SavedReportRow,
  ctx: {
    trigger: "manual" | "schedule";
    userId?: string;
    userName?: string;
    /**
     * Wall-clock cap on the query. Omitted means no cap, which is right for a
     * manual run — a person chose to run this one and is watching it.
     *
     * The scheduled sweep always sets one, because there a slow report doesn't
     * only make itself late: it spends budget every report behind it in the loop
     * still needs. Reports vary by three orders of magnitude (a full-book cost
     * basis audit is ~90s against ~100ms for most), so the cap is what keeps one
     * outlier from deciding how much of the sweep gets to happen.
     */
    timeoutMs?: number;
  },
): Promise<RunResult> {
  const started = Date.now();
  const report = getReportById(saved.report_id);
  const label = report?.label ?? saved.name;

  let rows: RunResult["rows"] = null;
  let rowCount: number | null = null;
  let status: "success" | "error" = "success";
  let error: string | null = null;

  if (!report) {
    status = "error";
    error = `Report "${saved.report_id}" is no longer in the catalog.`;
  } else {
    // Scope narrows the query the same way the catalog's own account-scoped
    // reports do — via the accountNumber param the query builder already
    // understands (it resolves a number, a rep code, or a household name).
    const scopeParams: Record<string, unknown> = {};
    if (saved.scope_mode === "account" && saved.account_number) {
      scopeParams.accountNumber = saved.account_number;
    } else if (saved.scope_mode === "household" && saved.household_name) {
      scopeParams.accountNumber = saved.household_name;
    }

    const query = {
      intent: report.intent,
      params: { ...report.defaultParams, ...saved.params, ...scopeParams },
    } as QueryIntent;

    try {
      const result = ctx.timeoutMs
        ? await withTimeout(executeQuery(query), ctx.timeoutMs)
        : await executeQuery(query);

      if (result === TIMED_OUT) {
        // Recorded as a normal failure on purpose: `report_runs.status` is
        // CHECK-constrained to success/error, and a timeout IS a failed run —
        // it belongs in the feed as Failed, with the reason in the tooltip,
        // rather than as a third state every reader would have to learn.
        status = "error";
        error =
          `Timed out after ${Math.round(ctx.timeoutMs! / 1000)}s — too slow for the scheduled sweep. ` +
          `Narrow the scope, or run it manually from the Reports page.`;
      } else if (result.error) {
        status = "error";
        error = result.error;
      } else {
        rows = result.data;
        rowCount = Array.isArray(rows) ? rows.length : rows ? 1 : 0;
      }
    } catch (err) {
      status = "error";
      error = err instanceof Error ? err.message : "Report failed to run";
    }
  }

  const runRow = {
    id: randomUUID(),
    saved_report_id: saved.id,
    report_id: saved.report_id,
    label,
    row_count: rowCount,
    status,
    error,
    duration_ms: Date.now() - started,
    trigger: ctx.trigger,
    ran_by: ctx.userId ?? null,
    ran_by_name: ctx.userName ?? null,
  };

  const [{ data: inserted }] = await Promise.all([
    supabase.from("report_runs").insert(runRow).select("*").single(),
    supabase
      .from("saved_reports")
      .update({
        last_run_at: new Date().toISOString(),
        last_row_count: rowCount,
        last_error: error,
        run_count: (saved.run_count ?? 0) + 1,
      })
      .eq("id", saved.id),
  ]);

  return { run: (inserted ?? runRow) as ReportRunRow, rows, label };
}

/** Distinguishes "we stopped waiting" from a query that legitimately resolved. */
const TIMED_OUT = Symbol("report-timed-out");

/**
 * Caps how long we WAIT for a report — the same Promise.race shape as
 * previewReportDraft's budget.
 *
 * Worth being honest about the limit: this abandons the wait, it does not cancel
 * the query. The Supabase requests already in flight run to completion against
 * the shared database. That's acceptable here because the alternative is worse —
 * a sweep killed mid-loop leaves every report behind it looking "not due yet"
 * rather than skipped — but it does mean a timed-out report keeps costing the DB
 * something after the sweep has moved on.
 */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout>;
  const budget = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  return Promise.race([work, budget]).finally(() => clearTimeout(timer));
}
