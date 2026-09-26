import { api } from "@/lib/ai/foundry-client";
import { agentPayload, type AgentDefinition } from "@/lib/ai/foundry-agents";

/**
 * Create/read/update for Foundry agents themselves, as opposed to azure-agent.ts
 * which runs them. Used by `npm run agents:sync`.
 *
 * SCRIPT-ONLY — imports foundry-agents, which reads the filesystem.
 */

export interface LiveAgent {
  id: string;
  name?: string;
  description?: string;
  model?: string;
  instructions?: string;
  tools?: unknown[];
}

export async function listAgents(): Promise<LiveAgent[]> {
  const res = await api<{ data: LiveAgent[] }>("GET", "/assistants");
  return res.data ?? [];
}

export async function createAgent(def: AgentDefinition): Promise<LiveAgent> {
  return api<LiveAgent>("POST", "/assistants", agentPayload(def));
}

export async function updateAgent(id: string, def: AgentDefinition): Promise<LiveAgent> {
  return api<LiveAgent>("POST", `/assistants/${id}`, agentPayload(def));
}

export interface FieldDiff {
  field: string;
  from: string;
  to: string;
}

/**
 * Compares only the fields the definition actually declares. A field the definition
 * omits — `instructions` on the workspace agent — is reported as unmanaged rather
 * than as a difference, so it can never be mistaken for something the sync will fix.
 */
export function diffAgent(live: LiveAgent, def: AgentDefinition): FieldDiff[] {
  const payload = agentPayload(def);
  const diffs: FieldDiff[] = [];

  for (const field of ["name", "description", "model", "instructions"] as const) {
    if (!(field in payload)) continue;
    const to = String(payload[field] ?? "");
    const from = String(live[field] ?? "");
    if (from !== to) diffs.push({ field, from: preview(from), to: preview(to) });
  }

  const liveTools = live.tools ?? [];
  if (liveTools.length > 0) {
    diffs.push({ field: "tools", from: `${liveTools.length} defined on agent`, to: "[] (shipped per-run)" });
  }

  return diffs;
}

function preview(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > 90 ? `${flat.slice(0, 90)}…  [${value.length} chars]` : flat || "(empty)";
}
