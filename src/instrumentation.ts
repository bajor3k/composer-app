/**
 * Next.js instrumentation hook — runs once per server process at boot, before
 * any route compiles.
 *
 * This is where the in-process market data scheduler starts for local dev, so
 * the quote cache is already warm by the time the first page renders and there
 * is nothing extra for an operator to run alongside `npm run dev`.
 *
 * In a hosted environment the same work is driven by
 * POST /api/cron/refresh-quotes with a CRON_SECRET bearer token; set
 * MARKET_SCHEDULER=off there so the two do not both run.
 */
export async function register() {
  // register() also fires on the Edge runtime, where src/proxy.ts runs. The
  // market modules pull in yahoo-finance2 and node:* APIs, which Edge cannot
  // load — without this guard, boot throws.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (process.env.MARKET_SCHEDULER === "off") {
    console.log("[market] scheduler disabled via MARKET_SCHEDULER=off");
    return;
  }

  const { startMarketScheduler } = await import("@/lib/market/scheduler");
  startMarketScheduler();
}
