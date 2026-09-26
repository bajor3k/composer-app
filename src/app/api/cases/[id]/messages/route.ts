import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireAuth, getSession } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { supabase } from "@/lib/supabase";
import { buildCaseContext } from "@/lib/ai/case-context";
import { runAgent } from "@/lib/ai/azure-agent";
import { touchCase, upsertParticipant, type CaseMessageRow, type CaseRow } from "@/lib/cases";

type RouteParams = { params: Promise<{ id: string }> };

const MAX_CONTENT_LENGTH = 8000;
const HISTORY_WINDOW = 20;
const WORKSPACE_AGENT = "workspace";
const WORKSPACE_AGENT_DISPLAY = "Workspace Agent";
// Matches the account-number formats in the live data — letter-prefixed
// (ABC343299, PZG452187) and dashed numeric: Schwab 5149-9391 and Fidelity
// 77-123456. The numeric branch allows a 2-digit head because Fidelity's format
// has only two digits before the dash; requiring 3 silently failed to match it,
// which cost a Fidelity-linked case its account context with no error.
const ACCOUNT_TOKEN = /\b(?:[A-Z]{1,5}\d{3,8}|\d{2,5}-\d{3,6})\b/i;

/**
 * Mention aliases carried over from the old per-specialty agents. A single Foundry
 * agent now covers all three reviews, so a mention only steers which lens it leads
 * with — an empty hint means "you choose".
 */
const FOCUS_HINTS: Record<string, string> = {
  agent: "",
  workspace: "",
  margin: "Lead with margin, balances, and call status.",
  costbasis: "Lead with cost basis integrity.",
  audit: "Give a full account review.",
};

export async function GET(request: NextRequest, { params }: RouteParams) {
  const authError = requireAuth(request);
  if (authError) return authError;
  const { id } = await params;

  const { data, error } = await supabase
    .from("case_messages")
    .select("*")
    .eq("case_id", id)
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) {
    console.error("Case messages fetch error:", error.message);
    return NextResponse.json({ error: "Failed to load messages" }, { status: 500 });
  }
  return NextResponse.json({ data: (data ?? []) as CaseMessageRow[] });
}

/**
 * Human turns are labelled `Name: content` so the agent can follow a multi-person
 * thread, and it sometimes imitates the convention by opening its own reply with a
 * participant's name. Instructing it not to only mostly works, so strip it here too.
 *
 * Only an actual participant's name is stripped — that way a reply legitimately
 * opening with a quoted name or a label is left alone.
 */
function stripSpeakerPrefix(reply: string, participants: Set<string>): string {
  const match = reply.match(/^\s*([^\n:]{1,60}):\s*/);
  if (match && participants.has(match[1].trim())) {
    return reply.slice(match[0].length);
  }
  return reply;
}

/**
 * Decide whether this message should wake an agent, and which one.
 *
 * - `@agent …` / `@workspace …` wake the agent with no particular focus.
 * - `@margin …` / `@costbasis …` / `@audit …` steer which review it leads with.
 * - A bare message continues the previous agent thread ONLY when the message
 *   right before it is an agent reply that this same user triggered — so
 *   teammate-to-teammate chatter never wakes the agent.
 */
