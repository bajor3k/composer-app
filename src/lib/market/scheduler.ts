// SERVER ONLY — never import from a "use client" module.
/**
 * Periodic quote refresh.
 *
 * Runs in-process for local dev (booted from src/instrumentation.ts) and is
 * also the body of the CRON_SECRET-guarded HTTP route, so a hosted scheduler
 * drives the identical code path. That keeps the Azure story structural rather
 * than aspirational — there is one refresh implementation, not two.
 */

import { getMarketStatus } from "./market-hours";
import { loadBook } from "./book";
import {
  cacheStats,
  getInFlight,
  hydrateFromDb,
  isHydrated,
  loadUniverse,
  refreshQuotes,
  setInFlight,
} from "./quote-cache";
import { persistPrices } from "./persist";

/** Upstream refresh cadence while the market is open. */
const LIVE_REFRESH_MS = Number(process.env.MARKET_REFRESH_MS) || 30_000;

/**
 * When the market is closed, prices come from the simulator, which needs no
 * network at all. We still poll occasionally to notice the reopen and to
 * refresh the anchors the simulation oscillates around.
 */
const CLOSED_REFRESH_MS = 15 * 60_000;

/** The scheduler re-evaluates cadence on this grid. */
const TICK_MS = 30_000;

const STATE_KEY = Symbol.for("composer.market.scheduler");

interface Slot {
  timer: ReturnType<typeof setInterval>;
  startedAt: number;
  lastRefreshAt: number;
}

export interface CycleResult {
  refreshed: number;
  failed: number;
  rateLimited: boolean;
  skipped: boolean;
  mode: "live" | "simulated";
  tracked: number;
  persisted?: number;
}

/**
 * One refresh cycle. Shared by the in-process timer and the cron route.
 * Never throws — a scheduler that dies mid-demo is worse than a stale quote.
 */
export async function runRefreshCycle(force = false): Promise<CycleResult> {
  const status = getMarketStatus();

  try {
    if (!isHydrated()) await hydrateFromDb();
    await loadUniverse();

    const s = slotOrNull();
    const interval = status.mode === "live" ? LIVE_REFRESH_MS : CLOSED_REFRESH_MS;
    const due = !s || Date.now() - s.lastRefreshAt >= interval;

    if (!force && !due) {
      return {
        refreshed: 0,
        failed: 0,
        rateLimited: false,
        skipped: true,
        mode: status.mode,
        tracked: cacheStats().size,
      };
    }

    const res = await refreshQuotes();
    if (s) s.lastRefreshAt = Date.now();

    // Keep the book warm so the first request that asks for account values
    // does not pay for a 7-page paginated read.
    void loadBook().catch(() => {});

    const persisted = await persistPrices();

    return {
      refreshed: res.ok,
      failed: res.failed,
      rateLimited: res.rateLimited,
      skipped: Boolean(res.skipped),
      mode: status.mode,
      tracked: cacheStats().size,
      ...(persisted != null ? { persisted } : {}),
    };
  } catch (e) {
    console.error("[market] refresh cycle failed:", e);
    return {
      refreshed: 0,
      failed: 0,
      rateLimited: false,
      skipped: true,
      mode: status.mode,
      tracked: cacheStats().size,
    };
  }
}

function slotOrNull(): Slot | null {
  const g = globalThis as unknown as Record<symbol, Slot | undefined>;
  return g[STATE_KEY] ?? null;
}

/**
 * Bootstrap: seed from the DB first so the first paint has numbers, then load
 * the universe and pull real quotes.
 */
async function bootstrap(): Promise<void> {
  const p = (async () => {
    await hydrateFromDb();
    await loadUniverse(true);
    await runRefreshCycle(true);
    await loadBook(true);
    const stats = cacheStats();
    console.log(
      `[market] ready — ${stats.size} symbols cached, ${stats.universe} in book universe`,
    );
  })();

  setInFlight(p);
  try {
    await p;
  } finally {
    setInFlight(null);
  }
}

/**
 * Start the in-process scheduler. Idempotent.
 *
 * The globalThis guard matters in `next dev`: HMR and lazy per-route
 * compilation re-evaluate module scope, and without it every recompile would
 * add another timer and multiply the upstream request rate.
 */
export function startMarketScheduler(): void {
  const g = globalThis as unknown as Record<symbol, Slot | undefined>;
  if (g[STATE_KEY]) return;

  g[STATE_KEY] = {
    timer: setInterval(() => {
      void runRefreshCycle();
    }, TICK_MS),
    startedAt: Date.now(),
    lastRefreshAt: 0,
  };

  // Deliberately not awaited: blocking here would add a second or two to every
  // `npm run dev` boot, and hydrateFromDb covers the gap until quotes land.
  void bootstrap().catch((e) => console.error("[market] bootstrap failed:", e));
}

/** Await the bootstrap if one is running — used by the snapshot route on a cold cache. */
export async function awaitBootstrap(timeoutMs = 2000): Promise<void> {
  const p = getInFlight();
  if (!p) return;
  await Promise.race([p, new Promise((r) => setTimeout(r, timeoutMs))]).catch(() => {});
}
