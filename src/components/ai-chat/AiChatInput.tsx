"use client";

import { useState, useRef, useEffect } from "react";
import { type ChatAttachment } from "./types";
import { REPORT_CATEGORIES, type ReportParam } from "@/lib/report-registry";
import { type SlashCommand, SLASH_COMMANDS } from "@/lib/slash-commands";
import { listCustomCommands } from "@/lib/custom-commands";
import { useChat } from "./AiChatContext";
import { CANVAS_PAGES } from "@/lib/canvas-pages";
import { AGENTS, type AgentDef } from "@/lib/ai/agents/agent-menu";

interface AiChatInputProps {
  onSend: (message: string, attachments?: ChatAttachment[]) => void;
  disabled?: boolean;
}

const ALLOWED_TYPES = [
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png",
  "image/jpeg",
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// ── Slash Commands (shared definitions — see src/lib/slash-commands.ts) ──

const CATEGORIES = [...REPORT_CATEGORIES];

// ── Agents: shared definitions imported from src/lib/ai/agents/agent-menu.ts ──

// ── Command Prompts ─────────────────────────────────────────────

type CommandPrompt = {
  title: string;
  options: { label: string; action: "send" | "ask-input"; message: string; inputPrompt?: string }[];
};

const COMMAND_PROMPTS: Record<string, CommandPrompt> = {
  "/accounts": {
    title: "Accounts Report",
    options: [
      { label: "All Accounts", action: "send", message: "Show me all accounts" },
      { label: "Specific Rep Code", action: "send", message: "I want to filter accounts by rep code. Which rep code should I pull? Please ask me which rep code I want." },
    ],
  },
  "/contributions": {
    title: "IRA Contributions",
    options: [
      { label: "All Accounts", action: "send", message: "Which IRA accounts haven't maxed out their contributions?" },
      { label: "Specific Rep Code", action: "send", message: "I want to check IRA contribution status filtered by rep code. Which rep code should I pull? Please ask me which rep code I want." },
    ],
  },
  "/trade-counts": {
    title: "Trade Volume",
    options: [
      { label: "All Accounts", action: "send", message: "I want to see accounts ranked by number of trades. Please ask me what timeframe I want." },
      { label: "Specific Rep Code", action: "send", message: "I want to see trade counts for a specific rep code. Please ask me which rep code I want, and then ask me what timeframe I want." },
    ],
  },
};

// ── Component ───────────────────────────────────────────────────

function AttachmentCard({ file, onRemove }: { file: File; onRemove: () => void }) {
  const isImage = file.type.startsWith("image/");
  const ext = file.name.split(".").pop()?.toUpperCase() ?? "FILE";
  const baseName = file.name.replace(/\.[^.]+$/, "");
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);

  const extColors: Record<string, string> = {
    PDF: "text-red-500", DOCX: "text-blue-500", DOC: "text-blue-500",
    XLSX: "text-emerald-600", XLS: "text-emerald-600", CSV: "text-emerald-500",
    TXT: "text-black/40 dark:text-white/40",
  };
  const extColor = extColors[ext] ?? "text-black/40 dark:text-white/40";

  return (
    <div className="relative group flex items-center gap-2.5 pl-2 pr-7 py-2 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] max-w-[200px]">
      {isImage && preview ? (
        <img src={preview} alt={file.name} className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
      ) : (
        <span className={`text-[11px] font-black tracking-tight flex-shrink-0 w-8 text-center ${extColor}`}>{ext}</span>
      )}
      <div className="min-w-0">
        <p className="text-xs font-medium text-black dark:text-white truncate leading-tight">{baseName}</p>
        <p className="text-[10px] text-black/35 dark:text-white/35 leading-tight uppercase tracking-wide">{ext}</p>
      </div>
      <button
        onClick={onRemove}
        className="absolute top-1 right-1.5 text-black/25 dark:text-white/25 hover:text-black dark:hover:text-white text-sm leading-none transition-colors"
      >
        ×
      </button>
    </div>
  );
}

