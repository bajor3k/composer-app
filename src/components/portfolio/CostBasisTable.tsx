"use client";

import { useState, useMemo } from "react";
import { type Holding } from "./types";
import TableSummaryStrip from "./TableSummaryStrip";

type SortKey = "symbol" | "name" | "quantity" | "price" | "cost_basis" | "market_value" | "gain_loss" | "gain_loss_pct";
type SortDirection = "asc" | "desc";

export default function CostBasisTable({ holdings }: { holdings: Holding[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("cost_basis");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    const sign = value >= 0 ? "+" : "";
    return `${sign}${value.toFixed(2)}%`;
  };

  const formatQuantity = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const totalCostBasis = useMemo(
    () => holdings.reduce((sum, h) => sum + (h.cost_basis ?? 0), 0),
    [holdings]
  );
  const totalMarketValue = useMemo(
    () => holdings.reduce((sum, h) => sum + h.market_value, 0),
    [holdings]
  );
  const totalGainLoss = totalMarketValue - totalCostBasis;
  const totalGainLossPct = totalCostBasis > 0 ? (totalGainLoss / totalCostBasis) * 100 : 0;

  const sorted = useMemo(() => {
    return [...holdings].sort((a, b) => {
      let aVal: number;
      let bVal: number;
      switch (sortKey) {
        case "symbol":
          return sortDirection === "asc"
            ? a.symbol.localeCompare(b.symbol)
            : b.symbol.localeCompare(a.symbol);
        case "name":
          return sortDirection === "asc"
            ? a.name.localeCompare(b.name)
            : b.name.localeCompare(a.name);
        case "quantity":
          aVal = a.quantity;
          bVal = b.quantity;
          break;
        case "price":
          aVal = a.price;
          bVal = b.price;
          break;
        case "cost_basis":
          aVal = a.cost_basis && a.quantity > 0 ? a.cost_basis / a.quantity : 0;
          bVal = b.cost_basis && b.quantity > 0 ? b.cost_basis / b.quantity : 0;
          break;
        case "market_value":
          aVal = a.market_value;
          bVal = b.market_value;
          break;
        case "gain_loss":
          aVal = a.cost_basis ? a.market_value - a.cost_basis : 0;
          bVal = b.cost_basis ? b.market_value - b.cost_basis : 0;
          break;
        case "gain_loss_pct":
          aVal = a.cost_basis && a.cost_basis > 0 ? ((a.market_value - a.cost_basis) / a.cost_basis) * 100 : 0;
          bVal = b.cost_basis && b.cost_basis > 0 ? ((b.market_value - b.cost_basis) / b.cost_basis) * 100 : 0;
          break;
        default:
          return 0;
      }
      return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
    });
  }, [holdings, sortKey, sortDirection]);

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
      <svg className="w-3 h-3 inline ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
      </svg>
    ) : (
      <svg className="w-3 h-3 inline ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
      </svg>
    );
  };

  return (
    <div>
      {/* Summary strip — same four numbers as the old cards */}
      <TableSummaryStrip
        items={[
          { label: "Total Cost Basis", value: formatCurrency(totalCostBasis) },
          { label: "Market Value", value: formatCurrency(totalMarketValue) },
          { label: "Total Gain/Loss", value: formatCurrency(totalGainLoss), tone: "signed", raw: totalGainLoss },
          { label: "Return on Cost", value: formatPercent(totalGainLossPct), tone: "signed", raw: totalGainLossPct },
        ]}
      />

      {/* Table */}
      <div className="-mx-6">
        <table className="w-full text-sm min-w-full">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-black/5 dark:border-white/5 bg-[#f2f2f2] dark:bg-[#0a0a0a] medium:bg-[#bcbcbc]">
              <th onClick={() => handleSort("symbol")} className="text-left px-6 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white">
                Symbol <SortIcon column="symbol" />
              </th>
              <th onClick={() => handleSort("name")} className="text-left px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white">
                Name <SortIcon column="name" />
              </th>
              <th onClick={() => handleSort("quantity")} className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white">
                Qty <SortIcon column="quantity" />
              </th>
              <th onClick={() => handleSort("price")} className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white">
                Price <SortIcon column="price" />
              </th>
              <th onClick={() => handleSort("cost_basis")} className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white">
                Avg Cost <SortIcon column="cost_basis" />
              </th>
              <th onClick={() => handleSort("market_value")} className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white">
                Market Value <SortIcon column="market_value" />
              </th>
              <th onClick={() => handleSort("gain_loss")} className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white">
                Gain/Loss <SortIcon column="gain_loss" />
              </th>
              <th onClick={() => handleSort("gain_loss_pct")} className="text-right px-6 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white">
                G/L % <SortIcon column="gain_loss_pct" />
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((h) => {
              const gainLoss = h.cost_basis !== null ? h.market_value - h.cost_basis : null;
              const gainLossPct = h.cost_basis && h.cost_basis > 0 ? ((h.market_value - h.cost_basis) / h.cost_basis) * 100 : null;
              return (
                <tr
                  key={h.id}
                  className="border-b border-black/5 dark:border-white/5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
                >
                  <td className="px-6 py-3.5">
                    <span className="font-semibold text-black dark:text-white">{h.symbol}</span>
                  </td>
                  <td className="px-4 py-3.5 text-black/50 dark:text-white/50 max-w-[200px] truncate">
                    {h.name}
                  </td>
                  <td className="px-4 py-3.5 text-right text-black/70 dark:text-white/70">
                    {formatQuantity(h.quantity)}
                  </td>
                  <td className="px-4 py-3.5 text-right text-black/70 dark:text-white/70">
                    {formatCurrency(h.price)}
                  </td>
                  <td className="px-4 py-3.5 text-right font-medium text-black dark:text-white">
                    {h.cost_basis !== null && h.quantity > 0 ? formatCurrency(h.cost_basis / h.quantity) : <span className="text-black/30 dark:text-white/30">-</span>}
                  </td>
                  <td className="px-4 py-3.5 text-right text-black/70 dark:text-white/70">
                    {formatCurrency(h.market_value)}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    {gainLoss !== null ? (
                      <span className={`font-medium ${gainLoss >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-[#FF2D2D]"}`}>
                        {formatCurrency(gainLoss)}
                      </span>
                    ) : (
                      <span className="text-black/30 dark:text-white/30">-</span>
                    )}
                  </td>
                  <td className="px-6 py-3.5 text-right">
                    {gainLossPct !== null ? (
                      <span className={`font-medium ${gainLossPct >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-[#FF2D2D]"}`}>
                        {formatPercent(gainLossPct)}
                      </span>
                    ) : (
                      <span className="text-black/30 dark:text-white/30">-</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {sorted.length > 0 && (
            <tfoot>
              <tr className="border-t border-black/10 dark:border-white/10">
                <td className="px-6 py-3.5 font-semibold text-black dark:text-white" colSpan={4}>
                  Total
                </td>
                <td className="px-4 py-3.5 text-right text-black/30 dark:text-white/30">
                  —
                </td>
                <td className="px-4 py-3.5 text-right font-semibold text-black dark:text-white">
                  {formatCurrency(totalMarketValue)}
                </td>
                <td className="px-4 py-3.5 text-right">
                  <span className={`font-semibold ${totalGainLoss >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-[#FF2D2D]"}`}>
                    {formatCurrency(totalGainLoss)}
                  </span>
                </td>
                <td className="px-6 py-3.5 text-right">
                  <span className={`font-semibold ${totalGainLossPct >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-[#FF2D2D]"}`}>
                    {formatPercent(totalGainLossPct)}
                  </span>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {sorted.length === 0 && (
        <div className="py-8 text-center text-black/40 dark:text-white/40 text-sm">
          No holdings found
        </div>
      )}
    </div>
  );
}
