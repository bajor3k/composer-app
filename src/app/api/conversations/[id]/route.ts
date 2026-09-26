import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getSession } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { supabase } from "@/lib/supabase";
import { normalizeTitle, type ConversationMessageRow, type ConversationRow } from "@/lib/conversations";
import { loadOwnedConversation } from "@/lib/conversations-server";

type RouteParams = { params: Promise<{ id: string }> };

/** Conversation plus its full transcript, ordered by seq. */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const authError = requireAuth(request);
  if (authError) return authError;
  const session = getSession(request)!;
  const { id } = await params;

  const conversation = await loadOwnedConversation(id, session.userId);
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("conversation_messages")
    .select("*")
    .eq("conversation_id", id)
    .order("seq", { ascending: true });

  if (error) {
    console.error("Conversation messages fetch error:", error.message);
    return NextResponse.json({ error: "Failed to load conversation" }, { status: 500 });
  }

  return NextResponse.json({
    data: {
      conversation,
      messages: (data ?? []) as ConversationMessageRow[],
    },
  });
}

interface PatchConversationBody {
  title?: string;
  pinned?: boolean;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const authError = requireAuth(request);
  if (authError) return authError;
  const limited = enforceRateLimit(request, "conversations-patch", 60, 60_000);
  if (limited) return limited;
  const session = getSession(request)!;
  const { id } = await params;

  if (!(await loadOwnedConversation(id, session.userId))) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as PatchConversationBody;
  const updates: Record<string, unknown> = {};

  if (body.title !== undefined) {
    const title = normalizeTitle(body.title);
    if (!title) return NextResponse.json({ error: "Title cannot be empty" }, { status: 400 });
    updates.title = title;
  }
  if (body.pinned !== undefined) {
    if (typeof body.pinned !== "boolean") {
      return NextResponse.json({ error: "pinned must be a boolean" }, { status: 400 });
    }
    updates.pinned = body.pinned;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // Renaming or pinning is not conversation activity — leave updated_at alone so the
  // sidebar keeps its "most recently talked to" order.
  const { data, error } = await supabase
    .from("conversations")
    .update(updates)
    .eq("id", id)
    .eq("created_by", session.userId)
    .select()
    .maybeSingle();

  if (error) {
    console.error("Conversation update error:", error.message);
    return NextResponse.json({ error: "Failed to update conversation" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
  return NextResponse.json({ data: data as ConversationRow });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const authError = requireAuth(request);
  if (authError) return authError;
  const limited = enforceRateLimit(request, "conversations-delete", 30, 60_000);
  if (limited) return limited;
  const session = getSession(request)!;
  const { id } = await params;

  if (!(await loadOwnedConversation(id, session.userId))) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Messages cascade via the FK.
  const { error } = await supabase
    .from("conversations")
    .delete()
    .eq("id", id)
    .eq("created_by", session.userId);

  if (error) {
    console.error("Conversation delete error:", error.message);
    return NextResponse.json({ error: "Failed to delete conversation" }, { status: 500 });
  }
  return NextResponse.json({ data: { ok: true } });
}
