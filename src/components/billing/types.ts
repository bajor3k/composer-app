// Shared types for the Billing page. Advisory fees are computed client-side
// (balance × feeRate prorated by the selected period) — there is no stored fee table.

export type AdvisoryFeeRow = {
  id: string;
  account_number: string;
  account_name: string;
  household_id: string | null;
  household_name: string;
  rep_code: string;
  custodian: string;
  cash_balance: number;
  aum: number;
  fee_rate: number; // decimal fraction: 0.0100 = 1%
  fee_amount: number; // prorated for the selected period
};

export type CommissionRow = {
  id: string;
  account_number: string;
  account_name: string;
  symbol: string;
  security_name: string;
  side: string; // "buy" | "sell"
  quantity: number;
  price: number;
  gross_amount: number;
  total_commission: number;
  trade_date: string; // "YYYY-MM-DD"
};

export type SalesCreditRow = {
  id: string;
  account_number: string;
  credit_type: string;
  source: string;
  fund_symbol: string | null;
  period: string;
  period_start: string; // "YYYY-MM-DD"
  period_end: string; // "YYYY-MM-DD"
  assets_basis: number;
  credit_rate: number; // decimal fraction: 0.0015 = 15 bps
  credit_amount: number;
  status: string; // "received" | "pending" | "expected"
};

export type OutsideBusinessRow = {
  id: string;
  activity_type: string;
  description: string;
  client_name: string | null;
  income_type: string;
  gross_income: number;
  expenses: number;
  net_income: number;
  date_received: string; // "YYYY-MM-DD"
  approval_status: string;
};

export type RevenueSlice = {
  key: "advisory" | "commissions" | "credits" | "outside";
  label: string;
  value: number;
  color: string;
};

export type MonthBucket = {
  key: string; // "2026-07"
  label: string; // "Jul"
  year: number;
  commissions: number;
  salesCredits: number;
  expenses: number; // positive number, drawn below the baseline
  net: number;
  partial: boolean; // current (in-progress) month
};

export type BillingTab = "advisory" | "commissions" | "credits" | "outside";

export const CREDIT_TYPE_LABELS: Record<string, string> = {
  "12b-1": "12b-1 Fee",
  revenue_share: "Revenue Share",
  trail: "Trail Commission",
  marketing: "Marketing Support",
  sub_ta: "Sub-TA Fee",
};
