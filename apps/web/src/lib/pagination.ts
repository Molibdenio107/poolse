/**
 * Paging a list, on the client side — POOLSE-29.
 *
 * The API owns the window; this owns the URL. Both halves share one page size
 * so that 15 turning out to be wrong is one line in each, and criterion 8 is
 * about exactly that.
 *
 * **The page lives in the query string, not in component state.** Criterion 6
 * asks for a linkable page, but the deeper reason is that these list pages are
 * server components whose filters are already a plain GET form — a page held in
 * React state would be the one piece of list state that did not survive a
 * refresh, and the only one a colleague could not be sent a link to.
 *
 * Nothing here is a hook and nothing is client-side. The control is links.
 */

/**
 * Fifteen, matching `PAGE_SIZE` in the API.
 *
 * Duplicated across the app boundary knowingly, the way `MEMBER_ROLES` is: the
 * alternative is a shared package for one integer. The API is the authority —
 * it clamps whatever arrives — so a drift here shows up as a short page rather
 * than as a way around the server's cap.
 */
export const PAGE_SIZE = 15;

/** The envelope every list endpoint returns. Mirrors `Paginated<T>` in the API. */
export interface Paginated<T> {
  items: T[];
  /** After search and filters, before the window. What the range label counts. */
  total: number;
  page: number;
  limit: number;
}

/**
 * The page a URL is asking for.
 *
 * Never throws and never returns something a query cannot use: `?page=abc`,
 * `?page=-3` and `?page=` all mean the reader does not know which page they
 * want, and 1 is the honest answer (QA 29.7). A stale bookmark should not be an
 * error screen.
 */
export function readPage(param?: string): number {
  const page = Number.parseInt(param ?? '', 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

/**
 * The last page that holds anything.
 *
 * At least 1, because an empty list is page 1 of 1 rather than page 1 of 0 —
 * and a control reading "page 1 of 0" is how a reader learns not to trust the
 * numbers.
 */
export function lastPage(total: number, limit: number = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / limit));
}

/**
 * The inclusive row numbers this page is showing — "16–30 of 214".
 *
 * `to` is clamped to the total so the last page reads "211–214 de 214" rather
 * than promising fifteen rows it does not have.
 */
export function pageRange(
  page: number,
  limit: number,
  total: number,
): { from: number; to: number } {
  if (total === 0) return { from: 0, to: 0 };
  return { from: (page - 1) * limit + 1, to: Math.min(page * limit, total) };
}

/**
 * A link to another page of the same list.
 *
 * Takes the whole current query and replaces only `page`, so paging never drops
 * the search term or the level filter somebody set — criterion 5 is about the
 * other direction (a filter change resets the page) and this is its pair.
 *
 * **Page 1 is the absence of the parameter.** One convention everywhere, per the
 * BA note: it keeps the first page's URL clean and makes "is this the default
 * view" a question with one answer rather than two equivalent URLs.
 */
export function pageHref(
  basePath: string,
  current: Record<string, string | undefined>,
  page: number,
): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(current)) {
    if (key !== 'page' && value !== undefined && value.trim() !== '') {
      query.set(key, value.trim());
    }
  }

  if (page > 1) query.set('page', String(page));

  return query.size > 0 ? `${basePath}?${query}` : basePath;
}

/**
 * Whether a requested page has fallen off the end of the list.
 *
 * Two things cause it and both are ordinary: a link to `?page=999` (29.6), and
 * archiving the last row on the last page (29.12). The caller redirects to
 * `lastPage` rather than rendering an empty list under a control claiming page
 * 15 of 14.
 *
 * Deliberately not "page > lastPage" alone — a page 1 that is empty because the
 * whole list is empty is not out of range, it is an empty list, and it must
 * render the list's own empty state.
 */
export function isPastEnd(page: number, total: number, limit: number = PAGE_SIZE): boolean {
  return total > 0 && page > lastPage(total, limit);
}
