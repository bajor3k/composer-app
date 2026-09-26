// SERVER ONLY — never import from a "use client" module.
/**
 * Optional write-through of live prices to the database.
 *
 * OFF unless MARKET_PERSIST=1, and it hard-returns whenever the market is not
 * open. Three reasons it stays off by default:
 *
 *   1. Simulated prices must never be persisted. The market is closed while
 *      this feature is being built and tested, so writes would be forbidden
 *      anyway.
 *   2. This Supabase instance is shared with the legacy repo during the
 *      transition. Rewriting ~6,500 Holding rows every cycle is avoidable WAL
 *      on a database we do not exclusively own.
 *   3. Correctness does not depend on it — the live overlay is what the UI
 *      reads. Persistence only benefits server-side DB consumers (the alerts
 *      evaluator, canvas context, exports), and `npm run db:update-prices`
 *      already covers those with as-of-close values.
 *
 * NOTE: `pg` is currently a devDependency. It is imported dynamically below so
 * the default path never touches it, but it must move to `dependencies` before
 * this is enabled in a standalone build.
 */

import { getMarketStatus } from "./market-hours";
import { getSnapshot } from "./quote-cache";
import { isCashLike } from "./symbols";

/** Structural type for the dynamically imported pg Pool — avoids a static pg import. */
interface PgPoolLike {
  query(text: string, values?: unknown[]): Promise<unknown>;
  end(): Promise<void>;
}

/** Even when enabled, write no more often than this. */
const PERSIST_INTERVAL_MS = 5 * 60_000;

const STATE_KEY = Symbol.for("composer.market.persist");

function slot(): { lastWriteAt: number } {
  const g = globalThis as unknown as Record<symbol, { lastWriteAt: number } | undefined>;
  if (!g[STATE_KEY]) g[STATE_KEY] = { lastWriteAt: 0 };
  return g[STATE_KEY]!;
}

export function isPersistEnabled(): boolean {
  return process.env.MARKET_PERSIST === "1";
}

/**
 * Write current prices to Security, Holding and Account.
 *
 * Returns the number of symbols written, or null when the write was skipped.
 * Never throws — a persistence failure must not break the refresh cycle.
 */
export async function persistPrices(): Promise<number | null> {
  if (!isPersistEnabled()) return null;

  const status = getMarketStatus();
  if (status.mode !== "live") return null;

  const s = slot();
  const now = Date.now();
  if (now - s.lastWriteAt < PERSIST_INTERVAL_MS) return null;

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[market] MARKET_PERSIST set but DATABASE_URL is missing");
    return null;
  }

  const { quotes } = getSnapshot();
  const rows = Object.values(quotes).filter(
    (q) => !isCashLike(q.symbol) && q.source === "yahoo" && q.price > 0,
  );
  if (rows.length === 0) return null;

  let pool: PgPoolLike | null = null;

  try {
    const { Pool } = await import("pg");
    // Match scripts/update-prices.ts: force the pgbouncer pooler port.
    pool = new Pool({
      connectionString: url.replace(":5432/", ":6543/"),
      max: 1,
      connectionTimeoutMillis: 30_000,
    }) as unknown as PgPoolLike;

    for (const q of rows) {
      await pool.query(
        `UPDATE "Security" SET price = $1, "previousClose" = $2, "priceDate" = NOW(), "updatedAt" = NOW() WHERE symbol = $3`,
        [q.price, q.previousClose, q.symbol],
      );
      await pool.query(
        `UPDATE "Holding" SET price = $1, "marketValue" = quantity * $1, "updatedAt" = NOW() WHERE symbol = $2`,
        [q.price, q.symbol],
      );
    }

    // Keep CASH holdings in step with the account's cash balance.
    await pool.query(`
      UPDATE "Holding" h
      SET quantity = a."cashBalance",
          "marketValue" = a."cashBalance",
          "costBasis" = a."cashBalance",
          "updatedAt" = NOW()
      FROM "Account" a
      WHERE h."accountId" = a.id
        AND h.symbol = 'CASH'
        AND h."marketValue" IS DISTINCT FROM a."cashBalance"
    `);

    // Recompute account balances from the holdings we just wrote.
    await pool.query(`
      UPDATE "Account" a
      SET balance = sub.total, "updatedAt" = NOW()
      FROM (
        SELECT "accountId", SUM("marketValue") AS total
        FROM "Holding" GROUP BY "accountId"
      ) sub
      WHERE a.id = sub."accountId"
    `);

    s.lastWriteAt = now;
    console.log(`[market] persisted ${rows.length} symbols to the database`);
    return rows.length;
  } catch (e) {
    console.error("[market] persistPrices failed:", e);
    return null;
  } finally {
    await pool?.end().catch(() => {});
  }
}
