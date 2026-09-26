"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// The "+" button + dropdown shared by the Chat tab and the Studio/Agents input.
// Owns its own open/submenu state; the parent owns activeModes + the file input
// (so it can reset the picker after a send).
interface ComposerPlusMenuProps {
  activeModes: Set<string>;
  onToggleMode: (mode: string) => void;
  onOpenStudio?: (href: string, name: string) => void;
  onInsertText?: (text: string) => void; // Skills inserts a "[Skills]" token
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onAddFiles: (files: File[]) => void;
}

const CHIP_CONFIG: Record<string, { label: string; Icon: (p: { className?: string }) => React.ReactElement }> = {
  web: { label: "Web", Icon: GlobeIcon },
  analysis: { label: "Analysis", Icon: ChartIcon },
  research: { label: "Research", Icon: BookIcon },
};

export default function ComposerPlusMenu({
  activeModes,
  onToggleMode,
  onOpenStudio,
  onInsertText,
  fileInputRef,
  onAddFiles,
}: ComposerPlusMenuProps) {
  const router = useRouter();
  const [plusOpen, setPlusOpen] = useState(false);
  const plusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!plusOpen) return;
    const onClick = (e: MouseEvent) => {
      if (plusRef.current && !plusRef.current.contains(e.target as Node)) setPlusOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [plusOpen]);

  return (
    <div className="flex items-center gap-1.5">
      {/* Plus button with dropdown */}
      <div className="relative" ref={plusRef}>
        <button
          type="button"
          onClick={() => setPlusOpen((o) => !o)}
          className="p-1.5 rounded-lg text-black/30 dark:text-white/30 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
        >
          <PlusIcon className="w-5 h-5" />
        </button>
        {plusOpen && (
          <div className="absolute left-0 bottom-full mb-2 z-20 w-44 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#1a1a1a] shadow-lg py-1">
            <button
              type="button"
              onClick={() => {
                setPlusOpen(false);
                onInsertText?.("[Skills]");
              }}
              className="w-full text-left px-3 py-2 text-sm text-black dark:text-white hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2.5"
            >
              <SkillsIcon className="w-4 h-4 flex-shrink-0 text-black/50 dark:text-white/50" />
              Skills
            </button>
            <button
              type="button"
              onClick={() => {
                setPlusOpen(false);
                fileInputRef.current?.click();
              }}
              className="w-full text-left px-3 py-2 text-sm text-black dark:text-white hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2.5"
            >
              <PaperclipIcon className="w-4 h-4 flex-shrink-0 text-black/50 dark:text-white/50" />
              Add files or photos
            </button>
            <button
              type="button"
              onClick={() => setPlusOpen(false)}
              className="w-full text-left px-3 py-2 text-sm text-black/40 dark:text-white/40 hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2.5 cursor-default"
            >
              <ReportIcon className="w-4 h-4 flex-shrink-0 text-black/50 dark:text-white/50" />
              Create Report
            </button>
            {/* Live: opens the Alert Center with its builder drawer already up. The
                Report and Ticket rows above/below are still destination-less. */}
            <button
              type="button"
              onClick={() => {
                setPlusOpen(false);
                router.push("/alerts?new=1");
              }}
              className="w-full text-left px-3 py-2 text-sm text-black dark:text-white hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2.5"
            >
              <AlertIcon className="w-4 h-4 flex-shrink-0 text-black/50 dark:text-white/50" />
              Create Alert
            </button>
            <button
              type="button"
              onClick={() => setPlusOpen(false)}
              className="w-full text-left px-3 py-2 text-sm text-black/40 dark:text-white/40 hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2.5 cursor-default"
            >
              <TicketIcon className="w-4 h-4 flex-shrink-0 text-black/50 dark:text-white/50" />
              Create Ticket
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
          if (files.length) onAddFiles(files);
        }}
      />
      {Array.from(activeModes).map((mode) => {
        const config = CHIP_CONFIG[mode];
        if (!config) return null;
        const { label, Icon } = config;
        return (
          <button
            key={mode}
            type="button"
            onClick={() => onToggleMode(mode)}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/10 text-[11px] text-black/70 dark:text-white/70 hover:bg-black/10 dark:hover:bg-white/15 transition-colors"
          >
            <Icon className="w-3 h-3" />
            <span>{label}</span>
            <span className="text-black/40 dark:text-white/40 ml-0.5">×</span>
          </button>
        );
      })}
    </div>
  );
}

// Attachment chip card — shared so both inputs render added files identically.
export function AttachmentCard({ file, onRemove }: { file: File; onRemove: () => void }) {
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

// --- Icons (moved here from the Studio input so both pages share them) ---

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
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

function SkillsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 2.25l9.75 5.25L12 12.75 2.25 7.5 12 2.25z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l9.75 5.25L21.75 12" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 16.5l9.75 5.25 9.75-5.25" />
    </svg>
  );
}

function ReportIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
    </svg>
  );
}

function TicketIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 010 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 010-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z" />
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
