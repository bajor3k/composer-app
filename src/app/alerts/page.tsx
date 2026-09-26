"use client";

import { Suspense, useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ACCOUNT_PAGES, usePageDrawer } from "@/components/page-drawer/PageDrawerContext";
import { ChevronIcon } from "@/components/layout/sidebar-styles";
import AlertEventsTable from "@/components/alerts/AlertEventsTable";
import AlertRulesTable from "@/components/alerts/AlertRulesTable";
import AlertBuilderDrawer from "@/components/alerts/AlertBuilderDrawer";
import { useAlerts } from "@/components/alerts/useAlerts";
import type { AlertRow } from "@/lib/alerts/types";

/**
 * The Alert Center — a monitoring and triage surface, not a chat.
 *
 * Two tabs rather than a split view: the rules table has to carry the alert name,
 * its plain-English condition, its scope, and its last-fired time on one line, and
 * halving the width would push the condition sentence into a tooltip — which is
 * exactly the thing this page exists to make visible.
 */
export default function AlertsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col h-full min-h-0 bg-background">
          <div className="flex items-center justify-center flex-1">
            <div className="text-muted">Loading alerts...</div>
          </div>
        </div>
      }
    >
      <AlertsPageContent />
    </Suspense>
  );
}

const PORTFOLIO_PAGE = ACCOUNT_PAGES.find((p) => p.name === "Portfolio")!;

function AlertsPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { openPage } = usePageDrawer();
  const {
    alerts,
    events,
    loading,
    error,
    setError,
    reload,
    toggleAlert,
    toggleArchivedAlert,
    setArchived,
    deleteAlert,
    acknowledgeEvent,
  } =
    useAlerts();

  const [search, setSearch] = useState("");
  // Scroll target for "Fired 8h ago" in the rules table — jumps to that alert's
  // events now that there's no tab to switch to.
  const activityRef = useRef<HTMLDivElement>(null);
  // Activity is the triage surface, so it starts open; archived is a drawer you
  // go looking for, so it starts closed.
  const [showActivity, setShowActivity] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [focusedAlertId, setFocusedAlertId] = useState<string | null>(null);
  // `?new=1` from the composer's Create menu opens the builder straight away.
  const [builder, setBuilder] = useState<{ alert?: AlertRow } | null>(
    searchParams.get("new") ? {} : null,
  );

  const newCount = events.filter((e) => e.status === "new").length;

  /**
   * Clicking an account chip opens that account's Portfolio in the right-side
   * drawer and puts the workspace chat in the center — so an alert hands straight
   * off to the account it's about, with the agent right there.
   *
   * The account is baked into the drawer's href rather than only broadcast on
   * `composer:active-account`. Broadcasting alone loses the account: ChatPage
   * mounts *after* this navigation, misses the event, and then re-broadcasts its
   * own (empty) context — which re-keys the drawer iframe and lets the portfolio
   * page fall back to its default first account. A query param on the href is
   * read first by `searchParams.get("account")`, so it wins regardless of what
   * the session context does afterwards.
   *
   * Drawer state lives in PageDrawerProvider (mounted in AppShell), so the panel
   * survives the route change.
   */
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

  const stats = useMemo(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return {
      active: alerts.filter((a) => a.enabled && !a.last_error).length,
      paused: alerts.filter((a) => !a.enabled).length,
      today: events.filter((e) => new Date(e.triggered_at) >= startOfDay).length,
      review: newCount,
    };
  }, [alerts, events, newCount]);

  const matchesSearch = useCallback(
    (a: AlertRow) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        (a.account_number ?? "").toLowerCase().includes(q) ||
        (a.household_name ?? "").toLowerCase().includes(q)
      );
    },
    [search],
  );

  const visibleRules = useMemo(
    () => alerts.filter((a) => !a.archived && matchesSearch(a)),
    [alerts, matchesSearch],
  );
  const archivedRules = useMemo(
    () => alerts.filter((a) => a.archived && matchesSearch(a)),
    [alerts, matchesSearch],
  );

  const visibleEvents = useMemo(() => {
    let rows = events;
    if (focusedAlertId) rows = rows.filter((e) => e.alert_id === focusedAlertId);
    // No new/all split any more — reviewed events stay in the feed, dimmed, so
    // nothing disappears the moment it's acknowledged.
    const q = search.trim().toLowerCase();
    if (q)
      rows = rows.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          (e.account_number ?? "").toLowerCase().includes(q) ||
          (e.symbol ?? "").toLowerCase().includes(q),
      );
    return rows;
  }, [events, focusedAlertId, search]);

  if (loading) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-background">
        <div className="flex items-center justify-center flex-1">
          <div className="text-muted">Loading alerts...</div>
        </div>
      </div>
    );
  }

  if (error && alerts.length === 0 && events.length === 0) {
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

  const showEmptyState = alerts.length === 0 && events.length === 0;

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Header — static block above the scroll container. pt-12 clears the drawer's
          floating control band. */}
      <div className="px-3 sm:px-4 lg:px-6 pt-12 pb-4">
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="text-lg font-semibold text-black dark:text-white">Alerts</h1>
          {!showEmptyState && (
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black/40 dark:text-white/40" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search alerts..."
                className="pl-9 pr-4 py-2 bg-black/5 dark:bg-white/5 rounded-lg text-sm text-black dark:text-white placeholder-black/40 dark:placeholder-white/40 outline-none w-52"
              />
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            {/* The natural-language path stays discoverable FROM the center rather
                than being the center. */}
            <Link
              href="/create?new=alert"
              className="px-2 py-1 text-[13px] text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white transition-colors"
            >
              Describe in chat
            </Link>
            <button
              type="button"
              onClick={() => setBuilder({})}
              className="px-3 py-1 rounded-md text-[13px] font-medium bg-black dark:bg-white text-white dark:text-black hover:opacity-90 transition-opacity"
            >
              New alert
            </button>
          </div>
        </div>

        {/* Counts, hairline-separated. "Needs review" tints amber when non-zero, so
            the one actionable number is the one that stands out. */}
        {!showEmptyState && (
          <div className="mt-4 flex items-center text-[13px]">
            <Stat label="Active" value={stats.active} />
            <Stat label="Paused" value={stats.paused} />
            <Stat label="Fired today" value={stats.today} />
            <Stat label="Needs review" value={stats.review} accent={stats.review > 0} />
          </div>
        )}

        {/* No toast primitive exists in this app; write failures surface inline. */}
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

      {/* Top spacing lives on the table (mt-8), not the scroller: padding-top on the
          scroll container would offset the sticky-thead pin point. */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-4 lg:px-6 pb-8">
        {showEmptyState ? (
          <EmptyState onCreate={() => setBuilder({})} />
        ) : (
          <>
            {/* Both surfaces on one page. Tabs previously split these, but "Rules"
                vs "Triggered" is jargon that has to be learned before the page can
                be read — stacking them costs nothing and needs no explanation. */}
            <div className="mt-8">
              <AlertRulesTable
                rows={visibleRules}
                onToggle={toggleAlert}
                onEdit={(a) => setBuilder({ alert: a })}
                onDelete={deleteAlert}
                onArchive={setArchived}
                onOpenAccount={openAccountPortfolio}
                onViewActivity={(id) => {
                  setFocusedAlertId(id);
                  setShowActivity(true);
                  activityRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              />
            </div>

            <div ref={activityRef} className="mt-10 scroll-mt-4">
              <div className="flex items-center gap-3 flex-wrap mb-3">
                <SectionToggle
                  label="Recent activity"
                  open={showActivity}
                  onToggle={() => setShowActivity((v) => !v)}
                  count={newCount}
                />
                {focusedAlertId && (
                  <button
                    type="button"
                    onClick={() => setFocusedAlertId(null)}
                    className="text-xs text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white transition-colors"
                  >
                    Showing one alert — clear filter
                  </button>
                )}
              </div>
              {showActivity && (
                <AlertEventsTable
                  rows={visibleEvents}
                  onAcknowledge={acknowledgeEvent}
                  onOpenAccount={openAccountPortfolio}
                />
              )}
            </div>

            {/* Archived — only appears once something has been archived, so it
                costs nothing until it's relevant. Restoring puts a rule back in
                the list above with every setting intact. */}
            {archivedRules.length > 0 && (
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
                    <AlertRulesTable
                      rows={archivedRules}
                      // Switching one back on restores it into the list above.
                      onToggle={toggleArchivedAlert}
                      onEdit={(a) => setBuilder({ alert: a })}
                      onDelete={deleteAlert}
                      onArchive={setArchived}
                      onOpenAccount={openAccountPortfolio}
                      onViewActivity={(id) => {
                        setFocusedAlertId(id);
                        setShowActivity(true);
                        activityRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {builder && (
        // Re-keyed so switching from one row's Edit to another re-seeds the form,
        // the same trick create/page.tsx uses for ChatPage.
        <AlertBuilderDrawer
          key={builder.alert?.id ?? "new"}
          alert={builder.alert}
          onClose={() => setBuilder(null)}
          onSaved={() => {
            setBuilder(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

/** Teaches BOTH creation paths — the natural-language route is the one people
 *  won't discover on their own. */
function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="py-16 text-center">
      <BellIcon className="w-8 h-8 mx-auto mb-3 text-black/20 dark:text-white/20" />
      <p className="text-sm font-medium text-black dark:text-white">No alerts yet</p>
      <p className="mt-1 text-sm text-black/40 dark:text-white/40 max-w-md mx-auto">
        Alerts watch your book and drop anything worth a look into the Triggered feed.
      </p>
      <div className="mt-5 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={onCreate}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-black dark:bg-white text-white dark:text-black hover:opacity-90 transition-opacity"
        >
          Create an alert
        </button>
        <Link
          href="/create?new=alert"
          className="px-4 py-2 text-sm text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white transition-colors"
        >
          or describe it in chat
        </Link>
      </div>
      <p className="mt-4 text-[11px] text-black/30 dark:text-white/30">
        Try: &ldquo;alert me when any account&rsquo;s cash drops below 2%&rdquo;
      </p>
    </div>
  );
}

/** Collapsible section heading — the one control both lower sections use. */
function SectionToggle({
  label,
  open,
  onToggle,
  count,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  /** Shown as an amber pill when non-zero — the unreviewed count. */
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="group flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-black dark:text-white"
    >
      {label}
      {count ? (
        <span className="px-1.5 rounded-full text-[11px] font-medium bg-[#F59E0B]/20 text-[#B45309] dark:text-[#F59E0B]">
          {count}
        </span>
      ) : null}
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
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
    </svg>
  );
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 00-4-5.7V5a2 2 0 10-4 0v.3A6 6 0 006 11v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0a3 3 0 11-6 0m6 0H9"
      />
    </svg>
  );
}
