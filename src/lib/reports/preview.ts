import { getReportById } from "@/lib/report-registry";
import { executeQuery, type QueryIntent } from "@/lib/ai/query-builder";
import type { ScopeMode } from "@/lib/reports/types";

/**
 * Runs an unsaved report draft against live data: "here's what this comes back with."
 *
 * The reports twin of src/lib/alerts/preview.ts, and it exists for the same reason —
 * a report can be perfectly valid and still be useless. Wrong filter, scope narrowed
 * to nothing, a catalog report that doesn't cover what was asked. Saved, an empty
 * report and a well-aimed one look identical in the list.
 *
 * Deliberately NOT runSavedReport(): that writes a `report_runs` row and stamps
 * `last_run_at`, and a draft nobody has accepted has no business in the run feed or
 * in "run today" counts. This shares the query assembly and nothing else.
 */

const PREVIEW_BUDGET_MS = 8_000;
const SAMPLE_COLUMNS = 4;

export interface ReportPreview {
  status: "evaluated" | "skipped";
  rowCount: number;
  /** Up to 3 rows, trimmed to a few columns — enough to recognise, not a results table. */
  samples: Record<string, unknown>[];
  /** Column names the report came back with, for "12 rows · account, client, cash %". */
  columns: string[];
  caveat?: string;
  skipReason?: string;
}

export interface ReportDraftForPreview {
  report_id: string;
  params: Record<string, unknown>;
  scope_mode: ScopeMode;
  account_number?: string | null;
  household_name?: string | null;
}

export async function previewReportDraft(draft: ReportDraftForPreview): Promise<ReportPreview> {
  const empty: ReportPreview = { status: "skipped", rowCount: 0, samples: [], columns: [] };

  try {
    return await withBudget(run(draft), {
      ...empty,
      skipReason: "Preview timed out. Save it and hit Run on the Reports page.",
    });
  } catch (error) {
    // A preview is a nicety; a proposal is the product. Never let this turn a good
    // proposal into an error.
    console.error("report preview failed", error);
    return { ...empty, skipReason: "Couldn't preview this one — save it and hit Run on the Reports page." };
  }
}

async function run(draft: ReportDraftForPreview): Promise<ReportPreview> {
  const report = getReportById(draft.report_id);
  if (!report) {
    return { status: "skipped", rowCount: 0, samples: [], columns: [], skipReason: "That report is no longer in the catalog." };
  }

  // Same assembly as runSavedReport: catalog defaults < user params < scope.
  const scopeParams: Record<string, unknown> = {};
  if (draft.scope_mode === "account" && draft.account_number) {
    scopeParams.accountNumber = draft.account_number;
  } else if (draft.scope_mode === "household" && draft.household_name) {
    scopeParams.accountNumber = draft.household_name;
  }

  const result = await executeQuery({
    intent: report.intent,
    params: { ...report.defaultParams, ...draft.params, ...scopeParams },
  } as QueryIntent);

  if (result.error) {
    return { status: "skipped", rowCount: 0, samples: [], columns: [], skipReason: result.error };
  }

  const data = result.data;
  const rows = Array.isArray(data) ? data : data ? [data as Record<string, unknown>] : [];
  const columns = rows.length ? Object.keys(rows[0]) : [];

  return {
    status: "evaluated",
    rowCount: rows.length,
    columns,
    samples: rows.slice(0, 3).map((r) => trim(r, columns)),
    caveat: caveatFor(draft, rows.length),
  };
}

/** Why an empty or suspiciously round result might not mean what it looks like. */
function caveatFor(draft: ReportDraftForPreview, rowCount: number): string | undefined {
  if (rowCount === 0) {
    if (draft.scope_mode === "account" && draft.account_number) {
      return `Nothing came back for ${draft.account_number} — worth checking the account is right, or widening the scope.`;
    }
    if (draft.scope_mode === "household" && draft.household_name) {
      return `Nothing came back for the ${draft.household_name} household right now.`;
    }
    if (Object.keys(draft.params).length > 0) {
      return "Nothing matches those inputs right now — the filters may be too tight.";
    }
  }
  return undefined;
}

/** First few columns only. The confirm-card is a sanity check, not the results drawer. */
function trim(row: Record<string, unknown>, columns: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of columns.slice(0, SAMPLE_COLUMNS)) out[key] = row[key];
  return out;
}

function withBudget<T>(work: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const budget = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), PREVIEW_BUDGET_MS);
  });
  return Promise.race([work, budget]).finally(() => clearTimeout(timer));
}
