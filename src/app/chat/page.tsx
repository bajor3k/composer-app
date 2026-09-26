"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useChat } from "@/components/ai-chat/AiChatContext";
import ComposerPlusMenu, { AttachmentCard } from "@/components/ai-chat/ComposerPlusMenu";
import ReferenceChip from "@/components/ai-chat/ReferenceChip";
import MessageMeta from "@/components/ui/MessageMeta";
import ContextPickerBar from "@/components/ai-chat/ContextPickerBar";
import CreateActionButton, { type CreateActionKey } from "@/components/ai-chat/CreateActionButton";
import DockedContextBar from "@/components/ai-chat/DockedContextBar";
import { useAccountDirectory, type AccountOption, type HouseholdOption } from "@/components/ai-chat/useAccountDirectory";
import { useConversationPersistence } from "@/components/ai-chat/useConversationPersistence";
import { fromStoredCard, type ConversationMessageRow, type ConversationRow, type StoredCard } from "@/lib/conversations";
import type { ChatReference, ReportData } from "@/components/ai-chat/types";
import { ReportDataRenderer } from "@/components/ai-chat/AiChatMessage";
import AgentThinking from "@/components/ai-chat/AgentThinking";
import { exportAccountHoldings, type HoldingsExportResult } from "@/lib/holdings-export";
import {
  exportAccountTransactions,
  TIMEFRAMES,
  type TransactionsExportResult,
} from "@/lib/transactions-export";
import { exportToExcel } from "@/lib/report-export";
import { formatCurrency } from "@/lib/format-utils";
import {
  filterChatMenuCommands,
  type ChatMenuCommand,
} from "@/lib/slash-commands";
// Reading only. The chat no longer WRITES saved commands — the report builder saves
// to the Report Center now — but existing per-browser commands still run from the
// slash menu until useSavedReports has imported them.
import {
  listCustomCommands,
  removeCustomCommand,
  onCustomCommandsChanged,
  type CustomCommand,
} from "@/lib/custom-commands";
import type { ProposedReport } from "@/lib/ai/report-builder";
import type { ReportPreview } from "@/lib/reports/preview";
import type { ProposedAlert } from "@/lib/alerts/alert-builder";
import type { AlertPreview } from "@/lib/alerts/preview";
import {
  exportSymbolHoldings,
  downloadSymbolHoldings,
  type SymbolHoldingsResult,
} from "@/lib/symbol-holdings-export";

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  references?: ChatReference[];
  // Present on the assistant confirmation for a `/holdings` export — drives the
  // "Download Excel" re-download chip.
  holdingsExport?: HoldingsExportResult;
  // Present on the `/transactions` follow-up — renders the timeframe chips. Carries
  // the account captured when the command was sent, so a later account switch can't
  // mis-target the export.
  txnPrompt?: { accountNumber: string };
  // Present on the assistant confirmation for a `/transactions` export.
  txnExport?: TransactionsExportResult;
  // Present on the `/NVDA` (symbol-holders) report — drives the in-chat table and
  // its Download Excel button.
  symbolReport?: SymbolHoldingsResult;
  // Present on the report-builder "ready" message — drives the report confirm-card.
  proposedReport?: ProposedReport;
  // Set true once this card's report has been saved, so the card shows the saved state.
  reportSaved?: boolean;
  // Present on the alert-builder "ready" message — drives the alert confirm-card.
  proposedAlert?: ProposedAlert;
  // Set true once this card's alert has been created.
  alertSaved?: boolean;
  // Rows from a saved command executed directly against its catalog intent. Saved
  // commands used to re-send English through the chat pipeline and come back as
  // prose; they now run their own report and render it.
  reportData?: ReportData;
  // Set only on messages rehydrated from a saved conversation. Its presence marks the
  // message as historical, so cards render without their action — a stale export must
  // not offer a download of day-old prices, and an accepted proposal must not offer to
  // create a second alert. See src/lib/conversations.ts.
  restoredCard?: StoredCard;
  // When the message was actually sent. Live messages leave this unset and fall back to
  // the epoch embedded in their id; restored ones carry the stored created_at, whose id
  // has no epoch in it. See messageTime().
  createdAt?: string;
};

/**
 * When to show under a message.
 *
 * Live ids are minted as `u-${Date.now()}`, so the timestamp was historically recovered
 * by parsing the id. That breaks the moment an id isn't shaped that way — a restored
 * conversation, or any future id scheme — and `new Date(NaN).toISOString()` throws
 * RangeError during render, which white-screens the entire chat. Prefer the explicit
 * createdAt, fall back to the id, and never let a bad value throw.
 */
function messageTime(m: Msg): string {
  if (m.createdAt) {
    const explicit = new Date(m.createdAt);
    if (!Number.isNaN(explicit.getTime())) return explicit.toISOString();
  }
  const fromId = new Date(Number(m.id.split("-")[1]));
  return Number.isNaN(fromId.getTime()) ? new Date().toISOString() : fromId.toISOString();
}

// Minimum length for the FIRST prompt of a session when the "Minimum" toggle is on.
// Later messages are unrestricted.
const MIN_FIRST_PROMPT = 160;

// The Composer agent is the only agent in the app. This list previously held five
// invented names that matched nothing in the registry, so picking one silently fell
// through to plain chat.
const MENTION_AGENTS = ["agent"];

/** Same report, for duplicate-card suppression: what it pulls and where, not its name. */
function sameReport(a: ProposedReport, b: ProposedReport): boolean {
  return (
    a.report_id === b.report_id &&
    JSON.stringify(a.params) === JSON.stringify(b.params) &&
    a.scope_mode === b.scope_mode &&
    a.account_number === b.account_number &&
    a.household_id === b.household_id
  );
}

/** Headline for the report preview: how many rows, over which columns. */
function describeReportPreview(p: ReportPreview): string | null {
  if (p.status === "skipped") return p.skipReason ?? "Couldn't check this one right now.";
  if (p.rowCount === 0) return p.caveat ? null : "Comes back empty right now.";
  const cols = p.columns.slice(0, 3).join(", ");
  return `${p.rowCount} row${p.rowCount === 1 ? "" : "s"} right now${cols ? ` · ${cols}` : ""}`;
}

/** Same rule, for duplicate-card suppression: what it watches and where, not its name. */
function sameAlert(a: ProposedAlert, b: ProposedAlert): boolean {
  return (
    JSON.stringify(a.condition) === JSON.stringify(b.condition) &&
    a.scope_mode === b.scope_mode &&
    a.account_number === b.account_number &&
    a.household_id === b.household_id
  );
}

/**
 * Headline for the alert preview. Returns null when a caveat is the whole story —
 * "nothing matches right now" above "this can never match" would contradict itself,
 * and the caveat is the more useful of the two.
 */
