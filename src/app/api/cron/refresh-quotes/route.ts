import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/auth";
import { runRefreshCycle } from "@/lib/market/scheduler";

// Refreshing the full book universe involves several upstream round-trips.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled quote refresh.
 *
 * Calls the same runRefreshCycle() the in-process scheduler calls, so there is
 * exactly one refresh implementation regardless of what drives it. Set
 * MARKET_SCHEDULER=off wherever this route is scheduled so the in-process timer
 * and the hosted cron do not both refresh.
 *
 * Platform-agnostic per the Azure end-goal — any scheduler that can issue an
 * HTTP request with a Bearer header works.
 *
 *   curl -X POST localhost:3000/api/cron/refresh-quotes \
 *     -H "Authorization: Bearer $CRON_SECRET"
 */
async function handle(request: NextRequest) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  try {
    // force: a hosted scheduler already owns the cadence, so honour every call
    // rather than second-guessing it against the in-process interval.
    const result = await runRefreshCycle(true);
    console.log("[market] cron refresh", result);
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error("[market] cron refresh failed", err);
    return NextResponse.json({ error: "Quote refresh failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}
