// Shared @agent menu definitions — one source of truth for every composer
// that offers agent mentions (side chat panel, case workspace) and for the
// case header's assigned-agent selector.

export type AgentDef = { name: string; label: string; description: string };

// One Composer agent serves every mention. These are lenses on it, not separate
// agents — the mention steers which review it leads with. The market/news/help/crm
// entries were "coming soon" stubs and are gone.
export const AGENTS: AgentDef[] = [
  { name: "audit", label: "Audit", description: "Account Review" },
  { name: "margin", label: "Margin", description: "Margin & Balances Review" },
  { name: "costbasis", label: "Cost Basis", description: "Cost Basis Audit" },
];

export const CASE_AGENT_NAMES = ["margin", "costbasis", "audit"] as const;

export const AGENT_DISPLAY_NAMES: Record<string, string> = Object.fromEntries(
  AGENTS.map((a) => [a.name, a.label])
);
