"use client";

import { useState, useMemo, useEffect, Fragment } from "react";
import Link from "next/link";
import { type AggregatedHolding, type PortfolioAccount } from "./types";

type SortKey =
  | "symbol"
  | "name"
  | "accounts"
  | "quantity"
  | "avg_cost"
  | "market_value"
  | "cost_basis"
  | "unrealized_gl"
  | "day_change"
  | "weight";
type SortDirection = "asc" | "desc";

const ITEMS_PER_PAGE = 50;

// Compact notation keeps the big-dollar columns narrow so the whole table fits the drawer
// card without a sideways scroll; the exact figure is available on hover (title=) and in the
// page's summary header.
const moneyCompact = (value: number) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 1,
  }).format(value);
const money0 = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
const money2 = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
const qty = (value: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const pctStr = (value: number) => `${Math.abs(value).toFixed(2)}%`;

// Shared cell padding — tight so many columns fit the narrow card, loosening as it widens.
const PAD = "px-2 lg:px-3";
const PAD_L = "pl-3 lg:pl-4 pr-2";
const PAD_R = "pr-3 lg:pr-4 pl-2";

function avgCost(h: AggregatedHolding): number | null {
  return h.cost_basis !== null && h.quantity > 0 ? h.cost_basis / h.quantity : null;
}
function unrealized(h: AggregatedHolding): number | null {
  return h.cost_basis !== null ? h.market_value - h.cost_basis : null;
}
function unrealizedPct(h: AggregatedHolding): number | null {
  return h.cost_basis !== null && h.cost_basis > 0
    ? ((h.market_value - h.cost_basis) / h.cost_basis) * 100
    : null;
}

/**
 * Firm-wide holdings table: one row per security, aggregated across every account.
 * Rows expand to reveal the per-account breakdown. Columns reveal progressively as the
 * card/viewport widens (Tailwind breakpoints track the iframe width in canvas mode), so the
 * table never scrolls sideways inside the drawer card.
 */
export default function FirmHoldingsTable({
  rows,
  totalValue,
  canvasHref,
  accountsById,
}: {
  rows: AggregatedHolding[];
  totalValue: number;
  canvasHref: (href: string) => string;
  accountsById: Map<string, PortfolioAccount>;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("market_value");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  // Search / filter changes upstream produce a new rows array — restart at page one.
  useEffect(() => {
    setCurrentPage(1);
  }, [rows]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      // Synthetic CASH aggregate always sinks to the bottom.
      if (a.is_cash && !b.is_cash) return 1;
      if (b.is_cash && !a.is_cash) return -1;

      if (sortKey === "symbol") {
        return sortDirection === "asc" ? a.symbol.localeCompare(b.symbol) : b.symbol.localeCompare(a.symbol);
      }
      if (sortKey === "name") {
        return sortDirection === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      }

      let aVal: number;
      let bVal: number;
      switch (sortKey) {
        case "accounts":
          aVal = a.account_count;
          bVal = b.account_count;
          break;
        case "quantity":
          aVal = a.quantity;
          bVal = b.quantity;
          break;
        case "avg_cost":
          aVal = avgCost(a) ?? 0;
          bVal = avgCost(b) ?? 0;
          break;
        case "cost_basis":
          aVal = a.cost_basis ?? 0;
          bVal = b.cost_basis ?? 0;
          break;
        case "unrealized_gl":
          aVal = unrealized(a) ?? 0;
          bVal = unrealized(b) ?? 0;
          break;
        case "day_change":
          aVal = a.day_change;
          bVal = b.day_change;
          break;
        case "weight":
        case "market_value":
        default:
          aVal = a.market_value;
          bVal = b.market_value;
          break;
      }
      return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
    });
  }, [rows, sortKey, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / ITEMS_PER_PAGE));
  const page = Math.min(currentPage, totalPages);
  const pagedRows = sortedRows.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

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
      <ChevronUpIcon className="w-3 h-3 inline ml-0.5" />
    ) : (
      <ChevronDownIcon className="w-3 h-3 inline ml-0.5" />
    );
  };

  if (sortedRows.length === 0) {
    return (
      <div className="py-12 text-center text-black/40 dark:text-white/40 text-sm">No holdings found</div>
    );
  }

  return (
    <>
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-black/5 dark:border-white/5 bg-[#f2f2f2] dark:bg-[#0a0a0a] medium:bg-[#bcbcbc]">
            <Th onClick={() => handleSort("symbol")} className={`text-left ${PAD_L}`}>
              Symbol <SortIcon column="symbol" />
            </Th>
            <Th onClick={() => handleSort("name")} className={`text-left ${PAD}`}>
              Name <SortIcon column="name" />
            </Th>
            <Th onClick={() => handleSort("accounts")} className={`text-right ${PAD} hidden sm:table-cell`}>
              Accts <SortIcon column="accounts" />
            </Th>
            <Th onClick={() => handleSort("quantity")} className={`text-right ${PAD} hidden md:table-cell`}>
              Qty <SortIcon column="quantity" />
            </Th>
            <Th onClick={() => handleSort("avg_cost")} className={`text-right ${PAD} hidden lg:table-cell`}>
              Avg Cost <SortIcon column="avg_cost" />
            </Th>
            <Th onClick={() => handleSort("market_value")} className={`text-right ${PAD}`}>
              Value <SortIcon column="market_value" />
            </Th>
            <Th onClick={() => handleSort("cost_basis")} className={`text-right ${PAD} hidden lg:table-cell`}>
              Cost <SortIcon column="cost_basis" />
            </Th>
            <Th onClick={() => handleSort("unrealized_gl")} className={`text-right ${PAD}`}>
              Unreal. <SortIcon column="unrealized_gl" />
            </Th>
            <Th onClick={() => handleSort("day_change")} className={`text-right ${PAD}`}>
              Day <SortIcon column="day_change" />
            </Th>
            <Th onClick={() => handleSort("weight")} className={`text-right ${PAD_R}`}>
              Weight <SortIcon column="weight" />
            </Th>
          </tr>
        </thead>
        <tbody>
          {pagedRows.map((h) => {
            const weight = totalValue > 0 ? (h.market_value / totalValue) * 100 : 0;
            const ac = avgCost(h);
            const gl = unrealized(h);
            const glPct = unrealizedPct(h);
            const canExpand = !h.is_cash && h.accounts.length > 0;
            const isExpanded = expandedSymbol === h.symbol;

            return (
              <Fragment key={h.symbol}>
                <tr
                  onClick={() => canExpand && setExpandedSymbol(isExpanded ? null : h.symbol)}
                  className={`border-b border-black/5 dark:border-white/5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors ${canExpand ? "cursor-pointer" : ""}`}
                >
                  <td className={`${PAD_L} py-3.5`}>
                    <span className="inline-flex items-center gap-1.5">
                      {canExpand ? (
                        <ChevronRightIcon
                          className={`w-3 h-3 shrink-0 text-black/30 dark:text-white/30 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                        />
                      ) : (
                        <span className="w-3 shrink-0" />
                      )}
                      <span className="font-semibold text-black dark:text-white">{h.symbol}</span>
                    </span>
                  </td>
                  <td className={`${PAD} py-3.5 text-black/50 dark:text-white/50 max-w-[120px] lg:max-w-[220px] truncate`}>
                    {h.name}
                  </td>
                  <td className={`${PAD} py-3.5 text-right text-black/50 dark:text-white/50 hidden sm:table-cell tabular-nums`}>
                    {h.account_count.toLocaleString()}
                  </td>
                  <td className={`${PAD} py-3.5 text-right text-black/50 dark:text-white/50 hidden md:table-cell tabular-nums`}>
                    {qty(h.quantity)}
                  </td>
                  <td className={`${PAD} py-3.5 text-right text-black/50 dark:text-white/50 hidden lg:table-cell tabular-nums`}>
                    {ac !== null ? money2(ac) : <Dash />}
                  </td>
                  <td
                    className={`${PAD} py-3.5 text-right font-medium text-black dark:text-white tabular-nums`}
                    title={money0(h.market_value)}
                  >
                    {moneyCompact(h.market_value)}
                  </td>
                  <td
                    className={`${PAD} py-3.5 text-right text-black/50 dark:text-white/50 hidden lg:table-cell tabular-nums`}
                    title={h.cost_basis !== null ? money0(h.cost_basis) : undefined}
                  >
                    {h.cost_basis !== null ? moneyCompact(h.cost_basis) : <Dash />}
                  </td>
                  <td
                    className={`${PAD} py-3.5 text-right tabular-nums`}
                    title={gl !== null && !h.is_cash ? money0(gl) : undefined}
                  >
                    {gl === null || h.is_cash ? (
                      <Dash />
                    ) : (
                      <span className={gl >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-[#FF2D2D]"}>
                        <span className="hidden md:inline">
                          {gl >= 0 ? "+" : "−"}
                          {moneyCompact(Math.abs(gl))}{" "}
                        </span>
                        <span className="font-medium">
                          {gl >= 0 ? "+" : "−"}
                          {glPct !== null ? pctStr(glPct) : ""}
                        </span>
                      </span>
                    )}
                  </td>
                  <td className={`${PAD} py-3.5 text-right tabular-nums`}>
                    {h.is_cash || h.day_change === 0 ? (
                      <Dash />
                    ) : (
                      <span
                        className={`font-medium ${h.day_change >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-[#FF2D2D]"}`}
                      >
                        {h.day_change >= 0 ? "+" : "−"}
                        {pctStr(h.day_change_pct)}
                      </span>
                    )}
                  </td>
                  <td className={`${PAD_R} py-3.5 text-right text-black/50 dark:text-white/50 tabular-nums`}>
                    {weight.toFixed(2)}%
                  </td>
                </tr>

                {isExpanded &&
                  [...h.accounts]
                    .sort((x, y) => y.market_value - x.market_value)
                    .map((sub) => {
                      const acct = accountsById.get(sub.account_id);
                      const subAvg =
                        sub.cost_basis !== null && sub.quantity > 0 ? sub.cost_basis / sub.quantity : null;
                      const subGl = sub.cost_basis !== null ? sub.market_value - sub.cost_basis : null;
                      const subGlPct =
                        sub.cost_basis !== null && sub.cost_basis > 0
                          ? ((sub.market_value - sub.cost_basis) / sub.cost_basis) * 100
                          : null;
                      const subShare = h.market_value > 0 ? (sub.market_value / h.market_value) * 100 : 0;
                      return (
                        <tr
                          key={sub.id}
                          className="border-b border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02] text-xs"
                        >
                          <td className={`${PAD_L} py-2.5`}>
                            <span className="inline-flex items-center gap-1.5">
                              <span className="w-3 shrink-0" />
                              <Link
                                href={canvasHref(`/accounts/portfolio?account=${acct?.account_number ?? ""}`)}
                                onClick={(e) => e.stopPropagation()}
                                className="font-mono text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white hover:underline"
                              >
                                {acct?.account_number ?? "—"}
                              </Link>
                            </span>
                          </td>
                          <td className={`${PAD} py-2.5 text-black/40 dark:text-white/40 max-w-[120px] lg:max-w-[220px] truncate`}>
                            {acct?.account_name ?? "—"}
                          </td>
                          <td className={`${PAD} py-2.5 text-right text-black/40 dark:text-white/40 hidden sm:table-cell`}>
                            —
                          </td>
                          <td className={`${PAD} py-2.5 text-right text-black/50 dark:text-white/50 hidden md:table-cell tabular-nums`}>
                            {qty(sub.quantity)}
                          </td>
                          <td className={`${PAD} py-2.5 text-right text-black/50 dark:text-white/50 hidden lg:table-cell tabular-nums`}>
                            {subAvg !== null ? money2(subAvg) : <Dash />}
                          </td>
                          <td
                            className={`${PAD} py-2.5 text-right text-black/70 dark:text-white/70 tabular-nums`}
                            title={money0(sub.market_value)}
                          >
                            {moneyCompact(sub.market_value)}
                          </td>
                          <td
                            className={`${PAD} py-2.5 text-right text-black/50 dark:text-white/50 hidden lg:table-cell tabular-nums`}
                            title={sub.cost_basis !== null ? money0(sub.cost_basis) : undefined}
                          >
                            {sub.cost_basis !== null ? moneyCompact(sub.cost_basis) : <Dash />}
                          </td>
                          <td className={`${PAD} py-2.5 text-right tabular-nums`}>
                            {subGl === null ? (
                              <Dash />
                            ) : (
                              <span
                                className={
                                  subGl >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-[#FF2D2D]"
                                }
                              >
                                {subGl >= 0 ? "+" : "−"}
                                {subGlPct !== null ? pctStr(subGlPct) : ""}
                              </span>
                            )}
                          </td>
                          <td className={`${PAD} py-2.5 text-right tabular-nums`}>
                            {sub.day_change === 0 ? (
                              <Dash />
                            ) : (
                              <span
                                className={
                                  sub.day_change >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-[#FF2D2D]"
                                }
                              >
                                {sub.day_change >= 0 ? "+" : "−"}
                                {pctStr(sub.day_change_pct)}
                              </span>
                            )}
                          </td>
                          <td className={`${PAD_R} py-2.5 text-right text-black/40 dark:text-white/40 tabular-nums`}>
                            {subShare.toFixed(1)}%
                          </td>
                        </tr>
                      );
                    })}
              </Fragment>
            );
          })}
        </tbody>
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
      className={`py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wide whitespace-nowrap cursor-pointer select-none ${className ?? ""}`}
    >
      {children}
    </th>
  );
}

function Dash() {
  return <span className="text-black/30 dark:text-white/30">—</span>;
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

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  );
}
