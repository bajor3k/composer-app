import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getSession } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { supabase } from "@/lib/supabase";
import type { AlertEventRow } from "@/lib/alerts/types";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * Acknowledge (or re-open) a triggered event.
 *
 * Acknowledging is what releases the partial unique index in 0004_alerts.sql, so
 * this is also the gesture that lets the same condition fire again once its
 * cooldown has elapsed.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const authError = requireAuth(request);
  if (authError) return authError;
  const limited = enforceRateLimit(request, "alerts-write", 60, 60_000);
  if (limited) return limited;

  const session = getSession(request)!;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const status = body.status === "new" ? "new" : "acknowledged";
  const patch =
    status === "acknowledged"
      ? {
          status,
          acknowledged_at: new Date().toISOString(),
          acknowledged_by: session.name,
        }
      : { status, acknowledged_at: null, acknowledged_by: null };

  const { data, error } = await supabase
    .from("alert_events")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("Alert event update error:", error.message);
    return NextResponse.json({ error: "Failed to update event" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  return NextResponse.json({ data: data as AlertEventRow });
}
