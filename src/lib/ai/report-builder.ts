import { supabase } from "@/lib/supabase";
import { REPORT_CATALOG } from "@/lib/report-registry";
import { runAgent, type AgentTurn } from "@/lib/ai/azure-agent";
import { proposeSavedReport } from "@/lib/ai/agent-tools";
import { previewReportDraft, type ReportPreview } from "@/lib/reports/preview";
import { validateSavedReportDraft } from "@/lib/reports/validate";
import {
  describeReport,
  describeReportScope,
  SCHEDULE_LABELS,
  type Schedule,
  type ScopeMode,
} from "@/lib/reports/types";

/**
 * The natural-language path to a saved report, backed by the dedicated Reports Agent
 * in Foundry (src/lib/ai/instructions/reports-agent.md).
 *
 * Structurally the twin of src/lib/alerts/alert-builder.ts, and validated the same
 * way: whatever the model produces goes back through the catalog allowlist and the
 * same validateSavedReportDraft the manual drawer's API uses, then the scope is
 * resolved against live data before anything reaches a confirm-card.
 *
 * This used to propose a *slash command* into localStorage. Saved reports live in
 * Postgres now, are visible to teammates and can run on a schedule, so the chat path
 * writes the same row the builder drawer does — the older per-browser commands are
 * imported once by useSavedReports.
 */

type ChatMessage = AgentTurn;

export interface ReportBuilderContext {
  accountNumber?: string;
  household?: string;
}

export interface ProposedReport {
  name: string;
  report_id: string;
  params: Record<string, unknown>;
  scope_mode: ScopeMode;
  account_number?: string;
  household_id?: string;
  household_name?: string;
  schedule: Schedule;
  /** Rendered server-side so the confirm-card can never disagree with the report. */
  describe: string;
  describeWhere: string;
  describeWhen: string;
  /** What it comes back with against live data. Optional — a preview failure must
   *  never cost the user an otherwise-good proposal. */
  preview?: ReportPreview;
}

export type ReportBuilderResult =
  | { status: "asking"; message: string }
  | { status: "ready"; message: string; report: ProposedReport };

/**
 * Per-request facts only. Everything static — the role, the cadence semantics, the
 * "rows not files" boundary — is authored in the Reports Agent's Foundry instructions.
 *
 * The CATALOG stays here rather than in those instructions on purpose: it's derived
 * from code, so a copy pasted into Foundry would silently rot the moment a report is
 * added or renamed. The tool schema's reportId enum is the hard constraint; this is
 * the prose the model needs to choose well.
 */
function buildRunContext(context?: ReportBuilderContext): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

  // The placeholder carries what a field actually ACCEPTS — "Account #, rep code, or
  // ALL" is the difference between the agent proposing a book-wide audit and it
  // burning a clarifying question asking which single account to use.
  const catalog = REPORT_CATALOG.map((r) => {
    const params = r.params?.length
      ? ` — inputs: ${r.params
          .map((p) => {
            const accepts = p.options?.length
              ? ` (one of: ${p.options.map((o) => o.value).join(", ")})`
              : p.placeholder
                ? ` (${p.placeholder})`
                : "";
            return `${p.key}${p.required ? " [required]" : ""}${accepts}`;
          })
          .join("; ")}`
      : "";
    return `- ${r.id} · ${r.label} [${r.category}] — ${r.description}${params}`;
  }).join("\n");

  const scope = [
    context?.accountNumber && `account ${context.accountNumber}`,
    context?.household && `household ${context.household}`,
  ].filter(Boolean);

  return [
    `Today is ${today}.`,
    scope.length ? `[SCOPE: ${scope.join(", ")}]` : "",
    "",
    "Catalog — pick reportId from this list:",
    catalog,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export async function getReportBuilderResponse(
  userMessage: string,
  history: ChatMessage[],
  context?: ReportBuilderContext,
): Promise<ReportBuilderResult> {
  const { text, reports } = await runAgent({
    agent: "reports",
    context: buildRunContext(context),
    message: userMessage,
    history,
    extraTools: [proposeSavedReport],
  });

  const proposal = reports.find((r) => r.intent === "propose_saved_report");
  if (!proposal) {
    return { status: "asking", message: text || "What would you like the report to show?" };
  }

  const r = (proposal.data ?? {}) as Record<string, unknown>;

  // ── Gate 1 · catalog allowlist + the same validator the drawer's API uses ───
  const scopeMode: ScopeMode =
    r.scopeMode === "account" || r.scopeMode === "household" || r.scopeMode === "book"
      ? r.scopeMode
      : "book";

  // Resolve scope BEFORE validating: account scope is a required field there, and
  // failing on a name the model hasn't had a chance to resolve reads as a bad report
  // rather than a missing account.
  let account_number: string | undefined;
  let household_id: string | undefined;
  let household_name: string | undefined;

  if (scopeMode === "account") {
    const wanted = String(r.accountNumber ?? context?.accountNumber ?? "").toUpperCase();
    if (!wanted) return { status: "asking", message: "Which account should this report cover?" };
    const { data } = await supabase
      .from("portfolio_accounts")
      .select("account_number, household_name")
      .eq("account_number", wanted)
      .maybeSingle();
    if (!data) {
      return {
        status: "asking",
        message: `I couldn't find account ${wanted} in the book. Which account should this cover?`,
      };
    }
    account_number = data.account_number as string;
    household_name = (data.household_name as string) ?? undefined;
  } else if (scopeMode === "household") {
    const wanted = String(r.householdName ?? context?.household ?? "");
    if (!wanted) return { status: "asking", message: "Which household should this report cover?" };
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

  const validated = validateSavedReportDraft({
    name: String(r.name || "").trim() || undefined,
    report_id: r.reportId,
    params: r.params,
    scope_mode: scopeMode,
    account_number,
    household_id,
    household_name,
    schedule: r.schedule,
  });

  if (!validated.ok) {
    return {
      status: "asking",
      message: `I couldn't turn that into a report I can run — ${validated.error}`,
    };
  }

  const row = validated.row;

  const report: ProposedReport = {
    name: row.name,
    report_id: row.report_id,
    params: row.params,
    scope_mode: row.scope_mode,
    account_number: row.account_number ?? undefined,
    household_id: row.household_id ?? undefined,
    household_name: row.household_name ?? undefined,
    schedule: row.schedule,
    describe: describeReport(row),
    describeWhere: describeReportScope(row),
    describeWhen: SCHEDULE_LABELS[row.schedule],
  };

  // ── Gate 3 · run it against live data ──────────────────────────────────────
  // Server-side and unskippable, like the alert preview: the row count on the card
  // is the query's own, not something the model estimated.
  report.preview = await previewReportDraft({
    report_id: row.report_id,
    params: row.params,
    scope_mode: row.scope_mode,
    account_number: row.account_number,
    household_name: row.household_name,
  });

  return { status: "ready", message: text || "Here's the report — save it?", report };
}
