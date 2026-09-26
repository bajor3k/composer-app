// Shared slash-command definitions for the AI chat composers.
//
// Two composers consume this:
//   • AiChatInput (canvas/studio panel) — uses CHAT_MESSAGES + SLASH_COMMANDS.
//   • ChatPage (main /chat workspace)   — uses CHAT_MENU_COMMANDS for its dropdown.
//
// Single source of truth so the two never drift. Registry ("composer-agent") commands send
// a natural-language message to the Composer agent; "action" commands run a direct handler in
// the page (Excel export / in-chat table) and never hit /api/chat.

import { REPORT_CATALOG, type ReportParam } from "@/lib/report-registry";
import { listCustomCommands } from "@/lib/custom-commands";

export type SlashCommand = {
  command: string;
  label: string;
  category: string;
  description: string;
  message: string;
  needsInput?: boolean;
  inputPlaceholder?: string;
  /**
   * Catalog id. Present on registry commands, absent on saved custom ones that were
   * built from free text. When present the command executes directly against its
   * registry intent via /api/reports; `message` is only a fallback for the rest.
   */
  reportId?: string;
  /** Params the catalog declares for this report, rendered as inline inputs. */
  params?: ReportParam[];
};

// Registry command id → the natural-language prompt sent to the Composer agent. Commands whose
// id is absent fall back to their catalog description.
export const CHAT_MESSAGES: Record<string, string> = {
  accounts: "Show me all accounts",
  trusts: "Show me all trust accounts",
  iras: "Show me all IRA accounts",
  contributions: "Which IRA accounts haven't maxed out their contributions?",
  "top-holdings": "Show me the top 20 holdings by market value",
  holding: "Which accounts hold ",
  cash: "Show me accounts ranked by cash percentage",
  trades: "I want to pull recent trades. Please ask me what timeframe I want.",
  dividends: "I want to pull recent dividend transactions. Please ask me what timeframe I want.",
  "trade-counts": "Show me accounts ranked by number of trades",
  transfers: "Show me pending transfers",
  fees: "Show me accounts with the highest advisory fees",
  applications: "Show me new account applications",
  concentration: "Which accounts have the most concentration risk?",
  "low-cash": "Which accounts have less than 2% cash?",
  "margin-check": "Run a margin check on ",
  "1099-review": "Run a 1099 reconciliation review on ",
  "cost-basis": "Run a cost basis audit on ",
  "wash-sales": "Check for potential wash sales on ",
  "fee-review": "Run a fee review on ",
  "cash-drag": "Analyze cash drag on ",
  "div-summary": "Show me a dividend summary for ",
  recap: "Give me a daily recap",
  pending: "What needs my attention?",
};

// Registry-derived slash commands. These execute directly against their declared
// intent — `message` survives only as a fallback for composers that still send text.
export const SLASH_COMMANDS: SlashCommand[] = REPORT_CATALOG.map((r) => ({
  command: r.command,
  label: r.label,
  category: r.category,
  description: r.description,
  message: CHAT_MESSAGES[r.id] ?? r.description,
  needsInput: r.params && r.params.length > 0 ? true : undefined,
  inputPlaceholder: r.params?.[0]?.placeholder,
  reportId: r.id,
  params: r.params,
}));

// ── Main /chat composer menu ────────────────────────────────────
// The main workspace chat exposes only its three direct-action commands. (The
// report catalog above still powers the canvas/studio chat and the Reports page.)
export interface ChatMenuCommand {
  command: string;
  label: string;
  description: string;
}

export const CHAT_MENU_COMMANDS: ChatMenuCommand[] = [
  { command: "/NVDA", label: "NVDA Holders", description: "Accounts holding NVDA" },
  { command: "/holdings", label: "Holdings", description: "Export account holdings" },
  { command: "/transactions", label: "Transactions", description: "Export account transactions" },
];

// Saved custom commands, shaped for the main /chat menu. Read live each call so a
// newly-saved command shows up without a remount.
function customMenuCommands(): ChatMenuCommand[] {
  return listCustomCommands().map((c) => ({
    command: c.command,
    label: c.label,
    description: c.description,
  }));
}

export function filterChatMenuCommands(query: string): ChatMenuCommand[] {
  const all = [...CHAT_MENU_COMMANDS, ...customMenuCommands()];
  const q = query.trim().toLowerCase();
  if (!q) return all;
  return all.filter(
    (c) => c.command.slice(1).toLowerCase().includes(q) || c.label.toLowerCase().includes(q),
  );
}
