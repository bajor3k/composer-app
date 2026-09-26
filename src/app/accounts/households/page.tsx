"use client";

import { Suspense, useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useMarketSnapshot } from "@/lib/market/useMarketSnapshot";
import { applyAccountValues } from "@/lib/market/apply";
import MarketStatusPill from "@/components/market/MarketStatusPill";
import { useCanvasHref } from "@/lib/useCanvasHref";
import { formatCurrency } from "@/lib/format-utils";
import HouseholdsTable from "@/components/households/HouseholdsTable";
import { type HouseholdAccount, type HouseholdSummary } from "@/components/households/types";

export default function HouseholdsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <div className="text-muted">Loading households...</div>
        </div>
      }
    >
      <HouseholdsPageContent />
    </Suspense>
  );
}

function HouseholdsPageContent() {
  // Preserve canvas mode on internal links (account drill-through opens the Portfolio page).
  const canvasHref = useCanvasHref();
  const [rawAccounts, setAccounts] = useState<HouseholdAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Household AUM is just the sum of member account values, so overlaying the
  // same per-account map the portfolio page uses keeps the two in agreement
  // without touching the aggregation below.
  const { accounts: accountValues, status: marketStatus, asOf, degraded } =
    useMarketSnapshot({ includeAccounts: true });

  const accounts = useMemo(
    () => applyAccountValues(rawAccounts, accountValues),
    [rawAccounts, accountValues],
  );

  useEffect(() => {
    async function fetchAccounts() {
      const BATCH = 1000;
      const MAX_BATCHES = 20; // safety cap (~20k accounts) against a runaway loop
      const rows: Record<string, unknown>[] = [];
      let from = 0;
      for (let b = 0; b < MAX_BATCHES; b++) {
        const { data, error: err } = await supabase
          .from("portfolio_accounts")
          .select("*")
          .order("total_value", { ascending: false })
          .range(from, from + BATCH - 1);
        if (err) {
          console.error("Error fetching accounts:", err.message);
          setError("Unable to connect to database. Please check your connection.");
          setLoading(false);
          return;
        }
        if (!data || data.length === 0) break;
        rows.push(...(data as Record<string, unknown>[]));
        if (data.length < BATCH) break;
        from += BATCH;
      }

      setAccounts(
        rows.map((row) => ({
          id: (row.id as string) ?? "",
          account_number: (row.account_number as string) ?? "",
          account_name: (row.account_name as string) ?? "",
          account_type: (row.account_type as string) ?? "individual",
          custodian: (row.custodian as string) ?? "—",
          total_value: Number(row.total_value) || 0,
          cash_balance: Number(row.cash_balance) || 0,
          rep_code: (row.rep_code as string) || null,
          client_name: (row.client_name as string) || null,
          firm_name: (row.firm_name as string) || null,
          household_id: (row.household_id as string) || null,
          household_name: (row.household_name as string) || null,
        }))
      );
      setLoading(false);
    }

    fetchAccounts();
  }, []);

  // Group accounts into households by household_id (accounts without one are skipped).
  const { households, totals } = useMemo(() => {
    const map = new Map<string, HouseholdSummary>();
    for (const a of accounts) {
      if (!a.household_id) continue;
      let hh = map.get(a.household_id);
      if (!hh) {
        hh = {
          id: a.household_id,
          name: a.household_name || "Unnamed Household",
          firm_name: a.firm_name,
          total_aum: 0,
          total_cash: 0,
          account_count: 0,
          account_numbers: [],
          rep_codes: [],
          members: [],
        };
        map.set(a.household_id, hh);
      }
      hh.total_aum += a.total_value;
      hh.total_cash += a.cash_balance;
      hh.account_count += 1;
      if (a.account_number) hh.account_numbers.push(a.account_number);
      hh.members.push(a);
      if (!hh.firm_name && a.firm_name) hh.firm_name = a.firm_name;
    }

    const households = [...map.values()];
    for (const hh of households) {
      hh.members.sort((x, y) => y.total_value - x.total_value);
      hh.rep_codes = [...new Set(hh.members.map((m) => m.rep_code).filter(Boolean) as string[])];
    }

    const totals = {
      households: households.length,
      accounts: households.reduce((s, h) => s + h.account_count, 0),
      cash: households.reduce((s, h) => s + h.total_cash, 0),
      aum: households.reduce((s, h) => s + h.total_aum, 0),
    };

    return { households, totals };
  }, [accounts]);

  const filteredHouseholds = useMemo(() => {
    if (!searchQuery.trim()) return households;
    const q = searchQuery.toLowerCase();
    return households.filter(
      (h) =>
        h.name.toLowerCase().includes(q) ||
        (h.firm_name && h.firm_name.toLowerCase().includes(q)) ||
        h.account_numbers.some((n) => n.toLowerCase().includes(q)) ||
        h.rep_codes.some((r) => r.toLowerCase().includes(q))
    );
  }, [households, searchQuery]);

  if (loading) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-background">
        <div className="flex items-center justify-center flex-1">
          <div className="text-muted">Loading households...</div>
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
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="text-lg font-semibold text-black dark:text-white">Households</h1>
          <MarketStatusPill status={marketStatus} degraded={degraded} asOf={asOf} />
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black/40 dark:text-white/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search household, firm, account..."
              className="pl-9 pr-4 py-2 bg-black/5 dark:bg-white/5 rounded-lg text-sm text-black dark:text-white placeholder-black/40 dark:placeholder-white/40 outline-none w-56"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
          <Stat label="Households" value={totals.households.toLocaleString()} />
          <Stat label="Accounts" value={totals.accounts.toLocaleString()} />
          <Stat label="Total Cash" value={formatCurrency(totals.cash)} />
          <Stat label="Total AUM" value={formatCurrency(totals.aum)} />
        </div>
      </div>

      {/* Top spacing lives on the table (mt-8), not the scroller: padding-top on the
          scroll container would offset the sticky-thead pin point. */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-4 lg:px-6 pb-8">
        <div className="mt-8">
          <HouseholdsTable rows={filteredHouseholds} canvasHref={canvasHref} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="whitespace-nowrap">
      <span className="text-black/50 dark:text-white/50">{label}:</span>{" "}
      <span className="font-semibold tabular-nums text-black dark:text-white">{value}</span>
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
