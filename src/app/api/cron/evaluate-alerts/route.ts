import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/auth";
import { evaluateAlerts } from "@/lib/alerts/evaluate";
import { deliverEvents } from "@/lib/alerts/notify";

// A full book scan can exceed the default budget, and a half-evaluated sweep is
// worse than none — some rules would silently never fire.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled alert evaluation.
 *
 * Platform-agnostic per the Azure end-goal: any scheduler that can issue an HTTP
 * request with a Bearer header works — an Azure Container Apps job, a Logic App
 * recurrence, GitHub Actions, or plain cron + curl. No vercel.json assumption.
 *
 * This is the first call site for requireCronAuth, which has been sitting unused
 * in src/lib/auth.ts.
 *
 *   curl -X POST localhost:3000/api/cron/evaluate-alerts \
 *     -H "Authorization: Bearer $CRON_SECRET"
 */
async function handle(request: NextRequest) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  try {
    const summary = await evaluateAlerts();
    console.log("[alerts] cron run", summary);
    // Never lets an email outage fail the run — the event rows are already
    // committed, and they are the real in-app delivery.
    const delivery = await deliverEvents(summary.eventsWritten);
    return NextResponse.json({ data: { ...summary, delivery } });
  } catch (err) {
    console.error("[alerts] cron failed", err);
    return NextResponse.json({ error: "Alert evaluation failed" }, { status: 500 });
  }
}

export const POST = handle;
// Aliased because several schedulers only emit GET.
export const GET = handle;
