import type { InstructorState } from './grid-layout';

/**
 * What the grid is showing, as a URL — POOLSE-54, criteria 5 and 9.
 *
 * The screen keeps five of its filters in `localStorage`, because density and
 * "which tank" are the viewer's own habits. An **export** cannot work that way:
 * a sheet that goes on a wall has to say what it was filtered by, and a link
 * somebody sends a colleague has to reproduce the same sheet tomorrow. So the
 * export link carries every filter explicitly, and this module is the one place
 * that knows their names.
 *
 * **The parameter names are Portuguese, and so are their values.** These URLs
 * get pasted into messages between people who run a swimming club; `?estado=
 * sem-professor&tanque=…` reads like the screen it opens. The ids inside are
 * uuids either way, so nothing is lost by making the keys readable.
 */
export interface GridFilters {
  /** A pool id, `all` for every tank, or '' for the screen's default (the first). */
  poolId: string;
  instructorId: string;
  categoryId: string;
  partnerId: string;
  levelId: string;
  /** The staffing filter — POOLSE-53. Null means every state. */
  staffing: InstructorState | null;
}

export const NO_FILTERS: GridFilters = {
  poolId: '',
  instructorId: '',
  categoryId: '',
  partnerId: '',
  levelId: '',
  staffing: null,
};

/**
 * The query parameter each filter travels under.
 *
 * `estado` and not `professor` for the staffing state, because `professor` is
 * the instructor filter and one word cannot be two questions. POOLSE-53 shipped
 * the staffing filter under `professor` a day before this module existed and it
 * is renamed here rather than left to collide — an unreleased branch is the
 * cheapest moment this will ever be renamed.
 */
export const FILTER_PARAM = {
  pool: 'tanque',
  instructor: 'professor',
  category: 'categoria',
  partner: 'parceria',
  level: 'nivel',
  staffing: 'estado',
  season: 'epoca',
  facility: 'local',
  paper: 'papel',
} as const;

/** `sem-professor` / `a-definir` on the wire; the enum's own words in the code. */
const STAFFING_VALUE: Record<'uncovered' | 'to_define', string> = {
  uncovered: 'sem-professor',
  to_define: 'a-definir',
};

export function staffingParam(state: InstructorState | null): string | null {
  if (state === 'uncovered') return STAFFING_VALUE.uncovered;
  if (state === 'to_define') return STAFFING_VALUE.to_define;
  return null;
}

export function parseStaffing(raw: string | null): InstructorState | null {
  if (raw === STAFFING_VALUE.uncovered) return 'uncovered';
  if (raw === STAFFING_VALUE.to_define) return 'to_define';
  return null;
}

/** Anything unrecognised reads as absent — a mistyped link still gives a sheet. */
export function readGridFilters(params: URLSearchParams): GridFilters {
  const read = (name: string): string => (params.get(name) ?? '').trim();

  return {
    poolId: read(FILTER_PARAM.pool),
    instructorId: read(FILTER_PARAM.instructor),
    categoryId: read(FILTER_PARAM.category),
    partnerId: read(FILTER_PARAM.partner),
    levelId: read(FILTER_PARAM.level),
    staffing: parseStaffing(params.get(FILTER_PARAM.staffing)),
  };
}

/**
 * The filters as a query string, for the export links on the toolbar.
 *
 * Empty values are omitted rather than written as `&categoria=`, so an
 * unfiltered export has a short URL and `hasFilters` below can simply ask
 * whether anything is set.
 */
export function gridFilterQuery(
  filters: GridFilters,
  extra: Record<string, string | null | undefined> = {},
): URLSearchParams {
  const query = new URLSearchParams();

  const put = (name: string, value: string | null | undefined): void => {
    if (value !== null && value !== undefined && value !== '') query.set(name, value);
  };

  put(FILTER_PARAM.pool, filters.poolId);
  put(FILTER_PARAM.instructor, filters.instructorId);
  put(FILTER_PARAM.category, filters.categoryId);
  put(FILTER_PARAM.partner, filters.partnerId);
  put(FILTER_PARAM.level, filters.levelId);
  put(FILTER_PARAM.staffing, staffingParam(filters.staffing));

  for (const [name, value] of Object.entries(extra)) put(name, value);

  return query;
}

/**
 * Is this a partial view?
 *
 * `poolId` is deliberately not counted. The screen defaults to one tank because
 * four tanks of six lanes is 336 rows nobody asked for, so "one pool" is the
 * ordinary state rather than a filter somebody applied — but the *sheet* still
 * names which tank it shows, in its own header, because on paper there is no
 * dropdown to look at.
 */
export function hasFilters(filters: GridFilters): boolean {
  return (
    filters.instructorId !== '' ||
    filters.categoryId !== '' ||
    filters.partnerId !== '' ||
    filters.levelId !== '' ||
    filters.staffing !== null
  );
}

/** The least a booking must be for the filters to judge it. */
export interface Filterable {
  instructorId: string | null;
  categoryId: string | null;
  partnerId: string | null;
  levelId: string | null;
  instructorStatus: InstructorState;
}

/**
 * The filters, applied.
 *
 * The same predicate the screen runs, so an export of a filtered grid contains
 * exactly the blocks that were on screen — which is the whole point of exporting
 * a filtered grid rather than re-choosing the filters on paper.
 *
 * Pools are not filtered here: a pool decides which *lanes* are drawn, which is
 * a property of the rows rather than of the bookings, and a booking whose lane
 * is not on the page simply has no cell to appear in.
 */
export function applyGridFilters<T extends Filterable>(
  bookings: readonly T[],
  filters: GridFilters,
): T[] {
  return bookings.filter(
    (booking) =>
      (filters.instructorId === '' || booking.instructorId === filters.instructorId) &&
      (filters.categoryId === '' || booking.categoryId === filters.categoryId) &&
      (filters.partnerId === '' || booking.partnerId === filters.partnerId) &&
      (filters.levelId === '' || booking.levelId === filters.levelId) &&
      (filters.staffing === null || booking.instructorStatus === filters.staffing),
  );
}

/**
 * The names of the things a sheet was filtered by — criterion 5.
 *
 * On paper there is no toolbar to glance at. A filtered export that did not say
 * so is somebody pinning up half a timetable believing it is all of it, so the
 * sheet states the filter in its header and this builds the sentence.
 *
 * Names, never ids: "Sandra Lopes" is what the reader needs, and a uuid on a
 * wall sheet is worse than saying nothing at all. A filter whose name cannot be
 * found is skipped rather than printed as a uuid — a chosen instructor who has
 * since been archived should not put `a3f9…` on the club's wall.
 */
export interface FilterNames {
  instructors: readonly { id: string; name: string }[];
  categories: readonly { id: string; name: string }[];
  partners: readonly { id: string; name: string }[];
  levels: readonly { id: string; name: string }[];
  /** The words this locale gives `uncovered` and `to_define`. */
  staffing: Record<string, string>;
}

export function describeFilters(filters: GridFilters, names: FilterNames): string[] {
  const found = (
    list: readonly { id: string; name: string }[],
    id: string,
  ): string | null => (id === '' ? null : (list.find((one) => one.id === id)?.name ?? null));

  return [
    found(names.instructors, filters.instructorId),
    found(names.categories, filters.categoryId),
    found(names.partners, filters.partnerId),
    found(names.levels, filters.levelId),
    filters.staffing === null ? null : (names.staffing[filters.staffing] ?? null),
  ].filter((part): part is string => part !== null);
}
