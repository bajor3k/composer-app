import { supabase } from "@/lib/supabase";
import { runAgent, type AgentTurn } from "@/lib/ai/azure-agent";
import { proposeAlert } from "@/lib/ai/agent-tools";
import { previewDraft, type AlertPreview } from "@/lib/alerts/preview";
import {
  describeCondition,
  describeScope,
  parseCondition,
  type AlertCondition,
  type Frequency,
  type ScopeMode,
  type Severity,
} from "@/lib/alerts/types";

/**
 * The natural-language path to an alert, backed by the dedicated Alerts Agent in
 * Foundry (src/lib/ai/instructions/alerts-agent.md).
 *
 * Everything the model produces is re-validated before it can become a proposal:
 * the condition goes through the same parseCondition the drawer's API uses, and
 * the scope is resolved against live data. A hallucinated account is the worst
 * possible outcome here, because an alert scoped to an account that doesn't exist
 * silently never fires — it looks set, and it isn't.
 *
 * The preview closes the other half of that gap. A rule can be perfectly valid and
 * still never fire — wrong threshold, a metric the evaluator skips, a symbol with no
 * price — so every proposal is run against live data before it's offered.
 */

export interface AlertBuilderContext {
  accountNumber?: string;
  household?: string;
}

export interface ProposedAlert {
  name: string;
  condition: AlertCondition;
  scope_mode: ScopeMode;
  account_number?: string;
  household_id?: string;
  household_name?: string;
  frequency: Frequency;
  severity: Severity;
  /** Rendered server-side so the confirm-card can never disagree with the rule. */
  describe: string;
  describeWhere: string;
  /** What this rule catches against live data right now. Optional — a preview
   *  failure must never cost the user an otherwise-good proposal. */
  preview?: AlertPreview;
}

export type AlertBuilderResult =
  | { status: "asking"; message: string }
  | { status: "ready"; message: string; alert: ProposedAlert };

/**
 * Per-request facts only. Everything static — the four families, the metric enums,
 * the below/above mapping, the capability limits — is authored in the Alerts Agent's
 * Foundry instructions (src/lib/ai/instructions/alerts-agent.md), and the parameter
 * enums ship with the propose_alert schema on every run.
 */
function buildRunContext(context?: AlertBuilderContext): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

  const scope = [
    context?.accountNumber && `account ${context.accountNumber}`,
    context?.household && `household ${context.household}`,
  ].filter(Boolean);

  return [`Today is ${today}.`, scope.length ? `[SCOPE: ${scope.join(", ")}]` : ""]
    .filter(Boolean)
    .join("\n");
}

export async function getAlertBuilderResponse(
  userMessage: string,
  history: AgentTurn[],
  context?: AlertBuilderContext,
): Promise<AlertBuilderResult> {
  // The scope rides in `context`, not appended to the message — otherwise the model
  // sees the user "saying" [SCOPE: …], and their own words stop being verbatim.
  const { text, reports } = await runAgent({
    agent: "alerts",
    context: buildRunContext(context),
    message: userMessage,
    history,
    extraTools: [proposeAlert],
  });

  const proposal = reports.find((r) => r.intent === "propose_alert");
  if (!proposal) {
    return { status: "asking", message: text || "What should I keep an eye on?" };
  }

  const a = (proposal.data ?? {}) as Record<string, unknown>;

  // ── Gate 1 · assemble + re-validate the condition ──────────────────────────
  const alertType = String(a.alertType ?? "");
  const raw: Record<string, unknown> =
    alertType === "activity"
      ? { type: "activity", event: a.event, minValue: a.value }
      : {
          type: alertType,
          metric: a.metric,
          operator: a.operator,
          value: a.value,
          ...(alertType === "holding" ? { symbol: a.symbol } : {}),
          ...(alertType === "performance" ? { period: a.period } : {}),
        };

  const parsed = parseCondition(raw);
  if (!parsed.ok) {
    return {
      status: "asking",
      message: `I couldn't turn that into an alert I can actually check — ${parsed.error} What should the threshold be?`,
    };
  }

  // ── Gate 2 · resolve the scope against live data ───────────────────────────
  const scopeMode: ScopeMode =
    a.scopeMode === "account" || a.scopeMode === "household" || a.scopeMode === "book"
      ? a.scopeMode
      : "book";

  let account_number: string | undefined;
  let household_id: string | undefined;
  let household_name: string | undefined;

  if (scopeMode === "account") {
    const wanted = String(a.accountNumber ?? context?.accountNumber ?? "").toUpperCase();
    if (!wanted) return { status: "asking", message: "Which account should this watch?" };
    const { data } = await supabase
      .from("portfolio_accounts")
      .select("account_number, household_name")
      .eq("account_number", wanted)
      .maybeSingle();
    if (!data) {
      return {
        status: "asking",
        message: `I couldn't find account ${wanted} in the book. Which account should this watch?`,
      };
    }
    account_number = data.account_number as string;
    household_name = (data.household_name as string) ?? undefined;
  } else if (scopeMode === "household") {
    const wanted = String(a.householdName ?? context?.household ?? "");
    if (!wanted) return { status: "asking", message: "Which household should this cover?" };
    const { data } = await supabase
      .from("portfolio_accounts")
      .select("household_id, household_name")
      .ilike("household_name", `%${wanted}%`)
      .limit(1)
      .maybeSingle();
    if (!data?.household_id) {
      return {
        status: "asking",
        message: `I couldn't find a household matching "${wanted}". Which household should this cover?`,
      };
    }
    household_id = data.household_id as string;
    household_name = (data.household_name as string) ?? wanted;
  }

  const frequency: Frequency =
    a.frequency === "realtime" || a.frequency === "weekly" ? a.frequency : "daily";
  const severity: Severity =
    a.severity === "info" || a.severity === "critical" ? a.severity : "warning";

  const alert: ProposedAlert = {
    name: String(a.name || "Untitled alert").slice(0, 120),
    condition: parsed.condition,
    scope_mode: scopeMode,
    account_number,
    household_id,
    household_name,
    frequency,
    severity,
    describe: describeCondition(parsed.condition),
    describeWhere: describeScope({
      scope_mode: scopeMode,
      account_number: account_number ?? null,
      household_name: household_name ?? null,
    }),
  };

  // ── Gate 3 · run it against live data ──────────────────────────────────────
  // Deliberately here rather than as a tool the model can call: this runs on the
  // scope the gates above just RESOLVED, it can't be skipped, and the number on
  // the card is the evaluator's own rather than something the model paraphrased.
  alert.preview = await previewDraft({
    name: alert.name,
    condition: parsed.condition,
    severity,
    scope_mode: scopeMode,
    account_number: account_number ?? null,
    account_numbers: account_number ? [account_number] : [],
    household_id: household_id ?? null,
    household_name: household_name ?? null,
  });

  return { status: "ready", message: text || "Here's the alert — create it?", alert };
}
