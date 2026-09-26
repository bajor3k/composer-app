import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireAuth, getSession } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { supabase } from "@/lib/supabase";
import {
  ALLOWED_DOC_TYPES,
  CASE_DOCUMENTS_BUCKET,
  MAX_DOC_SIZE,
  touchCase,
  upsertParticipant,
  type CaseDocumentRow,
} from "@/lib/cases";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const authError = requireAuth(request);
  if (authError) return authError;
  const { id } = await params;

  const { data, error } = await supabase
    .from("case_documents")
    .select("*")
    .eq("case_id", id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Case documents fetch error:", error.message);
    return NextResponse.json({ error: "Failed to load documents" }, { status: 500 });
  }
  return NextResponse.json({ data: (data ?? []) as CaseDocumentRow[] });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const authError = requireAuth(request);
  if (authError) return authError;
  const limited = enforceRateLimit(request, "case-documents", 20, 60_000);
  if (limited) return limited;

  const session = getSession(request)!;
  const { id } = await params;

  const { data: caseRow } = await supabase.from("cases").select("id").eq("id", id).maybeSingle();
  if (!caseRow) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "A file is required" }, { status: 400 });
  }
  if (!ALLOWED_DOC_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }
  if (file.size > MAX_DOC_SIZE) {
    return NextResponse.json({ error: "File exceeds the 10MB limit" }, { status: 400 });
  }

  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-100) || "upload";
  const storagePath = `${id}/${randomUUID()}-${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from(CASE_DOCUMENTS_BUCKET)
    .upload(storagePath, buffer, { contentType: file.type });

  if (uploadError) {
    console.error("Case document upload error:", uploadError.message);
    return NextResponse.json({ error: "Failed to upload file" }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("case_documents")
    .insert({
      id: randomUUID(),
      case_id: id,
      uploaded_by: session.userId,
      uploaded_by_name: session.name,
      file_name: file.name.slice(-140),
      mime_type: file.type,
      size_bytes: file.size,
      storage_path: storagePath,
    })
    .select()
    .single();

  if (error || !data) {
    console.error("Case document insert error:", error?.message);
    // Best effort: don't leave an orphaned object behind.
    await supabase.storage.from(CASE_DOCUMENTS_BUCKET).remove([storagePath]);
    return NextResponse.json({ error: "Failed to save document" }, { status: 500 });
  }

  await Promise.all([
    upsertParticipant(id, { userId: session.userId, name: session.name }),
    touchCase(id),
  ]);

  return NextResponse.json({ data: data as CaseDocumentRow });
}
