"use client";

import { Suspense, useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ACCOUNT_PAGES, usePageDrawer } from "@/components/page-drawer/PageDrawerContext";
import { ChevronIcon } from "@/components/layout/sidebar-styles";
import SavedReportsTable from "@/components/reports/SavedReportsTable";
import ReportRunsTable from "@/components/reports/ReportRunsTable";
import ReportBuilderDrawer from "@/components/reports/ReportBuilderDrawer";
import ReportResultsDrawer, { type ReportResult } from "@/components/reports/ReportResultsDrawer";
import { useSavedReports } from "@/components/reports/useSavedReports";
import { describeReport, type ReportRunRow, type SavedReportRow } from "@/lib/reports/types";

/**
 * The Report Center — saved reports you run, plus the history of what ran.
 *
 * Same shell as the Alert Center, but the verbs differ: an alert fires at you,
 * a report is something you run. So "Run" is a first-class button on every row
 * and results open in a wide drawer rather than a feed entry.
 */
export default function ReportsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col h-full min-h-0 bg-background">
          <div className="flex items-center justify-center flex-1">
            <div className="text-muted">Loading reports...</div>
          </div>
        </div>
      }
    >
      <ReportsPageContent />
    </Suspense>
  );
}

const PORTFOLIO_PAGE = ACCOUNT_PAGES.find((p) => p.name === "Portfolio")!;

function ReportsPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { openPage } = usePageDrawer();
  const {
    reports,
    runs,
    loading,
    error,
    setError,
    reload,
    toggleReport,
    toggleArchivedReport,
    setArchived,
    deleteReport,
  } = useSavedReports();

  const [search, setSearch] = useState("");
  const [showRuns, setShowRuns] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [builder, setBuilder] = useState<{ report?: SavedReportRow } | null>(
    searchParams.get("new") ? {} : null,
  );
  const [result, setResult] = useState<ReportResult | null>(null);
  const [running, setRunning] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [rerunningId, setRerunningId] = useState<string | null>(null);
  const runsRef = useRef<HTMLDivElement>(null);

  /** Same handoff as the Alert Center: the account chip opens that account's
   *  Portfolio in the drawer with the workspace chat centered. */
  const openAccountPortfolio = useCallback(
    (accountNumber: string) => {
      openPage({
        ...PORTFOLIO_PAGE,
        href: `${PORTFOLIO_PAGE.href}?account=${encodeURIComponent(accountNumber)}`,
      });
      window.dispatchEvent(
        new CustomEvent("composer:active-account", { detail: { accountNumber } }),
      );
      router.push("/chat");
    },
    [openPage, router],
  );

  /** Runs a saved report and opens the results drawer. Run history stores
   *  metadata only, so this is also what "View" on a past run does — it
   *  re-executes rather than replaying a stale snapshot. */
  const runReport = useCallback(
    async (savedId: string, fallbackLabel: string) => {
      setResult(null);
      setRunning(true);
      try {
        const res = await fetch(`/api/saved-reports/${savedId}/run`, { method: "POST" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setResult({
            label: fallbackLabel,
            rows: null,
            rowCount: null,
            durationMs: null,
            error: json?.error || `The report failed to run (${res.status}).`,
          });
          return;
        }
        const d = json.data;
        setResult({
          label: d.label ?? fallbackLabel,
          rows: d.rows ?? null,
          rowCount: d.rowCount ?? null,
          durationMs: d.run?.duration_ms ?? null,
          error: d.run?.status === "error" ? d.run?.error : null,
        });
        reload();
      } catch (err) {
        setResult({
          label: fallbackLabel,
          rows: null,
          rowCount: null,
          durationMs: null,
          error: `Could not reach the server: ${(err as Error).message}`,
        });
      } finally {
        setRunning(false);
        setRunningId(null);
        setRerunningId(null);
      }
    },
    [reload],
  );

  const matchesSearch = useCallback(
    (r: SavedReportRow) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        describeReport(r).toLowerCase().includes(q) ||
        (r.account_number ?? "").toLowerCase().includes(q) ||
        (r.household_name ?? "").toLowerCase().includes(q)
      );
    },
    [search],
  );

  const visibleReports = useMemo(
    () => reports.filter((r) => !r.archived && matchesSearch(r)),
    [reports, matchesSearch],
  );
  const archivedReports = useMemo(
    () => reports.filter((r) => r.archived && matchesSearch(r)),
    [reports, matchesSearch],
  );

  const visibleRuns = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return runs;
    return runs.filter((r) => r.label.toLowerCase().includes(q));
  }, [runs, search]);

  const stats = useMemo(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return {
      saved: reports.filter((r) => !r.archived).length,
      scheduled: reports.filter((r) => !r.archived && r.enabled && r.schedule !== "manual").length,
      today: runs.filter((r) => new Date(r.ran_at) >= startOfDay).length,
      failing: reports.filter((r) => !r.archived && r.last_error).length,
    };
  }, [reports, runs]);

  if (loading) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-background">
        <div className="flex items-center justify-center flex-1">
          <div className="text-muted">Loading reports...</div>
        </div>
      </div>
    );
  }

  if (error && reports.length === 0 && runs.length === 0) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-background">
        <div className="flex items-center justify-center flex-1">
          <div className="text-center">
            <div className="text-red-500 dark:text-red-400 mb-2">Connection Error</div>
            <div className="text-sm text-muted max-w-md">{error}</div>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 text-sm bg-black dark:bg-white text-white dark:text-black rounded-lg hover:opacity-80 transition-opacity"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const showEmptyState = reports.length === 0 && runs.length === 0;

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="px-3 sm:px-4 lg:px-6 pt-12 pb-4">
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="text-lg font-semibold text-black dark:text-white">Reports</h1>
          {!showEmptyState && (
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black/40 dark:text-white/40" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search reports..."
                className="pl-9 pr-4 py-2 bg-black/5 dark:bg-white/5 rounded-lg text-sm text-black dark:text-white placeholder-black/40 dark:placeholder-white/40 outline-none w-52"
              />
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/create?new=report"
              className="px-2 py-1 text-[13px] text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white transition-colors"
            >
              Describe in chat
            </Link>
            <button
              type="button"
              onClick={() => setBuilder({})}
              className="px-3 py-1 rounded-md text-[13px] font-medium bg-black dark:bg-white text-white dark:text-black hover:opacity-90 transition-opacity"
            >
              New report
            </button>
          </div>
        </div>

        {!showEmptyState && (
          <div className="mt-4 flex items-center text-[13px]">
            <Stat label="Saved" value={stats.saved} />
            <Stat label="Scheduled" value={stats.scheduled} />
            <Stat label="Run today" value={stats.today} />
            <Stat label="Failing" value={stats.failing} accent={stats.failing > 0} />
          </div>
        )}

        {error && !showEmptyState && (
          <div
            role="alert"
            className="mt-3 px-3 py-2 rounded-lg text-xs bg-red-500/10 text-red-700 dark:text-red-300 border border-red-500/20"
          >
            {error}
            <button
              type="button"
              onClick={() => setError(null)}
              className="ml-2 underline underline-offset-2"
            >
              dismiss
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 sm:px-4 lg:px-6 pb-8">
        {showEmptyState ? (
          <EmptyState onCreate={() => setBuilder({})} />
        ) : (
          <>
            <div className="mt-8">
              <SavedReportsTable
                rows={visibleReports}
                runningId={runningId}
                onRun={(r) => {
                  setRunningId(r.id);
                  runReport(r.id, r.name);
                }}
                onToggle={toggleReport}
                onEdit={(r) => setBuilder({ report: r })}
                onDelete={deleteReport}
                onArchive={setArchived}
                onOpenAccount={openAccountPortfolio}
              />
            </div>

            <div ref={runsRef} className="mt-10 scroll-mt-4">
              <div className="mb-3">
                <SectionToggle
                  label="Run history"
                  open={showRuns}
                  onToggle={() => setShowRuns((v) => !v)}
                />
              </div>
              {showRuns && (
                <ReportRunsTable
                  rows={visibleRuns}
                  rerunningId={rerunningId}
                  onRerun={(run: ReportRunRow) => {
                    if (!run.saved_report_id) return;
                    setRerunningId(run.id);
                    runReport(run.saved_report_id, run.label);
                  }}
                />
              )}
            </div>

            {archivedReports.length > 0 && (
              <div className="mt-10">
                <div className="mb-3">
                  <SectionToggle
                    label="Archived"
                    open={showArchived}
                    onToggle={() => setShowArchived((v) => !v)}
                  />
                </div>
                {showArchived && (
                  <div className="opacity-60">
                    <SavedReportsTable
                      rows={archivedReports}
                      runningId={runningId}
                      onRun={(r) => {
                        setRunningId(r.id);
                        runReport(r.id, r.name);
                      }}
                      // Switching one back on restores it into the list above.
                      onToggle={toggleArchivedReport}
                      onEdit={(r) => setBuilder({ report: r })}
                      onDelete={deleteReport}
                      onArchive={setArchived}
                      onOpenAccount={openAccountPortfolio}
                    />
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {builder && (
        <ReportBuilderDrawer
          key={builder.report?.id ?? "new"}
          report={builder.report}
          onClose={() => setBuilder(null)}
          onSaved={() => {
            setBuilder(null);
            reload();
          }}
        />
      )}

      {(running || result) && (
        <ReportResultsDrawer
          result={result}
          running={running}
          onClose={() => {
            setResult(null);
            setRunning(false);
          }}
        />
      )}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="py-16 text-center">
      <DocIcon className="w-8 h-8 mx-auto mb-3 text-black/20 dark:text-white/20" />
      <p className="text-sm font-medium text-black dark:text-white">No saved reports yet</p>
      <p className="mt-1 text-sm text-black/40 dark:text-white/40 max-w-md mx-auto">
        Save a report once and re-run it any time — or put it on a schedule and read the results
        here.
      </p>
      <div className="mt-5 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={onCreate}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-black dark:bg-white text-white dark:text-black hover:opacity-90 transition-opacity"
        >
          Save a report
        </button>
        <Link
          href="/create?new=report"
          className="px-4 py-2 text-sm text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white transition-colors"
        >
          or describe it in chat
        </Link>
      </div>
      <p className="mt-4 text-[11px] text-black/30 dark:text-white/30">
        Try: &ldquo;every account under 2% cash&rdquo;
      </p>
    </div>
  );
}

function SectionToggle({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="group flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-black dark:text-white"
    >
      {label}
      <ChevronIcon
        className={`w-3 h-3 text-black/40 dark:text-white/40 group-hover:text-black dark:group-hover:text-white transition-all ${
          open ? "rotate-180" : ""
        }`}
      />
    </button>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5 px-3 first:pl-0 last:pr-0 border-l border-black/10 dark:border-white/10 first:border-l-0">
      <span className="text-black/45 dark:text-white/45">{label}</span>
      <span
        className={`font-semibold tabular-nums ${
          accent ? "text-[#B45309] dark:text-[#F59E0B]" : "text-black dark:text-white"
        }`}
      >
        {value.toLocaleString()}
      </span>
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z"
      />
    </svg>
  );
}

function DocIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5zM14 3v5h5M9 13h6M9 17h4"
      />
    </svg>
  );
}
