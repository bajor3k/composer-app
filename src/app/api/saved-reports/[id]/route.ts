import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { supabase } from "@/lib/supabase";
import { validateSavedReportDraft } from "@/lib/reports/validate";
import type { SavedReportRow } from "@/lib/reports/types";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const authError = requireAuth(request);
  if (authError) return authError;
  const { id } = await params;

  const { data, error } = await supabase.from("saved_reports").select("*").eq("id", id).maybeSingle();
  if (error) {
    console.error("Saved report fetch error:", error.message);
    return NextResponse.json({ error: "Failed to load report" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  return NextResponse.json({ data: data as SavedReportRow });
}

/**
 * Three shapes, same as the alerts route:
 *  - a body of only `enabled` / `archived` is a state change (both may arrive
 *    together, so restoring an archived report can't land half-applied)
 *  - anything else must be a complete, valid draft
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const authError = requireAuth(request);
  if (authError) return authError;
  const limited = enforceRateLimit(request, "reports-write", 30, 60_000);
  if (limited) return limited;

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const keys = Object.keys(body);

  const isFlagPatch =
    keys.length > 0 && keys.every((k) => k === "enabled" || k === "archived");

  const patch: Record<string, unknown> = isFlagPatch
    ? {
        ...("enabled" in body ? { enabled: Boolean(body.enabled) } : {}),
        ...("archived" in body ? { archived: Boolean(body.archived) } : {}),
      }
    : (() => {
        const validated = validateSavedReportDraft(body);
        return validated.ok ? validated.row : { __error: validated.error };
      })();

  if (typeof patch.__error === "string")
    return NextResponse.json({ error: patch.__error }, { status: 400 });

  const { data, error } = await supabase
    .from("saved_reports")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("Saved report update error:", error.message);
    return NextResponse.json({ error: "Failed to update report" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  return NextResponse.json({ data: data as SavedReportRow });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const authError = requireAuth(request);
  if (authError) return authError;
  const limited = enforceRateLimit(request, "reports-write", 30, 60_000);
  if (limited) return limited;

  const { id } = await params;
  // report_runs cascade via the FK in 0005_saved_reports.sql.
  const { error } = await supabase.from("saved_reports").delete().eq("id", id);
  if (error) {
    console.error("Saved report delete error:", error.message);
    return NextResponse.json({ error: "Failed to delete report" }, { status: 500 });
  }
  return NextResponse.json({ data: { id } });
}
