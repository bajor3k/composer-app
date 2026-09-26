import { supabase } from "@/lib/supabase";
import { paginateQuery } from "@/lib/supabase-paginate";
import { buildCaseContext } from "@/lib/ai/case-context";
import { executeQuery, type QueryIntent } from "@/lib/ai/query-builder";
import { REPORT_INTENTS, REPORT_INTENT_GUIDE, isReportIntent } from "@/lib/ai/report-intents";
import { REPORT_CATALOG } from "@/lib/report-registry";

/**
 * Tools the Foundry workspace agent can call to reach Composer's data.
 *
 * These run pull-style: the Foundry run pauses at `requires_action`, this process
 * executes the call against Supabase, and the result is submitted back. Foundry never
 * dials into Composer, so no public endpoint or inbound auth is needed — which is what
 * makes this work identically on localhost and in Azure.
 *
 * Tool results are returned as JSON strings. Keep them small: every byte comes back as
 * input tokens on the next model turn.
 */

const MAX_ROWS = 200;

/**
 * Per-invocation sink for results that must reach the UI intact rather than only as
 * the digest the model sees. Created fresh by each `runAgent` call and
 * threaded through — deliberately NOT module scope, which under concurrent requests
 * would hand one user's rows to another user's response.
 */
export interface ToolContext {
  reports: (AgentReport | undefined)[];
  /** Monotonic slot index, so ordering is deterministic despite parallel tool calls. */
  slot: number;
}

export interface AgentReport {
  intent: string;
  params: Record<string, unknown>;
  data: Record<string, unknown>[] | Record<string, unknown> | null;
  rowCount: number;
}

export function createToolContext(): ToolContext {
  return { reports: [], slot: 0 };
}

export interface AgentTool {
  definition: {
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  };
  execute: (args: Record<string, unknown>, ctx?: ToolContext) => Promise<unknown>;
}

type Row = Record<string, unknown>;

function num(value: unknown): number {
  return Number(value) || 0;
}

function clampLimit(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), MAX_ROWS);
}

async function allAccounts(): Promise<Row[]> {
  return paginateQuery<Row>((from, to) =>
    supabase
      .from("portfolio_accounts")
      .select(
        "account_number, account_name, account_type, custodian, client_name, household_name, household_id, total_value, cash_balance, is_managed, rep_code"
      )
      .range(from, to)
  );
}

/** Households ranked across the whole book. */
const householdSummary: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "household_summary",
      description:
        "Rank households across the entire book of business by total AUM, cash, or account count. Use for any question about which household or client relationship is largest or smallest, how households compare, or totals across a household.",
      parameters: {
        type: "object",
        properties: {
          sort_by: {
            type: "string",
            enum: ["aum", "cash", "cash_pct", "accounts"],
            description: "Ranking metric. Defaults to aum.",
          },
          limit: { type: "number", description: "How many households to return (max 200, default 10)." },
        },
        required: [],
      },
    },
  },
  async execute(args) {
    const accounts = await allAccounts();
    const byHousehold = new Map<string, { household: string; aum: number; cash: number; accounts: number }>();

    for (const account of accounts) {
      const name = String(account.household_name || "— no household —");
      const entry = byHousehold.get(name) ?? { household: name, aum: 0, cash: 0, accounts: 0 };
      entry.aum += num(account.total_value);
      entry.cash += num(account.cash_balance);
      entry.accounts += 1;
      byHousehold.set(name, entry);
    }

    const sortBy = String(args.sort_by ?? "aum");
    const rows = [...byHousehold.values()].map((h) => ({
      ...h,
      cash_pct: h.aum > 0 ? (h.cash / h.aum) * 100 : 0,
    }));

    rows.sort((a, b) => {
      if (sortBy === "cash") return b.cash - a.cash;
      if (sortBy === "cash_pct") return b.cash_pct - a.cash_pct;
      if (sortBy === "accounts") return b.accounts - a.accounts;
      return b.aum - a.aum;
    });

    return {
      total_households: rows.length,
      sorted_by: sortBy,
      households: rows.slice(0, clampLimit(args.limit, 10)),
    };
  },
};

