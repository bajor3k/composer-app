"use client";

import { useEffect, useState } from "react";

/** Which agent is working — picks the wording of the rotating status line. */
export type ThinkingKind = "workspace" | "alert" | "report" | "case";

/** Each phase is shown for PHASE_SECONDS, then the next one takes over. The last
 *  phase sticks, so a run that outlives the list still shows a live label. */
const PHASE_SECONDS = 6;

const PHASES: Record<ThinkingKind, string[]> = {
  workspace: ["Thinking", "Reading your data", "Pulling the numbers", "Putting it together"],
  alert: ["Thinking", "Drafting the alert", "Checking it against live data", "Counting today's matches"],
  report: ["Thinking", "Shaping the report", "Running it against live data", "Building the preview"],
  case: ["Thinking", "Reading the case", "Working through it"],
};

/** Elapsed time only appears once a run is slow enough that the wait is noticeable. */
const ELAPSED_AFTER_SECONDS = 5;

type AgentThinkingProps = {
  kind?: ThinkingKind;
  /** Pins the status line instead of rotating through the phases. */
  label?: string | null;
  /** Bubble styling, so each host keeps its own chat-bubble look. */
  bubbleClassName?: string;
  className?: string;
};

const DEFAULT_BUBBLE =
  "rounded-2xl px-4 py-2.5 bg-black/[0.04] dark:bg-white/[0.06] medium:bg-black/[0.06]";

export default function AgentThinking({
  kind = "workspace",
  label,
  bubbleClassName = DEFAULT_BUBBLE,
  className = "flex justify-start",
}: AgentThinkingProps) {
  // Mounted only while the agent is working, so this counter restarts per run.
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const phases = PHASES[kind];
  const phase = label ?? phases[Math.min(Math.floor(elapsed / PHASE_SECONDS), phases.length - 1)];

  return (
    <div className={className} aria-live="polite" aria-atomic="true">
      <div className={`${bubbleClassName} animate-agent-breathe`}>
        <div className="flex items-center gap-2">
          <span key={phase} className="agent-shimmer text-sm font-medium">
            {phase}
          </span>
          <ThinkingDots />
          {elapsed >= ELAPSED_AFTER_SECONDS && (
            <span className="text-[11px] tabular-nums text-black/30 dark:text-white/30">
              {elapsed}s
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function ThinkingDots({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-1 ${className}`}>
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="w-1.5 h-1.5 rounded-full bg-black/30 dark:bg-white/30 animate-bounce motion-reduce:animate-none"
          style={{ animationDelay: `${delay}ms`, animationDuration: "1.1s" }}
        />
      ))}
    </span>
  );
}
