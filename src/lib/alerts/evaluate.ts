import { randomUUID } from "node:crypto";
import { supabase } from "@/lib/supabase";
import { paginateQuery } from "@/lib/supabase-paginate";
import {
  FREQUENCY_INTERVAL_HOURS,
  alertMoney,
  describeCondition,
  parseCondition,
  type AlertCondition,
  type AlertRow,
  type Severity,
} from "@/lib/alerts/types";

/**
 * The alert evaluator.
 *
 * Architecture: **resolve once, evaluate many.** The naive shape (one query per
 * rule) turns 50 rules into 200 round-trips every sweep. Instead the run pulls the
 * account index once, then pulls one dataset per *family* keyed on the union of
 * every rule in it, and evaluates in memory.
 *
 * Two things keep this from becoming spam:
 *  - **Roll-ups.** A book-wide "AAPL below $180" writes ONE event with
 *    affected_count, not one per holder.
 *  - **Dedupe.** An open (status='new') event for the same fingerprint suppresses
 *    a re-fire, backed by the partial unique index in 0004_alerts.sql. Cooldown
 *    then governs how soon it may fire again after being acknowledged.
 */

export const MAX_EVENTS_PER_ALERT = 25;
const MAX_EVENTS_PER_RUN = 300;

export interface EvaluationSummary {
  evaluated: number;
  triggered: number;
  eventsWritten: number;
  skipped: number;
  durationMs: number;
  errors: { alertId: string; message: string }[];
  /** Populated only when dryRun — what WOULD have been written. */
  preview?: PendingEvent[];
}

export interface PendingEvent {
  alert_id: string;
  alert_name: string;
  alert_type: string;
  fingerprint: string;
  title: string;
  detail: string | null;
  account_number: string | null;
  account_name: string | null;
  household_name: string | null;
  symbol: string | null;
  affected_count: number;
  observed_value: number | null;
  threshold_value: number | null;
  observed: Record<string, unknown>;
  severity: Severity;
}

export interface AccountRow {
  id: string;
  account_number: string;
  account_name: string | null;
  client_name: string | null;
  household_id: string | null;
  household_name: string | null;
  total_value: number | null;
  cash_balance: number | null;
}

export interface AccountIndex {
  accounts: AccountRow[];
  byNumber: Map<string, AccountRow>;
  byHousehold: Map<string, AccountRow[]>;
}

/** The scope columns resolveScope reads — a draft can satisfy this without a row. */
export type ScopeFields = Pick<
  AlertRow,
  "scope_mode" | "account_number" | "account_numbers" | "household_id" | "household_name"
>;

/**
 * All evaluateOne needs of a rule. Everything else on AlertRow — frequency,
 * cooldown, the last_* stamps — is handled by the sweep around it, which is what
 * lets an unsaved draft be evaluated by the same code (see preview.ts).
 */
export type RuleIdentity = Pick<AlertRow, "id" | "name" | "alert_type" | "severity">;

/** Does `observed` satisfy the rule? One comparison, used by every family. */
function crosses(observed: number, operator: "above" | "below", threshold: number): boolean {
  return operator === "above" ? observed > threshold : observed < threshold;
}

function fingerprint(alertId: string, subject: string, condition: AlertCondition): string {
  const t = condition.type === "activity" ? condition.event : `${condition.metric}`;
  const v = condition.type === "activity" ? (condition.minValue ?? 0) : condition.value;
  // Derived from the THRESHOLD, never the observed value — otherwise every price
  // tick would mint a new fingerprint and dedupe would never bite.
  return `${alertId}|${subject}|${t}|${v}`;
}

