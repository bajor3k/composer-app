import {
  FREQUENCIES,
  SCOPE_MODES,
  SEVERITIES,
  parseCondition,
  type AlertRow,
  type Frequency,
  type ScopeMode,
  type Severity,
} from "@/lib/alerts/types";

const MAX_NAME = 120;
const MAX_COOLDOWN_HOURS = 8760; // one year
// A ceiling on hand-picked accounts. Past this, "the whole book" or a household
// is the right scope, and the row stops being readable in the table.
const MAX_ACCOUNTS = 50;

/** The server-owned columns — never accepted from a client. */
type ServerOwned =
  | "id"
  | "created_at"
  | "updated_at"
  | "last_evaluated_at"
  | "last_triggered_at"
  | "last_error"
  | "trigger_count"
  | "source"
  // Archive/restore is its own action, not part of an edit — a full-draft PATCH
  // must never quietly un-archive a rule.
  | "archived"
  | "created_by"
  | "created_by_name";

export type ValidatedAlert = Omit<AlertRow, ServerOwned>;

/**
 * Shared write-path validation for alerts.
 *
 * Both creation paths land here — the drawer form and the natural-language
 * builder — so a model-authored alert is held to exactly the same standard as a
 * hand-filled form. Lives in lib rather than the route file because Next only
 * permits HTTP handlers and reserved config to be exported from a route module.
 */
export function validateAlertDraft(
  body: Record<string, unknown>,
): { ok: true; row: ValidatedAlert } | { ok: false; error: string } {
  const name = typeof body.name === "string" ? body.name.trim().slice(0, MAX_NAME) : "";
  if (!name) return { ok: false, error: "Give the alert a name." };

  const parsed = parseCondition(body.condition);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const condition = parsed.condition;

  // alert_type is derived from the condition rather than trusted from the
  // client, so the discriminator and its payload can never disagree.
  const alert_type = condition.type;

  const scope_mode = (SCOPE_MODES as readonly string[]).includes(String(body.scope_mode))
    ? (body.scope_mode as ScopeMode)
    : "account";

  // Account scope is a set. Accept either shape, dedupe, and keep
  // `account_number` as the first entry so the DB CHECK and index stay valid.
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

  // Mirrors the alerts_scope_shape CHECK so the user gets a sentence rather than
  // a Postgres constraint violation.
  if (scope_mode === "account" && account_numbers.length === 0)
    return { ok: false, error: "Pick at least one account for this alert." };
  if (scope_mode === "household" && !household_id)
    return { ok: false, error: "Pick a household for this alert." };

  const frequency = (FREQUENCIES as readonly string[]).includes(String(body.frequency))
    ? (body.frequency as Frequency)
    : "realtime";
  const severity = (SEVERITIES as readonly string[]).includes(String(body.severity))
    ? (body.severity as Severity)
    : "info";

  const rawCooldown = Number(body.cooldown_hours);
  const cooldown_hours =
    Number.isFinite(rawCooldown) && rawCooldown >= 0
      ? Math.min(Math.floor(rawCooldown), MAX_COOLDOWN_HOURS)
      : 24;

  return {
    ok: true,
    row: {
      name,
      alert_type,
      condition,
      scope_mode,
      // Null out scope columns that don't belong to the chosen mode, so switching
      // Account → Entire book doesn't leave a stale account behind.
      account_number: scope_mode === "account" ? account_number : null,
      account_numbers: scope_mode === "account" ? account_numbers : [],
      household_id: scope_mode === "household" ? household_id : null,
      household_name: scope_mode === "household" ? household_name : null,
      frequency,
      severity,
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
      cooldown_hours,
      notify_in_app: body.notify_in_app === undefined ? true : Boolean(body.notify_in_app),
      notify_email: Boolean(body.notify_email),
    },
  };
}
