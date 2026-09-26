"use client";

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { type ChatMessage, type ChatContextType, type ChatAttachment, type ChatReference } from "./types";

const ChatContext = createContext<ChatContextType | null>(null);

const STORAGE_KEY = "composer-chat-messages";
const CANVAS_STORAGE_KEY = "composer-canvas-page";

function generateId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function AiChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [canvasPage, setCanvasPage] = useState<string | null>(null);
  const [canvasPageName, setCanvasPageName] = useState<string | null>(null);
  const [canvasAccountNumber, setCanvasAccountNumber] = useState<string | null>(null);
  const [canvasAccountName, setCanvasAccountName] = useState<string | null>(null);
  const [pendingReferences, setPendingReferences] = useState<ChatReference[]>([]);

  // Load messages and canvas state from sessionStorage on mount
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        setMessages(JSON.parse(stored));
      }
      const canvasStored = sessionStorage.getItem(CANVAS_STORAGE_KEY);
      if (canvasStored) {
        const { href, name } = JSON.parse(canvasStored);
        setCanvasPage(href);
        setCanvasPageName(name);
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  // Save messages to sessionStorage on change
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // Ignore storage errors
    }
  }, [messages]);

  // Persist canvas state to sessionStorage
  useEffect(() => {
    try {
      if (canvasPage && canvasPageName) {
        sessionStorage.setItem(CANVAS_STORAGE_KEY, JSON.stringify({ href: canvasPage, name: canvasPageName }));
      } else {
        sessionStorage.removeItem(CANVAS_STORAGE_KEY);
      }
    } catch {
      // Ignore storage errors
    }
  }, [canvasPage, canvasPageName]);

  // Listen for account selection messages from canvas iframe
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "composer:canvas:accountSelected") {
        setCanvasAccountNumber(event.data.accountNumber);
        setCanvasAccountName(event.data.accountName);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Clear canvas account when switching canvas pages
  useEffect(() => {
    setCanvasAccountNumber(null);
    setCanvasAccountName(null);
  }, [canvasPage]);

  // Insert a switch message when the active account changes in portfolio canvas
  useEffect(() => {
    if (canvasPage?.startsWith("/accounts/portfolio") && canvasAccountNumber && canvasAccountName) {
      const switchMsg: ChatMessage = {
        id: generateId(),
        role: "assistant",
        content: `Switched to account **${canvasAccountNumber}** — ${canvasAccountName}. Ask me anything about this account.`,
        system: true,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, switchMsg]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasAccountNumber]);

  const openCanvas = useCallback((href: string, name: string) => {
    setCanvasPage(href);
    setCanvasPageName(name);
  }, []);

  const closeCanvas = useCallback(() => {
    setCanvasPage(null);
    setCanvasPageName(null);
  }, []);

  const switchCanvasPage = useCallback((href: string, name: string) => {
    setCanvasPage(href);
    setCanvasPageName(name);
  }, []);

  const sendMessage = useCallback(async (content: string, attachments?: ChatAttachment[]) => {
    const references = pendingReferences;
    if (!content.trim() && (!attachments || attachments.length === 0) && references.length === 0) return;

    // Add user message
    const userMessage: ChatMessage = {
      id: generateId(),
      role: "user",
      content:
        content.trim() ||
        (references.length > 0
          ? `Referencing ${references.map((r) => r.label).join(", ")}`
          : `Attached ${attachments?.length} file(s) for review`),
      attachments,
      references: references.length > 0 ? references : undefined,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setPendingReferences([]); // consumed by this send
    setIsLoading(true);

    try {
      // Build conversation history for context
      // Exclude system-generated messages (account switch notices) — they break strict
      // user/assistant alternation. Agent data summaries are folded in so the agent can
      // see what a previous turn returned.
      const history = messages.filter((m) => !m.system).map((m) => {
        let content = m.content;
        if (m.agent && m.data) {
          const summary = JSON.stringify(m.data);
          content += `\n[Agent @${m.agent} returned: ${summary.slice(0, 500)}]`;
        } else if (m.agent) {
          content += `\n[Agent @${m.agent}]`;
        }
        return { role: m.role, content };
      });

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content.trim() || "Please review the attached document(s).",
          attachments,
          references: references.length > 0 ? references : undefined,
          history,
          canvasPage: canvasPage || undefined,
          canvasPageName: canvasPageName || undefined,
          canvasAccountNumber: canvasAccountNumber || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to get response");
      }

      // Add assistant message
      const assistantMessage: ChatMessage = {
        id: generateId(),
        role: "assistant",
        content: data.message,
        data: data.data,
        pdfReport: data.pdfReport || null,
        agent: data.agent,
        timestamp: data.timestamp,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      // Add error message
      const errorMessage: ChatMessage = {
        id: generateId(),
        role: "assistant",
        content: error instanceof Error ? error.message : "Sorry, something went wrong. Please try again.",
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [messages, canvasPage, canvasPageName, canvasAccountNumber, pendingReferences]);

  /**
   * Runs a catalog report directly. The registry already declares the intent and
   * params, so there is nothing for a model to work out — this posts to /api/reports
   * and renders the rows. No LLM call, no round trip to Azure.
   */
  const runReport = useCallback(
    async (reportId: string, params?: Record<string, unknown>, label?: string) => {
      const userMessage: ChatMessage = {
        id: generateId(),
        role: "user",
        content: label ?? reportId,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);

      try {
        const response = await fetch("/api/reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reportId, params }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Failed to run report");

        const { rows, rowCount, label: reportLabel } = payload.data;
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            role: "assistant",
            content:
              rowCount === 0
                ? `No results for ${reportLabel}.`
                : `${reportLabel} — ${rowCount} ${rowCount === 1 ? "row" : "rows"}.`,
            data: rows,
            timestamp: new Date().toISOString(),
          },
        ]);
      } catch (error) {
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            role: "assistant",
            content: error instanceof Error ? error.message : "Failed to run report.",
            timestamp: new Date().toISOString(),
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const attachReference = useCallback((ref: ChatReference) => {
    setPendingReferences((prev) => [...prev, ref]);
  }, []);

  const removeReference = useCallback((id: string) => {
    setPendingReferences((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const clearReferences = useCallback(() => {
    setPendingReferences([]);
  }, []);

  const addMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const removeMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  }, []);

  return (
    <ChatContext.Provider
      value={{
        messages,
        isLoading,
        sendMessage,
        runReport,
        addMessage,
        removeMessage,
        clearMessages,
        pendingReferences,
        attachReference,
        removeReference,
        clearReferences,
        canvasPage,
        canvasPageName,
        canvasAccountNumber,
        canvasAccountName,
        openCanvas,
        closeCanvas,
        switchCanvasPage,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChat must be used within AiChatProvider");
  }
  return context;
}
