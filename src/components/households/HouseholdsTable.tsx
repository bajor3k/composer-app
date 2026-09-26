"use client";

import { useState, useMemo, useEffect, Fragment } from "react";
import Link from "next/link";
import { type HouseholdSummary } from "./types";

type SortKey = "name" | "firm_name" | "total_cash" | "total_aum" | "account_count";
type SortDirection = "asc" | "desc";

const ITEMS_PER_PAGE = 50;

// Compact notation keeps the money columns narrow so the table fits the drawer card without a
// sideways scroll; the exact figure is on hover (title=) and in the page's summary bar.
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

// Shared cell padding — tight so all columns fit the narrow card, loosening as it widens.
const PAD = "px-2 lg:px-3";
const PAD_L = "pl-3 lg:pl-4 pr-2";
const PAD_R = "pr-3 lg:pr-4 pl-2";

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  individual: "Individual",
  joint: "Joint",
  ira: "Traditional IRA",
  roth_ira: "Roth IRA",
  trust: "Trust",
  "401k": "401(k)",
};
function formatAccountType(type: string) {
  return ACCOUNT_TYPE_LABELS[type] || type;
}

/**
 * Firm-wide households table: one row per household, aggregated from its member accounts.
 * Rows expand to reveal the per-account breakdown. Columns reveal progressively as the
 * card/viewport widens (Tailwind breakpoints track the iframe width in canvas mode), so the
 * table never scrolls sideways inside the drawer card.
 */
