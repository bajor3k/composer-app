import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
// @ts-ignore
import YahooFinance from "yahoo-finance2";
import { classifySentiment } from "@/lib/news-sentiment";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const limited = enforceRateLimit(req, "terminal-news", 30, 60_000);
  if (limited) return limited;

  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }

  try {
    const results: any = await yf.search(symbol, { newsCount: 20 });
    const newsItems = (results.news ?? []).map((n: any) => ({
      uuid: n.uuid,
      title: n.title,
      publisher: n.publisher,
      link: n.link,
      publishedAt: n.providerPublishTime ?? null,
      thumbnail: n.thumbnail?.resolutions?.[0]?.url ?? null,
    }));

    if (newsItems.length === 0) {
      return NextResponse.json({ articles: [] });
    }

    const articles = newsItems.map((n: any) => ({
      ...n,
      sentiment: classifySentiment(String(n.title ?? "")),
    }));

    return NextResponse.json({ articles });
  } catch {
    return NextResponse.json({ error: "Failed to fetch news" }, { status: 500 });
  }
}
