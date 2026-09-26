"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { CaseRow } from "@/lib/cases";

// DB-backed team cases (open visibility — everyone sees the whole team's cases).
// Reads go through GET /api/cases; a shared realtime channel on the `cases`
// table keeps every user's sidebar in sync with creates/renames/deletes.

export type Case = {
  id: string;
  name: string;
  accountNumber: string | null;
  status: string;
  updatedAt: string;
};

const CHANGE_EVENT = "composer:cases-changed";

async function fetchCases(): Promise<Case[] | null> {
  try {
    const res = await fetch("/api/cases");
    if (!res.ok) return null;
    const { data } = (await res.json()) as { data: CaseRow[] };
    return (data ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      accountNumber: r.account_number,
      status: r.status,
      updatedAt: r.updated_at,
    }));
  } catch {
    return null;
  }
}

// One realtime channel shared by every useCases() mount. Cross-user changes
// land here and are rebroadcast as the same CustomEvent used for same-tab
// updates, so every subscriber refetches through a single code path.
let casesChannel: ReturnType<typeof supabase.channel> | null = null;
let casesChannelRefs = 0;

function acquireCasesChannel() {
  casesChannelRefs++;
  if (casesChannel) return;
  casesChannel = supabase
    .channel("cases-sidebar")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "cases" },
      () => window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
    )
    .subscribe();
}

function releaseCasesChannel() {
  casesChannelRefs = Math.max(0, casesChannelRefs - 1);
  if (casesChannelRefs === 0 && casesChannel) {
    supabase.removeChannel(casesChannel);
    casesChannel = null;
  }
}

export function useCases() {
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      void fetchCases().then((next) => {
        if (cancelled) return;
        // On failure keep the last-known list but stop showing "Loading…".
        if (next !== null) setCases(next);
        setLoading(false);
      });
    };
    reload();
    window.addEventListener(CHANGE_EVENT, reload);
    acquireCasesChannel();
    return () => {
      cancelled = true;
      window.removeEventListener(CHANGE_EVENT, reload);
      releaseCasesChannel();
    };
  }, []);

  const remove = useCallback(async (id: string) => {
    setCases((cs) => cs.filter((c) => c.id !== id)); // optimistic
    await fetch(`/api/cases/${id}`, { method: "DELETE" }).catch(() => undefined);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  }, []);

  return { cases, remove, loading };
}
