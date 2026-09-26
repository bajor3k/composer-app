import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getSession } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { supabase } from "@/lib/supabase";
import type { ConversationMessageRow, StoredCard } from "@/lib/conversations";
import { loadOwnedConversation, touchConversation } from "@/lib/conversations-server";

type RouteParams = { params: Promise<{ id: string }> };

interface IncomingMessage {
  id?: string;
  role?: string;
  content?: string;
  refs?: unknown;
  card?: StoredCard | null;
}

interface AppendBody {
  messages?: IncomingMessage[];
}

/** One turn is a user message plus an assistant reply; a batch is capped well above that. */
const MAX_BATCH = 50;
const MAX_CONTENT = 100_000;

export async function POST(request: NextRequest, { params }: RouteParams) {
  const authError = requireAuth(request);
  if (authError) return authError;
  const limited = enforceRateLimit(request, "conversations-append", 120, 60_000);
  if (limited) return limited;
  const session = getSession(request)!;
  const { id } = await params;

  if (!(await loadOwnedConversation(id, session.userId))) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as AppendBody;
  const incoming = Array.isArray(body.messages) ? body.messages.slice(0, MAX_BATCH) : [];

  const valid = incoming.filter(
    (m): m is IncomingMessage & { id: string; role: "user" | "assistant"; content: string } =>
      typeof m?.id === "string" &&
      m.id.length > 0 &&
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string",
  );
  if (valid.length === 0) {
    return NextResponse.json({ error: "No valid messages" }, { status: 400 });
  }

  // Idempotency: the client retries on failure, and a retry must not duplicate the turn.
  // Drop ids already stored, then number the rest from the current high-water mark.
  const [existingRes, maxRes] = await Promise.all([
    supabase
      .from("conversation_messages")
      .select("id")
      .eq("conversation_id", id)
      .in("id", valid.map((m) => m.id)),
    supabase
      .from("conversation_messages")
      .select("seq")
      .eq("conversation_id", id)
      .order("seq", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const alreadyStored = new Set((existingRes.data ?? []).map((r) => (r as { id: string }).id));
  const fresh = valid.filter((m) => !alreadyStored.has(m.id));
  if (fresh.length === 0) {
    return NextResponse.json({ data: { inserted: 0 } });
  }

  let seq = ((maxRes.data as { seq: number } | null)?.seq ?? -1) + 1;
  const rows = fresh.map((m) => ({
    id: m.id,
    conversation_id: id,
    seq: seq++,
    role: m.role,
    content: m.content.slice(0, MAX_CONTENT),
    refs: Array.isArray(m.refs) ? m.refs : null,
    card: m.card ?? null,
  }));

  const { data, error } = await supabase.from("conversation_messages").insert(rows).select();
  if (error) {
    console.error("Conversation append error:", error.message);
    return NextResponse.json({ error: "Failed to save messages" }, { status: 500 });
  }

  await touchConversation(id);

  return NextResponse.json({
    data: { inserted: (data ?? []).length, messages: (data ?? []) as ConversationMessageRow[] },
  });
}
