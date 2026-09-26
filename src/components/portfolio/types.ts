export type PortfolioAccount = {
  id: string;
  account_number: string;
  account_name: string;
  account_type: "individual" | "joint" | "ira" | "roth_ira" | "trust" | "401k";
  custodian: string;
  total_value: number;
  cash_balance: number;
  day_change: number;
  day_change_pct: number;
  model_portfolio_id: string | null;
  model_name: string | null;
  is_managed: boolean;
  rep_code: string | null;
  created_at: string;
  updated_at: string;
  // Extended account info
  client_name: string | null;
  firm_name: string | null;
  household_name: string | null;
  household_id: string | null;
  // Client personal details
  date_of_birth: string | null;
  ssn: string | null;
  legal_address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  annual_income: number | null;
  // Client suitability fields
  net_worth: number | null;
  risk_tolerance: string | null;
  investment_objective: string | null;
  time_horizon: string | null;
  // Fee fields
  fee_schedule: string | null;
  fee_rate: number;
  billing_frequency: string | null;
};

export type Holding = {
  id: string;
  account_id: string;
  symbol: string;
  name: string;
  quantity: number;
  price: number;
  market_value: number;
  cost_basis: number | null;
  day_change: number;
  day_change_pct: number;
  asset_class: "equity" | "fixed_income" | "cash" | "alternative" | "other";
  created_at: string;
  updated_at: string;
};

// A single security aggregated across every account that holds it — the row model
// for the firm-wide Holdings page. `accounts` carries the per-account rows so a row
// can expand to show which accounts contribute to the position.
export type AggregatedHolding = {
  symbol: string;
  name: string;
  asset_class: Holding["asset_class"];
  quantity: number; // total shares across all accounts
  price: number; // weighted average price = market_value / quantity
  market_value: number; // total market value
  cost_basis: number | null; // total cost basis (null when no account reported one)
  day_change: number; // total day change ($)
  day_change_pct: number; // security day change (%), recomputed from summed values
  account_count: number; // number of distinct accounts holding this symbol
  accounts: Holding[]; // per-account rows, for the expandable breakdown
  is_cash?: boolean; // true for the synthetic firm-wide CASH row
};

export type AssetAllocation = {
  asset_class: string;
  label: string;
  value: number;
  percentage: number;
  color: string;
};

export type SellTransaction = {
  id: string;
  date: string;
  symbol: string;
  name: string;
  quantity: number;
  price: number;
  proceeds: number;
  cost_basis_per_share: number | null;
  realized_gain: number | null;
  realized_gain_pct: number | null;
};

export type AccountParticipant = {
  id: string;
  account_id: string;
  name: string;
  role: "beneficiary" | "grantor" | "trusted_contact" | "interested_party" | "poa" | "lpoa";
  relationship: string | null;
  created_at: string;
};

export type AccountBalance = {
  id: string;
  account_id: string;
  // Account Equity & Value
  total_equity: number;
  liquidating_equity: number;
  long_market_value: number;
  short_market_value: number;
  cash_management_balance: number;
  credit_debit_balance: number;
  // Margin Requirements
  total_house_requirement: number;
  house_surplus: number;
  finra_surplus: number;
  total_sma: number;
  today_federal_call: number;
  foreign_ccy_house_req: number;
  // Funds Availability
  funds_available_to_trade: number;
  funds_available_to_withdraw: number;
  day_trade_buying_power: number;
  funds_unavailable: number;
  funds_due: number;
  cash: number;
  // Timestamps
  created_at: string;
  updated_at: string;
};