function describePreview(p: AlertPreview): string | null {
  if (p.status === "skipped") return p.skipReason ?? "Couldn't check this one right now.";
  if (p.matchCount === 0) {
    return p.caveat ? null : "Nothing matches right now — you'd be told when it does.";
  }
  // Price moves and book-level counts roll up into ONE event carrying how many
  // positions it covers, so "1 of 900 accounts" would badly undersell them.
  if (p.matchCount === 1 && p.samples[0]?.accountNumber === null) {
    return p.affectedCount > 1
      ? `Would fire now · ${p.affectedCount} positions in scope`
      : "Would fire now";
  }
  return `Would fire on ${p.matchCount} of ${p.scopeCount} account${p.scopeCount === 1 ? "" : "s"}`;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [activeModes, setActiveModes] = useState<Set<string>>(new Set());
  const [attachments, setAttachments] = useState<File[]>([]);
  // Current custodian (Pershing / Schwab / Fidelity) — shown in the hero, kept in
  // sync with the header's CustodianSwitcher.
  const [custodian, setCustodian] = useState("Pershing");
  // Studio "New Alert" / "New Report" / sidebar "New Case" open the standard chat
  // in a themed create mode.
  const [createKind, setCreateKind] = useState<"alert" | "report" | "case" | null>(null);
  // Case mode: the first send creates the shared, DB-backed case and the session
  // stays right here — same page and chat as workspace/alerts/reports. Later sends
  // post to the same case thread via this id.
  const [caseId, setCaseId] = useState<string | null>(null);
  // Picker-bar context: the pre-selected account + household for the session. The
  // primary holder is derived from the account; custodian reuses the state above.
  const [pickedAccount, setPickedAccount] = useState<AccountOption | null>(null);
  const [pickedHousehold, setPickedHousehold] = useState<HouseholdOption | null>(null);
  // Heading account picker — the inline "New Session for ___" blank.
  const [headPickerOpen, setHeadPickerOpen] = useState(false);
  const [headSearch, setHeadSearch] = useState("");
  // Chat composer prefs (toggled from the user menu): show prompt-writing reminders
  // in the composer, and enforce a minimum length on the first prompt of a session.
  const [minFirstPromptOn, setMinFirstPromptOn] = useState(false);
  // Slash-command menu: open while the composer text starts with "/". slashIndex is
  // the keyboard-highlighted row.
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  // @agent mention menu — keyboard-highlighted row.
  const [mentionIndex, setMentionIndex] = useState(0);
  // Saved custom report commands, kept live for the Reports-mode saved list.
  const [savedCommands, setSavedCommands] = useState<CustomCommand[]>([]);
  useEffect(() => {
    setSavedCommands(listCustomCommands());
    return onCustomCommandsChanged(() => setSavedCommands(listCustomCommands()));
  }, []);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const headPickerRef = useRef<HTMLSpanElement>(null);
  const headSearchRef = useRef<HTMLInputElement>(null);
  const { openCanvas, pendingReferences, removeReference, clearReferences, canvasAccountNumber } = useChat();

  // Durable history. Case mode passes null: cases already persist to their own tables
  // and are listed separately in the sidebar, so persisting them here would double-list
  // every case.
  const { adoptConversation, resetConversation, setHydrating } = useConversationPersistence({
    messages,
    kind: createKind === "case" ? null : createKind ?? "chat",
    accountNumber: pickedAccount?.accountNumber,
    accountName: pickedAccount?.accountName,
    householdName: pickedHousehold?.name,
  });

  const hasMessages = messages.length > 0;

  // Account directory for the picker bar — only fetched in pure-chat mode.
  const directory = useAccountDirectory({ enabled: true });

  // Slash-command menu state. The menu populates the moment the composer text
  // starts with "/", filtering live against the command/label/category. Disabled in
  // alert/report create modes (those have their own flow).
  const slashQuery = !createKind && input.startsWith("/") ? input.slice(1) : null;
  const slashMatches = slashQuery !== null ? filterChatMenuCommands(slashQuery) : [];
  const slashMenuOpen = slashOpen && slashQuery !== null && slashMatches.length > 0;

  // @agent mention menu — same heuristic as the case composer: open while the
  // message is a single leading @token (no space yet).
  const mentionOpen = input.startsWith("@") && !input.includes(" ");
  const mentionMatches = mentionOpen
    ? MENTION_AGENTS.filter((name) => name.toLowerCase().startsWith(input.slice(1).toLowerCase()))
    : [];
  const mentionMenuOpen = mentionOpen && mentionMatches.length > 0;
  const pickMention = (name: string) => {
    setInput(`@${name} `);
    setMentionIndex(0);
    taRef.current?.focus();
  };
  // Keep the highlighted row in range as the filtered list shrinks/grows.
  useEffect(() => {
    setSlashIndex((i) => (i >= slashMatches.length ? 0 : i));
  }, [slashMatches.length]);

  // The account is the driver: picking one back-fills its household. Picking a
  // household instead scopes the account picker and drops a now-mismatched account.
  const pickAccount = (a: AccountOption | null) => {
    setPickedAccount(a);
    setPickedHousehold(a?.householdId ? directory.householdById.get(a.householdId) ?? null : null);
  };
  const pickHousehold = (h: HouseholdOption | null) => {
    setPickedHousehold(h);
    // Clearing the household drops the account along with it.
    if (!h) {
      setPickedAccount(null);
      return;
    }
    // Auto-pick the household's largest account so the account # (hero) and the
    // primary holder populate immediately (list is value-desc, [0] = largest).
    const top = directory.accountsByHousehold.get(h.id)?.[0] ?? null;
    if (top) setPickedAccount(top);
    else if (pickedAccount && pickedAccount.householdId !== h.id) setPickedAccount(null);
  };

  // Mirror an open Portfolio page into the session context. When a Portfolio is
  // open in the drawer/canvas it posts its selected account (→ canvasAccountNumber);
  // if the user hasn't chosen an account or household for this session yet, adopt the
  // portfolio's account here — back-filling its household via pickAccount — so the
  // hero and chips reflect what they're looking at. Tracks the portfolio while the
  // session stays empty; once the user picks anything, we stop and they own the
  // context. Works for every custodian (resolution is custodian-agnostic).
  const autoFilledAccountRef = useRef<string | null>(null);
  useEffect(() => {
    if (!canvasAccountNumber) return;
    if (pickedAccount || pickedHousehold) return; // user already has a session context
    if (autoFilledAccountRef.current === canvasAccountNumber) return; // already mirrored
    const match = directory.byNumber.get(canvasAccountNumber);
    if (!match) return; // directory still loading, or account outside the active scope
    autoFilledAccountRef.current = canvasAccountNumber;
    pickAccount(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasAccountNumber, pickedAccount, pickedHousehold, directory.byNumber]);

  // The collapsed sidebar is a 64px floating rail, but AppShell still reserves that
  // width as a left margin on the content — which pushes the centered chat right of the
  // true viewport center. When the rail is collapsed (sidebar not pinned), mirror that
  // reservation on the RIGHT so the centering area is symmetric about the viewport.
  // (Reserving space rather than shifting with a transform keeps the card inside the
  // content layer's clip box, so its left edge is never shaved off on narrow widths.)
  // Pinned = a real sidebar, where centering in the remaining space is correct.
  const [railCollapsed, setRailCollapsed] = useState(false);
  useEffect(() => {
    try {
      setRailCollapsed(localStorage.getItem("sidebar-pinned") !== "true");
    } catch {}
    const onPinned = (e: Event) => setRailCollapsed(!(e as CustomEvent).detail);
    window.addEventListener("composer:sidebar-pinned", onPinned);
    return () => window.removeEventListener("composer:sidebar-pinned", onPinned);
  }, []);
  const COLLAPSED_RAIL_PX = 64;
  // Hero keeps its px-6 (1.5rem) side padding and adds the rail width on the right;
  // the conversation root has no base padding, so it just gets the rail width.
  const heroCenterStyle = railCollapsed
    ? { paddingRight: `calc(1.5rem + ${COLLAPSED_RAIL_PX}px)` }
    : undefined;
  const convoCenterStyle = railCollapsed ? { paddingRight: COLLAPSED_RAIL_PX } : undefined;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  // Broadcast the current sub-mode so the sidebar highlights the matching nav row
  // (New chat vs Alerts vs Reports). Fires on mount and on every mode change.
  useEffect(() => {
    const submode = createKind ?? "chat";
    window.dispatchEvent(new CustomEvent("composer:chat-mode", { detail: submode }));
  }, [createKind]);

  // Once a message is sent, broadcast the session's account # + household so an open
  // drawer page (PageDrawer) can scope itself. The chips themselves now
  // render above the composer (composerDocked), not from this event. Cleared while empty.
  useEffect(() => {
    const active = hasMessages && (pickedAccount || pickedHousehold);
    window.dispatchEvent(
      new CustomEvent("composer:session-context", {
        detail: active
          ? {
              accountNumber: pickedAccount?.accountNumber ?? null,
              household: pickedHousehold?.name ?? null,
            }
          : null,
      }),
    );
  }, [hasMessages, pickedAccount, pickedHousehold]);

  // Drive an open page in the drawer (e.g. Portfolio) live: broadcast the picked
  // account the moment it changes — before any message is sent — so the drawer can
  // re-scope its page immediately. This is separate from the send-gated header-chip
  // broadcast above on purpose.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("composer:active-account", {
        detail: {
          accountNumber: pickedAccount?.accountNumber ?? null,
        },
      }),
    );
  }, [pickedAccount]);

  // Clear the header chips when leaving the chat.
  useEffect(
    () => () => {
      window.dispatchEvent(new CustomEvent("composer:session-context", { detail: null }));
    },
    [],
  );

  const resetSession = () => {
    setMessages([]);
    setInput("");
    setIsThinking(false);
    setCaseId(null);
    // The next send starts a new conversation rather than appending to the one just left.
    resetConversation();
  };

  // Close the current session from the docked household chip's ×: drop back to the
  // centered new-chat hero with a fresh (empty) context.
  //
  // Nothing is archived here any more. The conversation was written to the DB as it
  // happened and is already in History; adding it again on close would produce a
  // duplicate row.
  const endSession = () => {
    resetSession();
    setPickedAccount(null);
    setPickedHousehold(null);
  };

  // Switch what the composer is for, in place — no navigation, no remount.
  //
  // The thread has to be archived and cleared rather than carried over: the three
  // modes hit three different endpoints, and sendToAlertBuilder/sendToReportBuilder
  // forward the prior turns as history. Carry a workspace conversation about NVDA
  // into alert mode and the Alerts Agent opens by proposing an NVDA alert. It doesn't
  // fail, it's just quietly wrong about what was asked, which is worse.
  //
  // The picked account and household deliberately survive — that's the scope the user
  // just set up, and both builders take it as context. The thread being cleared here is
  // already saved in History and can be reopened with its full transcript.
  //
  // It must NOT touch the URL: /create keys <ChatPage key={kind}>, so editing ?new=
  // would remount and wipe the conversation — the exact opposite of "in place".
  const switchMode = (kind: "alert" | "report" | null) => {
    if (kind === createKind) return;
    resetSession();
    setCreateKind(kind);
  };

  // "New chat" → ordinary chat (also exits any create mode).
  useEffect(() => {
    const onNewChat = () => {
      resetSession();
      setCreateKind(null);
    };
    window.addEventListener("composer:new-chat", onNewChat);
    return () => {
      window.removeEventListener("composer:new-chat", onNewChat);
    };
  }, []);

  // "New Case" → fresh case chat. Needed on top of the ?new=case mount read:
  // clicking the sidebar row while already on /create?new=case doesn't remount
  // (same route key), so the reset comes through this event instead.
  useEffect(() => {
    const onNewCase = () => {
      resetSession();
      setCreateKind("case");
    };
    window.addEventListener("composer:new-case", onNewCase);
    return () => {
      window.removeEventListener("composer:new-case", onNewCase);
    };
  }, []);

  // Enter the matching mode when opened from a sidebar item
  // (/create?new=alert | report | case).
  useEffect(() => {
    const kind = new URLSearchParams(window.location.search).get("new");
    if (kind === "alert" || kind === "report" || kind === "case") {
      resetSession();
      setCreateKind(kind);
    }
  }, []);

  // Reopen a saved conversation.
  //
  // setHydrating fences the restore: without it the persistence effect would see the
  // rehydrated transcript as new messages and write the whole conversation back.
  const loadConversation = useCallback(
    async (id: string) => {
      setHydrating(true);
      try {
        const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error(`load ${res.status}`);
        const body = (await res.json()) as {
          data?: { conversation: ConversationRow; messages: ConversationMessageRow[] };
        };
        const conversation = body.data?.conversation;
        const rows = body.data?.messages ?? [];
        if (!conversation) return;

        setInput("");
        setIsThinking(false);
        setCaseId(null);
        setMessages(
          rows.map((row) => ({
            id: row.id,
            role: row.role,
            content: row.content,
            references: row.refs ?? undefined,
            createdAt: row.created_at,
            ...fromStoredCard(row.card),
          })) as Msg[],
        );
        setCreateKind(conversation.kind === "chat" ? null : conversation.kind);

        // Restore the scope the session was set up with, so the header chips and any
        // follow-up question target the same account.
        setPickedAccount(
          conversation.account_number
            ? {
                accountNumber: conversation.account_number,
                accountName: conversation.account_name ?? conversation.account_number,
                custodian: "",
                clientName: "",
                householdId: null,
                householdName: conversation.household_name,
                totalValue: 0,
              }
            : null,
        );
        setPickedHousehold(
          conversation.household_name ? ({ name: conversation.household_name } as HouseholdOption) : null,
        );

        adoptConversation(
          conversation.id,
          rows.map((r) => r.id),
        );
      } catch (err) {
        // Fail soft: a conversation that won't load leaves an empty new chat rather
        // than an error screen.
        console.error("[conversation] restore failed", err);
      } finally {
        setHydrating(false);
      }
    },
    [adoptConversation, setHydrating],
  );

  // Deep link / full page load: /chat?c=<id>.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("c");
    if (id) void loadConversation(id);
    // Mount only — in-app opens come through the event below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sidebar History click. router.push from /chat to /chat?c=<id> updates the URL but
  // does NOT remount this page, so the mount effect above never re-runs — the same
  // reason "New Case" needs its own event. ChatRecents fires this alongside the push.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent).detail as string;
      if (id) void loadConversation(id);
    };
    window.addEventListener("composer:open-conversation", onOpen);
    return () => window.removeEventListener("composer:open-conversation", onOpen);
  }, [loadConversation]);

  // Keep the hero's custodian in sync with the header switcher.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("composer-custodian");
      if (saved) setCustodian(saved);
    } catch {}
    const onCustodian = (e: Event) => {
      const name = (e as CustomEvent).detail as string;
      if (name) setCustodian(name);
    };
    window.addEventListener("composer:custodian-changed", onCustodian);
    return () => window.removeEventListener("composer:custodian-changed", onCustodian);
  }, []);

  // Read the chat composer preferences (minimum first prompt + prompt-helper
  // reminders), and stay in sync when toggled from the user menu (same-tab custom
  // event) or another tab (storage event on the shared localStorage key).
  useEffect(() => {
    const read = () => {
      try {
        const s = JSON.parse(localStorage.getItem("composer-chat-settings") || "{}");
        setMinFirstPromptOn(!!s.minFirstPrompt);
      } catch {
        setMinFirstPromptOn(false);
      }
    };
    read();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "composer-chat-settings") read();
    };
    // Same-tab toggle (from the user menu) — storage events don't fire locally.
    const onSettings = () => read();
    window.addEventListener("storage", onStorage);
    window.addEventListener("composer:chat-settings-changed", onSettings);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("composer:chat-settings-changed", onSettings);
    };
  }, []);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [input]);

  // Close the centered account search on Escape; focus its search on open.
  // (The modal's own backdrop handles click-to-dismiss.)
  useEffect(() => {
    if (!headPickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setHeadPickerOpen(false);
        setHeadSearch("");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [headPickerOpen]);

  useEffect(() => {
    if (headPickerOpen) headSearchRef.current?.focus();
  }, [headPickerOpen]);

  const headFiltered = (() => {
    const base = pickedHousehold
      ? directory.accountsByHousehold.get(pickedHousehold.id) ?? []
      : directory.accounts;
    const q = headSearch.trim().toLowerCase();
    const list = q
      ? base.filter(
          (a) =>
            a.accountNumber.toLowerCase().includes(q) ||
            a.accountName.toLowerCase().includes(q) ||
            a.clientName.toLowerCase().includes(q),
        )
      : base;
    return list.slice(0, 50);
  })();

  // Pure chat session — wired to the live AI, carrying any element references the
  // user captured with the picker plus the active account context.
  const sendToAgent = async (text: string, refs: ChatReference[], priorMessages: Msg[]) => {
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text || `Tell me about ${refs.map((r) => r.label).join(", ")}`,
          references: refs.length ? refs : undefined,
          // Picker-bar selection wins; fall back to a canvas-iframe account.
          canvasAccountNumber: pickedAccount?.accountNumber || canvasAccountNumber || undefined,
          accountHolder: pickedAccount?.clientName || undefined,
          accountHousehold: pickedHousehold?.name || undefined,
          custodianHint: custodian || undefined,
          history: priorMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Request failed");
      setMessages((m) => [...m, { id: `a-${Date.now()}`, role: "assistant", content: data.message || "…" }]);
    } catch {
      setMessages((m) => [
        ...m,
        { id: `a-${Date.now()}`, role: "assistant", content: "Sorry — I hit a problem answering that. Please try again." },
      ]);
    } finally {
      setIsThinking(false);
    }
  };

  // Report-builder conversation — posts to /api/report-builder and pushes either a
  // clarifying question or a command-proposal card.
  /** Alert create mode — mirrors sendToReportBuilder. The proposal is rendered as a
   *  confirm-card; nothing is persisted until the user clicks Create alert. */
  const sendToAlertBuilder = async (text: string, priorMessages: Msg[]) => {
    try {
      const res = await fetch("/api/alert-builder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: priorMessages.map((m) => ({ role: m.role, content: m.content })),
          context: {
            accountNumber: pickedAccount?.accountNumber || undefined,
            household: pickedHousehold?.name || undefined,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Request failed");
      const result = data.data as
        | { status: "asking"; message: string }
        | { status: "ready"; message: string; alert: ProposedAlert };
      setMessages((m) => {
        // Drop a proposal identical to one already on screen. Asked for something
        // Composer can't watch, the model answers correctly in prose but tends to
        // re-send the previous rule to propose_alert alongside it — which would put
        // a second Create button under the same alert and is how you end up with
        // duplicates. The earlier card is still in the thread and still actionable.
        const repeat =
          result.status === "ready" &&
          m.some((prev) => prev.proposedAlert && sameAlert(prev.proposedAlert, result.alert));
        return [
          ...m,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            content: result.message,
            proposedAlert: result.status === "ready" && !repeat ? result.alert : undefined,
          },
        ];
      });
    } catch {
      setMessages((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: "Sorry — I couldn't put that together. Try describing the alert a different way.",
        },
      ]);
    } finally {
      setIsThinking(false);
    }
  };

  /** Persist a proposed alert and confirm in-thread. */
  const saveProposedAlert = async (msgId: string, alert: ProposedAlert) => {
    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: alert.name,
          condition: alert.condition,
          scope_mode: alert.scope_mode,
          account_number: alert.account_number ?? null,
          household_id: alert.household_id ?? null,
          household_name: alert.household_name ?? null,
          frequency: alert.frequency,
          severity: alert.severity,
          source: "chat",
        }),
      });
      if (!res.ok) return;
      setMessages((m) => m.map((x) => (x.id === msgId ? { ...x, alertSaved: true } : x)));
    } catch {
      // Leave the button live so the user can retry.
    }
  };

  const sendToReportBuilder = async (text: string, priorMessages: Msg[]) => {
    try {
      const res = await fetch("/api/report-builder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: priorMessages.map((m) => ({ role: m.role, content: m.content })),
          context: {
            accountNumber: pickedAccount?.accountNumber || undefined,
            household: pickedHousehold?.name || undefined,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Request failed");
      const result = data.data as
        | { status: "asking"; message: string }
        | { status: "ready"; message: string; report: ProposedReport };
      setMessages((m) => {
        // Same duplicate suppression as the alert path: asked for something the
        // catalog can't cover, the model answers correctly in prose but tends to
        // re-send the previous report to the tool alongside it.
        const repeat =
          result.status === "ready" &&
          m.some((prev) => prev.proposedReport && sameReport(prev.proposedReport, result.report));
        return [
          ...m,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            content: result.message,
            proposedReport: result.status === "ready" && !repeat ? result.report : undefined,
          },
        ];
      });
    } catch {
      setMessages((m) => [
        ...m,
        { id: `a-${Date.now()}`, role: "assistant", content: "Sorry — I couldn't put that together. Try describing the report a different way." },
      ]);
    } finally {
      setIsThinking(false);
    }
  };

  // Persist a proposed report to the Report Center and mark the card as saved.
  // Mirrors saveProposedAlert — `source: "chat"` is what lets the Reports page tell
  // an agent-built report from a hand-filled one.
  const saveProposedReport = async (msgId: string, proposed: ProposedReport) => {
    try {
      const res = await fetch("/api/saved-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: proposed.name,
          report_id: proposed.report_id,
          params: proposed.params,
          scope_mode: proposed.scope_mode,
          account_numbers: proposed.account_number ? [proposed.account_number] : [],
          household_id: proposed.household_id ?? null,
          household_name: proposed.household_name ?? null,
          schedule: proposed.schedule,
          enabled: true,
          source: "chat",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Request failed");
      setMessages((m) => m.map((x) => (x.id === msgId ? { ...x, reportSaved: true } : x)));
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content:
            err instanceof Error && err.message !== "Request failed"
              ? `Couldn't save that report — ${err.message}`
              : "Couldn't save that report. Try again.",
        },
      ]);
    }
  };

  // `/holdings` — a workspace action command (not an AI prompt): pull all holdings
  // for the selected account and download them as Excel, then confirm in-thread
  // with a re-download chip. Distinct from the Composer agent chat; never hits /api/chat.
  const runHoldingsCommand = async () => {
    if (!pickedAccount) {
      setMessages((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: "Pick an account first — /holdings exports the holdings for the account in this chat's context.",
        },
      ]);
      setIsThinking(false);
      return;
    }
    try {
      const result = await exportAccountHoldings(pickedAccount);
      if (!result) {
        setMessages((m) => [
          ...m,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            content: `No holdings found for ${pickedAccount.accountNumber}.`,
          },
        ]);
        return;
      }
      setMessages((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: `Exported ${result.count} holding${result.count === 1 ? "" : "s"} for ${result.accountNumber} to Excel.`,
          holdingsExport: result,
        },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: `Sorry — I couldn't export holdings for ${pickedAccount.accountNumber}. Please try again.`,
        },
      ]);
    } finally {
      setIsThinking(false);
    }
  };

  // `/transactions` — like `/holdings`, but first asks for a timeframe. Step 1 posts
  // the question with timeframe chips; step 2 (chip click) runs the export below.
  const askTransactionsTimeframe = () => {
    if (!pickedAccount) {
      setMessages((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: "Pick an account first — /transactions exports the transactions for the account in this chat's context.",
        },
      ]);
      return;
    }
    setMessages((m) => [
      ...m,
      {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: `Which timeframe for the transactions report on ${pickedAccount.accountNumber}?`,
        txnPrompt: { accountNumber: pickedAccount.accountNumber },
      },
    ]);
  };

  const runTransactionsExport = async (accountNumber: string, timeframeId: string) => {
    setIsThinking(true);
    try {
      const result = await exportAccountTransactions({ accountNumber }, timeframeId);
      if (!result) {
        const label = TIMEFRAMES.find((t) => t.id === timeframeId)?.label ?? "that range";
        setMessages((m) => [
          ...m,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            content: `No transactions found for ${accountNumber} (${label}).`,
          },
        ]);
        return;
      }
      setMessages((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: `Exported ${result.count} transaction${result.count === 1 ? "" : "s"} for ${result.accountNumber} (${result.timeframeLabel}) to Excel.`,
          txnExport: result,
        },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: `Sorry — I couldn't export transactions for ${accountNumber}. Please try again.`,
        },
      ]);
    } finally {
      setIsThinking(false);
    }
  };

  // `/NVDA` — workspace action command (not an AI prompt): pull every account that
  // holds NVDA across all custodians and show them as an in-chat table + a Download
  // Excel button. Distinct from the Composer agent chat; never hits /api/chat.
  const runNvdaCommand = async () => {
    try {
      const result = await exportSymbolHoldings("NVDA");
      if (!result) {
        setMessages((m) => [
          ...m,
          { id: `a-${Date.now()}`, role: "assistant", content: "No accounts currently hold NVDA." },
        ]);
        return;
      }
      setMessages((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: `${result.count} account${result.count === 1 ? "" : "s"} hold ${result.symbol} — ${formatCurrency(
            result.totalMarketValue,
          )} total market value, across all custodians.`,
          symbolReport: result,
        },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        { id: `a-${Date.now()}`, role: "assistant", content: "Sorry — I couldn't pull NVDA holders. Please try again." },
      ]);
    } finally {
      setIsThinking(false);
    }
  };

  // Run a picked slash-command. Hardcoded action commands (/holdings, /NVDA,
  // /transactions) keep dispatching by their command text; a saved custom command
  // re-sends its stored natural-language message to the Composer agent.
  const runSlashCommand = async (cmd: ChatMenuCommand) => {
    if (isThinking) return;
    setSlashOpen(false);
    setInput("");
    const custom = listCustomCommands().find((c) => c.command === cmd.command);
    if (custom) {
      setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: custom.command }]);
      setIsThinking(true);
      clearReferences();
      try {
        const res = await fetch("/api/reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reportId: custom.reportId, params: custom.params }),
        });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error || "Failed to run report");
        const { rows, rowCount, label } = payload.data;
        setMessages((m) => [
          ...m,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            content:
              rowCount === 0
                ? `No results for ${label}.`
                : `${label} — ${rowCount} ${rowCount === 1 ? "row" : "rows"}.`,
            reportData: rows,
          },
        ]);
      } catch (err) {
        setMessages((m) => [
          ...m,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            content: err instanceof Error ? err.message : "Failed to run report.",
          },
        ]);
      } finally {
        setIsThinking(false);
      }
      return;
    }
    send(cmd.command);
  };

  const send = (overrideText?: string): boolean => {
    const text = (typeof overrideText === "string" ? overrideText : input).trim();
    const refs = pendingReferences;
    if ((!text && refs.length === 0) || isThinking) return false;
    // First-prompt minimum length — only the opening message of a fresh chat
    // session must clear MIN_FIRST_PROMPT (enabled in Settings → Chat). Every
    // later message is unrestricted. Does not apply to alert/report modes.
    if (minFirstPromptOn && !createKind && messages.length === 0 && text.length < MIN_FIRST_PROMPT) return false;
    const priorMessages = messages;

    // Workspace action command — `/holdings` exports the selected account's holdings
    // to Excel rather than asking the Composer agent. Runs only in pure chat (not alert/report).
    if (!createKind && /^\/holdings\b/i.test(text)) {
      setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: text }]);
      setInput("");
      setIsThinking(true);
      clearReferences();
      runHoldingsCommand();
      return true;
    }

    // `/NVDA` — pull all accounts holding NVDA → in-chat table + Excel.
    if (!createKind && /^\/NVDA\b/i.test(text)) {
      setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: text }]);
      setInput("");
      setIsThinking(true);
      clearReferences();
      runNvdaCommand();
      return true;
    }

    // `/transactions` asks for a timeframe first (chips), then exports on selection.
    if (!createKind && /^\/transactions\b/i.test(text)) {
      setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: text }]);
      setInput("");
      clearReferences();
      askTransactionsTimeframe();
      return true;
    }

    // Report / alert create modes — drive their conversational builders. Both
    // return a proposal the user confirms before anything is persisted.
    if (createKind === "report" || createKind === "alert") {
      if (!text) return false;
      setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: text }]);
      setInput("");
      setIsThinking(true);
      if (createKind === "report") sendToReportBuilder(text, priorMessages);
      else sendToAlertBuilder(text, priorMessages);
      return true;
    }

    // Case mode: the first message creates the shared, DB-backed case (titled by
    // the picked account, or a placeholder until one is picked) and the chat stays
    // on this page — same experience as workspace/alerts/reports. The case shows
    // up in the sidebar's Cases list; later messages post to the same case thread,
    // so @agent routing keeps working and any agent reply lands here.
    if (createKind === "case") {
      if (!text) return false;
      setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: text }]);
      setInput("");
      setIsThinking(true);
      clearReferences();
      void (async () => {
        try {
          let targetCaseId = caseId;
          if (!targetCaseId) {
            const createRes = await fetch("/api/cases", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                accountNumber: pickedAccount?.accountNumber,
                householdName: pickedHousehold?.name,
              }),
            });
            if (!createRes.ok) throw new Error(`case create failed (${createRes.status})`);
            const { data: newCase } = await createRes.json();
            targetCaseId = newCase.id as string;
            setCaseId(targetCaseId);
            window.dispatchEvent(new CustomEvent("composer:cases-changed"));
          }
          const msgRes = await fetch(`/api/cases/${targetCaseId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: text }),
          });
          if (!msgRes.ok) throw new Error(`case message failed (${msgRes.status})`);
          // The messages API routes @agent mentions server-side; surface any
          // agent/system reply in this thread. A bare message (no @agent) gets no
          // case-thread reply, so hand it to the Composer agent — same response the workspace
          // chat gives — instead of leaving the user in silence.
          const { data: msgData } = await msgRes.json();
          if (msgData?.agentMessage?.content) {
            setMessages((m) => [
              ...m,
              { id: `a-${Date.now()}`, role: "assistant", content: msgData.agentMessage.content },
            ]);
            setIsThinking(false);
          } else {
            await sendToAgent(text, [], priorMessages);
          }
        } catch (error) {
          console.error("Case send failed:", error);
          setIsThinking(false);
          const expired = error instanceof Error && error.message.includes("(401)");
          setMessages((m) => [
            ...m,
            {
              id: `a-${Date.now()}`,
              role: "assistant",
              content: expired
                ? "Your session has expired — refresh the page and sign in again, then resend that."
                : "I couldn't send that to the case — please try again.",
            },
          ]);
        }
      })();
      return true;
    }

    // Pure chat — live the Composer agent, with references.
    setMessages((m) => [
      ...m,
      {
        id: `u-${Date.now()}`,
        role: "user",
        content: text || `Referencing ${refs.map((r) => r.label).join(", ")}`,
        references: refs.length ? refs : undefined,
      },
    ]);
    setInput("");
    setIsThinking(true);
    clearReferences();
    sendToAgent(text, refs, priorMessages);
    return true;
  };

  const onInputChange = (val: string) => {
    setInput(val);
    setSlashOpen(val.startsWith("/"));
    setMentionIndex(0);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Mention-menu navigation takes priority while its dropdown is open.
    if (mentionMenuOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => Math.min(i + 1, mentionMatches.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickMention(mentionMatches[Math.min(mentionIndex, mentionMatches.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        // A trailing space closes the single-@token menu without eating the text.
        setInput(input + " ");
        return;
      }
    }
    // Slash-menu navigation takes priority while the dropdown is open.
    if (slashMenuOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => Math.min(i + 1, slashMatches.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const cmd = slashMatches[slashIndex];
        if (cmd) runSlashCommand(cmd);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const cmd = slashMatches[slashIndex];
        if (cmd) runSlashCommand(cmd);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashOpen(false);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // The mode is now chosen from the sidebar (New Session / Alerts / Reports),
  // so the hero just reflects it as a static word.
  const typeLabel = createKind === "alert" ? "Alert" : createKind === "report" ? "Report" : createKind === "case" ? "Case" : "Workspace";

  // Inline account-number picker for the "New {type} for ___" hero. Picking here
  // sets the same session account the picker bar below uses, so they stay in sync.
  const headingAccountPicker = (
    <span className="relative inline-block align-baseline pointer-events-auto" ref={headPickerRef}>
      <button
        type="button"
        onClick={() => setHeadPickerOpen((o) => !o)}
        title="Select an account"
        aria-label={pickedAccount ? `Account ${pickedAccount.accountNumber}. Click to change.` : "Select an account"}
        className="inline-block align-baseline pb-0.5 cursor-pointer hover:opacity-70 transition-opacity font-bold whitespace-nowrap"
      >
        {pickedAccount ? (
          // Neutral + theme-adaptive (gray that fits each colorway), softer than the
          // full-strength heading words so it still reads as a distinct token.
          <span className="text-black/60 dark:text-white/60">{pickedAccount.accountNumber}</span>
        ) : (
          <span className="text-black/25 dark:text-white/25">Select account</span>
        )}
      </button>

      {headPickerOpen && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
          {/* Backdrop — click anywhere to dismiss. */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => {
              setHeadPickerOpen(false);
              setHeadSearch("");
            }}
          />
          {/* Centered search panel — bigger, command-palette style. */}
          <div className="relative w-full max-w-xl rounded-2xl border border-black/10 dark:border-white/10 bg-surface dark:bg-surface-dark shadow-2xl overflow-hidden text-left">
            <div className="px-4 py-3.5 border-b border-black/5 dark:border-white/5">
              <input
                ref={headSearchRef}
                value={headSearch}
                onChange={(e) => setHeadSearch(e.target.value)}
                placeholder="Search by account number or name…"
                className="w-full bg-transparent px-1 text-lg font-normal text-black dark:text-white placeholder-black/30 dark:placeholder-white/30 outline-none"
              />
            </div>
            <div className="max-h-[55vh] overflow-y-auto py-1.5">
              {headFiltered.length === 0 ? (
                <div className="px-4 py-3 text-sm font-normal text-black/40 dark:text-white/40">
                  {directory.loading ? "Loading accounts…" : "No accounts found"}
                </div>
              ) : (
                headFiltered.map((a) => (
                  <button
                    key={a.accountNumber}
                    type="button"
                    onClick={() => {
                      pickAccount(a);
                      setHeadPickerOpen(false);
                      setHeadSearch("");
                    }}
                    className="w-full text-left px-4 py-2.5 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                  >
                    <div className="text-sm font-medium text-black dark:text-white">{a.accountNumber}</div>
                    <div className="text-xs font-normal text-black/50 dark:text-white/50 truncate">{a.accountName}</div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </span>
  );

  // Shared card chrome for the composer (and the unified composer+picker shell).
  const COMPOSER_CARD =
    "chat-composer rounded-2xl border border-black/10 dark:border-white/10 bg-sidebar dark:bg-sidebar-dark medium:bg-[#c2c2c2] shadow-sm";

  // First-prompt minimum gate (Settings → Chat). Active only for the opening
  // message of a fresh pure-chat session; blocks Send until 160 chars is reached.
  const firstPromptActive = minFirstPromptOn && !createKind && messages.length === 0;
  const firstPromptLen = input.trim().length;
  const firstPromptShort = firstPromptActive && firstPromptLen < MIN_FIRST_PROMPT;

  // Chrome-less composer body — wrapped by the card below (standalone) or by the
  // unified shell (when the picker bar is attached).
  const composerInner = (
    <div className="relative">
      {mentionMenuOpen && (
        <div className="absolute bottom-full left-0 right-0 mb-2 z-30 overflow-hidden rounded-xl border border-black/10 dark:border-white/10 bg-surface dark:bg-surface-dark shadow-lg">
          {mentionMatches.map((name, i) => (
            <button
              key={name}
              type="button"
              // Keep the textarea focused — prevents the menu from closing before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setMentionIndex(i)}
              onClick={() => pickMention(name)}
              className={`w-full text-left px-3.5 py-2.5 transition-colors ${
                i === Math.min(mentionIndex, mentionMatches.length - 1)
                  ? "bg-black/[0.05] dark:bg-white/[0.06]"
                  : ""
              }`}
            >
              <span className="text-sm font-medium text-black dark:text-white">{name}</span>
            </button>
          ))}
        </div>
      )}
      {slashMenuOpen && (
        <div className="absolute bottom-full left-0 right-0 mb-2 z-30 overflow-hidden rounded-xl border border-black/10 dark:border-white/10 bg-surface dark:bg-surface-dark shadow-lg">
          {slashMatches.map((cmd, i) => (
            <button
              key={cmd.command}
              type="button"
              // Keep the textarea focused — prevents the menu from closing before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setSlashIndex(i)}
              onClick={() => runSlashCommand(cmd)}
              className={`w-full text-left px-3.5 py-2.5 flex items-baseline gap-3 transition-colors ${
                i === slashIndex ? "bg-black/[0.05] dark:bg-white/[0.06]" : ""
              }`}
            >
              <span className="text-sm font-medium text-black dark:text-white">{cmd.command}</span>
              <span className="text-xs text-black/40 dark:text-white/40 truncate">{cmd.description}</span>
            </button>
          ))}
        </div>
      )}
      {(pendingReferences.length > 0 || attachments.length > 0) && (
        <div className="flex flex-wrap gap-2 px-4 pt-3">
          {pendingReferences.map((ref) => (
            <ReferenceChip key={ref.id} reference={ref} onRemove={() => removeReference(ref.id)} />
          ))}
          {attachments.map((file, i) => (
            <AttachmentCard key={i} file={file} onRemove={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} />
          ))}
        </div>
      )}
      <textarea
        ref={taRef}
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={
          createKind === "alert"
            ? "Describe the alert you want to create…"
            : createKind === "report"
            ? "Describe the report you want to create…"
            : "Ask the Composer agent"
        }
        rows={1}
        className="w-full bg-transparent px-5 pt-4 pb-2 text-sm text-black dark:text-white placeholder-black/30 dark:placeholder-white/30 outline-none resize-none"
      />
      <div className="flex items-center justify-between px-4 pb-3">
        <div className="flex items-center gap-1">
          <ComposerPlusMenu
            activeModes={activeModes}
            onToggleMode={(mode) =>
              setActiveModes((prev) => {
                const next = new Set(prev);
                next.has(mode) ? next.delete(mode) : next.add(mode);
                return next;
              })
            }
            onOpenStudio={openCanvas}
            onInsertText={(t) => setInput((v) => (v ? `${v} ${t}` : t))}
            fileInputRef={fileInputRef}
            onAddFiles={(files) => setAttachments((prev) => [...prev, ...files])}
          />
        </div>
        <div className="flex items-center gap-2.5">
          {firstPromptActive && firstPromptLen > 0 && (
            <span
              // Neutral, theme-adaptive: a touch more prominent while short, fading to
              // muted once the minimum is satisfied.
              className={`text-xs tabular-nums ${firstPromptShort ? "text-black/60 dark:text-white/60" : "text-black/30 dark:text-white/30"}`}
              title={`The first prompt of a new session needs at least ${MIN_FIRST_PROMPT} characters`}
            >
              {firstPromptLen}/{MIN_FIRST_PROMPT}
            </span>
          )}
          <button
            type="button"
            onClick={() => send()}
            disabled={(!input.trim() && pendingReferences.length === 0) || firstPromptShort}
            className="p-1.5 rounded-lg transition-colors text-white bg-black dark:bg-white dark:text-black disabled:opacity-30 disabled:cursor-not-allowed"
            title={firstPromptShort ? `Add at least ${MIN_FIRST_PROMPT - firstPromptLen} more characters to send` : "Send"}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-6 6m6-6l6 6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );

  // Standalone composer (alert/report modes have no picker bar).
  const inputBox = <div className={COMPOSER_CARD}>{composerInner}</div>;

  // What the Create split button reads. DERIVED from createKind rather than held in
  // the button — the sidebar's "New chat" and the ?new= param both move the mode
  // without going through the button, and a mirrored copy would go stale.
  const createMode: CreateActionKey =
    createKind === "alert" ? "alert" : createKind === "report" ? "report" : "ticket";
  const onCreateModeChange = (mode: CreateActionKey) =>
    switchMode(mode === "ticket" ? null : mode);

  // The labeled context row — Household · Attach. The account is driven by
  // the hero heading picker, so the Account chip is omitted here (no onPickAccount).
  // The Create split button is hidden only in case mode: a case owns a DB-backed
  // caseId, and silently switching out of it would orphan the case that was created.
  const pickerBar = (
    <ContextPickerBar
      account={pickedAccount}
      household={pickedHousehold}
      directory={directory}
      onPickHousehold={pickHousehold}
      showCreateAction={createKind !== "case"}
      createMode={createMode}
      onCreateModeChange={onCreateModeChange}
    />
  );

  // Hero (no messages yet): the interactive picker bar sits just OUTSIDE the composer
  // card, right on top of it (very close), with the textarea card below.
  const composerHero = (
    <div>
      {pickerBar}
      <div className={COMPOSER_CARD}>{composerInner}</div>
    </div>
  );

  // Docked (a message was sent): the household + account chips stay right on top of the
  // composer — same spot the picker bar occupied in the hero — instead of moving to the
  // header. The account chip switches accounts within the household; the household chip's
  // hover-× closes the session (archives to History, returns to the centered hero).
  const dockedHouseholdAccounts = pickedHousehold
    ? directory.accountsByHousehold.get(pickedHousehold.id) ?? []
    : directory.accounts;
  // The row is unconditional now so the Create button survives into the conversation
  // — you can see which mode you're in and switch without starting over from the
  // hero. DockedContextBar returns null on its own when there's no scope to show,
  // and ml-auto right-aligns the button either way. Same px-3 as the hero's picker
  // bar over the same composer card, so the button's measured mr-[5px] still lands
  // on the send button's pixel column.
  const composerDocked = (
    <div>
      <div className="px-3 pb-1.5 flex items-center gap-1">
        <DockedContextBar
          household={pickedHousehold}
          account={pickedAccount}
          householdAccounts={dockedHouseholdAccounts}
          onPickAccount={pickAccount}
          onEndSession={endSession}
        />
        {createKind !== "case" && (
          <CreateActionButton
            mode={createMode}
            onModeChange={onCreateModeChange}
            accountNumber={pickedAccount?.accountNumber ?? ""}
          />
        )}
      </div>
      {inputBox}
    </div>
  );

  // Empty state — hero + input (no conversation yet)
  if (!hasMessages) {
    return (
      <div className="relative flex-1 flex flex-col items-center justify-center px-6" style={heroCenterStyle}>
        <div className="w-full max-w-3xl">
          <div className="mb-6 pointer-events-none text-center">
            <h1 className="text-4xl font-normal text-black dark:text-white tracking-tight leading-snug">
              New {typeLabel} for {headingAccountPicker}
            </h1>
          </div>
          {composerHero}
          {createKind === "report" && savedCommands.length > 0 && (
            <div className="mt-6">
              <div className="mb-2 text-xs uppercase tracking-wider text-black/40 dark:text-white/40">
                Your saved reports
              </div>
              <div className="space-y-1">
                {savedCommands.map((c) => (
                  <div
                    key={c.command}
                    className="group flex items-center justify-between rounded-lg px-3 py-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => { setCreateKind(null); runSlashCommand({ command: c.command, label: c.label, description: c.description }); }}
                      className="flex-1 text-left"
                    >
                      <span className="font-mono text-sm font-semibold text-[#1E7FE0] dark:text-[#5CB0FF]">{c.command}</span>
                      <span className="ml-2 text-xs text-black/50 dark:text-white/50">{c.description}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeCustomCommand(c.command)}
                      className="opacity-0 group-hover:opacity-100 text-black/30 dark:text-white/30 hover:text-black dark:hover:text-white transition"
                      aria-label={`Delete ${c.command}`}
                      title="Delete"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full min-h-0" style={convoCenterStyle}>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`group flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
            >
              {m.references && m.references.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-1.5 max-w-[80%] justify-end">
                  {m.references.map((ref) => (
                    <ReferenceChip key={ref.id} reference={ref} />
                  ))}
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-black text-white dark:bg-white/10 dark:text-white/85"
                    : "bg-black/[0.04] dark:bg-white/[0.06] text-black dark:text-white/70"
                }`}
              >
                {m.content}
              </div>
              {m.holdingsExport && (
                <button
                  type="button"
                  onClick={() =>
                    exportToExcel(
                      m.holdingsExport!.rows,
                      m.holdingsExport!.title,
                      m.holdingsExport!.columns,
                    )
                  }
                  className="mt-1.5 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-black text-white dark:bg-white dark:text-black hover:opacity-80 transition-opacity"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Download Excel
                </button>
              )}
              {/* A reopened export. Deliberately not a live Download button: the rows
                  behind it were a price snapshot from the day it ran, and handing
                  someone stale prices in a fresh-looking spreadsheet is worse than not
                  offering the file. Re-run the command for current numbers. */}
              {m.restoredCard?.type === "export" && (
                <div className="mt-1.5 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-black/[0.04] dark:bg-white/[0.06] text-black/50 dark:text-white/50">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Exported {m.restoredCard.count.toLocaleString()}{" "}
                  {m.restoredCard.exportKind === "holdings" ? "holdings" : "transactions"} · download expired
                </div>
              )}
              {m.txnPrompt && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {TIMEFRAMES.map((tf) => (
                    <button
                      key={tf.id}
                      type="button"
                      onClick={() => runTransactionsExport(m.txnPrompt!.accountNumber, tf.id)}
                      disabled={isThinking}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-black/[0.06] dark:bg-white/[0.1] text-black dark:text-white hover:bg-black/[0.12] dark:hover:bg-white/[0.18] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {tf.label}
                    </button>
                  ))}
                </div>
              )}
              {m.txnExport && (
                <button
                  type="button"
                  onClick={() =>
                    exportToExcel(
                      m.txnExport!.rows,
                      m.txnExport!.title,
                      m.txnExport!.columns,
                    )
                  }
                  className="mt-1.5 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-black text-white dark:bg-white dark:text-black hover:opacity-80 transition-opacity"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Download Excel
                </button>
              )}
              {m.reportData && (
                <div className="mt-2 w-full">
                  <ReportDataRenderer data={m.reportData} maxRows={20} />
                </div>
              )}
              {m.symbolReport && (
                <div className="mt-2 w-full">
                  <div className="max-h-80 overflow-auto rounded-lg border border-black/10 dark:border-white/10">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-[#f2f2f2] dark:bg-[#0a0a0a] text-black/50 dark:text-white/50">
                        <tr>
                          <th className="text-left font-medium uppercase tracking-wider px-3 py-2">Account</th>
                          <th className="text-left font-medium uppercase tracking-wider px-3 py-2">Holder</th>
                          <th className="text-left font-medium uppercase tracking-wider px-3 py-2">Household</th>
                          <th className="text-left font-medium uppercase tracking-wider px-3 py-2">Custodian</th>
                          <th className="text-right font-medium uppercase tracking-wider px-3 py-2">Shares</th>
                          <th className="text-right font-medium uppercase tracking-wider px-3 py-2">Market Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {m.symbolReport.rows.map((r, i) => (
                          <tr key={`${r.account_number}-${i}`} className="border-t border-black/5 dark:border-white/5">
                            <td className="px-3 py-1.5 font-mono whitespace-nowrap">{r.account_number}</td>
                            <td className="px-3 py-1.5 truncate max-w-[160px]">{r.client_name || r.account_name}</td>
                            <td className="px-3 py-1.5 truncate max-w-[160px]">{r.household_name || "—"}</td>
                            <td className="px-3 py-1.5 whitespace-nowrap">{r.custodian}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                              {r.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                              {formatCurrency(r.market_value)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* The table above is the transcript and stays. The download does
                      not: these prices are from when the report ran. */}
                  {m.restoredCard ? (
                    <div className="mt-1.5 text-[11px] text-black/40 dark:text-white/40">
                      {m.restoredCard.type === "symbolReport" && m.restoredCard.truncated
                        ? `Showing the first ${m.symbolReport.rows.length} of ${m.restoredCard.count.toLocaleString()} rows · re-run for the full report`
                        : "Prices as of when this ran · re-run for a current download"}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => downloadSymbolHoldings(m.symbolReport!)}
                      className="mt-1.5 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-black text-white dark:bg-white dark:text-black hover:opacity-80 transition-opacity"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                      </svg>
                      Download Excel
                    </button>
                  )}
                </div>
              )}
              {/* Report confirm-card. The sentences come from describeReport /
                  describeReportScope, so they match the Report Center row and the
                  builder drawer's preview word for word. */}
              {m.proposedReport && (
                <div className="mt-2 w-full max-w-[80%] rounded-xl border border-[#2D9CFF]/30 bg-[#2D9CFF]/[0.06] px-4 py-3">
                  <div className="text-sm font-semibold text-black dark:text-white">
                    {m.proposedReport.name}
                  </div>
                  <div className="mt-0.5 text-sm text-black/70 dark:text-white/70">
                    Pulls {m.proposedReport.describe}
                  </div>
                  <div className="mt-1 text-[11px] text-black/40 dark:text-white/40">
                    {m.proposedReport.describeWhere} · runs {m.proposedReport.describeWhen}
                  </div>
                  {/* What it comes back with right now. A report that returns nothing
                      and one that's well-aimed look identical once they're saved. */}
                  {m.proposedReport.preview && (
                    <div className="mt-2 pt-2 border-t border-[#2D9CFF]/20">
                      {describeReportPreview(m.proposedReport.preview) && (
                        <div className="text-[11px] font-medium text-black/60 dark:text-white/60">
                          {describeReportPreview(m.proposedReport.preview)}
                        </div>
                      )}
                      {m.proposedReport.preview.samples.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {m.proposedReport.preview.samples.map((row, i) => (
                            <li key={i} className="text-[11px] text-black/40 dark:text-white/40 truncate">
                              {Object.values(row)
                                .map((v) => (v === null || v === undefined ? "—" : String(v)))
                                .join(" · ")}
                            </li>
                          ))}
                        </ul>
                      )}
                      {m.proposedReport.preview.caveat && (
                        <div className="mt-1 text-[11px] text-[#B4690E] dark:text-[#E0A458]">
                          {m.proposedReport.preview.caveat}
                        </div>
                      )}
                    </div>
                  )}
                  {/* Reopened from History: the proposal is a record of what was
                      offered, not a live offer. Re-arming Save would let the user
                      create a second copy of a report they already saved. */}
                  {m.restoredCard && !m.reportSaved ? (
                    <div className="mt-2 text-[11px] text-black/40 dark:text-white/40">
                      Not saved · ask again to recreate this report
                    </div>
                  ) : !m.reportSaved ? (
                    <button
                      type="button"
                      onClick={() => saveProposedReport(m.id, m.proposedReport!)}
                      className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-black text-white dark:bg-white dark:text-black hover:opacity-80 transition-opacity"
                    >
                      Save report
                    </button>
                  ) : (
                    <a
                      href="/reports"
                      className="mt-2 inline-block text-xs font-medium text-[#1E7FE0] dark:text-[#5CB0FF] hover:underline"
                    >
                      Saved ✓ · View in Reports
                    </a>
                  )}
                </div>
              )}
              {/* Alert confirm-card — same treatment as the report card above, so the
                  two creation paths read as the same object. The sentences come from
                  describeCondition/describeScope, so they match the Alert Center row
                  and the builder drawer's preview word for word. */}
              {m.proposedAlert && (
                <div className="mt-2 w-full max-w-[80%] rounded-xl border border-[#2D9CFF]/30 bg-[#2D9CFF]/[0.06] px-4 py-3">
                  <div className="text-sm font-semibold text-black dark:text-white">
                    {m.proposedAlert.name}
                  </div>
                  <div className="mt-0.5 text-sm text-black/70 dark:text-white/70">
                    Alert me {m.proposedAlert.describe}
                  </div>
                  <div className="mt-1 text-[11px] text-black/40 dark:text-white/40">
                    {m.proposedAlert.describeWhere} · checked {m.proposedAlert.frequency}
                  </div>
                  {/* What it catches against live data right now. The point of showing
                      this before the Create button is that a rule can be perfectly
                      valid and still never fire — once it's saved, "0 matches" and
                      "can never match" look identical. */}
                  {m.proposedAlert.preview && (
                    <div className="mt-2 pt-2 border-t border-[#2D9CFF]/20">
                      {describePreview(m.proposedAlert.preview) && (
                        <div className="text-[11px] font-medium text-black/60 dark:text-white/60">
                          {describePreview(m.proposedAlert.preview)}
                        </div>
                      )}
                      {m.proposedAlert.preview.samples.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {m.proposedAlert.preview.samples.map((s, i) => (
                            <li key={i} className="text-[11px] text-black/40 dark:text-white/40">
                              {s.title}
                              {s.detail ? ` — ${s.detail}` : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                      {m.proposedAlert.preview.caveat && (
                        <div className="mt-1 text-[11px] text-[#B4690E] dark:text-[#E0A458]">
                          {m.proposedAlert.preview.caveat}
                        </div>
                      )}
                    </div>
                  )}
                  {/* Same reasoning as the report card above — a reopened proposal is
                      a record, not a live offer. */}
                  {m.restoredCard && !m.alertSaved ? (
                    <div className="mt-2 text-[11px] text-black/40 dark:text-white/40">
                      Not created · ask again to recreate this alert
                    </div>
                  ) : !m.alertSaved ? (
                    <button
                      type="button"
                      onClick={() => saveProposedAlert(m.id, m.proposedAlert!)}
                      className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-black text-white dark:bg-white dark:text-black hover:opacity-80 transition-opacity"
                    >
                      Create alert
                    </button>
                  ) : (
                    <a
                      href="/alerts"
                      className="mt-2 inline-block text-xs font-medium text-[#1E7FE0] dark:text-[#5CB0FF] hover:underline"
                    >
                      Created ✓ · View in Alerts
                    </a>
                  )}
                </div>
              )}
              <MessageMeta
                text={m.content}
                time={messageTime(m)}
                align={m.role === "user" ? "right" : "left"}
              />
            </div>
          ))}
          {isThinking && (
            <AgentThinking
              kind={
                createKind === "alert"
                  ? "alert"
                  : createKind === "report"
                    ? "report"
                    : createKind === "case"
                      ? "case"
                      : "workspace"
              }
            />
          )}
          <div ref={endRef} />
        </div>
      </div>
      <div className="px-6 pb-6">
        <div className="max-w-3xl mx-auto">{composerDocked}</div>
      </div>
    </div>
  );
}
