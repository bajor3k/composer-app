"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAccountDirectory } from "@/components/ai-chat/useAccountDirectory";
import { REPORT_CATALOG, REPORT_CATEGORIES, getReportById } from "@/lib/report-registry";
import {
  SCHEDULES,
  SCHEDULE_LABELS,
  describeReport,
  describeReportScope,
  type SavedReportRow,
  type Schedule,
  type ScopeMode,
} from "@/lib/reports/types";

const LABEL =
  "block text-[11px] font-medium uppercase tracking-wider text-black/45 dark:text-white/45 mb-1.5";
const INPUT =
  "w-full px-3 py-2 rounded-lg text-sm text-black dark:text-white bg-surface dark:bg-surface-dark " +
  "border border-border dark:border-border-dark placeholder-black/30 dark:placeholder-white/30 " +
  "outline-none focus:border-black/40 dark:focus:border-white/40 transition-colors";

interface Props {
  report?: SavedReportRow;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * The non-chat way to save a report.
 *
 * Unlike the alert builder — which composes a condition — this picks one of the
 * 48 catalog reports and binds its declared parameters. The catalog is the
 * allowlist on both ends: the picker can only offer what exists, and the server
 * re-checks the id and strips undeclared params on save.
 */
export default function ReportBuilderDrawer({ report, onClose, onSaved }: Props) {
  const editing = Boolean(report);

  const [reportId, setReportId] = useState(report?.report_id ?? "");
  const [name, setName] = useState(report?.name ?? "");
  const [params, setParams] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const [k, v] of Object.entries(report?.params ?? {})) seed[k] = String(v ?? "");
    return seed;
  });
  const [scopeMode, setScopeMode] = useState<ScopeMode>(report?.scope_mode ?? "book");
  const [accountNumbers, setAccountNumbers] = useState<string[]>(
    report?.account_numbers?.length
      ? report.account_numbers
      : report?.account_number
        ? [report.account_number]
        : [],
  );
  const [householdId, setHouseholdId] = useState(report?.household_id ?? "");
  const [householdName, setHouseholdName] = useState(report?.household_name ?? "");
  const [schedule, setSchedule] = useState<Schedule>(report?.schedule ?? "manual");
  const [catalogQuery, setCatalogQuery] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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

  const selected = reportId ? getReportById(reportId) : undefined;

  // Catalog is 47 entries across 11 categories — too many for a flat list, so it
  // filters as you type and groups by category.
  const grouped = useMemo(() => {
    const q = catalogQuery.trim().toLowerCase();
    const matches = REPORT_CATALOG.filter(
      (r) =>
        !q ||
        r.label.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q),
    );
    return REPORT_CATEGORIES.map((c) => ({
      category: c as string,
      items: matches.filter((r) => r.category === c),
    })).filter((g) => g.items.length > 0);
  }, [catalogQuery]);

  const pickReport = (id: string) => {
    setReportId(id);
    setParams({});
    // Pre-fill the name from the catalog label so the field is rarely touched.
    if (!name.trim()) setName(getReportById(id)?.label ?? "");
  };

  const missingParams = (selected?.params ?? [])
    .filter((p) => p.required && !params[p.key]?.trim())
    .map((p) => p.label);

  const missing =
    !name.trim() ||
    !reportId ||
    missingParams.length > 0 ||
    (scopeMode === "account" && accountNumbers.length === 0) ||
    (scopeMode === "household" && !householdId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || missing) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch(editing ? `/api/saved-reports/${report!.id}` : "/api/saved-reports", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          report_id: reportId,
          params,
          scope_mode: scopeMode,
          account_numbers: scopeMode === "account" ? accountNumbers : [],
          household_id: scopeMode === "household" ? householdId : null,
          household_name: scopeMode === "household" ? householdName : null,
          schedule,
          enabled: report?.enabled ?? true,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(json?.error || `Could not save the report (${res.status}).`);
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

  const previewScope = describeReportScope({
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
        aria-label={editing ? "Edit report" : "New report"}
        className={`absolute inset-y-2 right-2 w-[min(460px,calc(100vw-1rem))] flex flex-col overflow-hidden
          rounded-2xl border border-border dark:border-border-dark
          bg-sidebar dark:bg-sidebar-dark medium:bg-[#c2c2c2]
          glass:backdrop-blur-2xl glass:backdrop-saturate-150 shadow-2xl
          transition-transform duration-[320ms] ease-[cubic-bezier(0.32,0.72,0,1)]
          ${shown ? "translate-x-0" : "translate-x-[calc(100%+1rem)]"}`}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-black/5 dark:border-white/5">
          <h2 className="text-sm font-semibold text-black dark:text-white">
            {editing ? "Edit report" : "New report"}
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
            {/* 1 · Which report */}
            <div className="mb-4">
              <span className={LABEL}>What should it pull?</span>
              {selected ? (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm bg-black/5 dark:bg-white/5 medium:bg-[#e4e4e4] text-black dark:text-white">
                    {selected.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setReportId("");
                      setParams({});
                      setCatalogQuery("");
                    }}
                    className="text-xs text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white transition-colors"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={catalogQuery}
                    onChange={(e) => setCatalogQuery(e.target.value)}
                    placeholder="Search reports…"
                    className={INPUT}
                    autoFocus
                  />
                  <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-border dark:border-border-dark">
                    {grouped.map((g) => (
                      <div key={g.category}>
                        <div className="sticky top-0 px-3 py-1.5 text-[10px] uppercase tracking-wider text-black/40 dark:text-white/40 bg-surface dark:bg-surface-dark medium:bg-[#c2c2c2]">
                          {g.category}
                        </div>
                        {g.items.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => pickReport(r.id)}
                            className="w-full text-left px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                          >
                            <span className="block text-[13px] text-black dark:text-white">
                              {r.label}
                            </span>
                            <span className="block text-[11px] leading-snug text-black/40 dark:text-white/40">
                              {r.description}
                            </span>
                          </button>
                        ))}
                      </div>
                    ))}
                    {grouped.length === 0 && (
                      <div className="px-3 py-6 text-center text-sm text-black/40 dark:text-white/40">
                        No reports match &ldquo;{catalogQuery}&rdquo;
                      </div>
                    )}
                  </div>
                </>
              )}
              {selected && (
                <p className="mt-1.5 text-[11px] text-black/40 dark:text-white/40">
                  {selected.description}
                </p>
              )}
            </div>

            {selected && (
              <>
                {/* 2 · Its declared inputs, rendered from the catalog */}
                {(selected.params ?? []).length > 0 && (
                  <div className="mb-4 space-y-2">
                    <span className={LABEL}>Inputs</span>
                    {(selected.params ?? []).map((p) => (
                      <div key={p.key}>
                        {p.type === "select" ? (
                          <select
                            value={params[p.key] ?? ""}
                            onChange={(e) =>
                              setParams((prev) => ({ ...prev, [p.key]: e.target.value }))
                            }
                            className={INPUT}
                          >
                            <option value="" className="bg-white dark:bg-[#111]">
                              {p.label}
                              {p.required ? " (required)" : " — any"}
                            </option>
                            {(p.options ?? []).map((o) => (
                              <option key={o.value} value={o.value} className="bg-white dark:bg-[#111]">
                                {o.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={p.type === "date" ? "date" : "text"}
                            value={params[p.key] ?? ""}
                            onChange={(e) =>
                              setParams((prev) => ({ ...prev, [p.key]: e.target.value }))
                            }
                            placeholder={p.placeholder ?? p.label}
                            className={INPUT}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* 3 · Scope */}
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
                      <ScopeSearch
                        kind="account"
                        exclude={accountNumbers}
                        placeholder={
                          accountNumbers.length
                            ? "Add another account…"
                            : "Search account number or client…"
                        }
                        onPick={(o) =>
                          setAccountNumbers((prev) =>
                            prev.includes(o.key) ? prev : [...prev, o.key],
                          )
                        }
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

                {/* 4 · Schedule */}
                <div className="mb-4">
                  <span className={LABEL}>How often should it run?</span>
                  <div className="inline-flex items-center gap-1 bg-black/5 dark:bg-white/5 rounded-lg p-1">
                    {SCHEDULES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSchedule(s)}
                        className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition-colors ${
                          schedule === s
                            ? "bg-white dark:bg-black medium:bg-[#e4e4e4] text-black dark:text-white shadow-sm"
                            : "text-black/40 dark:text-white/40 hover:text-black/70 dark:hover:text-white/70"
                        }`}
                      >
                        {SCHEDULE_LABELS[s]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mb-4">
                  <span className={LABEL}>Name it</span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Monday low-cash sweep"
                    className={INPUT}
                  />
                </div>
              </>
            )}
          </div>

          {selected && (
            <div className="mx-5 mb-3 rounded-xl border border-[#2D9CFF]/30 bg-[#2D9CFF]/[0.06] px-4 py-3">
              <div className={LABEL}>Preview</div>
              <p className="text-sm text-black dark:text-white">
                Pulls{" "}
                <span className="font-semibold">
                  {describeReport({ report_id: reportId, params })}
                </span>{" "}
                for <span className="font-semibold">{previewScope}</span>.
              </p>
              <p className="mt-1 text-[11px] text-black/40 dark:text-white/40">
                Runs {SCHEDULE_LABELS[schedule]}
              </p>
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
              {submitting ? "Saving…" : editing ? "Save changes" : "Save report"}
            </button>
          </div>
        </form>
      </aside>
    </div>,
    document.body,
  );
}

// ── Scope search (same behaviour as the alert builder's) ─────────────────────

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
  valueLabel?: string;
  exclude?: string[];
  placeholder?: string;
  onPick: (o: ScopeOption) => void;
  onClear?: () => void;
}) {
  const directory = useAccountDirectory();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

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

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
