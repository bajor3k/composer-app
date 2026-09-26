"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useCanvasHref } from "@/lib/useCanvasHref";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { type CommissionRow } from "./types";
import { ChevronUpIcon, ChevronDownIcon } from "./icons";
import TablePagination from "./TablePagination";

type SortKey = "account" | "symbol" | "side" | "quantity" | "gross_amount" | "total_commission" | "trade_date";
type SortDirection = "asc" | "desc";

const ITEMS_PER_PAGE = 50;

const formatPrecise = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

export default function CommissionsTable({
  rows,
  exportRef,
}: {
  rows: CommissionRow[];
  exportRef?: { current: CommissionRow[] };
}) {
  const canvasHref = useCanvasHref();
  const [sortKey, setSortKey] = useState<SortKey>("trade_date");
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
        case "symbol": return dir * a.symbol.localeCompare(b.symbol);
        case "side": return dir * a.side.localeCompare(b.side);
        case "quantity": return dir * (a.quantity - b.quantity);
        case "gross_amount": return dir * (a.gross_amount - b.gross_amount);
        case "total_commission": return dir * (a.total_commission - b.total_commission);
        case "trade_date": return dir * a.trade_date.localeCompare(b.trade_date);
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
    const gross = rows.reduce((sum, r) => sum + r.gross_amount, 0);
    const commission = rows.reduce((sum, r) => sum + r.total_commission, 0);
    return { gross, commission };
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
              onClick={() => handleSort("symbol")}
              className="text-left px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
            >
              Security <SortIcon column="symbol" />
            </th>
            <th
              onClick={() => handleSort("side")}
              className="text-left px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
            >
              Side <SortIcon column="side" />
            </th>
            <th
              onClick={() => handleSort("quantity")}
              className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
            >
              Qty <SortIcon column="quantity" />
            </th>
            <th className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider">
              Price
            </th>
            <th
              onClick={() => handleSort("gross_amount")}
              className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
            >
              Gross <SortIcon column="gross_amount" />
            </th>
            <th
              onClick={() => handleSort("total_commission")}
              className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
            >
              Commission <SortIcon column="total_commission" />
            </th>
            <th
              onClick={() => handleSort("trade_date")}
              className="text-right px-6 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
            >
              Trade Date <SortIcon column="trade_date" />
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
              <td className="px-4 py-4">
                <div className="font-medium text-black dark:text-white">{row.symbol}</div>
                <div className="text-xs text-black/40 dark:text-white/40 max-w-[220px] truncate">
                  {row.security_name}
                </div>
              </td>
              <td className="px-4 py-4">
                <span
                  className={`text-xs font-semibold uppercase tracking-wider ${
                    row.side === "buy" ? "text-emerald-600 dark:text-emerald-500" : "text-[#FF2D2D]"
                  }`}
                >
                  {row.side}
                </span>
              </td>
              <td className="px-4 py-4 text-right text-black/50 dark:text-white/50">
                {row.quantity.toLocaleString()}
              </td>
              <td className="px-4 py-4 text-right text-black/50 dark:text-white/50">{formatPrecise(row.price)}</td>
              <td className="px-4 py-4 text-right text-black dark:text-white">{formatCurrency(row.gross_amount)}</td>
              <td className="px-4 py-4 text-right font-semibold text-black dark:text-white">
                {formatPrecise(row.total_commission)}
              </td>
              <td className="px-6 py-4 text-right text-black/50 dark:text-white/50 whitespace-nowrap">
                {formatDate(row.trade_date)}
              </td>
            </tr>
          ))}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="border-t border-black/10 dark:border-white/10">
              <td colSpan={5} className="px-6 py-4 font-semibold text-black dark:text-white">
                Total ({rows.length.toLocaleString()} trades)
              </td>
              <td className="px-4 py-4 text-right font-semibold text-black dark:text-white">
                {formatCurrency(totals.gross)}
              </td>
              <td className="px-4 py-4 text-right font-semibold text-black dark:text-white">
                {formatPrecise(totals.commission)}
              </td>
              <td className="px-6 py-4" />
            </tr>
          </tfoot>
        )}
      </table>

      {rows.length === 0 && (
        <div className="py-12 text-center text-black/40 dark:text-white/40 text-sm">No commissions found</div>
      )}

      <TablePagination total={sortedRows.length} page={currentPage} pageSize={ITEMS_PER_PAGE} onPageChange={setCurrentPage} />
    </>
  );
}
