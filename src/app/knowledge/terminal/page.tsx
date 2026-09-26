"use client";

import { Suspense, useState, useCallback, useEffect, useRef, type CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import "./terminal.css";
import { supabase } from "@/lib/supabase";
import TerminalSearch from "@/components/terminal/TerminalSearch";
import WatchlistSidebar from "@/components/terminal/WatchlistSidebar";
import SecurityHeader from "@/components/terminal/SecurityHeader";
import PriceChart, { PeriodChange, CrosshairData } from "@/components/terminal/PriceChart";
import CompanyProfile from "@/components/terminal/CompanyProfile";
import KeyStatistics from "@/components/terminal/KeyStatistics";
import FinancialsTab from "@/components/terminal/FinancialsTab";
import InsightsTab from "@/components/terminal/InsightsTab";
import NewsTab from "@/components/terminal/NewsTab";
import BookTab from "@/components/terminal/BookTab";
import HoldingsTab from "@/components/terminal/HoldingsTab";
import PerformanceTab from "@/components/terminal/PerformanceTab";
import SectorBreakdown from "@/components/terminal/SectorBreakdown";
import EtfFundStats from "@/components/terminal/EtfFundStats";
import CountryBreakdown from "@/components/terminal/CountryBreakdown";
import RiskStatistics from "@/components/terminal/RiskStatistics";
import EtfExposure from "@/components/terminal/EtfExposure";

/* eslint-disable @typescript-eslint/no-explicit-any */

type Tab = "overview" | "holdings" | "performance" | "financials" | "insights" | "news" | "book";

const ALL_TABS: { key: Tab; label: string; stockOnly?: boolean; etfOnly?: boolean }[] = [
  { key: "overview", label: "Overview" },
  { key: "book", label: "Book" },
  { key: "holdings", label: "Holdings", etfOnly: true },
  { key: "performance", label: "Performance", etfOnly: true },
  { key: "financials", label: "Financials", stockOnly: true },
  { key: "insights", label: "Ratings", stockOnly: true },
  { key: "news", label: "News" },
];

const FUND_TYPES = new Set(["ETF", "MUTUALFUND"]);

// useSearchParams needs a Suspense boundary to prerender, same as the other pages.
export default function TerminalPage() {
  return (
    <Suspense fallback={null}>
      <TerminalPageInner />
    </Suspense>
  );
}

function TerminalPageInner() {
  const searchParams = useSearchParams();
  const [activeSymbol, setActiveSymbol] = useState<string | null>("QQQ");
  const [activeName, setActiveName] = useState<string>("Invesco QQQ Trust");
  const [quoteData, setQuoteData] = useState<any>(null);
  const [summaryData, setSummaryData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(false);
  const [isWatchlisted, setIsWatchlisted] = useState(false);
  const [watchlistRefreshKey, setWatchlistRefreshKey] = useState(0);
  const [periodChange, setPeriodChange] = useState<PeriodChange | null>(null);
  const [crosshairData, setCrosshairData] = useState<CrosshairData | null>(null);
  const [activeWatchlistId, setActiveWatchlistId] = useState<string | null>(null);

  const selectSymbol = useCallback(async (symbol: string, name: string) => {
    setActiveSymbol(symbol);
    setActiveName(name);
    setActiveTab("overview");
    setLoading(true);
    setSummaryData(null);

    // Check if watchlisted (only in watchlist mode)
    if (activeWatchlistId) {
      const { data: wl } = await supabase
        .from("terminal_watchlist_items")
        .select("symbol")
        .eq("watchlist_id", activeWatchlistId)
        .eq("symbol", symbol)
        .maybeSingle();
      setIsWatchlisted(!!wl);
    } else {
      setIsWatchlisted(false);
    }

    // Fetch quote + summary in parallel
    try {
      const [quoteRes, summaryRes] = await Promise.all([
        fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`),
        fetch(`/api/terminal/summary?symbol=${encodeURIComponent(symbol)}`),
      ]);

      if (quoteRes.ok) {
        const q = await quoteRes.json();
        setQuoteData(q);
        setActiveName(q.name || name);
      }
      if (summaryRes.ok) {
        setSummaryData(await summaryRes.json());
      }
    } catch { /* ignore */ }

    setLoading(false);
  }, [activeWatchlistId]);

  // Load symbol on first mount — use URL ?symbol= param if present, else QQQ
  const hasLoadedRef = useRef(false);
  useEffect(() => {
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true;
      const urlSymbol = searchParams.get("symbol");
      selectSymbol(urlSymbol ?? "QQQ", urlSymbol ?? "Invesco QQQ Trust");
    }
  }, [selectSymbol, searchParams]);

  const toggleWatchlist = useCallback(async () => {
    if (!activeSymbol || !activeWatchlistId) return;

    if (isWatchlisted) {
      await supabase
        .from("terminal_watchlist_items")
        .delete()
        .eq("watchlist_id", activeWatchlistId)
        .eq("symbol", activeSymbol);
      setIsWatchlisted(false);
    } else {
      // Shift existing items down to make room at position 0
      const { data: existing } = await supabase
        .from("terminal_watchlist_items")
        .select("id, position")
        .eq("watchlist_id", activeWatchlistId);
      if (existing) {
        await Promise.all(
          existing.map((item) =>
            supabase.from("terminal_watchlist_items").update({ position: (item.position ?? 0) + 1 }).eq("id", item.id)
          )
        );
      }
      await supabase.from("terminal_watchlist_items").insert({
        id: crypto.randomUUID(),
        watchlist_id: activeWatchlistId,
        symbol: activeSymbol,
        name: activeName,
        position: 0,
      });
      setIsWatchlisted(true);
    }
    setWatchlistRefreshKey((k) => k + 1);
  }, [activeSymbol, activeName, isWatchlisted, activeWatchlistId]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Main Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="flex gap-10">
          {/* Watchlist Sidebar */}
          <WatchlistSidebar
            activeSymbol={activeSymbol}
            onSelect={selectSymbol}
            refreshKey={watchlistRefreshKey}
            onActiveWatchlistChange={setActiveWatchlistId}
          />

          {/* Content Area */}
          <div className="flex-1 min-w-0">
            {/* Search */}
            <div className="mb-5 max-w-[353px]">
              <TerminalSearch onSelect={selectSymbol} />
            </div>

            {!activeSymbol ? (
              <EmptyState />
            ) : loading && !quoteData ? (
              <TerminalSkeleton />
            ) : quoteData ? (
              <div className="space-y-6">
                {/* Security Header */}
                <div className="terminal-rise" style={{ "--rise-i": 0 } as CSSProperties}>
                  <SecurityHeader
                    quote={quoteData}
                    isWatchlisted={isWatchlisted}
                    onToggleWatchlist={toggleWatchlist}
                    periodChange={periodChange}
                    crosshairData={crosshairData}
                  />
                </div>

                {/* Price Chart */}
                <div className="terminal-rise" style={{ "--rise-i": 1 } as CSSProperties}>
                  <PriceChart symbol={activeSymbol} onPeriodChange={setPeriodChange} onCrosshairMove={setCrosshairData} />
                </div>

                {/* Tabs */}
                <div className="terminal-rise" style={{ "--rise-i": 2 } as CSSProperties}>
                  <div className="flex items-center gap-0.5 bg-black/5 dark:bg-white/5 rounded-lg p-1 w-fit mb-8">
                    {ALL_TABS.filter((tab) => {
                      if (tab.stockOnly && FUND_TYPES.has(quoteData.quoteType)) return false;
                      if (tab.etfOnly && !FUND_TYPES.has(quoteData.quoteType)) return false;
                      return true;
                    }).map((tab) => (
                      <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                          activeTab === tab.key
                            ? "bg-white dark:bg-black medium:bg-[#e4e4e4] text-black dark:text-white shadow-sm"
                            : "text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white"
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {/* Tab Content */}
                  <div key={activeTab} className="terminal-fade">
                    {activeTab === "overview" && (
                      <div className="space-y-6">
                        <CompanyProfile profile={summaryData?.profile ?? null} />
                        {FUND_TYPES.has(quoteData?.quoteType) && (
                          <EtfFundStats stats={summaryData?.etfStats ?? null} />
                        )}
                        {FUND_TYPES.has(quoteData?.quoteType) && (
                          <RiskStatistics stats={summaryData?.riskStatistics ?? null} />
                        )}
                        <KeyStatistics stats={summaryData?.keyStatistics ?? null} quoteType={quoteData?.quoteType} />
                        {!FUND_TYPES.has(quoteData?.quoteType) && activeSymbol && (
                          <EtfExposure symbol={activeSymbol} name={activeName} onSelect={selectSymbol} />
                        )}
                      </div>
                    )}

                    {activeTab === "holdings" && (
                      <div className="space-y-8">
                        <div className="flex gap-8">
                          <div className="flex-1 min-w-0">
                            <HoldingsTab holdings={summaryData?.fundHoldings?.topHoldings ?? []} etfSymbol={activeSymbol ?? undefined} onSelect={selectSymbol} />
                          </div>
                          <div className="flex-1 min-w-0 space-y-8">
                            {summaryData?.fundHoldings?.sectorWeightings?.length > 0 && (
                              <SectorBreakdown sectors={summaryData.fundHoldings.sectorWeightings} />
                            )}
                            {summaryData?.fundHoldings?.countryWeightings?.length > 0 && (
                              <CountryBreakdown countries={summaryData.fundHoldings.countryWeightings} />
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {activeTab === "performance" && (
                      <PerformanceTab performance={summaryData?.fundPerformance ?? null} />
                    )}

                    {activeTab === "financials" && (
                      <FinancialsTab symbol={activeSymbol} />
                    )}

                    {activeTab === "insights" && (
                      <InsightsTab
                        symbol={activeSymbol}
                        recommendationTrend={summaryData?.recommendationTrend}
                        upgradeDowngradeHistory={summaryData?.upgradeDowngradeHistory}
                        keyStats={summaryData?.keyStatistics}
                      />
                    )}

                    {activeTab === "news" && (
                      <NewsTab symbol={activeSymbol} />
                    )}

                    {activeTab === "book" && (
                      <BookTab symbol={activeSymbol} />
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <svg className="w-16 h-16 text-black/10 dark:text-white/10 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605" />
      </svg>
      <h3 className="text-lg font-medium text-black/30 dark:text-white/30 mb-1">Market Research Terminal</h3>
      <p className="text-sm text-black/20 dark:text-white/20 max-w-md">
        Search for any ticker or company above to view charts, fundamentals, analyst ratings, and market news.
      </p>
    </div>
  );
}

/* Layout-matching skeleton shown while the first quote + summary load —
   mirrors the header / chart / tab-bar / content rhythm so nothing shifts. */
function TerminalSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      {/* Security header */}
      <div className="space-y-3">
        <div className="h-3.5 w-40 rounded bg-black/[0.05] dark:bg-white/[0.05] animate-pulse" />
        <div className="h-9 w-56 rounded bg-black/[0.05] dark:bg-white/[0.05] animate-pulse" />
        <div className="flex gap-6 pt-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-9 w-16 rounded bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
          ))}
        </div>
      </div>
      {/* Price chart */}
      <div className="h-[320px] rounded-xl bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
      {/* Tab bar */}
      <div className="h-8 w-72 rounded-lg bg-black/[0.05] dark:bg-white/[0.05] animate-pulse" />
      {/* Content */}
      <div className="space-y-3">
        <div className="h-3.5 w-1/3 rounded bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
        <div className="h-28 rounded-lg bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
      </div>
    </div>
  );
}
