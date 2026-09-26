"use client";

import type { CaseDocumentRow } from "@/lib/cases";
import { relativeTime } from "@/lib/agents/ui-helpers";

// Collapsible right rail listing the case's uploaded documents. Click a row to
// download via a short-lived signed URL; uploaders can remove their own files.

interface CaseDocumentsPanelProps {
  caseId: string;
  documents: CaseDocumentRow[];
  meId: string | null;
  onDelete: (docId: string) => void;
  onClose: () => void;
}

function fileBadge(mime: string | null, name: string): string {
  if (mime === "application/pdf") return "PDF";
  if (mime?.startsWith("image/")) return "IMG";
  if (mime?.includes("spreadsheet") || mime === "text/csv") return "XLS";
  if (mime?.includes("word")) return "DOC";
  return name.split(".").pop()?.toUpperCase().slice(0, 4) ?? "FILE";
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function CaseDocumentsPanel({
  caseId,
  documents,
  meId,
  onDelete,
  onClose,
}: CaseDocumentsPanelProps) {
  const download = async (docId: string) => {
    const res = await fetch(`/api/cases/${caseId}/documents/${docId}`).catch(() => null);
    if (res?.ok) {
      const { data } = await res.json();
      window.open(data.url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="w-72 shrink-0 border-l border-black/5 dark:border-white/5 flex flex-col min-h-0">
      <div className="px-4 py-3 flex items-center justify-between border-b border-black/5 dark:border-white/5">
        <span className="text-xs font-medium uppercase tracking-wider text-black/50 dark:text-white/50">
          Documents
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close documents panel"
          className="p-1 rounded-md text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {documents.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-black/35 dark:text-white/35">
            No documents yet. Use the + in the composer to upload one.
          </div>
        ) : (
          <ul className="space-y-0.5">
            {documents.map((doc) => (
              <li key={doc.id} className="group/doc relative">
                <button
                  type="button"
                  onClick={() => void download(doc.id)}
                  title={`Download ${doc.file_name}`}
                  className="w-full flex items-start gap-2.5 px-2 py-2 rounded-lg text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
                >
                  <span className="shrink-0 mt-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/10 text-black/60 dark:text-white/60">
                    {fileBadge(doc.mime_type, doc.file_name)}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-black dark:text-white truncate">
                      {doc.file_name}
                    </span>
                    <span className="block text-[10px] text-black/40 dark:text-white/40">
                      {formatSize(doc.size_bytes)}
                      {doc.size_bytes != null ? " · " : ""}
                      {doc.uploaded_by_name} · {relativeTime(doc.created_at)}
                    </span>
                  </span>
                </button>
                {meId === doc.uploaded_by && (
                  <button
                    type="button"
                    onClick={() => onDelete(doc.id)}
                    aria-label={`Delete ${doc.file_name}`}
                    title="Delete"
                    className="absolute right-1.5 top-1.5 p-1 rounded-md opacity-0 group-hover/doc:opacity-100 text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-opacity"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
