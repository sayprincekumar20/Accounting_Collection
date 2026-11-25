// Document Verification tab: types and calls to this dashboard's /api/dv-reviews routes
// (which add the engine's API key server-side). The login is shared, so the reviewer's name
// is typed once and remembered in this browser; it is sent with every decision.

export type ReviewStatus =
  | "Pending Review"
  | "In Review"
  | "Applied"
  | "Conflict"
  | "Failed"
  | "Rejected"
  | "Waiting for Documents"
  | "No Action";

export interface ReviewSummary {
  id: string;
  number: string;
  account_id: string;
  account_name: string | null;
  customer_number: string | null;
  status: ReviewStatus;
  recommendation: string;
  checks_met: string | null;
  rows_to_decide: number;
  requested_by: string | null;
  reviewer: string | null;
  created_at: string | null;
  closed_at: string | null;
}

export interface ActivationCheck {
  key: string;
  label: string;
  status: "PASS" | "AFTER_UPDATE" | "FAIL";
  detail: string;
}

export interface ReviewRow {
  id: string;
  zoho_field: string;
  field_label: string | null;
  current_value: string | null;
  proposed_value: string | null;
  action: string | null;
  confidence: number | null;
  ocr_check: string | null;
  evidence: string | null;
  auto_applied: string | null;
  decision: "Pending" | "Approve" | "Edit" | "Reject";
  edited_value: string | null;
  comment: string | null;
  outcome: string | null;
  outcome_detail: string | null;
  /** Whether approving this row writes it to Zoho (from the engine), and why not */
  writable?: boolean;
  not_writable_reason?: string | null;
}

export interface ReviewDetail extends ReviewSummary {
  job_id: string;
  summary: {
    alerts: string | null;
    recommendation_reasons: string | null;
    required_documents: string | null;
    documents_found: number | null;
    activation_checks: ActivationCheck[];
    rules_version: string | null;
    request_reason: string | null;
  };
  rows: ReviewRow[];
  pages: { n: number; file: string; page: number }[];
  reviewer_notes: string | null;
  values_compared: boolean;
  activate_account: boolean;
  activated: boolean | null;
  /** every value read from each document (latest verification) */
  extracted?: ExtractedDocument[];
  /** the Account's Channel, and the channel rule applied (WET_MARKET) */
  channel?: string | null;
  channel_rule?: string | null;
  /** batch check this review belongs to: position, previous / next account */
  batch?: BatchNav | null;
}

export interface ExtractedDocument {
  file: string | null;
  document_type: string | null;
  document: string;
  validity: string | null;
  valid_until: string | null;
  fields: { name: string; value: string; confidence: number | null; check: string | null }[];
  other_fields: { label: string | null; value: string | null }[];
}

export const OPEN_STATUSES: ReviewStatus[] = ["Pending Review", "In Review"];
export const isOpen = (s: ReviewStatus) => OPEN_STATUSES.includes(s);

/** Rows a reviewer decides on; the others (MATCH, already written automatically) are info. */
const DECIDABLE = new Set([
  "FILL",
  "CORRECT",
  "REVIEW_CONFLICT",
  "HOLD",
  "DIFFERS",
  "NO_PICKLIST_VALUE",
  "ATTACH",
]);
/** Rows counted as "to decide" in the Reviews list (same rule as the engine): a value change in
 *  Zoho that is still Pending. Files to attach and information-only rows are not counted. */
const TO_DECIDE = new Set([
  "FILL",
  "CORRECT",
  "REVIEW_CONFLICT",
  "HOLD",
  "DIFFERS",
  "NO_PICKLIST_VALUE",
]);
export const isToDecide = (r: ReviewRow) =>
  r.decision === "Pending" &&
  TO_DECIDE.has(String(r.action || "").toUpperCase()) &&
  r.auto_applied !== "Applied";

export const isDecidable = (r: ReviewRow) =>
  DECIDABLE.has(String(r.action || "").toUpperCase()) && r.auto_applied !== "Applied";

export const STATUS_TONE: Record<string, string> = {
  "Pending Review": "bg-secondary text-secondary-foreground",
  "In Review": "bg-primary/12 text-primary",
  Applied: "bg-success/12 text-success",
  Conflict: "bg-warning/15 text-warning",
  Failed: "bg-destructive/12 text-destructive",
  Rejected: "bg-destructive/12 text-destructive",
  "Waiting for Documents": "bg-warning/15 text-warning",
  "No Action": "bg-muted text-muted-foreground",
};

export const RECOMMENDATION_TONE: Record<string, string> = {
  ACTIVE: "bg-success/12 text-success",
  INACTIVE: "bg-destructive/12 text-destructive",
  MANUAL_REVIEW: "bg-warning/15 text-warning",
};

export const recommendationLabel = (r: string) =>
  ({ ACTIVE: "Active", INACTIVE: "Inactive", MANUAL_REVIEW: "Manual review" })[r] ?? r;

