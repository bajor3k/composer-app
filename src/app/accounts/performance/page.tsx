"use client";

import { Suspense, useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { paginateQuery } from "@/lib/supabase-paginate";
import { formatCurrency, formatDate, exportToCsv } from "@/lib/format-utils";
import PerformanceTable from "@/components/performance/PerformanceTable";
import ReturnDistribution from "@/components/performance/ReturnDistribution";
import {
  type Period,
  type AlphaFilter,
  type PerformanceRow,
  PERIOD_FILTERS,
  ALPHA_FILTERS,
  weightedStats,
  formatPct,
  formatPp,
} from "@/components/performance/types";

export default function PerformancePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <div className="text-muted">Loading performance...</div>
        </div>
      }
    >
      <PerformancePageContent />
    </Suspense>
  );
}

const EMPTY_BY_PERIOD: Record<Period, PerformanceRow[]> = { "1M": [], "3M": [], "1Y": [] };

// Bucket AccountPerformance rows by trailing-window length (periodEnd - periodStart),
// never by "ends today" — the seeded periods all end on the seed date, not the wall clock.
const MS_PER_MONTH = 30.44 * 24 * 60 * 60 * 1000;

function periodForWindow(periodStart: unknown, periodEnd: unknown): Period | null {
  const start = Date.parse(String(periodStart));
  const end = Date.parse(String(periodEnd));
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const months = Math.round((end - start) / MS_PER_MONTH);
  if (months === 1) return "1M";
  if (months === 3) return "3M";
  if (months === 12) return "1Y";
  return null;
}

