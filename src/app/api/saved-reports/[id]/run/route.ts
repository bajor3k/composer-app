import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getSession } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { supabase } from "@/lib/supabase";
import { runSavedReport } from "@/lib/reports/run";
import type { SavedReportRow } from "@/lib/reports/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteParams = { params: Promise<{ id: string }> };

/**
 * Run a saved report now and return its rows.
 *
 * The rows are returned but never stored — run history keeps metadata only, so
 * opening a past run re-executes it rather than replaying numbers that may no
 * longer be true.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const authError = requireAuth(request);
  if (authError) return authError;
  const limited = enforceRateLimit(request, "reports-run", 30, 60_000);
  if (limited) return limited;

  const session = getSession(request)!;
  const { id } = await params;

  const { data: saved, error } = await supabase
    .from("saved_reports")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("Saved report fetch error:", error.message);
    return NextResponse.json({ error: "Failed to load report" }, { status: 500 });
  }
  if (!saved) return NextResponse.json({ error: "Report not found" }, { status: 404 });

  const result = await runSavedReport(saved as SavedReportRow, {
    trigger: "manual",
    userId: session.userId,
    userName: session.name,
  });

  return NextResponse.json({
    data: {
      run: result.run,
      label: result.label,
      rows: result.rows,
      rowCount: result.run.row_count,
    },
  });
}
