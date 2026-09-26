"use client";

import { Suspense, useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useCanvasHref } from "@/lib/useCanvasHref";

// transactions_view is hardened to these five types only — transfers and
// contributions never come back from it.
type TransactionType = "buy" | "sell" | "dividend" | "interest" | "fee";

interface Transaction {
  id: string;
  account_id: string;
  account_number: string;
  account_name: string;
  account_type: string;
  transaction_type: TransactionType;
  symbol: string | null;
  security_name: string | null;
  quantity: number | null;
  price: number | null;
  amount: number;
  fees: number | null;
  settled_date: string | null;
  description: string | null;
  created_at: string;
}

type TypeFilter = "all" | TransactionType;
type DateFilter = "today" | "week" | "month" | "quarter" | "year" | "all" | "custom";
type SortKey = "account" | "symbol" | "quantity" | "price" | "amount" | "fees" | "created_at";
type SortDirection = "asc" | "desc";

export default function TradingPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="text-muted">Loading transactions...</div></div>}>
      <TradingPageContent />
    </Suspense>
  );
}

function TradingPageContent() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("quarter");
  const [searchQuery, setSearchQuery] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const PAGE_SIZE = 50;
  const router = useRouter();
  const toHref = useCanvasHref();

  // Fetch transactions from Supabase (batched to handle >1000 rows).
  // Manual .range() loop instead of paginateQuery: the blotter needs the error
  // screen (paginateQuery discards errors) and the 5000-row cap.
  useEffect(() => {
    async function fetchTransactions() {
      setLoading(true);

      // Build date filter for query
      let dateThreshold: Date | null = null;
      const now = new Date();

      switch (dateFilter) {
        case "today":
          dateThreshold = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case "week":
          dateThreshold = new Date(now);
          dateThreshold.setDate(dateThreshold.getDate() - 7);
          break;
        case "month":
          dateThreshold = new Date(now);
          dateThreshold.setMonth(dateThreshold.getMonth() - 1);
          break;
        case "quarter":
          dateThreshold = new Date(now);
          dateThreshold.setMonth(dateThreshold.getMonth() - 3);
          break;
        case "year":
          dateThreshold = new Date(now);
          dateThreshold.setFullYear(dateThreshold.getFullYear() - 1);
          break;
      }

      // Fetch transactions in batches of 1000 (max 5 batches = 5000 rows)
      const BATCH = 1000;
      const MAX_BATCHES = 5;
      const allRows: Record<string, unknown>[] = [];
      let from = 0;

      for (let batch = 0; batch < MAX_BATCHES; batch++) {
        let query = supabase
          .from("transactions_view")
          .select("*")
          .neq("transaction_type", "contribution")
          .neq("transaction_type", "transfer_in")
          .neq("transaction_type", "transfer_out")
          .order("created_at", { ascending: false })
          .range(from, from + BATCH - 1);

        if (dateThreshold && dateFilter !== "custom" && dateFilter !== "all") {
          query = query.gte("created_at", dateThreshold.toISOString());
        }

        if (dateFilter === "custom") {
          if (startDate) {
            query = query.gte("created_at", new Date(startDate).toISOString());
          }
          if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            query = query.lte("created_at", end.toISOString());
          }
        }

        const { data, error: fetchError } = await query;

        if (fetchError) {
          console.error("Error fetching transactions:", fetchError.message);
          setError("Unable to connect to database. Please check your connection.");
          setLoading(false);
          return;
        }

        if (!data || data.length === 0) break;
        allRows.push(...data);
        if (data.length < BATCH) break;
        from += BATCH;
      }

      const mapped: Transaction[] = allRows.map((row) => ({
        id: row.id as string,
        account_id: row.account_id as string,
        account_number: row.account_number as string,
        account_name: row.account_name as string,
        account_type: row.account_type as string,
        transaction_type: row.transaction_type as TransactionType,
        symbol: row.symbol as string | null,
        security_name: row.security_name as string | null,
        quantity: row.quantity ? Number(row.quantity) : null,
        price: row.price ? Number(row.price) : null,
        amount: Number(row.amount),
        fees: row.fees ? Number(row.fees) : null,
        settled_date: row.settled_date as string | null,
        description: row.description as string | null,
        created_at: row.created_at as string,
      }));

      setTransactions(mapped);
      setLoading(false);
    }

    fetchTransactions();
  }, [dateFilter, startDate, endDate]);

  // Reset to page 1 whenever a filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [typeFilter, searchQuery, dateFilter, startDate, endDate]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      // Type filter
      if (typeFilter !== "all" && tx.transaction_type !== typeFilter) return false;

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          (tx.symbol?.toLowerCase().includes(query) ?? false) ||
          (tx.security_name?.toLowerCase().includes(query) ?? false) ||
          tx.account_number.toLowerCase().includes(query) ||
          tx.account_name.toLowerCase().includes(query) ||
          tx.transaction_type.toLowerCase().includes(query) ||
          (tx.description?.toLowerCase().includes(query) ?? false)
        );
      }
      return true;
    });
  }, [transactions, typeFilter, searchQuery]);

  const sortedTransactions = useMemo(() => {
    return [...filteredTransactions].sort((a, b) => {
      let aVal: number;
      let bVal: number;

      switch (sortKey) {
        case "account":
          return sortDirection === "asc"
            ? a.account_number.localeCompare(b.account_number)
            : b.account_number.localeCompare(a.account_number);
        case "symbol":
          return sortDirection === "asc"
            ? (a.symbol ?? "").localeCompare(b.symbol ?? "")
            : (b.symbol ?? "").localeCompare(a.symbol ?? "");
        case "quantity":
          aVal = a.quantity ?? 0;
          bVal = b.quantity ?? 0;
          break;
        case "price":
          aVal = a.price ?? 0;
          bVal = b.price ?? 0;
          break;
        case "amount":
          aVal = a.amount;
          bVal = b.amount;
          break;
        case "fees":
          aVal = a.fees ?? 0;
          bVal = b.fees ?? 0;
          break;
        case "created_at":
          aVal = new Date(a.created_at).getTime();
          bVal = new Date(b.created_at).getTime();
          break;
        default:
          return 0;
      }

      return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
    });
  }, [filteredTransactions, sortKey, sortDirection]);

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

  const totalPages = Math.max(1, Math.ceil(sortedTransactions.length / PAGE_SIZE));
  const paginatedTransactions = sortedTransactions.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  const stats = useMemo(() => {
    const buys = transactions.filter((t) => t.transaction_type === "buy");
    const sells = transactions.filter((t) => t.transaction_type === "sell");
    const buyVolume = buys.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const sellVolume = sells.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const totalFees = transactions.reduce((sum, t) => sum + Math.abs(t.fees ?? 0), 0);
    return {
      totalTrades: buys.length + sells.length,
      buyCount: buys.length,
      sellCount: sells.length,
      totalVolume: buyVolume + sellVolume,
      totalFees,
    };
  }, [transactions]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return "Today";
    } else if (date.toDateString() === yesterday.toDateString()) {
      return "Yesterday";
    }
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const getTypeBadge = (type: TransactionType) => {
    const labels: Record<TransactionType, string> = {
      buy: "Buy",
      sell: "Sell",
      dividend: "Dividend",
      interest: "Interest",
      fee: "Fee",
    };
    return <span className="font-medium text-black dark:text-white">{labels[type]}</span>;
  };

  if (loading) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-background">
        <div className="flex items-center justify-center flex-1">
          <div className="text-muted">Loading transactions...</div>
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
            <h1 className="text-lg font-semibold text-black dark:text-white">Trade Blotter</h1>
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black/40 dark:text-white/40" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search transactions..."
                className="pl-9 pr-4 py-2 bg-black/5 dark:bg-white/5 rounded-lg text-sm text-black dark:text-white placeholder-black/40 dark:placeholder-white/40 outline-none w-64"
              />
            </div>
            <div className="flex items-center gap-6 text-sm">
              <div>
                <span className="text-black/50 dark:text-white/50">Trades:</span>{" "}
                <span className="font-semibold text-black dark:text-white">{stats.totalTrades.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-black/50 dark:text-white/50">Buys:</span>{" "}
                <span className="font-semibold text-emerald-600 dark:text-emerald-500">{stats.buyCount.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-black/50 dark:text-white/50">Sells:</span>{" "}
                <span className="font-semibold text-[#FF2D2D]">{stats.sellCount.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-black/50 dark:text-white/50">Volume:</span>{" "}
                <span className="font-semibold text-black dark:text-white">{formatCurrency(stats.totalVolume)}</span>
              </div>
              <div>
                <span className="text-black/50 dark:text-white/50">Fees:</span>{" "}
                <span className="font-semibold text-black dark:text-white">{formatCurrency(stats.totalFees)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Top spacing lives on the first child (mt-8), not the scroller (py-8):
          padding-top on the scroll container offsets the sticky-thead pin point,
          leaving a strip above the pinned table headers where rows show through. */}
      <div className="flex-1 overflow-y-auto px-16 pb-8">
        {/* Filters */}
        <div className="flex items-center gap-4 mb-6 mt-8 pl-6">
          <div className="flex items-center gap-2">
            <span className="text-xs text-black dark:text-white uppercase tracking-wider font-semibold">Type</span>
            <div className="flex items-center gap-0.5 bg-black/5 dark:bg-white/5 rounded-lg p-1">
              {([
                { value: "all", label: "All" },
                { value: "buy", label: "Buy" },
                { value: "sell", label: "Sell" },
                { value: "dividend", label: "Dividend" },
                { value: "interest", label: "Interest" },
                { value: "fee", label: "Fee" },
              ] as { value: TypeFilter; label: string }[]).map((type) => (
                <button
                  key={type.value}
                  onClick={() => setTypeFilter(type.value)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    typeFilter === type.value
                      ? "bg-white dark:bg-black medium:bg-[#e4e4e4] text-black dark:text-white shadow-sm"
                      : "text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white"
                  }`}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-black dark:text-white uppercase tracking-wider font-semibold">Period</span>
            <div className="flex items-center gap-0.5 bg-black/5 dark:bg-white/5 rounded-lg p-1">
              {([
                { value: "today", label: "Today" },
                { value: "week", label: "7D" },
                { value: "month", label: "30D" },
                { value: "quarter", label: "90D" },
                { value: "year", label: "1Y" },
                { value: "all", label: "All" },
              ] as { value: DateFilter; label: string }[]).map((period) => (
                <button
                  key={period.value}
                  onClick={() => setDateFilter(period.value)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    dateFilter === period.value
                      ? "bg-white dark:bg-black medium:bg-[#e4e4e4] text-black dark:text-white shadow-sm"
                      : "text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white"
                  }`}
                >
                  {period.label}
                </button>
              ))}
              <button
                onClick={() => setDateFilter(dateFilter === "custom" ? "all" : "custom")}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  dateFilter === "custom"
                    ? "bg-white dark:bg-black medium:bg-[#e4e4e4] text-black dark:text-white shadow-sm"
                    : "text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white"
                }`}
              >
                Custom
              </button>
            </div>

            {/* Custom Date Range Inputs */}
            {dateFilter === "custom" && (
              <div className="flex items-center gap-2 ml-2">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="px-3 py-1.5 rounded-lg bg-black/5 dark:bg-white/5 text-xs text-black dark:text-white border-none outline-none"
                />
                <span className="text-xs text-black/40 dark:text-white/40">to</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="px-3 py-1.5 rounded-lg bg-black/5 dark:bg-white/5 text-xs text-black dark:text-white border-none outline-none"
                />
              </div>
            )}
          </div>
        </div>

        {/* Transactions Table */}
        <table className="w-full text-sm">
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
              <th
                onClick={() => handleSort("symbol")}
                className="text-left px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
              >
                Symbol <SortIcon column="symbol" />
              </th>
              <th
                onClick={() => handleSort("quantity")}
                className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
              >
                Qty <SortIcon column="quantity" />
              </th>
              <th
                onClick={() => handleSort("price")}
                className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
              >
                Price <SortIcon column="price" />
              </th>
              <th
                onClick={() => handleSort("amount")}
                className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
              >
                Amount <SortIcon column="amount" />
              </th>
              <th
                onClick={() => handleSort("fees")}
                className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
              >
                Fees <SortIcon column="fees" />
              </th>
              <th className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider">
                Status
              </th>
              <th
                onClick={() => handleSort("created_at")}
                className="text-right px-6 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
              >
                Date <SortIcon column="created_at" />
              </th>
            </tr>
          </thead>
          <tbody>
            {paginatedTransactions.map((tx) => (
              <tr
                key={tx.id}
                className="border-b border-black/5 dark:border-white/5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
              >
                <td className="px-6 py-3.5">
                  <button
                    onClick={() => router.push(toHref(`/accounts/portfolio?account=${tx.account_number}`))}
                    className="font-semibold text-black dark:text-white cursor-pointer"
                  >
                    {tx.account_number}
                  </button>
                </td>
                <td className="px-4 py-3.5 text-sm">
                  {getTypeBadge(tx.transaction_type)}
                </td>
                <td className="px-4 py-3.5">
                  {tx.symbol ? (
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-black dark:text-white">{tx.symbol}</span>
                      <span className="text-xs text-black/40 dark:text-white/40 truncate max-w-[150px]">
                        {tx.security_name}
                      </span>
                    </div>
                  ) : (
                    <span className="text-black/30 dark:text-white/30">—</span>
                  )}
                </td>
                <td className="px-4 py-3.5 text-right text-black/50 dark:text-white/50">
                  {tx.quantity ? tx.quantity.toFixed(2) : "—"}
                </td>
                <td className="px-4 py-3.5 text-right text-black/50 dark:text-white/50">
                  {tx.price ? formatCurrency(tx.price) : "—"}
                </td>
                <td className="px-4 py-3.5 text-right">
                  <span className="font-medium text-black dark:text-white">
                    {formatCurrency(tx.amount)}
                  </span>
                </td>
                <td className="px-4 py-3.5 text-right text-black/50 dark:text-white/50">
                  {tx.fees ? formatCurrency(tx.fees) : "—"}
                </td>
                <td className="px-4 py-3.5 text-right">
                  {tx.settled_date ? (
                    <span className="text-black/50 dark:text-white/50">Settled</span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-500">Pending</span>
                  )}
                </td>
                <td className="px-6 py-3.5 text-right text-black/50 dark:text-white/50 text-sm whitespace-nowrap">
                  {formatDate(tx.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {sortedTransactions.length === 0 && (
          <div className="py-12 text-center text-black/40 dark:text-white/40 text-sm">
            No transactions match your filters
          </div>
        )}

        {sortedTransactions.length > 0 && totalPages > 1 && (() => {
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
                {((currentPage - 1) * PAGE_SIZE) + 1}–{Math.min(currentPage * PAGE_SIZE, sortedTransactions.length)} of {sortedTransactions.length.toLocaleString()}
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
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 8.25l7.5 7.5 7.5-7.5" />
    </svg>
  );
}
