import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { evaluateAlerts } from "@/lib/alerts/evaluate";
import { deliverEvents } from "@/lib/alerts/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The in-app "Run checks now" button.
 *
 * The same evaluator the cron uses, but session-authed instead of CRON_SECRET —
 * this is the difference between "I set an alert and hope" and being able to see
 * it work. `?dry=1` computes without writing, which is what the rules table's
 * "Test now" uses.
 */
export async function POST(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;
  const limited = enforceRateLimit(request, "alerts-run", 5, 60_000);
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const dryRun = searchParams.get("dry") === "1";
  const alertId = searchParams.get("alertId") ?? undefined;

  try {
    const summary = await evaluateAlerts({ dryRun, alertId });
    if (!dryRun) await deliverEvents(summary.eventsWritten);
    return NextResponse.json({ data: summary });
  } catch (err) {
    console.error("[alerts] manual run failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Alert evaluation failed" },
      { status: 500 },
    );
  }
}
