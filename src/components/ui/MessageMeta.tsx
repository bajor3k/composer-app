"use client";

import { useState } from "react";
import { relativeTime } from "@/lib/agents/ui-helpers";

// Hover-reveal row shown right below a chat message: a Copy action + how long
// ago it was sent. Hidden until the mouse is over the message — the parent
// message wrapper must have the Tailwind `group` class.
export default function MessageMeta({
  text,
  time,
  align = "left",
}: {
  text: string;
  time: string;
  align?: "left" | "right";
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable — ignore */
    }
  };

  return (
    <div
      className={`flex items-center gap-2 mt-1 px-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150 ${
        align === "right" ? "justify-end" : "justify-start"
      }`}
    >
      <button
        type="button"
        onClick={copy}
        className="text-[11px] text-black/45 dark:text-white/45 hover:text-black dark:hover:text-white transition-colors"
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <span className="text-[10px] text-black/25 dark:text-white/25">·</span>
      <span className="text-[10px] text-black/35 dark:text-white/35">{relativeTime(time)}</span>
    </div>
  );
}
