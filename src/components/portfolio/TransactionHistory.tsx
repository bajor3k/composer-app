"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

type TransactionType = "buy" | "sell" | "dividend" | "ach_in" | "ach_out" | "fee" | "interest" | "transfer_in" | "transfer_out" | "contribution";

interface Transaction {
  id: string;
  account_id: string;
  type: TransactionType;
  date: string;
  symbol?: string;
  name?: string;
  quantity?: number;
  price?: number;
  amount: number;
  description: string;
  status: "completed" | "pending" | "failed";
  day_change?: number | null;
  day_change_pct?: number | null;
}

type TypeFilter = "all" | TransactionType;

interface TransactionHistoryProps {
  accountId: string | null;
  accountIds?: string[];
  accountMap?: Record<string, string>; // account id → account number
  refreshKey?: number;
  isHouseholdView?: boolean;
}

export default function TransactionHistory({ accountId, accountIds, accountMap, refreshKey, isHouseholdView = false }: TransactionHistoryProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 15;

  // Track the app sidebar's pin state so the wordier filter labels shrink when
  // the sidebar squeezes the content area. The event covers same-document
  // changes; the storage listener covers this page rendered in the canvas/
  // drawer iframe, where the sidebar lives in the parent document.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  useEffect(() => {
    const read = () => setSidebarOpen(localStorage.getItem("sidebar-pinned") !== "false");
    read();
    const onPinned = (e: Event) => setSidebarOpen(!!(e as CustomEvent).detail);
    const onStorage = (e: StorageEvent) => {
      if (e.key === "sidebar-pinned") read();
    };
    window.addEventListener("composer:sidebar-pinned", onPinned);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("composer:sidebar-pinned", onPinned);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Fetch transactions for the account(s)
  useEffect(() => {
    const ids = accountIds && accountIds.length > 0 ? accountIds : accountId ? [accountId] : [];
    if (ids.length === 0) {
      setTransactions([]);
      setLoading(false);
      return;
    }

    async function fetchTransactions() {
      setLoading(true);
      const query = supabase
        .from("account_transactions")
        .select("*")
        .order("date", { ascending: false })
        .limit(200);

      const { data, error } = ids.length === 1
        ? await query.eq("account_id", ids[0])
        : await query.in("account_id", ids);

      if (error) {
        console.error("Error fetching transactions:", error);
        setLoading(false);
        return;
      }

      setTransactions(
        (data ?? []).map((row) => ({
          id: row.id,
          account_id: row.account_id,
          type: row.type as TransactionType,
          date: row.date,
          symbol: row.symbol || undefined,
          name: row.name || undefined,
          quantity: row.quantity ? Number(row.quantity) : undefined,
          price: row.price ? Number(row.price) : undefined,
          amount: Number(row.amount),
          description: row.description || "",
          status: (row.status || "completed") as "completed" | "pending" | "failed",
          day_change: row.day_change != null ? Number(row.day_change) : null,
          day_change_pct: row.day_change_pct != null ? Number(row.day_change_pct) : null,
        }))
      );
      setLoading(false);
    }

    fetchTransactions();
  }, [accountId, accountIds?.join(","), refreshKey]);

  const filteredTransactions = transactions.filter((txn) => {
    if (typeFilter !== "all" && txn.type !== typeFilter) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        txn.description.toLowerCase().includes(query) ||
        txn.symbol?.toLowerCase().includes(query) ||
        txn.name?.toLowerCase().includes(query) ||
        txn.id.toLowerCase().includes(query) ||
        txn.type.toLowerCase().includes(query)
      );
    }
    return true;
  });

  const totalPages = Math.ceil(filteredTransactions.length / PAGE_SIZE);
  const paginatedTransactions = filteredTransactions.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [typeFilter, searchQuery]);

  const formatCurrency = (value: number, type: TransactionType) => {
    // Sells, fees, and outbound transfers are outflows — show as negative
    const isOutflow = type === "sell" || type === "fee" || type === "ach_out" || type === "transfer_out";
    const displayValue = isOutflow ? -Math.abs(value) : Math.abs(value);
    const formatted = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Math.abs(value));
    return displayValue >= 0 ? `+${formatted}` : `-${formatted}`;
  };

  const formatCurrencyPlain = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const getTypeBadge = (type: TransactionType) => {
    const labels: Record<TransactionType, string> = {
      buy: "Buy",
      sell: "Sell",
      dividend: "Dividend",
      ach_in: "ACH In",
      ach_out: "ACH Out",
      fee: "Fee",
      interest: "Interest",
      transfer_in: "Transfer In",
      transfer_out: "Transfer Out",
      contribution: "Contribution",
    };

    return (
      <span className="text-xs font-medium text-black dark:text-white">
        {labels[type]}
      </span>
    );
  };

  const filterOptions: { value: TypeFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "buy", label: "Buys" },
    { value: "sell", label: "Sells" },
    { value: "dividend", label: sidebarOpen ? "Div" : "Dividends" },
    { value: "ach_in", label: "ACH In" },
    { value: "ach_out", label: "ACH Out" },
    { value: "fee", label: "Fees" },
    { value: "interest", label: "Interest" },
    { value: "contribution", label: sidebarOpen ? "Contr" : "Contributions" },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h3 className="text-xs font-semibold text-black dark:text-white uppercase tracking-wider">
            Transactions
          </h3>
          <div className="flex items-center gap-0.5 bg-black/5 dark:bg-white/5 rounded-lg p-1">
            {filterOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setTypeFilter(option.value)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  typeFilter === option.value
                    ? "bg-white dark:bg-black medium:bg-[#e4e4e4] text-black dark:text-white shadow-sm"
                    : "text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {isHouseholdView && (
            <span className="px-1.5 py-0.5 text-xs font-semibold rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 uppercase tracking-wider">Household</span>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black/30 dark:text-white/30" />
          <input
            type="text"
            placeholder="Search transactions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-4 py-2 w-64 bg-black/5 dark:bg-white/5 rounded-lg text-sm text-black dark:text-white placeholder-black/30 dark:placeholder-white/30 outline-none"
          />
        </div>
      </div>

      {/* Table — no overflow-x wrapper so the sticky header anchors to the page scroll
          container (an overflow-x container would also scroll vertically and trap it). */}
      <div className="-mx-6">
        <table className="w-full text-sm min-w-full">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-black/5 dark:border-white/5 bg-[#f2f2f2] dark:bg-[#0a0a0a] medium:bg-[#bcbcbc]">
              <th className="text-left px-6 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider">
                Account
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider">
                Date
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider">
                Type
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider">
                Symbol
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider">
                Description
              </th>
              <th className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider">
                Qty
              </th>
              <th className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider">
                Price
              </th>
              <th className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {paginatedTransactions.map((txn) => (
              <tr
                key={txn.id}
                className="border-b border-black/5 dark:border-white/5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
              >
                <td className="px-6 py-3.5">
                  <span className="font-medium text-black dark:text-white text-sm">{accountMap?.[txn.account_id] ?? "—"}</span>
                </td>
                <td className="px-4 py-3.5">
                  <span className="text-black/50 dark:text-white/50 text-sm">{formatDate(txn.date)}</span>
                </td>
                <td className="px-4 py-3.5">
                  {getTypeBadge(txn.type)}
                </td>
                <td className="px-4 py-3.5">
                  {txn.symbol ? (
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-black dark:text-white">{txn.symbol}</span>
                      {txn.name && <span className="text-xs text-black/40 dark:text-white/40 truncate max-w-[150px]">{txn.name}</span>}
                    </div>
                  ) : (
                    <span className="text-black/30 dark:text-white/30">—</span>
                  )}
                </td>
                <td className="px-4 py-3.5">
                  <span className="text-black/50 dark:text-white/50 text-sm truncate max-w-[200px] block">
                    {txn.description}
                  </span>
                </td>
                <td className="px-4 py-3.5 text-right">
                  {txn.quantity ? (
                    <span className="text-black/50 dark:text-white/50">{txn.quantity}</span>
                  ) : (
                    <span className="text-black/30 dark:text-white/30">—</span>
                  )}
                </td>
                <td className="px-4 py-3.5 text-right">
                  {txn.price ? (
                    <span className="text-black/50 dark:text-white/50">{formatCurrencyPlain(txn.price)}</span>
                  ) : (
                    <span className="text-black/30 dark:text-white/30">—</span>
                  )}
                </td>
                <td className="px-4 py-3.5 text-right font-medium text-black dark:text-white">
                  {formatCurrency(txn.amount, txn.type)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-end gap-8 py-4 mt-2 pr-6">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="text-sm font-medium text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="text-sm text-black/40 dark:text-white/40">
            {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="text-sm font-medium text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}

      {loading && (
        <div className="py-12 text-center text-black/40 dark:text-white/40 text-sm">
          Loading transactions...
        </div>
      )}

      {!loading && filteredTransactions.length === 0 && (
        <div className="py-12 text-center text-black/40 dark:text-white/40 text-sm">
          No transactions found
        </div>
      )}
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
