import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireAuth, getSession } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { supabase } from "@/lib/supabase";
import {
  isConversationKind,
  normalizeTitle,
  type ConversationRow,
} from "@/lib/conversations";

/**
 * List the signed-in user's conversations. Unlike /api/cases, history is PRIVATE —
 * scoped to created_by, never the whole team's.
 */
export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;
  const session = getSession(request)!;

  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("created_by", session.userId)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("Conversations list error:", error.message);
    return NextResponse.json({ error: "Failed to load conversations" }, { status: 500 });
  }
  return NextResponse.json({ data: (data ?? []) as ConversationRow[] });
}

interface CreateConversationBody {
  title?: string;
  kind?: string;
  accountNumber?: string;
  accountName?: string;
  householdName?: string;
}

export async function POST(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;
  const limited = enforceRateLimit(request, "conversations-create", 30, 60_000);
  if (limited) return limited;

  const session = getSession(request)!;
  const body = (await request.json().catch(() => ({}))) as CreateConversationBody;

  if (body.kind !== undefined && !isConversationKind(body.kind)) {
    return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  }

  const row = {
    id: randomUUID(),
    title: normalizeTitle(body.title) || "New chat",
    kind: body.kind ?? "chat",
    account_number: typeof body.accountNumber === "string" ? body.accountNumber.trim().slice(0, 32) || null : null,
    account_name: typeof body.accountName === "string" ? body.accountName.trim().slice(0, 120) || null : null,
    household_name: typeof body.householdName === "string" ? body.householdName.trim().slice(0, 120) || null : null,
    created_by: session.userId,
    created_by_name: session.name,
  };

  const { data, error } = await supabase.from("conversations").insert(row).select().single();
  if (error || !data) {
    console.error("Conversation create error:", error?.message);
    return NextResponse.json({ error: "Failed to create conversation" }, { status: 500 });
  }
  return NextResponse.json({ data: data as ConversationRow });
}
