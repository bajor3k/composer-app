import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentKey } from "@/lib/ai/agent-definitions";

/**
 * The authored definition of each Foundry agent — the repo is the source of truth,
 * and `npm run agents:sync` pushes it.
 *
 * SCRIPT-ONLY. This module touches the filesystem, so nothing under src/app may
 * import it. The running app never needs an agent's instructions; it only needs the
 * id, which comes from AGENT_REGISTRY in agent-definitions.ts.
 */

export interface AgentDefinition {
  key: AgentKey;
  name: string;
  description: string;
  model: string;
  /**
   * Filename under src/lib/ai/instructions. OPTIONAL, and that is load-bearing:
   * an agent that omits it has its instructions left exactly as they are in Foundry,
   * and the update payload physically cannot carry an `instructions` field.
   *
   * Foundry keeps no version history. Overwriting the workspace agent's instructions
   * with a stale or truncated copy would silently degrade every AI path in the app —
   * workspace chat, case workspaces, canvas contexts, @agent mentions, the report
   * builder — with no error and nothing to point at. Omitting the field makes that
   * payload unconstructible rather than merely unlikely.
   */
  instructionsFile?: string;
}

export const AGENT_DEFINITIONS: AgentDefinition[] = [
  {
    key: "workspace",
    name: "Workspace Agent",
    description:
      "Answers open-ended questions across the book of business on the workspace page, using tools over households, accounts, holdings, and account detail. In a case workspace it reviews the one account in context with several humans in the thread. Covers margin and calls, cost basis integrity, concentration, fees, and reconciliation. Surfaces operational and data-integrity findings only; no investment, tax, or suitability advice.",
    model: "gpt-5",
    // instructionsFile deliberately omitted — see AgentDefinition above. This agent's
    // instructions are still authored in the Foundry portal and are being revised
    // separately; the sync must never touch them.
  },
  {
    key: "alerts",
    name: "Alerts Agent",
    description:
      "Turns a plain-English request into one Composer alert rule — maps it to a single condition in the holding, balance, performance, or activity families, resolves scope to an account, a household, or the whole book, and calls propose_alert. It never writes to the database: the advisor confirms the proposal in chat and Composer re-validates and persists it. It cannot read, modify, or delete existing alerts.",
    model: "gpt-5",
    instructionsFile: "alerts-agent.md",
  },
  {
    key: "reports",
    name: "Reports Agent",
    description:
      "Turns a plain-English request into one saved Composer report — picks a report from the 47-entry catalog supplied per run, binds its declared inputs, resolves scope to an account, a household, or the whole book, sets a cadence, and calls propose_saved_report. It never writes to the database: the advisor confirms the proposal in chat and Composer re-validates and persists it. It cannot read, modify, run, or delete existing reports.",
    model: "gpt-5",
    instructionsFile: "reports-agent.md",
  },
];

const INSTRUCTIONS_DIR = join(process.cwd(), "src", "lib", "ai", "instructions");

export function loadInstructions(def: AgentDefinition): string | undefined {
  if (!def.instructionsFile) return undefined;
  const path = join(INSTRUCTIONS_DIR, def.instructionsFile);
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    throw new Error(
      `Instructions for "${def.key}" not found at ${path}. Run npm scripts from the repo root.`
    );
  }
}

/**
 * The payload sent to Foundry. `tools: []` is explicit because tool schemas ship
 * per-run from src/lib/ai/agent-tools.ts — an agent-level definition added by hand in
 * the portal would silently double them. Sending an empty array on every sync makes
 * the repo the winner.
 */
export function agentPayload(def: AgentDefinition): Record<string, unknown> {
  const instructions = loadInstructions(def);
  return {
    name: def.name,
    description: def.description,
    model: def.model,
    tools: [],
    ...(instructions === undefined ? {} : { instructions }),
  };
}
