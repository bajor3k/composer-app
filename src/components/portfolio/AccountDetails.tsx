"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { type PortfolioAccount, type AccountParticipant } from "./types";

const RMD_ELIGIBLE_TYPES = ["ira", "sep_ira", "simple_ira", "k401", "k403b", "pension"];

const UNIFORM_LIFETIME_TABLE: Record<number, number> = {
  72: 27.4, 73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9,
  78: 22.0, 79: 21.1, 80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7,
  84: 16.8, 85: 16.0, 86: 15.2, 87: 14.4, 88: 13.7, 89: 12.9,
  90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1, 94: 9.5, 95: 8.9,
  96: 8.4, 97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4, 101: 6.0,
  102: 5.6, 103: 5.2, 104: 4.9, 105: 4.6, 106: 4.3, 107: 4.1,
  108: 3.9, 109: 3.7, 110: 3.5, 111: 3.4, 112: 3.3, 113: 3.1,
  114: 3.0, 115: 2.9, 116: 2.8, 117: 2.7, 118: 2.5, 119: 2.3, 120: 2.0,
};

function calculateAge(dob: Date, asOf: Date): number {
  let age = asOf.getFullYear() - dob.getFullYear();
  const m = asOf.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && asOf.getDate() < dob.getDate())) age--;
  return age;
}