/** Individual accounts, filtered and ranked. */
const listAccounts: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "list_accounts",
      description:
        "List or filter individual accounts across the book. Use for questions about specific accounts, account types, custodians, rep codes, or ranking accounts by value or cash. Not for a deep review of one account — use account_detail for that.",
      parameters: {
        type: "object",
        properties: {
          household_name: { type: "string", description: "Filter to one household (case-insensitive partial match)." },
          custodian: { type: "string", description: "Filter by custodian, e.g. Pershing, Schwab, Fidelity." },
          account_type: { type: "string", description: "Filter by type, e.g. IRA, INDIVIDUAL, JOINT, TRUST, ROTH_IRA." },
          client_name: { type: "string", description: "Filter by client name (case-insensitive partial match)." },
          sort_by: { type: "string", enum: ["value", "cash"], description: "Ranking metric. Defaults to value." },
          limit: { type: "number", description: "How many accounts to return (max 200, default 25)." },
        },
        required: [],
      },
    },
  },
  async execute(args) {
    let accounts = await allAccounts();

    const contains = (value: unknown, needle: unknown) =>
      String(value ?? "").toLowerCase().includes(String(needle).toLowerCase());

    if (args.household_name) accounts = accounts.filter((a) => contains(a.household_name, args.household_name));
    if (args.client_name) accounts = accounts.filter((a) => contains(a.client_name, args.client_name));
    if (args.custodian) accounts = accounts.filter((a) => contains(a.custodian, args.custodian));
    if (args.account_type) accounts = accounts.filter((a) => contains(a.account_type, args.account_type));

    const sortBy = String(args.sort_by ?? "value");
    accounts.sort((a, b) =>
      sortBy === "cash" ? num(b.cash_balance) - num(a.cash_balance) : num(b.total_value) - num(a.total_value)
    );

    return {
      matched: accounts.length,
      accounts: accounts.slice(0, clampLimit(args.limit, 25)).map((a) => ({
        account_number: a.account_number,
        account_name: a.account_name,
        account_type: a.account_type,
        custodian: a.custodian,
        client_name: a.client_name,
        household_name: a.household_name,
        total_value: num(a.total_value),
        cash_balance: num(a.cash_balance),
        is_managed: a.is_managed,
      })),
    };
  },
};

/** Deep detail for one account — reuses the case-workspace context builder. */
const accountDetail: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "account_detail",
      description:
        "Full operational detail for ONE account: holdings with cost basis, margin and balances, recent transactions, fee setup, household siblings, and automated anomaly flags. Use when reviewing, auditing, or answering anything specific about a single named account.",
      parameters: {
        type: "object",
        properties: {
          account_number: {
            type: "string",
            // One example per custodian: a single Pershing-shaped example anchored the
            // model on that format and it would reshape numbers it was handed.
            description:
              "The account number, exactly as given. Formats differ by custodian — Pershing ABC343299 / XYZ118402, Schwab 5149-9391, Fidelity 77-123456. Pass it through verbatim; do not reformat.",
          },
        },
        required: ["account_number"],
      },
    },
  },
  async execute(args) {
    const accountNumber = String(args.account_number ?? "").trim();
    if (!accountNumber) return { error: "account_number is required" };

    const result = await buildCaseContext(accountNumber);
    if (!result) return { error: `Account ${accountNumber} not found.` };
    return { account_number: result.accountNumber, detail: result.context };
  },
};

