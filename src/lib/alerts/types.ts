/**
 * Shared types + describe helpers for the Alert Center.
 * Row shapes mirror supabase/migrations/0004_alerts.sql.
 *
 * Kept isomorphic (no Supabase import) — this module is pulled in by the
 * /api/alerts routes, the evaluator, the builder drawer, and the agent tool.
 *
 * `describeCondition` / `describeScope` are the SINGLE source of the plain-English
 * "when" and "where" sentences. The rules table, the drawer's live preview, the
 * chat confirm-card and the triggered-event title all call them, so the wording a
 * user reads while building an alert is byte-identical to the wording they read
 * when it fires. Never hand-write those strings anywhere else.
 */

export const ALERT_TYPES = ["holding", "balance", "performance", "activity"] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const SCOPE_MODES = ["account", "household", "book"] as const;
export type ScopeMode = (typeof SCOPE_MODES)[number];

export const FREQUENCIES = ["realtime", "daily", "weekly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const SEVERITIES = ["info", "warning", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export type Operator = "above" | "below";

// ── The condition union ───────────────────────────────────────────────────────
// One discriminated union shared by the form, the agent tool and the evaluator.
// `type` matches the row's alert_type column so a row and its condition can never
// disagree (enforced by assertCondition below).

export interface HoldingCondition {
  type: "holding";
  symbol: string;
  metric: "price" | "day_change_pct" | "position_value" | "weight_pct";
  operator: Operator;
  value: number;
}

export interface BalanceCondition {
  type: "balance";
  metric: "cash_balance" | "cash_pct" | "total_value";
  operator: Operator;
  value: number;
}

export interface PerformanceCondition {
  type: "performance";
  metric: "twr_return" | "alpha" | "drift_pct";
  operator: Operator;
  value: number;
  period: "mtd" | "qtd" | "ytd" | "latest";
}

export interface ActivityCondition {
  type: "activity";
  event: "large_transaction" | "pending_transfer" | "pending_application" | "margin_call";
  minValue?: number;
}

export type AlertCondition =
  | HoldingCondition
  | BalanceCondition
  | PerformanceCondition
  | ActivityCondition;

// ── Row shapes ────────────────────────────────────────────────────────────────

export interface AlertRow {
  id: string;
  name: string;
  alert_type: AlertType;
  condition: AlertCondition;
  scope_mode: ScopeMode;
  /** First entry of `account_numbers`, kept in sync so the scope CHECK and the
   *  single-account index stay valid. Read `account_numbers` for the real scope. */
  account_number: string | null;
  /** Account scope is a set — any accounts, not confined to one household. */
  account_numbers: string[];
  household_id: string | null;
  household_name: string | null;
  frequency: Frequency;
  severity: Severity;
  enabled: boolean;
  /** Out of the working list and never evaluated, but restorable — as opposed to
   *  `enabled: false`, which is a pause the user expects to undo shortly. */
  archived: boolean;
  cooldown_hours: number;
  notify_in_app: boolean;
  notify_email: boolean;
  last_evaluated_at: string | null;
  last_triggered_at: string | null;
  /** Why a rule isn't firing — orphaned scope after a reseed, malformed condition.
   *  Rendered as a red pill; a silently-never-firing alert is the worst failure. */
  last_error: string | null;
  trigger_count: number;
  source: "builder" | "chat";
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface AlertEventRow {
  id: string;
  alert_id: string;
  /** Snapshot of the rule at fire time — editing or deleting a rule must not
   *  rewrite history in the feed. */
  alert_name: string | null;
  alert_type: AlertType | null;
  fingerprint: string;
  title: string;
  detail: string | null;
  account_number: string | null;
  account_name: string | null;
  household_name: string | null;
  /** Set on security-level events. A book-wide "AAPL below $180" is ONE row with
   *  affected_count = holders, not one row per account. */
  symbol: string | null;
  affected_count: number;
  observed_value: number | null;
  threshold_value: number | null;
  /** {metric, op, threshold, asOf, …} for the expanded row. */
  observed: Record<string, unknown> | null;
  severity: Severity;
  status: "new" | "acknowledged";
  triggered_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
}

/** The subset a client sends to POST /api/alerts. The server owns everything else. */
export interface AlertDraft {
  name: string;
  alert_type: AlertType;
  condition: AlertCondition;
  scope_mode: ScopeMode;
  account_number?: string | null;
  household_id?: string | null;
  household_name?: string | null;
  frequency?: Frequency;
  severity?: Severity;
  cooldown_hours?: number;
  notify_in_app?: boolean;
  notify_email?: boolean;
}

// ── Labels ────────────────────────────────────────────────────────────────────

export const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  holding: "Price & holdings",
  balance: "Balance & cash",
  performance: "Performance & drift",
  activity: "Activity & compliance",
};

export const ALERT_TYPE_BLURBS: Record<AlertType, string> = {
  holding: "A position crosses a price, value, or weight you care about.",
  balance: "Cash runs low, or an account's value crosses a line.",
  performance: "Return or drift moves outside the band you set.",
  activity: "Big transactions, pending items, or a margin call.",
};

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  realtime: "real-time",
  daily: "daily",
  weekly: "weekly",
};

