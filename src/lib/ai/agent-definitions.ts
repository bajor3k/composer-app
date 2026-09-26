/**
 * Which Foundry agent backs which surface.
 *
 * Composer runs three dedicated agents rather than one general one, because their
 * jobs pull in different directions: the workspace agent answers open questions
 * across the book, while the alerts and reports agents each drive toward a single
 * structured proposal and need instructions that say so.
 *
 * This module is deliberately dependency-free — both the app (azure-agent.ts) and
 * the sync script import it, and the script must not drag Supabase or the run loop
 * in with it. The agents' authored content lives in foundry-agents.ts, which is
 * script-only.
 */

export type AgentKey = "workspace" | "alerts" | "reports";

/**
 * Reads are literal `process.env.X` inside closures rather than
 * `process.env[registry[key].envVar]`. The computed form works under Node but
 * defeats build-time inlining, which is exactly the sort of thing that stops
 * working when this ships somewhere other than a Node server.
 */
export const AGENT_REGISTRY: Record<AgentKey, { envVar: string; read: () => string | undefined }> = {
  workspace: {
    envVar: "AZURE_AI_WORKSPACE_AGENT_ID",
    read: () => process.env.AZURE_AI_WORKSPACE_AGENT_ID,
  },
  alerts: {
    envVar: "AZURE_AI_ALERTS_AGENT_ID",
    read: () => process.env.AZURE_AI_ALERTS_AGENT_ID,
  },
  reports: {
    envVar: "AZURE_AI_REPORTS_AGENT_ID",
    read: () => process.env.AZURE_AI_REPORTS_AGENT_ID,
  },
};

export class AgentNotConfiguredError extends Error {
  constructor(public readonly agent: AgentKey) {
    super(
      `${AGENT_REGISTRY[agent].envVar} is not set — run \`npm run agents:sync\` and paste the printed id into .env.local.`
    );
    this.name = "AgentNotConfiguredError";
  }
}

/**
 * Resolves an agent key to its Foundry id.
 *
 * Throws rather than falling back to the workspace agent when the var is missing.
 * A fallback would be invisible: the per-run tool schemas are shipped by the caller,
 * so the workspace agent handed `propose_alert` will fill it happily and the alerts
 * flow would produce proposals, confirm-cards and saved rules end to end — while
 * running generic instructions. There'd be no symptom to notice.
 */
export function resolveAgentId(agent: AgentKey): string {
  const id = AGENT_REGISTRY[agent].read();
  if (!id) throw new AgentNotConfiguredError(agent);
  return id;
}