/** Positions across the book. */
const searchHoldings: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "search_holdings",
      description:
        "Find positions across the entire book. Use for 'who holds SYMBOL', exposure to a security, or finding concentrated positions above a weight threshold.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Ticker to search for, e.g. NVDA." },
          min_weight_pct: {
            type: "number",
            description: "Only return positions above this percentage of their account's value.",
          },
          limit: { type: "number", description: "How many positions to return (max 200, default 25)." },
        },
        required: [],
      },
    },
  },
  async execute(args) {
    const symbol = args.symbol ? String(args.symbol).toUpperCase() : null;

    const holdings = await paginateQuery<Row>((from, to) => {
      const query = supabase
        .from("holdings")
        .select("account_id, symbol, name, asset_class, quantity, market_value")
        .range(from, to);
      return symbol ? query.eq("symbol", symbol) : query;
    });

    if (holdings.length === 0) {
      return { matched: 0, positions: [], note: symbol ? `No positions found for ${symbol}.` : "No positions found." };
    }

    const accounts = await allAccounts();
    const accountById = new Map<string, Row>();
    const totalsById = new Map<string, number>();
    for (const account of accounts) accountById.set(String(account.id ?? account.account_number), account);

    // Account totals come from the holdings table so weights are internally consistent
    // with the positions being ranked, rather than mixing sources.
    const allForTotals = symbol
      ? await paginateQuery<Row>((from, to) =>
          supabase.from("holdings").select("account_id, market_value").range(from, to)
        )
      : holdings;
    for (const holding of allForTotals) {
      const key = String(holding.account_id);
      totalsById.set(key, (totalsById.get(key) ?? 0) + num(holding.market_value));
    }

    // portfolio_accounts exposes id only via the view's account_id join key, so match
    // holdings back to accounts through a second lookup keyed on account_id.
    const { data: idRows } = await supabase.from("portfolio_accounts").select("id, account_number, account_name, household_name, client_name");
    const metaById = new Map<string, Row>();
    for (const row of (idRows ?? []) as Row[]) metaById.set(String(row.id), row);

    const minWeight = Number(args.min_weight_pct);
    const positions = holdings
      .map((holding) => {
        const key = String(holding.account_id);
        const accountTotal = totalsById.get(key) ?? 0;
        const marketValue = num(holding.market_value);
        const meta = metaById.get(key) ?? accountById.get(key) ?? {};
        return {
          account_number: meta.account_number ?? null,
          account_name: meta.account_name ?? null,
          household_name: meta.household_name ?? null,
          client_name: meta.client_name ?? null,
          symbol: holding.symbol,
          name: holding.name,
          asset_class: holding.asset_class,
          quantity: num(holding.quantity),
          market_value: marketValue,
          weight_pct: accountTotal > 0 ? (marketValue / accountTotal) * 100 : 0,
        };
      })
      .filter((p) => (Number.isFinite(minWeight) && minWeight > 0 ? p.weight_pct >= minWeight : true))
      .sort((a, b) => b.market_value - a.market_value);

    return {
      matched: positions.length,
      positions: positions.slice(0, clampLimit(args.limit, 25)),
    };
  },
};

/** Rows shown to the model. The user sees the full table; the model needs a shape, not a dump. */
const DIGEST_ROWS = 5;
/** Hard ceiling on the serialized digest, so a wide table can't blow up the next turn. */
const DIGEST_CHARS = 4000;

function digestOf(data: unknown): { columns: string[]; sample: unknown } {
  if (Array.isArray(data)) {
    const columns = data.length > 0 && typeof data[0] === "object" && data[0] !== null
      ? Object.keys(data[0] as Row)
      : [];
    let sample = data.slice(0, DIGEST_ROWS);
    while (sample.length > 1 && JSON.stringify(sample).length > DIGEST_CHARS) {
      sample = sample.slice(0, sample.length - 1);
    }
    return { columns, sample };
  }
  if (data && typeof data === "object") {
    return { columns: Object.keys(data as Row), sample: JSON.stringify(data).slice(0, DIGEST_CHARS) };
  }
  return { columns: [], sample: null };
}

/**
 * Runs a predefined query from the report catalogue.
 *
 * The full result set goes to the caller's context for rendering; the model gets only
 * a digest. executeQuery can return up to 2000 rows, and handing those back as a tool
 * result would cost hundreds of KB of input tokens on the next turn for no benefit —
 * the model is summarizing, not transcribing.
 */
const runReport: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "run_report",
      description:
        "Run a predefined data query against the book of business and render the results as a table for the user. " +
        "Use this for any question that needs rows of data — lists, rankings, breakdowns, reviews, pipelines. " +
        "Prefer this over describing data you cannot see. The full table is rendered for the user automatically; " +
        "you receive only a small sample, so summarize the top-line finding rather than re-listing rows.",
      parameters: {
        type: "object",
        properties: {
          intent: {
            type: "string",
            enum: [...REPORT_INTENTS],
            description: `Which query to run. Available intents and their params:\n${REPORT_INTENT_GUIDE}`,
          },
          params: {
            type: "object",
            description:
              "Parameters for the chosen intent, matching the signature in the intent list. Omit for intents that take none.",
            additionalProperties: true,
          },
        },
        required: ["intent"],
      },
    },
  },
  async execute(args, ctx) {
    const intent = args.intent;
    if (!isReportIntent(intent)) {
      return {
        error: `Unknown intent: ${String(intent)}. Choose one from the documented list.`,
      };
    }

    const params = (args.params && typeof args.params === "object" ? args.params : {}) as Record<string, unknown>;
    const result = await executeQuery({ intent, params } as QueryIntent);

    if (result.error) {
      return { intent, error: result.error };
    }

    const data = result.data;
    const rowCount = Array.isArray(data) ? data.length : data ? 1 : 0;
    const { columns, sample } = digestOf(data);

    // Full rows go to the caller; only the digest goes back to the model.
    if (ctx) {
      ctx.reports[ctx.slot] = { intent, params, data, rowCount };
    }

    return {
      intent,
      matched_rows: rowCount,
      columns,
      sample,
      note:
        rowCount === 0
          ? "No rows matched. Say so plainly rather than guessing at an answer."
          : "The full table is already being rendered for the user. Summarize the top-line finding in prose; do not re-list the rows.",
    };
  },
};

