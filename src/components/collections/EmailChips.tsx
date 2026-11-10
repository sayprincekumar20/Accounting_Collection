import { useState } from "react";
import { X } from "lucide-react";
import { isEmailAddress, splitAddresses } from "@/lib/email-signature";

/** To / Cc / Bcc as chips: Enter, comma or space adds an address; x removes it; invalid ones are red. */
export function EmailChips({
  value,
  onChange,
  disabled,
  placeholder,
  autoFocus,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  /** Highlight the field (e.g. Forward without a recipient). */
  invalid?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const list = splitAddresses(value);
  const commit = (raw: string) => {
    const add = splitAddresses(raw).filter((a) => !list.includes(a));
    if (add.length) onChange([...list, ...add].join(", "));
    setDraft("");
  };
  const remove = (a: string) => onChange(list.filter((x) => x !== a).join(", "));
  return (
    <div
      className={`flex min-w-0 flex-1 flex-wrap items-center gap-1 rounded-lg border bg-background px-2 py-1 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 ${invalid ? "border-destructive/60" : "border-border"}`}
    >
      {list.map((a) => (
        <span
          key={a}
          className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${isEmailAddress(a) ? "bg-secondary text-secondary-foreground" : "bg-destructive/12 text-destructive"}`}
          title={isEmailAddress(a) ? a : `Not a valid email address: ${a}`}
        >
          <span className="truncate">{a}</span>
          {!disabled ? (
            <button
              type="button"
              aria-label={`Remove ${a}`}
              onClick={() => remove(a)}
              className="rounded-full hover:opacity-70"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </span>
      ))}
      <input
        value={draft}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={list.length ? "" : (placeholder ?? "name@example.com")}
        onChange={(e) => {
          const v = e.target.value;
          if (/[,;\s]$/.test(v)) commit(v);
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft.trim()) {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && !draft && list.length) {
            remove(list[list.length - 1]!);
          }
        }}
        onBlur={() => draft.trim() && commit(draft)}
        className="min-w-[8rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm text-foreground outline-none"
      />
    </div>
  );
}