function resolveAgentTarget(
  content: string,
  history: CaseMessageRow[],
  userId: string
): { focus: string; query: string } | null {
  const trimmed = content.trim();

  const mention = trimmed.match(/^@(\w+)\s*([\s\S]*)/);
  if (mention) {
    const focus = FOCUS_HINTS[mention[1].toLowerCase()];
    if (focus === undefined) return null; // unknown mention — plain chat
    return { focus, query: mention[2].trim() };
  }

  const last = history[history.length - 1];
  const beforeLast = history[history.length - 2];
  if (
    last?.author_type === "agent" &&
    beforeLast?.author_type === "user" &&
    beforeLast.author_id === userId
  ) {
    return { focus: "", query: trimmed };
  }
  return null;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const authError = requireAuth(request);
  if (authError) return authError;
  const limited = enforceRateLimit(request, "case-messages", 30, 60_000);
  if (limited) return limited;

  const session = getSession(request)!;
  const { id } = await params;

  const body = (await request.json().catch(() => ({}))) as { content?: string };
  const content = typeof body.content === "string" ? body.content.trim().slice(0, MAX_CONTENT_LENGTH) : "";
  if (!content) {
    return NextResponse.json({ error: "Message content is required" }, { status: 400 });
  }

  const { data: caseRow } = await supabase.from("cases").select("*").eq("id", id).maybeSingle();
  if (!caseRow) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  // Thread history BEFORE this message — used for continuation detection and agent context.
  const { data: recentDesc } = await supabase
    .from("case_messages")
    .select("*")
    .eq("case_id", id)
    .order("created_at", { ascending: false })
    .limit(HISTORY_WINDOW);
  const history = ((recentDesc ?? []) as CaseMessageRow[]).reverse();

  const userMessage = {
    id: randomUUID(),
    case_id: id,
    author_id: session.userId,
    author_name: session.name,
    author_type: "user" as const,
    agent: null,
    content,
  };

  const { data: insertedMessage, error: insertError } = await supabase
    .from("case_messages")
    .insert(userMessage)
    .select()
    .single();

  if (insertError || !insertedMessage) {
    console.error("Case message insert error:", insertError?.message);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }

  await Promise.all([
    upsertParticipant(id, { userId: session.userId, name: session.name }),
    touchCase(id),
  ]);

  // Server-side agent routing so the reply row broadcasts to every participant.
  let agentMessage: CaseMessageRow | null = null;
  const target = resolveAgentTarget(content, history, session.userId);

  if (target) {
    try {
      // Only the token-shaped part of the stored account number is ever used, and
      // only to select which account to load. account_number is user-supplied at
      // case creation, so the raw field never reaches the model — that would let one
      // teammate smuggle instructions into another teammate's agent turn.
      const accountToken = (caseRow as CaseRow).account_number?.match(ACCOUNT_TOKEN)?.[0] ?? null;
      const resolved = accountToken ? await buildCaseContext(accountToken) : null;
      const baseContext =
        resolved?.context ??
        "=== ACCOUNT OVERVIEW ===\nThis case is not linked to a resolvable account, so no account data is available.";

      // The speaker goes in the context block rather than as a `Name:` prefix on the
      // message. Prefixing the live turn made the agent imitate the convention and
      // open its own replies with "Demo User: …".
      const context = `${baseContext}\n\n=== CURRENT SPEAKER ===\n${session.name}\nPrior human turns in this thread are prefixed with the speaker's name. That prefix identifies who is talking — never use it on your own replies.`;

      const agentHistory = history.map((m) => ({
        role: m.author_type === "agent" ? ("assistant" as const) : ("user" as const),
        content: m.author_type === "agent" ? m.content : `${m.author_name}: ${m.content}`,
      }));

      const question =
        [target.focus, target.query].filter(Boolean).join("\n\n") ||
        "Give me a review of this account. Lead with anything that needs attention.";

      const { text: raw } = await runAgent({ context, message: question, history: agentHistory });
      const participants = new Set<string>([
        session.name,
        ...history.filter((m) => m.author_type === "user").map((m) => m.author_name),
      ]);
      const reply = stripSpeakerPrefix(raw, participants);

      const { data: agentRow } = await supabase
        .from("case_messages")
        .insert({
          id: randomUUID(),
          case_id: id,
          author_id: `agent:${WORKSPACE_AGENT}`,
          author_name: WORKSPACE_AGENT_DISPLAY,
          author_type: "agent",
          agent: WORKSPACE_AGENT,
          content: reply,
        })
        .select()
        .single();
      agentMessage = (agentRow as CaseMessageRow) ?? null;
      await touchCase(id);
    } catch (error) {
      console.error("Workspace agent invocation error:", error);
      // Say so in-thread. A silent no-reply is indistinguishable from being ignored.
      const { data: systemRow } = await supabase
        .from("case_messages")
        .insert({
          id: randomUUID(),
          case_id: id,
          author_id: "system",
          author_name: "Composer",
          author_type: "system",
          agent: null,
          content: "The workspace agent could not be reached. Please try again in a moment.",
        })
        .select()
        .single();
      agentMessage = (systemRow as CaseMessageRow) ?? null;
    }
  }

  return NextResponse.json({
    data: { message: insertedMessage as CaseMessageRow, agentMessage },
  });
}