export async function evaluateAlerts(opts: {
  alertId?: string;
  dryRun?: boolean;
  now?: Date;
} = {}): Promise<EvaluationSummary> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const summary: EvaluationSummary = {
    evaluated: 0,
    triggered: 0,
    eventsWritten: 0,
    skipped: 0,
    durationMs: 0,
    errors: [],
  };

  // ── 1 · Load candidate rules ──────────────────────────────────────────────
  // Archived rules are never evaluated, even by an explicit single-rule run —
  // archiving has to actually stop the thing firing, or it's just a filter.
  let ruleQuery = supabase.from("alerts").select("*").eq("archived", false);
  if (opts.alertId) ruleQuery = ruleQuery.eq("id", opts.alertId);
  else ruleQuery = ruleQuery.eq("enabled", true);

  const { data: ruleData, error: ruleErr } = await ruleQuery;
  if (ruleErr) throw new Error(`Could not load alerts: ${ruleErr.message}`);

  const candidates: { alert: AlertRow; condition: AlertCondition }[] = [];
  for (const raw of (ruleData ?? []) as AlertRow[]) {
    // A hand-edited or model-authored row must not crash the sweep.
    const parsed = parseCondition(raw.condition);
    if (!parsed.ok) {
      summary.skipped++;
      if (!opts.dryRun) await markError(raw.id, `Invalid condition: ${parsed.error}`, now);
      continue;
    }
    // Frequency gate — cheapest possible short-circuit.
    if (!opts.dryRun && !opts.alertId && raw.last_evaluated_at) {
      const dueAfter =
        new Date(raw.last_evaluated_at).getTime() +
        FREQUENCY_INTERVAL_HOURS[raw.frequency] * 3_600_000;
      if (now.getTime() < dueAfter) {
        summary.skipped++;
        continue;
      }
    }
    candidates.push({ alert: raw, condition: parsed.condition });
  }

  if (candidates.length === 0) {
    summary.durationMs = Date.now() - started;
    return summary;
  }

  // ── 2 · One account index for the whole run ───────────────────────────────
  const index = await loadAccountIndex();

  // ── 3 · Scope resolution ──────────────────────────────────────────────────
  // A scope that no longer resolves gets last_error rather than silence — after a
  // reseed, account CUIDs churn and an orphaned rule would otherwise just never
  // fire, which is this feature's worst failure mode.
  const scoped: { alert: AlertRow; condition: AlertCondition; accounts: AccountRow[] }[] = [];
  // Warnings for rules that resolved only PART of their scope. Collected rather
  // than written immediately, because the end-of-run stamp clears last_error on
  // every evaluated rule — writing here would just be overwritten a moment later.
  const scopeWarnings = new Map<string, string>();
  for (const c of candidates) {
    const { accounts: list, missing } = resolveScope(c.alert, index);

    // Some resolved but not all — evaluate what exists and say which are gone,
    // rather than silently narrowing the scope.
    if (list.length > 0 && missing.length > 0) {
      scopeWarnings.set(
        c.alert.id,
        `${missing.join(", ")} not found in the book — still watching ${list.length} of ${list.length + missing.length}.`,
      );
    }

    if (list.length === 0) {
      const what =
        c.alert.scope_mode === "account"
          ? `Account ${(c.alert.account_numbers?.length ? c.alert.account_numbers : [c.alert.account_number]).join(", ")} not found`
          : `Household ${c.alert.household_name ?? c.alert.household_id} not found`;
      summary.skipped++;
      if (!opts.dryRun) await markError(c.alert.id, `${what} — check the alert's scope.`, now);
      continue;
    }
    scoped.push({ ...c, accounts: list });
  }

  // ── 4 · Bulk-fetch per family, keyed on the union of all rules in it ───────
  const datasets = await loadDatasets(scoped, now);

  // ── 5 · Which fingerprints already have an open event? ────────────────────
  const { data: openRows } = await supabase
    .from("alert_events")
    .select("alert_id, fingerprint")
    .eq("status", "new");
  const openKeys = new Set((openRows ?? []).map((r) => `${r.alert_id}|${r.fingerprint}`));

  // ── 6 · Evaluate ──────────────────────────────────────────────────────────
  const pending: PendingEvent[] = [];
  const firedByAlert = new Map<string, number>();

  for (const s of scoped) {
    summary.evaluated++;
    let produced: PendingEvent[] = [];
    try {
      produced = evaluateOne(s, datasets);
    } catch (err) {
      summary.errors.push({
        alertId: s.alert.id,
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    // Cooldown: only applies once an event has been acknowledged (an open one is
    // caught by openKeys below). Skip the whole rule while it's still cooling.
    if (!opts.dryRun && s.alert.last_triggered_at && s.alert.cooldown_hours > 0) {
      const coolUntil =
        new Date(s.alert.last_triggered_at).getTime() + s.alert.cooldown_hours * 3_600_000;
      if (now.getTime() < coolUntil) produced = [];
    }

    const fresh = opts.dryRun
      ? produced
      : produced.filter((p) => !openKeys.has(`${p.alert_id}|${p.fingerprint}`));

    const capped = fresh.slice(0, MAX_EVENTS_PER_ALERT);
    if (fresh.length > MAX_EVENTS_PER_ALERT && !opts.dryRun) {
      // Silent truncation would read as "nothing else matched".
      await markError(
        s.alert.id,
        `Matched ${fresh.length} times — showing the first ${MAX_EVENTS_PER_ALERT}. Consider narrowing the scope.`,
        now,
      );
    }

    if (capped.length) {
      summary.triggered++;
      firedByAlert.set(s.alert.id, capped.length);
    }
    pending.push(...capped);
    if (pending.length >= MAX_EVENTS_PER_RUN) break;
  }

  if (opts.dryRun) {
    summary.preview = pending;
    summary.durationMs = Date.now() - started;
    return summary;
  }

  // ── 7 · Write ─────────────────────────────────────────────────────────────
  if (pending.length) {
    const rows = pending.slice(0, MAX_EVENTS_PER_RUN).map((p) => ({ id: randomUUID(), ...p }));
    const { error } = await supabase.from("alert_events").insert(rows);
    if (error) {
      // 23505 = the partial unique index caught a concurrent run. That's dedupe
      // working, not a failure.
      if (error.code !== "23505") {
        summary.errors.push({ alertId: "-", message: error.message });
      }
    } else {
      summary.eventsWritten = rows.length;
    }
  }

  // Stamp every evaluated rule, fired or not — that's what powers "last checked".
  const stamp = now.toISOString();
  await Promise.all(
    scoped.map((s) => {
      const fired = firedByAlert.get(s.alert.id) ?? 0;
      return supabase
        .from("alerts")
        .update({
          last_evaluated_at: stamp,
          // Clears on a clean run; preserved when only part of the scope resolved.
          last_error: scopeWarnings.get(s.alert.id) ?? null,
          ...(fired
            ? {
                last_triggered_at: stamp,
                trigger_count: (s.alert.trigger_count ?? 0) + fired,
              }
            : {}),
        })
        .eq("id", s.alert.id);
    }),
  );

  summary.durationMs = Date.now() - started;
  return summary;
}

// ── Reusable pieces ──────────────────────────────────────────────────────────
//
// The sweep above and the draft preview in preview.ts share scope resolution,
// data loading and per-rule evaluation, but nothing else: the preview must skip
// the frequency gate, the cooldown, the open-event dedupe, the write and the
// stamp. They stay separate functions rather than one parameterised runner —
// merging the read path and the write path is exactly how the live sweep would
// pick up a regression from a preview-only change.

/**
 * The account index. `filter` is for previews of a narrow scope: the sweep needs
 * every account and passes nothing, which leaves the query byte-identical to what
 * it was before this was extracted.
 */
export async function loadAccountIndex(filter?: {
  accountNumbers?: string[];
  householdId?: string;
}): Promise<AccountIndex> {
  const accounts = await paginateQuery<AccountRow>((from, to) => {
    const base = supabase
      .from("portfolio_accounts")
      .select("id, account_number, account_name, client_name, household_id, household_name, total_value, cash_balance")
      .order("account_number");
    const narrowed = filter?.accountNumbers?.length
      ? base.in("account_number", filter.accountNumbers)
      : filter?.householdId
        ? base.eq("household_id", filter.householdId)
        : base;
    return narrowed.range(from, to);
  });

  const byNumber = new Map(accounts.map((a) => [a.account_number, a]));
  const byHousehold = new Map<string, AccountRow[]>();
  for (const a of accounts) {
    if (!a.household_id) continue;
    const list = byHousehold.get(a.household_id) ?? [];
    list.push(a);
    byHousehold.set(a.household_id, list);
  }
  return { accounts, byNumber, byHousehold };
}

/**
 * Which accounts a rule covers. Pure — the caller decides what an empty result or
 * a partial `missing` list means, because the sweep records those as rule errors
 * while a preview just reports them.
 */
export function resolveScope(
  alert: ScopeFields,
  index: AccountIndex,
): { accounts: AccountRow[]; missing: string[] } {
  if (alert.scope_mode === "book") return { accounts: index.accounts, missing: [] };
  if (alert.scope_mode === "household") {
    return { accounts: index.byHousehold.get(alert.household_id!) ?? [], missing: [] };
  }
  // Account scope is a set. Fall back to the legacy single column for any row
  // written before account_numbers existed.
  const wanted = alert.account_numbers?.length
    ? alert.account_numbers
    : alert.account_number
      ? [alert.account_number]
      : [];
  return {
    accounts: wanted.map((n) => index.byNumber.get(n)).filter((a): a is AccountRow => Boolean(a)),
    missing: wanted.filter((n) => !index.byNumber.has(n)),
  };
}

/** One fetch per family, keyed on the union of every rule in it. */
export async function loadDatasets(
  scoped: { condition: AlertCondition; accounts: AccountRow[] }[],
  now: Date,
): Promise<Datasets> {
  const accountIds = [...new Set(scoped.flatMap((s) => s.accounts.map((a) => a.id)))];
  const symbols = [
    ...new Set(
      scoped
        .filter((s) => s.condition.type === "holding")
        .map((s) => (s.condition as { symbol: string }).symbol),
    ),
  ];

  // Every holding rule, including price and day_change_pct. Those two don't need
  // holdings to test the threshold, but they DO need them for affected_count —
  // the "and N accounts hold it" on a rolled-up event. Excluding them made that
  // count depend on whether some *other* rule in the same sweep happened to pull
  // holdings, so an event could read "0 positions" on one run and the truth on
  // the next. The extra query is filtered to these symbols and is cheap.
  const needsHoldings = scoped.some((s) => s.condition.type === "holding");
  const needsSecurities = scoped.some(
    (s) =>
      s.condition.type === "holding" &&
      (s.condition.metric === "price" || s.condition.metric === "day_change_pct"),
  );
  const needsPerformance = scoped.some((s) => s.condition.type === "performance");
  const needsActivity = scoped.some((s) => s.condition.type === "activity");

  const [securities, holdings, performance, activity] = await Promise.all([
    needsSecurities && symbols.length ? loadSecurities(symbols) : Promise.resolve(new Map()),
    needsHoldings && symbols.length ? loadHoldings(accountIds, symbols) : Promise.resolve([]),
    needsPerformance && accountIds.length ? loadPerformance(accountIds) : Promise.resolve(new Map()),
    needsActivity && accountIds.length ? loadActivity(accountIds) : Promise.resolve(emptyActivity()),
  ]);

  return { securities, holdings, performance, activity, now };
}

// ── Per-rule evaluation ──────────────────────────────────────────────────────

export interface Datasets {
  securities: Map<string, { price: number; previousClose: number | null; priceDate: string | null }>;
  holdings: HoldingRow[];
  performance: Map<string, { twr: number; benchmark: number; period: string }>;
  activity: ActivityData;
  now: Date;
}

export function evaluateOne(
  s: { alert: RuleIdentity; condition: AlertCondition; accounts: AccountRow[] },
  d: Datasets,
): PendingEvent[] {
  const { alert, condition, accounts } = s;
  const base = {
    alert_id: alert.id,
    alert_name: alert.name,
    alert_type: alert.alert_type,
    severity: alert.severity,
  };
  const when = describeCondition(condition);

  switch (condition.type) {
    case "holding": {
      // price / day_change_pct are SECURITY-level: one event for the whole book,
      // with affected_count. Firing 400 identical rows is what makes an alert
      // system unusable.
      if (condition.metric === "price" || condition.metric === "day_change_pct") {
        const sec = d.securities.get(condition.symbol);
        if (!sec) return [];
        const observed =
          condition.metric === "price"
            ? sec.price
            : sec.previousClose
              ? ((sec.price - sec.previousClose) / sec.previousClose) * 100
              : 0;
        if (!crosses(observed, condition.operator, condition.value)) return [];
        const holders = d.holdings.filter((h) => h.symbol === condition.symbol).length;
        return [
          {
            ...base,
            fingerprint: fingerprint(alert.id, condition.symbol, condition),
            title: `${condition.symbol} ${condition.operator === "below" ? "fell below" : "rose above"} ${
              condition.metric === "price" ? alertMoney(condition.value) : `${condition.value}%`
            }`,
            // The honest "as of": prices come from the synced Security table, not a
            // live tick, so the user can see how fresh the number is.
            detail: `Last ${alertMoney(sec.price)}${sec.priceDate ? ` as of ${sec.priceDate.slice(0, 10)}` : ""}${holders ? ` · ${holders} position${holders === 1 ? "" : "s"} in scope` : ""}`,
            account_number: null,
            account_name: null,
            household_name: null,
            symbol: condition.symbol,
            affected_count: Math.max(holders, 1),
            observed_value: round(observed),
            threshold_value: condition.value,
            observed: {
              metric: condition.metric,
              observed: round(observed),
              threshold: condition.value,
              as_of: sec.priceDate,
              condition: when,
            },
          },
        ];
      }

      // position_value / weight_pct are ACCOUNT-level.
      const out: PendingEvent[] = [];
      for (const a of accounts) {
        const h = d.holdings.find((x) => x.account_id === a.id && x.symbol === condition.symbol);
        if (!h) continue;
        const observed =
          condition.metric === "position_value"
            ? h.market_value
            : a.total_value
              ? (h.market_value / a.total_value) * 100
              : 0;
        if (!crosses(observed, condition.operator, condition.value)) continue;
        out.push({
          ...base,
          fingerprint: fingerprint(alert.id, `${a.account_number}:${condition.symbol}`, condition),
          title: `${condition.symbol} ${when.replace(/^when /, "")}`,
          detail: `${a.account_number} · observed ${fmt(observed, condition.metric === "position_value")}`,
          account_number: a.account_number,
          account_name: a.account_name,
          household_name: a.household_name,
          symbol: condition.symbol,
          affected_count: 1,
          observed_value: round(observed),
          threshold_value: condition.value,
          observed: { metric: condition.metric, observed: round(observed), threshold: condition.value, condition: when },
        });
      }
      return out;
    }

    case "balance": {
      const out: PendingEvent[] = [];
      for (const a of accounts) {
        const cash = Number(a.cash_balance) || 0;
        const total = Number(a.total_value) || 0;
        const observed =
          condition.metric === "cash_balance"
            ? cash
            : condition.metric === "total_value"
              ? total
              : total > 0
                ? (cash / total) * 100
                : 0;
        // An account with no value can't meaningfully be "below 2% cash".
        if (condition.metric === "cash_pct" && total <= 0) continue;
        if (!crosses(observed, condition.operator, condition.value)) continue;
        out.push({
          ...base,
          fingerprint: fingerprint(alert.id, a.account_number, condition),
          title: `${a.account_number} — ${when.replace(/^when /, "")}`,
          detail: `${a.account_name ?? a.client_name ?? ""} · observed ${fmt(observed, condition.metric !== "cash_pct")}`.trim(),
          account_number: a.account_number,
          account_name: a.account_name,
          household_name: a.household_name,
          symbol: null,
          affected_count: 1,
          observed_value: round(observed),
          threshold_value: condition.value,
          observed: {
            metric: condition.metric,
            observed: round(observed),
            threshold: condition.value,
            cash_balance: cash,
            total_value: total,
            condition: when,
          },
        });
      }
      return out;
    }

    case "performance": {
      const out: PendingEvent[] = [];
      for (const a of accounts) {
        const p = d.performance.get(a.id);
        if (!p) continue;
        const observed =
          condition.metric === "alpha"
            ? (p.twr - p.benchmark) * 100
            : condition.metric === "twr_return"
              ? p.twr * 100
              : 0;
        // drift_pct needs target allocations, which aren't modelled yet — skip
        // rather than fire on a fabricated zero.
        if (condition.metric === "drift_pct") continue;
        if (!crosses(observed, condition.operator, condition.value)) continue;
        out.push({
          ...base,
          fingerprint: fingerprint(alert.id, a.account_number, condition),
          title: `${a.account_number} — ${when.replace(/^when /, "")}`,
          detail: `${a.account_name ?? ""} · ${round(observed)}% over ${p.period}`.trim(),
          account_number: a.account_number,
          account_name: a.account_name,
          household_name: a.household_name,
          symbol: null,
          affected_count: 1,
          observed_value: round(observed),
          threshold_value: condition.value,
          observed: {
            metric: condition.metric,
            observed: round(observed),
            threshold: condition.value,
            twr_pct: round(p.twr * 100),
            benchmark_pct: round(p.benchmark * 100),
            period: p.period,
            condition: when,
          },
        });
      }
      return out;
    }

    case "activity": {
      const out: PendingEvent[] = [];

      // Pending applications carry no account reference in the schema, so this is
      // reported once as a book-level count rather than faked onto an account.
      if (condition.event === "pending_application") {
        if (d.activity.applicationCount === 0) return [];
        return [
          {
            ...base,
            fingerprint: fingerprint(alert.id, "book", condition),
            title: `${d.activity.applicationCount} account application${d.activity.applicationCount === 1 ? "" : "s"} awaiting review`,
            detail: "Applications aren't tied to an account until they're approved.",
            account_number: null,
            account_name: null,
            household_name: null,
            symbol: null,
            affected_count: d.activity.applicationCount,
            observed_value: d.activity.applicationCount,
            threshold_value: null,
            observed: { event: condition.event, pending: d.activity.applicationCount, condition: when },
          },
        ];
      }

      for (const a of accounts) {
        let observed: number | null = null;
        let label = "";

        if (condition.event === "large_transaction") {
          const min = condition.minValue ?? 0;
          const hit = d.activity.transactions
            .filter((t) => t.account_id === a.id && Math.abs(t.amount) >= min)
            .sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount))[0];
          if (!hit) continue;
          observed = Math.abs(hit.amount);
          label = `${hit.type ?? "transaction"} of ${alertMoney(Math.abs(hit.amount))}`;
        } else if (condition.event === "pending_transfer") {
          const min = condition.minValue ?? 0;
          // A transfer touches two accounts; either side counts as in scope.
          const hit = d.activity.transfers.filter(
            (t) =>
              (t.from_account_id === a.id || t.to_account_id === a.id) &&
              Number(t.amount ?? 0) >= min,
          )[0];
          if (!hit) continue;
          observed = Number(hit.amount ?? 0);
          label = `transfer of ${alertMoney(observed)} awaiting approval`;
        } else {
          const hit = d.activity.margin.find((m) => m.account_id === a.id);
          if (!hit) continue;
          observed = hit.federal_call || -hit.house_surplus;
          label =
            hit.federal_call > 0
              ? `federal call of ${alertMoney(hit.federal_call)}`
              : `house deficit of ${alertMoney(Math.abs(hit.house_surplus))}`;
        }

        out.push({
          ...base,
          fingerprint: fingerprint(alert.id, a.account_number, condition),
          title: `${a.account_number} — ${label}`,
          detail: a.account_name ?? a.client_name ?? null,
          account_number: a.account_number,
          account_name: a.account_name,
          household_name: a.household_name,
          symbol: null,
          affected_count: 1,
          observed_value: observed === null ? null : round(observed),
          threshold_value: condition.minValue ?? null,
          observed: { event: condition.event, observed, condition: when },
        });
      }
      return out;
    }
  }
}