export default function AiChatInput({ onSend, disabled }: AiChatInputProps) {
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [plusOpen, setPlusOpen] = useState(false);
  const [studioSubmenuOpen, setStudioSubmenuOpen] = useState(false);
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [activePrompt, setActivePrompt] = useState<{ command: string; prompt: CommandPrompt } | null>(null);
  // Inline param form for catalog commands that declare inputs (e.g. /trades wants
  // a date range). Replaces prefilling the composer with a sentence asking for them.
  const [reportForm, setReportForm] = useState<{
    reportId: string;
    label: string;
    params: ReportParam[];
    values: Record<string, string>;
  } | null>(null);
  const [activeModes, setActiveModes] = useState<Set<string>>(new Set());
  const [menuMaxH, setMenuMaxH] = useState(400);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const plusRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const agentMenuRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { switchCanvasPage, runReport } = useChat();

  const canSend = (message.trim() || attachments.length > 0) && !disabled;

  const customSlashCommands: SlashCommand[] = listCustomCommands().map((c) => ({
    command: c.command,
    label: c.label,
    category: c.category,
    description: c.description,
    message: c.message,
  }));
  const ALL_SLASH_COMMANDS = [...SLASH_COMMANDS, ...customSlashCommands];
  const ALL_CATEGORIES = [
    ...CATEGORIES,
    ...(customSlashCommands.length > 0 ? ["Saved"] : []),
  ];

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
    }
  }, [message]);

  // Refocus textarea when loading finishes
  useEffect(() => {
    if (!disabled && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [disabled]);

  // Compute available space above input
  useEffect(() => {
    if (!commandMenuOpen && !agentMenuOpen && !activePrompt) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMenuMaxH(Math.max(200, rect.top - 16));
  }, [commandMenuOpen, agentMenuOpen, activePrompt]);

  // Click-outside for plus menu
  useEffect(() => {
    if (!plusOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (plusRef.current && !plusRef.current.contains(e.target as Node)) {
        setPlusOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [plusOpen]);

  // Click-outside for command/agent menus
  useEffect(() => {
    if (!commandMenuOpen && !agentMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (commandMenuOpen && menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setCommandMenuOpen(false);
      }
      if (agentMenuOpen && agentMenuRef.current && !agentMenuRef.current.contains(e.target as Node)) {
        setAgentMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [commandMenuOpen, agentMenuOpen]);

  // Escape key to close menus
  useEffect(() => {
    if (!commandMenuOpen && !agentMenuOpen && !activePrompt) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCommandMenuOpen(false);
        setAgentMenuOpen(false);
        setActivePrompt(null);
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [commandMenuOpen, agentMenuOpen, activePrompt]);

  // Slash command filtering
  const slashFilter = message.startsWith("/") && commandMenuOpen ? message.slice(1).toLowerCase() : "";
  const filteredCommands = slashFilter
    ? ALL_SLASH_COMMANDS.filter(
        (c) =>
          c.command.slice(1).toLowerCase().includes(slashFilter) ||
          c.label.toLowerCase().includes(slashFilter) ||
          c.description.toLowerCase().includes(slashFilter)
      )
    : ALL_SLASH_COMMANDS;

  // Agent menu filtering
  const atFilter = message.startsWith("@") && agentMenuOpen ? message.slice(1).split(/\s/)[0].toLowerCase() : "";
  const filteredAgents = atFilter
    ? AGENTS.filter(
        (a) =>
          a.name.includes(atFilter) ||
          a.label.toLowerCase().includes(atFilter) ||
          a.description.toLowerCase().includes(atFilter)
      )
    : AGENTS;

  const handleCommandSelect = (cmd: SlashCommand) => {
    setCommandMenuOpen(false);
    setMessage("");

    // Registry commands know their own intent and params, so they run directly
    // against /api/reports. Only commands with declared params need input first,
    // and those get typed fields rather than a prefilled sentence.
    if (cmd.reportId) {
      if (cmd.params && cmd.params.length > 0) {
        setReportForm({ reportId: cmd.reportId, label: cmd.label, params: cmd.params, values: {} });
        return;
      }
      void runReport(cmd.reportId, undefined, cmd.label);
      return;
    }

    // Saved custom commands built from free text still go through the composer.
    const prompt = COMMAND_PROMPTS[cmd.command];
    if (prompt) {
      setActivePrompt({ command: cmd.command, prompt });
      return;
    }
    if (cmd.needsInput) {
      setMessage(cmd.message);
      setTimeout(() => {
        const ta = textareaRef.current;
        if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; }
      }, 0);
    } else {
      onSend(cmd.message);
    }
  };

  const submitReportForm = () => {
    if (!reportForm) return;
    const missing = reportForm.params.filter((p) => p.required && !reportForm.values[p.key]?.trim());
    if (missing.length > 0) return;
    const form = reportForm;
    setReportForm(null);
    void runReport(form.reportId, form.values, form.label);
  };

  const handleAgentSelect = (agent: AgentDef) => {
    setAgentMenuOpen(false);
    if (agent.name === "help" || agent.name === "crm") {
      setMessage("");
      onSend(`@${agent.name}`);
      return;
    }
    setMessage(`@${agent.name} `);
    setTimeout(() => {
      const ta = textareaRef.current;
      if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; }
    }, 0);
  };

  const handlePromptOption = (option: CommandPrompt["options"][number]) => {
    setActivePrompt(null);
    if (option.action === "send") {
      onSend(option.message);
    } else if (option.action === "ask-input") {
      setMessage(option.message);
      setTimeout(() => {
        const ta = textareaRef.current;
        if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; }
      }, 0);
    }
  };

  const handleInputChange = (val: string) => {
    setMessage(val);
    if (val.startsWith("/")) {
      setCommandMenuOpen(true);
      setAgentMenuOpen(false);
    } else if (val.startsWith("@") && !val.includes(" ")) {
      setAgentMenuOpen(true);
      setCommandMenuOpen(false);
    } else {
      if (commandMenuOpen) setCommandMenuOpen(false);
      if (agentMenuOpen) setAgentMenuOpen(false);
    }
  };

  const handleSend = () => {
    if (!canSend) return;
    // Convert File[] to ChatAttachment[] for onSend
    if (attachments.length > 0) {
      Promise.all(
        attachments.map(
          (file) =>
            new Promise<ChatAttachment>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => {
                const result = reader.result as string;
                const base64 = result.split(",")[1];
                resolve({ name: file.name, type: file.type, size: file.size, content: base64 });
              };
              reader.readAsDataURL(file);
            })
        )
      ).then((chatAttachments) => {
        onSend(message.trim(), chatAttachments);
        setMessage("");
        setAttachments([]);
        if (textareaRef.current) { textareaRef.current.style.height = "auto"; textareaRef.current.focus(); }
      });
    } else {
      onSend(message.trim());
      setMessage("");
      if (textareaRef.current) { textareaRef.current.style.height = "auto"; textareaRef.current.focus(); }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (commandMenuOpen && message.startsWith("/") && filteredCommands.length > 0) {
        handleCommandSelect(filteredCommands[0]);
        return;
      }
      if (agentMenuOpen && message.startsWith("@") && filteredAgents.length > 0) {
        handleAgentSelect(filteredAgents[0]);
        return;
      }
      handleSend();
    }
  };

  const handleMenuAction = (action: string) => {
    setPlusOpen(false);
    if (action === "files") {
      fileInputRef.current?.click();
    }
  };

  const toggleMode = (mode: string) => {
    setActiveModes((prev) => {
      const next = new Set(prev);
      next.has(mode) ? next.delete(mode) : next.add(mode);
      return next;
    });
  };

  return (
    <div className="px-4 pb-4 pt-2">
      <div ref={containerRef} className="chat-composer relative rounded-2xl border border-black/10 dark:border-white/10 bg-sidebar dark:bg-sidebar-dark medium:bg-[#c2c2c2] shadow-sm">
        {/* Inline params for a catalog report — typed inputs instead of asking in chat */}
        {reportForm && (
          <div className="absolute bottom-full left-0 right-0 mb-2 bg-white dark:bg-black border border-black/10 dark:border-white/10 rounded-xl shadow-lg overflow-hidden z-50">
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-black dark:text-white">
                  {reportForm.label}
                </span>
                <button
                  onClick={() => setReportForm(null)}
                  className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                >
                  <CloseIcon className="w-3.5 h-3.5 text-black/40 dark:text-white/40" />
                </button>
              </div>
              <div className="space-y-2.5">
                {reportForm.params.map((p) => (
                  <label key={p.key} className="block">
                    <span className="block mb-1 text-[11px] text-black/50 dark:text-white/50">
                      {p.label}
                      {p.required && <span className="text-accent"> *</span>}
                    </span>
                    {p.type === "select" ? (
                      <select
                        value={reportForm.values[p.key] ?? ""}
                        onChange={(e) =>
                          setReportForm({ ...reportForm, values: { ...reportForm.values, [p.key]: e.target.value } })
                        }
                        className="w-full px-3 py-2 rounded-lg text-sm bg-black/5 dark:bg-white/5 text-black dark:text-white outline-none"
                      >
                        <option value="">Select…</option>
                        {(p.options ?? []).map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={p.type === "date" ? "date" : "text"}
                        value={reportForm.values[p.key] ?? ""}
                        placeholder={p.placeholder}
                        autoFocus={p === reportForm.params[0]}
                        onChange={(e) =>
                          setReportForm({ ...reportForm, values: { ...reportForm.values, [p.key]: e.target.value } })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); submitReportForm(); }
                          if (e.key === "Escape") setReportForm(null);
                        }}
                        className="w-full px-3 py-2 rounded-lg text-sm bg-black/5 dark:bg-white/5 text-black dark:text-white placeholder-black/30 dark:placeholder-white/30 outline-none"
                      />
                    )}
                  </label>
                ))}
                <button
                  onClick={submitReportForm}
                  disabled={reportForm.params.some((p) => p.required && !reportForm.values[p.key]?.trim())}
                  className="w-full px-4 py-2.5 rounded-lg text-sm font-medium transition-colors bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed text-black dark:text-white"
                >
                  Run report
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Command Prompt Overlay */}
        {activePrompt && (
          <div className="absolute bottom-full left-0 right-0 mb-2 bg-white dark:bg-black border border-black/10 dark:border-white/10 rounded-xl shadow-lg overflow-hidden z-50">
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-black dark:text-white">
                  {activePrompt.prompt.title}
                </span>
                <button
                  onClick={() => setActivePrompt(null)}
                  className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                >
                  <CloseIcon className="w-3.5 h-3.5 text-black/40 dark:text-white/40" />
                </button>
              </div>
              <div className="flex gap-2">
                {activePrompt.prompt.options.map((option) => (
                  <button
                    key={option.label}
                    onClick={() => handlePromptOption(option)}
                    className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-black dark:text-white"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Slash Command Menu */}
        {commandMenuOpen && (
          <div
            ref={menuRef}
            className="absolute bottom-full left-0 right-0 mb-2 bg-white dark:bg-black border border-black/10 dark:border-white/10 rounded-xl shadow-lg overflow-hidden z-50"
          >
            <div className="overflow-y-auto py-2" style={{ maxHeight: menuMaxH }}>
              {filteredCommands.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-black/40 dark:text-white/40">
                  No commands match &ldquo;{message}&rdquo;
                </div>
              ) : (
                ALL_CATEGORIES.map((category) => {
                  const cmds = filteredCommands.filter((c) => c.category === category);
                  if (cmds.length === 0) return null;
                  return (
                    <div key={category}>
                      <div className="px-4 pt-3 pb-1.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-black dark:text-white">
                          {category}
                        </span>
                      </div>
                      {cmds.map((cmd) => (
                        <button
                          key={cmd.command}
                          onClick={() => handleCommandSelect(cmd)}
                          className="w-full flex items-center gap-3 px-4 py-2 hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-left"
                        >
                          <span className="text-xs font-mono font-medium text-accent w-[110px] flex-shrink-0 truncate">
                            {cmd.command}
                          </span>
                          <span className="text-sm text-black/60 dark:text-white/60 truncate">
                            {cmd.description}
                          </span>
                        </button>
                      ))}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Agent Menu */}
        {agentMenuOpen && (
          <div
            ref={agentMenuRef}
            className="absolute bottom-full left-0 right-0 mb-2 bg-white dark:bg-black border border-black/10 dark:border-white/10 rounded-xl shadow-lg overflow-hidden z-50"
          >
            <div className="overflow-y-auto py-2" style={{ maxHeight: Math.min(320, menuMaxH) }}>
              <div className="px-4 pt-2 pb-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-black dark:text-white">
                  Agents
                </span>
              </div>
              {filteredAgents.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-black/40 dark:text-white/40">
                  No agents match &ldquo;{message}&rdquo;
                </div>
              ) : (
                filteredAgents.map((agent) => (
                  <button
                    key={agent.name}
                    onClick={() => handleAgentSelect(agent)}
                    className="w-full flex items-center gap-3 px-4 py-2 hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-left"
                  >
                    <span className="text-xs font-mono font-medium text-accent w-[80px] flex-shrink-0">
                      @{agent.name}
                    </span>
                    <span className="text-sm text-black/60 dark:text-white/60 truncate">
                      {agent.description}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* Attachment chips */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pt-3">
            {attachments.map((file, i) => (
              <AttachmentCard key={i} file={file} onRemove={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} />
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Chat with the Composer agent"
          rows={1}
          disabled={disabled}
          className="w-full bg-transparent px-5 pt-4 pb-2 text-sm text-black dark:text-white placeholder-black/30 dark:placeholder-white/30 outline-none resize-none disabled:opacity-50"
        />

        <div className="flex items-center justify-between px-4 pb-3">
          <div className="flex items-center gap-1.5">
            {/* Plus button with dropdown */}
            <div className="relative" ref={plusRef}>
              <button
                onClick={() => setPlusOpen((o) => !o)}
                className="p-1.5 rounded-lg text-black/30 dark:text-white/30 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              >
                <PlusIcon className="w-5 h-5" />
              </button>
              {plusOpen && (
                <div className="absolute left-0 bottom-full mb-2 z-20 w-44 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#1a1a1a] shadow-lg py-1">
                  {/* Studio with hover flyout submenu */}
                  <div
                    className="relative"
                    onMouseEnter={() => setStudioSubmenuOpen(true)}
                    onMouseLeave={() => setStudioSubmenuOpen(false)}
                  >
                    <div className="w-full text-left px-3 py-2 text-sm text-black dark:text-white hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2.5 cursor-default">
                      <svg className="w-4 h-4 flex-shrink-0 text-black/50 dark:text-white/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                      </svg>
                      <span className="flex-1">Studio</span>
                      <svg className="w-3 h-3 text-black/30 dark:text-white/30" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                      </svg>
                    </div>
                    {studioSubmenuOpen && (
                      <div className="absolute left-full -top-1 pl-1 w-[calc(12rem+4px)] z-30">
                        <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#1a1a1a] shadow-lg py-1 max-h-[40vh] overflow-y-auto">
                          {CANVAS_PAGES.map((page) => (
                            <button
                              key={page.href}
                              onClick={() => {
                                setPlusOpen(false);
                                setStudioSubmenuOpen(false);
                                switchCanvasPage(page.href, page.name);
                              }}
                              className="w-full text-left px-3 py-1.5 text-sm text-black/70 dark:text-white/70 hover:bg-black/5 dark:hover:bg-white/5 hover:text-black dark:hover:text-white transition-colors"
                            >
                              {page.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  {/* "Web search" was removed with the previous AI provider — it relied on
                      that provider's search grounding, which has no Azure equivalent. Analysis
                      and Research were never wired to anything either; they set activeModes
                      and stop there. */}
                  {[
                    { mode: "analysis", label: "Analysis", Icon: ChartIcon },
                    { mode: "research", label: "Research", Icon: BookIcon },
                  ].map(({ mode, label, Icon }) => (
                    <button
                      key={mode}
                      onClick={(e) => { e.stopPropagation(); toggleMode(mode); }}
                      className="w-full text-left px-3 py-2 text-sm text-black dark:text-white hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2.5"
                    >
                      <Icon className="w-4 h-4 flex-shrink-0 text-black/50 dark:text-white/50" />
                      <span className="flex-1">{label}</span>
                      <div className={`relative w-8 h-[18px] rounded-full transition-colors ${activeModes.has(mode) ? "bg-black dark:bg-white" : "bg-black/15 dark:bg-white/15"}`}>
                        <div className={`absolute top-[2px] w-[14px] h-[14px] rounded-full transition-all ${activeModes.has(mode) ? "left-[15px] bg-white dark:bg-black" : "left-[2px] bg-white dark:bg-black"}`} />
                      </div>
                    </button>
                  ))}
                  <button onClick={() => handleMenuAction("files")} className="w-full text-left px-3 py-2 text-sm text-black dark:text-white hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2.5">
                    <PaperclipIcon className="w-4 h-4 flex-shrink-0 text-black/50 dark:text-white/50" />
                    Add files or photos
                  </button>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.doc,.docx,.txt,.csv,.xlsx"
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                const validFiles = files.filter((f) => {
                  if (!ALLOWED_TYPES.includes(f.type)) {
                    alert(`File type not supported: ${f.name}`);
                    return false;
                  }
                  if (f.size > MAX_FILE_SIZE) {
                    alert(`File too large (max 10MB): ${f.name}`);
                    return false;
                  }
                  return true;
                });
                if (validFiles.length) setAttachments((prev) => [...prev, ...validFiles]);
              }}
            />
            {Array.from(activeModes).map((mode) => {
              const config = { web: { label: "Web", Icon: GlobeIcon }, analysis: { label: "Analysis", Icon: ChartIcon }, research: { label: "Research", Icon: BookIcon } }[mode];
              if (!config) return null;
              const { label, Icon } = config;
              return (
                <button
                  key={mode}
                  onClick={() => toggleMode(mode)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/10 text-[11px] text-black/70 dark:text-white/70 hover:bg-black/10 dark:hover:bg-white/15 transition-colors"
                >
                  <Icon className="w-3 h-3" />
                  <span>{label}</span>
                  <span className="text-black/40 dark:text-white/40 ml-0.5">×</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSend}
              disabled={!canSend}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-all disabled:cursor-not-allowed ${canSend ? "bg-black dark:bg-white" : "bg-black/10 dark:bg-white/10 opacity-30"}`}
            >
              <ArrowUpIcon className={`w-4 h-4 ${canSend ? "text-white dark:text-black" : "text-black dark:text-white"}`} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Icons ───────────────────────────────────────────────────────

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function ArrowUpIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
    </svg>
  );
}

function PaperclipIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5a17.92 17.92 0 01-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
    </svg>
  );
}

function ChartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  );
}

function BookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
    </svg>
  );
}
