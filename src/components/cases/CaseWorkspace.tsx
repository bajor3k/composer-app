"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import type { CaseDocumentRow, CaseMessageRow, CaseParticipantRow, CaseRow } from "@/lib/cases";
import CaseHeader from "./CaseHeader";
import CaseThread from "./CaseThread";
import CaseComposer from "./CaseComposer";
import CaseDocumentsPanel from "./CaseDocumentsPanel";

// Collaborative case workspace: shared thread + documents, kept live for every
// participant through one realtime channel per case (postgres_changes for data,
// presence for who's here). All writes go through /api/cases/* so the session
// cookie provides identity; realtime is delivery, not authority.

type Me = { id: string; name: string };

export default function CaseWorkspace({ caseId }: { caseId: string }) {
  const [me, setMe] = useState<Me | null>(null);
  const [caseRow, setCaseRow] = useState<CaseRow | null>(null);
  const [participants, setParticipants] = useState<CaseParticipantRow[]>([]);
  const [messages, setMessages] = useState<CaseMessageRow[]>([]);
  const [documents, setDocuments] = useState<CaseDocumentRow[]>([]);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [agentThinking, setAgentThinking] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const meRef = useRef<Me | null>(null);

  const appendMessage = useCallback((row: CaseMessageRow) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === row.id)) return prev;
      return [...prev, row].sort((a, b) => a.created_at.localeCompare(b.created_at));
    });
  }, []);

  const appendDocument = useCallback((row: CaseDocumentRow) => {
    setDocuments((prev) => {
      if (prev.some((d) => d.id === row.id)) return prev;
      return [row, ...prev];
    });
  }, []);

  const refetchAll = useCallback(async () => {
    const [caseRes, messagesRes, documentsRes] = await Promise.all([
      fetch(`/api/cases/${caseId}`),
      fetch(`/api/cases/${caseId}/messages`),
      fetch(`/api/cases/${caseId}/documents`),
    ]);
    if (caseRes.status === 404) {
      setNotFound(true);
      return;
    }
    if (caseRes.ok) {
      const { data } = await caseRes.json();
      setCaseRow(data.case);
      setParticipants(data.participants);
    }
    if (messagesRes.ok) setMessages((await messagesRes.json()).data ?? []);
    if (documentsRes.ok) setDocuments((await documentsRes.json()).data ?? []);
  }, [caseId]);

  // Initial load: identity + case data, and join as a participant.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const meRes = await fetch("/api/auth/me").catch(() => null);
      if (!cancelled && meRes?.ok) {
        const identity = (await meRes.json()) as Me;
        meRef.current = identity;
        setMe(identity);
      }
      await refetchAll();
      if (!cancelled) setLoading(false);
      // Join-on-open, then refresh the roster so my avatar shows immediately.
      const joinRes = await fetch(`/api/cases/${caseId}/participants`, { method: "POST" }).catch(() => null);
      if (!cancelled && joinRes?.ok) {
        const listRes = await fetch(`/api/cases/${caseId}/participants`).catch(() => null);
        if (!cancelled && listRes?.ok) setParticipants((await listRes.json()).data ?? []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [caseId, refetchAll]);

  // Realtime: one channel per open case. Waits for identity (presence key).
  useEffect(() => {
    if (!me) return;
    let dropped = false;

    const channel = supabase.channel(`case-${caseId}`, {
      config: { presence: { key: me.id } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        setOnlineIds(new Set(Object.keys(channel.presenceState())));
      })
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "case_messages", filter: `case_id=eq.${caseId}` },
        (payload) => appendMessage(payload.new as CaseMessageRow)
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "case_documents", filter: `case_id=eq.${caseId}` },
        (payload) => appendDocument(payload.new as CaseDocumentRow)
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "case_documents" },
        (payload) => {
          const oldId = (payload.old as { id?: string })?.id;
          if (oldId) setDocuments((prev) => prev.filter((d) => d.id !== oldId));
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "cases", filter: `id=eq.${caseId}` },
        (payload) => setCaseRow(payload.new as CaseRow)
      )
      .on(
        "postgres_changes",
        // DELETE payloads can't be filtered without REPLICA IDENTITY FULL —
        // listen wide and match the id client-side.
        { event: "DELETE", schema: "public", table: "cases" },
        (payload) => {
          if ((payload.old as { id?: string })?.id === caseId) setNotFound(true);
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "case_participants", filter: `case_id=eq.${caseId}` },
        (payload) => {
          const row = payload.new as CaseParticipantRow;
          setParticipants((prev) =>
            prev.some((p) => p.user_id === row.user_id) ? prev : [...prev, row]
          );
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setDegraded(false);
          void channel.track({ userId: me.id, name: me.name });
          if (dropped) {
            dropped = false;
            void refetchAll();
          }
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          dropped = true;
          setDegraded(true);
        }
      });

    // Fallback when realtime is degraded (and cheap insurance when it isn't):
    // refetch whenever the window regains focus.
    const onFocus = () => void refetchAll();
    window.addEventListener("focus", onFocus);

    return () => {
      window.removeEventListener("focus", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [caseId, me, appendMessage, appendDocument, refetchAll]);

  const sendMessage = useCallback(
    async (content: string) => {
      // Mirror of the server's routing rule, just for the thinking indicator:
      // explicit @mention, or a follow-up right after an agent reply I triggered.
      const last = messages[messages.length - 1];
      const beforeLast = messages[messages.length - 2];
      const wakesAgent =
        content.trim().startsWith("@") ||
        (last?.author_type === "agent" && beforeLast?.author_id === meRef.current?.id);
      if (wakesAgent) setAgentThinking(true);

      try {
        const res = await fetch(`/api/cases/${caseId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        if (res.ok) {
          // Sender-side fallback — realtime usually beat us to it (dedupe by id).
          const { data } = await res.json();
          if (data.message) appendMessage(data.message);
          if (data.agentMessage) appendMessage(data.agentMessage);
        }
      } finally {
        setAgentThinking(false);
      }
    },
    [caseId, messages, appendMessage]
  );

  const uploadFiles = useCallback(
    async (files: File[]) => {
      let lastError = "Upload failed";
      let failed = 0;
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(`/api/cases/${caseId}/documents`, { method: "POST", body: form }).catch(() => null);
        if (res?.ok) {
          const { data } = await res.json();
          appendDocument(data);
          setDocsOpen(true);
        } else {
          failed++;
          if (res) lastError = (await res.json().catch(() => null))?.error ?? lastError;
        }
      }
      if (failed > 0) throw new Error(lastError);
    },
    [caseId, appendDocument]
  );

  const deleteDocument = useCallback(
    async (docId: string) => {
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
      await fetch(`/api/cases/${caseId}/documents/${docId}`, { method: "DELETE" }).catch(() => undefined);
    },
    [caseId]
  );

  if (notFound) {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="text-center">
          <div className="text-lg font-medium text-black dark:text-white">
            This case is no longer available
          </div>
          <div className="mt-1 text-sm text-black/50 dark:text-white/50">
            It may have been deleted by a teammate.
          </div>
          <Link
            href="/create?new=case"
            className="mt-4 inline-block px-4 py-1.5 rounded-lg text-sm font-medium bg-black dark:bg-white text-white dark:text-black hover:opacity-90 transition-opacity"
          >
            Start a new case
          </Link>
        </div>
      </div>
    );
  }

  if (loading || !caseRow) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-sm text-black/40 dark:text-white/40">Loading case…</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex h-full min-h-0">
      <div className="flex-1 flex flex-col min-h-0">
        {degraded && (
          <div className="px-6 py-1.5 text-center text-[11px] text-black/45 dark:text-white/45 border-b border-black/5 dark:border-white/5">
            Live updates are reconnecting — the thread refreshes when you return to this window.
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-8">
            <CaseThread messages={messages} meId={me?.id ?? null} agentThinking={agentThinking} />
          </div>
        </div>
        {/* Case meta bar — sits right above the composer, aligned to the message box */}
        <div className="px-6">
          <div className="max-w-3xl mx-auto border-t border-black/5 dark:border-white/5">
            <CaseHeader caseRow={caseRow} />
          </div>
        </div>
        <div className="px-6 pb-6">
          <div className="max-w-3xl mx-auto">
            <CaseComposer
              onSend={sendMessage}
              onUpload={uploadFiles}
              selectedAgent={caseRow.selected_agent}
            />
          </div>
        </div>
      </div>
      {docsOpen && (
        <CaseDocumentsPanel
          caseId={caseId}
          documents={documents}
          meId={me?.id ?? null}
          onDelete={deleteDocument}
          onClose={() => setDocsOpen(false)}
        />
      )}
    </div>
  );
}
