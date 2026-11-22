import { useEffect, useState } from "react";

/** Pagination bar: 'Showing 1–50 of 138', page size, previous / next. */
export function Pager({
  total,
  page,
  pageSize,
  onPage,
  onPageSize,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? page * pageSize + 1 : 0;
  const to = Math.min(total, (page + 1) * pageSize);
  const btn =
    "h-8 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-muted disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
      <span>
        Showing {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1">
          Per page
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className="h-8 rounded-lg border border-border bg-background px-1.5"
          >
            {[25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={btn} disabled={page <= 0} onClick={() => onPage(page - 1)}>
          ‹ Previous
        </button>
        <span>
          Page {page + 1} of {pages}
        </span>
        <button
          type="button"
          className={btn}
          disabled={page >= pages - 1}
          onClick={() => onPage(page + 1)}
        >
          Next ›
        </button>
      </div>
    </div>
  );
}

/** Page state for a filtered list: back to page 1 whenever the list or the page size changes. */
export function usePaged<T>(list: T[], initialSize = 25) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(initialSize);
  useEffect(() => {
    setPage(0);
  }, [list.length, pageSize]);
  const pages = Math.max(1, Math.ceil(list.length / pageSize));
  const safe = Math.min(page, pages - 1);
  return {
    paged: list.slice(safe * pageSize, (safe + 1) * pageSize),
    pager: { total: list.length, page: safe, pageSize, onPage: setPage, onPageSize: setPageSize },
  };
}
