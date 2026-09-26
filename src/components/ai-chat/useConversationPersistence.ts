"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { notifyChatRecentsChanged } from "@/components/layout/use-chat-recents";
import { toStoredCard, type CardBearingMessage, type ConversationKind } from "@/lib/conversations";
import type { ChatReference } from "./types";

/**
 * The shape this hook needs from the chat page's `Msg`. Declared structurally so the
 * page keeps ownership of its own type.
 */
export type PersistableMessage = CardBearingMessage & {
  id: string;
  role: "user" | "assistant";
  content: string;
  references?: ChatReference[];
  /** Set on messages rehydrated from the DB — they are already stored, never re-sent. */
  restoredCard?: unknown;
};

interface Options {
  messages: PersistableMessage[];
  /** null disables persistence entirely (case mode — cases have their own tables). */
  kind: ConversationKind | null;
  accountNumber?: string | null;
  accountName?: string | null;
  householdName?: string | null;
}

/**
 * Saves the conversation as it happens.
 *
 * One effect watching `messages` rather than a call at each send site: the page sends
 * from a dozen places (slash commands, the two builders, agent replies, timeframe chips)
 * and any missed one would silently lose messages.
 *
 * Every write is best-effort. A failure logs and drops the batch — losing history is bad,
 * but breaking a live conversation to report it is worse.
 */
export function useConversationPersistence({
  messages,
  kind,
  accountNumber,
  accountName,
  householdName,
}: Options) {
  const [conversationId, setConversationId] = useState<string | null>(null);

  const persistedIds = useRef<Set<string>>(new Set());
  // Serialises the create-then-append sequence. Without it, two rapid message updates
  // both see conversationId === null and create two conversations for one chat.
  const inFlight = useRef<Promise<void>>(Promise.resolve());
  // Persistence is suspended while hydrating a reopened conversation, otherwise the
  // restored transcript would be written straight back as new messages.
  const hydrating = useRef(false);

  /** Called when a conversation is opened from History. */
  const adoptConversation = useCallback((id: string, existingMessageIds: string[]) => {
    persistedIds.current = new Set(existingMessageIds);
    setConversationId(id);
  }, []);

  /** Called by resetSession — the next send starts a brand new conversation. */
  const resetConversation = useCallback(() => {
    persistedIds.current = new Set();
    setConversationId(null);
  }, []);

  const setHydrating = useCallback((value: boolean) => {
    hydrating.current = value;
  }, []);

  useEffect(() => {
    if (kind === null || hydrating.current) return;

    const unsaved = messages.filter((m) => !persistedIds.current.has(m.id));
    if (unsaved.length === 0) return;

    // Claim the ids up front so a re-render mid-request cannot queue them twice.
    unsaved.forEach((m) => persistedIds.current.add(m.id));

    const payload = unsaved.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      refs: m.references ?? null,
      card: toStoredCard(m),
    }));

    const firstUserMessage = messages.find((m) => m.role === "user")?.content?.trim();

    inFlight.current = inFlight.current
      .then(async () => {
        let id = conversationId;

        if (!id) {
          const res = await fetch("/api/conversations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: firstUserMessage || householdName || "New chat",
              kind,
              accountNumber: accountNumber ?? undefined,
              accountName: accountName ?? undefined,
              householdName: householdName ?? undefined,
            }),
          });
          if (!res.ok) throw new Error(`create ${res.status}`);
          const body = (await res.json()) as { data?: { id: string } };
          id = body.data?.id ?? null;
          if (!id) throw new Error("create returned no id");
          setConversationId(id);
        }

        const res = await fetch(`/api/conversations/${id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: payload }),
        });
        if (!res.ok) throw new Error(`append ${res.status}`);

        // Makes the row appear in the sidebar the moment the first message is sent —
        // the whole point of the feature.
        notifyChatRecentsChanged();
      })
      .catch((err) => {
        console.error("[conversation] save failed", err);
        // Let a later message retry these.
        unsaved.forEach((m) => persistedIds.current.delete(m.id));
      });
  }, [messages, kind, conversationId, accountNumber, accountName, householdName]);

  return { conversationId, adoptConversation, resetConversation, setHydrating };
}
