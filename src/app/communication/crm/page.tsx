"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fetchClients, type CrmClient } from "@/lib/crm/clients";
import { useCanvasHref } from "@/lib/useCanvasHref";
import ClientsTable from "@/components/crm/ClientsTable";

export default function CrmPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <div className="text-muted">Loading CRM...</div>
        </div>
      }
    >
      <CrmContent />
    </Suspense>
  );
}

const ITEMS_PER_PAGE = 50;

function CrmContent() {
  // Portfolio and account pages deep-link here with ?search=<client name>.
  const searchParams = useSearchParams();
  const canvasHref = useCanvasHref();

  const [clients, setClients] = useState<CrmClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState(searchParams.get("search") ?? "");
  const [currentPage, setCurrentPage] = useState(1);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchClients()
      .then((rows) => setClients(rows))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load clients"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) =>
      [c.fullName, c.email, c.phone, c.householdName, c.advisorName]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [clients, searchQuery]);

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
  const paged = filtered.slice(startIdx, startIdx + ITEMS_PER_PAGE);

  const householdCount = useMemo(
    () => new Set(clients.map((c) => c.householdId).filter(Boolean)).size,
    [clients],
  );
  const prospectCount = useMemo(
    () => clients.filter((c) => c.onboardingStatus === "prospect").length,
    [clients],
  );

  if (loading) {
    return (
      <Shell>
        <div className="flex-1 flex items-center justify-center text-sm text-black/40 dark:text-white/40">
          Loading clients...
        </div>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell>
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <div className="text-sm text-black/50 dark:text-white/50">{error}</div>
          <button
            onClick={load}
            className="text-xs font-medium px-3 py-2 rounded-lg bg-black/5 dark:bg-white/5 text-black dark:text-white hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
          >
            Retry
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Header — static block above the scroll container. pt-12 clears the drawer's floating control band. */}
      <div className="px-16 pt-12 pb-4">
        <div className="flex items-center gap-6 pl-6 flex-wrap">
          <h1 className="text-lg font-semibold text-black dark:text-white">CRM</h1>
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black/40 dark:text-white/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search clients"
              className="pl-9 pr-4 py-2 bg-black/5 dark:bg-white/5 rounded-lg text-sm text-black dark:text-white placeholder-black/40 dark:placeholder-white/40 outline-none w-64"
            />
          </div>
          <div className="flex items-center gap-6 text-sm">
            <div>
              <span className="text-black/50 dark:text-white/50">Clients:</span>{" "}
              <span className="font-semibold text-black dark:text-white tabular-nums">
                {filtered.length.toLocaleString()}
              </span>
            </div>
            <div>
              <span className="text-black/50 dark:text-white/50">Households:</span>{" "}
              <span className="font-semibold text-black dark:text-white tabular-nums">
                {householdCount.toLocaleString()}
              </span>
            </div>
            <div>
              <span className="text-black/50 dark:text-white/50">Prospects:</span>{" "}
              <span className="font-semibold text-black dark:text-white tabular-nums">
                {prospectCount.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Scroll container — table only. Top spacing on the table (mt-8), not the scroller,
          so the sticky thead pins just below the header. */}
      <div className="flex-1 overflow-y-auto px-16 pb-8">
        <div className="mt-8">
          <ClientsTable rows={paged} canvasHref={canvasHref} />

          {filtered.length > ITEMS_PER_PAGE && totalPages > 1 && (
            <div className="flex items-center justify-between mt-8 pt-6 border-t border-black/5 dark:border-white/5">
              <span className="text-xs text-black/40 dark:text-white/40 tabular-nums">
                {startIdx + 1}–{Math.min(startIdx + ITEMS_PER_PAGE, filtered.length)} of{" "}
                {filtered.length}
              </span>
              <div className="flex items-center gap-1">
                <PagerButton
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  label="Previous"
                >
                  ‹
                </PagerButton>
                {(() => {
                  const VISIBLE = 5;
                  let windowStart = Math.max(1, currentPage - Math.floor(VISIBLE / 2));
                  const windowEnd = Math.min(totalPages, windowStart + VISIBLE - 1);
                  if (windowEnd - windowStart + 1 < VISIBLE) {
                    windowStart = Math.max(1, windowEnd - VISIBLE + 1);
                  }
                  const pages = [];
                  for (let p = windowStart; p <= windowEnd; p++) pages.push(p);
                  return pages.map((p) => (
                    <button
                      key={p}
                      onClick={() => setCurrentPage(p)}
                      className={`min-w-[1.75rem] px-2 py-1 rounded-md text-xs tabular-nums transition-colors ${
                        p === currentPage
                          ? "bg-black/[0.07] dark:bg-white/[0.07] text-black dark:text-white"
                          : "text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white"
                      }`}
                    >
                      {p}
                    </button>
                  ));
                })()}
                <PagerButton
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  label="Next"
                >
                  ›
                </PagerButton>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="px-16 pt-12 pb-4">
        <div className="flex items-center gap-6 pl-6">
          <h1 className="text-lg font-semibold text-black dark:text-white">CRM</h1>
        </div>
      </div>
      {children}
    </div>
  );
}

function PagerButton({
  children,
  disabled,
  onClick,
  label,
}: {
  children: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="px-2 py-1 rounded-md text-xs text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white disabled:opacity-30 disabled:hover:text-black/40 dark:disabled:hover:text-white/40 transition-colors"
    >
      {children}
    </button>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"
      />
    </svg>
  );
}