/**
 * Report-builder proposal. Structured output, so it rides the same context sink as
 * run_report rather than asking the model to emit parseable JSON in its prose.
 *
 * Registered only when the caller opts in — the report-builder flow is the only place
 * it makes sense, and offering it everywhere invites the agent to propose a saved
 * command when someone just asked a question.
 */
export const proposeReportCommand: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "propose_report_command",
      description:
        "Propose a saved slash command once you know which catalog report the user wants and with what parameters. " +
        "Call this only when you are confident of the report and its params; otherwise ask ONE short clarifying question in prose instead.",
      parameters: {
        type: "object",
        properties: {
          reportId: {
            type: "string",
            description: "Id of an existing report from the catalog. Never invent one.",
          },
          name: { type: "string", description: "Short slug for the command, no leading slash." },
          label: { type: "string", description: "Human-readable name shown in the command list." },
          description: { type: "string", description: "One-line description of what it shows." },
          params: { type: "object", description: "Parameters to bind into the saved command.", additionalProperties: true },
        },
        required: ["reportId"],
      },
    },
  },
  async execute(args, ctx) {
    const reportId = String(args.reportId ?? "");
    if (ctx) {
      ctx.reports[ctx.slot] = {
        intent: "propose_report_command",
        params: args,
        data: { reportId, ...args } as Row,
        rowCount: 1,
      };
    }
    return { accepted: true, reportId, note: "Proposal captured. Confirm it to the user in one short sentence." };
  },
};

/**
 * Alert-builder proposal. Same opt-in posture as proposeReportCommand — registered
 * only by the alert-builder flow, so the workspace agent never volunteers to create
 * an alert when someone merely asked a question.
 *
 * The parameters are deliberately FLAT enums rather than a nested condition object:
 * models are markedly more reliable filling a flat schema, and assembling the typed
 * AlertCondition is cheap for us to do in code — where it also gets re-validated.
 */
export const proposeAlert: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "propose_alert",
      description:
        "Propose an alert rule once you know what to watch, where it applies, and the threshold. " +
        "Call this only when you are confident; otherwise ask ONE short clarifying question in prose instead.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short human-readable name, e.g. 'Apple stop-loss'." },
          alertType: {
            type: "string",
            enum: ["holding", "balance", "performance", "activity"],
            description:
              "holding = a security's price/value/weight. balance = cash or account value. " +
              "performance = return vs benchmark. activity = transactions, pending items, margin calls.",
          },
          metric: {
            type: "string",
            enum: [
              "price",
              "day_change_pct",
              "position_value",
              "weight_pct",
              "cash_balance",
              "cash_pct",
              "total_value",
              "alpha",
              "twr_return",
            ],
            description: "The measured quantity. Omit for alertType=activity.",
          },
          event: {
            type: "string",
            enum: ["large_transaction", "pending_transfer", "pending_application", "margin_call"],
            description: "Only for alertType=activity.",
          },
          operator: { type: "string", enum: ["above", "below"], description: "Direction of the threshold." },
          value: { type: "number", description: "The threshold. Dollars or percent depending on the metric." },
          symbol: { type: "string", description: "Ticker — required when alertType=holding." },
          period: { type: "string", enum: ["mtd", "qtd", "ytd", "latest"], description: "Only for alertType=performance." },
          scopeMode: {
            type: "string",
            enum: ["account", "household", "book"],
            description: "book = the entire book of business. Prefer the scope the user was given.",
          },
          accountNumber: { type: "string", description: "Required when scopeMode=account." },
          householdName: { type: "string", description: "Required when scopeMode=household." },
          frequency: { type: "string", enum: ["realtime", "daily", "weekly"], description: "How often to check. Default daily." },
          severity: { type: "string", enum: ["info", "warning", "critical"] },
        },
        required: ["alertType", "scopeMode"],
      },
    },
  },
  async execute(args, ctx) {
    if (ctx) {
      ctx.reports[ctx.slot] = {
        intent: "propose_alert",
        params: args,
        data: { ...args } as Row,
        rowCount: 1,
      };
    }
    return { accepted: true, note: "Proposal captured. Confirm it to the user in one short sentence." };
  },
};

