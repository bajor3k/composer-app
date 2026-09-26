"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Toggle from "@/components/ui/Toggle";
import { useAccountDirectory } from "@/components/ai-chat/useAccountDirectory";
import {
  ALERT_TYPES,
  ALERT_TYPE_BLURBS,
  ALERT_TYPE_LABELS,
  FREQUENCIES,
  FREQUENCY_LABELS,
  describeCondition,
  describeScope,
  type ActivityCondition,
  type AlertCondition,
  type AlertRow,
  type AlertType,
  type Frequency,
  type Operator,
  type ScopeMode,
  type Severity,
} from "@/lib/alerts/types";

// Copied verbatim from CreateTicketModal so every form field in the app looks
// the same.
const LABEL =
  "block text-[11px] font-medium uppercase tracking-wider text-black/45 dark:text-white/45 mb-1.5";
const INPUT =
  "w-full px-3 py-2 rounded-lg text-sm text-black dark:text-white bg-surface dark:bg-surface-dark " +
  "border border-border dark:border-border-dark placeholder-black/30 dark:placeholder-white/30 " +
  "outline-none focus:border-black/40 dark:focus:border-white/40 transition-colors";

/** Metric menus, keyed by family. `unit` drives the $ / % adornment. */
const METRICS: Record<AlertType, { key: string; label: string; unit: "currency" | "percent" }[]> = {
  holding: [
    { key: "price", label: "Share price", unit: "currency" },
    { key: "day_change_pct", label: "One-day move", unit: "percent" },
    { key: "position_value", label: "Position value", unit: "currency" },
    { key: "weight_pct", label: "Weight in the account", unit: "percent" },
  ],
  balance: [
    { key: "cash_balance", label: "Cash balance", unit: "currency" },
    { key: "cash_pct", label: "Cash as % of account", unit: "percent" },
    { key: "total_value", label: "Account value", unit: "currency" },
  ],
  performance: [
    { key: "alpha", label: "Return vs. benchmark", unit: "percent" },
    { key: "twr_return", label: "Total return", unit: "percent" },
    { key: "drift_pct", label: "Drift from target allocation", unit: "percent" },
  ],
  activity: [],
};

const ACTIVITY_EVENTS: { key: ActivityCondition["event"]; label: string; needsAmount: boolean }[] = [
  { key: "large_transaction", label: "A large transaction posts", needsAmount: true },
  { key: "pending_transfer", label: "A transfer is awaiting approval", needsAmount: false },
  { key: "pending_application", label: "An application is awaiting review", needsAmount: false },
  { key: "margin_call", label: "A federal call or house deficit appears", needsAmount: false },
];

const PERIODS = [
  { key: "ytd", label: "Year to date" },
  { key: "qtd", label: "Quarter to date" },
  { key: "mtd", label: "Month to date" },
  { key: "latest", label: "Latest period" },
] as const;

interface Props {
  /** Present → edit mode. The page re-keys this component per row so state re-seeds. */
  alert?: AlertRow;
  onClose: () => void;
  onSaved: () => void;
}

