import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
// @ts-ignore
import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const limited = enforceRateLimit(req, "terminal-financials", 30, 60_000);
  if (limited) return limited;

  const symbol = req.nextUrl.searchParams.get("symbol");
  const period = req.nextUrl.searchParams.get("period") || "annual";

  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }

  try {
    const yahooSymbol = symbol.replace(".", "-");
    const type = period === "quarterly" ? "quarterly" : "annual";

    const result = await yf.fundamentalsTimeSeries(yahooSymbol, {
      period1: "2020-01-01",
      type,
      module: "all",
    });

    // Extract key financial data points from the time series
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const financials = (result ?? []).map((entry: any) => ({
      date: entry.date ?? null,
      // Income Statement
      totalRevenue: entry.totalRevenue ?? null,
      costOfRevenue: entry.costOfRevenue ?? null,
      grossProfit: entry.grossProfit ?? null,
      operatingIncome: entry.operatingIncome ?? null,
      netIncome: entry.netIncome ?? null,
      ebitda: entry.ebitda ?? entry.normalizedEBITDA ?? null,
      dilutedEPS: entry.dilutedEPS ?? null,
      basicEPS: entry.basicEPS ?? null,
      // Balance Sheet
      totalAssets: entry.totalAssets ?? null,
      totalLiabilities: entry.totalLiabilitiesNetMinorityInterest ?? null,
      totalEquity: entry.stockholdersEquity ?? null,
      totalDebt: entry.totalDebt ?? null,
      cashAndEquivalents: entry.cashAndCashEquivalents ?? null,
      // Cash Flow
      operatingCashFlow: entry.operatingCashFlow ?? null,
      capitalExpenditure: entry.capitalExpenditure ?? null,
      freeCashFlow: entry.freeCashFlow ?? null,
    }));

    // Sort by date descending
    financials.sort((a: { date: string }, b: { date: string }) =>
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    // Return more for quarterly (for earnings chart), 5 for annual
    const limit = type === "quarterly" ? 12 : 5;

    return NextResponse.json({
      symbol,
      period: type,
      data: financials.slice(0, limit),
    });
  } catch {
    return NextResponse.json({ error: "Financial data not available" }, { status: 404 });
  }
}
