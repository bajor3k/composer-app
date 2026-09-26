"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CUSTODIANS, JIRA_TEAM, PRIORITIES, REQUEST_TYPES } from "@/lib/jira-fields";

/**
 * Jira ticket card, opened from the Create ticket split button in the composer's
 * context row. Files into the Operations project via `/api/jira/ticket` — the
 * Atlassian token stays server-side.
 *
 * Only the account number is pre-filled (from whatever account the workspace has
 * selected); every other field is the adviser's to complete.
 */

interface Props {
  /** Account number from the Composer session, or "" if none is selected yet. */
  accountNumber: string;
  onClose: () => void;
}

interface Created {
  key: string;
  url: string;
  commentFailed?: boolean;
}

const LABEL = "block text-[11px] font-medium uppercase tracking-wider text-black/45 dark:text-white/45 mb-1.5";

const INPUT =
  "w-full px-3 py-2 rounded-lg text-sm text-black dark:text-white bg-surface dark:bg-surface-dark " +
  "border border-border dark:border-border-dark placeholder-black/30 dark:placeholder-white/30 " +
  "outline-none focus:border-black/40 dark:focus:border-white/40 transition-colors";

export default function CreateTicketModal({ accountNumber, onClose }: Props) {
  const [account, setAccount] = useState(accountNumber);
  const [summary, setSummary] = useState("");
  const [requestType, setRequestType] = useState<string>(REQUEST_TYPES[0]);
  const [priority, setPriority] = useState<string>("Medium");
  const [custodian, setCustodian] = useState("");
  const [clientName, setClientName] = useState("");
  const [description, setDescription] = useState("");
  const [comment, setComment] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  const summaryRef = useRef<HTMLInputElement>(null);
  const accountRef = useRef<HTMLInputElement>(null);

  // Focus the first field the adviser actually has to fill. If no account came
  // from the workspace, that's the account box; otherwise the summary.
  useEffect(() => {
    const t = setTimeout(() => (accountNumber ? summaryRef : accountRef).current?.focus(), 30);
    return () => clearTimeout(t);
  }, [accountNumber]);

  // Escape closes — but not mid-submit, which would strand an in-flight create.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const missing = !account.trim() || !summary.trim() || !description.trim();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || missing) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/jira/ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountNumber: account,
          summary,
          description,
          requestType,
          priority,
          custodian,
          clientName,
          comment,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || `Could not create the ticket (${res.status}).`);
        return;
      }
      setCreated(json.data as Created);
    } catch (err) {
      setError(`Could not reach the server: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center pt-[7vh] px-4 bg-black/40 dark:bg-black/60 overflow-y-auto"
      onClick={() => !submitting && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create Jira ticket"
        className="w-full max-w-xl mb-12 rounded-2xl border border-black/10 dark:border-white/10 bg-sidebar dark:bg-sidebar-dark medium:bg-[#c2c2c2] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-black/5 dark:border-white/5">
          <div className="flex items-center gap-2">
            <TicketIcon className="w-4 h-4 text-black/50 dark:text-white/50" />
            <span className="text-sm font-semibold text-black dark:text-white">Create ticket</span>
            <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider bg-black/5 dark:bg-white/10 text-black/50 dark:text-white/50">
              Jira
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="p-1 rounded-md text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-40"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {created ? (
          /* ---- success ---- */
          <div className="px-5 py-6">
            <p className="text-sm text-black dark:text-white mb-1.5">
              Sent to the{" "}
              <span className="font-semibold">{JIRA_TEAM.label}</span> queue.
            </p>
            <a
              href={created.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1E7FE0] dark:text-[#5CB0FF] hover:underline"
            >
              {created.key}
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
            </a>
            {created.commentFailed && (
              <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
                The ticket was created, but the comment didn&apos;t post. Add it in Jira.
              </p>
            )}
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-black dark:bg-white text-white dark:text-black hover:opacity-90 transition-opacity"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          /* ---- form ---- */
          <form onSubmit={submit} className="px-5 py-4">
            {/* Team is fixed — Operations is the only queue wired up. */}
            <div className="mb-4">
              <span className={LABEL}>Team</span>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/5 dark:bg-white/5 medium:bg-[#e4e4e4] text-sm text-black/70 dark:text-white/70">
                <span className="font-medium text-black dark:text-white">{JIRA_TEAM.label}</span>
                <span className="text-[11px] text-black/40 dark:text-white/40">({JIRA_TEAM.key})</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className={LABEL} htmlFor="jira-account">
                  Account number <span className="text-red-500">*</span>
                </label>
                <input
                  id="jira-account"
                  ref={accountRef}
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  required
                  placeholder="e.g. 12345678"
                  className={INPUT}
                />
                <p className="mt-1 text-[11px] text-black/35 dark:text-white/35">
                  {accountNumber
                    ? "Pre-filled from the current workspace."
                    : "No account selected in the workspace — enter one."}
                </p>
              </div>
              <div>
                <label className={LABEL} htmlFor="jira-client">
                  Client name
                </label>
                <input
                  id="jira-client"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Optional"
                  className={INPUT}
                />
              </div>
            </div>

            <div className="mb-3">
              <label className={LABEL} htmlFor="jira-summary">
                Summary <span className="text-red-500">*</span>
              </label>
              <input
                id="jira-summary"
                ref={summaryRef}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                required
                maxLength={240}
                placeholder="One line the ops team will see in the queue"
                className={INPUT}
              />
            </div>

            <div className="grid grid-cols-3 gap-3 mb-3">
              <div className="col-span-2">
                <label className={LABEL} htmlFor="jira-type">
                  Request type
                </label>
                <select
                  id="jira-type"
                  value={requestType}
                  onChange={(e) => setRequestType(e.target.value)}
                  className={INPUT}
                >
                  {REQUEST_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL} htmlFor="jira-priority">
                  Priority
                </label>
                <select
                  id="jira-priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className={INPUT}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mb-3">
              <label className={LABEL} htmlFor="jira-custodian">
                Custodian
              </label>
              <select
                id="jira-custodian"
                value={custodian}
                onChange={(e) => setCustodian(e.target.value)}
                className={INPUT}
              >
                <option value="">Not specified</option>
                {CUSTODIANS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-3">
              <label className={LABEL} htmlFor="jira-description">
                Description <span className="text-red-500">*</span>
              </label>
              <textarea
                id="jira-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                rows={4}
                maxLength={4000}
                placeholder="What needs to happen, and anything ops needs to know to action it."
                className={`${INPUT} resize-none`}
              />
            </div>

            <div className="mb-4">
              <label className={LABEL} htmlFor="jira-comment">
                Comment
              </label>
              <textarea
                id="jira-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder="Optional — posted as the first comment on the ticket."
                className={`${INPUT} resize-none`}
              />
            </div>

            {error && (
              <div
                role="alert"
                className="mb-3 px-3 py-2 rounded-lg text-xs bg-red-500/10 text-red-700 dark:text-red-300 border border-red-500/20"
              >
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2 text-sm text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || missing}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-black dark:bg-white text-white dark:text-black hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? "Creating…" : "Create ticket"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}

function TicketIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 010 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 010-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z" />
    </svg>
  );
}
