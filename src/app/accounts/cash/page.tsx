"use client";

import { Suspense, useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useCanvasHref } from "@/lib/useCanvasHref";
import { formatCurrency } from "@/lib/format-utils";
import { useMarketSnapshot } from "@/lib/market/useMarketSnapshot";
import { applyAccountValues } from "@/lib/market/apply";
import MarketStatusPill from "@/components/market/MarketStatusPill";

type AccountCashData = {
  id: string;
  account_number: string;
  account_name: string;
  account_type: string;
  custodian: string;
  total_value: number;
  cash_balance: number;
  mmf_balance: number;
  mmf_holdings: { symbol: string; name: string; value: number; yield: number }[];
  total_liquid: number;
  liquid_pct: number;
  advisory_fee: number;
};

type SortKey = "account" | "cash_balance" | "mmf_balance" | "total_liquid" | "total_value" | "advisory_fee" | "liquid_pct";
type SortDirection = "asc" | "desc";

export default function CashPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="text-muted">Loading cash...</div></div>}>
      <CashPageContent />
    </Suspense>
  );
}

function CashPageContent() {
  // Keep canvas mode when navigating to another page from inside the drawer iframe.
  const canvasHref = useCanvasHref();
  const [rawAccounts, setAccounts] = useState<AccountCashData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("total_liquid");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [symbolsPopover, setSymbolsPopover] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const ITEMS_PER_PAGE = 50;

  const { accounts: accountValues, status: marketStatus, asOf, degraded } =
    useMarketSnapshot({ includeAccounts: true });

  // Close popover when clicking outside. The ref wraps the SEE ALL button AND
  // the panel, so a click on the button toggles instead of close-then-reopen.
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setSymbolsPopover(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fetch cash accounts from Supabase (batched to handle >1000 rows)
  useEffect(() => {
    async function fetchCashAccounts() {
      const BATCH = 1000;
      const MAX_BATCHES = 5;
      const allRows: Record<string, unknown>[] = [];
      let from = 0;

      for (let batch = 0; batch < MAX_BATCHES; batch++) {
        const { data, error: fetchError } = await supabase
          .from("cash_accounts")
          .select("*")
          .order("total_liquid", { ascending: false })
          .range(from, from + BATCH - 1);

        if (fetchError) {
          console.error("Error fetching cash accounts:", fetchError.message);
          setError("Unable to connect to database. Please check your connection.");
          setLoading(false);
          return;
        }

        if (!data || data.length === 0) break;
        allRows.push(...data);
        if (data.length < BATCH) break;
        from += BATCH;
      }

      setAccounts(
        allRows.map((row) => ({
          id: row.id as string,
          account_number: (row.account_number as string) ?? "",
          account_name: (row.account_name as string) ?? "",
          account_type: (row.account_type as string) ?? "individual",
          custodian: (row.custodian as string) ?? "—",
          total_value: Number(row.total_value) || 0,
          cash_balance: Number(row.cash_balance) || 0,
          mmf_balance: Number(row.mmf_balance) || 0,
          mmf_holdings: Array.isArray(row.mmf_holdings)
            ? (row.mmf_holdings as AccountCashData["mmf_holdings"])
            : [],
          total_liquid: Number(row.total_liquid) || 0,
          liquid_pct: Number(row.liquid_pct) || 0,
          advisory_fee: Number(row.advisory_fee) || 0,
        }))
      );
      setLoading(false);
    }

    fetchCashAccounts();
  }, []);

  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  // total_value here is the account's market value, so it must track the live
  // book. cash_balance and mmf_balance are pinned — money-market NAVs are never
  // simulated — so only the total and the ratios derived from it move.
  const accounts = useMemo(() => {
    const revalued = applyAccountValues(rawAccounts, accountValues);
    return revalued.map((a) => {
      const totalLiquid = a.cash_balance + a.mmf_balance;
      return {
        ...a,
        total_liquid: totalLiquid,
        liquid_pct: a.total_value > 0 ? Math.round((totalLiquid / a.total_value) * 10000) / 100 : 0,
        advisory_fee: a.advisory_fee,
      };
    });
  }, [rawAccounts, accountValues]);

  const filteredAccounts = useMemo(() => {
    if (!searchQuery) return accounts;
    const query = searchQuery.toLowerCase();
    return accounts.filter(
      (a) =>
        a.account_name.toLowerCase().includes(query) ||
        a.account_number.toLowerCase().includes(query) ||
        a.custodian.toLowerCase().includes(query)
    );
  }, [accounts, searchQuery]);

  const sortedAccounts = useMemo(() => {
    return [...filteredAccounts].sort((a, b) => {
      if (sortKey === "account") {
        return sortDirection === "asc"
          ? a.account_number.localeCompare(b.account_number)
          : b.account_number.localeCompare(a.account_number);
      }
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
    });
  }, [filteredAccounts, sortKey, sortDirection]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDirection("desc");
    }
  };

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return null;
    return sortDirection === "asc" ? (
      <ChevronUpIcon className="w-3 h-3 inline ml-1" />
    ) : (
      <ChevronDownIcon className="w-3 h-3 inline ml-1" />
    );
  };

  const totalPages = Math.max(1, Math.ceil(sortedAccounts.length / ITEMS_PER_PAGE));
  const paginatedAccounts = sortedAccounts.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const totals = useMemo(() => {
    const totalCash = accounts.reduce((sum, a) => sum + a.cash_balance, 0);
    const totalMmf = accounts.reduce((sum, a) => sum + a.mmf_balance, 0);
    const totalLiquid = totalCash + totalMmf;
    const totalAum = accounts.reduce((sum, a) => sum + a.total_value, 0);
    const avgLiquidPct = totalAum > 0 ? (totalLiquid / totalAum) * 100 : 0;
    return { totalCash, totalMmf, totalLiquid, totalAum, avgLiquidPct };
  }, [accounts]);

  const formatAccountType = (type: string) => {
    const types: Record<string, string> = {
      individual: "Individual",
      joint: "Joint",
      ira: "Traditional IRA",
      roth_ira: "Roth IRA",
      trust: "Trust",
      "401k": "401(k)",
    };
    return types[type] || type;
  };

  if (loading) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-background">
        <div className="flex items-center justify-center flex-1">
          <div className="text-muted">Loading cash data...</div>
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
      {/* Header — static block above the scroll container */}
      <div className="px-16 pt-12 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6 pl-6">
            <h1 className="text-lg font-semibold text-black dark:text-white">Cash</h1>
            <MarketStatusPill status={marketStatus} degraded={degraded} asOf={asOf} />
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
            <div className="flex items-center gap-6 text-sm">
              <div>
                <span className="text-black/50 dark:text-white/50">Accounts:</span>{" "}
                <span className="font-semibold text-black dark:text-white">{accounts.length.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-black/50 dark:text-white/50">Cash:</span>{" "}
                <span className="font-semibold text-black dark:text-white">{formatCurrency(totals.totalCash)}</span>
              </div>
              <div>
                <span className="text-black/50 dark:text-white/50">Money Market:</span>{" "}
                <span className="font-semibold text-black dark:text-white">{formatCurrency(totals.totalMmf)}</span>
              </div>
              <div>
                <span className="text-black/50 dark:text-white/50">Total Liquid:</span>{" "}
                <span className="font-semibold text-black dark:text-white">{formatCurrency(totals.totalLiquid)}</span>
              </div>
              <div>
                <span className="text-black/50 dark:text-white/50">Liquid %:</span>{" "}
                <span className="font-semibold text-black dark:text-white">{totals.avgLiquidPct.toFixed(1)}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Top spacing lives on the first child (mt-8), not the scroller (py-8):
          padding-top on the scroll container offsets the sticky-thead pin point,
          leaving a strip above the pinned table headers where rows show through. */}
      <div className="flex-1 overflow-y-auto px-16 pb-8">
        <table className="w-full text-sm mt-8">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-black/5 dark:border-white/5 bg-[#f2f2f2] dark:bg-[#0a0a0a] medium:bg-[#bcbcbc]">
              <th
                onClick={() => handleSort("account")}
                className="text-left px-6 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
              >
                Account <SortIcon column="account" />
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider">
                Type
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider">
                Custodian
              </th>
              <th
                onClick={() => handleSort("cash_balance")}
                className="text-left px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
              >
                Cash <SortIcon column="cash_balance" />
              </th>
              <th
                onClick={() => handleSort("mmf_balance")}
                className="text-left px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
              >
                MMF <SortIcon column="mmf_balance" />
              </th>
              <th className="text-right pl-2 pr-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider">
                Symbols
              </th>
              <th
                onClick={() => handleSort("total_liquid")}
                className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
              >
                Total Liquid <SortIcon column="total_liquid" />
              </th>
              <th
                onClick={() => handleSort("total_value")}
                className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
              >
                Market Value <SortIcon column="total_value" />
              </th>
              <th
                onClick={() => handleSort("advisory_fee")}
                className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
              >
                Advisory <SortIcon column="advisory_fee" />
              </th>
              <th
                onClick={() => handleSort("liquid_pct")}
                className="text-right px-6 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
              >
                Liquid % <SortIcon column="liquid_pct" />
              </th>
            </tr>
          </thead>
          <tbody>
            {paginatedAccounts.map((account) => (
              <tr
                key={account.id}
                className="border-b border-black/5 dark:border-white/5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
              >
                <td className="px-6 py-4">
                  <Link
                    href={canvasHref(`/accounts/portfolio?account=${account.account_number}`)}
                    className="font-semibold text-black dark:text-white cursor-pointer"
                  >
                    {account.account_number}
                  </Link>
                </td>
                <td className="px-4 py-4">
                  <span className="font-medium text-black dark:text-white">
                    {formatAccountType(account.account_type)}
                  </span>
                </td>
                <td className="px-4 py-4 text-black/50 dark:text-white/50">
                  {account.custodian}
                </td>
                <td className={`px-4 py-4 ${account.cash_balance < 0 ? "text-[#FF2D2D]" : "text-black/50 dark:text-white/50"}`}>
                  {formatCurrency(account.cash_balance)}
                </td>
                <td className="px-4 py-4 text-black/50 dark:text-white/50">
                  {formatCurrency(account.mmf_balance)}
                </td>
                <td className="pl-2 pr-4 py-4 text-right text-black dark:text-white text-xs">
                  {account.mmf_holdings.length === 0 ? (
                    "—"
                  ) : account.mmf_holdings.length <= 2 ? (
                    account.mmf_holdings.map((h) => h.symbol).join(", ")
                  ) : (
                    <div className="relative" ref={symbolsPopover === account.id ? popoverRef : undefined}>
                      <button
                        onClick={() => setSymbolsPopover(symbolsPopover === account.id ? null : account.id)}
                        className="text-blue-600 dark:text-blue-400 hover:underline text-sm uppercase tracking-wider"
                      >
                        SEE ALL ({account.mmf_holdings.length})
                      </button>
                      {symbolsPopover === account.id && (
                        <div className="absolute top-full left-0 mt-1 bg-white dark:bg-zinc-900 rounded-lg shadow-xl border border-black/10 dark:border-white/10 z-50 p-4 min-w-[200px]">
                          <div className="text-xs font-medium text-black/50 dark:text-white/50 uppercase tracking-wider mb-2">
                            MMF Symbols
                          </div>
                          <div className="flex flex-col gap-1.5">
                            {account.mmf_holdings.map((h) => (
                              <div key={h.symbol} className="flex items-center justify-between text-sm">
                                <span className="font-medium text-black dark:text-white">{h.symbol}</span>
                                <span className="text-black/50 dark:text-white/50 ml-4">{h.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </td>
                <td className={`px-4 py-4 text-right font-semibold ${account.total_liquid < 0 ? "text-[#FF2D2D]" : "text-black dark:text-white"}`}>
                  {formatCurrency(account.total_liquid)}
                </td>
                <td className="px-4 py-4 text-right text-black/50 dark:text-white/50">
                  {formatCurrency(account.total_value)}
                </td>
                <td className="px-4 py-4 text-right text-black/50 dark:text-white/50">
                  {formatCurrency(account.advisory_fee)}
                </td>
                <td className="px-6 py-4 text-right text-black dark:text-white">
                  {account.liquid_pct.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {sortedAccounts.length === 0 && (
          <div className="py-12 text-center text-black/40 dark:text-white/40 text-sm">
            No accounts found
          </div>
        )}

        {sortedAccounts.length > 0 && totalPages > 1 && (() => {
          const VISIBLE = 5;
          let windowStart = Math.max(1, currentPage - Math.floor(VISIBLE / 2));
          const windowEnd = Math.min(totalPages, windowStart + VISIBLE - 1);
          if (windowEnd - windowStart + 1 < VISIBLE) {
            windowStart = Math.max(1, windowEnd - VISIBLE + 1);
          }
          const visiblePages = Array.from({ length: windowEnd - windowStart + 1 }, (_, i) => windowStart + i);

          return (
            <div className="flex items-center justify-between mt-6 pb-2 px-6 pt-6 border-t border-black/5 dark:border-white/5">
              <span className="text-xs text-black/40 dark:text-white/40 tabular-nums">
                {((currentPage - 1) * ITEMS_PER_PAGE) + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, sortedAccounts.length)} of {sortedAccounts.length.toLocaleString()}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-2 py-1 rounded-md text-xs text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
                </button>
                <div className="flex items-center gap-1 overflow-hidden">
                  {visiblePages.map((p) => (
                    <button
                      key={p}
                      onClick={() => setCurrentPage(p)}
                      className={`w-7 h-7 rounded-md text-xs font-medium transition-all duration-200 ${
                        currentPage === p
                          ? "bg-black/[0.07] dark:bg-white/[0.07] text-black dark:text-white"
                          : "text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-2 py-1 rounded-md text-xs text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                </button>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  );
}

function ChevronUpIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 8.25l7.5 7.5-7.5 7.5" />
    </svg>
  );
}
