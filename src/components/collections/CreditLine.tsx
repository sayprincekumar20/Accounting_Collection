/** Credit terms and credit limit of a client (Zoho CRM account, saved by the weekly refresh). */
export function CreditLine({
  terms,
  limit,
}: {
  terms?: string | null | undefined;
  limit?: number | null | undefined;
}) {
  const lim =
    limit != null && Number(limit) > 0
      ? "PHP " +
        Number(limit).toLocaleString("en-PH", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : "not on file";
  return (
    <p className="mt-0.5 text-xs text-muted-foreground">
      Terms: {terms ? terms : "not on file"} · Credit limit: {lim}
    </p>
  );
}