/** How often each frequency is eligible to be re-checked, in hours. */
export const FREQUENCY_INTERVAL_HOURS: Record<Frequency, number> = {
  realtime: 0,
  daily: 24,
  weekly: 168,
};

// ── Formatting ────────────────────────────────────────────────────────────────

/**
 * Money for alert copy. Unlike formatCurrency in format-utils (which always
 * rounds to whole dollars) this keeps cents on small values, because a
 * "falls below $180.50" threshold must not read back as "$181".
 */
export function alertMoney(value: number): string {
  const decimals = Math.abs(value) < 1000 && !Number.isInteger(value) ? 2 : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function pct(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(2)}%`;
}

// ── describeCondition — the WHEN ──────────────────────────────────────────────

/**
 * Renders a condition as a plain-English clause beginning with "when".
 * Designed to read naturally inside a sentence:
 *   `Alert me ${describeCondition(c)} · ${describeScope(a)}`
 */
export function describeCondition(condition: AlertCondition): string {
  switch (condition.type) {
    case "holding": {
      const dir = condition.operator === "above" ? "rises above" : "falls below";
      const sym = condition.symbol.toUpperCase();
      switch (condition.metric) {
        case "price":
          return `when ${sym} ${dir} ${alertMoney(condition.value)}`;
        case "day_change_pct":
          return `when ${sym} moves ${condition.operator === "above" ? "up" : "down"} more than ${pct(condition.value)} in a day`;
        case "position_value":
          return `when the ${sym} position ${dir} ${alertMoney(condition.value)}`;
        case "weight_pct":
          return `when ${sym} ${dir} ${pct(condition.value)} of the account`;
      }
      break;
    }
    case "balance": {
      const dir = condition.operator === "above" ? "rises above" : "drops below";
      switch (condition.metric) {
        case "cash_balance":
          return `when cash ${dir} ${alertMoney(condition.value)}`;
        case "cash_pct":
          return `when cash ${dir} ${pct(condition.value)} of account value`;
        case "total_value":
          return `when account value ${dir} ${alertMoney(condition.value)}`;
      }
      break;
    }
    case "performance": {
      const period =
        condition.period === "latest" ? "the latest period" : condition.period.toUpperCase();
      const dir = condition.operator === "above" ? "rises above" : "falls below";
      switch (condition.metric) {
        case "twr_return":
          return `when ${period} return ${dir} ${pct(condition.value)}`;
        case "alpha":
          return condition.operator === "below"
            ? `when ${period} return trails its benchmark by more than ${pct(Math.abs(condition.value))}`
            : `when ${period} return beats its benchmark by more than ${pct(condition.value)}`;
        case "drift_pct":
          return `when allocation drifts more than ${pct(condition.value)} from target`;
      }
      break;
    }
    case "activity": {
      switch (condition.event) {
        case "large_transaction":
          return `when a transaction over ${alertMoney(condition.minValue ?? 0)} posts`;
        case "pending_transfer":
          return condition.minValue
            ? `when a transfer over ${alertMoney(condition.minValue)} is awaiting approval`
            : "when a transfer is awaiting approval";
        case "pending_application":
          return "when an account application is awaiting review";
        case "margin_call":
          return "when an account goes into a federal call or house deficit";
      }
      break;
    }
  }
  // Unreachable for well-formed conditions; keeps the UI honest if a row is malformed.
  return "when its condition is met";
}

// ── describeScope — the WHERE ─────────────────────────────────────────────────

/** Renders an alert's scope: which account(s), household, or the whole book. */
export function describeScope(
  alert: Pick<AlertRow, "scope_mode" | "account_number" | "household_name"> & {
    account_numbers?: string[];
  },
): string {
  switch (alert.scope_mode) {
    case "account": {
      const list = alert.account_numbers?.length
        ? alert.account_numbers
        : alert.account_number
          ? [alert.account_number]
          : [];
      if (list.length === 0) return "No account selected";
      if (list.length === 1) return list[0];
      // Name the first so the row still says something concrete, then count.
      return `${list[0]} +${list.length - 1} more`;
    }
    case "household":
      return alert.household_name ? `${alert.household_name} household` : "No household selected";
    case "book":
      return "Entire book";
  }
}

/** One-line summary used by the chat confirm-card and the drawer preview. */
export function describeAlert(
  alert: Pick<AlertRow, "scope_mode" | "account_number" | "household_name" | "frequency"> & {
    condition: AlertCondition;
  },
): string {
  return `Alert me ${describeCondition(alert.condition)} · ${describeScope(alert)} · checked ${FREQUENCY_LABELS[alert.frequency]}`;
}

// ── Validation ────────────────────────────────────────────────────────────────
// Runs at the API boundary for BOTH creation paths. The natural-language path
// needs this most: an LLM-authored condition must never reach the database.

const HOLDING_METRICS = ["price", "day_change_pct", "position_value", "weight_pct"];
const BALANCE_METRICS = ["cash_balance", "cash_pct", "total_value"];
const PERFORMANCE_METRICS = ["twr_return", "alpha", "drift_pct"];
const PERFORMANCE_PERIODS = ["mtd", "qtd", "ytd", "latest"];
const ACTIVITY_EVENTS = [
  "large_transaction",
  "pending_transfer",
  "pending_application",
  "margin_call",
];

/**
 * Narrows unknown JSON to an AlertCondition, or returns an error string naming
 * the problem. Returning the reason (rather than a bare boolean) lets the API
 * echo something actionable and lets the alert-builder re-prompt the model.
 */
export function parseCondition(
  raw: unknown,
): { ok: true; condition: AlertCondition } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Condition must be an object." };
  const c = raw as Record<string, unknown>;
  const type = c.type;

  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const op = (v: unknown): Operator | null => (v === "above" || v === "below" ? v : null);

  switch (type) {
    case "holding": {
      const symbol = typeof c.symbol === "string" ? c.symbol.trim().toUpperCase() : "";
      if (!symbol) return { ok: false, error: "A holding alert needs a symbol." };
      if (!HOLDING_METRICS.includes(String(c.metric)))
        return { ok: false, error: `Unknown holding metric: ${String(c.metric)}` };
      const operator = op(c.operator);
      if (!operator) return { ok: false, error: "Operator must be 'above' or 'below'." };
      const value = num(c.value);
      if (value === null) return { ok: false, error: "A holding alert needs a numeric value." };
      return {
        ok: true,
        condition: { type: "holding", symbol, metric: c.metric as HoldingCondition["metric"], operator, value },
      };
    }
    case "balance": {
      if (!BALANCE_METRICS.includes(String(c.metric)))
        return { ok: false, error: `Unknown balance metric: ${String(c.metric)}` };
      const operator = op(c.operator);
      if (!operator) return { ok: false, error: "Operator must be 'above' or 'below'." };
      const value = num(c.value);
      if (value === null) return { ok: false, error: "A balance alert needs a numeric value." };
      return {
        ok: true,
        condition: { type: "balance", metric: c.metric as BalanceCondition["metric"], operator, value },
      };
    }
    case "performance": {
      if (!PERFORMANCE_METRICS.includes(String(c.metric)))
        return { ok: false, error: `Unknown performance metric: ${String(c.metric)}` };
      const operator = op(c.operator);
      if (!operator) return { ok: false, error: "Operator must be 'above' or 'below'." };
      const value = num(c.value);
      if (value === null) return { ok: false, error: "A performance alert needs a numeric value." };
      const period = PERFORMANCE_PERIODS.includes(String(c.period))
        ? (c.period as PerformanceCondition["period"])
        : "latest";
      return {
        ok: true,
        condition: {
          type: "performance",
          metric: c.metric as PerformanceCondition["metric"],
          operator,
          value,
          period,
        },
      };
    }
    case "activity": {
      if (!ACTIVITY_EVENTS.includes(String(c.event)))
        return { ok: false, error: `Unknown activity event: ${String(c.event)}` };
      const minValue = num(c.minValue);
      return {
        ok: true,
        condition: {
          type: "activity",
          event: c.event as ActivityCondition["event"],
          ...(minValue !== null ? { minValue } : {}),
        },
      };
    }
    default:
      return { ok: false, error: `Unknown alert type: ${String(type)}` };
  }
}
