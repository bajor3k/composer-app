"use client";

import { Suspense, useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useMarketSnapshot } from "@/lib/market/useMarketSnapshot";
import { applyAccountValues, reviveHoldings } from "@/lib/market/apply";
import MarketStatusPill from "@/components/market/MarketStatusPill";
import { useCanvasHref } from "@/lib/useCanvasHref";
import { formatCurrency } from "@/lib/format-utils";
import FirmHoldingsTable from "@/components/portfolio/FirmHoldingsTable";
import { type Holding, type PortfolioAccount, type AggregatedHolding } from "@/components/portfolio/types";

// Cash-like symbols carry no meaningful day change; keep them out of the day-change math
// but still count them as positions/value.
const CASH_LIKE = new Set(["CASH", "VMFXX", "SPAXX", "SWVXX"]);

export default function HoldingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <div className="text-muted">Loading holdings...</div>
        </div>
      }
    >
      <HoldingsPageContent />
    </Suspense>
  );
}

function HoldingsPageContent() {
  // Preserve canvas mode on internal links (account drill-through opens the Portfolio page).
  const canvasHref = useCanvasHref();
  const [rawHoldings, setHoldings] = useState<Holding[]>([]);
  const [rawAccounts, setAccounts] = useState<PortfolioAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Firm-wide, but the live payload is ~82 symbols rather than the ~6,500
  // holding rows on screen — which is the only reason this page can tick at
  // the same cadence as a single-account view.
  const { quotes, accounts: accountValues, status: marketStatus, asOf, degraded } =
    useMarketSnapshot({ includeAccounts: true });

  const holdings = useMemo(() => reviveHoldings(rawHoldings, quotes), [rawHoldings, quotes]);
  const accounts = useMemo(
    () => applyAccountValues(rawAccounts, accountValues),
    [rawAccounts, accountValues],
  );

  useEffect(() => {
    async function fetchAll() {
      const BATCH = 1000;
      const MAX_BATCHES = 60; // safety cap (~60k rows) against a runaway loop

      // Paginate a table into a flat array, breaking when a short batch signals the end.
      async function fetchTable(
        table: string,
        orderCol: string
      ): Promise<Record<string, unknown>[] | null> {
        const rows: Record<string, unknown>[] = [];
        let from = 0;
        for (let b = 0; b < MAX_BATCHES; b++) {
          const { data, error: err } = await supabase
            .from(table)
            .select("*")
            .order(orderCol, { ascending: false })
            .range(from, from + BATCH - 1);
          if (err) {
            console.error(`Error fetching ${table}:`, err.message);
            return null;
          }
          if (!data || data.length === 0) break;
          rows.push(...(data as Record<string, unknown>[]));
          if (data.length < BATCH) break;
          from += BATCH;
        }
        return rows;
      }

      const [holdingRows, accountRows] = await Promise.all([
        fetchTable("holdings_enriched", "marketValue"),
        fetchTable("portfolio_accounts", "total_value"),
      ]);

      if (holdingRows === null || accountRows === null) {
        setError("Unable to connect to database. Please check your connection.");
        setLoading(false);
        return;
      }

      setHoldings(
        holdingRows.map((row) => ({
          id: (row.id as string) ?? "",
          account_id: (row.account_id as string) || (row.accountId as string) || "",
          symbol: (row.symbol as string) ?? "",
          name: (row.name as string) ?? "",
          quantity: Number(row.quantity) || 0,
          price: Number(row.price) || 0,
          market_value: Number(row.market_value ?? row.marketValue) || 0,
          cost_basis:
            row.cost_basis ?? row.costBasis ? Number(row.cost_basis ?? row.costBasis) : null,
          day_change: Number(row.day_change) || 0,
          day_change_pct: Number(row.day_change_pct) || 0,
          asset_class: ((row.asset_class as string) || (row.assetClass as string) || "other") as Holding["asset_class"],
          created_at: (row.created_at as string) || "",
          updated_at: (row.updated_at as string) || "",
        }))
      );

      setAccounts(
        accountRows.map((row) => ({
          id: (row.id as string) ?? "",
          account_number: (row.account_number as string) ?? "",
          account_name: (row.account_name as string) ?? "",
          account_type: (row.account_type as PortfolioAccount["account_type"]) ?? "individual",
          custodian: (row.custodian as string) ?? "—",
          total_value: Number(row.total_value) || 0,
          cash_balance: Number(row.cash_balance) || 0,
          day_change: Number(row.day_change) || 0,
          day_change_pct: Number(row.day_change_pct) || 0,
          model_portfolio_id: (row.model_portfolio_id as string) || null,
          model_name: (row.model_name as string) || null,
          is_managed: (row.is_managed as boolean) ?? true,
          rep_code: (row.rep_code as string) || null,
          created_at: (row.created_at as string) || "",
          updated_at: (row.updated_at as string) || "",
          client_name: (row.client_name as string) || null,
          firm_name: (row.firm_name as string) || null,
          household_name: (row.household_name as string) || null,
          household_id: (row.household_id as string) || null,
          date_of_birth: (row.date_of_birth as string) || null,
          ssn: (row.ssn as string) || null,
          legal_address: (row.legal_address as string) || null,
          city: (row.city as string) || null,
          state: (row.state as string) || null,
          zip_code: (row.zip_code as string) || null,
          annual_income: row.annual_income ? Number(row.annual_income) : null,
          net_worth: row.net_worth ? Number(row.net_worth) : null,
          risk_tolerance: (row.risk_tolerance as string) || null,
          investment_objective: (row.investment_objective as string) || null,
          time_horizon: (row.time_horizon as string) || null,
          fee_schedule: (row.fee_schedule as string) || null,
          fee_rate: Number(row.fee_rate) || 0,
          billing_frequency: (row.billing_frequency as string) || null,
        }))
      );
      setLoading(false);
    }

    fetchAll();
  }, []);

  const accountsById = useMemo(() => {
    const m = new Map<string, PortfolioAccount>();
    for (const a of accounts) m.set(a.id, a);
    return m;
  }, [accounts]);

  // Aggregate every per-account position into one row per security, keeping the
  // per-account rows for the expandable breakdown. A synthetic firm-wide CASH row is
  // appended from the accounts' net cash balances.
  const { rows, totalValue, summary } = useMemo(() => {
    const map = new Map<string, AggregatedHolding>();
    for (const h of holdings) {
      if (h.symbol === "CASH") continue; // synthetic cash is added below
      let agg = map.get(h.symbol);
      if (!agg) {
        agg = {
          symbol: h.symbol,
          name: h.name,
          asset_class: h.asset_class,
          quantity: 0,
          price: 0,
          market_value: 0,
          cost_basis: null,
          day_change: 0,
          day_change_pct: 0,
          account_count: 0,
          accounts: [],
        };
        map.set(h.symbol, agg);
      }
      agg.quantity += h.quantity;
      agg.market_value += h.market_value;
      if (h.cost_basis !== null) agg.cost_basis = (agg.cost_basis ?? 0) + h.cost_basis;
      if (!CASH_LIKE.has(h.symbol)) agg.day_change += h.day_change;
      agg.accounts.push(h);
    }

    const securities = [...map.values()];
    for (const agg of securities) {
      agg.price = agg.quantity > 0 ? agg.market_value / agg.quantity : 0;
      const prev = agg.market_value - agg.day_change;
      agg.day_change_pct = prev !== 0 ? (agg.day_change / prev) * 100 : 0;
      agg.account_count = new Set(agg.accounts.map((a) => a.account_id)).size;
    }

    // Firm-wide net cash (matches how the Cash page totals cash across accounts).
    const totalCash = accounts.reduce((s, a) => s + a.cash_balance, 0);
    const cashAccountCount = accounts.filter((a) => a.cash_balance !== 0).length;

    const rows: AggregatedHolding[] = [...securities];
    if (Math.abs(totalCash) >= 0.005) {
      rows.push({
        symbol: "CASH",
        name: "Cash & Cash Equivalents",
        asset_class: "cash",
        quantity: totalCash,
        price: 1,
        market_value: totalCash,
        cost_basis: totalCash,
        day_change: 0,
        day_change_pct: 0,
        account_count: cashAccountCount,
        accounts: [],
        is_cash: true,
      });
    }

    const securitiesMV = securities.reduce((s, r) => s + r.market_value, 0);
    const securitiesCB = securities.reduce((s, r) => s + (r.cost_basis ?? 0), 0);
    const totalDayChange = securities.reduce((s, r) => s + r.day_change, 0);
    const marketValue = securitiesMV + totalCash;
    const totalValue = marketValue; // for weight % (includes cash)

    const summary = {
      positions: securities.length,
      accounts: accounts.length,
      marketValue,
      costBasis: securitiesCB + totalCash,
      unrealized: securitiesMV - securitiesCB,
      unrealizedPct: securitiesCB > 0 ? ((securitiesMV - securitiesCB) / securitiesCB) * 100 : 0,
      dayChange: totalDayChange,
      dayChangePct:
        marketValue - totalDayChange !== 0
          ? (totalDayChange / (marketValue - totalDayChange)) * 100
          : 0,
    };

    return { rows, totalValue, summary };
  }, [holdings, accounts]);

  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const q = searchQuery.toLowerCase();
    return rows.filter(
      (r) => r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)
    );
  }, [rows, searchQuery]);

  if (loading) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-background">
        <div className="flex items-center justify-center flex-1">
          <div className="text-muted">Loading holdings...</div>
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
          floating control band; x-padding tightens as the card narrows. */}
      <div className="px-3 sm:px-4 lg:px-6 pt-12 pb-4">
        <div
          className="flex items-center gap-4 flex-wrap"
          data-live-total={totalValue}
        >
          <h1 className="text-lg font-semibold text-black dark:text-white">Holdings</h1>
          <MarketStatusPill status={marketStatus} degraded={degraded} asOf={asOf} />
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black/40 dark:text-white/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search symbol or name..."
              className="pl-9 pr-4 py-2 bg-black/5 dark:bg-white/5 rounded-lg text-sm text-black dark:text-white placeholder-black/40 dark:placeholder-white/40 outline-none w-56"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
          <Stat label="Positions" value={summary.positions.toLocaleString()} />
          <Stat label="Accounts" value={summary.accounts.toLocaleString()} />
          <Stat label="Market Value" value={formatCurrency(summary.marketValue)} />
          <Stat label="Cost Basis" value={formatCurrency(summary.costBasis)} />
          <Stat
            label="Unrealized"
            value={`${signChar(summary.unrealized)}${formatCurrency(Math.abs(summary.unrealized))} (${signChar(summary.unrealized)}${Math.abs(summary.unrealizedPct).toFixed(2)}%)`}
            tone={summary.unrealized >= 0 ? "pos" : "neg"}
          />
          <Stat
            label="Day"
            value={`${signChar(summary.dayChange)}${formatCurrency(Math.abs(summary.dayChange))} (${signChar(summary.dayChange)}${Math.abs(summary.dayChangePct).toFixed(2)}%)`}
            tone={summary.dayChange >= 0 ? "pos" : "neg"}
          />
        </div>
      </div>

      {/* Top spacing lives on the table (mt-8), not the scroller: padding-top on the
          scroll container would offset the sticky-thead pin point. */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-4 lg:px-6 pb-8">
        <div className="mt-8">
          <FirmHoldingsTable
            rows={filteredRows}
            totalValue={totalValue}
            canvasHref={canvasHref}
            accountsById={accountsById}
          />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  const valueColor =
    tone === "pos"
      ? "text-emerald-600 dark:text-emerald-500"
      : tone === "neg"
      ? "text-[#FF2D2D]"
      : "text-black dark:text-white";
  return (
    <div className="whitespace-nowrap">
      <span className="text-black/50 dark:text-white/50">{label}:</span>{" "}
      <span className={`font-semibold tabular-nums ${valueColor}`}>{value}</span>
    </div>
  );
}

function signChar(n: number) {
  return n >= 0 ? "+" : "−";
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
