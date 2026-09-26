"use client";

import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { type Holding } from "./types";

type IncomePeriod = "monthly" | "quarterly" | "annual";

interface SecurityYield {
  symbol: string;
  dividendYield: number;
}

export default function IncomeView({
  accountId,
  holdings,
}: {
  accountId: string;
  holdings: Holding[];
}) {
  const [yields, setYields] = useState<SecurityYield[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<IncomePeriod>("monthly");

  // Fetch security yields for holdings
  useEffect(() => {
    if (!accountId) return;

    async function fetchYields() {
      setLoading(true);

      const holdingSymbols = holdings
        .filter((h) => h.symbol !== "CASH")
        .map((h) => h.symbol);

      if (holdingSymbols.length === 0) {
        setYields([]);
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from("Security")
        .select("symbol, \"dividendYield\"")
        .in("symbol", holdingSymbols)
        .not("dividendYield", "is", null);

      if (data) {
        setYields(
          (data as any[]).map((row) => ({
            symbol: row.symbol,
            dividendYield: Number(row.dividendYield),
          }))
        );
      }

      setLoading(false);
    }

    fetchYields();
  }, [accountId, holdings]);

  // Projected income from yields — single source of truth for all numbers
  const { projectedAnnual, dividendAnnual, interestAnnual } = useMemo(() => {
    const yieldMap = new Map(yields.map((y) => [y.symbol, y.dividendYield]));
    let divTotal = 0;
    let intTotal = 0;
    for (const h of holdings) {
      const y = yieldMap.get(h.symbol);
      if (y && y > 0) {
        if (h.asset_class === "fixed_income" || h.asset_class === "cash") {
          intTotal += h.market_value * y;
        } else {
          divTotal += h.market_value * y;
        }
      }
    }
    return {
      projectedAnnual: divTotal + intTotal,
      dividendAnnual: divTotal,
      interestAnnual: intTotal,
    };
  }, [holdings, yields]);

  const periodDivisor = period === "monthly" ? 12 : period === "quarterly" ? 4 : 1;
  const totalIncome = projectedAnnual / periodDivisor;
  const dividendIncome = dividendAnnual / periodDivisor;
  const interestIncome = interestAnnual / periodDivisor;

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);

  const formatCurrencyPrecise = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);

  const periodLabel =
    period === "monthly" ? "Monthly" : period === "quarterly" ? "Quarterly" : "Annual";

  // Donut chart calculations (always based on annual for stable proportions)
  const divPct = projectedAnnual > 0 ? (dividendAnnual / projectedAnnual) * 100 : 0;
  const intPct = projectedAnnual > 0 ? (interestAnnual / projectedAnnual) * 100 : 0;
  const circumference = 2 * Math.PI * 35;

  if (loading) {
    return (
      <div className="flex items-center gap-10">
        <div className="w-56 h-56 flex-shrink-0 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-black/10 dark:border-white/10 border-t-black/60 dark:border-t-white/60 rounded-full animate-spin" />
        </div>
        <div className="flex-1" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-10">
      {/* Donut Ring — Dividend vs Interest split */}
      <div className="relative w-56 h-56 flex-shrink-0">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          {totalIncome === 0 ? (
            /* Empty ring */
            <circle
              cx="50"
              cy="50"
              r="35"
              fill="none"
              stroke="currentColor"
              strokeWidth="5"
              className="text-black/5 dark:text-white/5"
            />
          ) : (
            <>
              {/* Background track */}
              <circle
                cx="50"
                cy="50"
                r="35"
                fill="none"
                stroke="currentColor"
                strokeWidth="5"
                className="text-black/5 dark:text-white/5"
              />
              {/* Dividend segment */}
              {divPct > 0 && (
                <circle
                  cx="50"
                  cy="50"
                  r="35"
                  fill="none"
                  stroke="#10B981"
                  strokeWidth="5"
                  strokeDasharray={`${(divPct / 100 / periodDivisor) * circumference} ${circumference}`}
                  strokeDashoffset={0}
                  className="transition-all duration-500"
                />
              )}
              {/* Interest segment */}
              {intPct > 0 && (
                <circle
                  cx="50"
                  cy="50"
                  r="35"
                  fill="none"
                  stroke="#F59E0B"
                  strokeWidth="5"
                  strokeDasharray={`${(intPct / 100 / periodDivisor) * circumference} ${circumference}`}
                  strokeDashoffset={-(divPct / 100 / periodDivisor) * circumference}
                  className="transition-all duration-500"
                />
              )}
            </>
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          {projectedAnnual === 0 ? (
            <>
              <span className="text-xs text-black/40 dark:text-white/40">No Income</span>
              <span className="text-base font-semibold text-black dark:text-white">$0</span>
            </>
          ) : (
            <>
              <span className="text-xs text-black/40 dark:text-white/40 uppercase tracking-wider">Est. {periodLabel}</span>
              <span className="text-base font-semibold text-black dark:text-white">
                {formatCurrency(totalIncome)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Details */}
      <div className="flex-1 space-y-4">
        {/* Period selector */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-black dark:text-white uppercase tracking-wider">
            Projected
          </span>
          <div className="flex items-center gap-0.5 bg-black/5 dark:bg-white/5 rounded-lg p-1 w-fit">
            {(["monthly", "quarterly", "annual"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  period === p
                    ? "bg-white dark:bg-black medium:bg-[#e4e4e4] text-black dark:text-white shadow-sm"
                    : "text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white"
                }`}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-black/40 dark:text-white/40 uppercase tracking-wider">
              Dividends
            </div>
            <div className="text-sm font-medium text-black dark:text-white mt-0.5">
              {formatCurrencyPrecise(dividendIncome)}
            </div>
          </div>
          <div>
            <div className="text-xs text-black/40 dark:text-white/40 uppercase tracking-wider">
              Interest
            </div>
            <div className="text-sm font-medium text-black dark:text-white mt-0.5">
              {formatCurrencyPrecise(interestIncome)}
            </div>
          </div>
          <div>
            <div className="text-xs text-black/40 dark:text-white/40 uppercase tracking-wider whitespace-nowrap">
              Est. Income
            </div>
            <div className="text-sm font-medium text-black dark:text-white mt-0.5">
              {formatCurrencyPrecise(totalIncome)}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
