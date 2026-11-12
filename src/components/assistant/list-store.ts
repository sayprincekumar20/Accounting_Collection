// In-memory state of the contact lists of this browser tab (parsed files and review tables). Not saved in the
// conversation history: it holds client data, so it disappears when the page is reloaded (attach the file again).
import type { ParsedFile } from "@/lib/assistant/list-file";
import type { ContactListResult, ReviewRow } from "@/lib/assistant/list-match";

export interface ReviewData {
  id: string;
  fileName: string;
  sheet: string;
  rows: ReviewRow[];
  /** Set once "Approve + contact" ran, so the list cannot be sent twice by accident. */
  result: ContactListResult | null;
}

export const fileStore = new Map<string, ParsedFile>();
export const reviewStore = new Map<string, ReviewData>();
