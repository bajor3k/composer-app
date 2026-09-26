"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { listCustomCommands } from "@/lib/custom-commands";
import type { ReportRunRow, SavedReportRow } from "@/lib/reports/types";

// Set once the browser's old localStorage commands have been imported, so the
// one-time migration never runs twice.
const IMPORT_FLAG = "composer-reports-imported";

/**
 * Loads the Report Center's two datasets and keeps them live.
 *
 * Also performs the one-time import of saved commands that used to live in
 * localStorage (`composer-custom-commands`) — those were per-browser and
 * invisible to teammates. The old key is left untouched: if the import is wrong
 * the data is still there to re-read.
 */
export function useSavedReports() {
  const [reports, setReports] = useState<SavedReportRow[]>([]);
  const [runs, setRuns] = useState<ReportRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const imported = useRef(false);

  const load = useCallback(async () => {
    try {
      const [rRes, runRes] = await Promise.all([
        fetch("/api/saved-reports"),
        fetch("/api/saved-reports/runs?limit=200"),
      ]);
      const rJson = await rRes.json().catch(() => ({}));
      const runJson = await runRes.json().catch(() => ({}));
      if (!rRes.ok) throw new Error(rJson?.error || "Failed to load reports");
      if (!runRes.ok) throw new Error(runJson?.error || "Failed to load run history");
      setReports((rJson.data ?? []) as SavedReportRow[]);
      setRuns((runJson.data ?? []) as ReportRunRow[]);
      setError(null);
      return (rJson.data ?? []) as SavedReportRow[];
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load reports");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const existing = await load();
      if (existing === null || imported.current) return;
      imported.current = true;
      try {
        if (localStorage.getItem(IMPORT_FLAG)) return;
        const legacy = listCustomCommands();
        if (legacy.length === 0) {
          localStorage.setItem(IMPORT_FLAG, "1");
          return;
        }
        // Don't re-create anything already in the DB under the same name.
        const known = new Set(existing.map((r) => r.name.toLowerCase()));
        const toImport = legacy.filter((c) => !known.has(c.label.toLowerCase()));
        await Promise.all(
          toImport.map((c) =>
            fetch("/api/saved-reports", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: c.label,
                report_id: c.reportId,
                params: c.params ?? {},
                scope_mode: c.scope?.accountNumber
                  ? "account"
                  : c.scope?.household
                    ? "household"
                    : "book",
                account_numbers: c.scope?.accountNumber ? [c.scope.accountNumber] : [],
                household_name: c.scope?.household ?? null,
                schedule: "manual",
                source: "imported",
              }),
            }),
          ),
        );
        localStorage.setItem(IMPORT_FLAG, "1");
        if (toImport.length) await load();
      } catch {
        // A failed import must not block the page — the old key is untouched.
      }
    })();
  }, [load]);

  // Live updates — a scheduled sweep writing runs lights up the feed in an idle tab.
  useEffect(() => {
    const channel = supabase
      .channel("composer-saved-reports")
      .on("postgres_changes", { event: "*", schema: "public", table: "saved_reports" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "report_runs" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  /** Optimistic enabled/archived write; both may go together so a restore can't
   *  land half-applied. */
  const setFlags = useCallback(
    async (id: string, patch: { enabled?: boolean; archived?: boolean }) => {
      const before = reports.find((r) => r.id === id);
      setReports((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
      try {
        const res = await fetch(`/api/saved-reports/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json?.error || "Could not update the report.");
        }
      } catch (err) {
        if (before) {
          setReports((prev) =>
            prev.map((r) =>
              r.id === id ? { ...r, enabled: before.enabled, archived: before.archived } : r,
            ),
          );
        }
        setError(err instanceof Error ? err.message : "Could not update the report.");
      }
    },
    [reports],
  );

  const toggleReport = useCallback(
    (id: string, enabled: boolean) => setFlags(id, { enabled }),
    [setFlags],
  );
  const setArchived = useCallback(
    (id: string, archived: boolean) => setFlags(id, { archived }),
    [setFlags],
  );
  /** Switching an archived report back on also restores it into the main list. */
  const toggleArchivedReport = useCallback(
    (id: string, enabled: boolean) =>
      enabled ? setFlags(id, { enabled: true, archived: false }) : setFlags(id, { enabled: false }),
    [setFlags],
  );

  const deleteReport = useCallback(
    async (id: string) => {
      const previous = reports;
      setReports((prev) => prev.filter((r) => r.id !== id));
      const res = await fetch(`/api/saved-reports/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setReports(previous);
        const json = await res.json().catch(() => ({}));
        setError(json?.error || "Could not delete the report.");
      }
    },
    [reports],
  );

  return {
    reports,
    runs,
    loading,
    error,
    setError,
    reload: load,
    toggleReport,
    toggleArchivedReport,
    setArchived,
    deleteReport,
  };
}
