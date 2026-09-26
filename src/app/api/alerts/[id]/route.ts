import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { supabase } from "@/lib/supabase";
import { validateAlertDraft } from "@/lib/alerts/validate";
import type { AlertRow } from "@/lib/alerts/types";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const authError = requireAuth(request);
  if (authError) return authError;
  const { id } = await params;

  const { data, error } = await supabase.from("alerts").select("*").eq("id", id).maybeSingle();
  if (error) {
    console.error("Alert fetch error:", error.message);
    return NextResponse.json({ error: "Failed to load alert" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Alert not found" }, { status: 404 });
  return NextResponse.json({ data: data as AlertRow });
}

/**
 * Handles three shapes:
 *  - `{ enabled }` alone  → the inline pause/resume toggle
 *  - `{ archived }` alone → archive / restore
 *  - anything else        → a full edit from the drawer, which must be a
 *    complete valid draft. A partial edit would let a client blank out the scope
 *    columns and silently widen an account alert to the whole book.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const authError = requireAuth(request);
  if (authError) return authError;
  const limited = enforceRateLimit(request, "alerts-write", 30, 60_000);
  if (limited) return limited;

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const keys = Object.keys(body);

  // A body made up only of the two state flags is a state change, not an edit.
  // Both can arrive together: switching an archived rule back on un-archives and
  // enables it in one write, so it can't land half-restored.
  const isFlagPatch =
    keys.length > 0 && keys.every((k) => k === "enabled" || k === "archived");

  const patch: Record<string, unknown> = isFlagPatch
    ? {
        ...("enabled" in body ? { enabled: Boolean(body.enabled) } : {}),
        ...("archived" in body ? { archived: Boolean(body.archived) } : {}),
      }
    : (() => {
        const validated = validateAlertDraft(body);
        return validated.ok ? validated.row : { __error: validated.error };
      })();

  if (typeof patch.__error === "string")
    return NextResponse.json({ error: patch.__error }, { status: 400 });

  const { data, error } = await supabase
    .from("alerts")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("Alert update error:", error.message);
    return NextResponse.json({ error: "Failed to update alert" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Alert not found" }, { status: 404 });
  return NextResponse.json({ data: data as AlertRow });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const authError = requireAuth(request);
  if (authError) return authError;
  const limited = enforceRateLimit(request, "alerts-write", 30, 60_000);
  if (limited) return limited;

  const { id } = await params;
  // alert_events cascade via the FK in 0004_alerts.sql.
  const { error } = await supabase.from("alerts").delete().eq("id", id);
  if (error) {
    console.error("Alert delete error:", error.message);
    return NextResponse.json({ error: "Failed to delete alert" }, { status: 500 });
  }
  return NextResponse.json({ data: { id } });
}
