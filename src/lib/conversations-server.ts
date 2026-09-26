// Server-only helpers for conversation routes. Kept out of src/lib/conversations.ts so
// that file stays pure and client-importable.

import { supabase } from "@/lib/supabase";
import type { ConversationRow } from "@/lib/conversations";

/**
 * Load a conversation only if it belongs to `userId`.
 *
 * requireAuth authenticates but does not authorize — without this check any signed-in
 * user could read, mutate or delete another user's conversation by guessing an id.
 *
 * Returns null both when the row is missing and when it belongs to someone else, so
 * callers answer 404 either way. A 403 would confirm the id exists.
 */
export async function loadOwnedConversation(
  id: string,
  userId: string,
): Promise<ConversationRow | null> {
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", id)
    .eq("created_by", userId)
    .maybeSingle();

  if (error) {
    console.error("Conversation ownership check error:", error.message);
    return null;
  }
  return (data as ConversationRow | null) ?? null;
}

/** Bump updated_at so the sidebar reorders. Mirrors touchCase in src/lib/cases.ts. */
export async function touchConversation(id: string): Promise<void> {
  const { error } = await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.error("Conversation touch error:", error.message);
}
