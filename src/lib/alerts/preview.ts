import {
  evaluateOne,
  loadAccountIndex,
  loadDatasets,
  resolveScope,
  MAX_EVENTS_PER_ALERT,
  type AccountRow,
  type PendingEvent,
  type ScopeFields,
} from "@/lib/alerts/evaluate";
import type { AlertCondition, Severity } from "@/lib/alerts/types";

/**
 * Runs an unsaved alert draft against live data: "here's what this would catch
 * right now."
 *
 * This is the answer to the failure mode that matters most. A rule can be
 * perfectly valid and still never fire — a threshold on the wrong side of the
 * market, a metric the evaluator skips, a symbol with no price on file. Saved,
 * it looks set. The preview is the only point where that's visible before the
 * advisor commits.
 *
 * It shares scope resolution, data loading and evaluation with the live sweep
 * (evaluate.ts) but none of the write path: no frequency gate, no cooldown, no
 * dedupe against open events, no rows written, no stamps.
 */

/** Above this, the performance and activity families cost more than a chat turn is worth. */
const MAX_PREVIEW_ACCOUNTS = 250;
const PREVIEW_BUDGET_MS = 6_000;

export interface AlertPreview {
  status: "evaluated" | "skipped";
  /** Events produced — the number of rows the alert feed would get. */
  matchCount: number;
  /** Accounts or positions actually implicated; a rolled-up event covers many. */
  affectedCount: number;
  /** How many accounts the scope resolved to. The denominator for "6 of 214". */
  scopeCount: number;
  samples: { title: string; detail: string | null; accountNumber: string | null }[];
  /** Set when a structural reason makes a result mean something other than "not yet". */
  caveat?: string;
  skipReason?: string;
}

export interface AlertDraftForPreview extends ScopeFields {
  name: string;
  condition: AlertCondition;
  severity: Severity;
}

export async function previewDraft(draft: AlertDraftForPreview): Promise<AlertPreview> {
  const empty: AlertPreview = { status: "skipped", matchCount: 0, affectedCount: 0, scopeCount: 0, samples: [] };

  // drift_pct is short-circuited before any query: the evaluator skips it
  // unconditionally, so there is nothing to look up and "0 matches" would read as
  // "not right now" instead of "not ever".
  if (draft.condition.type === "performance" && draft.condition.metric === "drift_pct") {
    return {
      ...empty,
      status: "evaluated",
      caveat:
        "Allocation drift isn't modelled yet, so this rule can never fire. Watching a specific holding's weight is the closest thing that works.",
    };
  }

  try {
    return await withBudget(run(draft), {
      ...empty,
      skipReason: "Preview timed out. Create it and use Run checks on the Alerts page.",
    });
  } catch (error) {
    // A preview is a nicety; a proposal is the product. Never let this turn a
    // good proposal into an error.
    console.error("alert preview failed", error);
    return { ...empty, skipReason: "Couldn't preview this one — create it and use Run checks on the Alerts page." };
  }
}

async function run(draft: AlertDraftForPreview): Promise<AlertPreview> {
  // Narrow the index to the scope. The sweep needs every account; a single-account
  // preview has no business paginating the whole book.
  const index = await loadAccountIndex(
    draft.scope_mode === "account"
      ? { accountNumbers: draft.account_numbers?.length ? draft.account_numbers : draft.account_number ? [draft.account_number] : [] }
      : draft.scope_mode === "household" && draft.household_id
        ? { householdId: draft.household_id }
        : undefined,
  );

  const { accounts } = resolveScope(draft, index);
  const scopeCount = accounts.length;
  if (scopeCount === 0) {
    return { status: "skipped", matchCount: 0, affectedCount: 0, scopeCount: 0, samples: [], skipReason: "That scope doesn't resolve to any accounts." };
  }

  // Balance reads off the index and holding is bounded by holders of one ticker,
  // so both stay cheap at any width. Performance is capped at 1000 rows upstream
  // and activity pulls every transaction for every account in scope — those two
  // are the ones that need a ceiling.
  const family = draft.condition.type;
  if ((family === "performance" || family === "activity") && scopeCount > MAX_PREVIEW_ACCOUNTS) {
    return {
      status: "skipped",
      matchCount: 0,
      affectedCount: 0,
      scopeCount,
      samples: [],
      skipReason: `Too wide to preview instantly (${scopeCount} accounts). Create it and use Run checks on the Alerts page.`,
    };
  }

  const scoped = [{ condition: draft.condition, accounts }];
  const datasets = await loadDatasets(scoped, new Date());

  const events = evaluateOne(
    {
      alert: { id: "preview", name: draft.name, alert_type: family, severity: draft.severity },
      condition: draft.condition,
      accounts,
    },
    datasets,
  );

  return {
    status: "evaluated",
    matchCount: events.length,
    affectedCount: events.reduce((n, e) => n + (e.affected_count || 1), 0),
    scopeCount,
    samples: events.slice(0, 3).map((e) => ({
      title: e.title,
      detail: e.detail,
      accountNumber: e.account_number,
    })),
    caveat: caveatFor(draft, accounts, datasets, events),
  };
}

/**
 * Why a result might not mean what it looks like. Zero is the interesting case —
 * it can mean "the threshold hasn't been crossed", but it can equally mean the
 * data to check it isn't there, and those need telling apart.
 */
function caveatFor(
  draft: AlertDraftForPreview,
  accounts: AccountRow[],
  datasets: Awaited<ReturnType<typeof loadDatasets>>,
  events: PendingEvent[],
): string | undefined {
  const c = draft.condition;

  // The sweep caps notifications per rule, so a preview reporting 100 matches would
  // otherwise promise 100 rows in a feed that will only ever show 25.
  if (events.length > MAX_EVENTS_PER_ALERT) {
    return `That's a lot — Composer notifies on the first ${MAX_EVENTS_PER_ALERT} each check, so this is worth narrowing.`;
  }

  if (c.type === "holding") {
    if (c.metric === "price" || c.metric === "day_change_pct") {
      const sec = datasets.securities.get(c.symbol);
      if (!sec) return `There's no price on file for ${c.symbol}, so this can't be checked.`;
      if (c.metric === "day_change_pct" && sec.previousClose === null) {
        return `${c.symbol} has no previous close on file, so its one-day move reads as 0% — this won't fire until prices sync.`;
      }
    } else {
      const holders = datasets.holdings.filter((h) => h.symbol === c.symbol).length;
      if (holders === 0) {
        return `None of the ${accounts.length} account${accounts.length === 1 ? "" : "s"} in scope hold ${c.symbol}.`;
      }
      if (c.metric === "weight_pct") {
        const noTotal = accounts.filter((a) => !a.total_value).length;
        if (noTotal > 0) {
          return `${noTotal} account${noTotal === 1 ? " has" : "s have"} no total value on file, so their weight reads as 0% — a "below" rule will match them.`;
        }
      }
    }
  }

  if (c.type === "activity" && c.event === "pending_application" && draft.scope_mode !== "book") {
    return "Applications aren't tied to an account until they're approved, so this fires once for the whole book regardless of scope.";
  }

  if (c.type === "performance" && events.length === 0) {
    const covered = accounts.filter((a) => datasets.performance.has(a.id)).length;
    if (covered === 0) return "No performance figures are on file for these accounts yet.";
  }

  return undefined;
}

function withBudget<T>(work: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const budget = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), PREVIEW_BUDGET_MS);
  });
  return Promise.race([work, budget]).finally(() => clearTimeout(timer));
}
