"use client";

import { useState, useMemo, useEffect, Fragment } from "react";
import { formatDate } from "@/lib/format-utils";
import { type Transfer, TYPE_LABELS, STATUS_LABELS } from "./types";

type SortKey = "from" | "to" | "type" | "amount" | "status" | "initiated_at" | "completed_at";
type SortDirection = "asc" | "desc";

const ITEMS_PER_PAGE = 50;

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

/**
 * Transfers table: one row per transfer, sortable, each row expandable to reveal the full
 * from/to detail, reference/initiator metadata, notes, and the status-history timeline.
 * Columns reveal progressively as the card/viewport widens (Tailwind breakpoints track the
 * iframe width in canvas mode), so the table never scrolls sideways inside the drawer card.
 */
export default function TransfersTable({ rows }: { rows: Transfer[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("initiated_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setCurrentPage(1);
  }, [rows]);

  const sortedRows = useMemo(() => {
    const str = (t: Transfer, k: SortKey) => {
      switch (k) {
        case "from":
          return t.from_account_name ?? "";
        case "to":
          return t.to_account_name ?? "";
        case "type":
          return t.type ?? "";
        case "status":
          return t.status ?? "";
        default:
          return "";
      }
    };
    return [...rows].sort((a, b) => {
      if (sortKey === "amount") {
        const av = a.amount ?? 0;
        const bv = b.amount ?? 0;
        return sortDirection === "asc" ? av - bv : bv - av;
      }
      if (sortKey === "initiated_at" || sortKey === "completed_at") {
        const av = a[sortKey] ? new Date(a[sortKey] as string).getTime() : 0;
        const bv = b[sortKey] ? new Date(b[sortKey] as string).getTime() : 0;
        return sortDirection === "asc" ? av - bv : bv - av;
      }
      const cmp = str(a, sortKey).localeCompare(str(b, sortKey));
      return sortDirection === "asc" ? cmp : -cmp;
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
      setSortDirection(key === "from" || key === "to" || key === "type" || key === "status" ? "asc" : "desc");
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
      <div className="py-12 text-center text-black/40 dark:text-white/40 text-sm">No transfers found</div>
    );
  }

  return (
    <>
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-black/5 dark:border-white/5 bg-[#f2f2f2] dark:bg-[#0a0a0a] medium:bg-[#bcbcbc]">
            <Th onClick={() => handleSort("from")} className={`text-left ${PAD_L}`}>
              From <SortIcon column="from" />
            </Th>
            <Th onClick={() => handleSort("to")} className={`text-left ${PAD}`}>
              To <SortIcon column="to" />
            </Th>
            <Th onClick={() => handleSort("type")} className={`text-left ${PAD} hidden sm:table-cell`}>
              Type <SortIcon column="type" />
            </Th>
            <Th onClick={() => handleSort("amount")} className={`text-right ${PAD}`}>
              Amount <SortIcon column="amount" />
            </Th>
            <Th onClick={() => handleSort("status")} className={`text-left ${PAD}`}>
              Status <SortIcon column="status" />
            </Th>
            <Th onClick={() => handleSort("initiated_at")} className={`text-right ${PAD} hidden md:table-cell`}>
              Initiated <SortIcon column="initiated_at" />
            </Th>
            <Th onClick={() => handleSort("completed_at")} className={`text-right ${PAD_R} hidden lg:table-cell`}>
              Completed <SortIcon column="completed_at" />
            </Th>
          </tr>
        </thead>
        <tbody>
          {pagedRows.map((t) => {
            const isExpanded = expandedId === t.id;
            return (
              <Fragment key={t.id}>
                <tr
                  onClick={() => setExpandedId(isExpanded ? null : t.id)}
                  className="border-b border-black/5 dark:border-white/5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer"
                >
                  <td className={`${PAD_L} py-3`}>
                    <div className="flex items-center gap-1.5">
                      <ChevronRightIcon
                        className={`w-3 h-3 shrink-0 text-black/30 dark:text-white/30 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-black dark:text-white truncate max-w-[110px] lg:max-w-[200px]">
                          {t.from_account_name}
                        </div>
                        <div className="text-xs text-black/40 dark:text-white/40 truncate max-w-[110px] lg:max-w-[200px]">
                          {t.from_institution}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className={`${PAD} py-3`}>
                    <div className="min-w-0">
                      <div className="font-medium text-black dark:text-white truncate max-w-[110px] lg:max-w-[200px]">
                        {t.to_account_name}
                      </div>
                      <div className="text-xs text-black/40 dark:text-white/40 truncate max-w-[110px] lg:max-w-[200px]">
                        {t.to_institution}
                      </div>
                    </div>
                  </td>
                  <td className={`${PAD} py-3 hidden sm:table-cell`}>
                    <TypeBadge type={t.type} />
                  </td>
                  <td
                    className={`${PAD} py-3 text-right font-medium text-black dark:text-white tabular-nums`}
                    title={t.amount !== null ? money0(t.amount) : undefined}
                  >
                    {t.amount !== null ? moneyCompact(t.amount) : <Dash />}
                  </td>
                  <td className={`${PAD} py-3`}>
                    <StatusBadge status={t.status} />
                  </td>
                  <td className={`${PAD} py-3 text-right text-black/50 dark:text-white/50 hidden md:table-cell tabular-nums whitespace-nowrap`}>
                    {formatDate(t.initiated_at)}
                  </td>
                  <td className={`${PAD_R} py-3 text-right text-black/50 dark:text-white/50 hidden lg:table-cell tabular-nums whitespace-nowrap`}>
                    {t.completed_at ? formatDate(t.completed_at) : <Dash />}
                  </td>
                </tr>

                {isExpanded && (
                  <tr className="border-b border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02]">
                    <td colSpan={7} className="px-3 lg:px-4 py-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* From / To detail */}
                        <div className="space-y-3">
                          <PartyBlock label="From" name={t.from_account_name} number={t.from_account_number} institution={t.from_institution} />
                          <PartyBlock label="To" name={t.to_account_name} number={t.to_account_number} institution={t.to_institution} />
                        </div>

                        {/* Metadata */}
                        <div className="space-y-2 text-xs">
                          <Meta label="Reference" value={t.reference_number || "—"} mono />
                          <Meta label="Amount" value={t.amount !== null ? money0(t.amount) : "—"} />
                          <Meta label="Initiated by" value={t.initiated_by || "—"} />
                          <Meta label="Initiated" value={formatDate(t.initiated_at)} />
                          <Meta label="Completed" value={t.completed_at ? formatDate(t.completed_at) : "—"} />
                          {t.notes && <Meta label="Notes" value={t.notes} />}
                        </div>

                        {/* Status timeline */}
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40 mb-2">
                            Status History
                          </div>
                          {t.status_history.length === 0 ? (
                            <div className="text-xs text-black/40 dark:text-white/40">—</div>
                          ) : (
                            <ol className="space-y-2">
                              {[...t.status_history]
                                .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                                .map((ev, i) => (
                                  <li key={i} className="flex gap-2 text-xs">
                                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-black/25 dark:bg-white/25" />
                                    <div className="min-w-0">
                                      <div className="text-black/70 dark:text-white/70">
                                        {STATUS_LABELS[ev.status] || ev.status}
                                        <span className="text-black/30 dark:text-white/30">
                                          {" "}· {formatDate(ev.timestamp)}
                                        </span>
                                      </div>
                                      {ev.note && (
                                        <div className="text-black/40 dark:text-white/40 truncate">{ev.note}</div>
                                      )}
                                    </div>
                                  </li>
                                ))}
                            </ol>
                          )}
                        </div>
                      </div>
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

function TypeBadge({ type }: { type: Transfer["type"] }) {
  return <span className="font-medium text-black dark:text-white">{TYPE_LABELS[type] ?? type}</span>;
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="whitespace-nowrap text-black/70 dark:text-white/70">
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function PartyBlock({
  label,
  name,
  number,
  institution,
}: {
  label: string;
  name: string;
  number: string | null;
  institution: string;
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">
        {label}
      </div>
      <div className="text-sm font-medium text-black dark:text-white">{name}</div>
      <div className="text-xs text-black/50 dark:text-white/50">
        {number ? <span className="font-mono">{number}</span> : null}
        {number ? " · " : ""}
        {institution}
      </div>
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-black/40 dark:text-white/40">{label}</span>
      <span className={`text-right text-black/70 dark:text-white/70 ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
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
