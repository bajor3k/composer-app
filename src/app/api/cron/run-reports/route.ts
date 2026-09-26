import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { runSavedReport } from "@/lib/reports/run";
import { SCHEDULE_INTERVAL_HOURS, type SavedReportRow } from "@/lib/reports/types";

export const dynamic = "force-dynamic";
// Next requires segment config to be a literal, so the value is repeated below.
export const maxDuration = 300;
const MAX_DURATION_S = 300;

// A scheduled sweep should never be able to melt the DB, however many reports
// get saved. Anything past this waits for the next sweep.
const MAX_PER_RUN = 50;

// Longest any ONE report may hold the loop. Not a performance target — a
// backstop. A report that blows through it gets a real `report_runs` error row
// (see runSavedReport) instead of taking the rest of the sweep down with it.
const REPORT_TIMEOUT_MS = 120_000;

// Stop STARTING reports once there isn't a full REPORT_TIMEOUT_MS of clock left,
// so the loop can always finish the report it's on and still write its summary.
//
// This exists because report cost spans three orders of magnitude: /low-cash is
// ~100ms, but a full-book /cost-basis is ~90s (it fans out one holdings query per
// account), and at least one of those is saved on a weekly schedule. Two of them
// in a sweep is ~180s of a 300s budget; three overruns it. The failure that
// follows is a quiet one — when the platform kills the function mid-loop, every
// report that never ran keeps its old `last_run_at`, so it reads as "not due yet"
// rather than "skipped", and nothing anywhere says a sweep was cut short.
const DEADLINE_MS = (MAX_DURATION_S - 30) * 1_000;

/**
 * Scheduled report execution — the twin of /api/cron/evaluate-alerts, guarded by
 * the same CRON_SECRET and equally platform-agnostic (any scheduler that can
 * issue an HTTP request with a Bearer header works).
 *
 *   curl -X POST localhost:3000/api/cron/run-reports \
 *     -H "Authorization: Bearer $CRON_SECRET"
 */
async function handle(request: NextRequest) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  const started = Date.now();
  try {
    const { data, error } = await supabase
      .from("saved_reports")
      .select("*")
      .eq("archived", false)
      .eq("enabled", true)
      .neq("schedule", "manual")
      .order("last_run_at", { ascending: true, nullsFirst: true });

    if (error) throw new Error(error.message);

    const now = Date.now();
    // Kept unsliced so the summary can report the true backlog, not just the
    // slice of it this sweep was willing to look at.
    const dueAll = ((data ?? []) as SavedReportRow[]).filter((r) => {
      if (!r.last_run_at) return true; // never run — always due
      const interval = SCHEDULE_INTERVAL_HOURS[r.schedule];
      return now - new Date(r.last_run_at).getTime() >= interval * 3_600_000;
    });
    const due = dueAll.slice(0, MAX_PER_RUN);

    let succeeded = 0;
    let failed = 0;
    let ran = 0;
    let stoppedEarly = false;
    // Sequential on purpose: each report is a multi-query scan, and running the
    // whole due set concurrently would spike the shared database.
    for (const saved of due) {
      if (Date.now() - started + REPORT_TIMEOUT_MS > DEADLINE_MS) {
        stoppedEarly = true;
        break;
      }
      const result = await runSavedReport(saved, {
        trigger: "schedule",
        timeoutMs: REPORT_TIMEOUT_MS,
      });
      ran++;
      if (result.run.status === "success") succeeded++;
      else failed++;
    }

    const summary = {
      considered: (data ?? []).length,
      due: dueAll.length,
      ran,
      succeeded,
      failed,
      // Due, but never reached — either the clock ran out or MAX_PER_RUN capped
      // the slice. These self-correct: they keep their old `last_run_at`, and the
      // query orders by it ascending, so the next sweep takes them first. That
      // only works as long as someone can SEE a sweep is running a backlog,
      // which is what separates this from the silent version.
      remaining: dueAll.length - ran,
      stoppedEarly,
      notDue: (data ?? []).length - dueAll.length,
      durationMs: Date.now() - started,
    };
    if (summary.remaining > 0) {
      console.warn(
        `[reports] cron sweep left ${summary.remaining} of ${dueAll.length} due reports unrun` +
          (stoppedEarly ? " (out of time)" : ` (MAX_PER_RUN=${MAX_PER_RUN})`),
        summary,
      );
    } else {
      console.log("[reports] cron run", summary);
    }
    return NextResponse.json({ data: summary });
  } catch (err) {
    console.error("[reports] cron failed", err);
    return NextResponse.json({ error: "Scheduled report run failed" }, { status: 500 });
  }
}

export const POST = handle;
// Aliased because several schedulers only emit GET.
export const GET = handle;
