// Types for the Share Class Analysis engine — a faithful TypeScript port of the
// standalone prototype's data model. Row shapes mirror the source CSV schemas; the
// engine coerces `net_expense_ratio` and `min_initial` to numbers (NaN never 0 for a
// missing expense ratio — a blank means UNKNOWN, which must surface as a data gap).

/** A raw row straight out of the CSV parser — every cell is a string. */
export type RawRow = Record<string, string>;

/** Fund reference row (fund-reference CSV). Numeric fields coerced by buildIndexes. */
export interface FundRow {
  fund_group_id: string;
  fund_family: string;
  fund_name: string;
  share_class: string;
  ticker: string;
  cusip: string;
  /** Coerced number; NaN when the source cell is blank (UNKNOWN, never treated as 0). */
  net_expense_ratio: number;
  twelve_b_1: string;
  front_load_max: string;
  first_breakpoint: string;
  cdsc_pct: string;
  cdsc_months: string;
  cdsc_threshold: string;
  /** Coerced number; 0 when blank. */
  min_initial: number;
  requires_advisory: string;
  requires_recordkeeper: string;
  eligible_registrations: string;
  closed_to_new: string;
  conversion_supported: string;
  as_of_date: string;
  source: string;
  // Real-fund provenance (present only in the real dataset).
  accession?: string;
  filing_date?: string;
  data_quality?: string;
  eligibility_note?: string;
}

/** Custodian availability row (custodian-availability CSV). */
export interface AvailRow {
  ticker: string;
  custodian: string;
  platform: string;
  /** LOAD | NTF | TF | REDUCED_TF | UNKNOWN */
  fee_status: string;
  ticket_adhoc: string;
  ticket_systematic: string;
  family_surcharge: string;
  short_term_fee_pct: string;
  short_term_fee_flat: string;
  short_term_min: string;
  short_term_max: string;
  short_term_days: string;
  abp_exempt: string;
  as_of_date: string;
  source: string;
}

/** Client holding row (holdings CSV — also the shape of an uploaded book export). */
export interface HoldingRow {
  /** Stable household key used for aggregation (an id, not a display value). */
  household_id: string;
  /** Human-readable household name for display; falls back to household_id. */
  household_name?: string;
  account_id: string;
  account_name: string;
  advisor: string;
  registration_type: string;
  custodian: string;
  platform: string;
  advisory_or_brokerage: string;
  has_recordkeeper: string;
  held_away: string;
  ticker: string;
  shares: string;
  price: string;
  market_value: string;
  cost_basis: string;
  acquisition_date: string;
  lot_fee_status: string;
  systematic_plan: string;
  systematic_freq: string;
  beneficiary_age: string;
  expected_holding_years: string;
}

/** The engine's decision for a position. */
export type Action =
  | "CONVERT"
  | "NO_CHANGE"
  | "REVIEW_TAX"
  | "DATA_GAP"
  | "PENDING_CUSTODIAN_DATA"
  | "HELD_AWAY_ADVISE"
  | "SUPPRESSED";

/** All-in annual cost breakdown for one share class at one custodian. */
export interface Cost {
  er: number;
  ticket: number;
  abp: number;
  perTrade: number;
  abpBps: number;
  total: number;
  /** True when custodian data was UNKNOWN, so only the expense ratio is compared. */
  erOnly?: boolean;
  /** Context only — the assumed per-trade ticket, never baked into `total`. */
  assumedPerTrade?: number;
}

/** One sibling share class considered as a conversion candidate. */
export interface Candidate {
  cls: FundRow;
  av?: AvailRow;
  eligible: boolean;
  priced: boolean;
  cost?: Cost;
  reason: string;
}

/** One-time cost of moving from the current class to the recommended one. */
export interface Transition {
  total: number;
  parts: string[];
  unknown: boolean;
}

/** The full analysis result for one holding — the record a reviewer would need. */
export interface AnalysisResult {
  h: HoldingRow;
  mv: number;
  current?: FundRow;
  candidates: Candidate[];
  flags: string[];
  action: Action;
  reason: string;
  savings: number;
  deltaBps: number;
  curAv?: AvailRow;
  curCost?: Cost;
  trades?: number;
  hhValue?: number;
  best?: Candidate;
  transition?: Transition;
  paybackMonths?: number;
  gain?: number;
}
