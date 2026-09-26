"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/format-utils";
import { useCanvasHref } from "@/lib/useCanvasHref";
import { type PerformanceRow, weightedStats, formatPct, formatPp } from "./types";

type SortKey =
  | "account"
  | "household"
  | "beginning_value"
  | "ending_value"
  | "net_flows"
  | "twr"
  | "benchmark"
  | "alpha";
type SortDirection = "asc" | "desc";

const ITEMS_PER_PAGE = 50;
const TEXT_SORT_KEYS = new Set<SortKey>(["account", "household"]);

// Nulls (missing benchmark/alpha) always sort last regardless of direction.
const NULL_SENTINEL = Number.NEGATIVE_INFINITY;

const returnColor = (value: number) =>
  value >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-[#FF2D2D]";

/**
 * Per-account returns table: one row per managed account for the selected trailing
 * period, sortable, paginated at 50/page, with an AUM-weighted totals footer.
 */
export default function PerformanceTable({ rows }: { rows: PerformanceRow[] }) {
  const canvasHref = useCanvasHref();
  const [sortKey, setSortKey] = useState<SortKey>("ending_value");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setCurrentPage(1);
  }, [rows]);

  const sortedRows = useMemo(() => {
    const num = (r: PerformanceRow, k: SortKey): number => {
      switch (k) {
        case "beginning_value":
          return r.beginning_value;
        case "ending_value":
          return r.ending_value;
        case "net_flows":
          return r.net_flows;
        case "twr":
          return r.twr;
        case "benchmark":
          return r.benchmark ?? NULL_SENTINEL;
        case "alpha":
          return r.alpha ?? NULL_SENTINEL;
        default:
          return 0;
      }
    };
    return [...rows].sort((a, b) => {
      if (TEXT_SORT_KEYS.has(sortKey)) {
        const av = sortKey === "account" ? a.account_number : a.household_name;
        const bv = sortKey === "account" ? b.account_number : b.household_name;
        const cmp = av.localeCompare(bv);
        return sortDirection === "asc" ? cmp : -cmp;
      }
      const av = num(a, sortKey);
      const bv = num(b, sortKey);
      // Keep nulls last in both directions.
      if (av === NULL_SENTINEL && bv === NULL_SENTINEL) return 0;
      if (av === NULL_SENTINEL) return 1;
      if (bv === NULL_SENTINEL) return -1;
      return sortDirection === "asc" ? av - bv : bv - av;
    });
  }, [rows, sortKey, sortDirection]);

  const totals = useMemo(() => {
    const beginning = rows.reduce((s, r) => s + r.beginning_value, 0);
    const ending = rows.reduce((s, r) => s + r.ending_value, 0);
    const netFlows = rows.reduce((s, r) => s + r.net_flows, 0);
    return { beginning, ending, netFlows, ...weightedStats(rows) };
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / ITEMS_PER_PAGE));
  const page = Math.min(currentPage, totalPages);
  const pagedRows = sortedRows.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDirection(TEXT_SORT_KEYS.has(key) ? "asc" : "desc");
    }
  };

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return null;
    return sortDirection === "asc" ? (
      <ChevronUpIcon className="w-3 h-3 inline ml-0.5" />
    ) : (
      <ChevronDownIcon className="w-3 h-3 inline ml-0.5" />
    );
  };

  if (sortedRows.length === 0) {
    return (
      <div className="py-12 text-center text-black/40 dark:text-white/40 text-sm">No accounts found</div>
    );
  }

  return (
    <>
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-black/5 dark:border-white/5 bg-[#f2f2f2] dark:bg-[#0a0a0a] medium:bg-[#bcbcbc]">
            <Th onClick={() => handleSort("account")} className="text-left px-6">
              Account <SortIcon column="account" />
            </Th>
            <Th onClick={() => handleSort("household")} className="text-left px-4">
              Household <SortIcon column="household" />
            </Th>
            <th className="text-left px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider">
              Custodian
            </th>
            <Th onClick={() => handleSort("beginning_value")} className="text-right px-4">
              Beginning <SortIcon column="beginning_value" />
            </Th>
            <Th onClick={() => handleSort("ending_value")} className="text-right px-4">
              Ending <SortIcon column="ending_value" />
            </Th>
            <Th onClick={() => handleSort("net_flows")} className="text-right px-4">
              Net Flows <SortIcon column="net_flows" />
            </Th>
            <Th onClick={() => handleSort("twr")} className="text-right px-4">
              TWR <SortIcon column="twr" />
            </Th>
            <Th onClick={() => handleSort("benchmark")} className="text-right px-4">
              Benchmark <SortIcon column="benchmark" />
            </Th>
            <Th onClick={() => handleSort("alpha")} className="text-right px-6">
              Alpha <SortIcon column="alpha" />
            </Th>
          </tr>
        </thead>
        <tbody>
          {pagedRows.map((r) => (
            <tr
              key={r.id}
              className="border-b border-black/5 dark:border-white/5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
            >
              <td className="px-6 py-4">
                <Link
                  href={canvasHref(`/accounts/portfolio?account=${r.account_number}`)}
                  className="cursor-pointer"
                >
                  <div className="font-semibold text-black dark:text-white">{r.account_number}</div>
                  <div className="text-xs text-black/50 dark:text-white/50">{r.account_name}</div>
                </Link>
              </td>
              <td className="px-4 py-4 text-black/50 dark:text-white/50">{r.household_name}</td>
              <td className="px-4 py-4 text-black/50 dark:text-white/50">{r.custodian}</td>
              <td className="px-4 py-4 text-right tabular-nums text-black/50 dark:text-white/50">
                {formatCurrency(r.beginning_value)}
              </td>
              <td className="px-4 py-4 text-right tabular-nums font-semibold text-black dark:text-white">
                {formatCurrency(r.ending_value)}
              </td>
              <td
                className={`px-4 py-4 text-right tabular-nums ${
                  r.net_flows < 0 ? "text-[#FF2D2D]" : "text-black/50 dark:text-white/50"
                }`}
              >
                {formatCurrency(r.net_flows)}
              </td>
              <td className={`px-4 py-4 text-right tabular-nums font-medium ${returnColor(r.twr)}`}>
                {formatPct(r.twr)}
              </td>
              <td className="px-4 py-4 text-right tabular-nums text-black/50 dark:text-white/50">
                {formatPct(r.benchmark)}
              </td>
              <td
                className={`px-6 py-4 text-right tabular-nums font-medium ${
                  r.alpha === null ? "text-black/30 dark:text-white/30" : returnColor(r.alpha)
                }`}
              >
                {formatPp(r.alpha)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-black/10 dark:border-white/10 font-semibold text-black dark:text-white">
            <td className="px-6 py-4">Totals ({rows.length.toLocaleString()})</td>
            <td className="px-4 py-4" />
            <td className="px-4 py-4" />
            <td className="px-4 py-4 text-right tabular-nums">{formatCurrency(totals.beginning)}</td>
            <td className="px-4 py-4 text-right tabular-nums">{formatCurrency(totals.ending)}</td>
            <td className="px-4 py-4 text-right tabular-nums">{formatCurrency(totals.netFlows)}</td>
            <td className={`px-4 py-4 text-right tabular-nums ${totals.twr === null ? "" : returnColor(totals.twr)}`}>
              {formatPct(totals.twr)}
            </td>
            <td className="px-4 py-4 text-right tabular-nums">{formatPct(totals.benchmark)}</td>
            <td className={`px-6 py-4 text-right tabular-nums ${totals.alpha === null ? "" : returnColor(totals.alpha)}`}>
              {formatPp(totals.alpha)}
            </td>
          </tr>
        </tfoot>
      </table>

      {totalPages > 1 && (() => {
        const VISIBLE = 5;
        let windowStart = Math.max(1, page - Math.floor(VISIBLE / 2));
        const windowEnd = Math.min(totalPages, windowStart + VISIBLE - 1);
        if (windowEnd - windowStart + 1 < VISIBLE) {
          windowStart = Math.max(1, windowEnd - VISIBLE + 1);
        }
        const visiblePages = Array.from({ length: windowEnd - windowStart + 1 }, (_, i) => windowStart + i);
        return (
          <div className="flex items-center justify-between mt-6 pb-2 px-2 pt-6 border-t border-black/5 dark:border-white/5">
            <span className="text-xs text-black/40 dark:text-white/40 tabular-nums">
              {(page - 1) * ITEMS_PER_PAGE + 1}–{Math.min(page * ITEMS_PER_PAGE, sortedRows.length)} of{" "}
              {sortedRows.length.toLocaleString()}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-2 py-1 rounded-md text-xs text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
              </button>
              <div className="flex items-center gap-1 overflow-hidden">
                {visiblePages.map((p) => (
                  <button
                    key={p}
                    onClick={() => setCurrentPage(p)}
                    className={`w-7 h-7 rounded-md text-xs font-medium transition-all duration-200 ${
                      page === p
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
                disabled={page === totalPages}
                className="px-2 py-1 rounded-md text-xs text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            </div>
          </div>
        );
      })()}
    </>
  );
}

function Th({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <th
      onClick={onClick}
      className={`py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider whitespace-nowrap cursor-pointer select-none ${className ?? ""}`}
    >
      {children}
    </th>
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
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}