export default function AlertBuilderDrawer({ alert, onClose, onSaved }: Props) {
  const editing = Boolean(alert);
  const cond = alert?.condition;

  // ── Field state — one useState per field, the CreateTicketModal pattern ──
  const [name, setName] = useState(alert?.name ?? "");
  const [alertType, setAlertType] = useState<AlertType | null>(alert?.alert_type ?? null);
  const [scopeMode, setScopeMode] = useState<ScopeMode>(alert?.scope_mode ?? "book");
  const [accountNumbers, setAccountNumbers] = useState<string[]>(
    alert?.account_numbers?.length
      ? alert.account_numbers
      : alert?.account_number
        ? [alert.account_number]
        : [],
  );
  const [householdId, setHouseholdId] = useState(alert?.household_id ?? "");
  const [householdName, setHouseholdName] = useState(alert?.household_name ?? "");

  const [metric, setMetric] = useState<string>(
    cond && cond.type !== "activity" ? cond.metric : "",
  );
  const [operator, setOperator] = useState<Operator>(
    cond && cond.type !== "activity" ? cond.operator : "below",
  );
  const [value, setValue] = useState<string>(
    cond && cond.type !== "activity" ? String(cond.value) : "",
  );
  const [symbol, setSymbol] = useState(cond?.type === "holding" ? cond.symbol : "");
  const [period, setPeriod] = useState<string>(cond?.type === "performance" ? cond.period : "ytd");
  const [activityEvent, setActivityEvent] = useState<ActivityCondition["event"]>(
    cond?.type === "activity" ? cond.event : "large_transaction",
  );
  const [minValue, setMinValue] = useState<string>(
    cond?.type === "activity" && cond.minValue != null ? String(cond.minValue) : "",
  );

  const [frequency, setFrequency] = useState<Frequency>(alert?.frequency ?? "daily");

  // Priority and repeat are no longer exposed in the drawer. They still exist on
  // the row, so carry the alert's own values through on edit rather than resetting
  // them, and fall back to the previous form defaults on create.
  const severity: Severity = alert?.severity ?? "warning";
  const cooldownHours: number = alert?.cooldown_hours ?? 24;

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ── Slide-in / slide-out ──
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const dismiss = () => {
    if (submitting) return;
    setShown(false);
    window.setTimeout(onClose, 320);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitting]);

  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = window.setTimeout(() => nameRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, []);

  // Reset the condition fields when the family changes — a price metric makes no
  // sense carried over to a cash alert.
  const pickType = (t: AlertType) => {
    setAlertType(t);
    setMetric(METRICS[t][0]?.key ?? "");
    setValue("");
    setOperator("below");
  };

  const metricList = alertType ? METRICS[alertType] : [];
  const unit = metricList.find((m) => m.key === metric)?.unit ?? "currency";
  const needsAmount = ACTIVITY_EVENTS.find((e) => e.key === activityEvent)?.needsAmount ?? false;

  // ── The live condition, rebuilt on every keystroke so the preview can't drift ──
  const draftCondition = useMemo((): AlertCondition | null => {
    if (!alertType) return null;
    const n = Number(value);
    if (alertType === "activity") {
      const m = Number(minValue);
      return {
        type: "activity",
        event: activityEvent,
        ...(needsAmount && Number.isFinite(m) && minValue !== "" ? { minValue: m } : {}),
      };
    }
    if (!metric || value === "" || !Number.isFinite(n)) return null;
    if (alertType === "holding") {
      if (!symbol.trim()) return null;
      return {
        type: "holding",
        symbol: symbol.trim().toUpperCase(),
        metric: metric as "price",
        operator,
        value: n,
      };
    }
    if (alertType === "balance")
      return { type: "balance", metric: metric as "cash_pct", operator, value: n };
    return {
      type: "performance",
      metric: metric as "alpha",
      operator,
      value: n,
      period: period as "ytd",
    };
  }, [alertType, metric, operator, value, symbol, period, activityEvent, minValue, needsAmount]);

  const missing =
    !name.trim() ||
    !alertType ||
    !draftCondition ||
    (scopeMode === "account" && accountNumbers.length === 0) ||
    (scopeMode === "household" && !householdId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || missing || !draftCondition) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch(editing ? `/api/alerts/${alert!.id}` : "/api/alerts", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          condition: draftCondition,
          scope_mode: scopeMode,
          account_numbers: scopeMode === "account" ? accountNumbers : [],
          household_id: scopeMode === "household" ? householdId : null,
          household_name: scopeMode === "household" ? householdName : null,
          frequency,
          severity,
          cooldown_hours: cooldownHours,
          enabled: alert?.enabled ?? true,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(json?.error || `Could not save the alert (${res.status}).`);
        return;
      }
      setShown(false);
      window.setTimeout(onSaved, 200);
    } catch (err) {
      setFormError(`Could not reach the server: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }

  const previewScope = describeScope({
    scope_mode: scopeMode,
    account_number: accountNumbers[0] ?? null,
    account_numbers: accountNumbers,
    household_name: householdName || null,
  });

  return createPortal(
    <div className="fixed inset-0 z-[120]">
      <div
        className={`absolute inset-0 bg-black/40 dark:bg-black/60 transition-opacity duration-[320ms] ${shown ? "opacity-100" : "opacity-0"}`}
        onClick={dismiss}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={editing ? "Edit alert" : "New alert"}
        className={`absolute inset-y-2 right-2 w-[min(460px,calc(100vw-1rem))] flex flex-col overflow-hidden
          rounded-2xl border border-border dark:border-border-dark
          bg-sidebar dark:bg-sidebar-dark medium:bg-[#c2c2c2]
          glass:backdrop-blur-2xl glass:backdrop-saturate-150 shadow-2xl
          transition-transform duration-[320ms] ease-[cubic-bezier(0.32,0.72,0,1)]
          ${shown ? "translate-x-0" : "translate-x-[calc(100%+1rem)]"}`}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-black/5 dark:border-white/5">
          <h2 className="text-sm font-semibold text-black dark:text-white">
            {editing ? "Edit alert" : "New alert"}
          </h2>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close"
            className="p-1 rounded-md text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={submit} className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {/* 1 · What to watch — everything below stays hidden until this is picked. */}
            <div className="mb-4">
              <span className={LABEL}>What should I watch?</span>
              <div className="grid grid-cols-2 gap-2">
                {ALERT_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => pickType(t)}
                    className={`text-left px-3 py-2.5 rounded-xl border transition-colors ${
                      alertType === t
                        ? "border-[#2D9CFF]/50 bg-[#2D9CFF]/[0.08]"
                        : "border-border dark:border-border-dark bg-surface dark:bg-surface-dark hover:border-black/25 dark:hover:border-white/25"
                    }`}
                  >
                    <span className="block text-[13px] font-medium text-black dark:text-white">
                      {ALERT_TYPE_LABELS[t]}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-black/40 dark:text-white/40">
                      {ALERT_TYPE_BLURBS[t]}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {alertType && (
              <>
                {/* 2 · Where */}
                <div className="mb-4">
                  <span className={LABEL}>Where does it apply?</span>
                  <div className="inline-flex items-center gap-1 bg-black/5 dark:bg-white/5 rounded-lg p-1 mb-2">
                    {(["book", "household", "account"] as ScopeMode[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setScopeMode(m)}
                        className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                          scopeMode === m
                            ? "bg-white dark:bg-black medium:bg-[#e4e4e4] text-black dark:text-white shadow-sm"
                            : "text-black/40 dark:text-white/40 hover:text-black/70 dark:hover:text-white/70"
                        }`}
                      >
                        {m === "book" ? "Book" : m === "household" ? "Household" : "Account"}
                      </button>
                    ))}
                  </div>
                  {scopeMode === "account" && (
                    <>
                      {accountNumbers.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {accountNumbers.map((n) => (
                            <span
                              key={n}
                              className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-lg text-sm bg-black/5 dark:bg-white/5 medium:bg-[#e4e4e4] text-black dark:text-white"
                            >
                              {n}
                              <button
                                type="button"
                                aria-label={`Remove ${n}`}
                                onClick={() =>
                                  setAccountNumbers((prev) => prev.filter((x) => x !== n))
                                }
                                className="text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white transition-colors"
                              >
                                <CloseIcon className="w-3 h-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      {/* Always available, so more accounts can be added one at a
                          time. Deliberately unfiltered by household — a rule can
                          watch any accounts that belong together for the user's
                          own reasons. */}
                      <ScopeSearch
                        kind="account"
                        exclude={accountNumbers}
                        placeholder={
                          accountNumbers.length
                            ? "Add another account…"
                            : "Search account number or client…"
                        }
                        onPick={(o) => {
                          setAccountNumbers((prev) =>
                            prev.includes(o.key) ? prev : [...prev, o.key],
                          );
                        }}
                      />
                    </>
                  )}
                  {scopeMode === "household" && (
                    <ScopeSearch
                      kind="household"
                      valueLabel={householdName}
                      onPick={(o) => {
                        setHouseholdId(o.key);
                        setHouseholdName(o.primary);
                      }}
                      onClear={() => {
                        setHouseholdId("");
                        setHouseholdName("");
                      }}
                    />
                  )}
                </div>

                {/* 3 · When */}
                <div className="mb-4">
                  <span className={LABEL}>What should trigger it?</span>

                  {alertType === "activity" ? (
                    <div className="space-y-2">
                      <select
                        value={activityEvent}
                        onChange={(e) =>
                          setActivityEvent(e.target.value as ActivityCondition["event"])
                        }
                        className={INPUT}
                      >
                        {ACTIVITY_EVENTS.map((e) => (
                          <option key={e.key} value={e.key} className="bg-white dark:bg-[#111]">
                            {e.label}
                          </option>
                        ))}
                      </select>
                      {needsAmount && (
                        <NumberField
                          unit="currency"
                          value={minValue}
                          onChange={setMinValue}
                          placeholder="250000"
                        />
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {alertType === "holding" && (
                        <input
                          type="text"
                          value={symbol}
                          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                          placeholder="Symbol, e.g. AAPL"
                          className={INPUT}
                        />
                      )}
                      <select
                        value={metric}
                        onChange={(e) => setMetric(e.target.value)}
                        className={INPUT}
                      >
                        {metricList.map((m) => (
                          <option key={m.key} value={m.key} className="bg-white dark:bg-[#111]">
                            {m.label}
                          </option>
                        ))}
                      </select>
                      {alertType === "performance" && (
                        <select
                          value={period}
                          onChange={(e) => setPeriod(e.target.value)}
                          className={INPUT}
                        >
                          {PERIODS.map((p) => (
                            <option key={p.key} value={p.key} className="bg-white dark:bg-[#111]">
                              {p.label}
                            </option>
                          ))}
                        </select>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={operator}
                          onChange={(e) => setOperator(e.target.value as Operator)}
                          className={INPUT}
                        >
                          <option value="below" className="bg-white dark:bg-[#111]">
                            falls below
                          </option>
                          <option value="above" className="bg-white dark:bg-[#111]">
                            rises above
                          </option>
                        </select>
                        <NumberField unit={unit} value={value} onChange={setValue} placeholder="0" />
                      </div>
                    </div>
                  )}
                </div>

                {/* 4 · How often / how loud */}
                <div className="mb-4">
                  <span className={LABEL}>How often should I check?</span>
                  <div className="inline-flex items-center gap-1 bg-black/5 dark:bg-white/5 rounded-lg p-1">
                    {FREQUENCIES.map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setFrequency(f)}
                        className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition-colors ${
                          frequency === f
                            ? "bg-white dark:bg-black medium:bg-[#e4e4e4] text-black dark:text-white shadow-sm"
                            : "text-black/40 dark:text-white/40 hover:text-black/70 dark:hover:text-white/70"
                        }`}
                      >
                        {FREQUENCY_LABELS[f]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mb-4">
                  <span className={LABEL}>Name it</span>
                  <input
                    ref={nameRef}
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Apple stop-loss"
                    className={INPUT}
                  />
                </div>

                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <span className="text-[13px] text-black dark:text-white">Email me too</span>
                    <p className="text-[11px] text-black/40 dark:text-white/40">
                      Email delivery isn&rsquo;t configured yet — alerts land here in the meantime.
                    </p>
                  </div>
                  <Toggle checked={false} onChange={() => {}} disabled />
                </div>
              </>
            )}
          </div>

          {/* Live preview — the same blue treatment as the chat confirm-card, so the
              two creation paths read as the same object. */}
          {alertType && (
            <div className="mx-5 mb-3 rounded-xl border border-[#2D9CFF]/30 bg-[#2D9CFF]/[0.06] px-4 py-3">
              <div className={LABEL}>Preview</div>
              <p className="text-sm text-black dark:text-white">
                {draftCondition ? (
                  <>
                    Alert me{" "}
                    <span className="font-semibold">{describeCondition(draftCondition)}</span> for{" "}
                    <span className="font-semibold">{previewScope}</span>.
                  </>
                ) : (
                  <span className="text-black/40 dark:text-white/40">
                    Fill in the condition to see what this will do.
                  </span>
                )}
              </p>
              {draftCondition && (
                <p className="mt-1 text-[11px] text-black/40 dark:text-white/40">
                  Checked {FREQUENCY_LABELS[frequency]}
                </p>
              )}
            </div>
          )}

          {formError && (
            <div
              role="alert"
              className="mx-5 mb-3 px-3 py-2 rounded-lg text-xs bg-red-500/10 text-red-700 dark:text-red-300 border border-red-500/20"
            >
              {formError}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-black/5 dark:border-white/5">
            <button
              type="button"
              onClick={dismiss}
              disabled={submitting}
              className="px-4 py-2 text-sm text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || missing}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-black dark:bg-white text-white dark:text-black hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? "Saving…" : editing ? "Save changes" : "Create alert"}
            </button>
          </div>
        </form>
      </aside>
    </div>,
    document.body,
  );
}

// ── Scope search ─────────────────────────────────────────────────────────────
// A plain labelled field rather than the composer's SearchablePicker, which is a
// chip designed to open upward from the message bar and would read as a foreign
// object inside a form.

interface ScopeOption {
  key: string;
  primary: string;
  secondary?: string;
}

function ScopeSearch({
  kind,
  valueLabel,
  exclude = [],
  placeholder,
  onPick,
  onClear,
}: {
  kind: "account" | "household";
  /** Single-select mode (households): renders the chosen value with a Change link. */
  valueLabel?: string;
  /** Multi-select mode (accounts): already-chosen keys, hidden from the list. */
  exclude?: string[];
  placeholder?: string;
  onPick: (o: ScopeOption) => void;
  onClear?: () => void;
}) {
  const directory = useAccountDirectory();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Clicking anywhere outside dismisses the list. Without this it stays open
  // until something is picked, which traps the rest of the form behind it.
  // mousedown rather than click, so the list is gone before a click lands on
  // whatever is underneath it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const options = useMemo((): ScopeOption[] => {
    const q = query.trim().toLowerCase();
    if (kind === "household") {
      return directory.households
        .filter((h) => !q || h.name.toLowerCase().includes(q))
        .slice(0, 50)
        .map((h) => ({
          key: h.id,
          primary: h.name,
          secondary: `${h.accountCount} account${h.accountCount === 1 ? "" : "s"}`,
        }));
    }
    return directory.accounts
      .filter((a) => !exclude.includes(a.accountNumber))
      .filter(
        (a) =>
          !q ||
          a.accountNumber.toLowerCase().includes(q) ||
          a.accountName.toLowerCase().includes(q) ||
          a.clientName.toLowerCase().includes(q),
      )
      .slice(0, 50)
      .map((a) => ({
        key: a.accountNumber,
        primary: a.accountNumber,
        secondary: a.accountName || a.clientName,
      }));
  }, [directory, kind, query, exclude]);

  if (valueLabel && onClear) {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-sm bg-black/5 dark:bg-white/5 medium:bg-[#e4e4e4] text-black dark:text-white">
          {valueLabel}
        </span>
        <button
          type="button"
          onClick={() => {
            onClear();
            setQuery("");
            setOpen(true);
          }}
          className="text-xs text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white transition-colors"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        value={query}
        onFocus={() => setOpen(true)}
        // Escape closes the list only. stopPropagation keeps it from reaching the
        // drawer's document-level handler, which would otherwise close the whole
        // panel out from under a user who just wanted to dismiss the dropdown.
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        placeholder={
          directory.loading
            ? "Loading accounts…"
            : (placeholder ??
              (kind === "account" ? "Search account number or client…" : "Search households…"))
        }
        className={INPUT}
      />
      {open && options.length > 0 && (
        <ul className="absolute left-0 right-0 top-full mt-1 z-20 max-h-56 overflow-y-auto py-1 rounded-xl border border-border dark:border-border-dark bg-sidebar dark:bg-[#242424] medium:bg-[#c2c2c2] shadow-xl">
          {options.map((o) => (
            <li key={o.key}>
              <button
                type="button"
                onClick={() => {
                  onPick(o);
                  // Clear so the next "add another" starts from a blank search
                  // instead of the previous account's number.
                  setQuery("");
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              >
                <span className="block text-[13px] text-black dark:text-white">{o.primary}</span>
                {o.secondary && (
                  <span className="block text-[11px] text-black/40 dark:text-white/40">
                    {o.secondary}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NumberField({
  unit,
  value,
  onChange,
  placeholder,
}: {
  unit: "currency" | "percent";
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      {unit === "currency" && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-black/40 dark:text-white/40">
          $
        </span>
      )}
      <input
        type="number"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${INPUT} ${unit === "currency" ? "pl-7" : "pr-7"}`}
      />
      {unit === "percent" && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-black/40 dark:text-white/40">
          %
        </span>
      )}
    </div>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