function PerformancePageContent() {
  const [byPeriod, setByPeriod] = useState<Record<Period, PerformanceRow[]>>(EMPTY_BY_PERIOD);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("1Y");
  const [searchQuery, setSearchQuery] = useState("");
  const [alphaFilter, setAlphaFilter] = useState<AlphaFilter>("all");

  useEffect(() => {
    async function fetchPerformance() {
      try {
        const [perfRows, accountRows] = await Promise.all([
          paginateQuery<Record<string, unknown>>((from, to) =>
            supabase
              .from("AccountPerformance")
              .select(
                "accountId, periodStart, periodEnd, beginningValue, endingValue, netFlows, twrReturn, benchmarkReturn"
              )
              .order("id")
              .range(from, to)
          ),
          paginateQuery<Record<string, unknown>>((from, to) =>
            supabase
              .from("portfolio_accounts")
              .select("id, account_number, account_name, custodian, household_name, is_managed")
              .order("account_number")
              .range(from, to)
          ),
        ]);

        if (accountRows.length === 0) {
          setError("Unable to connect to database. Please check your connection.");
          setLoading(false);
          return;
        }

        // Index performance rows by account, one slot per trailing period.
        const perfByAccount = new Map<string, Partial<Record<Period, Record<string, unknown>>>>();
        for (const row of perfRows) {
          const p = periodForWindow(row.periodStart, row.periodEnd);
          if (!p) continue;
          const accountId = String(row.accountId ?? "");
          const slots = perfByAccount.get(accountId) ?? {};
          slots[p] = row;
          perfByAccount.set(accountId, slots);
        }

        // Join to account metadata (managed accounts only).
        const joined: Record<Period, PerformanceRow[]> = { "1M": [], "3M": [], "1Y": [] };
        for (const acct of accountRows) {
          if (acct.is_managed === false) continue;
          const id = String(acct.id ?? "");
          const slots = perfByAccount.get(id);
          if (!slots) continue;
          for (const p of Object.keys(joined) as Period[]) {
            const perf = slots[p];
            if (!perf) continue;
            const twr = Number(perf.twrReturn) || 0;
            const benchmark = perf.benchmarkReturn == null ? null : Number(perf.benchmarkReturn);
            joined[p].push({
              id,
              account_number: String(acct.account_number ?? ""),
              account_name: String(acct.account_name ?? ""),
              household_name: String(acct.household_name ?? "—"),
              custodian: String(acct.custodian ?? "—"),
              beginning_value: Number(perf.beginningValue) || 0,
              ending_value: Number(perf.endingValue) || 0,
              net_flows: Number(perf.netFlows) || 0,
              twr,
              benchmark,
              alpha: benchmark === null ? null : (twr - benchmark) * 100,
              period_end: String(perf.periodEnd ?? ""),
            });
          }
        }

        setByPeriod(joined);
      } catch (err) {
        console.error("Error fetching performance:", err);
        setError("Unable to connect to database. Please check your connection.");
      }
      setLoading(false);
    }

    fetchPerformance();
  }, []);

  const periodRows = byPeriod[period];

  const searchedRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return periodRows;
    return periodRows.filter(
      (r) =>
        r.account_number.toLowerCase().includes(q) ||
        r.account_name.toLowerCase().includes(q) ||
        r.household_name.toLowerCase().includes(q) ||
        r.custodian.toLowerCase().includes(q)
    );
  }, [periodRows, searchQuery]);

  // Stats reflect the searched set BEFORE the alpha pill, so "Outperforming X / N"
  // stays meaningful while a pill filter is active.
  const stats = useMemo(() => {
    const totalAum = searchedRows.reduce((s, r) => s + r.ending_value, 0);
    const withBench = searchedRows.filter((r) => r.alpha !== null);
    const outperforming = withBench.filter((r) => (r.alpha as number) >= 0).length;
    return {
      count: searchedRows.length,
      totalAum,
      outperforming,
      benchCount: withBench.length,
      ...weightedStats(searchedRows),
    };
  }, [searchedRows]);

  const tableRows = useMemo(() => {
    if (alphaFilter === "all") return searchedRows;
    return searchedRows.filter((r) =>
      alphaFilter === "outperforming" ? r.alpha !== null && r.alpha >= 0 : r.alpha !== null && r.alpha < 0
    );
  }, [searchedRows, alphaFilter]);

  const asOf = useMemo(() => {
    let max = "";
    for (const r of periodRows) if (r.period_end > max) max = r.period_end;
    return max ? formatDate(max) : null;
  }, [periodRows]);

  const handleExport = () => {
    exportToCsv(
      tableRows.map((r) => ({
        account_number: r.account_number,
        account_name: r.account_name,
        household: r.household_name,
        custodian: r.custodian,
        beginning_value: r.beginning_value,
        ending_value: r.ending_value,
        net_flows_amount: r.net_flows,
        twr_pct: r.twr * 100,
        benchmark_pct: r.benchmark === null ? null : r.benchmark * 100,
        alpha_pct: r.alpha,
      })),
      [
        "account_number",
        "account_name",
        "household",
        "custodian",
        "beginning_value",
        "ending_value",
        "net_flows_amount",
        "twr_pct",
        "benchmark_pct",
        "alpha_pct",
      ],
      `performance-${period.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-background">
        <div className="flex items-center justify-center flex-1">
          <div className="text-muted">Loading performance...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-background">
        <div className="flex items-center justify-center flex-1">
          <div className="text-center">
            <div className="text-red-500 dark:text-red-400 mb-2">Connection Error</div>
            <div className="text-sm text-muted max-w-md">{error}</div>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 text-sm bg-black dark:bg-white text-white dark:text-black rounded-lg hover:opacity-80 transition-opacity"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Header — static block above the scroll container. pt-12 clears the drawer's
          floating control band. */}
      <div className="px-16 pt-12 pb-4">
        <div className="flex items-center gap-4 flex-wrap pl-6">
          <h1 className="text-lg font-semibold text-black dark:text-white">Performance</h1>
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black/40 dark:text-white/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search accounts..."
              className="pl-9 pr-4 py-2 bg-black/5 dark:bg-white/5 rounded-lg text-sm text-black dark:text-white placeholder-black/40 dark:placeholder-white/40 outline-none w-64"
            />
          </div>
          {asOf && (
            <span className="text-xs text-black/40 dark:text-white/40 whitespace-nowrap">As of {asOf}</span>
          )}
          <button
            onClick={handleExport}
            className="ml-auto px-3 py-2 text-xs font-medium bg-black/5 dark:bg-white/5 rounded-lg text-black/70 dark:text-white/70 hover:text-black dark:hover:text-white transition-colors"
          >
            Export CSV
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm pl-6">
          <Stat label="Accounts" value={stats.count.toLocaleString()} />
          <Stat label="Total AUM" value={formatCurrency(stats.totalAum)} />
          <Stat label="TWR" value={formatPct(stats.twr)} valueClass={returnClass(stats.twr)} />
          <Stat label="Benchmark" value={formatPct(stats.benchmark)} />
          <Stat label="Alpha" value={formatPp(stats.alpha)} valueClass={returnClass(stats.alpha)} />
          <Stat label="Outperforming" value={`${stats.outperforming} / ${stats.benchCount}`} />
        </div>

        <div className="mt-3 flex items-center gap-3 pl-6">
          <div className="inline-flex items-center gap-1 bg-black/5 dark:bg-white/5 rounded-lg p-1">
            {PERIOD_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setPeriod(f.value)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  period === f.value
                    ? "bg-white dark:bg-black medium:bg-[#e4e4e4] text-black dark:text-white shadow-sm"
                    : "text-black/40 dark:text-white/40 hover:text-black/70 dark:hover:text-white/70"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="inline-flex items-center gap-1 bg-black/5 dark:bg-white/5 rounded-lg p-1">
            {ALPHA_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setAlphaFilter(f.value)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  alphaFilter === f.value
                    ? "bg-white dark:bg-black medium:bg-[#e4e4e4] text-black dark:text-white shadow-sm"
                    : "text-black/40 dark:text-white/40 hover:text-black/70 dark:hover:text-white/70"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Top spacing lives on the children (mt-8), not the scroller: padding-top on the
          scroll container would offset the sticky-thead pin point. */}
      <div className="flex-1 overflow-y-auto px-16 pb-8">
        <div className="mt-8 px-6">
          <ReturnDistribution rows={searchedRows} />
        </div>
        <div className="mt-8">
          <PerformanceTable rows={tableRows} />
        </div>
      </div>
    </div>
  );
}

// Sign color for return/alpha figures; neutral when the figure is unavailable.
function returnClass(value: number | null): string | undefined {
  if (value === null) return undefined;
  return value >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-[#FF2D2D]";
}

function Stat({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="whitespace-nowrap">
      <span className="text-black/50 dark:text-white/50">{label}:</span>{" "}
      <span className={`font-semibold tabular-nums ${valueClass ?? "text-black dark:text-white"}`}>
        {value}
      </span>
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
      />
    </svg>
  );
}
