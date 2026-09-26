"use client";

import { useEffect, useRef, useState } from "react";
import CreateTicketModal from "./CreateTicketModal";

// The three create actions.
const CREATE_ACTIONS = [
  { key: "ticket", label: "Create ticket", Icon: TicketIcon },
  { key: "alert", label: "Create alert", Icon: AlertIcon },
  { key: "report", label: "Create report", Icon: ReportIcon },
] as const;

export type CreateActionKey = (typeof CREATE_ACTIONS)[number]["key"];

// Split button parked at the right end of the context chip row: a primary half
// that fires the selected action, and a chevron half that opens the three choices.
//
// This is a MODE selector, not a launcher. Picking "alert" or "report" switches the
// composer below into that agent's mode in place — the Alerts Agent and the report
// builder answer right there in the same text box, with no navigation. "ticket" is
// the odd one out: it means workspace mode, and also opens the Jira card.
//
// `mode` is owned by the chat page and DERIVED from its createKind, not mirrored
// here. A second useState would drift the moment anything else changed the mode —
// the sidebar's "New chat" does exactly that — and the button would sit there
// reading "Create alert" over a workspace composer.
export default function CreateActionButton({
  mode,
  onModeChange,
  accountNumber = "",
  className = "",
}: {
  mode: CreateActionKey;
  onModeChange: (mode: CreateActionKey) => void;
  /** Account selected in the workspace — pre-fills the ticket's account field. */
  accountNumber?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const action = mode;
  const [ticketOpen, setTicketOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const chevronRef = useRef<HTMLButtonElement>(null);

  // Outside-click + Escape, matching ComposerPlusMenu / CustodianSwitcher. Escape
  // also returns focus to the chevron so keyboard users don't lose their place.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        chevronRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = CREATE_ACTIONS.find((a) => a.key === action) ?? CREATE_ACTIONS[0];
  const CurrentIcon = current.Icon;

  // Both halves share everything but their corner radii. The container has no
  // border and no padding, so these radii sit exactly on its 6px corners — which
  // is why no overflow-hidden wrapper is needed (and the popup stays unclipped).
  const half =
    "inline-flex items-center py-0.5 transition-colors " +
    "hover:bg-black/10 dark:hover:bg-white/10 hover:text-black dark:hover:text-white";

  return (
    <div
      ref={ref}
      // ml-auto right-aligns within the flex line (so it survives a wrap); shrink-0
      // makes it wrap rather than squash. py-0.5 + text-[11px] + w-3 icons reproduce
      // the Household chip's box model exactly → identical 20.5px height.
      //
      // mr-[5px] is measured, not a guess: this row is px-3, but the composer's send
      // button below sits at px-4 *inside* the card's 1px border — 17px in. 12 + 5
      // puts this pill's right edge on exactly the same pixel column.
      className={`relative ml-auto mr-[5px] shrink-0 inline-flex items-stretch rounded-md text-[11px] shadow-sm chip-raise bg-black/5 dark:bg-white/5 medium:bg-[#e4e4e4] text-black/70 dark:text-white/70 ${className}`}
    >
      <button
        type="button"
        onClick={() => {
          // The mode is already applied by the menu; the primary half only opens the
          // ticket card. For alert and report the composer below is already waiting.
          if (action === "ticket") setTicketOpen(true);
        }}
        title={
          action === "ticket"
            ? "Create a Jira ticket for the Operations team"
            : action === "alert"
              ? "Describe the alert in the box below"
              : "Describe the report in the box below"
        }
        className={`${half} gap-1 rounded-l-md pl-2 pr-1.5`}
      >
        <CurrentIcon className="w-3 h-3 shrink-0" />
        <span className="whitespace-nowrap">{current.label}</span>
      </button>

      {/* Hairline divider, inset 2px so it doesn't run into the corner radii. */}
      <span aria-hidden className="w-px shrink-0 my-0.5 bg-black/10 dark:bg-white/10" />

      <button
        ref={chevronRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Choose what to create"
        className={`${half} rounded-r-md px-1`}
      >
        <ChevronDownIcon className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Opens UPWARD: the composer card below uses the same surface tokens as this
          panel (bg-sidebar / dark:bg-sidebar-dark / medium:#c2c2c2), so a downward
          menu would render identical-on-identical in light, dark, medium and glass.
          Upward it floats over the page background, which separates in every theme —
          and it matches SearchablePicker, which opens upward from this same row. */}
      {open && (
        <ul
          role="listbox"
          aria-label="Create"
          className="absolute right-0 bottom-full mb-1.5 z-50 min-w-[160px] py-1 rounded-xl border border-border dark:border-border-dark bg-sidebar dark:bg-sidebar-dark medium:bg-[#c2c2c2] glass:backdrop-blur-2xl glass:backdrop-saturate-150 shadow-xl"
        >
          {CREATE_ACTIONS.map((item) => {
            const active = item.key === action;
            return (
              <li key={item.key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onModeChange(item.key);
                    setOpen(false);
                    chevronRef.current?.focus();
                    if (item.key === "ticket") setTicketOpen(true);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors ${
                    active
                      ? "text-black dark:text-white font-medium bg-black/5 dark:bg-white/5"
                      : "text-black/70 dark:text-white/70 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  <item.Icon className="w-3.5 h-3.5 shrink-0 text-black/50 dark:text-white/50" />
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {ticketOpen && (
        <CreateTicketModal accountNumber={accountNumber} onClose={() => setTicketOpen(false)} />
      )}
    </div>
  );
}

// Icons are local at strokeWidth 1.8 to match the rest of the chip row, mirroring
// how PaperclipIcon already lives in both ContextPickerBar (1.8) and
// ComposerPlusMenu (2.0). Nothing is imported from ComposerPlusMenu on purpose.

function TicketIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 010 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 010-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z" />
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
    </svg>
  );
}

function ReportIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}
