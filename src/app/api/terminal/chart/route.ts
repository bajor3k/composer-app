import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
// @ts-ignore
import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const VALID_INTERVALS = ["2m", "15m", "1h", "1d", "1wk", "1mo"] as const;

function rangeToDate(range: string): string {
  const now = new Date();
  switch (range) {
    case "1d": now.setDate(now.getDate() - 4); break; // go back 4 days to cover weekends/holidays
    case "5d": now.setDate(now.getDate() - 5); break;
    case "1mo": now.setMonth(now.getMonth() - 1); break;
    case "3mo": now.setMonth(now.getMonth() - 3); break;
    case "6mo": now.setMonth(now.getMonth() - 6); break;
    case "ytd": return `${now.getFullYear()}-01-01`;
    case "1y": now.setFullYear(now.getFullYear() - 1); break;
    case "5y": now.setFullYear(now.getFullYear() - 5); break;
    default: now.setMonth(now.getMonth() - 1);
  }
  return now.toISOString().split("T")[0];
}

export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const limited = enforceRateLimit(req, "terminal-chart", 30, 60_000);
  if (limited) return limited;

  const symbol = req.nextUrl.searchParams.get("symbol");
  const range = req.nextUrl.searchParams.get("range") || "1mo";
  const interval = req.nextUrl.searchParams.get("interval") || "1d";

  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }

  if (!VALID_INTERVALS.includes(interval as typeof VALID_INTERVALS[number])) {
    return NextResponse.json({ error: "invalid interval" }, { status: 400 });
  }

  try {
    const yahooSymbol = symbol.replace(".", "-");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await yf.chart(yahooSymbol, {
      period1: rangeToDate(range),
      interval: interval as any,
    });

    const quotes = result.quotes ?? [];
    let data = quotes
      .filter((q: Record<string, unknown>) => q.close != null)
      .map((q: Record<string, unknown>) => ({
        time: Math.floor(new Date(q.date as string).getTime() / 1000),
        open: q.open ?? q.close,
        high: q.high ?? q.close,
        low: q.low ?? q.close,
        close: q.close,
        volume: q.volume ?? 0,
      }));

    // For 1D range, keep only the last trading day's data
    if (range === "1d" && data.length > 0) {
      const lastTime = data[data.length - 1].time as number;
      const lastDate = new Date(lastTime * 1000);
      const lastDay = new Date(lastDate.getFullYear(), lastDate.getMonth(), lastDate.getDate()).getTime() / 1000;
      data = data.filter((d: { time: number }) => d.time >= lastDay);
    }

    return NextResponse.json({
      symbol,
      data,
      meta: {
        currency: result.meta?.currency ?? "USD",
        exchangeName: result.meta?.exchangeName ?? "",
        regularMarketPrice: result.meta?.regularMarketPrice ?? null,
        chartPreviousClose: result.meta?.chartPreviousClose ?? null,
      },
    });
  } catch {
    return NextResponse.json({ error: "Chart data not available" }, { status: 404 });
  }
}
