// Custodians / clearing firms supported in the UI. Single source of truth for the
// header CustodianSwitcher and the chat hero toggle. "All" is an aggregate option
// (every custodian). Switching isn't wired to data yet — selecting updates the label
// (persisted to localStorage + broadcast) only.
export const CUSTODIANS = ["All", "Pershing", "Schwab", "Fidelity"] as const;
export type Custodian = (typeof CUSTODIANS)[number];

// Color used wherever the custodian name is shown as a toggle (chat hero + header
// switcher). Real brand colors for each firm; "All" gets a bright orange-red so the
// aggregate option stands apart from the individual custodians.
export const CUSTODIAN_COLORS: Record<string, string> = {
  Pershing: "#2B9CAE", // BNY Pershing teal
  Schwab: "#009EDC", // Charles Schwab blue
  Fidelity: "#368727", // Fidelity green
  All: "#FF4D2E", // bright orange-red — the aggregate option
};

// Next custodian in the list, wrapping around. Unknown values restart at the first.
export function nextCustodian(current: string): Custodian {
  const i = CUSTODIANS.indexOf(current as Custodian);
  return CUSTODIANS[(i + 1) % CUSTODIANS.length];
}
