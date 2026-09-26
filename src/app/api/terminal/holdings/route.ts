import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";

const OPENBB_URL = process.env.OPENBB_URL ?? "http://127.0.0.1:8100";

/**
 * No OpenBB server ships with this repo. Without OPENBB_URL set, every request
 * dialled a dead localhost port and logged a connection refusal. HoldingsTab
 * already degrades to Yahoo's topHoldings on a non-OK response, so short-
 * circuiting here changes nothing the user sees — it just stops the noise.
 */
const OPENBB_ENABLED = Boolean(process.env.OPENBB_URL);

export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  if (!OPENBB_ENABLED) {
    return NextResponse.json({ error: "OpenBB not configured" }, { status: 501 });
  }

  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `${OPENBB_URL}/api/v1/etf/holdings?symbol=${encodeURIComponent(symbol)}&provider=sec`,
      { signal: AbortSignal.timeout(30000) }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: err.error ?? "OpenBB request failed" },
        { status: res.status }
      );
    }

    const json = await res.json();
    const results = json.results ?? json.data ?? [];
    return NextResponse.json({
      holdings: results.map((h: Record<string, unknown>) => ({
        symbol: h.symbol ?? h.name ?? null,
        name: h.name ?? null,
        weight: Number(h.weight) || 0,
        value: h.value != null ? Number(h.value) : null,
        shares: h.balance != null ? Number(h.balance) : null,
        country: (h.country as string) ?? null,
      })),
      count: results.length,
    });
  } catch {
    return NextResponse.json(
      { error: "OpenBB server unavailable" },
      { status: 503 }
    );
  }
}
