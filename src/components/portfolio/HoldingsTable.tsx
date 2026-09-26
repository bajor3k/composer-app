"use client";

import { useState, useMemo, Fragment } from "react";
import { type Holding, type PortfolioAccount } from "./types";
import LiveValue from "@/components/market/LiveValue";

type SortKey = "symbol" | "name" | "quantity" | "price" | "avg_cost" | "market_value" | "cost_basis" | "day_change" | "day_change_pct" | "gain_loss" | "weight";
type SortDirection = "asc" | "desc";

export default function HoldingsTable({
  holdings,
  totalValue,
  onHoldingClick,
  selectedAssetClass,
  isHouseholdView,
  householdHoldings,
  householdAccounts,
}: {
  holdings: Holding[];
  totalValue: number;
  onHoldingClick?: (holding: Holding) => void;
  selectedAssetClass?: string | null;
  isHouseholdView?: boolean;
  householdHoldings?: Holding[];
  householdAccounts?: PortfolioAccount[];
}) {
  const [sortKey, setSortKey] = useState<SortKey>("market_value");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatPercent = (value: number, showSign = true) => {
    const sign = showSign && value >= 0 ? "+" : "";
    return `${sign}${value.toFixed(2)}%`;
  };

  const formatQuantity = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const sortedHoldings = useMemo(() => {
    return [...holdings].sort((a, b) => {
      // CASH always stays at the bottom
      if (a.symbol === "CASH" && b.symbol !== "CASH") return 1;
      if (b.symbol === "CASH" && a.symbol !== "CASH") return -1;

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
        case "avg_cost":
          aVal = a.cost_basis && a.quantity > 0 ? a.cost_basis / a.quantity : 0;
          bVal = b.cost_basis && b.quantity > 0 ? b.cost_basis / b.quantity : 0;
          break;
        case "market_value":
          aVal = a.market_value;
          bVal = b.market_value;
          break;
        case "cost_basis":
          aVal = a.cost_basis ?? 0;
          bVal = b.cost_basis ?? 0;
          break;
        case "day_change":
          aVal = a.day_change;
          bVal = b.day_change;
          break;
        case "day_change_pct":
          aVal = a.day_change_pct;
          bVal = b.day_change_pct;
          break;
        case "gain_loss":
          aVal = a.day_change;
          bVal = b.day_change;
          break;
        case "weight":
          aVal = totalValue > 0 ? (a.market_value / totalValue) * 100 : 0;
          bVal = totalValue > 0 ? (b.market_value / totalValue) * 100 : 0;
          break;
        default:
          return 0;
      }

      return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
    });
  }, [holdings, sortKey, sortDirection, totalValue]);

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

  return (
    <div>
      {/* Table — no overflow-x wrapper so the sticky header anchors to the page scroll
          container (an overflow-x container would also scroll vertically and trap it). */}
      <div className="-mx-6">
        <table className="w-full text-sm min-w-full" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "7%" }} />
            <col />
            <col style={{ width: "9%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "7%" }} />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-black/5 dark:border-white/5 bg-[#f2f2f2] dark:bg-[#0a0a0a] medium:bg-[#bcbcbc]">
              <th
                onClick={() => handleSort("symbol")}
                className="text-left px-6 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
              >
                Symbol <SortIcon column="symbol" />
              </th>
              <th
                onClick={() => handleSort("name")}
                className="text-left px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
              >
                Name <SortIcon column="name" />
              </th>
              <th
                onClick={() => handleSort("quantity")}
                className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
              >
                Qty <SortIcon column="quantity" />
              </th>
              <th
                onClick={() => handleSort("price")}
                className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
              >
                Price <SortIcon column="price" />
              </th>
              <th
                onClick={() => handleSort("avg_cost")}
                className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
              >
                Avg Cost <SortIcon column="avg_cost" />
              </th>
              <th
                onClick={() => handleSort("market_value")}
                className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
              >
                Value <SortIcon column="market_value" />
              </th>
              <th
                onClick={() => handleSort("cost_basis")}
                className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
              >
                Cost Basis <SortIcon column="cost_basis" />
              </th>
              <th
                onClick={() => handleSort("gain_loss")}
                className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
              >
                Day G/L <SortIcon column="gain_loss" />
              </th>
              <th
                onClick={() => handleSort("weight")}
                className="text-right px-6 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white"
              >
                Weight <SortIcon column="weight" />
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedHoldings.map((holding) => {
              const weight = totalValue > 0 ? (holding.market_value / totalValue) * 100 : 0;
              const holdingClass = holding.asset_class || "other";
              const isDimmed = selectedAssetClass !== null && selectedAssetClass !== undefined && holdingClass !== selectedAssetClass;
              const isExpanded = isHouseholdView && expandedSymbol === holding.symbol;
              const canExpand = isHouseholdView && householdHoldings && householdAccounts && holding.symbol !== "CASH";

              // Get per-account breakdown for this symbol
              const accountBreakdown = canExpand
                ? householdHoldings
                    .filter((h) => h.symbol === holding.symbol)
                    .map((h) => {
                      const account = householdAccounts.find((a) => a.id === h.account_id);
                      return { holding: h, account };
                    })
                    .sort((a, b) => b.holding.market_value - a.holding.market_value)
                : [];

              return (
                <Fragment key={holding.id}>
                  <tr
                    onClick={() => {
                      if (canExpand) {
                        setExpandedSymbol(isExpanded ? null : holding.symbol);
                      } else {
                        onHoldingClick?.(holding);
                      }
                    }}
                    className={`border-b border-black/5 dark:border-white/5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-all duration-300 ${onHoldingClick || canExpand ? "cursor-pointer" : ""} ${isDimmed ? "opacity-20" : ""}`}
                  >
                    <td className="px-6 py-3.5">
                      <span className="font-semibold text-black dark:text-white">{holding.symbol}</span>
                    </td>
                    <td className="px-4 py-3.5 text-black/50 dark:text-white/50 max-w-[200px] truncate">
                      {holding.name}
                    </td>
                    <td className="px-4 py-3.5 text-right text-black/50 dark:text-white/50">
                      {formatQuantity(holding.quantity)}
                    </td>
                    <td className="px-4 py-3.5 text-right text-black/50 dark:text-white/50">
                      <LiveValue value={holding.price} format={formatCurrency} />
                    </td>
                    <td className="px-4 py-3.5 text-right text-black/50 dark:text-white/50">
                      {holding.cost_basis !== null && holding.quantity > 0
                        ? formatCurrency(holding.cost_basis / holding.quantity)
                        : <span className="text-black/30 dark:text-white/30">-</span>}
                    </td>
                    <td className="px-4 py-3.5 text-right font-medium text-black dark:text-white">
                      <LiveValue value={holding.market_value} format={formatCurrency} />
                    </td>
                    <td className="px-4 py-3.5 text-right text-black/50 dark:text-white/50">
                      {holding.cost_basis !== null ? formatCurrency(holding.cost_basis) : <span className="text-black/30 dark:text-white/30">-</span>}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      {holding.symbol === "CASH" || holding.day_change === 0 ? (
                        <span className="text-black/30 dark:text-white/30">-</span>
                      ) : (
                        <LiveValue
                          value={holding.day_change_pct}
                          format={(n) => `${holding.day_change >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`}
                          className={`font-medium ${holding.day_change >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-[#FF2D2D]"}`}
                        />
                      )}
                    </td>
                    <td className="px-6 py-3.5 text-right text-black/50 dark:text-white/50">
                      {formatPercent(weight, false)}
                    </td>
                  </tr>
                  {isExpanded && accountBreakdown.map(({ holding: subHolding, account }) => {
                    const subWeight = totalValue > 0 ? (subHolding.market_value / totalValue) * 100 : 0;
                    return (
                      <tr
                        key={subHolding.id}
                        className="border-b border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02]"
                      >
                        <td className="px-6 py-2.5 text-sm text-black/50 dark:text-white/50 font-mono">
                          {account?.account_number || "—"}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-black/40 dark:text-white/40 max-w-[200px] truncate">
                          {account?.account_name || "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right text-sm text-black/50 dark:text-white/50">
                          {formatQuantity(subHolding.quantity)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-sm text-black/50 dark:text-white/50">
                          {formatCurrency(subHolding.price)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-sm text-black/50 dark:text-white/50">
                          {subHolding.cost_basis !== null && subHolding.quantity > 0
                            ? formatCurrency(subHolding.cost_basis / subHolding.quantity)
                            : <span className="text-black/30 dark:text-white/30">-</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right text-sm text-black/70 dark:text-white/70">
                          {formatCurrency(subHolding.market_value)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-sm text-black/50 dark:text-white/50">
                          {subHolding.cost_basis !== null ? formatCurrency(subHolding.cost_basis) : <span className="text-black/30 dark:text-white/30">-</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right text-sm">
                          {subHolding.day_change !== 0 ? (
                            <span className={subHolding.day_change >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-[#FF2D2D]"}>
                              {subHolding.day_change >= 0 ? "+" : "−"}{Math.abs(subHolding.day_change_pct).toFixed(2)}%
                            </span>
                          ) : (
                            <span className="text-black/30 dark:text-white/30">-</span>
                          )}
                        </td>
                        <td className="px-6 py-2.5 text-right text-sm text-black/50 dark:text-white/50">
                          {formatPercent(subWeight, false)}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {sortedHoldings.length === 0 && (
        <div className="py-8 text-center text-black/40 dark:text-white/40 text-sm">
          No holdings found
        </div>
      )}
    </div>
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
