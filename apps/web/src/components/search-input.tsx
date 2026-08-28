'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DEBOUNCE_MS, MIN_SEARCH_LENGTH, searchHref, searchIntent } from '@/lib/search';

// Re-exported so the two typeaheads that cannot use this component still share
// its timing and its floor — POOLSE-30.
export { DEBOUNCE_MS, MIN_SEARCH_LENGTH };

/**
 * The one search box — POOLSE-30.
 *
 * **The URL is the state, and that is what makes the hard parts easy.**
 *
 * The obvious build holds results in React state, fetches on each term, and then
 * needs a sequence number to drop the slow response for "ma" that lands after
 * the fast one for "maria" (AC6). This holds no results at all: it writes the
 * term into the query string, and the server component re-renders from it. React
 * supersedes an in-flight transition when a newer one starts, so the older
 * render is abandoned rather than raced — the stale response has nowhere to
 * land, instead of being caught on arrival.
 *
 * It also gets four other things for free rather than by care: the searched view
 * is linkable and survives a refresh, browser back steps through searches, the
 * page resets to 1 because the new URL simply carries no `page`, and the
 * previous results stay on screen throughout because Next keeps the old UI until
 * the new one is ready — which is AC5's "never flicker to empty" without a
 * single guard.
 *
 * What is *not* free, and is handled explicitly: Enter must cancel the pending
 * debounce rather than fire alongside it (AC3), and clearing must not wait 300 ms
 * to give somebody their list back (AC4).
 */
export function SearchInput({
  /** The query-string key. `search` everywhere so far; named so a page can differ. */
  name = 'search',
  label,
  placeholder,
  className,
}: {
  name?: string;
  label: string;
  placeholder?: string;
  className?: string;
}): React.ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const committed = params.get(name) ?? '';

  /*
   * The box is controlled and seeded from the URL, re-seeded only when the URL's
   * own value changes — the same rule as the form fields in `field.tsx`, and for
   * a related reason: re-seeding on every render would fight the typist, since
   * the URL lags what they have typed by up to 300 ms.
   */
  const [term, setTerm] = useState(committed);
  const seeded = useRef(committed);
  if (seeded.current !== committed) {
    seeded.current = committed;
    setTerm(committed);
  }

  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function commit(next: string): void {
    const href = searchHref(pathname, params.toString(), name, next);

    /*
     * `replace`, not `push`: typing "maria" one letter at a time would otherwise
     * leave four dead entries in the history, and browser back would walk them
     * one keystroke at a time instead of leaving the search.
     */
    startTransition(() => router.replace(href, { scroll: false }));
  }

  function schedule(next: string): void {
    if (timer.current !== null) clearTimeout(timer.current);

    switch (searchIntent(next)) {
      // Clearing is immediate. Somebody who wants their whole list back should
      // not wait a third of a second to be given it — AC4.
      case 'clear':
        commit('');
        return;

      // Below the floor nothing is sent, and nothing is *un*sent either: the
      // list on screen stays as it is rather than resetting on the first letter.
      case 'wait':
        return;

      case 'search':
        timer.current = setTimeout(() => commit(next), DEBOUNCE_MS);
    }
  }

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  return (
    <div className={cn('flex min-w-48 flex-1 flex-col gap-2', className)}>
      <label htmlFor={`search-${name}`} className="text-sm text-foreground-muted">
        {label}
      </label>

      <div className="flex items-center gap-2 rounded border border-border bg-background px-3 py-2 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary">
        <Search className="size-4 shrink-0 text-foreground-muted" aria-hidden />

        <input
          id={`search-${name}`}
          type="search"
          value={term}
          /*
           * `aria-busy` rather than only a spinner. The ticket is explicit that
           * the in-flight state must not be carried by a moving graphic alone,
           * and this is the element whose contents are changing.
           */
          aria-busy={pending}
          placeholder={placeholder}
          onChange={(event) => {
            setTerm(event.target.value);
            schedule(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            /*
             * Enter fires now and *cancels* the pending call — AC3, and the
             * ticket's named trap. Without the clearTimeout the debounce would
             * land a second identical request a moment later.
             */
            event.preventDefault();
            if (timer.current !== null) clearTimeout(timer.current);
            commit(term);
          }}
          className="w-full bg-transparent outline-none"
        />

        {/*
          A spinner that holds its space, so the row does not jump by 16px each
          time somebody stops typing.
        */}
        <span aria-hidden className="size-4 shrink-0">
          {pending && (
            <span className="block size-4 animate-spin rounded-full border-2 border-border border-t-primary" />
          )}
        </span>

        {term !== '' && (
          <button
            type="button"
            aria-label={t('search.clear')}
            onClick={() => {
              setTerm('');
              if (timer.current !== null) clearTimeout(timer.current);
              commit('');
            }}
            className="shrink-0 rounded text-foreground-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * What the result count announces, once a search settles.
 *
 * Its own component so the live region is a sibling of the list rather than
 * inside it — a region that is itself replaced on every render announces nothing
 * reliably, because assistive technology watches the element's *contents*.
 *
 * `polite`, so it waits for a pause rather than interrupting; and it renders
 * only the settled count, so typing "maria" announces once rather than once per
 * keystroke — AC13.
 */
export function SearchStatus({
  total,
  term,
}: {
  total: number;
  term: string;
}): React.ReactElement {
  const t = useTranslations();

  return (
    <p aria-live="polite" className="sr-only">
      {term === '' ? t('search.showingAll', { total }) : t('search.results', { total, term })}
    </p>
  );
}
