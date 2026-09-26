// Share Class Analysis engine — a faithful TypeScript port of the prototype's decision
// logic. For each holding it prices every eligible share class of the same fund ALL-IN
// (expense ratio + per-trade ticket charges + asset-based platform fee), then walks a
// gated decision tree. Core principle: unknown is never zero — a missing expense ratio
// or missing custodian fee status yields DATA_GAP / PENDING_CUSTODIAN_DATA, never a
// guessed number. It flags positions for human review; it never renders a verdict.

import { CONFIG } from "./config";
import { num, fmt$, fmt$2 } from "./format";
import type {
  AnalysisResult,
  AvailRow,
  Candidate,
  Cost,
  FundRow,
  HoldingRow,
  RawRow,
  Transition,
} from "./types";

interface Indexes {
  fundByTicker: Record<string, FundRow>;
  fundsByGroup: Record<string, FundRow[]>;
  availByKey: Record<string, AvailRow>;
  holdings: HoldingRow[];
}

function buildIndexes(
  rawFunds: RawRow[],
  rawAvail: RawRow[],
  rawHoldings: RawRow[],
): Indexes {
  const fundByTicker: Record<string, FundRow> = {};
  const fundsByGroup: Record<string, FundRow[]> = {};
  for (const raw of rawFunds) {
    const f: FundRow = {
      ...(raw as unknown as FundRow),
      // Blank means UNKNOWN, never 0 — a missing ER must become DATA_GAP, not "free fund".
      net_expense_ratio: raw.net_expense_ratio === "" ? NaN : +raw.net_expense_ratio,
      min_initial: +raw.min_initial || 0,
    };
    fundByTicker[f.ticker] = f;
    (fundsByGroup[f.fund_group_id] ||= []).push(f);
  }
  const availByKey: Record<string, AvailRow> = {};
  for (const raw of rawAvail) {
    availByKey[raw.ticker + "|" + raw.custodian] = raw as unknown as AvailRow;
  }
  return {
    fundByTicker,
    fundsByGroup,
    availByKey,
    holdings: rawHoldings as unknown as HoldingRow[],
  };
}

function tradesPerYear(h: HoldingRow): number {
  if (h.systematic_plan !== "Y") return 0;
  return CONFIG.freq[h.systematic_freq] ?? 0;
}

// Household holdings in the same fund — the simple aggregation used for minimums.
// NOTE: real Rights of Accumulation rules are set per fund family and vary widely.
function householdFundValue(h: HoldingRow, ix: Indexes): number {
  const grp = ix.fundByTicker[h.ticker]?.fund_group_id;
  return ix.holdings
    .filter(
      (x) =>
        x.household_id === h.household_id &&
        ix.fundByTicker[x.ticker]?.fund_group_id === grp,
    )
    .reduce((s, x) => s + num(x.market_value), 0);
}

function annualCost(
  mv: number,
  cls: FundRow,
  av: AvailRow,
  custodian: string,
  trades: number,
): Cost {
  const er = (cls.net_expense_ratio / 100) * mv;
  // UNKNOWN fee status (real mode, custodian file pending): compare on ER only.
  // The assumed ticket schedule is shown as context in the audit trail but is
  // never baked into a number the tool asserts.
  if (av.fee_status === "UNKNOWN") {
    const a = CONFIG.assumedTickets[custodian];
    return {
      er,
      ticket: 0,
      abp: 0,
      perTrade: 0,
      abpBps: 0,
      total: er,
      erOnly: true,
      assumedPerTrade: a ? num(a.sys) : 0,
    };
  }
  const perTrade = num(av.ticket_systematic) + num(av.family_surcharge);
  const ticket = trades * perTrade;
  const abpBps = CONFIG.abpBps[custodian] ?? 0;
  const abp = av.abp_exempt === "Y" ? 0 : (abpBps / 10000) * mv;
  return { er, ticket, abp, perTrade, abpBps, total: er + ticket + abp };
}

