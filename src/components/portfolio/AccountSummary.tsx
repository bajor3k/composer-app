"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { type PortfolioAccount, type Holding } from "./types";

type CashData = {
  cash_balance: number;
  mmf_balance: number;
  total_liquid: number;
};

function getContributionLimit(dateOfBirth: string | null): number {
  if (!dateOfBirth) return 7500;
  const dob = new Date(dateOfBirth);
  const endOfYear = new Date(2026, 11, 31);
  const age = Math.floor((endOfYear.getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  return age >= 50 ? 8500 : 7500;
}

function isRothEligible(accountType: string | undefined, annualIncome: number | null): boolean {
  if (accountType !== "roth_ira") return true;
  if (annualIncome === null) return true;
  return annualIncome <= 165000;
}

export default function AccountSummary({
  account,
  householdAccounts,
  isHouseholdView,
  onToggleView,
  refreshKey,
  holdings,
  householdHoldings,
}: {
  account: PortfolioAccount | null;
  householdAccounts?: PortfolioAccount[];
  isHouseholdView?: boolean;
  onToggleView?: () => void;
  refreshKey?: number;
  holdings?: Holding[];
  householdHoldings?: Holding[];
}) {
  const [contributionTotal, setContributionTotal] = useState<number | null>(null);
  const [loadingContribution, setLoadingContribution] = useState(false);
  const [cashData, setCashData] = useState<CashData | null>(null);

  const isIRA = account?.account_type === "ira" || account?.account_type === "roth_ira";

  // Fetch money market / liquid cash data
  useEffect(() => {
    if (!account) {
      setCashData(null);
      return;
    }

    async function fetchCashData() {
      const accountIds = isHouseholdView && householdAccounts && householdAccounts.length > 1
        ? householdAccounts.map((a) => a.id)
        : [account!.id];

      const { data, error } = await supabase
        .from("cash_accounts")
        .select("cash_balance, mmf_balance, total_liquid")
        .in("id", accountIds);

      if (!error && data && data.length > 0) {
        const totals = data.reduce(
          (acc, row) => ({
            cash_balance: acc.cash_balance + Number(row.cash_balance),
            mmf_balance: acc.mmf_balance + Number(row.mmf_balance),
            total_liquid: acc.total_liquid + Number(row.total_liquid),
          }),
          { cash_balance: 0, mmf_balance: 0, total_liquid: 0 }
        );
        setCashData(totals);
      } else {
        setCashData(null);
      }
    }

    fetchCashData();
  }, [account?.id, isHouseholdView, householdAccounts?.length]);

  // Fetch contribution total for IRA accounts in portfolio value mode
  useEffect(() => {
    if (!account || !isIRA || isHouseholdView) {
      setContributionTotal(null);
      return;
    }

    async function fetchContributions() {
      setLoadingContribution(true);
      // Count all transactions tagged with contribution_year 2026 (both "contribution" and IRA buy orders)
      const { data, error } = await supabase
        .from("account_transactions")
        .select("amount")
        .eq("account_id", account!.id)
        .eq("contribution_year", 2026)
        .in("type", ["contribution", "buy"]);

      if (!error && data) {
        const total = data.reduce((sum, row) => sum + Number(row.amount), 0);
        setContributionTotal(total);
      }
      setLoadingContribution(false);
    }

    fetchContributions();
  }, [account?.id, isIRA, isHouseholdView, refreshKey]);

  if (!account) {
    return (
      <div>
        <div className="animate-pulse">
          <div className="h-8 bg-black/5 dark:bg-white/5 rounded w-48 mb-2" />
          <div className="h-5 bg-black/5 dark:bg-white/5 rounded w-32" />
        </div>
      </div>
    );
  }

  const hasHousehold = householdAccounts && householdAccounts.length > 1;

  // Compute total value and day change from live holdings data (Yahoo Finance prices)
  // Falls back to static DB values if holdings aren't loaded yet
  // Filter out CASH holdings to avoid double-counting with account.cash_balance
  const equityHoldings = holdings?.filter((h) => h.symbol !== "CASH") ?? [];
  const computedTotalValue = equityHoldings.length > 0
    ? equityHoldings.reduce((sum, h) => sum + h.market_value, 0) + account.cash_balance
    : account.total_value;
  const computedDayChange = equityHoldings.length > 0
    ? equityHoldings.reduce((sum, h) => sum + h.day_change, 0)
    : account.day_change;
  const computedDayChangePct = computedTotalValue > 0
    ? (computedDayChange / (computedTotalValue - computedDayChange)) * 100
    : account.day_change_pct;

  // Compute household totals from live holdings (filter out CASH to avoid double-counting)
  const hhEquityHoldings = householdHoldings?.filter((h) => h.symbol !== "CASH") ?? [];
  const hhCash = hasHousehold ? householdAccounts.reduce((sum, a) => sum + a.cash_balance, 0) : 0;
  const hhTotalValue = hasHousehold
    ? (hhEquityHoldings.length > 0
        ? hhEquityHoldings.reduce((sum, h) => sum + h.market_value, 0) + hhCash
        : householdAccounts.reduce((sum, a) => sum + a.total_value, 0))
    : 0;
  const hhDayChange = hasHousehold
    ? (hhEquityHoldings.length > 0
        ? hhEquityHoldings.reduce((sum, h) => sum + h.day_change, 0)
        : householdAccounts.reduce((sum, a) => sum + a.day_change, 0))
    : 0;
  const hhDayChangePct = hasHousehold && hhTotalValue > 0 ? (hhDayChange / (hhTotalValue - hhDayChange)) * 100 : 0;

  // Pick which values to display based on toggle
  const showHousehold = isHouseholdView && hasHousehold;
  const displayValue = showHousehold ? hhTotalValue : computedTotalValue;
  const displayDayChange = showHousehold ? hhDayChange : computedDayChange;
  const displayDayChangePct = showHousehold ? hhDayChangePct : computedDayChangePct;
  const displayCash = showHousehold ? hhCash : account.cash_balance;
  const isPositive = displayDayChange >= 0;

  // Contribution calculations
  const showContribution = isIRA && !showHousehold;
  const eligible = isRothEligible(account.account_type, account.annual_income);
  const limit = getContributionLimit(account.date_of_birth);
  const contributed = contributionTotal ?? 0;
  const remaining = Math.max(0, limit - contributed);
  const pct = Math.min(100, (contributed / limit) * 100);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatCurrencyShort = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    const sign = value >= 0 ? "+" : "";
    return `${sign}${value.toFixed(2)}%`;
  };

  return (
    <div className="@container">
      {/* Toggle header */}
      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={!isHouseholdView ? undefined : onToggleView}
          className={`text-xs font-semibold uppercase tracking-wider transition-colors ${
            !isHouseholdView
              ? "text-black dark:text-white"
              : "text-black/30 dark:text-white/30 hover:text-black/50 dark:hover:text-white/50 cursor-pointer"
          }`}
        >
          Portfolio
        </button>
        {hasHousehold && (
          <>
            <span className="text-black/15 dark:text-white/15 text-xs">|</span>
            <button
              onClick={isHouseholdView ? undefined : onToggleView}
              className={`text-xs font-semibold uppercase tracking-wider transition-colors ${
                isHouseholdView
                  ? "text-black dark:text-white"
                  : "text-black/30 dark:text-white/30 hover:text-black/50 dark:hover:text-white/50 cursor-pointer"
              }`}
            >
              Household
            </button>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-baseline gap-4">
        {/* Total Value — steps down when the column gets narrow (drawer view) */}
        <span className="text-3xl @[22rem]:text-4xl font-semibold text-black dark:text-white tracking-tight">
          {formatCurrency(displayValue)}
        </span>

        {/* Day Change */}
        <div className={`flex items-center gap-1.5 ${isPositive ? "text-emerald-600 dark:text-emerald-500" : "text-[#FF2D2D]"}`}>
          {isPositive ? (
            <ArrowUpIcon className="w-4 h-4" />
          ) : (
            <ArrowDownIcon className="w-4 h-4" />
          )}
          <span className="text-sm font-medium">
            {formatCurrency(Math.abs(displayDayChange))} ({formatPercent(displayDayChangePct)})
          </span>
          <span className="text-xs text-black/40 dark:text-white/40 ml-1">today</span>
        </div>
      </div>

      {/* Cash Available / Money Markets / Total Liquid */}
      <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-3">
        <div>
          <span className="text-xs text-black/40 dark:text-white/40 uppercase tracking-wider">Cash Available</span>
          <div className="text-lg font-medium text-black dark:text-white mt-0.5">
            {formatCurrency(cashData ? cashData.cash_balance : displayCash)}
          </div>
        </div>
        <div>
          <span className="text-xs text-black/40 dark:text-white/40 uppercase tracking-wider">Money Markets</span>
          <div className="text-lg font-medium text-black dark:text-white mt-0.5">
            {formatCurrency(cashData?.mmf_balance ?? 0)}
          </div>
        </div>
        <div>
          <span className="text-xs text-black/40 dark:text-white/40 uppercase tracking-wider">Total Liquid</span>
          <div className="text-lg font-medium text-black dark:text-white mt-0.5">
            {formatCurrency(cashData ? cashData.total_liquid : displayCash)}
          </div>
        </div>
      </div>

      {/* IRA Contribution — only in Portfolio Value mode */}
      {showContribution && (
        <div className="mt-6">
          {loadingContribution ? (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-black/10 dark:border-white/10 border-t-black/60 dark:border-t-white/60 rounded-full animate-spin" />
              <span className="text-xs text-black/40 dark:text-white/40">Loading contributions...</span>
            </div>
          ) : !eligible ? (
            <div>
              <span className="text-xs text-black/40 dark:text-white/40 uppercase tracking-wider">2026 Contribution</span>
              <div className="text-sm text-[#FF2D2D]/70 mt-1">
                Ineligible — Income exceeds $165K MAGI limit
              </div>
            </div>
          ) : (
            <>
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-black/40 dark:text-white/40 uppercase tracking-wider">2026 Contribution</span>
                  <span className="text-xs text-black/40 dark:text-white/40">{pct.toFixed(0)}% of limit</span>
                </div>
                <div className="w-full h-2 bg-black/5 dark:bg-white/5 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${pct <= 33 ? 'bg-red-500' : pct <= 66 ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-black/40 dark:text-white/40 uppercase tracking-wider">Contributed</div>
                  <div className="text-sm font-medium text-black dark:text-white mt-0.5">{formatCurrencyShort(contributed)}</div>
                </div>
                <div>
                  <div className="text-xs text-black/40 dark:text-white/40 uppercase tracking-wider">Remaining</div>
                  <div className={`text-sm font-medium mt-0.5 ${remaining === 0 ? "text-emerald-600 dark:text-emerald-500" : "text-black dark:text-white"}`}>
                    {formatCurrencyShort(remaining)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-black/40 dark:text-white/40 uppercase tracking-wider">2026 Limit</div>
                  <div className="text-sm font-medium text-black dark:text-white mt-0.5">{formatCurrencyShort(limit)}</div>
                </div>
                <div>
                  <div className="text-xs text-black/40 dark:text-white/40 uppercase tracking-wider">Catch-Up</div>
                  <div className="text-sm font-medium text-black dark:text-white mt-0.5">{limit === 8500 ? "Eligible (50+)" : "N/A"}</div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

    </div>
  );
}

function ArrowUpIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
    </svg>
  );
}

function ArrowDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}
