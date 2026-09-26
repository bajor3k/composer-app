import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireAuth, getSession } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { supabase } from "@/lib/supabase";
import { validateAlertDraft } from "@/lib/alerts/validate";
import type { AlertRow } from "@/lib/alerts/types";

export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  let query = supabase.from("alerts").select("*").order("created_at", { ascending: false });

  const enabled = searchParams.get("enabled");
  if (enabled === "true" || enabled === "false") query = query.eq("enabled", enabled === "true");

  const type = searchParams.get("type");
  if (type) query = query.eq("alert_type", type);

  const { data, error } = await query;
  if (error) {
    console.error("Alerts list error:", error.message);
    return NextResponse.json({ error: "Failed to load alerts" }, { status: 500 });
  }
  return NextResponse.json({ data: (data ?? []) as AlertRow[] });
}

export async function POST(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;
  const limited = enforceRateLimit(request, "alerts-write", 30, 60_000);
  if (limited) return limited;

  const session = getSession(request)!;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const validated = validateAlertDraft(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  const { data, error } = await supabase
    .from("alerts")
    .insert({
      id: randomUUID(),
      ...validated.row,
      // Provenance is set by the route, never by the client — it distinguishes
      // the drawer form from the natural-language builder.
      source: body.source === "chat" ? "chat" : "builder",
      created_by: session.userId,
      created_by_name: session.name,
    })
    .select("*")
    .single();

  if (error) {
    console.error("Alert create error:", error.message);
    return NextResponse.json({ error: "Failed to create alert" }, { status: 500 });
  }
  return NextResponse.json({ data: data as AlertRow });
}
