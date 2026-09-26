"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

// One account as the picker bar sees it — flattened from the `portfolio_accounts`
// view (account_number ↔ holder ↔ household all live on the same row).
export interface AccountOption {
  accountNumber: string;
  accountName: string;
  custodian: string; // "Pershing" | "Schwab" | "Fidelity" (from portfolio_accounts)
  clientName: string; // the primary account holder
  householdId: string | null;
  householdName: string | null; // the household this account belongs to
  totalValue: number;
}

// One household as the picker sees it — derived by grouping accounts on household_id.
export interface HouseholdOption {
  id: string;
  name: string;
  accountCount: number;
}

export interface AccountDirectory {
  accounts: AccountOption[]; // all accounts, value-desc
  households: HouseholdOption[]; // unique households, A→Z by name
  accountsByHousehold: Map<string, AccountOption[]>; // household_id → accounts, value-desc ([0] = largest)
  householdById: Map<string, HouseholdOption>; // household_id → option (back-fill on pick)
  byNumber: Map<string, AccountOption>; // accountNumber → option (back-fill on pick)
  loading: boolean;
  error: string | null;
}

// The active custodian from the header switcher, persisted to localStorage and broadcast via the
// `composer:custodian-changed` event. "All" means no filter. Stays in sync live with the switcher.
export function useCustodian(): string {
  const [custodian, setCustodian] = useState<string>("All");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("composer-custodian");
      if (saved) setCustodian(saved);
    } catch {}
    const onChange = (e: Event) => {
      const name = (e as CustomEvent).detail as string;
      if (name) setCustodian(name);
    };
    window.addEventListener("composer:custodian-changed", onChange);
    return () => window.removeEventListener("composer:custodian-changed", onChange);
  }, []);
  return custodian;
}

const BATCH = 1000; // Supabase caps a query at 1000 rows — page through with .range()

// Loads the full account directory once (1000 rows) and derives the lookups the
// linked pickers need. Filtering/searching is done client-side over this set.
// Pass { enabled: false } to skip the fetch (e.g. in alert/report sessions).
export function useAccountDirectory({ enabled = true }: { enabled?: boolean } = {}): AccountDirectory {
  const [rows, setRows] = useState<AccountOption[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      const collected: AccountOption[] = [];
      let from = 0;
      try {
        while (true) {
          const { data, error: qErr } = await supabase
            .from("portfolio_accounts")
            .select("account_number, account_name, custodian, client_name, household_id, household_name, total_value")
            .order("total_value", { ascending: false })
            .range(from, from + BATCH - 1);
          if (qErr) throw qErr;
          if (!data || data.length === 0) break;
          for (const r of data as Record<string, unknown>[]) {
            collected.push({
              accountNumber: String(r.account_number ?? ""),
              accountName: String(r.account_name ?? ""),
              custodian: String(r.custodian ?? ""),
              clientName: String(r.client_name ?? ""),
              householdId: (r.household_id as string | null) ?? null,
              householdName: (r.household_name as string | null) ?? null,
              totalValue: Number(r.total_value) || 0,
            });
          }
          if (data.length < BATCH) break;
          from += BATCH;
        }
        if (!cancelled) setRows(collected.filter((a) => a.accountNumber));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load accounts");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const custodian = useCustodian();

  // Derived structures — rows already arrive value-desc, so per-household lists and
  // each household's [0] "largest account" inherit that order with no extra sort.
  // The whole directory is scoped to the active custodian (header switcher); "All" = no filter,
  // so the account + household pickers only offer that custodian's accounts/households.
  const derived = useMemo(() => {
    const scoped =
      custodian && custodian !== "All" ? rows.filter((a) => a.custodian === custodian) : rows;

    const accountsByHousehold = new Map<string, AccountOption[]>();
    const byNumber = new Map<string, AccountOption>();
    for (const a of scoped) {
      byNumber.set(a.accountNumber, a);

      if (a.householdId) {
        const hhList = accountsByHousehold.get(a.householdId);
        if (hhList) hhList.push(a);
        else accountsByHousehold.set(a.householdId, [a]);
      }
    }

    const householdById = new Map<string, HouseholdOption>();
    for (const [id, list] of accountsByHousehold) {
      householdById.set(id, {
        id,
        name: list[0].householdName ?? "—",
        accountCount: list.length,
      });
    }
    const households = [...householdById.values()].sort((x, y) => x.name.localeCompare(y.name));

    return { accounts: scoped, accountsByHousehold, householdById, households, byNumber };
  }, [rows, custodian]);

  return { ...derived, loading, error };
}
