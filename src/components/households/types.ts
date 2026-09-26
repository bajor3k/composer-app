// A member account of a household — the subset of portfolio_accounts fields the
// Households page needs for the aggregate list and the expandable per-account breakdown.
export type HouseholdAccount = {
  id: string;
  account_number: string;
  account_name: string;
  account_type: string;
  custodian: string;
  total_value: number;
  cash_balance: number;
  rep_code: string | null;
  client_name: string | null;
  firm_name: string | null;
  household_id: string | null;
  household_name: string | null;
};

// One household, aggregated from its member accounts. `members` carries the per-account
// rows so a row can expand to reveal the accounts that make up the household.
export type HouseholdSummary = {
  id: string; // household_id
  name: string; // household_name
  firm_name: string | null;
  total_aum: number;
  total_cash: number;
  account_count: number;
  account_numbers: string[];
  rep_codes: string[];
  members: HouseholdAccount[];
};
