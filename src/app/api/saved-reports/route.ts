import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireAuth, getSession } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { supabase } from "@/lib/supabase";
import { validateSavedReportDraft } from "@/lib/reports/validate";
import type { SavedReportRow } from "@/lib/reports/types";

export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  const { data, error } = await supabase
    .from("saved_reports")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Saved reports list error:", error.message);
    return NextResponse.json({ error: "Failed to load reports" }, { status: 500 });
  }
  return NextResponse.json({ data: (data ?? []) as SavedReportRow[] });
}

export async function POST(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;
  const limited = enforceRateLimit(request, "reports-write", 30, 60_000);
  if (limited) return limited;

  const session = getSession(request)!;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const validated = validateSavedReportDraft(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  const source =
    body.source === "chat" ? "chat" : body.source === "imported" ? "imported" : "builder";

  const { data, error } = await supabase
    .from("saved_reports")
    .insert({
      id: randomUUID(),
      ...validated.row,
      // Provenance is set by the route, never trusted from the client.
      source,
      created_by: session.userId,
      created_by_name: session.name,
    })
    .select("*")
    .single();

  if (error) {
    console.error("Saved report create error:", error.message);
    return NextResponse.json({ error: "Failed to save report" }, { status: 500 });
  }
  return NextResponse.json({ data: data as SavedReportRow });
}
