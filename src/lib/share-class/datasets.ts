// Loads the tool's dataset: real fund data extracted from SEC 485BPOS filings. There is
// NO custodian availability truth, so it synthesizes UNKNOWN-status rows — the engine then
// compares on expense ratio only and reports PENDING_CUSTODIAN_DATA rather than asserting a
// saving it cannot yet defend.

import { CONFIG } from "./config";
import { parseCSV } from "./csv";
import { REAL_FUND_CSV, REAL_HOLD_CSV } from "./data/real";
import type { RawRow } from "./types";

export interface Dataset {
  funds: RawRow[];
  avail: RawRow[];
  holdings: RawRow[];
}

// No custodian availability truth. Generate rows with UNKNOWN fee status so the engine
// compares on ER only and flags PENDING_CUSTODIAN_DATA.
function buildAssumedAvailability(funds: RawRow[]): RawRow[] {
  const rows: RawRow[] = [];
  for (const f of funds) {
    for (const c of ["SCHWAB", "PERSHING", "FIDELITY"]) {
      const a = CONFIG.assumedTickets[c];
      rows.push({
        ticker: f.ticker,
        custodian: c,
        platform: "ADVISOR",
        fee_status: "UNKNOWN",
        ticket_adhoc: String(a.adhoc),
        ticket_systematic: String(a.sys),
        family_surcharge: "0",
        short_term_fee_pct: "0",
        short_term_fee_flat: "0",
        short_term_min: "0",
        short_term_max: "0",
        short_term_days: "0",
        abp_exempt: "N",
        as_of_date: "",
        source: "ASSUMED — pending custodian availability file",
      });
    }
  }
  return rows;
}

export function loadDataset(): Dataset {
  const funds = parseCSV(REAL_FUND_CSV);
  return {
    funds,
    avail: buildAssumedAvailability(funds),
    holdings: parseCSV(REAL_HOLD_CSV),
  };
}
