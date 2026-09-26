import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getSnapshot, trackSymbols } from "@/lib/market/quote-cache";
import { normalizeSymbols } from "@/lib/market/symbols";
import { fetchQuotesChunked } from "@/lib/market/yahoo";

/**
 * Unbounded before: a crafted URL could request any number of symbols, and each
 * one became upstream traffic.
 */
const MAX_SYMBOLS = 100;

/**
 * Multi-symbol quotes, keyed by the caller's own symbol form.
 *
 * Serves from the shared cache where possible and only fetches the remainder,
 * and returns partial results rather than discarding them — a single bad ticker
 * previously produced a blanket 500, which blanked the whole portfolio page.
 *
 * The old symbol de-mangling (`symbols.find(s => s.replace(".","-") === ...)`)
 * was both O(n²) and wrong for multi-dot tickers; fetchQuotesChunked now keys
 * results by DB symbol directly.
 */
export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const limited = enforceRateLimit(req, "quote-batch", 30, 60_000);
  if (limited) return limited;

  const raw = req.nextUrl.searchParams.get("symbols");
  if (!raw) {
    return NextResponse.json({ error: "symbols required" }, { status: 400 });
  }

  const all = normalizeSymbols(raw.split(","));
  const symbols = all.slice(0, MAX_SYMBOLS);
  const dropped = all.length - symbols.length;
  if (dropped > 0) {
    console.warn(`[quote-batch] capped ${all.length} symbols to ${MAX_SYMBOLS}`);
  }

  if (symbols.length === 0) {
    return NextResponse.json({ error: "no valid symbols" }, { status: 400 });
  }

  trackSymbols(symbols);

  const data: Record<
    string,
    { change: number; changePercent: number; price: number; name: string }
  > = {};

  const { quotes } = getSnapshot({ symbols });
  const missing: string[] = [];

  for (const sym of symbols) {
    const q = quotes[sym];
    if (q && q.price > 0) {
      data[sym] = {
        price: q.price,
        change: q.change,
        changePercent: q.changePercent,
        name: sym,
      };
    } else {
      missing.push(sym);
    }
  }

  if (missing.length > 0) {
    try {
      const { quotes: fetched } = await fetchQuotesChunked(missing);
      for (const [sym, r] of fetched) {
        const price = Number(r.regularMarketPrice);
        if (!Number.isFinite(price) || price <= 0) continue;
        data[sym] = {
          price,
          change: Number(r.regularMarketChange) || 0,
          changePercent: Number(r.regularMarketChangePercent) || 0,
          name: r.shortName || r.longName || sym,
        };
      }
    } catch (e) {
      // Non-fatal on purpose: whatever the cache already had still goes back.
      console.error("[quote-batch] upstream fetch failed:", e);
    }
  }

  // Bare symbol->quote map, unchanged for existing callers; the truncation
  // signal rides in a header rather than altering the body shape.
  return NextResponse.json(data, {
    headers: dropped > 0 ? { "X-Symbols-Truncated": String(dropped) } : {},
  });
}
