"use client";

import { useRef, useState } from "react";
import CreateActionButton, { type CreateActionKey } from "./CreateActionButton";
import SearchablePicker from "./SearchablePicker";
import type { AccountDirectory, AccountOption, HouseholdOption } from "./useAccountDirectory";

interface ContextPickerBarProps {
  account: AccountOption | null;
  household: HouseholdOption | null;
  directory: AccountDirectory;
  // When provided, the Account chip is rendered (for pages without a hero account
  // picker). Omitted on the chat page, where the hero drives the account.
  onPickAccount?: (a: AccountOption | null) => void;
  onPickHousehold: (h: HouseholdOption | null) => void;
  // When provided, the Attach chip is rendered.
  onAttachFiles?: (files: File[]) => void;
  // When true, the Create ticket/alert/report split button is pinned to the right
  // end of the row. It selects the composer's mode, so both props travel with it.
  showCreateAction?: boolean;
  createMode?: CreateActionKey;
  onCreateModeChange?: (mode: CreateActionKey) => void;
  className?: string;
}

// The labeled context row attached to the composer: Account? · Household · Attach?.
// The parent owns cross-fill (account→household, household→scope) so the chat hero and this
// bar share one selection model; the bar just forwards raw picks.
export default function ContextPickerBar({
  account,
  household,
  directory,
  onPickAccount,
  onPickHousehold,
  onAttachFiles,
  showCreateAction,
  createMode = "ticket",
  onCreateModeChange,
  className = "",
}: ContextPickerBarProps) {
  // Only one card open at a time across the whole bar.
  const [openPicker, setOpenPicker] = useState<"account" | "household" | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const setOpen = (which: "account" | "household") => (open: boolean) =>
    setOpenPicker(open ? which : null);

  const { accounts, households, accountsByHousehold, loading, error } = directory;

  // Account list is scoped to the chosen household; otherwise the full directory.
  const accountOptions = household ? accountsByHousehold.get(household.id) ?? [] : accounts;

  const disabled = loading || !!error;
  const emptyHint = error ? "Couldn't load accounts" : loading ? "Loading accounts…" : undefined;

  return (
    <div className={`flex items-center gap-1 flex-wrap px-3 py-1 ${className}`}>
      {onPickAccount && (
        <SearchablePicker<AccountOption>
          label="Account"
          emptyLabel="Account"
          icon={<AccountIcon className="w-3 h-3" />}
          placeholder="Search account number or name…"
          value={account}
          options={accountOptions}
          getKey={(a) => a.accountNumber}
          getPrimary={(a) => a.accountNumber}
          getSecondary={(a) => a.accountName}
          matches={(a, q) => {
            const t = q.toLowerCase();
            return (
              a.accountNumber.toLowerCase().includes(t) ||
              a.accountName.toLowerCase().includes(t) ||
              a.clientName.toLowerCase().includes(t)
            );
          }}
          onSelect={(a) => onPickAccount(a)}
          onClear={() => onPickAccount(null)}
          disabled={disabled}
          emptyHint={emptyHint}
          open={openPicker === "account"}
          onOpenChange={setOpen("account")}
          centered
        />
      )}

      <SearchablePicker<HouseholdOption>
        label="Household"
        emptyLabel="Household"
        icon={<HouseholdIcon className="w-3 h-3" />}
        placeholder="Search household…"
        value={household}
        options={households}
        getKey={(h) => h.id}
        getPrimary={(h) => h.name}
        getSecondary={(h) => `${h.accountCount} account${h.accountCount === 1 ? "" : "s"}`}
        matches={(h, q) => h.name.toLowerCase().includes(q.toLowerCase())}
        onSelect={(h) => onPickHousehold(h)}
        onClear={() => onPickHousehold(null)}
        disabled={disabled}
        emptyHint={emptyHint}
        open={openPicker === "household"}
        onOpenChange={setOpen("household")}
        centered
      />

      {onAttachFiles && (
        <>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Attach files to your message"
            aria-label="Attach files to your message"
            className="group inline-flex items-center rounded-md px-1.5 py-0.5 shadow-sm chip-raise transition-colors bg-[#2D9CFF]/10 hover:bg-[#2D9CFF]/20 text-[#1E7FE0]/70 dark:text-[#5CB0FF]/70 hover:text-[#1E7FE0] dark:hover:text-[#5CB0FF]"
          >
            <PaperclipIcon className="w-3 h-3" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) onAttachFiles(files);
              e.target.value = "";
            }}
          />
        </>
      )}

      {/* The account number is the one field that pre-fills on the Jira card. */}
      {showCreateAction && onCreateModeChange && (
        <CreateActionButton
          mode={createMode}
          onModeChange={onCreateModeChange}
          accountNumber={account?.accountNumber ?? ""}
        />
      )}
    </div>
  );
}

// All icons share the native 0 0 24 24 viewBox + strokeWidth 1.8 at w-3.5 h-3.5, so
// they render at a uniform size (the old per-icon cropped-viewBox hack is gone).
function AccountIcon({ className }: { className?: string }) {
  // File / document — the account record.
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

function HouseholdIcon({ className }: { className?: string }) {
  // Folder — the household (a "folder" of accounts).
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12a2.25 2.25 0 012.25-2.25h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
    </svg>
  );
}

function PaperclipIcon({ className }: { className?: string }) {
  // Paperclip — attach files to the message.
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 002.112 2.13" />
    </svg>
  );
}
