import { config } from "dotenv";

// .env.local first — it holds the AZURE_AI_* vars, while .env holds only DATABASE_URL.
// dotenv is first-file-wins, so this order matters. (`import "dotenv/config"` would
// load .env alone and leave the script with no endpoint.)
config({ path: [".env.local", ".env"], quiet: true });

import { AGENT_REGISTRY, type AgentKey } from "@/lib/ai/agent-definitions";
import { AGENT_DEFINITIONS } from "@/lib/ai/foundry-agents";
import { createAgent, diffAgent, listAgents, updateAgent } from "@/lib/ai/foundry-admin";

/**
 * Pushes the repo's agent definitions to Azure AI Foundry.
 *
 *   npm run agents:list              # what's live right now
 *   npm run agents:sync -- --dry     # diff only, writes nothing
 *   npm run agents:sync              # apply
 *   npm run agents:sync -- --only=alerts
 *
 * Safe to re-run: an agent whose live state already matches is skipped. Auth is
 * `az login` locally or a managed identity in Azure — see foundry-client.ts.
 *
 * Deliberately a thin shell. tsconfig excludes scripts/**, so anything here is
 * unchecked by `npm run typecheck` — every typed line lives under src/lib/ai/.
 */

const argv = process.argv.slice(2);
const isList = argv.includes("list");
const isDry = argv.includes("--dry");
const only = argv.find((a) => a.startsWith("--only="))?.split("=")[1] as AgentKey | undefined;

async function main() {
  const live = await listAgents();

  if (isList) {
    if (live.length === 0) {
      console.log("No agents in this Foundry project.");
      return;
    }
    for (const a of live) {
      console.log(`${a.id}  ${a.name ?? "(unnamed)"}  [${a.model ?? "?"}]  ${(a.instructions ?? "").length} chars`);
    }
    return;
  }

  const byId = new Map(live.map((a) => [a.id, a]));
  const defs = only ? AGENT_DEFINITIONS.filter((d) => d.key === only) : AGENT_DEFINITIONS;

  if (defs.length === 0) {
    fail(`No agent definition for "${only}". Known: ${AGENT_DEFINITIONS.map((d) => d.key).join(", ")}`);
  }

  if (isDry) console.log("DRY RUN — nothing will be written.\n");

  for (const def of defs) {
    const { envVar, read } = AGENT_REGISTRY[def.key];
    const envId = read();
    const managed = def.instructionsFile
      ? `instructions: managed (${def.instructionsFile})`
      : "instructions: not managed (kept as-is in Foundry)";

    // No id on file → this agent has never been created from this repo.
    if (!envId) {
      console.log(`${def.key} — not configured (${envVar} unset)`);
      console.log(`  ${managed}`);
      if (isDry) {
        console.log(`  would CREATE "${def.name}" [${def.model}]\n`);
        continue;
      }
      const created = await createAgent(def);
      console.log(`  created "${created.name}"\n`);
      console.log(`  Add this to .env.local:\n    ${envVar}=${created.id}\n`);
      continue;
    }

    // An id on file that Foundry doesn't know about is a misconfiguration, not a
    // reason to create a second agent — that ends with two identically named rows
    // and no way to tell which one the app is talking to.
    const liveAgent = byId.get(envId);
    if (!liveAgent) {
      fail(
        `${def.key}: ${envVar}=${envId} but no such agent exists in this project.\n` +
          `Check the endpoint and the id, or clear ${envVar} to create a new one.`
      );
      return;
    }

    const diffs = diffAgent(liveAgent, def);
    console.log(`${def.key} — ${envId} ("${liveAgent.name ?? "unnamed"}")`);
    console.log(`  ${managed}`);

    if (diffs.length === 0) {
      console.log("  up to date\n");
      continue;
    }

    for (const d of diffs) {
      console.log(`  ${d.field}:`);
      console.log(`    - ${d.from}`);
      console.log(`    + ${d.to}`);
    }

    if (isDry) {
      console.log("  would UPDATE\n");
      continue;
    }
    await updateAgent(envId, def);
    console.log("  updated\n");
  }
}

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
