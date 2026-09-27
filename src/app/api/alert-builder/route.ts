import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import type { AgentTurn as ChatMessage } from "@/lib/ai/azure-agent";
import { AgentNotConfiguredError } from "@/lib/ai/agent-definitions";
import { AGENTS_ENABLED, AGENTS_DISABLED_MESSAGE } from "@/lib/ai/foundry-client";
import { getAlertBuilderResponse, type AlertBuilderContext } from "@/lib/alerts/alert-builder";

interface AlertBuilderRequest {
  message: string;
  history?: ChatMessage[];
  context?: AlertBuilderContext;
}

export async function POST(request: NextRequest) {
  try {
    const authError = requireAuth(request);
    if (authError) return authError;

    const limited = enforceRateLimit(request, "alert-builder", 30, 60_000);
    if (limited) return limited;

    // Every AI agent is switched off in this public copy (see foundry-client.ts).
    if (!AGENTS_ENABLED) {
      return NextResponse.json({ error: AGENTS_DISABLED_MESSAGE }, { status: 503 });
    }

    const body = (await request.json()) as AlertBuilderRequest;
    const message = (body.message || "").trim();
    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const result = await getAlertBuilderResponse(
      message.slice(0, 2000),
      Array.isArray(body.history) ? body.history.slice(-12) : [],
      body.context,
    );
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error("alert-builder error", err);
    // Surfaced rather than swallowed: this one is a deployment mistake, not a bad
    // request, and the message names the missing variable. The alternative is a
    // generic 500 that looks identical to a model failure.
    if (err instanceof AgentNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json({ error: "Failed to build alert" }, { status: 500 });
  }
}
