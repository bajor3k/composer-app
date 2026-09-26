import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { upsertParticipant, type CaseParticipantRow } from "@/lib/cases";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const authError = requireAuth(request);
  if (authError) return authError;
  const { id } = await params;

  const { data, error } = await supabase
    .from("case_participants")
    .select("*")
    .eq("case_id", id)
    .order("joined_at");

  if (error) {
    console.error("Participants fetch error:", error.message);
    return NextResponse.json({ error: "Failed to load participants" }, { status: 500 });
  }
  return NextResponse.json({ data: (data ?? []) as CaseParticipantRow[] });
}

/** Join the case as the current user — called when the workspace opens. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const authError = requireAuth(request);
  if (authError) return authError;
  const session = getSession(request)!;
  const { id } = await params;

  const { data: caseRow } = await supabase.from("cases").select("id").eq("id", id).maybeSingle();
  if (!caseRow) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  await upsertParticipant(id, { userId: session.userId, name: session.name });
  return NextResponse.json({ data: { ok: true } });
}