// ── Dataset loaders ──────────────────────────────────────────────────────────

interface HoldingRow {
  account_id: string;
  symbol: string;
  market_value: number;
}

interface ActivityData {
  transactions: { account_id: string; amount: number; type: string | null }[];
  /** `transfers` has no account_id — it keys on from_account_id / to_account_id,
   *  so a transfer is attributed to BOTH sides and matched either way. */
  transfers: { from_account_id: string | null; to_account_id: string | null; amount: number | null }[];
  /** `account_applications` has no account link at all (only client names), so
   *  pending applications can only be reported as a book-level count. */
  applicationCount: number;
  margin: { account_id: string; federal_call: number; house_surplus: number }[];
}

const emptyActivity = (): ActivityData => ({
  transactions: [],
  transfers: [],
  applicationCount: 0,
  margin: [],
});

async function loadSecurities(symbols: string[]) {
  const { data } = await supabase
    .from("Security")
    .select("symbol, price, previousClose, priceDate")
    .in("symbol", symbols);
  return new Map(
    (data ?? []).map((s) => [
      String(s.symbol),
      {
        price: Number(s.price) || 0,
        previousClose: s.previousClose === null ? null : Number(s.previousClose),
        priceDate: s.priceDate ? String(s.priceDate) : null,
      },
    ]),
  );
}

