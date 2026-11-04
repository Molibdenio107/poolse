'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

/**
 * A dropdown filter that writes itself into the URL — POOLSE-30.
 *
 * It exists because AC2 removes the submit button. The register's level filter
 * used to travel with the search term when somebody pressed "Pesquisar"; with no
 * button, a `<select>` inside a GET form has nothing to submit it, and the
 * honest fix is for the filter to commit itself the way the search box now does.
 *
 * Same three properties as `SearchInput`, for the same reason — the URL is the
 * state: the filtered view is linkable, browser back steps through filters, and
 * changing the filter resets to page 1 because the new URL simply carries no
 * `page`. No debounce, because a select fires once when somebody has decided.
 */
export function FilterSelect({
  name,
  label,
  value,
  options,
  /** The label for "no filter" — "Todos os níveis". */
  anyLabel,
  hideLabel = false,
}: {
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  anyLabel: string;
  /**
   * The label for a screen reader only, where the select stands as a column's
   * header and its first option is the prompt (the staff table, 04-11-2026).
   */
  hideLabel?: boolean;
}): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function choose(next: string): void {
    const query = new URLSearchParams(params.toString());

    if (next === '') query.delete(name);
    else query.set(name, next);

    // A different filter is a different result set, so page 7 of the old one
    // means nothing — POOLSE-29 criterion 5.
    query.delete('page');

    const href = query.size > 0 ? `${pathname}?${query}` : pathname;
    startTransition(() => router.replace(href, { scroll: false }));
  }

  return (
    // Same height and density as the search box beside it — `h-control` and
    // `text-sm` are the shared tokens, so the filter row lands on one baseline
    // instead of on two.
    <div className="flex min-w-40 max-w-field flex-col gap-1.5">
      <label htmlFor={`filter-${name}`} className={hideLabel ? 'sr-only' : 'text-sm text-foreground-muted'}>
        {label}
      </label>
      <select
        id={`filter-${name}`}
        value={value}
        aria-busy={pending}
        onChange={(event) => choose(event.target.value)}
        className="h-control rounded-sm border border-border-strong bg-background px-2.5 text-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <option value="">{anyLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
