"use client";

import { useState, useMemo } from "react";
import { type Holding, type SellTransaction } from "./types";
import TableSummaryStrip from "./TableSummaryStrip";

type UnrealizedSortKey = "symbol" | "name" | "market_value" | "cost_basis" | "unrealized" | "unrealized_pct" | "term";
type RealizedSortKey = "date" | "symbol" | "name" | "quantity" | "price" | "proceeds" | "cost_basis" | "realized" | "realized_pct";
type SortDirection = "asc" | "desc";
type GainFilter = "all" | "gains" | "losses";

export default function GainsTable({
  holdings,
  sellTransactions,
  view,
}: {
  holdings: Holding[];
  sellTransactions: SellTransaction[];
  view: "unrealized" | "realized";
}) {
  const [unrealizedSortKey, setUnrealizedSortKey] = useState<UnrealizedSortKey>("unrealized");
  const [realizedSortKey, setRealizedSortKey] = useState<RealizedSortKey>("realized");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [filter, setFilter] = useState<GainFilter>("all");

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

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  // ── Unrealized Gains ──────────────────────────────────────────────

  const holdingsWithBasis = useMemo(() => {
    return holdings.filter((h) => h.cost_basis !== null && h.cost_basis > 0);
  }, [holdings]);

  const gainsData = useMemo(() => {
    return holdingsWithBasis.map((h) => {
      const costBasis = h.cost_basis!;
      const unrealized = h.market_value - costBasis;
      const unrealizedPct = costBasis > 0 ? (unrealized / costBasis) * 100 : 0;
      const term = "long" as "short" | "long";
      return { holding: h, costBasis, unrealized, unrealizedPct, term };
    });
  }, [holdingsWithBasis]);

  const filteredUnrealized = useMemo(() => {
    if (filter === "gains") return gainsData.filter((d) => d.unrealized >= 0);
    if (filter === "losses") return gainsData.filter((d) => d.unrealized < 0);
    return gainsData;
  }, [gainsData, filter]);

  const sortedUnrealized = useMemo(() => {
    return [...filteredUnrealized].sort((a, b) => {
      let aVal: number;
      let bVal: number;

      switch (unrealizedSortKey) {
        case "symbol":
          return sortDirection === "asc"
            ? a.holding.symbol.localeCompare(b.holding.symbol)
            : b.holding.symbol.localeCompare(a.holding.symbol);
        case "name":
          return sortDirection === "asc"
            ? a.holding.name.localeCompare(b.holding.name)
            : b.holding.name.localeCompare(a.holding.name);
        case "market_value":
          aVal = a.holding.market_value;
          bVal = b.holding.market_value;
          break;
        case "cost_basis":
          aVal = a.costBasis;
          bVal = b.costBasis;
          break;
        case "unrealized":
          aVal = a.unrealized;
          bVal = b.unrealized;
          break;
        case "unrealized_pct":
          aVal = a.unrealizedPct;
          bVal = b.unrealizedPct;
          break;
        case "term":
          return sortDirection === "asc"
            ? a.term.localeCompare(b.term)
            : b.term.localeCompare(a.term);
        default:
          return 0;
      }

      return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
    });
  }, [filteredUnrealized, unrealizedSortKey, sortDirection]);

  const handleUnrealizedSort = (key: UnrealizedSortKey) => {
    if (unrealizedSortKey === key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setUnrealizedSortKey(key);
      setSortDirection("desc");
    }
  };

  const unrealizedTotals = useMemo(() => {
    const totalMarketValue = gainsData.reduce((sum, d) => sum + d.holding.market_value, 0);
    const totalCostBasis = gainsData.reduce((sum, d) => sum + d.costBasis, 0);
    const totalUnrealized = totalMarketValue - totalCostBasis;
    const totalUnrealizedPct = totalCostBasis > 0 ? (totalUnrealized / totalCostBasis) * 100 : 0;
    const totalGains = gainsData.filter((d) => d.unrealized >= 0).reduce((sum, d) => sum + d.unrealized, 0);
    const totalLosses = gainsData.filter((d) => d.unrealized < 0).reduce((sum, d) => sum + d.unrealized, 0);
    return { totalMarketValue, totalCostBasis, totalUnrealized, totalUnrealizedPct, totalGains, totalLosses };
  }, [gainsData]);

  // ── Realized Gains ────────────────────────────────────────────────

  const sellsWithGains = useMemo(() => {
    return sellTransactions.filter((s) => s.realized_gain !== null);
  }, [sellTransactions]);

  const filteredRealized = useMemo(() => {
    if (filter === "gains") return sellsWithGains.filter((s) => s.realized_gain! >= 0);
    if (filter === "losses") return sellsWithGains.filter((s) => s.realized_gain! < 0);
    return sellsWithGains;
  }, [sellsWithGains, filter]);

  const sortedRealized = useMemo(() => {
    return [...filteredRealized].sort((a, b) => {
      let aVal: number;
      let bVal: number;

      switch (realizedSortKey) {
        case "date":
          return sortDirection === "asc"
            ? a.date.localeCompare(b.date)
            : b.date.localeCompare(a.date);
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
        case "proceeds":
          aVal = a.proceeds;
          bVal = b.proceeds;
          break;
        case "cost_basis":
          aVal = (a.cost_basis_per_share ?? 0) * a.quantity;
          bVal = (b.cost_basis_per_share ?? 0) * b.quantity;
          break;
        case "realized":
          aVal = a.realized_gain ?? 0;
          bVal = b.realized_gain ?? 0;
          break;
        case "realized_pct":
          aVal = a.realized_gain_pct ?? 0;
          bVal = b.realized_gain_pct ?? 0;
          break;
        default:
          return 0;
      }

      return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
    });
  }, [filteredRealized, realizedSortKey, sortDirection]);

  const handleRealizedSort = (key: RealizedSortKey) => {
    if (realizedSortKey === key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setRealizedSortKey(key);
      setSortDirection("desc");
    }
  };

  const realizedTotals = useMemo(() => {
    const totalProceeds = sellsWithGains.reduce((sum, s) => sum + s.proceeds, 0);
    const totalCostBasis = sellsWithGains.reduce((sum, s) => sum + (s.cost_basis_per_share ?? 0) * s.quantity, 0);
    const totalRealized = sellsWithGains.reduce((sum, s) => sum + (s.realized_gain ?? 0), 0);
    const totalRealizedPct = totalCostBasis > 0 ? (totalRealized / totalCostBasis) * 100 : 0;
    const totalGains = sellsWithGains.filter((s) => s.realized_gain! >= 0).reduce((sum, s) => sum + s.realized_gain!, 0);
    const totalLosses = sellsWithGains.filter((s) => s.realized_gain! < 0).reduce((sum, s) => sum + s.realized_gain!, 0);
    return { totalProceeds, totalCostBasis, totalRealized, totalRealizedPct, totalGains, totalLosses };
  }, [sellsWithGains]);

  // ── Sort Icons ────────────────────────────────────────────────────

  const UnrealizedSortIcon = ({ column }: { column: UnrealizedSortKey }) => {
    if (unrealizedSortKey !== column) return null;
    return sortDirection === "asc" ? (
      <ChevronUpIcon className="w-3 h-3 inline ml-1" />
    ) : (
      <ChevronDownIcon className="w-3 h-3 inline ml-1" />
    );
  };

  const RealizedSortIcon = ({ column }: { column: RealizedSortKey }) => {
    if (realizedSortKey !== column) return null;
    return sortDirection === "asc" ? (
      <ChevronUpIcon className="w-3 h-3 inline ml-1" />
    ) : (
      <ChevronDownIcon className="w-3 h-3 inline ml-1" />
    );
  };

  return (
    <div>
      {view === "unrealized" ? (
        <>
          {/* Unrealized summary strip — same three numbers as the old cards */}
          <TableSummaryStrip
            items={[
              { label: "Total Unrealized", value: formatCurrency(unrealizedTotals.totalUnrealized), tone: "signed", raw: unrealizedTotals.totalUnrealized },
              { label: "Unrealized Gains", value: formatCurrency(unrealizedTotals.totalGains), tone: "gain" },
              { label: "Unrealized Losses", value: formatCurrency(unrealizedTotals.totalLosses), tone: "loss" },
            ]}
          />

          {/* Filter Tabs */}
          <div className="flex items-center gap-1 mb-4 bg-black/5 dark:bg-white/5 rounded-lg p-1 w-fit">
            {(["all", "gains", "losses"] as GainFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors capitalize ${
                  filter === f
                    ? "bg-white dark:bg-black medium:bg-[#e4e4e4] text-black dark:text-white shadow-sm"
                    : "text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Unrealized Table */}
          <div className="-mx-6">
            <table className="w-full text-sm min-w-full">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-black/5 dark:border-white/5 bg-[#f2f2f2] dark:bg-[#0a0a0a] medium:bg-[#bcbcbc]">
                  <th onClick={() => handleUnrealizedSort("symbol")} className="text-left px-6 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white">
                    Symbol <UnrealizedSortIcon column="symbol" />
                  </th>
                  <th onClick={() => handleUnrealizedSort("name")} className="text-left px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white">
                    Name <UnrealizedSortIcon column="name" />
                  </th>
                  <th onClick={() => handleUnrealizedSort("market_value")} className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white">
                    Value <UnrealizedSortIcon column="market_value" />
                  </th>
                  <th onClick={() => handleUnrealizedSort("cost_basis")} className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white">
                    Cost Basis <UnrealizedSortIcon column="cost_basis" />
                  </th>
                  <th onClick={() => handleUnrealizedSort("unrealized")} className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white">
                    Unrealized G/L <UnrealizedSortIcon column="unrealized" />
                  </th>
                  <th onClick={() => handleUnrealizedSort("unrealized_pct")} className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white">
                    G/L % <UnrealizedSortIcon column="unrealized_pct" />
                  </th>
                  <th onClick={() => handleUnrealizedSort("term")} className="text-right px-6 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white">
                    Term <UnrealizedSortIcon column="term" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedUnrealized.map((row) => (
                  <tr
                    key={row.holding.id}
                    className="border-b border-black/5 dark:border-white/5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-6 py-3.5">
                      <span className="font-semibold text-black dark:text-white">{row.holding.symbol}</span>
                    </td>
                    <td className="px-4 py-3.5 text-black/50 dark:text-white/50 max-w-[200px] truncate">
                      {row.holding.name}
                    </td>
                    <td className="px-4 py-3.5 text-right font-medium text-black dark:text-white">
                      {formatCurrency(row.holding.market_value)}
                    </td>
                    <td className="px-4 py-3.5 text-right text-black/70 dark:text-white/70">
                      {formatCurrency(row.costBasis)}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <span className="font-medium text-black/50 dark:text-white/50">
                        {formatCurrency(row.unrealized)}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <span className={`font-medium ${row.unrealizedPct >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-[#FF2D2D]"}`}>
                        {formatPercent(row.unrealizedPct)}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      <span className="text-xs uppercase tracking-wider text-black/50 dark:text-white/50">
                        {row.term === "short" ? "Short" : "Long"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              {sortedUnrealized.length > 0 && (
                <tfoot>
                  <tr className="border-t border-black/10 dark:border-white/10">
                    <td className="px-6 py-3.5 font-semibold text-black dark:text-white" colSpan={2}>
                      Total
                    </td>
                    <td className="px-4 py-3.5 text-right font-semibold text-black dark:text-white">
                      {formatCurrency(unrealizedTotals.totalMarketValue)}
                    </td>
                    <td className="px-4 py-3.5 text-right font-medium text-black/70 dark:text-white/70">
                      {formatCurrency(unrealizedTotals.totalCostBasis)}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <span className="font-semibold text-black/50 dark:text-white/50">
                        {formatCurrency(unrealizedTotals.totalUnrealized)}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <span className={`font-semibold ${unrealizedTotals.totalUnrealizedPct >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-[#FF2D2D]"}`}>
                        {formatPercent(unrealizedTotals.totalUnrealizedPct)}
                      </span>
                    </td>
                    <td className="px-6 py-3.5" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {sortedUnrealized.length === 0 && (
            <div className="py-8 text-center text-black/40 dark:text-white/40 text-sm">
              {filter === "all"
                ? "No holdings with cost basis data"
                : filter === "gains"
                ? "No positions with unrealized gains"
                : "No positions with unrealized losses"}
            </div>
          )}
        </>
      ) : (
        <>
          {/* Realized summary strip — same three numbers as the old cards */}
          <TableSummaryStrip
            items={[
              { label: "Total Realized", value: formatCurrency(realizedTotals.totalRealized), tone: "signed", raw: realizedTotals.totalRealized },
              { label: "Realized Gains", value: formatCurrency(realizedTotals.totalGains), tone: "gain" },
              { label: "Realized Losses", value: formatCurrency(realizedTotals.totalLosses), tone: "loss" },
            ]}
          />

          {/* Filter Tabs */}
          <div className="flex items-center gap-1 mb-4 bg-black/5 dark:bg-white/5 rounded-lg p-1 w-fit">
            {(["all", "gains", "losses"] as GainFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors capitalize ${
                  filter === f
                    ? "bg-white dark:bg-black medium:bg-[#e4e4e4] text-black dark:text-white shadow-sm"
                    : "text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Realized Table */}
          <div className="-mx-6">
            <table className="w-full text-sm min-w-full">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-black/5 dark:border-white/5 bg-[#f2f2f2] dark:bg-[#0a0a0a] medium:bg-[#bcbcbc]">
                  <th onClick={() => handleRealizedSort("date")} className="text-left px-6 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white">
                    Date <RealizedSortIcon column="date" />
                  </th>
                  <th onClick={() => handleRealizedSort("symbol")} className="text-left px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white">
                    Symbol <RealizedSortIcon column="symbol" />
                  </th>
                  <th onClick={() => handleRealizedSort("name")} className="text-left px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white">
                    Name <RealizedSortIcon column="name" />
                  </th>
                  <th onClick={() => handleRealizedSort("quantity")} className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white">
                    Qty Sold <RealizedSortIcon column="quantity" />
                  </th>
                  <th onClick={() => handleRealizedSort("price")} className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white">
                    Sale Price <RealizedSortIcon column="price" />
                  </th>
                  <th onClick={() => handleRealizedSort("proceeds")} className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white">
                    Proceeds <RealizedSortIcon column="proceeds" />
                  </th>
                  <th onClick={() => handleRealizedSort("cost_basis")} className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white">
                    Cost Basis <RealizedSortIcon column="cost_basis" />
                  </th>
                  <th onClick={() => handleRealizedSort("realized")} className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white">
                    Realized G/L <RealizedSortIcon column="realized" />
                  </th>
                  <th onClick={() => handleRealizedSort("realized_pct")} className="text-right px-6 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer hover:text-black dark:hover:text-white">
                    G/L % <RealizedSortIcon column="realized_pct" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRealized.map((sell) => {
                  const estimatedCost = sell.cost_basis_per_share !== null ? sell.cost_basis_per_share * sell.quantity : null;
                  return (
                    <tr
                      key={sell.id}
                      className="border-b border-black/5 dark:border-white/5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-6 py-3.5 text-black/70 dark:text-white/70">
                        {formatDate(sell.date)}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="font-semibold text-black dark:text-white">{sell.symbol}</span>
                      </td>
                      <td className="px-4 py-3.5 text-black/50 dark:text-white/50 max-w-[160px] truncate">
                        {sell.name}
                      </td>
                      <td className="px-4 py-3.5 text-right text-black/70 dark:text-white/70">
                        {sell.quantity.toLocaleString()}
                      </td>
                      <td className="px-4 py-3.5 text-right text-black/70 dark:text-white/70">
                        {formatCurrency(sell.price)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-medium text-black dark:text-white">
                        {formatCurrency(sell.proceeds)}
                      </td>
                      <td className="px-4 py-3.5 text-right text-black/70 dark:text-white/70">
                        {estimatedCost !== null ? formatCurrency(estimatedCost) : "—"}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <span className="font-medium text-black/50 dark:text-white/50">
                          {formatCurrency(sell.realized_gain!)}
                        </span>
                      </td>
                      <td className="px-6 py-3.5 text-right">
                        <span className={`font-medium ${sell.realized_gain_pct! >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-[#FF2D2D]"}`}>
                          {formatPercent(sell.realized_gain_pct!)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {sortedRealized.length > 0 && (
                <tfoot>
                  <tr className="border-t border-black/10 dark:border-white/10">
                    <td className="px-6 py-3.5 font-semibold text-black dark:text-white" colSpan={5}>
                      Total ({sellsWithGains.length} transactions)
                    </td>
                    <td className="px-4 py-3.5 text-right font-semibold text-black dark:text-white">
                      {formatCurrency(realizedTotals.totalProceeds)}
                    </td>
                    <td className="px-4 py-3.5 text-right font-medium text-black/70 dark:text-white/70">
                      {formatCurrency(realizedTotals.totalCostBasis)}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <span className="font-semibold text-black/50 dark:text-white/50">
                        {formatCurrency(realizedTotals.totalRealized)}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      <span className={`font-semibold ${realizedTotals.totalRealizedPct >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-[#FF2D2D]"}`}>
                        {formatPercent(realizedTotals.totalRealizedPct)}
                      </span>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {sortedRealized.length === 0 && (
            <div className="py-8 text-center text-black/40 dark:text-white/40 text-sm">
              {filter === "all"
                ? "No sell transactions with cost basis data"
                : filter === "gains"
                ? "No sell transactions with realized gains"
                : "No sell transactions with realized losses"}
            </div>
          )}
        </>
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
