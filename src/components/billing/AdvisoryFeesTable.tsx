"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useCanvasHref } from "@/lib/useCanvasHref";
import { formatCurrency } from "@/lib/format-utils";
import { type AdvisoryFeeRow } from "./types";
import { ChevronUpIcon, ChevronDownIcon } from "./icons";
import TablePagination from "./TablePagination";

type SortKey = "account" | "household" | "rep_code" | "custodian" | "cash_balance" | "aum" | "fee_rate" | "fee_amount";
type SortDirection = "asc" | "desc";

const ITEMS_PER_PAGE = 50;

const formatFee = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

export default function AdvisoryFeesTable({
  rows,
  exportRef,
}: {
  rows: AdvisoryFeeRow[];
  exportRef?: { current: AdvisoryFeeRow[] };
}) {
  const canvasHref = useCanvasHref();
  const [sortKey, setSortKey] = useState<SortKey>("fee_amount");
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
        case "household": return dir * a.household_name.localeCompare(b.household_name);
        case "rep_code": return dir * a.rep_code.localeCompare(b.rep_code);
        case "custodian": return dir * a.custodian.localeCompare(b.custodian);
        case "cash_balance": return dir * (a.cash_balance - b.cash_balance);
        case "aum": return dir * (a.aum - b.aum);
        case "fee_rate": return dir * (a.fee_rate - b.fee_rate);
        case "fee_amount": return dir * (a.fee_amount - b.fee_amount);
      }
    });
  }, [rows, sortKey, sortDirection]);

  // Expose the current sorted order so the page-level Export CSV button
  // downloads exactly what the user sees.
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
    const cash = rows.reduce((sum, r) => sum + r.cash_balance, 0);
    const aum = rows.reduce((sum, r) => sum + r.aum, 0);
    const fees = rows.reduce((sum, r) => sum + r.fee_amount, 0);
    // Blended annualized rate: fee_amount is period-prorated, so derive from Σ(aum × rate)
    const annual = rows.reduce((sum, r) => sum + r.aum * r.fee_rate, 0);
    const blendedRatePct = aum > 0 ? (annual / aum) * 100 : 0;
    return { cash, aum, fees, blendedRatePct };
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
              onClick={() => handleSort("household")}
              className="text-left px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
            >
              Household <SortIcon column="household" />
            </th>
            <th
              onClick={() => handleSort("rep_code")}
              className="text-left px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
            >
              Rep Code <SortIcon column="rep_code" />
            </th>
            <th
              onClick={() => handleSort("custodian")}
              className="text-left px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
            >
              Custodian <SortIcon column="custodian" />
            </th>
            <th
              onClick={() => handleSort("cash_balance")}
              className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
            >
              Cash <SortIcon column="cash_balance" />
            </th>
            <th
              onClick={() => handleSort("aum")}
              className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
            >
              AUM <SortIcon column="aum" />
            </th>
            <th
              onClick={() => handleSort("fee_rate")}
              className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
            >
              Rate <SortIcon column="fee_rate" />
            </th>
            <th
              onClick={() => handleSort("fee_amount")}
              className="text-right px-6 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
            >
              Fee <SortIcon column="fee_amount" />
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
              <td className="px-4 py-4 text-black/50 dark:text-white/50">{row.household_name}</td>
              <td className="px-4 py-4 text-black/50 dark:text-white/50">{row.rep_code}</td>
              <td className="px-4 py-4 text-black/50 dark:text-white/50">{row.custodian}</td>
              <td className={`px-4 py-4 text-right ${row.cash_balance < 0 ? "text-[#FF2D2D]" : "text-black/50 dark:text-white/50"}`}>
                {formatCurrency(row.cash_balance)}
              </td>
              <td className="px-4 py-4 text-right text-black dark:text-white">{formatCurrency(row.aum)}</td>
              <td className="px-4 py-4 text-right text-black/50 dark:text-white/50">
                {(row.fee_rate * 100).toFixed(2)}%
              </td>
              <td className="px-6 py-4 text-right font-semibold text-black dark:text-white">
                {formatFee(row.fee_amount)}
              </td>
            </tr>
          ))}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="border-t border-black/10 dark:border-white/10">
              <td colSpan={4} className="px-6 py-4 font-semibold text-black dark:text-white">
                Total ({rows.length.toLocaleString()} accounts)
              </td>
              <td className="px-4 py-4 text-right font-semibold text-black dark:text-white">
                {formatCurrency(totals.cash)}
              </td>
              <td className="px-4 py-4 text-right font-semibold text-black dark:text-white">
                {formatCurrency(totals.aum)}
              </td>
              <td className="px-4 py-4 text-right font-semibold text-black dark:text-white">
                {totals.blendedRatePct.toFixed(2)}%
              </td>
              <td className="px-6 py-4 text-right font-semibold text-black dark:text-white">
                {formatFee(totals.fees)}
              </td>
            </tr>
          </tfoot>
        )}
      </table>

      {rows.length === 0 && (
        <div className="py-12 text-center text-black/40 dark:text-white/40 text-sm">No advisory fees found</div>
      )}

      <TablePagination total={sortedRows.length} page={currentPage} pageSize={ITEMS_PER_PAGE} onPageChange={setCurrentPage} />
    </>
  );
}