function checkEligibility(
  h: HoldingRow,
  cls: FundRow,
  hhValue: number,
): { ok: boolean; reason: string } {
  if (cls.eligible_registrations !== "ALL") {
    const allowed = cls.eligible_registrations.split("|");
    if (!allowed.includes(h.registration_type))
      return {
        ok: false,
        reason: `Class ${cls.share_class} is not offered to ${h.registration_type} registrations by ${cls.fund_family}. Eligible: ${allowed.join(", ")}.`,
      };
  }
  if (cls.requires_advisory === "Y" && h.advisory_or_brokerage !== "ADVISORY")
    return {
      ok: false,
      reason: `Class ${cls.share_class} requires a fee-based advisory account; this is a ${h.advisory_or_brokerage} account.`,
    };
  if (cls.requires_recordkeeper === "Y" && h.has_recordkeeper !== "Y")
    return {
      ok: false,
      reason: `Class ${cls.share_class} requires a plan serviced by a retirement recordkeeper; this account has none.`,
    };
  if (cls.closed_to_new === "Y")
    return {
      ok: false,
      reason: `Class ${cls.share_class} is closed to new investors.`,
    };
  if (cls.min_initial > 0 && hhValue < cls.min_initial)
    return {
      ok: false,
      reason: `Minimum ${fmt$(cls.min_initial)} not met — household holds ${fmt$(hhValue)} in this fund.`,
    };
  return {
    ok: true,
    reason: `Eligible.${cls.min_initial > 0 ? ` Minimum ${fmt$(cls.min_initial)} met via household aggregation (${fmt$(hhValue)}).` : ""}`,
  };
}

