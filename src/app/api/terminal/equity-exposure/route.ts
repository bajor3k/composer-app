import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";

const OPENBB_URL = process.env.OPENBB_URL ?? "http://127.0.0.1:8100";

/** See the note in ../holdings/route.ts — EtfExposure already hides itself on failure. */
const OPENBB_ENABLED = Boolean(process.env.OPENBB_URL);

export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  if (!OPENBB_ENABLED) {
    return NextResponse.json({ error: "OpenBB not configured" }, { status: 501 });
  }

  const symbol = req.nextUrl.searchParams.get("symbol");
  const name = req.nextUrl.searchParams.get("name");
  if (!symbol && !name) {
    return NextResponse.json({ error: "symbol or name required" }, { status: 400 });
  }

  try {
    const params = new URLSearchParams();
    if (symbol) params.set("symbol", symbol);
    if (name) params.set("name", name);

    const res = await fetch(
      `${OPENBB_URL}/api/etf/equity-exposure?${params.toString()}`,
      { signal: AbortSignal.timeout(60000) }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: err.error ?? "OpenBB request failed" },
        { status: res.status }
      );
    }

    const json = await res.json();
    return NextResponse.json({
      etfs: json.data ?? [],
      count: json.count ?? 0,
    });
  } catch {
    return NextResponse.json(
      { error: "OpenBB server unavailable" },
      { status: 503 }
    );
  }
}