export default function HouseholdsTable({
  rows,
  canvasHref,
}: {
  rows: HouseholdSummary[];
  canvasHref: (href: string) => string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("total_aum");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  // Search / filter changes upstream produce a new rows array — restart at page one.
  useEffect(() => {
    setCurrentPage(1);
  }, [rows]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      if (sortKey === "name") {
        return sortDirection === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      }
      if (sortKey === "firm_name") {
        const af = a.firm_name ?? "";
        const bf = b.firm_name ?? "";
        return sortDirection === "asc" ? af.localeCompare(bf) : bf.localeCompare(af);
      }
      const aVal = a[sortKey];
      const bVal = b[sortKey];
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
      setSortDirection(key === "name" || key === "firm_name" ? "asc" : "desc");
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
      <div className="py-12 text-center text-black/40 dark:text-white/40 text-sm">No households found</div>
    );
  }

  return (
    <>
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-black/5 dark:border-white/5 bg-[#f2f2f2] dark:bg-[#0a0a0a] medium:bg-[#bcbcbc]">
            <Th onClick={() => handleSort("name")} className={`text-left ${PAD_L}`}>
              Household <SortIcon column="name" />
            </Th>
            <Th onClick={() => handleSort("firm_name")} className={`text-left ${PAD} hidden md:table-cell`}>
              Firm <SortIcon column="firm_name" />
            </Th>
            <Th onClick={() => handleSort("total_cash")} className={`text-right ${PAD} hidden sm:table-cell`}>
              Total Cash <SortIcon column="total_cash" />
            </Th>
            <Th onClick={() => handleSort("total_aum")} className={`text-right ${PAD}`}>
              Total AUM <SortIcon column="total_aum" />
            </Th>
            <Th onClick={() => handleSort("account_count")} className={`text-right ${PAD_R}`}>
              Accts <SortIcon column="account_count" />
            </Th>
          </tr>
        </thead>
        <tbody>
          {pagedRows.map((h) => {
            const isExpanded = expandedId === h.id;
            return (
              <Fragment key={h.id}>
                <tr
                  onClick={() => setExpandedId(isExpanded ? null : h.id)}
                  className="border-b border-black/5 dark:border-white/5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer"
                >
                  <td className={`${PAD_L} py-3.5`}>
                    <span className="inline-flex items-center gap-1.5">
                      <ChevronRightIcon
                        className={`w-3 h-3 shrink-0 text-black/30 dark:text-white/30 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                      />
                      <span className="font-semibold text-black dark:text-white truncate max-w-[150px] lg:max-w-[280px]">
                        {h.name}
                      </span>
                    </span>
                  </td>
                  <td className={`${PAD} py-3.5 text-black/50 dark:text-white/50 hidden md:table-cell max-w-[160px] truncate`}>
                    {h.firm_name || <Dash />}
                  </td>
                  <td
                    className={`${PAD} py-3.5 text-right text-black/50 dark:text-white/50 hidden sm:table-cell tabular-nums`}
                    title={money0(h.total_cash)}
                  >
                    {moneyCompact(h.total_cash)}
                  </td>
                  <td
                    className={`${PAD} py-3.5 text-right font-medium text-black dark:text-white tabular-nums`}
                    title={money0(h.total_aum)}
                  >
                    {moneyCompact(h.total_aum)}
                  </td>
                  <td className={`${PAD_R} py-3.5 text-right text-black/50 dark:text-white/50 tabular-nums`}>
                    {h.account_count.toLocaleString()}
                  </td>
                </tr>

                {isExpanded && (
                  <tr className="border-b border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02]">
                    <td colSpan={5} className="p-0">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-black/5 dark:border-white/5 text-black/40 dark:text-white/40">
                            <th className={`${PAD_L} py-2 text-left font-medium uppercase tracking-wide whitespace-nowrap`}>
                              Account #
                            </th>
                            <th className={`${PAD} py-2 text-left font-medium uppercase tracking-wide whitespace-nowrap`}>
                              Owner
                            </th>
                            <th className={`${PAD} py-2 text-left font-medium uppercase tracking-wide whitespace-nowrap hidden md:table-cell`}>
                              Type
                            </th>
                            <th className={`${PAD} py-2 text-left font-medium uppercase tracking-wide whitespace-nowrap hidden lg:table-cell`}>
                              Custodian
                            </th>
                            <th className={`${PAD} py-2 text-left font-medium uppercase tracking-wide whitespace-nowrap hidden lg:table-cell`}>
                              Rep
                            </th>
                            <th className={`${PAD} py-2 text-right font-medium uppercase tracking-wide whitespace-nowrap`}>
                              Value
                            </th>
                            <th className={`${PAD_R} py-2 text-right font-medium uppercase tracking-wide whitespace-nowrap hidden sm:table-cell`}>
                              Cash
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {h.members.map((m) => (
                            <tr
                              key={m.id}
                              className="border-b border-black/5 dark:border-white/5 last:border-b-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                            >
                              <td className={`${PAD_L} py-2.5`}>
                                <Link
                                  href={canvasHref(`/accounts/portfolio?account=${m.account_number}`)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="font-mono text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white hover:underline"
                                >
                                  {m.account_number}
                                </Link>
                              </td>
                              <td className={`${PAD} py-2.5 text-black/60 dark:text-white/60 max-w-[140px] lg:max-w-[220px] truncate`}>
                                {m.client_name || m.account_name || "—"}
                              </td>
                              <td className={`${PAD} py-2.5 text-black/50 dark:text-white/50 hidden md:table-cell whitespace-nowrap`}>
                                {formatAccountType(m.account_type)}
                              </td>
                              <td className={`${PAD} py-2.5 text-black/50 dark:text-white/50 hidden lg:table-cell whitespace-nowrap`}>
                                {m.custodian}
                              </td>
                              <td className={`${PAD} py-2.5 text-black/50 dark:text-white/50 hidden lg:table-cell whitespace-nowrap`}>
                                {m.rep_code || <Dash />}
                              </td>
                              <td
                                className={`${PAD} py-2.5 text-right text-black/70 dark:text-white/70 tabular-nums`}
                                title={money0(m.total_value)}
                              >
                                {moneyCompact(m.total_value)}
                              </td>
                              <td
                                className={`${PAD_R} py-2.5 text-right text-black/50 dark:text-white/50 hidden sm:table-cell tabular-nums`}
                                title={money0(m.cash_balance)}
                              >
                                {moneyCompact(m.cash_balance)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
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