const NAME_KEY = "dv_reviewer_name";
export function getReviewerName(): string {
  try {
    return localStorage.getItem(NAME_KEY) || "";
  } catch {
    return "";
  }
}
export function setReviewerName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name.trim());
  } catch {
    /* private mode: kept for this page only */
  }
}

/** fetch + JSON, with the reviewer's name; throws Error(detail) on failure. */
export async function dvRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const name = getReviewerName();
  if (name) headers.set("X-Reviewer", name);
  if (init.body) headers.set("Content-Type", "application/json");
  const r = await fetch(path, { ...init, headers });
  const text = await r.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!r.ok) {
    const detail = (body as { detail?: unknown } | null)?.detail;
    throw new Error(
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? "Please check the form and try again."
          : `Request failed (${r.status})`,
    );
  }
  return body as T;
}

export function when(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export interface ExpiryItem {
  account_id: string;
  account_name: string;
  customer_number: string | null;
  account_owner: string | null;
  channel?: string | null;
  document_type: string;
  document: string;
  file: string | null;
  valid_until: string | null;
  days_left: number | null;
  state: "Expired" | "Expiring in 7 days" | "Expiring in 30 days" | "Valid" | "No expiry date";
  reminders_sent: number;
  last_reminder_at: string | null;
  verified_at: string | null;
  review_id: string | null;
  review_number: string | null;
}

export const EXPIRY_TONE: Record<string, string> = {
  Expired: "bg-destructive/12 text-destructive",
  "Expiring in 7 days": "bg-warning/15 text-warning",
  "Expiring in 30 days": "bg-warning/10 text-warning",
  Valid: "bg-success/12 text-success",
  "No expiry date": "bg-muted text-muted-foreground",
};

export function day(value: string | null) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export interface RequestDoc {
  type: string;
  label: string;
  reason: string;
  /** missing | wrong | unclear | expired | expiring | renewal */
  kind?: string;
  valid_until?: string | null;
}

export interface RequestDraft {
  account_id: string;
  account_name: string;
  customer_number: string | null;
  recipient_kind: "owner" | "customer";
  recipients: {
    owner: { name: string | null; email: string | null };
    customer: { name: string | null; email: string | null } | null;
  };
  to: string;
  cc: string;
  subject: string;
  body: string;
  documents: RequestDoc[];
  placeholder: string;
  /** days the upload link stays open (renewals: until 30 days after expiry) */
  link_days?: number;
}

export interface DocumentRequestItem {
  id: string;
  account_id: string;
  account_name: string;
  customer_number: string | null;
  status: "Requested" | "Partly received" | "Submitted" | "Expired";
  recipient_kind: "owner" | "customer";
  recipient_email: string;
  requested_by: string | null;
  documents: { type: string; label: string; reason: string; received: boolean }[];
  uploads: { type: string; file: string; at: string }[];
  created_at: string | null;
  expires_at: string | null;
  link: string | null;
}

export const REQUEST_TONE: Record<string, string> = {
  Requested: "bg-warning/15 text-warning",
  "Partly received": "bg-primary/10 text-primary",
  Submitted: "bg-success/12 text-success",
  Expired: "bg-muted text-muted-foreground",
};

export interface BatchResult {
  documents: number;
  missing: string[];
  expired: string[];
  expiring: string[];
  wrong: string[];
  unreadable: number;
  needs_decision: boolean;
  recommendation: string | null;
  ok: boolean;
  request: boolean;
}

export interface BatchItemRow {
  id: string;
  position: number;
  account_id: string;
  account_name: string | null;
  customer_number: string | null;
  status: "Waiting" | "Checking" | "Done" | "No documents" | "Failed";
  review_id: string | null;
  result: BatchResult | null;
  spot_check: "Correct" | "Not correct" | null;
  spot_note: string | null;
  spot_by: string | null;
}

export interface BatchHead {
  id: string;
  number: number;
  channel: string;
  status: "Running" | "Paused" | "Completed";
  size: number;
  done: number;
  counts: Record<string, number>;
  created_by: string | null;
  created_at: string | null;
  completed_at: string | null;
}

export interface BatchSummary {
  ok: number;
  missing: number;
  expired: number;
  expiring: number;
  unreadable: number;
  wrong: number;
  needs_decision: number;
  spot_checked: number;
  spot_correct: number;
}

export interface BatchReport extends BatchHead {
  summary: BatchSummary;
  items: BatchItemRow[];
}

export interface BatchNav {
  batch_id: string;
  number: number;
  channel: string;
  position: number;
  size: number;
  previous: string | null;
  next: string | null;
  spot_check: string | null;
  spot_note: string | null;
  spot_by: string | null;
}

export const BATCH_TONE: Record<string, string> = {
  Running: "bg-primary/10 text-primary",
  Paused: "bg-warning/15 text-warning",
  Completed: "bg-success/12 text-success",
};
