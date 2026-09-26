"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { AlertEventRow, AlertRow } from "@/lib/alerts/types";

/**
 * Loads the Alert Center's two datasets and keeps them live.
 *
 * Reads go through the REST routes (session-gated, consistent with the rest of the
 * app) while the realtime channel only signals *that* something changed — the
 * refetch is what produces the new rows. That keeps one code path for shaping data
 * instead of hand-merging postgres_changes payloads into local state.
 */
export function useAlerts() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [events, setEvents] = useState<AlertEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [aRes, eRes] = await Promise.all([
        fetch("/api/alerts"),
        fetch("/api/alerts/events?limit=200"),
      ]);
      const aJson = await aRes.json().catch(() => ({}));
      const eJson = await eRes.json().catch(() => ({}));
      if (!aRes.ok) throw new Error(aJson?.error || "Failed to load alerts");
      if (!eRes.ok) throw new Error(eJson?.error || "Failed to load alert activity");
      setAlerts((aJson.data ?? []) as AlertRow[]);
      setEvents((eJson.data ?? []) as AlertEventRow[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load alerts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Live updates — a cron run inserting events lights up the Triggered badge in an
  // idle tab. Both tables are published in 0004_alerts.sql.
  useEffect(() => {
    const channel = supabase
      .channel("composer-alerts")
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "alert_events" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  /**
   * Optimistically write the enabled/archived flags. Both can go in one call so a
   * restore can't land half-applied. Reverts to the prior values and surfaces the
   * reason if the write fails.
   */
  const setFlags = useCallback(
    async (id: string, patch: { enabled?: boolean; archived?: boolean }) => {
      // Snapshot both flags up front so a failed restore reverts to what the row
      // actually was, not to the inverse of what was sent.
      const before = alerts.find((a) => a.id === id);
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
      try {
        const res = await fetch(`/api/alerts/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json?.error || "Could not update the alert.");
        }
      } catch (err) {
        if (before) {
          setAlerts((prev) =>
            prev.map((a) =>
              a.id === id ? { ...a, enabled: before.enabled, archived: before.archived } : a,
            ),
          );
        }
        setError(err instanceof Error ? err.message : "Could not update the alert.");
      }
    },
    [alerts],
  );

  const toggleAlert = useCallback(
    (id: string, enabled: boolean) => setFlags(id, { enabled }),
    [setFlags],
  );

  const setArchived = useCallback(
    (id: string, archived: boolean) => setFlags(id, { archived }),
    [setFlags],
  );

  /**
   * The archived section's toggle. Switching a shelved rule back on is the same
   * gesture as putting it back in service, so it un-archives at the same time —
   * otherwise the row would light up green while still sitting under "Archived"
   * and never actually being evaluated.
   */
  const toggleArchivedAlert = useCallback(
    (id: string, enabled: boolean) =>
      enabled ? setFlags(id, { enabled: true, archived: false }) : setFlags(id, { enabled: false }),
    [setFlags],
  );

  const deleteAlert = useCallback(async (id: string) => {
    const previous = alerts;
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    const res = await fetch(`/api/alerts/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setAlerts(previous);
      const json = await res.json().catch(() => ({}));
      setError(json?.error || "Could not delete the alert.");
    }
  }, [alerts]);

  const acknowledgeEvent = useCallback(async (id: string) => {
    setEvents((prev) =>
      prev.map((e) => (e.id === id ? { ...e, status: "acknowledged" as const } : e)),
    );
    const res = await fetch(`/api/alerts/events/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "acknowledged" }),
    });
    if (!res.ok) {
      setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, status: "new" as const } : e)));
      const json = await res.json().catch(() => ({}));
      setError(json?.error || "Could not acknowledge the event.");
    }
  }, []);

  return {
    alerts,
    events,
    loading,
    error,
    setError,
    reload: load,
    toggleAlert,
    toggleArchivedAlert,
    setArchived,
    deleteAlert,
    acknowledgeEvent,
  };
}
