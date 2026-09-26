"use client";

import { type AccountBalance, type PortfolioAccount } from "./types";

export default function BalanceDetails({
  account,
  balanceData,
}: {
  account: PortfolioAccount | null;
  balanceData: AccountBalance | null;
}) {
  if (!account) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-6 bg-black/5 dark:bg-white/5 rounded w-48" />
        <div className="grid grid-cols-2 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-4 bg-black/5 dark:bg-white/5 rounded" />
          ))}
        </div>
      </div>
    );
  }

  // Use database data if available, otherwise generate from account values
  const data = balanceData || generateFallbackData(account);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  return (
    <div className="space-y-8">
      {/* Account Equity & Value */}
      <Section title="Account Equity & Value">
        <div className="grid grid-cols-2 gap-x-12 gap-y-3">
          <BalanceRow label="Total Equity" value={formatCurrency(data.total_equity)} />
          <BalanceRow label="Short Market Value" value={formatCurrency(data.short_market_value)} muted={data.short_market_value === 0} />
          <BalanceRow label="Liquidating Equity" value={formatCurrency(data.liquidating_equity)} />
          <BalanceRow label="Cash Management Balance" value={formatCurrency(data.cash_management_balance)} />
          <BalanceRow label="Long Market Value" value={formatCurrency(data.long_market_value)} />
          <BalanceRow label="Credit/Debit Balance" value={formatCurrency(data.credit_debit_balance)} muted={data.credit_debit_balance === 0} />
        </div>
      </Section>

      {/* Margin Requirements */}
      <Section title="Margin Requirements">
        <div className="grid grid-cols-2 gap-x-12 gap-y-3">
          <BalanceRow label="Total House Requirement" value={formatCurrency(data.total_house_requirement)} />
          <BalanceRow label="Total SMA" value={formatCurrency(data.total_sma)} negative={data.total_sma < 0} />
          <BalanceRow label="House Surplus" value={formatCurrency(data.house_surplus)} negative={data.house_surplus < 0} />
          <BalanceRow label="Today Federal Call" value={formatCurrency(data.today_federal_call)} negative={data.today_federal_call > 0} muted={data.today_federal_call === 0} />
          <BalanceRow label="FINRA Surplus" value={formatCurrency(data.finra_surplus)} negative={data.finra_surplus < 0} />
          <BalanceRow label="Foreign CCY House Req." value={formatCurrency(data.foreign_ccy_house_req)} muted={data.foreign_ccy_house_req === 0} />
        </div>
      </Section>

      {/* Funds Availability */}
      <Section title="Funds Availability">
        <div className="grid grid-cols-2 gap-x-12 gap-y-3">
          <BalanceRow label="Funds Available to Trade" value={formatCurrency(data.funds_available_to_trade)} />
          <BalanceRow label="Funds Unavailable" value={formatCurrency(data.funds_unavailable)} muted={data.funds_unavailable === 0} />
          <BalanceRow label="Funds Available to Withdraw" value={formatCurrency(data.funds_available_to_withdraw)} />
          <BalanceRow label="Funds Due" value={formatCurrency(data.funds_due)} muted={data.funds_due === 0} />
          <BalanceRow label="Day Trade Buying Power" value={formatCurrency(data.day_trade_buying_power)} />
          <BalanceRow label="Cash" value={formatCurrency(data.cash)} />
        </div>
      </Section>
    </div>
  );
}

// Fallback data generator when database data is not available
function generateFallbackData(account: PortfolioAccount): AccountBalance {
  const totalEquity = account.total_value;
  const cash = account.cash_balance;
  const longMarketValue = totalEquity - cash + (cash * 0.2);

  return {
    id: "",
    account_id: account.id,
    total_equity: totalEquity,
    liquidating_equity: totalEquity,
    long_market_value: longMarketValue,
    short_market_value: 0,
    cash_management_balance: cash,
    credit_debit_balance: 0,
    total_house_requirement: totalEquity * 0.35,
    house_surplus: cash * 0.02,
    finra_surplus: totalEquity * 0.05,
    total_sma: cash * 0.01,
    today_federal_call: 0,
    foreign_ccy_house_req: 0,
    funds_available_to_trade: cash * 0.90,
    funds_available_to_withdraw: cash * 0.85,
    day_trade_buying_power: cash * 4,
    funds_unavailable: cash * 0.05,
    funds_due: 0,
    cash,
    created_at: "",
    updated_at: "",
  };
}

// De-boxed section: a plain uppercase heading like the rest of the page's
// section labels, no card border or tinted header band.
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-black dark:text-white uppercase tracking-wider mb-3">{title}</h4>
      <div>{children}</div>
    </div>
  );
}

function BalanceRow({
  label,
  value,
  negative = false,
  muted = false
}: {
  label: string;
  value: string;
  negative?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-black/60 dark:text-white/60">{label}</span>
      <span className={`text-sm font-mono ${
        muted
          ? "text-black/30 dark:text-white/30"
          : negative
            ? "text-red-600 dark:text-red-500 font-medium"
            : "text-black dark:text-white"
      }`}>
        {value}
      </span>
    </div>
  );
}
