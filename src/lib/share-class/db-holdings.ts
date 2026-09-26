// Loads real Composer positions for the Share Class engine.
//
// The engine identifies a fund purely by ticker (share class, expense ratio, and
// eligibility all come from the fund reference), so a holding only needs to carry its
// symbol plus the account context. Everything else — registration type, custodian,
// advisory vs brokerage — is recovered from the account.
//
// Only securities the fund reference can price are loaded; pulling every holding would
// return thousands of stocks and ETFs as DATA_GAP noise and bury the real findings.

import { supabase } from "@/lib/supabase";
import { paginateQuery } from "@/lib/supabase-paginate";
import { parseCSV } from "./csv";
import { REAL_FUND_CSV } from "./data/real";
import type { RawRow } from "./types";

// Composer AccountType → the registration codes the engine's eligibility rules use
// (see CONFIG.taxAdvantaged and the fund reference's eligible_registrations column).
const REGISTRATION_BY_ACCOUNT_TYPE: Record<string, string> = {
  individual: "INDIVIDUAL",
  joint: "JOINT",
  ira: "IRA_TRAD",
  roth_ira: "IRA_ROTH",
  sep_ira: "IRA_SEP",
  simple_ira: "IRA_SIMPLE",
  trust: "TRUST_GRANTOR",
  estate: "ESTATE",
  custodial: "UTMA",
  k401: "PLAN_401K",
  k403b: "PLAN_403B",
  pension: "PENSION",
  corporate: "CORPORATE",
  llc: "LLC",
  partnership: "PARTNERSHIP",
};

interface DbHolding {
  accountId: string;
  symbol: string;
  name: string | null;
  quantity: number | string | null;
  price: number | string | null;
  marketValue: number | string | null;
  costBasis: number | string | null;
  purchaseDate: string | null;
}

interface DbAccount {
  id: string;
  account_number: string | null;
  account_name: string | null;
  account_type: string | null;
  custodian: string | null;
  is_managed: boolean | null;
  household_id: string | null;
  household_name: string | null;
  rep_code: string | null;
}

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const dateOnly = (v: string | null): string => (v ? v.slice(0, 10) : "");

/**
 * Rep code → advisor name, so the Advisor filter reads "Andrew Stanton" rather than
 * "GF5". Non-fatal: if the lookup fails the caller falls back to rep codes rather than
 * losing the whole book.
 */
async function fetchAdvisorNames(): Promise<Map<string, string>> {
  try {
    const { data, error } = await supabase.from("Advisor").select("repCode, user:User(name)");
    if (error || !data) return new Map();
    // PostgREST types embeds as arrays (they can be one-to-many); Advisor→User is
    // many-to-one and comes back as a single object. Handle either shape.
    type Embedded = { name: string | null } | { name: string | null }[] | null;
    const map = new Map<string, string>();
    for (const row of data as unknown as { repCode: string | null; user: Embedded }[]) {
      const code = str(row.repCode);
      const user = Array.isArray(row.user) ? row.user[0] : row.user;
      const name = str(user?.name);
      if (code && name) map.set(code, name);
    }
    return map;
  } catch {
    return new Map();
  }
}

/** Fetch the firm's fund positions mapped into the engine's holding shape. */
export async function fetchDbHoldings(): Promise<RawRow[]> {
  const tickers = [
    ...new Set(parseCSV(REAL_FUND_CSV).map((f) => f.ticker).filter(Boolean)),
  ];
  if (!tickers.length) return [];

  const holdings = await paginateQuery<DbHolding>((from, to) =>
    supabase
      .from("holdings_enriched")
      .select("accountId, symbol, name, quantity, price, marketValue, costBasis, purchaseDate")
      .in("symbol", tickers)
      .range(from, to),
  );
  if (!holdings.length) return [];

  const accountIds = [...new Set(holdings.map((h) => h.accountId))];
  const accounts = await paginateQuery<DbAccount>((from, to) =>
    supabase
      .from("portfolio_accounts")
      .select(
        "id, account_number, account_name, account_type, custodian, is_managed, household_id, household_name, rep_code",
      )
      .in("id", accountIds)
      .range(from, to),
  );
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const advisorNames = await fetchAdvisorNames();

  const rows: RawRow[] = [];
  for (const h of holdings) {
    const a = byId.get(h.accountId);
    // No account context (inactive/not visible) — skip rather than invent one.
    if (!a) continue;

    const accountType = str(a.account_type).toLowerCase();
    const repCode = str(a.rep_code);
    rows.push({
      // Group on the stable id; show the name. Household names happen to be unique
      // today, but aggregation must not silently merge two households if that changes.
      household_id: str(a.household_id || a.household_name),
      household_name: str(a.household_name || a.household_id),
      account_id: str(a.account_number),
      account_name: str(a.account_name),
      advisor: advisorNames.get(repCode) || repCode,
      // The views expose display-cased values ("Schwab", "roth_ira"); the engine keys
      // its custodian pricing and eligibility rules off its own uppercase codes.
      registration_type:
        REGISTRATION_BY_ACCOUNT_TYPE[accountType] ?? accountType.toUpperCase(),
      custodian: str(a.custodian).toUpperCase(),
      platform: "ADVISOR",
      advisory_or_brokerage: a.is_managed ? "ADVISORY" : "BROKERAGE",
      // Not modelled in Composer yet — the engine treats these as absent, not assumed.
      has_recordkeeper: "N",
      held_away: "N",
      ticker: str(h.symbol),
      shares: str(h.quantity),
      price: str(h.price),
      market_value: str(h.marketValue),
      cost_basis: str(h.costBasis),
      acquisition_date: dateOnly(h.purchaseDate),
      lot_fee_status: "",
      systematic_plan: "N",
      systematic_freq: "NONE",
      beneficiary_age: "",
      expected_holding_years: "",
    });
  }
  return rows;
}
