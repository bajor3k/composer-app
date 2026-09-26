// Saved custom report commands authored on the Reports page. Persisted to
// localStorage (custom commands are not in the DB schema for this prototype) and
// broadcast on change so open composers refresh live — mirrors the
// `composer:chat-settings-changed` pattern used by ChatPage.
import { REPORT_CATALOG } from "@/lib/report-registry";

const STORAGE_KEY = "composer-custom-commands";
const CHANGED_EVENT = "composer:custom-commands-changed";

// Shape is a superset of slash-commands' ChatMenuCommand AND SlashCommand so a
// saved command drops straight into either menu.
export interface CustomCommand {
  command: string;            // includes leading slash, e.g. "/villanueva-cash"
  label: string;
  category: string;           // always "Saved" for grouping
  description: string;
  message: string;            // NL message re-sent through /api/chat when run
  intent: string;             // bound catalog intent (provenance/debug)
  reportId: string;           // source REPORT_CATALOG id
  params: Record<string, unknown>;
  scope?: { accountNumber?: string; household?: string };
  createdAt: string;          // ISO
}

export function listCustomCommands(): CustomCommand[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = raw ? (JSON.parse(raw) as CustomCommand[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// Slugify a label into a unique, valid command (no leading slash returned bare;
// the stored `command` keeps the slash). Dedupes against catalog + saved names.
export function slugifyCommandName(label: string): string {
  const base =
    (label || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "report";
  const taken = new Set<string>([
    ...REPORT_CATALOG.map((r) => r.command.slice(1)),
    ...listCustomCommands().map((c) => c.command.slice(1)),
  ]);
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export function isNameTaken(commandWithSlash: string): boolean {
  const name = commandWithSlash.replace(/^\//, "").toLowerCase();
  const catalog = REPORT_CATALOG.some((r) => r.command.slice(1).toLowerCase() === name);
  const saved = listCustomCommands().some((c) => c.command.slice(1).toLowerCase() === name);
  return catalog || saved;
}

// Saves (or replaces by command name). Throws on duplicate of a DIFFERENT origin
// only via the caller's isNameTaken check; here we upsert by exact command.
export function saveCustomCommand(cmd: CustomCommand): void {
  if (typeof window === "undefined") return;
  const list = listCustomCommands().filter((c) => c.command.toLowerCase() !== cmd.command.toLowerCase());
  list.push(cmd);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
}

export function removeCustomCommand(commandWithSlash: string): void {
  if (typeof window === "undefined") return;
  const list = listCustomCommands().filter((c) => c.command !== commandWithSlash);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
}

// Subscribe to changes (same-tab custom event + cross-tab storage event).
export function onCustomCommandsChanged(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onCustom = () => cb();
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb();
  };
  window.addEventListener(CHANGED_EVENT, onCustom);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGED_EVENT, onCustom);
    window.removeEventListener("storage", onStorage);
  };
}
