import { api } from "@/lib/ai/foundry-client";
import { resolveAgentId, type AgentKey } from "@/lib/ai/agent-definitions";
import {
  executeTool,
  createToolContext,
  TOOL_DEFINITIONS,
  type AgentReport,
  type AgentTool,
} from "@/lib/ai/agent-tools";

/**
 * Runs the Azure AI Foundry agents.
 *
 * Composer has three — workspace, alerts, reports — each with its own instructions
 * authored in this repo (see agent-definitions.ts and foundry-agents.ts). This module
 * is the single place any of them is invoked; transport and auth live in
 * foundry-client.ts.
 */

const RUN_TIMEOUT_MS = 180_000;

/**
 * Adaptive poll backoff instead of a flat interval.
 *
 * A fixed 700ms wait costs up to 700ms of pure overshoot on every transition —
 * paid once when the run starts producing, and again after every tool round.
 * Short reasoning turns were the common case and were the ones penalised most.
 *
 * Starting tight and widening keeps the fast path fast without turning a long
 * run into hundreds of requests: 150, 250, 400, 600, then 800ms thereafter.
 * A 30s run costs ~40 polls rather than ~43 — no meaningful extra load.
 */
const POLL_SCHEDULE_MS = [150, 250, 400, 600];
const POLL_MAX_MS = 800;

function pollDelay(attempt: number): number {
  return POLL_SCHEDULE_MS[attempt] ?? POLL_MAX_MS;
}

/** Backstop against a model that keeps calling tools without ever answering. */
const MAX_TOOL_ROUNDS = 8;

export interface AgentTurn {
  role: "user" | "assistant";
  content: string;
}

interface ToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

interface ThreadRun {
  id: string;
  status: string;
  last_error?: { code?: string; message?: string } | null;
  required_action?: {
    type: string;
    submit_tool_outputs?: { tool_calls: ToolCall[] };
  } | null;
}

interface ThreadMessages {
  data: {
    role: string;
    content: { type: string; text?: { value: string } }[];
  }[];
}

export interface AgentRunResult {
  /** The agent's prose reply. */
  text: string;
  /**
   * Full result sets from any report tools the agent called this run, in call order.
   * The model only ever saw a digest of these — they carry the rows the UI renders.
   */
  reports: AgentReport[];
}

/**
 * Runs one Foundry agent for one turn.
 *
 * Threads are ephemeral: created, run, and deleted per request. `case_messages`
 * stays the single system of record for conversation, so history is replayed rather
 * than accumulated server-side. The cost is replaying the window on every turn; the
 * benefit is that Postgres and Foundry can never disagree about what was said.
 */
export async function runAgent(opts: {
  /** Which Foundry agent to run. Defaults to the general workspace agent. */
  agent?: AgentKey;
  context?: string;
  message: string;
  history?: AgentTurn[];
  /** Extra tools for this run only, e.g. the report-builder proposal. */
  extraTools?: AgentTool[];
}): Promise<AgentRunResult> {
  const agentId = resolveAgentId(opts.agent ?? "workspace");

  const seeded = (opts.history ?? []).map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  // On the case workspace a pre-built account context block is supplied. On the
  // workspace page there is none — the agent reaches data through its tools instead.
  const userContent = opts.context ? `${opts.context}\n\n---\n\n${opts.message}` : opts.message;

  const thread = await api<{ id: string }>("POST", "/threads", {
    messages: [...seeded, { role: "user", content: userContent }],
  });

  // Fresh per invocation. A module-scope sink would leak one request's rows into
  // another's response under concurrency.
  const ctx = createToolContext();

  try {
    // Tools are supplied per-run rather than stored on the agent. The executors live
    // in this repo, so shipping their schemas from the same module removes any chance
    // of the Foundry-side definition drifting from what the code can actually run.
    const tools = opts.extraTools
      ? [...TOOL_DEFINITIONS, ...opts.extraTools.map((t) => t.definition)]
      : TOOL_DEFINITIONS;

    let run = await api<ThreadRun>("POST", `/threads/${thread.id}/runs`, {
      assistant_id: agentId,
      tools,
    });

    const deadline = Date.now() + RUN_TIMEOUT_MS;
    let toolRounds = 0;
    // Reset after each tool round: the model starts thinking again from scratch,
    // so the tight early polls should apply there too.
    let pollAttempt = 0;

    while (true) {
      if (Date.now() > deadline) {
        throw new Error(`Agent run timed out after ${RUN_TIMEOUT_MS / 1000}s (status: ${run.status})`);
      }

      // Tool calls run pull-style: Foundry pauses the run, this process executes the
      // call locally and submits the result. Nothing dials in from Azure.
      if (run.status === "requires_action") {
        const calls = run.required_action?.submit_tool_outputs?.tool_calls ?? [];
        if (calls.length === 0) {
          throw new Error("Run requires action but supplied no tool calls.");
        }
        if (++toolRounds > MAX_TOOL_ROUNDS) {
          throw new Error(`Agent exceeded ${MAX_TOOL_ROUNDS} tool rounds without answering.`);
        }

        // Slots are claimed before the awaits so ordering reflects call order, not
        // whichever query happened to finish first. Each call gets its own slot but
        // the SAME reports array, so writes land in this run's context.
        const slotted = calls.map((call) => ({ call, slot: ctx.slot++ }));
        const tool_outputs = await Promise.all(
          slotted.map(async ({ call, slot }) => ({
            tool_call_id: call.id,
            output: await executeTool(
              call.function.name,
              call.function.arguments,
              { reports: ctx.reports, slot },
              opts.extraTools
            ),
          }))
        );

        run = await api<ThreadRun>(
          "POST",
          `/threads/${thread.id}/runs/${run.id}/submit_tool_outputs`,
          { tool_outputs }
        );
        pollAttempt = 0;
        continue;
      }

      if (["completed", "failed", "cancelled", "expired"].includes(run.status)) break;

      await new Promise((resolve) => setTimeout(resolve, pollDelay(pollAttempt++)));
      run = await api<ThreadRun>("GET", `/threads/${thread.id}/runs/${run.id}`);
    }

    if (run.status !== "completed") {
      throw new Error(`Agent run ${run.status}: ${run.last_error?.message ?? "no error detail"}`);
    }

    const messages = await api<ThreadMessages>("GET", `/threads/${thread.id}/messages`);
    const reply = messages.data.find((m) => m.role === "assistant");
    const text = reply?.content.find((c) => c.type === "text")?.text?.value;

    if (!text) {
      throw new Error("Agent run completed but returned no text content.");
    }
    // Sparse until every slot resolves — drop the gaps so callers get call order.
    return { text, reports: ctx.reports.filter((r): r is AgentReport => r !== undefined) };
  } finally {
    // Best effort, and deliberately NOT awaited: the reply is already in hand by
    // this point, so awaiting the cleanup made every user wait an extra Azure
    // round-trip for a call whose result nobody reads. A leaked thread costs
    // nothing and must not mask a real error.
    void api("DELETE", `/threads/${thread.id}`).catch(() => {});
  }
}
