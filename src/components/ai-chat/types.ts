export interface ChatAttachment {
  name: string;
  type: string;
  size: number;
  content: string; // base64 encoded content
}

// A "smart reference" to something the user pointed at on an open page via the
// element picker (PageDrawer inspect tool). Captures semantic detail — not raw
// HTML — so the Composer agent can map it to real account data it can query.
export interface ChatReference {
  id: string;
  kind: "element"; // future: "account" | "holding" | …
  label: string; // primary display label, e.g. "Market Value" or "Apple Inc. (AAPL)"
  pageName: string; // e.g. "Portfolio"
  pageHref: string; // e.g. "/accounts/portfolio"
  accountNumber?: string; // active account on the page, if known
  accountName?: string;
  elementRole?: string; // "column header" | "table cell" | "heading" | "text" | …
  tagName: string;
  text?: string; // trimmed innerText of the element (~200 chars)
  context?: string; // e.g. "Column: Market Value" or nearby section heading (~200 chars)
  selector?: string; // best-effort stable selector (future use)
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
  references?: ChatReference[];
  data?: Record<string, unknown>[] | Record<string, unknown> | null;
  pdfReport?: Record<string, unknown> | null;
  agent?: string;
  hidden?: boolean;
  system?: boolean;
  timestamp: string;
}

export type ReportData = Record<string, unknown>[] | Record<string, unknown> | null;

export interface ChatContextType {
  messages: ChatMessage[];
  isLoading: boolean;
  sendMessage: (content: string, attachments?: ChatAttachment[]) => Promise<void>;
  /**
   * Runs a catalog report directly against its registry intent — no model involved.
   * Used by slash commands, which already know their own intent and params.
   */
  runReport: (reportId: string, params?: Record<string, unknown>, label?: string) => Promise<void>;
  addMessage: (message: ChatMessage) => void;
  removeMessage: (id: string) => void;
  clearMessages: () => void;
  // Element picker references (staged before send)
  pendingReferences: ChatReference[];
  attachReference: (ref: ChatReference) => void;
  removeReference: (id: string) => void;
  clearReferences: () => void;
  // Canvas mode
  canvasPage: string | null;
  canvasPageName: string | null;
  canvasAccountNumber: string | null;
  canvasAccountName: string | null;
  openCanvas: (href: string, name: string) => void;
  closeCanvas: () => void;
  switchCanvasPage: (href: string, name: string) => void;
}
