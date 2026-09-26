"use client";

import { useEffect, useRef, useState } from "react";
import { CUSTODIANS } from "@/lib/custodians";

export default function CustodianSwitcher() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string>(CUSTODIANS[0]);
  const ref = useRef<HTMLDivElement>(null);

  // Restore the saved custodian on mount, and stay in sync when another view (e.g. the
  // chat hero toggle) changes it via the broadcast event.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("composer-custodian");
      if (saved && (CUSTODIANS as readonly string[]).includes(saved)) setSelected(saved);
    } catch {}
    const onCustodian = (e: Event) => {
      const name = (e as CustomEvent).detail as string;
      if (name && (CUSTODIANS as readonly string[]).includes(name)) setSelected(name);
    };
    window.addEventListener("composer:custodian-changed", onCustodian);
    return () => window.removeEventListener("composer:custodian-changed", onCustodian);
  }, []);

  // Persist + broadcast so other views (e.g. the chat hero) update live.
  const selectCustodian = (name: string) => {
    setSelected(name);
    setOpen(false);
    try {
      localStorage.setItem("composer-custodian", name);
    } catch {}
    window.dispatchEvent(new CustomEvent("composer:custodian-changed", { detail: name }));
  };

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 px-2 py-1 -ml-2 rounded-lg text-[15px] font-semibold text-black dark:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
      >
        <span>{selected}</span>
        <ChevronDownIcon
          className={`w-4 h-4 text-black/50 dark:text-white/50 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute left-0 top-full mt-1 min-w-[170px] py-1 rounded-xl border border-border dark:border-border-dark bg-sidebar dark:bg-sidebar-dark shadow-lg z-50"
        >
          {CUSTODIANS.map((name) => {
            const active = name === selected;
            return (
              <li key={name}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => selectCustodian(name)}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left text-[14px] transition-colors ${
                    active
                      ? "text-black dark:text-white bg-black/5 dark:bg-white/5 font-medium"
                      : "text-black/70 dark:text-white/70 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  <span>{name}</span>
                  {active && <CheckIcon className="w-4 h-4 shrink-0" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}
