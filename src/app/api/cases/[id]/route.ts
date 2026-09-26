import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { supabase } from "@/lib/supabase";
import {
  CASE_DOCUMENTS_BUCKET,
  CASE_STATUSES,
  isCaseAgent,
  type CaseParticipantRow,
  type CaseRow,
} from "@/lib/cases";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const authError = requireAuth(request);
  if (authError) return authError;
  const { id } = await params;

  const [caseRes, participantsRes] = await Promise.all([
    supabase.from("cases").select("*").eq("id", id).maybeSingle(),
    supabase.from("case_participants").select("*").eq("case_id", id).order("joined_at"),
  ]);

  if (caseRes.error) {
    console.error("Case fetch error:", caseRes.error.message);
    return NextResponse.json({ error: "Failed to load case" }, { status: 500 });
  }
  if (!caseRes.data) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  return NextResponse.json({
    data: {
      case: caseRes.data as CaseRow,
      participants: (participantsRes.data ?? []) as CaseParticipantRow[],
    },
  });
}

interface PatchCaseBody {
  name?: string;
  selectedAgent?: string | null;
  status?: string;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const authError = requireAuth(request);
  if (authError) return authError;
  const limited = enforceRateLimit(request, "cases-patch", 30, 60_000);
  if (limited) return limited;
  const { id } = await params;

  const body = (await request.json().catch(() => ({}))) as PatchCaseBody;
  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    if (!name) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    updates.name = name;
  }
  if (body.selectedAgent !== undefined) {
    if (body.selectedAgent !== null && !isCaseAgent(body.selectedAgent)) {
      return NextResponse.json({ error: "Unknown agent" }, { status: 400 });
    }
    updates.selected_agent = body.selectedAgent;
  }
  if (body.status !== undefined) {
    if (!(CASE_STATUSES as readonly string[]).includes(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    updates.status = body.status;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("cases")
    .update(updates)
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) {
    console.error("Case update error:", error.message);
    return NextResponse.json({ error: "Failed to update case" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }
  return NextResponse.json({ data: data as CaseRow });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const authError = requireAuth(request);
  if (authError) return authError;
  const limited = enforceRateLimit(request, "cases-delete", 20, 60_000);
  if (limited) return limited;
  const { id } = await params;

  // Remove uploaded documents from storage first (rows cascade with the case).
  // storage.list() pages at 100 objects — loop until the folder is empty, with an
  // iteration cap so a failing remove() can't spin forever.
  for (let i = 0; i < 20; i++) {
    const { data: objects } = await supabase.storage.from(CASE_DOCUMENTS_BUCKET).list(id, { limit: 100 });
    if (!objects || objects.length === 0) break;
    const { error: removeError } = await supabase.storage
      .from(CASE_DOCUMENTS_BUCKET)
      .remove(objects.map((o) => `${id}/${o.name}`));
    if (removeError || objects.length < 100) break;
  }

  const { error } = await supabase.from("cases").delete().eq("id", id);
  if (error) {
    console.error("Case delete error:", error.message);
    return NextResponse.json({ error: "Failed to delete case" }, { status: 500 });
  }
  return NextResponse.json({ data: { ok: true } });
}
