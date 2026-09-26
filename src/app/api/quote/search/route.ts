import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
// @ts-ignore
import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const limited = enforceRateLimit(req, "quote-search", 20, 60_000);
  if (limited) return limited;

  const q = req.nextUrl.searchParams.get("q");
  if (!q || q.length < 1) {
    return NextResponse.json({ results: [] });
  }

  try {
    const results = await yf.search(q, { newsCount: 0 });
    const quotes = (results.quotes || [])
      .filter((item: any) => item.quoteType === "EQUITY" || item.quoteType === "ETF" || item.quoteType === "MUTUALFUND")
      .slice(0, 10)
      .map((item: any) => ({
        symbol: (item.symbol || "").replace("-", "."),
        name: item.shortname || item.longname || item.symbol || "",
        type: item.quoteType === "ETF" ? "ETF" : item.quoteType === "MUTUALFUND" ? "Fund" : "Stock",
        exchange: item.exchange || "",
      }));

    return NextResponse.json({ results: quotes });
  } catch {
    return NextResponse.json({ results: [] });
  }
}
