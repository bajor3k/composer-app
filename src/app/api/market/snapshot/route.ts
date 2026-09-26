import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { loadBook, revalueBook } from "@/lib/market/book";
import { ensureSymbols, getSnapshot, isHydrated, trackSymbols } from "@/lib/market/quote-cache";
import { awaitBootstrap } from "@/lib/market/scheduler";
import { normalizeSymbols } from "@/lib/market/symbols";

export const dynamic = "force-dynamic";

/**
 * The single live-data endpoint every account page polls.
 *
 *   GET /api/market/snapshot
 *     ?symbols=AAPL,MSFT    narrow the quote map (omit for the whole universe)
 *     &accounts=1           include server-computed per-account values
 *     &accountIds=id1,id2   narrow the account map
 *
 * Returns { data: MarketSnapshot }. This route is the reason the six account
 * surfaces agree: totals are computed once here rather than six times on the
 * client.
 *
 * It must never 500. A cold cache waits briefly on the in-flight bootstrap and
 * then serves whatever it has; the worst observable outcome is `degraded: true`
 * with last-good values.
 */
export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  // A 5s client poll is 12 req/min, so this leaves headroom for several tabs.
  const limited = enforceRateLimit(request, "market-snapshot", 60, 60_000);
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const symbolsParam = searchParams.get("symbols");
  const wantAccounts = searchParams.get("accounts") === "1";
  const accountIdsParam = searchParams.get("accountIds");

  const symbols = symbolsParam ? normalizeSymbols(symbolsParam.split(",")) : undefined;

  try {
    // Ad-hoc symbols (terminal, watchlist) join the tracked set so they are
    // refreshed with everything else instead of competing for upstream calls.
    //
    // trackSymbols alone only enrols them for the NEXT scheduled cycle, which is
    // 15 minutes out while the market is closed — a symbol just added to a
    // watchlist would render a dash until then. ensureSymbols fills the misses
    // now, bounded and time-budgeted. It is a no-op once they are cached, and
    // account pages never reach it because they don't pass ?symbols=.
    if (symbols?.length) {
      trackSymbols(symbols);
      await ensureSymbols(symbols);
    }

    if (!isHydrated()) await awaitBootstrap(2000);

    const snapshot = getSnapshot(symbols ? { symbols } : undefined);

    if (wantAccounts) {
      const accountIds = accountIdsParam
        ? accountIdsParam.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;
      const book = await loadBook();
      // Account values are always computed against the full quote map, not the
      // caller's narrowed one — otherwise a page asking for a single account's
      // symbols would under-price every other holding in that account.
      const all = getSnapshot();
      snapshot.accounts = revalueBook(book, all.quotes, accountIds);
    }

    return NextResponse.json(
      { data: snapshot },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("[market] snapshot failed:", e);
    // Degrade rather than fail: return whatever the cache holds.
    const fallback = getSnapshot(symbols ? { symbols } : undefined);
    return NextResponse.json(
      { data: { ...fallback, degraded: true } },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
