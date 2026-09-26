"use client";

import { useState, useMemo, useEffect } from "react";
import { formatCurrency, formatDate, formatLabel } from "@/lib/format-utils";
import { type OutsideBusinessRow } from "./types";
import { ChevronUpIcon, ChevronDownIcon } from "./icons";
import TablePagination from "./TablePagination";

type SortKey = "activity_type" | "gross_income" | "net_income" | "date_received";
type SortDirection = "asc" | "desc";

const ITEMS_PER_PAGE = 50;

export default function OutsideBusinessTable({
  rows,
  exportRef,
}: {
  rows: OutsideBusinessRow[];
  exportRef?: { current: OutsideBusinessRow[] };
}) {
  const [sortKey, setSortKey] = useState<SortKey>("date_received");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setCurrentPage(1);
  }, [rows]);

  const sortedRows = useMemo(() => {
    const dir = sortDirection === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case "activity_type": return dir * a.activity_type.localeCompare(b.activity_type);
        case "gross_income": return dir * (a.gross_income - b.gross_income);
        case "net_income": return dir * (a.net_income - b.net_income);
        case "date_received": return dir * a.date_received.localeCompare(b.date_received);
      }
    });
  }, [rows, sortKey, sortDirection]);

  useEffect(() => {
    if (exportRef) exportRef.current = sortedRows;
  }, [sortedRows, exportRef]);

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

  const totals = useMemo(() => {
    const gross = rows.reduce((sum, r) => sum + r.gross_income, 0);
    const expenses = rows.reduce((sum, r) => sum + r.expenses, 0);
    const net = rows.reduce((sum, r) => sum + r.net_income, 0);
    return { gross, expenses, net };
  }, [rows]);

  const paginatedRows = sortedRows.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  return (
    <>
      <table className="w-full text-sm mt-4">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-black/5 dark:border-white/5 bg-[#f2f2f2] dark:bg-[#0a0a0a] medium:bg-[#bcbcbc]">
            <th
              onClick={() => handleSort("activity_type")}
              className="text-left px-6 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
            >
              Type <SortIcon column="activity_type" />
            </th>
            <th className="text-left px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider">
              Description
            </th>
            <th className="text-left px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider">
              Client
            </th>
            <th className="text-left px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider">
              Income Type
            </th>
            <th
              onClick={() => handleSort("gross_income")}
              className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
            >
              Gross <SortIcon column="gross_income" />
            </th>
            <th className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider">
              Expenses
            </th>
            <th
              onClick={() => handleSort("net_income")}
              className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
            >
              Net <SortIcon column="net_income" />
            </th>
            <th
              onClick={() => handleSort("date_received")}
              className="text-right px-6 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
            >
              Date <SortIcon column="date_received" />
            </th>
          </tr>
        </thead>
        <tbody>
          {paginatedRows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-black/5 dark:border-white/5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
            >
              <td className="px-6 py-4 font-medium text-black dark:text-white whitespace-nowrap">
                {formatLabel(row.activity_type)}
              </td>
              <td className="px-4 py-4 text-black/70 dark:text-white/70">{row.description}</td>
              <td className="px-4 py-4 text-black/50 dark:text-white/50">{row.client_name ?? "—"}</td>
              <td className="px-4 py-4 text-black/50 dark:text-white/50">{formatLabel(row.income_type)}</td>
              <td className="px-4 py-4 text-right text-black dark:text-white">{formatCurrency(row.gross_income)}</td>
              <td className="px-4 py-4 text-right">
                {row.expenses > 0 ? (
                  <span className="text-[#FF2D2D]">-{formatCurrency(row.expenses)}</span>
                ) : (
                  <span className="text-black/30 dark:text-white/30">$0</span>
                )}
              </td>
              <td className="px-4 py-4 text-right font-semibold text-emerald-600 dark:text-emerald-500">
                {formatCurrency(row.net_income)}
              </td>
              <td className="px-6 py-4 text-right text-black/50 dark:text-white/50 whitespace-nowrap">
                {formatDate(row.date_received)}
              </td>
            </tr>
          ))}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="border-t border-black/10 dark:border-white/10">
              <td colSpan={4} className="px-6 py-4 font-semibold text-black dark:text-white">
                Total ({rows.length.toLocaleString()} activities)
              </td>
              <td className="px-4 py-4 text-right font-semibold text-black dark:text-white">
                {formatCurrency(totals.gross)}
              </td>
              <td className="px-4 py-4 text-right font-semibold text-[#FF2D2D]">
                -{formatCurrency(totals.expenses)}
              </td>
              <td className="px-4 py-4 text-right font-semibold text-emerald-600 dark:text-emerald-500">
                {formatCurrency(totals.net)}
              </td>
              <td className="px-6 py-4" />
            </tr>
          </tfoot>
        )}
      </table>

      {rows.length === 0 && (
        <div className="py-12 text-center text-black/40 dark:text-white/40 text-sm">
          No outside business activities found
        </div>
      )}

      <TablePagination total={sortedRows.length} page={currentPage} pageSize={ITEMS_PER_PAGE} onPageChange={setCurrentPage} />
    </>
  );
}
