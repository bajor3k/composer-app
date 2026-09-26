import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getMarketStatus } from "@/lib/market/market-hours";
// @ts-ignore
import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const opts = { validateResult: false as const };

/**
 * Per-symbol response memo.
 *
 * One request to this route fans out to roughly 17 upstream calls — four
 * quoteSummary groups, a hardcoded SPY benchmark, two charts, a quote, and one
 * assetProfile per top-10 ETF holding. With the chart, quote and news requests
 * that accompany a symbol selection, clicking through a dozen symbols is a few
 * hundred upstream requests in a couple of minutes, which is enough to get
 * rate-limited. Tab switches and back-navigation re-request the same symbol, so
 * memoising turns all of those into zero upstream calls.
 *
 * Held on globalThis so HMR and lazy route compilation in `next dev` don't
 * silently drop it between requests.
 */
const MEMO_KEY = Symbol.for("composer.terminal.summaryMemo");
const MEMO_MAX = 100;

interface MemoEntry {
  payload: unknown;
  at: number;
}

function memo(): Map<string, MemoEntry> {
  const g = globalThis as unknown as Record<symbol, Map<string, MemoEntry> | undefined>;
  if (!g[MEMO_KEY]) g[MEMO_KEY] = new Map();
  return g[MEMO_KEY]!;
}

/**
 * Nothing in this payload moves while the market is shut, so the closed-market
 * TTL is deliberately much longer — that is also the state the app is in for
 * most of a rehearsal.
 */
function memoTtlMs(): number {
  return getMarketStatus().isOpen ? 5 * 60_000 : 30 * 60_000;
}

