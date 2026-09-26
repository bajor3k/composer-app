import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { AlertEventRow } from "@/lib/alerts/types";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const rawLimit = Number(searchParams.get("limit"));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), MAX_LIMIT) : DEFAULT_LIMIT;

  let query = supabase
    .from("alert_events")
    .select("*")
    .order("triggered_at", { ascending: false })
    .limit(limit);

  const status = searchParams.get("status");
  if (status === "new" || status === "acknowledged") query = query.eq("status", status);

  const alertId = searchParams.get("alertId");
  if (alertId) query = query.eq("alert_id", alertId);

  const { data, error } = await query;
  if (error) {
    console.error("Alert events list error:", error.message);
    return NextResponse.json({ error: "Failed to load alert activity" }, { status: 500 });
  }
  return NextResponse.json({ data: (data ?? []) as AlertEventRow[] });
}
