import { FileText } from "lucide-react";

/** Link to a client's latest statement PDF in Google Drive (opens for staff signed in to Google). */
export function StatementLink({
  fileId,
  at,
}: {
  fileId?: string | null | undefined;
  at?: string | null | undefined;
}) {
  if (!fileId) return <span className="text-muted-foreground">No statement PDF yet</span>;
  const when = at
    ? new Date(at).toLocaleString("en-PH", {
        timeZone: "Asia/Manila",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  return (
    <a
      href={`https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
    >
      <FileText className="h-3 w-3" /> Statement PDF{when ? ` (${when})` : ""}
    </a>
  );
}
