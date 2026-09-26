import { supabase } from "@/lib/supabase";
import { CASE_AGENT_NAMES } from "@/lib/ai/agents/agent-menu";

/**
 * Shared types + helpers for the collaborative case workspace.
 * Row shapes mirror supabase/migrations/0002_case_workspace.sql.
 * Kept isomorphic (anon Supabase client only) — imported by both the
 * /api/cases routes and the /cases/[id] client components.
 */

export interface CaseRow {
  id: string;
  name: string;
  account_number: string | null;
  household_name: string | null;
  status: "open" | "closed";
  selected_agent: string | null;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface CaseMessageRow {
  id: string;
  case_id: string;
  author_id: string;
  author_name: string;
  author_type: "user" | "agent" | "system";
  agent: string | null;
  content: string;
  created_at: string;
}

export interface CaseParticipantRow {
  case_id: string;
  user_id: string;
  user_name: string;
  joined_at: string;
}

export interface CaseDocumentRow {
  id: string;
  case_id: string;
  uploaded_by: string;
  uploaded_by_name: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  storage_path: string;
  created_at: string;
}

export const CASE_DOCUMENTS_BUCKET = "case-documents";

// Mirrors the attachment allowlist in AiChatInput.
export const ALLOWED_DOC_TYPES = [
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png",
  "image/jpeg",
];

export const MAX_DOC_SIZE = 10 * 1024 * 1024; // 10MB

export const CASE_STATUSES = ["open", "closed"] as const;

export function isCaseAgent(name: string): boolean {
  return (CASE_AGENT_NAMES as readonly string[]).includes(name);
}

/** Record that a user is part of a case (idempotent). */
export async function upsertParticipant(
  caseId: string,
  user: { userId: string; name: string }
): Promise<void> {
  await supabase.from("case_participants").upsert(
    { case_id: caseId, user_id: user.userId, user_name: user.name },
    { onConflict: "case_id,user_id", ignoreDuplicates: true }
  );
}

/** Bump a case's updated_at so the sidebar sorts active cases first. */
export async function touchCase(caseId: string): Promise<void> {
  await supabase
    .from("cases")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", caseId);
}
