/**
 * Server-side pagination — POOLSE-29.
 *
 * Lists used to return whatever the tenant had. A club with two hundred alunos
 * got a two-hundred-row page, and the tenants who felt it worst were the ones
 * worth keeping.
 *
 * **The window is applied inside the query, never after it.** That is the whole
 * discipline here: tenant scope, role filter, search and sort all belong to the
 * same statement as `LIMIT`/`OFFSET`. Paginating a set and then filtering it
 * gives page 2 fewer rows than page 1 and looks like data loss.
 *
 * **Which lists are exempt is a written rule, not a judgement call** — see
 * `docs/backlog/CONVENTIONS.md`. A list is exempt only where its length is fixed
 * by the data model or by a fixed window: twelve months of a year grid, the
 * roles enum, one class register, one child's timetable. Anything that grows as
 * the club takes on more people is paginated.
 */

/**
 * Fifteen, everywhere.
 *
 * One constant rather than a per-list choice, so that 15 turning out to be wrong
 * is a one-line change — criterion 8. There is deliberately no user setting and
 * no per-list override.
 */
export const PAGE_SIZE = 15;

/**
 * The most any caller may ask for, whatever the interface offers.
 *
 * This is not a UI concern. A list endpoint with no ceiling is the endpoint
 * somebody uses to dump a tenant's register in one request, so the cap is
 * enforced here and the interface never sends anything but PAGE_SIZE anyway.
 *
 * Clamped rather than rejected: a caller asking for 10 000 gets the first 100
 * with a truthful `total`, which is a useful answer. A 400 would only tell them
 * to send 100 and try again.
 */
export const MAX_PAGE_SIZE = 100;

/** A page request, already coerced into something a query can be built from. */
export interface PageQuery {
  /** 1-based, as it appears in the URL. */
  page: number;
  limit: number;
  /** `(page - 1) * limit`, computed once so no query has to repeat the arithmetic. */
  offset: number;
}

/**
 * Every list response, in one shape — criterion 4.
 *
 * `total` is the count **after** filters and search and **before** the window,
 * because that is what the range label has to say: "16–30 de 214" where 214 is
 * how many matched, not how many exist.
 */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Read `page` and `limit` off a query string, and never throw.
 *
 * A pagination parameter arriving broken is not an error worth failing a page
 * load over: `?page=abc`, `?page=-3` and `?page=` all mean "the caller does not
 * know which page they want", and page 1 is the honest answer. QA 29.7 asks for
 * exactly this, and a 400 here would turn a stale bookmark into an error screen.
 *
 * A page past the end is *not* coerced — it returns an empty window with the
 * true total, so the client can send the reader to the last real page rather
 * than silently showing them page 1 of something they did not ask for (29.6).
 */
export function readPageQuery(page?: string, limit?: string): PageQuery {
  const requestedPage = Number.parseInt(page ?? '', 10);
  const requestedLimit = Number.parseInt(limit ?? '', 10);

  const safePage = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const safeLimit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, MAX_PAGE_SIZE)
      : PAGE_SIZE;

  return { page: safePage, limit: safeLimit, offset: (safePage - 1) * safeLimit };
}

/**
 * `count(*) OVER ()` — the total, from the same statement as the page.
 *
 * Two queries would be two chances for the filter predicate to drift apart, and
 * the symptom of that is a range label that says "of 214" above fifteen rows
 * drawn from a different 214. A window function costs one round trip and cannot
 * disagree with itself.
 *
 * Select it alongside the row columns; `totalOf` reads it back.
 */
export const TOTAL_COUNT = `count(*) OVER ()::int AS total_count`;

/**
 * The total from a windowed result set.
 *
 * Zero when there are no rows, because a window function produces no output
 * without a row to attach it to. That is the right answer when nothing matched
 * — and the wrong one for a page past the end, which is why `windowed` below
 * exists rather than callers using this directly.
 */
export function totalOf(rows: { total_count?: number }[]): number {
  return rows[0]?.total_count ?? 0;
}

/**
 * Run a windowed query and always come back with a truthful total.
 *
 * **The subtlety this exists for.** `count(*) OVER ()` rides along on the rows,
 * which costs one round trip instead of two and means the count and the page can
 * never be computed from different filters. It has one hole: an empty window
 * carries no rows, so it carries no count either — and `?page=999` on a register
 * of fifty came back `{ items: [], total: 0 }`, which is indistinguishable from
 * "nothing matched". The reader saw "no students yet" on a club with fifty, and
 * the client could not send them anywhere better because it had no total to
 * compute a last page from (QA 29.6 and 29.12).
 *
 * So: when a window past page 1 comes back empty, ask once more for a single row
 * from the start, purely to read the count off it. One extra round trip, only on
 * a stale bookmark or a just-archived last row, and never on a page anybody is
 * actually reading. The filter cannot drift because it is the same query with
 * the same parameters inside the same transaction.
 *
 * `run(limit, offset)` is the caller's query with the window bound at the end.
 */
export async function windowed<R extends { total_count: number }, T>(
  page: PageQuery,
  run: (limit: number, offset: number) => Promise<{ rows: R[] }>,
  map: (row: R) => T,
): Promise<Paginated<T>> {
  const { rows } = await run(page.limit, page.offset);

  const total =
    rows.length === 0 && page.page > 1 ? totalOf((await run(1, 0)).rows) : totalOf(rows);

  return paginated(rows.map(map), total, page);
}

/** Assemble the envelope. Trivial, but it keeps the field names in one place. */
export function paginated<T>(items: T[], total: number, query: PageQuery): Paginated<T> {
  return { items, total, page: query.page, limit: query.limit };
}

/**
 * The last page that holds anything, for a given total.
 *
 * At least 1: an empty list is page 1 of 1, not page 1 of 0. The client uses
 * this to bounce `?page=999` back to somewhere real (29.6) and to fall back a
 * page when the last row on the last page is archived (29.12).
 */
export function lastPage(total: number, limit: number): number {
  return Math.max(1, Math.ceil(total / limit));
}
