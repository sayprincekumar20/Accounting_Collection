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
