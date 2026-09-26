"use client";

import { useState, useMemo } from "react";
import { type PortfolioAccount } from "./types";

type FeePeriod = "monthly" | "quarterly" | "annual";

export default function AdvisoryFeesView({
  account,
  householdAccounts,
  isHouseholdView,
}: {
  account: PortfolioAccount;
  householdAccounts: PortfolioAccount[];
  isHouseholdView: boolean;
}) {
  const [period, setPeriod] = useState<FeePeriod>("annual");

  // Always compute fees across all household accounts so the tab shows
  // full household fees even when viewing a single non-managed (XYZ) account
  const allAccounts = isHouseholdView
    ? householdAccounts
    : [account];

  const { totalAnnualFee, managedAUM, feeRatePct } = useMemo(() => {
    let fee = 0;
    let aum = 0;
    let rateSum = 0;
    let rateCount = 0;
    for (const a of allAccounts) {
      if (a.is_managed && a.fee_rate > 0) {
        fee += a.total_value * a.fee_rate;
        aum += a.total_value;
        rateSum += a.fee_rate;
        rateCount++;
      }
    }
    // Portfolio view: show the account's fee rate; Household view: average across managed accounts
    const pct = isHouseholdView
      ? rateCount > 0 ? (rateSum / rateCount) * 100 : 0
      : allAccounts[0]?.fee_rate > 0 ? allAccounts[0].fee_rate * 100 : 0;
    return { totalAnnualFee: fee, managedAUM: aum, feeRatePct: pct };
  }, [allAccounts, isHouseholdView]);

  const periodDivisor: Record<FeePeriod, number> = { monthly: 12, quarterly: 4, annual: 1 };
  const displayedFee = totalAnnualFee / periodDivisor[period];

  const circumference = 2 * Math.PI * 35;

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

  return (
    <div className="flex items-center gap-10">
      {/* Donut ring */}
      <div className="relative w-56 h-56 flex-shrink-0">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
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
          {totalAnnualFee > 0 && (
            <circle
              cx="50"
              cy="50"
              r="35"
              fill="none"
              stroke="#F59E0B"
              strokeWidth="5"
              strokeDasharray={`${circumference} ${circumference}`}
              className="transition-all duration-500"
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          {totalAnnualFee === 0 ? (
            <>
              <span className="text-xs text-black/40 dark:text-white/40">No Fees</span>
              <span className="text-base font-semibold text-black dark:text-white">$0</span>
            </>
          ) : (
            <>
              <span className="text-xs text-black/40 dark:text-white/40 uppercase tracking-wider">Est. Advisory Fee</span>
              <span className="text-base font-semibold text-black dark:text-white">
                {formatCurrency(displayedFee)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Details */}
      <div className="flex-1 space-y-4">
        <div className="text-xs font-semibold text-black dark:text-white uppercase tracking-wider">
          Projected
        </div>

        {/* Period toggle */}
        <div className="flex items-center gap-0.5 bg-black/5 dark:bg-white/5 rounded-lg p-1 w-fit">
          {(["monthly", "quarterly", "annual"] as FeePeriod[]).map((p) => (
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

        {/* Estimated fee + Fee rate side by side */}
        <div className="flex items-start gap-8">
          <div>
            <div className="text-xs text-black/40 dark:text-white/40 uppercase tracking-wider">
              Est. Fee
            </div>
            <div className="text-sm font-medium text-black dark:text-white mt-0.5">
              {formatCurrencyPrecise(displayedFee)}
            </div>
          </div>
          <div>
            <div className="text-xs text-black/40 dark:text-white/40 uppercase tracking-wider">
              Fee{isHouseholdView ? " (Avg)" : ""}
            </div>
            <div className="text-sm font-medium text-black dark:text-white mt-0.5">
              {feeRatePct > 0 ? `${feeRatePct.toFixed(2)}%` : "—"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
