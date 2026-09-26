"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface AccountDetail {
  holdingId: string;
  accountId: string;
  accountNumber: string;
  accountName: string;
  accountType: string;
  custodian: string;
  clientName: string;
  repCode: string;
  householdName: string | null;
  modelName: string | null;
  totalAccountValue: number;
  quantity: number;
  price: number;
  marketValue: number;
  costBasis: number;
  gainLoss: number;
  gainLossPct: number;
  weightInAccount: number;
}

interface BookData {
  symbol: string;
  totalAccounts: number;
  totalShares: number;
  totalMarketValue: number;
  totalCostBasis: number;
  totalGainLoss: number;
  totalGainLossPct: number;
  avgCostPerShare: number;
  concentrationPct: number;
  totalAUM: number;
  byAccountType: Record<string, { count: number; marketValue: number; shares: number }>;
  byCustodian: Record<string, { count: number; marketValue: number }>;
  accounts: AccountDetail[];
}

interface BookTabProps {
  symbol: string;
}

function formatCurrency(val: number): string {
  const abs = Math.abs(val);
  if (abs >= 1e9) return `${val < 0 ? "-" : ""}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${val < 0 ? "-" : ""}$${(abs / 1e6).toFixed(2)}M`;
  return `${val < 0 ? "-" : ""}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatShares(val: number): string {
  if (val >= 1e6) return `${(val / 1e6).toFixed(2)}M`;
  if (val >= 1e3) return `${(val / 1e3).toFixed(1)}K`;
  return val.toFixed(val % 1 !== 0 ? 2 : 0);
}

function formatAccountType(type: string): string {
  const map: Record<string, string> = {
    INDIVIDUAL: "Individual",
    JOINT: "Joint",
    IRA: "IRA",
    ROTH_IRA: "Roth IRA",
    SEP_IRA: "SEP IRA",
    SIMPLE_IRA: "SIMPLE IRA",
    TRUST: "Trust",
    ESTATE: "Estate",
    CUSTODIAL: "Custodial",
    K401: "401(k)",
    K403B: "403(b)",
    PENSION: "Pension",
    CORPORATE: "Corporate",
    LLC: "LLC",
    PARTNERSHIP: "Partnership",
  };
  return map[type] || type;
}

function accountTypeColor(type: string): string {
  switch (type?.toLowerCase()) {
    case "individual": return "bg-blue-500/10 text-blue-600 dark:text-blue-400";
    case "joint": return "bg-violet-500/10 text-violet-600 dark:text-violet-400";
    case "ira": return "bg-amber-500/10 text-amber-600 dark:text-amber-400";
    case "roth_ira": return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    case "sep_ira": case "simple_ira": return "bg-teal-500/10 text-teal-600 dark:text-teal-400";
    case "trust": return "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400";
    case "estate": return "bg-rose-500/10 text-rose-600 dark:text-rose-400";
    case "custodial": return "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400";
    case "k401": case "k403b": return "bg-orange-500/10 text-orange-600 dark:text-orange-400";
    case "pension": case "corporate": case "llc": case "partnership": return "bg-slate-500/10 text-slate-600 dark:text-slate-400";
    default: return "bg-black/5 dark:bg-white/5 text-black/50 dark:text-white/50";
  }
}

type SortKey = "clientName" | "marketValue" | "quantity" | "gainLoss" | "weightInAccount";

export default function BookTab({ symbol }: BookTabProps) {
  const router = useRouter();
  const [data, setData] = useState<BookData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortKey>("marketValue");
  const [sortDesc, setSortDesc] = useState(true);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  useEffect(() => {
    async function fetchBook() {
      setLoading(true);
      try {
        const res = await fetch(`/api/terminal/book?symbol=${encodeURIComponent(symbol)}`);
        if (res.ok) {
          setData(await res.json());
        }
      } catch { /* ignore */ }
      setLoading(false);
    }
    fetchBook();
  }, [symbol]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-black/[0.02] dark:bg-white/[0.02] rounded-lg p-4 flex items-center justify-between">
              <div className="h-3 w-20 bg-black/[0.03] dark:bg-white/[0.03] animate-pulse rounded" />
              <div className="h-5 w-16 bg-black/[0.03] dark:bg-white/[0.03] animate-pulse rounded" />
            </div>
          ))}
        </div>
        <div>
          <div className="h-3 w-24 bg-black/[0.03] dark:bg-white/[0.03] animate-pulse rounded mb-3" />
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-8 bg-black/[0.03] dark:bg-white/[0.03] animate-pulse rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!data || data.totalAccounts === 0) {
    return (
      <div className="text-sm text-black/30 dark:text-white/30 py-8 text-center">
        No accounts currently hold {symbol}
      </div>
    );
  }

  const handleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDesc(!sortDesc);
    } else {
      setSortBy(key);
      setSortDesc(true);
    }
    setPage(0);
  };

  const sorted = [...data.accounts].sort((a, b) => {
    const av = a[sortBy];
    const bv = b[sortBy];
    if (typeof av === "string" && typeof bv === "string") {
      return sortDesc ? bv.localeCompare(av) : av.localeCompare(bv);
    }
    return sortDesc ? (bv as number) - (av as number) : (av as number) - (bv as number);
  });

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const rangeStart = page * PAGE_SIZE + 1;
  const rangeEnd = Math.min((page + 1) * PAGE_SIZE, sorted.length);

  const isPositiveGL = data.totalGainLoss >= 0;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <SummaryCard label="Accounts Holding" value={data.totalAccounts.toString()} />
        <SummaryCard label="Total AUM Invested" value={formatCurrency(data.totalMarketValue)} />
        <SummaryCard label="Total Shares" value={formatShares(data.totalShares)} />
        <SummaryCard
          label="Unrealized P&L"
          value={`${isPositiveGL ? "+" : ""}${formatCurrency(data.totalGainLoss)}`}
          positive={isPositiveGL}
        />
      </div>

      {/* Account Table */}
      <div>
        <h4 className="text-xs font-semibold text-black dark:text-white uppercase tracking-wider mb-3">Account Detail</h4>
        <div className="overflow-x-auto rounded-lg">
          <table className="w-full text-left">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#f2f2f2] dark:bg-[#0a0a0a] medium:bg-[#bcbcbc]">
                <SortHeader label="Client" sortKey="clientName" current={sortBy} desc={sortDesc} onClick={handleSort} />
                <th className="px-3 py-2.5 text-[10px] font-semibold text-black dark:text-white uppercase tracking-wider">Account</th>
                <th className="px-3 py-2.5 text-[10px] font-semibold text-black dark:text-white uppercase tracking-wider">Type</th>
                <SortHeader label="Shares" sortKey="quantity" current={sortBy} desc={sortDesc} onClick={handleSort} align="right" />
                <SortHeader label="Mkt Value" sortKey="marketValue" current={sortBy} desc={sortDesc} onClick={handleSort} align="right" />
                <SortHeader label="P&L" sortKey="gainLoss" current={sortBy} desc={sortDesc} onClick={handleSort} align="right" />
                <SortHeader label="Weight" sortKey="weightInAccount" current={sortBy} desc={sortDesc} onClick={handleSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {paged.map((acct) => {
                const glPositive = acct.gainLoss >= 0;
                return (
                  <tr key={acct.holdingId} className="border-t border-black/5 dark:border-white/5 hover:bg-black/[0.01] dark:hover:bg-white/[0.01]">
                    <td className="px-3 py-2.5 text-sm text-black/80 dark:text-white/80">{acct.clientName || "—"}</td>
                    <td
                      className="px-3 py-2.5 text-sm text-black/70 dark:text-white/70 tabular-nums cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15 dark:focus-visible:ring-white/15"
                      tabIndex={acct.accountNumber ? 0 : undefined}
                      onClick={() => acct.accountNumber && router.push(`/accounts/portfolio?account=${encodeURIComponent(acct.accountNumber)}`)}
                      onKeyDown={(e) => {
                        if ((e.key === "Enter" || e.key === " ") && acct.accountNumber) {
                          e.preventDefault();
                          router.push(`/accounts/portfolio?account=${encodeURIComponent(acct.accountNumber)}`);
                        }
                      }}
                    >
                      {acct.accountNumber || "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${accountTypeColor(acct.accountType)}`}>
                        {formatAccountType(acct.accountType)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-sm text-black/70 dark:text-white/70 tabular-nums">{formatShares(acct.quantity)}</td>
                    <td className="px-3 py-2.5 text-right text-sm font-medium text-black/70 dark:text-white/70 tabular-nums">{formatCurrency(acct.marketValue)}</td>
                    <td className="px-3 py-2.5 text-right">
                      {acct.costBasis > 0 ? (
                        <span className={`text-sm font-medium tabular-nums ${glPositive ? "text-emerald-600 dark:text-emerald-500" : "text-[#FF2D2D]"}`}>
                          {glPositive ? "+" : ""}{acct.gainLossPct.toFixed(2)}%
                        </span>
                      ) : (
                        <span className="text-sm text-black/30 dark:text-white/30">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-sm text-black/50 dark:text-white/50 tabular-nums">{acct.weightInAccount.toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-3">
            <span className="text-xs text-black/30 dark:text-white/30 tabular-nums">
              {rangeStart}–{rangeEnd} of {sorted.length}
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="text-xs font-medium text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white disabled:opacity-20 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15 dark:focus-visible:ring-white/15"
              >
                Prev
              </button>
              <span className="text-xs text-black/40 dark:text-white/40 tabular-nums">
                {page + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="text-xs font-medium text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white disabled:opacity-20 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15 dark:focus-visible:ring-white/15"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div className="bg-black/[0.02] dark:bg-white/[0.02] rounded-lg p-4 flex items-center justify-between">
      <div className="text-xs font-medium text-black/30 dark:text-white/30 uppercase tracking-wider">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${
        positive !== undefined
          ? positive ? "text-emerald-600 dark:text-emerald-500" : "text-[#FF2D2D]"
          : "text-black dark:text-white"
      }`}>
        {value}
      </div>
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  current,
  desc,
  onClick,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  desc: boolean;
  onClick: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = current === sortKey;
  return (
    <th
      className={`px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none hover:text-black dark:hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15 dark:focus-visible:ring-white/15 ${
        align === "right" ? "text-right" : ""
      } ${active ? "text-black dark:text-white" : "text-black dark:text-white"}`}
      tabIndex={0}
      onClick={() => onClick(sortKey)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(sortKey);
        }
      }}
    >
      {label}
      {active && (
        <span className="ml-1 tabular-nums">{desc ? "↓" : "↑"}</span>
      )}
    </th>
  );
}
