import { getReportById } from "@/lib/report-registry";
import {
  SCHEDULES,
  SCOPE_MODES,
  type SavedReportRow,
  type Schedule,
  type ScopeMode,
} from "@/lib/reports/types";

const MAX_NAME = 120;
const MAX_ACCOUNTS = 50;
const MAX_PARAM_LEN = 200;

type ServerOwned =
  | "id"
  | "created_at"
  | "updated_at"
  | "last_run_at"
  | "last_row_count"
  | "last_error"
  | "run_count"
  | "source"
  // Archive/restore is its own action — a full-draft PATCH must never quietly
  // un-archive a report.
  | "archived"
  | "created_by"
  | "created_by_name";

export type ValidatedSavedReport = Omit<SavedReportRow, ServerOwned>;

/**
 * Shared write-path validation for saved reports.
 *
 * The catalog is the allowlist, exactly as in POST /api/reports: an unknown
 * report_id is rejected, and only params the report actually declares survive.
 * That is what keeps `dynamic_query` and any undeclared intent unreachable from
 * a client — and it means a model-authored report from the chat builder is held
 * to the same standard as a hand-filled form.
 */
export function validateSavedReportDraft(
  body: Record<string, unknown>,
): { ok: true; row: ValidatedSavedReport } | { ok: false; error: string } {
  const name = typeof body.name === "string" ? body.name.trim().slice(0, MAX_NAME) : "";
  if (!name) return { ok: false, error: "Give the report a name." };

  const report_id = typeof body.report_id === "string" ? body.report_id.trim() : "";
  const report = getReportById(report_id);
  if (!report) return { ok: false, error: `Unknown report: ${report_id || "(none)"}` };

  // Allowlist: only declared params, non-empty, stringified and length-capped.
  const supplied = (body.params ?? {}) as Record<string, unknown>;
  const params: Record<string, unknown> = {};
  for (const p of report.params ?? []) {
    const v = supplied[p.key];
    if (v === undefined || v === null || v === "") continue;
    params[p.key] = typeof v === "string" ? v.trim().slice(0, MAX_PARAM_LEN) : v;
  }

  const missing = (report.params ?? [])
    .filter((p) => p.required && params[p.key] === undefined)
    .map((p) => p.label);
  if (missing.length) return { ok: false, error: `Missing required input: ${missing.join(", ")}` };

  const scope_mode = (SCOPE_MODES as readonly string[]).includes(String(body.scope_mode))
    ? (body.scope_mode as ScopeMode)
    : "book";

  const rawList = Array.isArray(body.account_numbers)
    ? body.account_numbers
    : typeof body.account_number === "string"
      ? [body.account_number]
      : [];
  const account_numbers = [
    ...new Set(
      rawList
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim().toUpperCase())
        .filter(Boolean),
    ),
  ].slice(0, MAX_ACCOUNTS);
  const account_number = account_numbers[0] ?? null;

  const household_id =
    typeof body.household_id === "string" && body.household_id.trim()
      ? body.household_id.trim()
      : null;
  const household_name =
    typeof body.household_name === "string" && body.household_name.trim()
      ? body.household_name.trim().slice(0, MAX_NAME)
      : null;

  // Mirrors saved_reports_scope_shape so the user gets a sentence rather than a
  // Postgres constraint violation.
  if (scope_mode === "account" && account_numbers.length === 0)
    return { ok: false, error: "Pick at least one account for this report." };
  if (scope_mode === "household" && !household_id)
    return { ok: false, error: "Pick a household for this report." };

  const schedule = (SCHEDULES as readonly string[]).includes(String(body.schedule))
    ? (body.schedule as Schedule)
    : "manual";

  return {
    ok: true,
    row: {
      name,
      report_id: report.id,
      params,
      scope_mode,
      // Null out scope columns that don't belong to the chosen mode.
      account_number: scope_mode === "account" ? account_number : null,
      account_numbers: scope_mode === "account" ? account_numbers : [],
      household_id: scope_mode === "household" ? household_id : null,
      household_name: scope_mode === "household" ? household_name : null,
      schedule,
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
    },
  };
}
