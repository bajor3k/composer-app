"use client";

import { useEffect, useRef } from "react";
import type { CaseMessageRow } from "@/lib/cases";
import { AGENT_DISPLAY_NAMES } from "@/lib/ai/agents/agent-menu";
import { renderMarkdownContent } from "@/components/ai-chat/markdown";
import MessageMeta from "@/components/ui/MessageMeta";
import AgentThinking from "@/components/ai-chat/AgentThinking";

// Shared case thread. My messages dock right (ChatPage user-bubble styling),
// teammates dock left with an initials avatar + name, agent replies render as
// markdown under an agent badge, system notes sit centered and muted.

interface CaseThreadProps {
  messages: CaseMessageRow[];
  meId: string | null;
  agentThinking: boolean;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

export default function CaseThread({ messages, meId, agentThinking }: CaseThreadProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, agentThinking]);

  if (messages.length === 0 && !agentThinking) {
    return (
      <div className="py-16 text-center text-sm text-black/35 dark:text-white/35">
        No messages yet — start the conversation, or @agent to bring in the workspace agent.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {messages.map((m) => {
        if (m.author_type === "system") {
          return (
            <div key={m.id} className="text-center text-[11px] text-black/40 dark:text-white/40 px-8">
              {m.content}
            </div>
          );
        }

        if (m.author_type === "agent") {
          return (
            <div key={m.id} className="group flex flex-col items-start">
              <div className="mb-1 px-1">
                <span className="text-xs font-medium text-black/50 dark:text-white/50">
                  {AGENT_DISPLAY_NAMES[m.agent ?? ""] ?? m.author_name}
                </span>
              </div>
              <div className="max-w-[80%] rounded-2xl px-4 py-2.5 bg-black/[0.04] dark:bg-white/[0.06] text-black dark:text-white/70">
                {renderMarkdownContent(m.content)}
              </div>
              <MessageMeta text={m.content} time={m.created_at} align="left" />
            </div>
          );
        }

        const isMine = meId !== null && m.author_id === meId;
        return (
          <div key={m.id} className={`group flex flex-col ${isMine ? "items-end" : "items-start"}`}>
            {!isMine && (
              <div className="flex items-center gap-1.5 mb-1 px-1">
                <span className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-semibold bg-black/80 dark:bg-white/80 text-white dark:text-black">
                  {initials(m.author_name)}
                </span>
                <span className="text-xs font-medium text-black/50 dark:text-white/50">
                  {m.author_name}
                </span>
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                isMine
                  ? "bg-black text-white dark:bg-white/10 dark:text-white/85"
                  : "bg-black/[0.04] dark:bg-white/[0.06] text-black dark:text-white/70"
              }`}
            >
              {m.content}
            </div>
            <MessageMeta text={m.content} time={m.created_at} align={isMine ? "right" : "left"} />
          </div>
        );
      })}
      {agentThinking && <AgentThinking kind="case" />}
      <div ref={endRef} />
    </div>
  );
}