function formatCurrencyFull(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

export default function AccountDetails({ account, hideHeader }: { account: PortfolioAccount | null; hideHeader?: boolean }) {
  const [rmdData, setRmdData] = useState<{ rmd_amount: number; remaining_rmd: number } | null>(null);

  useEffect(() => {
    if (!account) { setRmdData(null); return; }
    const type = account.account_type.toLowerCase();
    if (!RMD_ELIGIBLE_TYPES.includes(type) || !account.date_of_birth) { setRmdData(null); return; }

    const age = calculateAge(new Date(account.date_of_birth), new Date(2026, 11, 31));
    if (age < 73) { setRmdData(null); return; }

    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("retirement_rmd_view")
        .select("prior_year_end_balance, ytd_distributions")
        .eq("account_id", account.id)
        .single();

      if (cancelled) return;
      if (!data) { setRmdData(null); return; }

      const balance = Number(data.prior_year_end_balance);
      const ytdDist = Number(data.ytd_distributions);
      const period = UNIFORM_LIFETIME_TABLE[age] ?? (age > 120 ? 2.0 : 27.4);
      const rmdAmount = period > 0 ? Math.round(balance / period * 100) / 100 : 0;
      const remaining = Math.max(0, rmdAmount - ytdDist);
      setRmdData({ rmd_amount: rmdAmount, remaining_rmd: remaining });
    })();

    return () => { cancelled = true; };
  }, [account?.id, account?.account_type, account?.date_of_birth]);

  const [participants, setParticipants] = useState<AccountParticipant[]>([]);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [editingParticipant, setEditingParticipant] = useState<AccountParticipant | null>(null);
  const [addingParticipant, setAddingParticipant] = useState(false);
  const participantsRef = useRef<HTMLDivElement>(null);

  const fetchParticipants = async (accountId: string) => {
    const { data } = await supabase
      .from("account_participant")
      .select("*")
      .eq("account_id", accountId)
      .order("role");
    if (data) setParticipants(data as AccountParticipant[]);
  };

  useEffect(() => {
    if (!account) { setParticipants([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("account_participant")
        .select("*")
        .eq("account_id", account.id)
        .order("role");
      if (!cancelled && data) setParticipants(data as AccountParticipant[]);
    })();
    return () => { cancelled = true; };
  }, [account?.id]);

  useEffect(() => {
    setParticipantsOpen(false);
    setEditingParticipant(null);
    setAddingParticipant(false);
  }, [account?.id]);

  useEffect(() => {
    if (!participantsOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (participantsRef.current && !participantsRef.current.contains(event.target as Node)) {
        setParticipantsOpen(false);
        setEditingParticipant(null);
        setAddingParticipant(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [participantsOpen]);

  if (!account) {
    return (
      <div>
        <div className="animate-pulse">
          <div className="h-5 bg-black/5 dark:bg-white/5 rounded w-32 mb-4" />
          <div className="grid grid-cols-2 gap-6">
            <div className="h-4 bg-black/5 dark:bg-white/5 rounded w-24" />
            <div className="h-4 bg-black/5 dark:bg-white/5 rounded w-28" />
            <div className="h-4 bg-black/5 dark:bg-white/5 rounded w-20" />
            <div className="h-4 bg-black/5 dark:bg-white/5 rounded w-32" />
          </div>
        </div>
      </div>
    );
  }

  const formatAccountType = (type: string) => {
    const types: Record<string, string> = {
      individual: "Individual",
      joint: "Joint",
      ira: "Traditional IRA",
      roth_ira: "Roth IRA",
      INDIVIDUAL: "Individual",
      JOINT: "Joint",
      IRA: "Traditional IRA",
      ROTH_IRA: "Roth IRA",
      trust: "Trust",
      TRUST: "Trust",
      "401k": "401(k)",
      K401: "401(k)",
    };
    return types[type] || type;
  };

  // For JOINT and TRUST accounts, show both spouses (e.g. "Amanda & Brenda Sanchez")
  // account_name stores "FirstName1 & FirstName2 LastName TYPE"
  const getAccountHolderNames = (acct: PortfolioAccount): string[] => {
    const type = acct.account_type.toLowerCase();
    if (type === "joint" || type === "trust") {
      const name = extractName(acct.account_name);
      const ampIdx = name.indexOf(" & ");
      if (ampIdx > -1) {
        const first1 = name.slice(0, ampIdx);
        const rest = name.slice(ampIdx + 3);
        const lastSpace = rest.lastIndexOf(" ");
        if (lastSpace > -1) {
          const first2 = rest.slice(0, lastSpace);
          const lastName = rest.slice(lastSpace + 1);
          return [`${first1} ${lastName}`, `${first2} ${lastName}`];
        }
      }
    }
    return [acct.client_name || extractName(acct.account_name)];
  };

  // Extract just the name portion from account_name (remove account type suffix if present)
  const extractName = (accountName: string) => {
    // Common patterns: "John Smith - Individual", "John & Jane Smith Joint", "Amy Torres IRA", "Smith Family Trust"
    const suffixes = [
      " - Individual", " - Joint", " - IRA", " - Roth IRA", " - Trust", " - 401(k)",
      " INDIVIDUAL", " JOINT", " ROTH IRA", " TRUST",
      " Individual", " Joint", " IRA", " Roth IRA", " Trust", " 401(k)",
      " Traditional IRA", " SEP IRA", " SIMPLE IRA"
    ];
    let name = accountName;
    for (const suffix of suffixes) {
      if (name.endsWith(suffix)) {
        name = name.slice(0, -suffix.length);
        break;
      }
    }
    return name.trim();
  };

  return (
    <div>
      {!hideHeader && (
        <div className="text-xs font-semibold text-black dark:text-white uppercase tracking-wider mb-4">
          Account Details
        </div>
      )}

      <div className={`grid grid-cols-2 ${rmdData ? "lg:grid-cols-5" : "lg:grid-cols-4"} gap-x-8 gap-y-2`}>
        {/* Row 1 */}
        <div>
          <div className="text-xs text-black/40 dark:text-white/40 uppercase tracking-wider">
            Account Holder
          </div>
          <div className="text-sm mt-0.5">
            {getAccountHolderNames(account).map((name, i, arr) => (
              <span key={name}>
                <Link
                  href={`/communication/crm?search=${encodeURIComponent(name)}`}
                  className="text-black dark:text-white hover:underline"
                >
                  {name}
                </Link>
                {i < arr.length - 1 && <span className="text-black dark:text-white"> &amp; </span>}
              </span>
            ))}
          </div>
        </div>
        <DetailItem label="Rep Code" value={account.rep_code || "—"} mono />
        <DetailItem label="Registration" value={formatAccountType(account.account_type)} />
        <DetailItem label="Custodian" value={account.custodian} />
        {rmdData && (
          <DetailItem label="RMD Amount" value={formatCurrencyFull(rmdData.rmd_amount)} />
        )}

        {/* Row 2 */}
        <DetailItem
          label="Model"
          value={account.model_portfolio_id && account.model_name ? account.model_name : "None"}
        />
        {account.household_id && account.household_name ? (
          <div>
            <div className="text-xs text-black/40 dark:text-white/40 uppercase tracking-wider">
              Household
            </div>
            <Link
              href={`/accounts/households?household=${account.household_id}`}
              className="text-sm text-black dark:text-white hover:underline mt-0.5 block"
            >
              {account.household_name}
            </Link>
          </div>
        ) : (
          <DetailItem label="Household" value="None" />
        )}
        {account.firm_name ? (
          <div>
            <div className="text-xs text-black/40 dark:text-white/40 uppercase tracking-wider">
              Firm
            </div>
            <Link
              href={`/communication/crm?search=${encodeURIComponent(account.firm_name)}`}
              className="text-sm text-black dark:text-white hover:underline mt-0.5 block"
            >
              {account.firm_name}
            </Link>
          </div>
        ) : (
          <DetailItem label="Firm" value="—" />
        )}
        <div ref={participantsRef} className="relative">
          <div className="text-xs text-black/40 dark:text-white/40 uppercase tracking-wider">
            Participants
          </div>
          <button
            onClick={() => setParticipantsOpen(!participantsOpen)}
            className="text-sm text-black dark:text-white mt-0.5 hover:underline cursor-pointer"
          >
            {participants.length}
          </button>

          {participantsOpen && (
            <div className="absolute top-full left-0 mt-1.5 w-80 bg-white dark:bg-[#141414] rounded-xl shadow-2xl border border-black/10 dark:border-white/10 z-50 overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-black/5 dark:border-white/5">
                <span className="text-xs font-semibold text-black dark:text-white uppercase tracking-wider">
                  Participants
                </span>
                <button
                  onClick={() => { setAddingParticipant(true); setEditingParticipant(null); }}
                  className="text-[11px] font-medium text-accent hover:text-accent-hover transition-colors"
                >
                  + Add
                </button>
              </div>

              {/* List */}
              <div className="max-h-64 overflow-y-auto">
                {participants.length === 0 && !addingParticipant && (
                  <div className="px-4 py-6 text-center text-xs text-black/30 dark:text-white/30">
                    No participants
                  </div>
                )}
                {participants.map((p) => (
                  <div
                    key={p.id}
                    className={`group w-full px-4 py-2.5 flex items-center justify-between transition-colors border-b border-black/5 dark:border-white/5 last:border-b-0 ${
                      editingParticipant?.id === p.id
                        ? "bg-black/5 dark:bg-white/5"
                        : "hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm text-black dark:text-white">{p.name}</div>
                      {p.relationship && (
                        <div className="text-[11px] text-black/40 dark:text-white/40 capitalize">{p.relationship}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      <div className="text-[11px] text-black/50 dark:text-white/50">
                        {formatRole(p.role)}
                      </div>
                      <button
                        onClick={() => { setEditingParticipant(editingParticipant?.id === p.id ? null : p); setAddingParticipant(false); }}
                        className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5 transition-all"
                        title="Edit"
                      >
                        <svg className="w-3 h-3 text-black/40 dark:text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Edit / Add form */}
              {(editingParticipant || addingParticipant) && account && (
                <ParticipantForm
                  accountId={account.id}
                  participant={editingParticipant}
                  onSaved={() => { fetchParticipants(account.id); setEditingParticipant(null); setAddingParticipant(false); }}
                  onDeleted={() => { fetchParticipants(account.id); setEditingParticipant(null); }}
                  onCancel={() => { setEditingParticipant(null); setAddingParticipant(false); }}
                />
              )}
            </div>
          )}
        </div>
        {rmdData && (
          <DetailItem label="RMD Remaining" value={formatCurrencyFull(rmdData.remaining_rmd)} />
        )}
      </div>
    </div>
  );
}

const ROLE_OPTIONS = [
  { value: "beneficiary", label: "Beneficiary" },
  { value: "grantor", label: "Grantor" },
  { value: "trusted_contact", label: "Trusted Contact" },
  { value: "interested_party", label: "Interested Party" },
  { value: "poa", label: "POA" },
  { value: "lpoa", label: "LPOA" },
];

function formatRole(role: string): string {
  return ROLE_OPTIONS.find((r) => r.value === role)?.label || role;
}

function ParticipantForm({
  accountId,
  participant,
  onSaved,
  onDeleted,
  onCancel,
}: {
  accountId: string;
  participant: AccountParticipant | null;
  onSaved: () => void;
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const isEdit = !!participant;
  const [name, setName] = useState(participant?.name || "");
  const [role, setRole] = useState<string>(participant?.role || "beneficiary");
  const [relationship, setRelationship] = useState(participant?.relationship || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(participant?.name || "");
    setRole(participant?.role || "beneficiary");
    setRelationship(participant?.relationship || "");
  }, [participant?.id]);

  const canSave = name.trim().length > 0;

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    if (isEdit && participant) {
      await supabase
        .from("account_participant")
        .update({ name: name.trim(), role, relationship: relationship.trim() || null })
        .eq("id", participant.id);
    } else {
      await supabase
        .from("account_participant")
        .insert({ account_id: accountId, name: name.trim(), role, relationship: relationship.trim() || null });
    }
    setSaving(false);
    onSaved();
  }

  async function handleDelete() {
    if (!participant || saving) return;
    setSaving(true);
    await supabase.from("account_participant").delete().eq("id", participant.id);
    setSaving(false);
    onDeleted();
  }

  return (
    <div className="border-t border-black/5 dark:border-white/5 px-4 py-3 space-y-3">
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40 mb-1">
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name"
          className="w-full px-3 py-1.5 rounded-lg border border-border dark:border-border-dark bg-surface dark:bg-surface-dark text-sm text-black dark:text-white placeholder-black/30 dark:placeholder-white/30 outline-none focus:border-black dark:focus:border-white transition-colors"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40 mb-1">
            Role
          </label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full px-3 py-1.5 rounded-lg border border-border dark:border-border-dark bg-surface dark:bg-surface-dark text-sm text-black dark:text-white outline-none focus:border-black dark:focus:border-white transition-colors"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40 mb-1">
            Relationship
          </label>
          <input
            type="text"
            value={relationship}
            onChange={(e) => setRelationship(e.target.value)}
            placeholder="e.g. spouse"
            className="w-full px-3 py-1.5 rounded-lg border border-border dark:border-border-dark bg-surface dark:bg-surface-dark text-sm text-black dark:text-white placeholder-black/30 dark:placeholder-white/30 outline-none focus:border-black dark:focus:border-white transition-colors"
          />
        </div>
      </div>
      <div className="flex items-center justify-between pt-1">
        {isEdit ? (
          <button
            onClick={handleDelete}
            disabled={saving}
            className="text-[11px] text-red-500 hover:text-red-600 transition-colors disabled:opacity-40"
          >
            Delete
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-xs text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isEdit ? "Save" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailItem({
  label,
  value,
  mono = false
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-black/40 dark:text-white/40 uppercase tracking-wider">
        {label}
      </div>
      <div className={`text-sm text-black dark:text-white mt-0.5 ${mono ? "font-mono" : ""}`}>
        {value}
      </div>
    </div>
  );
}
