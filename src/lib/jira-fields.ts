/**
 * Jira ticket field vocabulary — no credentials, safe to import from client
 * components.
 *
 * Deliberately split from `lib/jira.ts`: that module reads ATLASSIAN_API_TOKEN,
 * and the ticket modal needs these option lists for its dropdowns. Keeping them
 * in one file would mean a client component importing the token-reading module,
 * which is how secrets end up in a browser bundle.
 */

export const JIRA_TEAM = { key: "OPS", label: "Operations" } as const;

// Request types mirror the ticket templates in prisma/seed.ts so the Jira queue and
// the app's own Ticket table describe the same work in the same words.
export const REQUEST_TYPES = [
  "Wire transfer verification",
  "Cost basis correction",
  "Beneficiary update request",
  "Address change request",
  "New account — missing documents",
  "Advisor transition — account reassignment",
  "Orion household grouping incorrect",
  "Orion performance data mismatch",
  "Principal trade approval — fixed income",
  "Cross trade review between client accounts",
  "Other",
] as const;

export const PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;

export const CUSTODIANS = ["Pershing", "Schwab", "Fidelity"] as const;

export type RequestType = (typeof REQUEST_TYPES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Custodian = (typeof CUSTODIANS)[number];
