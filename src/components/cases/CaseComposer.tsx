"use client";

import { useRef, useState } from "react";
import { AGENTS, AGENT_DISPLAY_NAMES } from "@/lib/ai/agents/agent-menu";

// Case composer: the ChatPage composer-card chrome with the pieces a shared
// case needs — @agent mention menu, direct document upload via "+", Enter to
// send. Deliberately not ChatPage's inline composer (that one is entangled
// with slash-commands and report modes).

const FILE_ACCEPT = ".pdf,.txt,.csv,.docx,.xlsx,.png,.jpg,.jpeg";

const COMPOSER_CARD =
  "chat-composer rounded-2xl border border-black/10 dark:border-white/10 bg-sidebar dark:bg-sidebar-dark medium:bg-[#c2c2c2] shadow-sm";

interface CaseComposerProps {
  onSend: (content: string) => Promise<void>;
  onUpload: (files: File[]) => Promise<void>;
  selectedAgent: string | null;
}

export default function CaseComposer({ onSend, onUpload, selectedAgent }: CaseComposerProps) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Same heuristic as the side-panel composer: the menu is open while the
  // message is a single leading @token (no space yet).
  const mentionOpen = input.startsWith("@") && !input.includes(" ");
  const mentionMatches = mentionOpen
    ? AGENTS.filter(
        (a) =>
          a.name.startsWith(input.slice(1).toLowerCase()) ||
          a.label.toLowerCase().includes(input.slice(1).toLowerCase())
      )
    : [];

  const pickMention = (name: string) => {
    setInput(`@${name} `);
    setMentionIndex(0);
    taRef.current?.focus();
  };

  const send = async () => {
    const content = input.trim();
    if (!content || sending) return;
    setInput("");
    setSending(true);
    try {
      await onSend(content);
    } finally {
      setSending(false);
      taRef.current?.focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen && mentionMatches.length > 0) {
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
        pickMention(mentionMatches[Math.min(mentionIndex, mentionMatches.length - 1)].name);
        return;
      }
      if (e.key === "Escape") {
        setInput(input + " ");
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const handleFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      await onUpload(Array.from(list));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed");
      setTimeout(() => setUploadError(null), 5000);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const placeholder = selectedAgent
    ? `Message the team — @agent asks the ${AGENT_DISPLAY_NAMES[selectedAgent] ?? selectedAgent}`
    : "Message the team — type @ to bring in an agent";

  return (
    <div className={COMPOSER_CARD}>
      <div className="relative">
        {mentionOpen && mentionMatches.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 mb-2 z-30 overflow-hidden rounded-xl border border-black/10 dark:border-white/10 bg-surface dark:bg-surface-dark shadow-lg">
            {mentionMatches.map((agent, i) => (
              <button
                key={agent.name}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setMentionIndex(i)}
                onClick={() => pickMention(agent.name)}
                className={`w-full text-left px-3.5 py-2.5 flex items-baseline gap-3 transition-colors ${
                  i === Math.min(mentionIndex, mentionMatches.length - 1)
                    ? "bg-black/[0.05] dark:bg-white/[0.06]"
                    : ""
                }`}
              >
                <span className="text-sm font-medium text-black dark:text-white">@{agent.name}</span>
                <span className="text-xs text-black/40 dark:text-white/40 truncate">
                  {agent.label} — {agent.description}
                </span>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={taRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setMentionIndex(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={1}
          className="w-full bg-transparent px-5 pt-4 pb-2 text-sm text-black dark:text-white placeholder-black/30 dark:placeholder-white/30 outline-none resize-none"
        />
        <div className="flex items-center justify-between px-4 pb-3">
          <div className="flex items-center gap-1">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={FILE_ACCEPT}
              className="hidden"
              onChange={(e) => void handleFiles(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              title="Upload a document to this case"
              className="p-1.5 rounded-lg text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-40 transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
            {uploading && (
              <span className="text-[11px] text-black/40 dark:text-white/40">Uploading…</span>
            )}
            {uploadError && (
              <span className="text-[11px] text-black/60 dark:text-white/60">{uploadError}</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => void send()}
            disabled={!input.trim() || sending}
            title="Send"
            className="p-1.5 rounded-lg transition-colors text-white bg-black dark:bg-white dark:text-black disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-6 6m6-6l6 6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