/**
 * Saved-report proposal — the reports twin of proposeAlert, and the replacement for
 * proposeReportCommand above.
 *
 * `reportId` is an enum built from REPORT_CATALOG at module load, so the model
 * physically cannot name a report that doesn't exist and `dynamic_query` stays
 * unreachable. The catalog's labels and params ride in the run context, where the
 * model needs prose to CHOOSE well — this enum is the hard constraint underneath it.
 *
 * Scope is one account, one household, or the book. Deliberately not a list: the
 * schema stores account_numbers[] but src/lib/reports/run.ts only executes the first
 * entry, so offering multiple would quietly report on one.
 */
export const proposeSavedReport: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "propose_saved_report",
      description:
        "Propose a saved report once you know which catalog report to run, with what inputs, over what scope, and how often. " +
        "Call this only when you are confident; otherwise ask ONE short clarifying question in prose instead.",
      parameters: {
        type: "object",
        properties: {
          reportId: {
            type: "string",
            enum: REPORT_CATALOG.map((r) => r.id),
            description: "Id of a report from the catalog supplied in the run context. Never invent one.",
          },
          name: {
            type: "string",
            description: "Short name an advisor would recognise in a list, e.g. 'Monday low-cash sweep'.",
          },
          params: {
            type: "object",
            description:
              "Inputs for the chosen report, keyed exactly as the catalog declares them. Omit any the user didn't ask for.",
            additionalProperties: true,
          },
          scopeMode: {
            type: "string",
            enum: ["account", "household", "book"],
            description: "book = the entire book of business. Prefer the scope the user was given.",
          },
          accountNumber: { type: "string", description: "Required when scopeMode=account. One account, not a list." },
          householdName: { type: "string", description: "Required when scopeMode=household." },
          schedule: {
            type: "string",
            enum: ["manual", "daily", "weekly", "monthly"],
            description: "How often it re-runs. manual = on demand, and is the default unless recurring was asked for.",
          },
        },
        required: ["reportId", "scopeMode"],
      },
    },
  },
  async execute(args, ctx) {
    if (ctx) {
      ctx.reports[ctx.slot] = {
        intent: "propose_saved_report",
        params: args,
        data: { ...args } as Row,
        rowCount: 1,
      };
    }
    return { accepted: true, note: "Proposal captured. Confirm it to the user in one short sentence." };
  },
};

export const AGENT_TOOLS: AgentTool[] = [
  runReport,
  householdSummary,
  listAccounts,
  accountDetail,
  searchHoldings,
];

export const TOOL_DEFINITIONS = AGENT_TOOLS.map((tool) => tool.definition);

const TOOL_BY_NAME = new Map(AGENT_TOOLS.map((tool) => [tool.definition.function.name, tool]));

/**
 * Executes one tool call. Errors are returned as data rather than thrown — the model
 * handles "that lookup failed" far better than the run dying mid-turn.
 */
export async function executeTool(
  name: string,
  rawArgs: string,
  ctx?: ToolContext,
  extraTools?: AgentTool[]
): Promise<string> {
  const tool =
    TOOL_BY_NAME.get(name) ??
    extraTools?.find((t) => t.definition.function.name === name);
  if (!tool) return JSON.stringify({ error: `Unknown tool: ${name}` });

  try {
    const args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
    const result = await tool.execute(args, ctx);
    return JSON.stringify(result);
  } catch (error) {
    console.error(`Tool ${name} failed:`, error);
    return JSON.stringify({ error: error instanceof Error ? error.message : "Tool execution failed" });
  }
}
