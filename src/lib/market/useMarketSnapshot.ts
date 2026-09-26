"use client";

/**
 * The one client-side entry point for live market data.
 *
 * Every account surface polls through this hook instead of rolling its own
 * fetch. Two properties matter more than anything else here:
 *
 *   1. Market status comes from the SERVER on every poll. The client never
 *      evaluates market hours itself. The previous implementation checked
 *      `isMarketOpen()` once at mount, so a page opened at 09:00 never started
 *      polling even after the bell.
 *
 *   2. The last good snapshot is retained on failure. Data never regresses to
 *      empty, so a network blip mid-demo is invisible rather than a blank table.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AccountValueMap, MarketSnapshot, MarketStatus, QuoteMap } from "./types";

const DEFAULT_INTERVAL_MS = 5_000;

const EMPTY_QUOTES: QuoteMap = {};
const EMPTY_ACCOUNTS: AccountValueMap = {};

/**
 * In-flight requests shared by URL, so two components mounted on the same page
 * (a table and a summary header, say) issue one request rather than two.
 *
 * Deliberately NOT tied to any caller's AbortController. Sharing one consumer's
 * signal across a deduped promise means a consumer that unmounts cancels the
 * request out from under everyone else still waiting on it — which in dev,
 * where StrictMode mounts twice, made the surviving mount receive an already
 * aborted promise and render nothing at all. Consumers instead drop late
 * results via their own `disposed` flag; a 12 KB poll is not worth cancelling.
 */
const inflight = new Map<string, Promise<MarketSnapshot | null>>();

async function fetchSnapshot(url: string): Promise<MarketSnapshot | null> {
  const existing = inflight.get(url);
  if (existing) return existing;

  const p = (async () => {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return null;
      const json = await res.json();
      return (json?.data ?? null) as MarketSnapshot | null;
    } catch {
      return null;
    } finally {
      inflight.delete(url);
    }
  })();

  inflight.set(url, p);
  return p;
}

export interface UseMarketSnapshotOptions {
  intervalMs?: number;
  /** Narrow the quote map. Omit for the whole tracked universe. */
  symbols?: string[];
  /** Ask the server for per-account values. */
  includeAccounts?: boolean;
  accountIds?: string[];
  /** Pages that must not tick (performance, retirement, trading) pass false. */
  enabled?: boolean;
}

export interface UseMarketSnapshotResult {
  quotes: QuoteMap;
  accounts: AccountValueMap;
  status: MarketStatus | null;
  asOf: number;
  degraded: boolean;
  /** For logging only — never render this as a blocking error. */
  lastError: string | null;
  refresh: () => void;
}

export function useMarketSnapshot(
  opts: UseMarketSnapshotOptions = {},
): UseMarketSnapshotResult {
  const {
    intervalMs = DEFAULT_INTERVAL_MS,
    symbols,
    includeAccounts = false,
    accountIds,
    enabled = true,
  } = opts;

  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // Sort so a caller re-deriving the same set in a different order does not
  // churn the effect and restart polling.
  const symbolKey = useMemo(
    () => (symbols?.length ? [...symbols].sort().join(",") : ""),
    [symbols],
  );
  const accountKey = useMemo(
    () => (accountIds?.length ? [...accountIds].sort().join(",") : ""),
    [accountIds],
  );

  const url = useMemo(() => {
    const p = new URLSearchParams();
    if (symbolKey) p.set("symbols", symbolKey);
    if (includeAccounts) p.set("accounts", "1");
    if (accountKey) p.set("accountIds", accountKey);
    const qs = p.toString();
    return `/api/market/snapshot${qs ? `?${qs}` : ""}`;
  }, [symbolKey, includeAccounts, accountKey]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const urlRef = useRef(url);
  urlRef.current = url;

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = async (isInitial = false) => {
      // Skip background polling to avoid burning requests on a tab nobody is
      // looking at — but never skip the FIRST load. A page opened in a
      // background tab (or rendered off-screen) must still populate, otherwise
      // it shows empty values until it happens to gain focus.
      if (
        !isInitial &&
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }

      const data = await fetchSnapshot(urlRef.current);
      if (disposed) return;

      if (data) {
        setSnapshot(data);
        setLastError(null);
      } else {
        // Deliberately does NOT clear the snapshot — last good values stay on
        // screen. This is what makes an upstream outage invisible.
        setLastError("snapshot fetch failed");
      }
    };

    void tick(true);
    timer = setInterval(() => void tick(), intervalMs);

    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [url, intervalMs, enabled, nonce]);

  return {
    quotes: snapshot?.quotes ?? EMPTY_QUOTES,
    accounts: snapshot?.accounts ?? EMPTY_ACCOUNTS,
    status: snapshot?.status ?? null,
    asOf: snapshot?.asOf ?? 0,
    degraded: snapshot?.degraded ?? false,
    lastError,
    refresh,
  };
}
