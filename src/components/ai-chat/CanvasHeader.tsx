"use client";

import { useState, useRef, useEffect } from "react";
import { useChat } from "./AiChatContext";
import { CANVAS_PAGES } from "@/lib/canvas-pages";

export default function CanvasHeader() {
  const { canvasPageName, switchCanvasPage, closeCanvas } = useChat();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

  // Group pages by section for the dropdown
  const sections = [
    { label: "General", pages: CANVAS_PAGES.filter((p) => p.href === "/") },
    {
      label: "Communication",
      pages: CANVAS_PAGES.filter((p) => p.href.startsWith("/communication")),
    },
    {
      label: "Accounts",
      pages: CANVAS_PAGES.filter((p) => p.href.startsWith("/accounts")),
    },
    {
      label: "Knowledge",
      pages: CANVAS_PAGES.filter((p) => p.href.startsWith("/knowledge")),
    },
  ];

  return (
    <div className="h-11 border-b border-black/10 dark:border-white/10 bg-white dark:bg-black medium:bg-[#c8c8c8] flex items-center justify-between px-4 flex-shrink-0">
      {/* Page selector */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="flex items-center gap-1.5 px-2 py-1 -ml-2 rounded-md hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-sm"
        >
          <span className="font-medium text-black dark:text-white">
            {canvasPageName}
          </span>
          <ChevronIcon className="w-3.5 h-3.5 text-black/40 dark:text-white/40" />
        </button>

        {dropdownOpen && (
          <div className="absolute top-full left-0 mt-1 w-56 bg-white dark:bg-zinc-900 medium:bg-[#c8c8c8] border border-black/10 dark:border-white/10 rounded-lg shadow-xl z-50 py-1 max-h-[70vh] overflow-y-auto">
            {sections.map(
              (section) =>
                section.pages.length > 0 && (
                  <div key={section.label}>
                    <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-black/30 dark:text-white/30">
                      {section.label}
                    </div>
                    {section.pages.map((page) => (
                      <button
                        key={page.href}
                        onClick={() => {
                          switchCanvasPage(page.href, page.name);
                          setDropdownOpen(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                          page.name === canvasPageName
                            ? "text-black dark:text-white bg-black/5 dark:bg-white/5"
                            : "text-black/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/5 hover:text-black dark:hover:text-white"
                        }`}
                      >
                        {page.name}
                      </button>
                    ))}
                  </div>
                )
            )}
          </div>
        )}
      </div>

      {/* Exit button */}
      <button
        onClick={closeCanvas}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
      >
        <ExitIcon className="w-3.5 h-3.5" />
        <span>Studio</span>
      </button>
    </div>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ExitIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4l12 12M16 4L4 16" />
    </svg>
  );
}
