"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useCanvasHref } from "@/lib/useCanvasHref";
import { formatCurrency, formatLabel } from "@/lib/format-utils";
import { type SalesCreditRow, CREDIT_TYPE_LABELS } from "./types";
import { ChevronUpIcon, ChevronDownIcon } from "./icons";
import TablePagination from "./TablePagination";

type SortKey = "account" | "credit_type" | "source" | "period" | "assets_basis" | "credit_rate" | "credit_amount";
type SortDirection = "asc" | "desc";

const ITEMS_PER_PAGE = 50;

const formatPrecise = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

export default function SalesCreditsTable({
  rows,
  exportRef,
}: {
  rows: SalesCreditRow[];
  exportRef?: { current: SalesCreditRow[] };
}) {
  const canvasHref = useCanvasHref();
  const [sortKey, setSortKey] = useState<SortKey>("credit_amount");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setCurrentPage(1);
  }, [rows]);

  const sortedRows = useMemo(() => {
    const dir = sortDirection === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case "account": return dir * a.account_number.localeCompare(b.account_number);
        case "credit_type": return dir * a.credit_type.localeCompare(b.credit_type);
        case "source": return dir * a.source.localeCompare(b.source);
        case "period": return dir * a.period_start.localeCompare(b.period_start);
        case "assets_basis": return dir * (a.assets_basis - b.assets_basis);
        case "credit_rate": return dir * (a.credit_rate - b.credit_rate);
        case "credit_amount": return dir * (a.credit_amount - b.credit_amount);
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
    const basis = rows.reduce((sum, r) => sum + r.assets_basis, 0);
    const credit = rows.reduce((sum, r) => sum + r.credit_amount, 0);
    const received = rows.filter((r) => r.status === "received").reduce((sum, r) => sum + r.credit_amount, 0);
    return { basis, credit, received };
  }, [rows]);

  const paginatedRows = sortedRows.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  return (
    <>
      <table className="w-full text-sm mt-4">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-black/5 dark:border-white/5 bg-[#f2f2f2] dark:bg-[#0a0a0a] medium:bg-[#bcbcbc]">
            <th
              onClick={() => handleSort("account")}
              className="text-left px-6 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
            >
              Account <SortIcon column="account" />
            </th>
            <th
              onClick={() => handleSort("credit_type")}
              className="text-left px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
            >
              Type <SortIcon column="credit_type" />
            </th>
            <th
              onClick={() => handleSort("source")}
              className="text-left px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
            >
              Source <SortIcon column="source" />
            </th>
            <th className="text-left px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider">
              Fund
            </th>
            <th
              onClick={() => handleSort("period")}
              className="text-left px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
            >
              Period <SortIcon column="period" />
            </th>
            <th
              onClick={() => handleSort("assets_basis")}
              className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
            >
              Assets Basis <SortIcon column="assets_basis" />
            </th>
            <th
              onClick={() => handleSort("credit_rate")}
              className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
            >
              Rate <SortIcon column="credit_rate" />
            </th>
            <th
              onClick={() => handleSort("credit_amount")}
              className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
            >
              Credit <SortIcon column="credit_amount" />
            </th>
            <th className="text-left px-6 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {paginatedRows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-black/5 dark:border-white/5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
            >
              <td className="px-6 py-4">
                <Link
                  href={canvasHref(`/accounts/portfolio?account=${row.account_number}`)}
                  className="font-semibold text-black dark:text-white cursor-pointer"
                >
                  {row.account_number}
                </Link>
              </td>
              <td className="px-4 py-4 text-black dark:text-white">
                {CREDIT_TYPE_LABELS[row.credit_type] ?? formatLabel(row.credit_type)}
              </td>
              <td className="px-4 py-4 text-black/50 dark:text-white/50">{row.source}</td>
              <td className="px-4 py-4 text-black/50 dark:text-white/50">{row.fund_symbol ?? "—"}</td>
              <td className="px-4 py-4 text-black/50 dark:text-white/50 whitespace-nowrap">{row.period}</td>
              <td className="px-4 py-4 text-right text-black/50 dark:text-white/50">
                {formatCurrency(row.assets_basis)}
              </td>
              <td className="px-4 py-4 text-right text-black/50 dark:text-white/50 whitespace-nowrap">
                {Math.round(row.credit_rate * 10000)} bps
              </td>
              <td className="px-4 py-4 text-right font-semibold text-black dark:text-white">
                {formatPrecise(row.credit_amount)}
              </td>
              <td
                className={`px-6 py-4 text-xs font-medium ${
                  row.status === "received"
                    ? "text-emerald-600 dark:text-emerald-500"
                    : "text-black/40 dark:text-white/40"
                }`}
              >
                {formatLabel(row.status)}
              </td>
            </tr>
          ))}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="border-t border-black/10 dark:border-white/10">
              <td colSpan={5} className="px-6 py-4 font-semibold text-black dark:text-white">
                Total ({rows.length.toLocaleString()} credits) ·{" "}
                <span className="text-emerald-600 dark:text-emerald-500">{formatPrecise(totals.received)} received</span>
              </td>
              <td className="px-4 py-4 text-right font-semibold text-black dark:text-white">
                {formatCurrency(totals.basis)}
              </td>
              <td className="px-4 py-4" />
              <td className="px-4 py-4 text-right font-semibold text-black dark:text-white">
                {formatPrecise(totals.credit)}
              </td>
              <td className="px-6 py-4" />
            </tr>
          </tfoot>
        )}
      </table>

      {rows.length === 0 && (
        <div className="py-12 text-center text-black/40 dark:text-white/40 text-sm">No sales credits found</div>
      )}

      <TablePagination total={sortedRows.length} page={currentPage} pageSize={ITEMS_PER_PAGE} onPageChange={setCurrentPage} />
    </>
  );
}
