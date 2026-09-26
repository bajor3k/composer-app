import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import type { AgentTurn as ChatMessage } from "@/lib/ai/azure-agent";
import { AgentNotConfiguredError } from "@/lib/ai/agent-definitions";
import { getReportBuilderResponse, type ReportBuilderContext } from "@/lib/ai/report-builder";

interface ReportBuilderRequest {
  message: string;
  history?: ChatMessage[];
  context?: ReportBuilderContext;
}

export async function POST(request: NextRequest) {
  try {
    const authError = requireAuth(request);
    if (authError) return authError;

    const limited = enforceRateLimit(request, "report-builder", 30, 60_000);
    if (limited) return limited;

    const body = (await request.json()) as ReportBuilderRequest;
    const message = (body.message || "").trim();
    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const result = await getReportBuilderResponse(
      message.slice(0, 2000),
      Array.isArray(body.history) ? body.history.slice(-12) : [],
      body.context,
    );
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error("report-builder error", err);
    // Surfaced rather than swallowed: this one is a deployment mistake, not a bad
    // request, and the message names the missing variable.
    if (err instanceof AgentNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json({ error: "Failed to build report" }, { status: 500 });
  }
}
