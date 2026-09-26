import { NextRequest, NextResponse } from "next/server";
import { getSession, requireAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { CUSTODIANS, PRIORITIES, REQUEST_TYPES } from "@/lib/jira-fields";
import { createTicket, getJiraConfig } from "@/lib/jira";

/**
 * Create a Jira ticket in the Operations project from the Composer composer bar.
 *
 * The Atlassian token stays server-side (see lib/jira.ts). Everything the client
 * sends is re-validated here — the modal's `required` attributes and `<select>`
 * options are a UX affordance, not a trust boundary.
 */

// Advisers file a handful of tickets a day, not dozens; this is a typo-loop and
// double-submit guard, not a throughput limit.
const RATE = { limit: 12, windowMs: 60_000 };

const MAX = { summary: 240, description: 4000, comment: 2000, account: 64, client: 120 };

interface Body {
  accountNumber?: unknown;
  summary?: unknown;
  description?: unknown;
  requestType?: unknown;
  priority?: unknown;
  custodian?: unknown;
  clientName?: unknown;
  comment?: unknown;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Is Jira wired up? The modal calls this on open so it can warn before the user types. */
export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  const config = getJiraConfig();
  return NextResponse.json({
    data: {
      configured: !!config,
      projectKey: config?.projectKey ?? null,
      requestTypes: REQUEST_TYPES,
      priorities: PRIORITIES,
      custodians: CUSTODIANS,
    },
  });
}

export async function POST(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  const limited = enforceRateLimit(request, "jira-ticket", RATE.limit, RATE.windowMs);
  if (limited) return limited;

  const body = (await request.json().catch(() => ({}))) as Body;

  const accountNumber = str(body.accountNumber);
  const summary = str(body.summary);
  const description = str(body.description);
  const requestType = str(body.requestType);
  const priority = str(body.priority) || "Medium";
  const custodian = str(body.custodian);
  const clientName = str(body.clientName);
  const comment = str(body.comment);

  const missing: string[] = [];
  if (!accountNumber) missing.push("Account number");
  if (!summary) missing.push("Summary");
  if (!description) missing.push("Description");
  if (missing.length) {
    return NextResponse.json({ error: `Missing required field: ${missing.join(", ")}` }, { status: 400 });
  }

  if (summary.length > MAX.summary) {
    return NextResponse.json({ error: `Summary must be ${MAX.summary} characters or fewer.` }, { status: 400 });
  }
  if (description.length > MAX.description) {
    return NextResponse.json({ error: `Description must be ${MAX.description} characters or fewer.` }, { status: 400 });
  }
  if (comment.length > MAX.comment) {
    return NextResponse.json({ error: `Comment must be ${MAX.comment} characters or fewer.` }, { status: 400 });
  }
  if (accountNumber.length > MAX.account || clientName.length > MAX.client) {
    return NextResponse.json({ error: "Account number or client name is too long." }, { status: 400 });
  }

  // Enum fields are allowlisted rather than trusted — an unknown priority would
  // otherwise reach Jira and fail the create with an opaque 400.
  if (!(PRIORITIES as readonly string[]).includes(priority)) {
    return NextResponse.json({ error: `Unknown priority: ${priority}` }, { status: 400 });
  }
  if (requestType && !(REQUEST_TYPES as readonly string[]).includes(requestType)) {
    return NextResponse.json({ error: `Unknown request type: ${requestType}` }, { status: 400 });
  }
  if (custodian && !(CUSTODIANS as readonly string[]).includes(custodian)) {
    return NextResponse.json({ error: `Unknown custodian: ${custodian}` }, { status: 400 });
  }

  const session = getSession(request);

  const result = await createTicket({
    accountNumber,
    summary,
    description,
    requestType: requestType || "Other",
    priority,
    custodian: custodian || undefined,
    clientName: clientName || undefined,
    comment: comment || undefined,
    reporter: session?.name || session?.username || undefined,
  });

  if (!result.ok) {
    console.error("Jira ticket create failed:", result.error);
    // 5xx from Atlassian is surfaced as 502 — the Composer route itself is fine.
    const status = result.error.status === 503 ? 503 : result.error.status >= 500 ? 502 : result.error.status;
    return NextResponse.json({ error: result.error.message }, { status });
  }

  return NextResponse.json({ data: result.ticket });
}
