import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { supabase } from "@/lib/supabase";
import { CASE_DOCUMENTS_BUCKET, type CaseDocumentRow } from "@/lib/cases";

type RouteParams = { params: Promise<{ id: string; docId: string }> };

async function findDocument(caseId: string, docId: string): Promise<CaseDocumentRow | null> {
  const { data } = await supabase
    .from("case_documents")
    .select("*")
    .eq("id", docId)
    .eq("case_id", caseId)
    .maybeSingle();
  return (data as CaseDocumentRow) ?? null;
}

/** Mint a short-lived download URL for a case document. */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const authError = requireAuth(request);
  if (authError) return authError;
  const { id, docId } = await params;

  const doc = await findDocument(id, docId);
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const { data, error } = await supabase.storage
    .from(CASE_DOCUMENTS_BUCKET)
    .createSignedUrl(doc.storage_path, 3600);

  if (error || !data?.signedUrl) {
    console.error("Signed URL error:", error?.message);
    return NextResponse.json({ error: "Failed to create download link" }, { status: 500 });
  }
  return NextResponse.json({ data: { url: data.signedUrl } });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const authError = requireAuth(request);
  if (authError) return authError;
  const limited = enforceRateLimit(request, "case-doc-delete", 20, 60_000);
  if (limited) return limited;
  const { id, docId } = await params;

  const doc = await findDocument(id, docId);
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  await supabase.storage.from(CASE_DOCUMENTS_BUCKET).remove([doc.storage_path]);
  const { error } = await supabase.from("case_documents").delete().eq("id", docId);
  if (error) {
    console.error("Case document delete error:", error.message);
    return NextResponse.json({ error: "Failed to delete document" }, { status: 500 });
  }
  return NextResponse.json({ data: { ok: true } });
}