export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const limited = enforceRateLimit(req, "terminal-summary", 30, 60_000);
  if (limited) return limited;

  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }

  const memoKey = symbol.trim().toUpperCase();
  const cached = memo().get(memoKey);
  if (cached && Date.now() - cached.at < memoTtlMs()) {
    return NextResponse.json(cached.payload);
  }

  try {
    const yahooSymbol = symbol.replace(".", "-");

    // Fetch modules in resilient groups — some modules (e.g. earningsHistory)
    // throw internal errors for certain stocks, which kills the entire batch.
    // Splitting into groups ensures core data always comes through.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [coreResult, earningsResult, fundResult, benchmarkResult] = await Promise.allSettled([
      yf.quoteSummary(yahooSymbol, {
        modules: [
          "assetProfile",
          "defaultKeyStatistics",
          "financialData",
          "summaryDetail",
          "calendarEvents",
          "recommendationTrend",
          "upgradeDowngradeHistory",
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any, opts),
      yf.quoteSummary(yahooSymbol, {
        modules: [
          "earnings",
          "earningsHistory",
          "earningsTrend",
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any, opts),
      yf.quoteSummary(yahooSymbol, {
        modules: ["topHoldings", "fundPerformance", "fundProfile"],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any, opts),
      yf.quoteSummary("SPY", {
        modules: ["fundPerformance"],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any, opts),
    ]);

    // Merge results — failed groups just contribute empty data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = {};
    if (coreResult.status === "fulfilled") Object.assign(result, coreResult.value);
    if (earningsResult.status === "fulfilled") Object.assign(result, earningsResult.value);
    if (fundResult.status === "fulfilled") Object.assign(result, fundResult.value);

    // If even core modules failed, this symbol truly doesn't exist
    if (coreResult.status !== "fulfilled") {
      return NextResponse.json({ error: "Symbol not found" }, { status: 404 });
    }

    const profile = result.assetProfile ?? {};
    const keyStats = result.defaultKeyStatistics ?? {};
    const financial = result.financialData ?? {};
    const summaryDetail = result.summaryDetail ?? {};
    const earnings = result.earnings ?? {};
    const earningsHistory = result.earningsHistory?.history ?? [];
    const earningsTrend = result.earningsTrend?.trend ?? [];
    const calendar = result.calendarEvents ?? {};
    const recTrend = result.recommendationTrend?.trend ?? [];
    const upgrades = result.upgradeDowngradeHistory?.history ?? [];
    const topHoldings = result.topHoldings ?? {};
    const fundPerf = result.fundPerformance ?? {};
    const fundProfile = result.fundProfile ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const benchPerf: any = benchmarkResult.status === "fulfilled"
      ? (benchmarkResult.value as any)?.fundPerformance ?? {}
      : {};

    // Compute accurate YTD price returns from chart data (Yahoo's trailingReturns.ytd is total return, not price return)
    const currentYear = new Date().getFullYear();
    const yearStart = `${currentYear - 1}-12-30`;
    const yearStartEnd = `${currentYear}-01-03`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [symYtdChart, spyYtdChart, spyQuoteResult] = await Promise.allSettled([
      yf.chart(yahooSymbol, { period1: yearStart, period2: yearStartEnd, interval: "1d" as never }, opts),
      yf.chart("SPY", { period1: yearStart, period2: yearStartEnd, interval: "1d" as never }, opts),
      yf.quote("SPY", {}, opts),
    ]);
    const currentPrice = financial.currentPrice ?? null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const symStartPrice = symYtdChart.status === "fulfilled" ? (symYtdChart.value as any)?.quotes?.[0]?.close ?? null : null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spyStartPrice = spyYtdChart.status === "fulfilled" ? (spyYtdChart.value as any)?.quotes?.[0]?.close ?? null : null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spyCurrentPrice = spyQuoteResult.status === "fulfilled" ? (spyQuoteResult.value as any)?.regularMarketPrice ?? null : null;
    const computedYtd = currentPrice && symStartPrice ? (currentPrice - symStartPrice) / symStartPrice : null;
    const computedSpyYtd = spyCurrentPrice && spyStartPrice ? (spyCurrentPrice - spyStartPrice) / spyStartPrice : null;

    const payload = {
      profile: {
        longBusinessSummary: profile.longBusinessSummary ?? null,
        sector: profile.sector ?? null,
        industry: profile.industry ?? null,
        fullTimeEmployees: profile.fullTimeEmployees ?? null,
        website: profile.website ?? null,
        city: profile.city ?? null,
        state: profile.state ?? null,
        country: profile.country ?? null,
      },
      etfStats: {
        expenseRatio: fundProfile.feesExpensesInvestment?.annualReportExpenseRatio ?? keyStats.annualReportExpenseRatio ?? null,
        secYield: keyStats.yield ?? null,
        totalAssets: keyStats.totalAssets ?? summaryDetail.totalAssets ?? null,
        nav: summaryDetail.navPrice ?? null,
        dividendYield: summaryDetail.trailingAnnualDividendYield ?? null,
        inceptionDate: keyStats.fundInceptionDate ?? null,
        fundFamily: keyStats.fundFamily ?? null,
        fiftyTwoWeekHigh: summaryDetail.fiftyTwoWeekHigh ?? null,
        fiftyTwoWeekLow: summaryDetail.fiftyTwoWeekLow ?? null,
        beta3Year: keyStats.beta3Year ?? null,
        avgVolume: summaryDetail.averageVolume ?? null,
        category: keyStats.category ?? null,
        trailingPE: summaryDetail.trailingPE ?? null,
      },
      keyStatistics: {
        marketCap: financial.currentPrice && keyStats.sharesOutstanding
          ? (financial.currentPrice * keyStats.sharesOutstanding) : null,
        enterpriseValue: keyStats.enterpriseValue ?? null,
        trailingPE: keyStats.trailingEps && financial.currentPrice
          ? financial.currentPrice / keyStats.trailingEps : null,
        forwardPE: keyStats.forwardEps && financial.currentPrice
          ? financial.currentPrice / keyStats.forwardEps : null,
        pegRatio: keyStats.pegRatio ?? null,
        priceToBook: keyStats.priceToBook ?? null,
        beta: keyStats.beta ?? null,
        profitMargins: keyStats.profitMargins ?? null,
        returnOnEquity: financial.returnOnEquity ?? null,
        returnOnAssets: financial.returnOnAssets ?? null,
        revenueGrowth: financial.revenueGrowth ?? null,
        operatingMargins: financial.operatingMargins ?? null,
        debtToEquity: financial.debtToEquity ?? null,
        currentRatio: financial.currentRatio ?? null,
        totalRevenue: financial.totalRevenue ?? null,
        revenuePerShare: financial.revenuePerShare ?? null,
        earningsGrowth: financial.earningsGrowth ?? null,
        targetMeanPrice: financial.targetMeanPrice ?? null,
        targetLowPrice: financial.targetLowPrice ?? null,
        targetHighPrice: financial.targetHighPrice ?? null,
        targetMedianPrice: financial.targetMedianPrice ?? null,
        numberOfAnalystOpinions: financial.numberOfAnalystOpinions ?? null,
        recommendationMean: financial.recommendationMean ?? null,
        recommendationKey: financial.recommendationKey ?? null,
        fiftyTwoWeekChange: keyStats.fiftyTwoWeekChange ?? null,
        sharesOutstanding: keyStats.sharesOutstanding ?? null,
        floatShares: keyStats.floatShares ?? null,
        shortRatio: keyStats.shortRatio ?? null,
        shortPercentOfFloat: keyStats.shortPercentOfFloat ?? null,
        dividendRate: keyStats.lastDividendValue ?? null,
        dividendYield: keyStats.lastDividendValue && financial.currentPrice
          ? keyStats.lastDividendValue / financial.currentPrice : null,
        payoutRatio: keyStats.payoutRatio ?? null,
        trailingEps: keyStats.trailingEps ?? null,
        forwardEps: keyStats.forwardEps ?? null,
      },
      earnings: {
        quarterly: earnings.financialsChart?.quarterly ?? [],
        yearly: earnings.financialsChart?.yearly ?? [],
        nextQuarter: earnings.earningsChart?.currentCalendarQuarter
          ? {
              quarter: earnings.earningsChart.currentCalendarQuarter,
              estimate: earnings.earningsChart.currentQuarterEstimate ?? null,
              earningsDate: earnings.earningsChart.earningsDate?.[0] ?? null,
            }
          : null,
      },
      earningsHistory: earningsHistory.slice(0, 8).map((e: Record<string, unknown>) => ({
        date: e.quarter ?? null,
        epsEstimate: e.epsEstimate ?? null,
        epsActual: e.epsActual ?? null,
        epsDifference: e.epsDifference ?? null,
        surprisePercent: e.surprisePercent ?? null,
      })),
      earningsTrend: earningsTrend.slice(0, 4).map((t: Record<string, unknown>) => ({
        period: t.period ?? null,
        endDate: t.endDate ?? null,
        growth: t.growth ?? null,
        earningsEstimate: t.earningsEstimate ?? null,
        revenueEstimate: t.revenueEstimate ?? null,
      })),
      calendarEvents: {
        earningsDate: calendar.earnings?.earningsDate ?? [],
        dividendDate: calendar.dividendDate ?? null,
        exDividendDate: calendar.exDividendDate ?? null,
      },
      recommendationTrend: recTrend.slice(0, 4).map((r: Record<string, unknown>) => ({
        period: r.period ?? null,
        strongBuy: r.strongBuy ?? 0,
        buy: r.buy ?? 0,
        hold: r.hold ?? 0,
        sell: r.sell ?? 0,
        strongSell: r.strongSell ?? 0,
      })),
      upgradeDowngradeHistory: upgrades.slice(0, 10).map((u: Record<string, unknown>) => ({
        date: u.epochGradeDate ?? null,
        firm: u.firm ?? null,
        action: u.action ?? null,
        fromGrade: u.fromGrade ?? null,
        toGrade: u.toGrade ?? null,
      })),
      fundPerformance: {
        asOfDate: fundPerf.trailingReturns?.asOfDate ?? null,
        trailingReturns: (() => {
          const tr = fundPerf.trailingReturns ?? {};
          // Determine fund age from annual returns to null-out periods exceeding it
          const annuals = (fundPerf.annualTotalReturns?.returns ?? [])
            .filter((r: Record<string, unknown>) => r.annualValue != null);
          const fundYears = annuals.length;
          const clamp = (val: unknown, minYears: number) =>
            fundYears > 0 && fundYears < minYears ? null : (val ?? null);
          return {
            ytd: computedYtd ?? tr.ytd ?? null,
            oneYear: clamp(tr.oneYear, 1),
            threeYear: clamp(tr.threeYear, 3),
            fiveYear: clamp(tr.fiveYear, 5),
            tenYear: clamp(tr.tenYear, 10),
          };
        })(),
        benchmark: {
          ytd: computedSpyYtd ?? benchPerf.trailingReturns?.ytd ?? null,
          oneYear: benchPerf.trailingReturns?.oneYear ?? null,
          threeYear: benchPerf.trailingReturns?.threeYear ?? null,
          fiveYear: benchPerf.trailingReturns?.fiveYear ?? null,
          tenYear: benchPerf.trailingReturns?.tenYear ?? null,
        },
        annualReturns: (fundPerf.annualTotalReturns?.returns ?? [])
          .filter((r: Record<string, unknown>) => r.annualValue != null)
          .slice(0, 10)
          .map((r: Record<string, unknown>) => ({
            year: r.year ?? null,
            annualValue: r.annualValue ?? null,
          })),
      },
      riskStatistics: {
        fund: (fundPerf.riskOverviewStatistics?.riskStatistics ?? []).map((r: Record<string, unknown>) => ({
          year: r.year ?? null,
          alpha: r.alpha ?? null,
          beta: r.beta ?? null,
          rSquared: r.rSquared ?? null,
          stdDev: r.stdDev ?? null,
          sharpeRatio: r.sharpeRatio ?? null,
          treynorRatio: r.treynorRatio ?? null,
        })),
        category: (fundPerf.riskOverviewStatisticsCat?.riskStatisticsCat ?? []).map((r: Record<string, unknown>) => ({
          year: r.year ?? null,
          alpha: r.alpha ?? null,
          beta: r.beta ?? null,
          rSquared: r.rSquared ?? null,
          stdDev: r.stdDev ?? null,
          sharpeRatio: r.sharpeRatio ?? null,
          treynorRatio: r.treynorRatio ?? null,
        })),
      },
      fundHoldings: {
        sectorWeightings: (topHoldings.sectorWeightings ?? []).map((s: Record<string, number>) => {
          const key = Object.keys(s)[0];
          return key ? { name: key, weight: s[key] } : null;
        }).filter(Boolean),
        topHoldings: (topHoldings.holdings ?? []).map((h: Record<string, unknown>) => ({
          symbol: h.symbol ?? null,
          holdingName: h.holdingName ?? null,
          holdingPercent: h.holdingPercent ?? 0,
        })),
        countryWeightings: await (async () => {
          const holdings = (topHoldings.holdings ?? []).slice(0, 10) as { symbol?: string; holdingPercent?: number }[];
          if (holdings.length === 0) return [];
          const syms = holdings.filter((h) => h.symbol).map((h) => h.symbol!.replace(".", "-"));
          const profiles = await Promise.allSettled(
            syms.map((s) => yf.quoteSummary(s, { modules: ["assetProfile"] } as never, opts))
          );
          const countryMap = new Map<string, number>();
          holdings.forEach((h, i) => {
            if (!h.symbol) return;
            const profile = profiles[i];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const country = profile.status === "fulfilled" ? (profile.value as any)?.assetProfile?.country ?? "Other" : "Other";
            const weight = h.holdingPercent ?? 0;
            countryMap.set(country, (countryMap.get(country) ?? 0) + weight);
          });
          return Array.from(countryMap.entries())
            .map(([name, weight]) => ({ name, weight }))
            .sort((a, b) => b.weight - a.weight);
        })(),
      },
    };

    // Only successful payloads are memoised — caching a failure would pin a
    // transient upstream error to a symbol for the whole TTL.
    const m = memo();
    if (m.size >= MEMO_MAX) {
      // Evict the oldest rather than letting an unbounded symbol space grow.
      let oldestKey: string | null = null;
      let oldestAt = Infinity;
      for (const [k, v] of m) {
        if (v.at < oldestAt) {
          oldestAt = v.at;
          oldestKey = k;
        }
      }
      if (oldestKey) m.delete(oldestKey);
    }
    m.set(memoKey, { payload, at: Date.now() });

    return NextResponse.json(payload);
  } catch {
    return NextResponse.json({ error: "Symbol not found" }, { status: 404 });
  }
}
