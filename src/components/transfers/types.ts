// Transfers page domain types + presentation maps. Mirrors the shape of the Composer
// `transfers` table (snake_case columns from the raw Supabase table).

export type TransferType = "acat" | "ach" | "wire" | "internal";
export type TransferDirection = "inbound" | "outbound" | "internal";
export type TransferStatus =
  | "pending_approval"
  | "submitted"
  | "in_review"
  | "in_transit"
  | "settle_prep"
  | "completed"
  | "rejected"
  | "cancelled";

export type TransferStatusEvent = {
  status: string;
  note: string | null;
  timestamp: string;
};

export type Transfer = {
  id: string;
  reference_number: string | null;
  type: TransferType;
  direction: TransferDirection;
  status: TransferStatus;
  from_account_id: string | null;
  from_account_name: string;
  from_account_number: string | null;
  from_institution: string;
  to_account_id: string | null;
  to_account_name: string;
  to_account_number: string | null;
  to_institution: string;
  amount: number | null;
  initiated_at: string | null;
  estimated_completion: string | null;
  completed_at: string | null;
  initiated_by: string | null;
  notes: string | null;
  status_history: TransferStatusEvent[];
};

// Transfer type label. "internal" reads as "Journal".
export const TYPE_LABELS: Record<TransferType, string> = {
  acat: "ACAT",
  ach: "ACH",
  wire: "Wire",
  internal: "Journal",
};

// The type-filter pills at the top of the page: All / ACAT / ACH / Wire / Journal.
export const TYPE_FILTERS: { value: "all" | TransferType; label: string }[] = [
  { value: "all", label: "All" },
  { value: "acat", label: "ACAT" },
  { value: "ach", label: "ACH" },
  { value: "wire", label: "Wire" },
  { value: "internal", label: "Journal" },
];

// Status label.
export const STATUS_LABELS: Record<string, string> = {
  pending_approval: "Pending",
  submitted: "Submitted",
  in_review: "In Review",
  in_transit: "In Transit",
  settle_prep: "Settling",
  completed: "Completed",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

// Statuses that are still "in flight" (not a terminal state) — for the summary bar.
export const IN_FLIGHT_STATUSES = new Set<string>([
  "pending_approval",
  "submitted",
  "in_review",
  "in_transit",
  "settle_prep",
]);
