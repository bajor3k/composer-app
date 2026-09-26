"use client";

import { Suspense, useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/format-utils";
import TransfersTable from "@/components/transfers/TransfersTable";
import {
  type Transfer,
  type TransferType,
  type TransferStatusEvent,
  TYPE_FILTERS,
  IN_FLIGHT_STATUSES,
} from "@/components/transfers/types";

export default function TransfersPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <div className="text-muted">Loading transfers...</div>
        </div>
      }
    >
      <TransfersPageContent />
    </Suspense>
  );
}

function TransfersPageContent() {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | TransferType>("all");

  useEffect(() => {
    async function fetchTransfers() {
      const BATCH = 1000;
      const MAX_BATCHES = 5;
      const rows: Record<string, unknown>[] = [];
      let from = 0;
      for (let b = 0; b < MAX_BATCHES; b++) {
        const { data, error: err } = await supabase
          .from("transfers")
          .select("*")
          .order("initiated_at", { ascending: false })
          .range(from, from + BATCH - 1);
        if (err) {
          console.error("Error fetching transfers:", err.message);
          setError("Unable to connect to database. Please check your connection.");
          setLoading(false);
          return;
        }
        if (!data || data.length === 0) break;
        rows.push(...(data as Record<string, unknown>[]));
        if (data.length < BATCH) break;
        from += BATCH;
      }

      setTransfers(
        rows.map((row) => ({
          id: (row.id as string) ?? "",
          reference_number: (row.reference_number as string) || null,
          type: (row.type as TransferType) ?? "ach",
          direction: (row.direction as Transfer["direction"]) ?? "inbound",
          status: (row.status as Transfer["status"]) ?? "pending_approval",
          from_account_id: (row.from_account_id as string) || null,
          from_account_name: (row.from_account_name as string) ?? "—",
          from_account_number: (row.from_account_number as string) || null,
          from_institution: (row.from_institution as string) ?? "—",
          to_account_id: (row.to_account_id as string) || null,
          to_account_name: (row.to_account_name as string) ?? "—",
          to_account_number: (row.to_account_number as string) || null,
          to_institution: (row.to_institution as string) ?? "—",
          amount: row.amount !== null && row.amount !== undefined ? Number(row.amount) : null,
          initiated_at: (row.initiated_at as string) || null,
          estimated_completion: (row.estimated_completion as string) || null,
          completed_at: (row.completed_at as string) || null,
          initiated_by: (row.initiated_by as string) || null,
          notes: (row.notes as string) || null,
          status_history: Array.isArray(row.status_history)
            ? (row.status_history as TransferStatusEvent[])
            : [],
        }))
      );
      setLoading(false);
    }

    fetchTransfers();
  }, []);

  const totals = useMemo(() => {
    const volume = transfers.reduce((s, t) => s + (t.amount ?? 0), 0);
    const inFlight = transfers.filter((t) => IN_FLIGHT_STATUSES.has(t.status)).length;
    const completed = transfers.filter((t) => t.status === "completed").length;
    return { count: transfers.length, volume, inFlight, completed };
  }, [transfers]);

  const filteredTransfers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return transfers.filter((t) => {
      if (typeFilter !== "all" && t.type !== typeFilter) return false;
      if (!q) return true;
      return (
        (t.reference_number ?? "").toLowerCase().includes(q) ||
        t.from_account_name.toLowerCase().includes(q) ||
        t.to_account_name.toLowerCase().includes(q) ||
        t.from_institution.toLowerCase().includes(q) ||
        t.to_institution.toLowerCase().includes(q) ||
        (t.notes ?? "").toLowerCase().includes(q)
      );
    });
  }, [transfers, searchQuery, typeFilter]);

  if (loading) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-background">
        <div className="flex items-center justify-center flex-1">
          <div className="text-muted">Loading transfers...</div>
        </div>
      </div>
    );
  }

  if (error) {
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

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Header — static block above the scroll container. pt-12 clears the drawer's
          floating control band; x-padding tightens as the card narrows. */}
      <div className="px-3 sm:px-4 lg:px-6 pt-12 pb-4">
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="text-lg font-semibold text-black dark:text-white">Transfers</h1>
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black/40 dark:text-white/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search transfers..."
              className="pl-9 pr-4 py-2 bg-black/5 dark:bg-white/5 rounded-lg text-sm text-black dark:text-white placeholder-black/40 dark:placeholder-white/40 outline-none w-52"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
          <Stat label="Transfers" value={totals.count.toLocaleString()} />
          <Stat label="Volume" value={formatCurrency(totals.volume)} />
          <Stat label="In Flight" value={totals.inFlight.toLocaleString()} />
          <Stat label="Completed" value={totals.completed.toLocaleString()} />
        </div>

        {/* Type filter pills: All / ACAT / ACH / Wire / Journal */}
        <div className="mt-3 inline-flex items-center gap-1 bg-black/5 dark:bg-white/5 rounded-lg p-1">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setTypeFilter(f.value)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                typeFilter === f.value
                  ? "bg-white dark:bg-black medium:bg-[#e4e4e4] text-black dark:text-white shadow-sm"
                  : "text-black/40 dark:text-white/40 hover:text-black/70 dark:hover:text-white/70"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Top spacing lives on the table (mt-8), not the scroller: padding-top on the
          scroll container would offset the sticky-thead pin point. */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-4 lg:px-6 pb-8">
        <div className="mt-8">
          <TransfersTable rows={filteredTransfers} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="whitespace-nowrap">
      <span className="text-black/50 dark:text-white/50">{label}:</span>{" "}
      <span className="font-semibold tabular-nums text-black dark:text-white">{value}</span>
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
      />
    </svg>
  );
}