async function loadHoldings(accountIds: string[], symbols: string[]): Promise<HoldingRow[]> {
  const rows = await paginateQuery<Record<string, unknown>>((from, to) =>
    supabase
      .from("holdings")
      .select("account_id, symbol, market_value")
      .in("symbol", symbols)
      .range(from, to),
  );
  const wanted = new Set(accountIds);
  return rows
    .map((r) => ({
      account_id: String(r.account_id ?? ""),
      symbol: String(r.symbol ?? ""),
      market_value: Number(r.market_value) || 0,
    }))
    .filter((r) => wanted.has(r.account_id));
}

async function loadPerformance(accountIds: string[]) {
  const { data } = await supabase
    .from("AccountPerformance")
    .select("accountId, periodStart, periodEnd, twrReturn, benchmarkReturn")
    .in("accountId", accountIds)
    .order("periodEnd", { ascending: false });

  // Newest period per account wins.
  const latest = new Map<string, { twr: number; benchmark: number; period: string }>();
  for (const p of data ?? []) {
    const id = String(p.accountId);
    if (latest.has(id)) continue;
    latest.set(id, {
      twr: Number(p.twrReturn) || 0,
      benchmark: Number(p.benchmarkReturn) || 0,
      period: `${p.periodStart} to ${p.periodEnd}`,
    });
  }
  return latest;
}

