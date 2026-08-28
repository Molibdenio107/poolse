/**
 * Live search — POOLSE-30, the pure half.
 *
 * The component in `components/search-input.tsx` owns the input, the debounce
 * and the transition. Everything decidable without a DOM lives here, so the
 * rules that are easy to get subtly wrong — when a request is worth making, and
 * what the resulting URL is — can be tested rather than reasoned about.
 */

/**
 * ~300 ms. Long enough that a normal typist does not fire a request per letter,
 * short enough to feel live.
 *
 * One constant for the whole app. The city picker used 300 and the guardian
 * picker 250, which is exactly the drift the ticket predicts when each page
 * writes its own debounce; both read this now.
 */
export const DEBOUNCE_MS = 300;

/**
 * Two characters, matching `MIN_SEARCH_LENGTH` in the API.
 *
 * Settled in the backlog round. One letter on a club-sized register is cheap
 * today and is a full scan per keystroke per typist as tenants grow — the
 * setting that ages worst. The API ignores a shorter term whatever arrives, so
 * this only avoids a round trip that would have changed nothing.
 */
export const MIN_SEARCH_LENGTH = 2;

/** What a term means once whitespace stops counting. */
export type SearchIntent =
  /** Restore the whole list, and do it now rather than in 300 ms. */
  | 'clear'
  /** Below the floor. Leave the list exactly as it is — do not reset it. */
  | 'wait'
  /** Worth a request, after the debounce. */
  | 'search';

/**
 * Whether a term is worth sending, and how urgently.
 *
 * The three-way answer is the point. Treating "below the floor" as "clear" would
 * make the list flash back to everything on the first letter of every search;
 * treating it as "search" would send the one-character scan the floor exists to
 * prevent. Whitespace-only is a clear, per the BA note — somebody who hit space
 * has not started a search.
 */
export function searchIntent(term: string): SearchIntent {
  const trimmed = term.trim();
  if (trimmed === '') return 'clear';
  return trimmed.length < MIN_SEARCH_LENGTH ? 'wait' : 'search';
}

/**
 * The URL a term commits to.
 *
 * **Dropping `page` is the whole of POOLSE-29 criterion 5 on these pages.** Not
 * "set page to 1" — deleted, because page 1 is the absence of the parameter, and
 * because a deletion cannot leave a stale value behind. There is no moment where
 * the client holds the new term and the old page, so the ticket's "most likely
 * to be got wrong" — a request for page 7 of a fresh search, and the empty-state
 * flash that follows — cannot happen here.
 *
 * Every other parameter survives: a search inside a level filter or a role chip
 * stays inside it.
 */
export function searchHref(
  pathname: string,
  current: URLSearchParams | string,
  name: string,
  term: string,
): string {
  const query = new URLSearchParams(current.toString());
  const trimmed = term.trim();

  if (trimmed === '') query.delete(name);
  else query.set(name, trimmed);

  query.delete('page');

  return query.size > 0 ? `${pathname}?${query}` : pathname;
}
