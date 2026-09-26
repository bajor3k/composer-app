import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getSnapshot, trackSymbols } from "@/lib/market/quote-cache";
import { toYahooSymbol } from "@/lib/market/symbols";
import { classifyYahooError, YF_OPTS, yf } from "@/lib/market/yahoo";

/**
 * Single-symbol quote, used by the terminal header and the watchlist.
 *
 * Reads the shared cache first, so a symbol already tracked costs no upstream
 * request and keeps serving through a Yahoo outage. Only a cache miss dials
 * Yahoo, and the symbol then joins the tracked set for subsequent refreshes.
 */
export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const limited = enforceRateLimit(req, "quote", 60, 60_000);
  if (limited) return limited;

  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }

  const upper = symbol.trim().toUpperCase();
  trackSymbols([upper]);

  // Yahoo is PRIMARY here, with the cache as an outage fallback below — not the
  // other way round. The quote cache only carries price/previousClose/change, so
  // serving this route from it returned marketCap/52w/volume as zeros and
  // hardcoded quoteType to "EQUITY", which mislabelled every ETF and drove the
  // wrong tab set on the terminal. This route is called once per symbol
  // selection, not on a poll — the high-frequency caller is /api/market/snapshot
  // — so there is nothing to gain by short-circuiting it.
  try {
    const raw = await yf.quote(toYahooSymbol(upper), undefined, YF_OPTS);
    // With validateResult disabled, an unknown ticker comes back empty rather
    // than throwing, so the absence of a result IS the not-found signal.
    // Dereferencing it blindly turned a bad symbol into a 502.
    const q = Array.isArray(raw) ? raw[0] : raw;
    if (!q || q.regularMarketPrice == null) {
      return NextResponse.json({ error: "Symbol not found" }, { status: 404 });
    }

    return NextResponse.json({
      symbol: upper,
      name: q.shortName || q.longName || upper,
      price: q.regularMarketPrice ?? 0,
      previousClose: q.regularMarketPreviousClose ?? 0,
      change: q.regularMarketChange ?? 0,
      changePercent: q.regularMarketChangePercent ?? 0,
      high52w: q.fiftyTwoWeekHigh ?? 0,
      low52w: q.fiftyTwoWeekLow ?? 0,
      dayHigh: q.regularMarketDayHigh ?? 0,
      dayLow: q.regularMarketDayLow ?? 0,
      open: q.regularMarketOpen ?? 0,
      volume: q.regularMarketVolume ?? 0,
      marketCap: q.marketCap ?? 0,
      peRatio: q.trailingPE ?? null,
      dividendYield: q.dividendYield ?? null,
      quoteType: q.quoteType ?? "EQUITY",
      source: "yahoo",
      stale: false,
    });
  } catch (e) {
    // Previously every failure — including a Yahoo 429 — was reported as
    // 404 "Symbol not found" with no logging, which made a rate-limit
    // indistinguishable from a bad ticker at the client.
    const { kind, status, message } = classifyYahooError(e);
    console.error(`[quote] ${upper} failed (${kind}):`, message);

    // Outage fallback — the reason the cache was consulted at all. A symbol we
    // already track keeps rendering its last known price instead of erroring
    // mid-demo. The reference fields are genuinely unknown here, so they are
    // omitted rather than reported as zeros, and `stale` says so.
    if (kind !== "not-found") {
      const cached = getSnapshot({ symbols: [upper] }).quotes[upper];
      if (cached && cached.price > 0) {
        return NextResponse.json({
          symbol: upper,
          name: upper,
          price: cached.price,
          previousClose: cached.previousClose,
          change: cached.change,
          changePercent: cached.changePercent,
          source: cached.source,
          stale: true,
          high52w: null,
          low52w: null,
          dayHigh: null,
          dayLow: null,
          open: null,
          volume: null,
          marketCap: null,
          peRatio: null,
          dividendYield: null,
          quoteType: null,
        });
      }
    }

    if (kind === "rate-limit") {
      return NextResponse.json(
        { error: "Upstream rate limit. Please retry shortly." },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }
    if (kind === "not-found") {
      return NextResponse.json({ error: "Symbol not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Quote unavailable" }, { status });
  }
}
