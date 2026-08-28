/**
 * How a name reaches the client — POOLSE-32.
 *
 * The rules themselves are in the database (migration `name-order`), for the
 * reason set out there: the sort key has to be indexable because POOLSE-29
 * paginates server-side, and once one of the three forms lives in SQL, a second
 * implementation anywhere else is a guarantee that somebody fixes a particle bug
 * in only one of them.
 *
 * This module is the other half of that decision. It is not a second
 * implementation — it is the list of call sites, written once, so that a query
 * asks for "the display name of this alias" rather than spelling out a function
 * call it could spell out slightly differently. Before this, four queries
 * composed a name four ways and one of them produced "Silva, Maria".
 *
 * **Three forms, and picking the wrong one is the whole bug this ticket fixes:**
 *
 *   `displayName`  every part, first name first. Detail pages, and every
 *                  document, export and invoice. Criterion 3 — no abbreviation
 *                  ever reaches a document.
 *   `shortName`    first given name + last surname. Lists, cards, turma rosters
 *                  and the calendar, where a five-part Portuguese name breaks
 *                  the layout. Criterion 2.
 *   `nameOrder`    the ORDER BY. By surname, in Portuguese. Criterion 5 — the
 *                  order people read and the order they scan by are different
 *                  things.
 *
 * Every list endpoint returns both name forms alongside the parts, so the client
 * renders what the server composed rather than composing it again and
 * differently.
 */

/**
 * The full legal name of a table with `first_name` / `last_name` columns —
 * `student`, or a `membership` whose own columns hold the name.
 */
export const displayName = (alias: string): string =>
  `display_name(${alias}.first_name, ${alias}.last_name)`;

/** The list form: "Maria Joana Ferreira Silva Santos" renders "Maria Santos". */
export const shortName = (alias: string): string =>
  `short_name(${alias}.first_name, ${alias}.last_name)`;

/**
 * The ORDER BY expression for those same columns.
 *
 * `COLLATE pt_pt` is not optional and not decoration: without it Postgres uses
 * the database's default collation, which files "Álvares" after "Zé" and makes
 * a list look shuffled to anybody with an accent in their name. It also has to
 * match `student_sort_name_idx` exactly, or the index cannot serve the sort.
 */
export const nameOrder = (alias: string): string =>
  `name_sort_key(${alias}.first_name, ${alias}.last_name) COLLATE pt_pt`;

/**
 * The same three, for a `membership` — which may take its name from Clerk's
 * cache instead of its own columns.
 *
 * These take the membership id rather than an alias, because resolving the name
 * needs the join to `app_user` and the SQL functions do it themselves. That
 * keeps decision 3's ownership rule — Clerk owns the name where there is a
 * login — stated in one place rather than re-coalesced by every query.
 */
export const personName = (idExpression: string): string => `person_name(${idExpression})`;
export const personShortName = (idExpression: string): string =>
  `person_short_name(${idExpression})`;
export const personOrder = (idExpression: string): string =>
  `person_sort_key(${idExpression}) COLLATE pt_pt`;

/**
 * The two composed forms a list row carries, alongside its name parts.
 *
 * Named as an interface rather than repeated inline so that adding a third form
 * later is one change, and so a row type that forgets one fails to compile
 * rather than silently rendering a name the client had to assemble.
 */
export interface ComposedName {
  /** Every part, first name first. The detail page and every document. */
  displayName: string;
  /** First given name + last surname. Lists, cards, rosters, the calendar. */
  shortName: string;
}
