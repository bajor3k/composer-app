import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getReportById } from "@/lib/report-registry";
import { executeQuery, type QueryIntent } from "@/lib/ai/query-builder";

/**
 * Direct execution for the report catalog.
 *
 * `report-registry.ts` already declares the intent and params for every command —
 * `/trusts` is `accounts_list` with `{accountType: "trust"}`. Until now that metadata
 * was discarded: the command's English text was sent to the chat endpoint so a model
 * could rediscover the intent sitting in a const array. This runs it directly.
 *
 * Deliberately accepts `reportId`, never a raw intent. The catalog is the allowlist,
 * which keeps `dynamic_query` — model-authored SQL behind only a keyword blocklist
 * (`query-builder.ts`) — unreachable from anything client-facing.
 */

interface ReportRequest {
  reportId?: string;
  params?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  // Higher than /api/chat's 30 — this is a plain database query, not a model run.
  const limited = enforceRateLimit(request, "reports", 60, 60_000);
  if (limited) return limited;

  const body = (await request.json().catch(() => ({}))) as ReportRequest;
  const reportId = typeof body.reportId === "string" ? body.reportId : "";

  const report = getReportById(reportId);
  if (!report) {
    return NextResponse.json({ error: `Unknown report: ${reportId}` }, { status: 400 });
  }

  // Only params the catalog declares for this report are accepted. Anything else the
  // client sends is dropped rather than forwarded into the query builder.
  const declared = new Set((report.params ?? []).map((p) => p.key));
  const supplied: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body.params ?? {})) {
    if (declared.has(key) && value !== undefined && value !== null && value !== "") {
      supplied[key] = value;
    }
  }

  const missing = (report.params ?? [])
    .filter((p) => p.required && supplied[p.key] === undefined)
    .map((p) => p.label);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing required input: ${missing.join(", ")}` },
      { status: 400 }
    );
  }

  const result = await executeQuery({
    intent: report.intent,
    params: { ...report.defaultParams, ...supplied },
  } as QueryIntent);

  if (result.error) {
    console.error(`Report ${reportId} failed:`, result.error);
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  const rows = result.data;
  return NextResponse.json({
    data: {
      rows,
      reportId: report.id,
      intent: report.intent,
      label: report.label,
      rowCount: Array.isArray(rows) ? rows.length : rows ? 1 : 0,
    },
  });
}
