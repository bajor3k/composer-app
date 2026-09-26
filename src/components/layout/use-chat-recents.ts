"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConversationKind, ConversationRow } from "@/lib/conversations";

export type ChatRecent = {
  id: string;
  title: string;
  pinned: boolean;
  kind: ConversationKind;
};

const CHANGE_EVENT = "composer:chat-recents-changed";

// Removed in favour of the DB. Cleared once per browser so the ten placeholder titles
// this feature used to ship with don't linger in anyone's storage.
const LEGACY_STORAGE_KEY = "composer-chat-recents";

let legacyCleared = false;
function clearLegacyStorage() {
  if (legacyCleared || typeof window === "undefined") return;
  legacyCleared = true;
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {}
}

function toRecent(row: ConversationRow): ChatRecent {
  return { id: row.id, title: row.title, pinned: row.pinned, kind: row.kind };
}

/**
 * Tell every mounted instance (the sidebar list and the search overlay) to refetch.
 * Exported because the chat page also mutates conversations — creating one on the first
 * send has to make the sidebar row appear immediately, without a reload.
 */
export function notifyChatRecentsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

async function fetchRecents(): Promise<ChatRecent[]> {
  const res = await fetch("/api/conversations");
  if (!res.ok) throw new Error(`conversations ${res.status}`);
  const body = (await res.json()) as { data?: ConversationRow[] };
  return (body.data ?? []).map(toRecent);
}

export function useChatRecents() {
  const [recents, setRecents] = useState<ChatRecent[]>([]);

  const refresh = useCallback(async () => {
    try {
      setRecents(await fetchRecents());
    } catch (err) {
      // Never surfaced: a history list that can't load must not break the sidebar.
      console.error("[chat-recents] load failed", err);
    }
  }, []);

  useEffect(() => {
    clearLegacyStorage();
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, [refresh]);

  /**
   * Apply the change locally first so the row responds instantly, then persist. On
   * failure we refetch, which snaps the UI back to server truth rather than leaving a
   * lie on screen.
   */
  const mutate = useCallback(
    async (optimistic: (list: ChatRecent[]) => ChatRecent[], request: () => Promise<Response>) => {
      setRecents(optimistic);
      try {
        const res = await request();
        if (!res.ok) throw new Error(`request ${res.status}`);
        notifyChatRecentsChanged();
      } catch (err) {
        console.error("[chat-recents] update failed", err);
        void refresh();
      }
    },
    [refresh],
  );

  const setPinned = useCallback(
    (id: string, pinned: boolean) =>
      mutate(
        (l) => l.map((r) => (r.id === id ? { ...r, pinned } : r)),
        () =>
          fetch(`/api/conversations/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pinned }),
          }),
      ),
    [mutate],
  );

  const pin = useCallback((id: string) => void setPinned(id, true), [setPinned]);
  const unpin = useCallback((id: string) => void setPinned(id, false), [setPinned]);

  const rename = useCallback(
    (id: string, title: string) => {
      const t = title.trim();
      if (!t) return; // ignore empty — keep the old title
      void mutate(
        (l) => l.map((r) => (r.id === id ? { ...r, title: t } : r)),
        () =>
          fetch(`/api/conversations/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: t }),
          }),
      );
    },
    [mutate],
  );

  const remove = useCallback(
    (id: string) => {
      void mutate(
        (l) => l.filter((r) => r.id !== id),
        () => fetch(`/api/conversations/${id}`, { method: "DELETE" }),
      );
    },
    [mutate],
  );

  return { recents, pin, unpin, rename, remove, refresh };
}