async function loadActivity(accountIds: string[]): Promise<ActivityData> {
  // Status lists lifted from the pending_actions intent in query-builder so the
  // alert and the report agree on what "pending" means.
  const [txns, transfers, apps, balances] = await Promise.all([
    paginateQuery<Record<string, unknown>>((from, to) =>
      supabase
        .from("account_transactions")
        .select("account_id, amount, type")
        .in("account_id", accountIds)
        .order("date", { ascending: false })
        .range(from, to),
    ).catch(() => []),
    (async () => {
      const { data } = await supabase
        .from("transfers")
        .select("from_account_id, to_account_id, amount")
        .in("status", ["pending_approval", "submitted", "in_review"]);
      return data ?? [];
    })().catch(() => []),
    (async () => {
      const { count } = await supabase
        .from("account_applications")
        .select("id", { count: "exact", head: true })
        .in("status", ["submitted", "in_review"]);
      return count ?? 0;
    })().catch(() => 0),
    (async () => {
      const { data } = await supabase
        .from("account_balances")
        .select("account_id, today_federal_call, house_surplus")
        .in("account_id", accountIds);
      return data ?? [];
    })().catch(() => []),
  ]);

  return {
    transactions: (txns as Record<string, unknown>[]).map((t) => ({
      account_id: String(t.account_id ?? ""),
      amount: Number(t.amount) || 0,
      type: t.type ? String(t.type) : null,
    })),
    transfers: (transfers as Record<string, unknown>[]).map((t) => ({
      from_account_id: t.from_account_id ? String(t.from_account_id) : null,
      to_account_id: t.to_account_id ? String(t.to_account_id) : null,
      amount: t.amount === null ? null : Number(t.amount),
    })),
    applicationCount: apps as number,
    margin: (balances as Record<string, unknown>[])
      .map((b) => ({
        account_id: String(b.account_id ?? ""),
        federal_call: Number(b.today_federal_call) || 0,
        house_surplus: Number(b.house_surplus) || 0,
      }))
      .filter((b) => b.federal_call > 0 || b.house_surplus < 0),
  };
}

// ── Small helpers ────────────────────────────────────────────────────────────

async function markError(alertId: string, message: string, now: Date) {
  await supabase
    .from("alerts")
    .update({ last_error: message, last_evaluated_at: now.toISOString() })
    .eq("id", alertId);
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function fmt(n: number, currency: boolean): string {
  return currency ? alertMoney(n) : `${round(n)}%`;
}
