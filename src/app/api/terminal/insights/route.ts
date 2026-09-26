import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
// @ts-ignore
import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const limited = enforceRateLimit(req, "terminal-insights", 30, 60_000);
  if (limited) return limited;

  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }

  try {
    const yahooSymbol = symbol.replace(".", "-");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await yf.insights(yahooSymbol);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const developments = (result.significantDevelopments ?? []).map(
      (d: any) => ({
        date: d.date ?? null,
        headline: d.headline ?? null,
        description: d.description ?? null,
      })
    );

    const recommendation = result.recommendation ?? null;
    const companySnapshot = result.companySnapshot ?? null;
    const technicalEvents = result.technicalEvents ?? null;

    return NextResponse.json({
      symbol,
      developments: developments.slice(0, 15),
      recommendation: recommendation
        ? {
            targetPrice: recommendation.targetPrice ?? null,
            rating: recommendation.rating ?? null,
          }
        : null,
      technicalEvents: technicalEvents
        ? {
            shortTerm: technicalEvents.shortTermOutlook ?? null,
            midTerm: technicalEvents.intermediatTermOutlook ?? null,
            longTerm: technicalEvents.longTermOutlook ?? null,
          }
        : null,
      companySnapshot: companySnapshot
        ? {
            sectorInfo: companySnapshot.sectorInfo ?? null,
            company: companySnapshot.company ?? null,
          }
        : null,
    });
  } catch {
    return NextResponse.json({ error: "Insights not available" }, { status: 404 });
  }
}
