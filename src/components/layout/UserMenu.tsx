"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useTheme } from "@/components/ui/ThemeProvider";
import Toggle from "@/components/ui/Toggle";
import ProfileModal from "./ProfileModal";

const THEME_OPTIONS = [
  { value: "light", label: "Light Mode", Icon: SunIcon },
  { value: "medium", label: "Medium Mode", Icon: ContrastIcon },
  { value: "glass", label: "Glass Mode", Icon: GlassIcon },
  { value: "dark", label: "Dark Mode", Icon: MoonIcon },
  { value: "mocha", label: "Mocha Mode", Icon: CoffeeIcon },
] as const;

export default function UserMenu({ expanded, onExpand, onOpenChange, inline = false }: { expanded: boolean; onExpand?: () => void; onOpenChange?: (open: boolean) => void; inline?: boolean }) {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);

  // Surface open state so the sidebar can stand down its resize handle — its side
  // flyouts (Appearance/Settings) overlap the handle's right-edge hit zone, and the
  // handle would otherwise steal clicks meant for a menu item and start a resize.
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [themeExpanded, setThemeExpanded] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  // Chat composer settings surfaced directly in the menu, persisted in
  // "composer-chat-settings" and broadcast so the chat page picks them up live
  // (same-tab writes skip the storage event). minFirstPrompt = first-prompt
  // length gate.
  const [minFirstPrompt, setMinFirstPrompt] = useState(false);
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  // Defaults mirror ProfileModal's DEFAULT_PROFILE so the name shows even before a save
  const [firstName, setFirstName] = useState("Demo");
  const [lastName, setLastName] = useState("User");
  const ref = useRef<HTMLDivElement>(null);

  // Load profile (photo + name) from localStorage, and refresh when it's updated
  useEffect(() => {
    const apply = (raw: string | null) => {
      if (!raw) return;
      try {
        const data = JSON.parse(raw);
        setProfilePhoto(data.photo || null);
        if (typeof data.firstName === "string") setFirstName(data.firstName);
        if (typeof data.lastName === "string") setLastName(data.lastName);
      } catch { /* ignore */ }
    };
    apply(localStorage.getItem("composer-profile"));

    const reload = () => apply(localStorage.getItem("composer-profile"));
    window.addEventListener("storage", reload);
    window.addEventListener("composer-profile-updated", reload);
    return () => {
      window.removeEventListener("storage", reload);
      window.removeEventListener("composer-profile-updated", reload);
    };
  }, []);

  // Load the chat "minimum first prompt" preference (kept in sync across tabs).
  useEffect(() => {
    const read = () => {
      try {
        const s = JSON.parse(localStorage.getItem("composer-chat-settings") || "{}");
        setMinFirstPrompt(!!s.minFirstPrompt);
      } catch {
        setMinFirstPrompt(false);
      }
    };
    read();
    const onStorage = (e: StorageEvent) => { if (e.key === "composer-chat-settings") read(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Persist, then notify same-tab listeners (the chat page) — storage events don't
  // fire locally. Kept out of any setState updater so the dispatch never runs
  // during render.
  const toggleMinFirstPrompt = () => {
    const next = { minFirstPrompt: !minFirstPrompt };
    setMinFirstPrompt(next.minFirstPrompt);
    try {
      localStorage.setItem("composer-chat-settings", JSON.stringify(next));
    } catch {}
    window.dispatchEvent(new CustomEvent("composer:chat-settings-changed", { detail: next }));
  };

  const fullName = `${firstName} ${lastName}`.trim();
  const initials = `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase();

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
        setSettingsExpanded(false);
        setThemeExpanded(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    // Pinned to the constant bottom-left of the sidebar's outer wrapper (left/height never
    // change — only its width animates), so the avatar sits in the exact same spot whether
    // the sidebar is collapsed or open. pl-4 centers the 32px avatar in the 64px collapsed rail.
    <div
      ref={ref}
      className={
        inline
          ? "relative shrink-0 pl-4 pr-3 pt-2 pb-3"
          : "absolute bottom-0 left-0 right-0 z-40 pl-4 pr-3 pt-1 pb-4"
      }
    >
      {/* Terminal — tucked right above the account name; reads at the sidebar's
          normal row contrast and lifts to full contrast with a surface fill on hover. */}
      {expanded && (
        <Link
          href="/knowledge/terminal"
          title="Open Terminal"
          className="group/term mb-0.5 flex items-center gap-2.5 py-1.5 pl-1 pr-2 rounded-lg text-black/70 dark:text-white/70 hover:text-black dark:hover:text-white hover:bg-surface dark:hover:bg-surface-dark transition-colors"
        >
          <span className="w-6 flex items-center justify-center shrink-0">
            <TerminalIcon className="w-4 h-4 transition-transform group-hover/term:scale-110" />
          </span>
          <span className="min-w-0 text-left text-[13px] font-medium truncate">Terminal</span>
        </Link>
      )}

      <button
        onClick={() => (expanded ? setOpen((o) => !o) : onExpand?.())}
        title={expanded ? "Account" : "Open sidebar"}
        className={`group flex items-center py-1.5 rounded-lg transition-colors ${
          expanded
            ? "w-full gap-2.5 hover:bg-surface dark:hover:bg-surface-dark"
            : "w-fit"
        }`}
      >
        <span className="w-8 h-8 rounded-full bg-foreground flex items-center justify-center overflow-hidden flex-shrink-0">
          {profilePhoto ? (
            <img src={profilePhoto} alt="Profile" className="w-full h-full object-cover" />
          ) : (
            <span className="text-background text-xs font-medium">{initials}</span>
          )}
        </span>
        {expanded && (
          <>
            <span className="min-w-0 text-left text-sm text-black dark:text-white truncate">{fullName}</span>
            <ChevronIcon
              className={`w-4 h-4 shrink-0 text-black/40 dark:text-white/40 transition-all duration-200 ${open ? "opacity-100 rotate-180" : "opacity-0 group-hover:opacity-100"}`}
            />
          </>
        )}
      </button>

      {expanded && open && (
        <>
          {/* Backdrop — stray clicks close the menu instead of activating the navbar/page behind the side flyouts */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => { setOpen(false); setSettingsExpanded(false); setThemeExpanded(false); }}
          />
        <div
          className="absolute bottom-full mb-2 left-2 w-56 bg-white dark:bg-zinc-900 medium:bg-[#c8c8c8] rounded-lg shadow-xl border border-black/10 dark:border-white/10 z-50"
        >
          {/* Profile */}
          <button
            onClick={() => { setOpen(false); setProfileOpen(true); }}
            className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-black dark:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-t-lg transition-colors"
          >
            <UserIcon className="w-4 h-4" />
            Profile
          </button>
          <div className="border-t border-black/5 dark:border-white/5" />
          {/* Character minimum — first-prompt length gate, toggled inline. */}
          <div className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-black dark:text-white">
            <CharMinIcon className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-left">Minimum</span>
            <Toggle checked={minFirstPrompt} onChange={toggleMinFirstPrompt} />
          </div>
          <div className="border-t border-black/5 dark:border-white/5" />
          {/* Appearance (theme picker — opens to the side) */}
          <div className="relative">
            <button
              onClick={() => { setThemeExpanded((s) => !s); setSettingsExpanded(false); }}
              className={`w-full flex items-center gap-2.5 px-4 py-3 text-sm text-black dark:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors ${themeExpanded ? "bg-black/[0.03] dark:bg-white/[0.03]" : ""}`}
            >
              <ContrastIcon className="w-4 h-4" />
              <span className="flex-1 text-left">Appearance</span>
              <ChevronIcon className="w-3 h-3 text-black/30 dark:text-white/30 -rotate-90" />
            </button>
            {themeExpanded && (
              <div className="absolute left-full top-0 ml-1 w-48 bg-white dark:bg-zinc-900 medium:bg-[#c8c8c8] rounded-lg shadow-xl border border-black/10 dark:border-white/10 z-50 py-1">
                {THEME_OPTIONS.map(({ value, label, Icon }) => (
                  <button
                    key={value}
                    onClick={() => setTheme(value)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                      theme === value
                        ? "font-medium text-black dark:text-white bg-black/5 dark:bg-white/5"
                        : "text-black/60 dark:text-white/55 hover:bg-black/5 dark:hover:bg-white/5"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="flex-1 text-left">{label}</span>
                    {theme === value && <CheckIcon className="w-3.5 h-3.5 flex-shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="border-t border-black/5 dark:border-white/5" />
          {/* Settings (opens to the side) */}
          <div className="relative">
            <button
              onClick={() => { setSettingsExpanded((s) => !s); setThemeExpanded(false); }}
              className={`w-full flex items-center gap-2.5 px-4 py-3 text-sm text-black dark:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-b-lg transition-colors ${settingsExpanded ? "bg-black/[0.03] dark:bg-white/[0.03]" : ""}`}
            >
              <SettingsIcon className="w-4 h-4" />
              <span className="flex-1 text-left">Settings</span>
              <ChevronIcon className="w-3 h-3 text-black/30 dark:text-white/30 -rotate-90" />
            </button>
            {settingsExpanded && (
              <div className="absolute left-full top-0 ml-1 w-48 bg-white dark:bg-zinc-900 medium:bg-[#c8c8c8] rounded-lg shadow-xl border border-black/10 dark:border-white/10 z-50 py-1">
                <a
                  href="/settings/notifications"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-xs text-black/60 dark:text-white/55 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                >
                  <NotificationIcon className="w-3.5 h-3.5 flex-shrink-0" />
                  Notifications
                </a>
                <a
                  href="/settings/permissions"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-xs text-black/60 dark:text-white/55 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                >
                  <ShieldCheckIcon className="w-3.5 h-3.5 flex-shrink-0" />
                  Permissions
                </a>
                <a
                  href="/settings/security"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-xs text-black/60 dark:text-white/55 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                >
                  <LockIcon className="w-3.5 h-3.5 flex-shrink-0" />
                  Security
                </a>
              </div>
            )}
          </div>
        </div>
        </>
      )}

      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}

function TerminalIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 9.5l2.5 2.5L7 14.5M12.5 14.5H16" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
    </svg>
  );
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
    </svg>
  );
}

function ContrastIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="12" cy="12" r="9" />
      <path fill="currentColor" stroke="none" d="M12 3a9 9 0 010 18V3z" />
    </svg>
  );
}

function GlassIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="4" y="3" width="16" height="18" rx="3" />
      <path strokeLinecap="round" d="M7 7.5c1.8 1 3.2 1 5 0" opacity="0.7" />
      <path strokeLinecap="round" d="M7 11.5c2.6 1.2 4.4 1.2 7 0" opacity="0.45" />
    </svg>
  );
}

function CoffeeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8.5h12v5a4 4 0 01-4 4H8a4 4 0 01-4-4v-5z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 9.5h1.75a2.25 2.25 0 010 4.5H16" />
      <path strokeLinecap="round" d="M7 3.5c-.6.8-.6 1.7 0 2.5M10.5 3.5c-.6.8-.6 1.7 0 2.5" opacity="0.7" />
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

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a6.759 6.759 0 010 .255c-.007.38.138.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function CharMinIcon({ className }: { className?: string }) {
  // Pilcrow / text-length glyph — the character-minimum control.
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 4v16m4-16v16M17 4H9a4 4 0 000 8h4" />
    </svg>
  );
}

function NotificationIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
    </svg>
  );
}

function ShieldCheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
    </svg>
  );
}