// One-time cost of actually moving from the current class to the recommended one.
// Fidelity assigns NTF/TF status at purchase and carries it on the lot, so the lot's
// recorded status (when present) governs sell-side charges — not the fund's status today.
function transitionOneTime(
  h: HoldingRow,
  cur: FundRow,
  curAv: AvailRow,
  best: Candidate | undefined,
  mv: number,
  sameFund: boolean,
  convertible: boolean,
): Transition {
  const parts: string[] = [];
  let total = 0;
  let unknown = false;
  const heldDays = h.acquisition_date
    ? Math.floor((Date.now() - new Date(h.acquisition_date).getTime()) / 86400000)
    : null;

  // CDSC applies whether the exit is a redemption or an early voluntary conversion —
  // many families disallow or charge CDSC on conversions out of a CDSC-bearing class
  // before the window ends. Checked before the same-fund shortcut on purpose.
  const cdscPct = num(cur.cdsc_pct),
    cdscMonths = num(cur.cdsc_months),
    thresh = num(cur.cdsc_threshold);
  const inCdscWindow =
    cdscPct > 0 &&
    cdscMonths > 0 &&
    heldDays !== null &&
    heldDays < cdscMonths * 30.44 &&
    (thresh === 0 || mv >= thresh);
  if (inCdscWindow) {
    const cdsc = (cdscPct / 100) * mv;
    total += cdsc;
    parts.push(
      `CDSC ${cdscPct}% ≈ ${fmt$2(cdsc)} — still inside the ${cdscMonths}-month window (computed here on market value; prospectuses typically charge on the lesser of purchase price and value). Many families disallow or charge CDSC on early voluntary moves out of a CDSC-bearing class — confirm with the fund before acting.`,
    );
  }

  if (sameFund && convertible) {
    parts.push(
      "Same-fund conversion — typically processed as an automated no-charge transaction. Confirm processing method with the custodian: a conversion mis-processed as sell/buy without identifiers can create tax-reporting problems.",
    );
    return { total, parts, unknown: false };
  }
  const lotStatus = h.lot_fee_status || curAv.fee_status;
  if (curAv.fee_status === "UNKNOWN") {
    unknown = true;
    parts.push("Sell-side ticket unknown — custodian fee schedule pending.");
  } else if (lotStatus === "TF" || lotStatus === "REDUCED_TF") {
    const t = num(curAv.ticket_adhoc) + num(curAv.family_surcharge);
    if (t > 0) {
      total += t;
      parts.push(
        `Sell ticket ${fmt$2(t)} — lot fee status ${lotStatus}${h.lot_fee_status && h.lot_fee_status !== curAv.fee_status ? ` (assigned at purchase; the fund's status at this custodian is now ${curAv.fee_status} — the lot status governs)` : ""}.`,
      );
    }
  } else if (lotStatus === "NTF") {
    const win = num(curAv.short_term_days);
    if (win > 0 && heldDays !== null && heldDays < win) {
      let fee = num(curAv.short_term_fee_flat);
      const pct = num(curAv.short_term_fee_pct);
      if (pct > 0) {
        fee = (pct / 100) * mv;
        const mn = num(curAv.short_term_min),
          mx = num(curAv.short_term_max);
        if (mn > 0) fee = Math.max(fee, mn);
        if (mx > 0) fee = Math.min(fee, mx);
      }
      if (fee > 0) {
        total += fee;
        parts.push(
          `Short-term redemption fee ${fmt$2(fee)} — NTF shares held ${heldDays} days, inside this custodian's ${win}-day window.`,
        );
      }
    }
  }
  if (best && best.av) {
    if (best.av.fee_status === "UNKNOWN") {
      unknown = true;
      parts.push("Buy-side ticket unknown — custodian fee schedule pending.");
    } else if (best.av.fee_status === "TF" || best.av.fee_status === "REDUCED_TF") {
      const t = num(best.av.ticket_adhoc) + num(best.av.family_surcharge);
      if (t > 0) {
        total += t;
        parts.push(`Buy ticket ${fmt$2(t)} for ${best.cls.ticker}.`);
      }
    }
  }
  if (!parts.length) parts.push("No one-time transition charges identified.");
  return { total, parts, unknown };
}

function analyze(h: HoldingRow, ix: Indexes): AnalysisResult {
  const mv = num(h.market_value);
  const cur = ix.fundByTicker[h.ticker];
  const base: AnalysisResult = {
    h,
    mv,
    current: cur,
    candidates: [],
    flags: [],
    action: "DATA_GAP",
    reason: "",
    savings: 0,
    deltaBps: 0,
  };

  // --- Gate 1: actionability -------------------------------------------------
  // Registration-specific reasons take precedence over the generic held-away reason,
  // because the specific reason is the one a reviewer needs to see.
  if (CONFIG.notActionable[h.registration_type]) {
    return {
      ...base,
      action: "SUPPRESSED",
      reason: CONFIG.notActionable[h.registration_type],
      savings: 0,
      deltaBps: 0,
    };
  }
  if (h.held_away === "Y") {
    return {
      ...base,
      action: "HELD_AWAY_ADVISE",
      reason:
        "Held-away asset. The plan sponsor or recordkeeper controls the investment menu — the adviser cannot transact. Surface as a client talking point only.",
      savings: 0,
      deltaBps: 0,
    };
  }
  if (!cur) {
    return {
      ...base,
      action: "DATA_GAP",
      reason: `Ticker ${h.ticker} not found in fund reference data.`,
      savings: 0,
      deltaBps: 0,
    };
  }

  // --- Gate 2: current position availability --------------------------------
  const curAv = ix.availByKey[h.ticker + "|" + h.custodian];
  if (!curAv || !curAv.fee_status) {
    return {
      ...base,
      action: "DATA_GAP",
      reason: `No fee status for ${h.ticker} at ${h.custodian} in the availability file. Cannot compute current cost without it — not guessing.`,
      savings: 0,
      deltaBps: 0,
    };
  }
  if (isNaN(cur.net_expense_ratio)) {
    return {
      ...base,
      curAv,
      action: "DATA_GAP",
      reason: `The expense ratio for ${h.ticker} is missing from the fund reference data (source: ${cur.source || "—"}). Cannot compute cost — not guessing.`,
      savings: 0,
      deltaBps: 0,
    };
  }

  const trades = tradesPerYear(h);
  const hhValue = householdFundValue(h, ix);
  const curCost = annualCost(mv, cur, curAv, h.custodian, trades);

  // Flag when the client appears ineligible for the class they already hold
  // (legacy/grandfathered positions — e.g. R6 sitting in a rollover IRA).
  const curEl = checkEligibility(h, cur, hhValue);
  if (!curEl.ok)
    base.flags.push(
      `CURRENT CLASS ELIGIBILITY: this account appears ineligible for the class it already holds (${curEl.reason}) — likely a legacy or grandfathered position carried from a prior context. Worth compliance review independent of cost.`,
    );

  // --- Gate 3+4: evaluate every class in the same fund ------------------------
  const siblings = (ix.fundsByGroup[cur.fund_group_id] || []).filter(
    (c) => c.ticker !== cur.ticker,
  );
  let dataGap: string | null = null;

  for (const cls of siblings) {
    const av = ix.availByKey[cls.ticker + "|" + h.custodian];
    if (!av || !av.fee_status) {
      dataGap = `Cannot price ${cls.ticker} (Class ${cls.share_class}) — no fee status at ${h.custodian} in the availability file.`;
      base.candidates.push({
        cls,
        eligible: false,
        priced: false,
        reason: `DATA GAP — ${cls.ticker} has no fee status at ${h.custodian}. Unknown, not assumed.`,
      });
      continue;
    }
    if (isNaN(cls.net_expense_ratio)) {
      base.candidates.push({
        cls,
        av,
        eligible: false,
        priced: false,
        reason: `DATA GAP — expense ratio for ${cls.ticker} missing from fund reference data. Unknown, not assumed.`,
      });
      continue;
    }
    const el = checkEligibility(h, cls, hhValue);
    if (!el.ok) {
      base.candidates.push({ cls, av, eligible: false, priced: false, reason: el.reason });
      continue;
    }
    const cost = annualCost(mv, cls, av, h.custodian, trades);
    base.candidates.push({ cls, av, eligible: true, priced: true, cost, reason: el.reason });
  }

  const priced = base.candidates.filter((c) => c.priced);
  const cheapest = priced.sort(
    (a, b) => (a.cost as Cost).total - (b.cost as Cost).total,
  )[0];

  // If a class couldn't be priced, we cannot claim to know the cheapest.
  if (dataGap) {
    return {
      ...base,
      curAv,
      curCost,
      trades,
      hhValue,
      action: "DATA_GAP",
      reason:
        dataGap +
        " The cheapest eligible class cannot be determined until this is supplied.",
      savings: 0,
      deltaBps: 0,
    };
  }
  if (!cheapest || (cheapest.cost as Cost).total >= curCost.total) {
    let why =
      priced.length === 0
        ? "No other share class of this fund is both available at this custodian and eligible for this registration."
        : `Already in the lowest all-in cost eligible class. Cheaper-expense-ratio alternatives exist but cost more once ticket charges and platform fees are included.`;
    if (curCost.erOnly)
      why =
        priced.length === 0
          ? why
          : "Already in the lowest expense-ratio eligible class (ER-only comparison — custodian fee data pending, which could change relative all-in costs).";
    return {
      ...base,
      curAv,
      curCost,
      trades,
      hhValue,
      action: "NO_CHANGE",
      reason: why,
      savings: 0,
      deltaBps: 0,
      best: cheapest,
    };
  }

  const savings = curCost.total - (cheapest.cost as Cost).total;
  const deltaBps = (savings / mv) * 10000;
  const erOnly = curCost.erOnly || (cheapest.cost as Cost).erOnly;

  // --- Gate 5: tax -----------------------------------------------------------
  const taxAdv = CONFIG.taxAdvantaged.includes(h.registration_type);
  const sameFund = cheapest.cls.fund_group_id === cur.fund_group_id;
  const convertible =
    cheapest.cls.conversion_supported === "Y" && cur.conversion_supported === "Y";
  const gain = mv - num(h.cost_basis);
  const transition = transitionOneTime(h, cur, curAv, cheapest, mv, sameFund, convertible);
  const paybackMonths =
    transition.total > 0 && savings > 0 ? transition.total / (savings / 12) : 0;
  const transNote =
    transition.total > 0
      ? ` One-time transition cost ≈ ${fmt$2(transition.total)} (payback ~${paybackMonths < 1 ? "<1 month" : Math.ceil(paybackMonths) + " months"}).`
      : "";

  if (!taxAdv && sameFund && !convertible) {
    return {
      ...base,
      curAv,
      curCost,
      trades,
      hhValue,
      best: cheapest,
      savings,
      deltaBps,
      transition,
      paybackMonths,
      action: "REVIEW_TAX",
      reason: `${cur.fund_family} does not support a same-fund conversion for this pair, so reaching ${cheapest.cls.ticker} requires a sell and re-buy in a taxable account — realizing an estimated ${fmt$(gain)} gain. Cost saving is ${fmt$(savings)}/yr${erOnly ? " (ER-only — custodian fee data pending)" : ""}; the tax cost is a client-specific decision this tool does not make.${transNote}`,
      gain,
    };
  }

  const taxNote = taxAdv
    ? `No current tax consequence — ${h.registration_type} is tax-advantaged, so a sell/re-buy works even where a conversion isn't offered.`
    : `Same-fund share class conversion — generally not a realization event, so no gain is expected to be triggered.`;

  // Custodian data pending: a cheaper-ER eligible class exists, but NTF status and
  // ticket economics are unknown, so this cannot be asserted as a net saving yet.
  if (erOnly) {
    return {
      ...base,
      curAv,
      curCost,
      trades,
      hhValue,
      best: cheapest,
      savings,
      deltaBps,
      transition,
      paybackMonths,
      action: "PENDING_CUSTODIAN_DATA",
      gain,
      reason: `${cheapest.cls.ticker} (Class ${cheapest.cls.share_class}) is eligible with a lower expense ratio (ER-only comparison). NTF/TF status and ticket charges at ${h.custodian} are unknown pending the custodian availability file — ticket economics could narrow or reverse this. ${taxNote}${transNote}`,
    };
  }

  return {
    ...base,
    curAv,
    curCost,
    trades,
    hhValue,
    best: cheapest,
    savings,
    deltaBps,
    transition,
    paybackMonths,
    action: "CONVERT",
    gain,
    reason: `${cheapest.cls.ticker} (Class ${cheapest.cls.share_class}) is eligible and cheaper all-in. ${taxNote}${transNote}`,
  };
}

/** Build indexes and run the engine over every holding. Pure — no globals, no DOM. */
export function analyzeBook(
  rawFunds: RawRow[],
  rawAvail: RawRow[],
  rawHoldings: RawRow[],
): AnalysisResult[] {
  const ix = buildIndexes(rawFunds, rawAvail, rawHoldings);
  return ix.holdings.map((h) => analyze(h, ix));
}
