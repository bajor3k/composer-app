// Durable chat history — row types and the Msg ⇄ DB mapping.
//
// Kept in one file on purpose: the chat page's `Msg` type (src/app/chat/page.tsx) and the
// conversation_messages table drift apart the moment the mapping is spread across the
// page, the API routes and the hook. Everything here is pure, so it is safe to import
// from both client components and route handlers.

import type { ChatReference } from "@/components/ai-chat/types";

export interface ConversationRow {
  id: string;
  title: string;
  kind: ConversationKind;
  pinned: boolean;
  account_number: string | null;
  account_name: string | null;
  household_name: string | null;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessageRow {
  id: string;
  conversation_id: string;
  seq: number;
  role: "user" | "assistant";
  content: string;
  refs: ChatReference[] | null;
  card: StoredCard | null;
  created_at: string;
}

export const CONVERSATION_KINDS = ["chat", "alert", "report"] as const;
export type ConversationKind = (typeof CONVERSATION_KINDS)[number];

export function isConversationKind(value: unknown): value is ConversationKind {
  return typeof value === "string" && (CONVERSATION_KINDS as readonly string[]).includes(value);
}

/** Titles render in the sidebar; matches the cap the placeholder implementation used. */
export const TITLE_MAX = 80;

export function normalizeTitle(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().slice(0, TITLE_MAX) : "";
}

// ── Stored cards ─────────────────────────────────────────────────────────────
//
// A `Msg` can carry one of several rich payloads that drive interactive UI. They are
// mutually exclusive, so they collapse into a single discriminated union stored in one
// jsonb column — adding a variant does not need a migration.
//
// Restored cards are INERT. Two of them deliberately lose their action:
//
//   - `export` keeps a label and a count, not the rows. HoldingsExportResult /
//     TransactionsExportResult do carry rows (the download is regenerated from them by
//     exportToExcel, not stored as a file), so re-arming the chip would be technically
//     possible. It would also be wrong: those rows are a price snapshot from the day the
//     export ran, and handing someone stale prices in a fresh-looking spreadsheet is worse
//     than not offering the download at all.
//
//   - `proposedReport` / `proposedAlert` restore with `saved` frozen. A live confirm-card
//     would let the user create a second alert from a proposal they already accepted.
//
// Tables (`reportData`, `symbolReport`) DO keep their rows: displaying what was said is
// the point of a transcript. They render read-only, without a download button.

/** Guards a single jsonb column against a runaway book-wide report. */
export const MAX_STORED_ROWS = 200;

export type StoredCard =
  | { type: "reportData"; rows: unknown; truncated?: boolean }
  | { type: "symbolReport"; symbol: string; title: string; columns: string[]; rows: unknown[]; count: number; totalMarketValue: number; truncated?: boolean }
  | { type: "proposedReport"; data: unknown; saved: boolean }
  | { type: "proposedAlert"; data: unknown; saved: boolean }
  | { type: "export"; exportKind: "holdings" | "transactions"; title: string; count: number; accountNumber: string; timeframeLabel?: string };

function capRows<T>(rows: T[]): { rows: T[]; truncated?: boolean } {
  return rows.length > MAX_STORED_ROWS
    ? { rows: rows.slice(0, MAX_STORED_ROWS), truncated: true }
    : { rows };
}

/**
 * The subset of the chat page's `Msg` this module needs. Declared structurally rather
 * than imported so `src/app/chat/page.tsx` (a "use client" page) is not pulled into
 * route-handler bundles.
 */
export interface CardBearingMessage {
  holdingsExport?: { rows: Record<string, unknown>[]; columns: string[]; title: string; count: number; accountNumber: string };
  txnExport?: { rows: Record<string, unknown>[]; columns: string[]; title: string; count: number; accountNumber: string; timeframeLabel: string };
  symbolReport?: { rows: unknown[]; columns: string[]; title: string; symbol: string; count: number; totalMarketValue: number };
  proposedReport?: unknown;
  reportSaved?: boolean;
  proposedAlert?: unknown;
  alertSaved?: boolean;
  reportData?: unknown;
}

/** Msg → jsonb. Returns null when the message carries no card. */
export function toStoredCard(msg: CardBearingMessage): StoredCard | null {
  if (msg.holdingsExport) {
    const e = msg.holdingsExport;
    return { type: "export", exportKind: "holdings", title: e.title, count: e.count, accountNumber: e.accountNumber };
  }
  if (msg.txnExport) {
    const e = msg.txnExport;
    return {
      type: "export",
      exportKind: "transactions",
      title: e.title,
      count: e.count,
      accountNumber: e.accountNumber,
      timeframeLabel: e.timeframeLabel,
    };
  }
  if (msg.symbolReport) {
    const r = msg.symbolReport;
    const { rows, truncated } = capRows(r.rows);
    return {
      type: "symbolReport",
      symbol: r.symbol,
      title: r.title,
      columns: r.columns,
      rows,
      count: r.count,
      totalMarketValue: r.totalMarketValue,
      truncated,
    };
  }
  if (msg.proposedReport) {
    return { type: "proposedReport", data: msg.proposedReport, saved: msg.reportSaved === true };
  }
  if (msg.proposedAlert) {
    return { type: "proposedAlert", data: msg.proposedAlert, saved: msg.alertSaved === true };
  }
  if (msg.reportData) {
    if (Array.isArray(msg.reportData)) {
      const { rows, truncated } = capRows(msg.reportData as unknown[]);
      return { type: "reportData", rows, truncated };
    }
    return { type: "reportData", rows: msg.reportData };
  }
  return null;
}

/**
 * jsonb → the Msg fields to spread back onto a restored message.
 *
 * `restoredCard` is what marks a message as historical; the chat page reads it to render
 * the card without its action. Export cards intentionally do NOT come back as
 * holdingsExport/txnExport — those props drive a live download chip.
 */
export interface RestoredCardFields {
  symbolReport?: unknown;
  proposedReport?: unknown;
  reportSaved?: boolean;
  proposedAlert?: unknown;
  alertSaved?: boolean;
  reportData?: unknown;
  restoredCard?: StoredCard;
}

export function fromStoredCard(card: StoredCard | null): RestoredCardFields {
  if (!card) return {};
  switch (card.type) {
    case "symbolReport":
      return {
        restoredCard: card,
        symbolReport: {
          rows: card.rows,
          columns: card.columns,
          title: card.title,
          symbol: card.symbol,
          count: card.count,
          totalMarketValue: card.totalMarketValue,
        },
      };
    case "proposedReport":
      return { restoredCard: card, proposedReport: card.data, reportSaved: card.saved };
    case "proposedAlert":
      return { restoredCard: card, proposedAlert: card.data, alertSaved: card.saved };
    case "reportData":
      return { restoredCard: card, reportData: card.rows as RestoredCardFields["reportData"] };
    case "export":
      // No live chip — the chat page renders this from restoredCard alone.
      return { restoredCard: card };
    default:
      return {};
  }
}
