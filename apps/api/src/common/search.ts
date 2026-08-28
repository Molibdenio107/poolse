/**
 * List search — POOLSE-30.
 *
 * **Search is a filter, not a step after one.** It belongs in the same statement
 * as the tenant scope, the role scope and the `LIMIT`, for the reason POOLSE-29
 * gives: a term applied after the window gives page 2 fewer rows than page 1,
 * and a term applied after the *scope* would let somebody search their way into
 * rows the list is not allowed to show.
 *
 * Two decisions live here rather than in each query.
 */

/**
 * Two characters before anything fires.
 *
 * Settled in the backlog round, and it matches what the guardian picker and the
 * city picker already use — one answer in the app rather than three. One letter
 * on a club-sized register is cheap today and is a full scan per keystroke per
 * typist as tenants grow, which is the setting that ages worst.
 *
 * Clearing the box is **not** a one-character search: an empty term means "no
 * filter" and restores the whole list at once. The floor applies to typing, not
 * to stopping.
 */
export const MIN_SEARCH_LENGTH = 2;

/**
 * The term a request is actually asking for, or null for "no filter".
 *
 * Whitespace-only is empty, per the BA note — somebody who hits space has not
 * started a search. Trimmed for comparison; what the box displays is the
 * client's business.
 */
export function readSearch(raw?: string): string | null {
  const term = (raw ?? '').trim();
  return term.length >= MIN_SEARCH_LENGTH ? term : null;
}

/**
 * A case- and accent-insensitive substring test, as a SQL fragment.
 *
 * **`strpos` rather than `LIKE`, and that is a fix rather than a preference.**
 * `LIKE '%' || $1 || '%'` treats `%` and `_` in the *term* as wildcards, so
 * searching for "%" matched all fifty students in the seeded club and "_"
 * matched them too — a search box that returns everything for a punctuation mark
 * reads as broken, and the escaping needed to keep `LIKE` costs more thought
 * than not needing it. `strpos` has no pattern language, so the term is literal
 * by construction — QA 30.12, without a rule anybody has to remember.
 *
 * `strip_accents` on both sides in both directions: "jose" finds "José" and
 * "JOSÉ" finds "jose" (AC7). It is the same function the register's index uses,
 * so search and sort agree about what a letter is.
 *
 * A b-tree cannot serve an infix match, and this does not pretend otherwise —
 * it scans, already scoped to one tenant by RLS. At a few hundred rows per club
 * that is nothing. The answer at ten thousand is `pg_trgm` with a GIN index,
 * not a cleverer predicate.
 *
 * @param haystack a SQL expression for the text being searched
 * @param param    the bind parameter holding the term, e.g. `'$1'`
 */
export function searchPredicate(haystack: string, param: string): string {
  return `(
    ${param}::text IS NULL
    OR strpos(
         lower(strip_accents(${haystack})),
         lower(strip_accents(${param}::text))
       ) > 0
  )`;
}
