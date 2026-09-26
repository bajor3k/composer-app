// Firm-level inputs for the Share Class Analysis engine. Real values are negotiated
// and non-public — these are the prototype's documented placeholders. The Pershing
// asset-based-pricing figure materially changes NTF-vs-TF outcomes; it is the clearest
// example of why this tool cannot be built from public data alone.

export interface ShareClassConfig {
  /** Asset-based pricing, bps/yr, by custodian. */
  abpBps: Record<string, number>;
  /** Systematic trade frequency label → trades per year. */
  freq: Record<string, number>;
  /**
   * Assumed TF ticket schedule for REAL mode, where actual custodian availability is
   * unknown. Shown as context only — never baked into a PENDING comparison's number.
   */
  assumedTickets: Record<string, { adhoc: number; sys: number }>;
  /** Registrations where buying/selling has no current tax consequence. */
  taxAdvantaged: string[];
  /** Registrations the adviser cannot action even when a cheaper class exists. */
  notActionable: Record<string, string>;
}

export const CONFIG: ShareClassConfig = {
  abpBps: { PERSHING: 3.75, SCHWAB: 0, FIDELITY: 0 },
  freq: { MONTHLY: 12, QUARTERLY: 4, ANNUAL: 1, NONE: 0 },
  assumedTickets: {
    SCHWAB: { adhoc: 45, sys: 45 },
    PERSHING: { adhoc: 35, sys: 0 },
    FIDELITY: { adhoc: 30, sys: 5 },
  },
  taxAdvantaged: [
    "IRA_TRAD",
    "IRA_ROTH",
    "IRA_SEP",
    "IRA_SIMPLE",
    "IRA_INHERITED",
    "PLAN_401K",
    "PLAN_403B",
    "PLAN_457",
    "PLAN_SOLO_K",
    "HSA",
    "529_ADVISOR",
    "529_DIRECT",
  ],
  notActionable: {
    DAF: "Donor-advised fund assets are legally owned and controlled by the sponsoring charity; the investment menu is the sponsor's. Not the adviser's to convert.",
    "529_DIRECT":
      "Direct-sold 529 plan — no advisor share classes exist and the plan is not custodied here. Nothing to convert.",
  },
};
