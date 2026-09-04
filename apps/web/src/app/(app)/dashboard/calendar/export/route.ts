import { getLocale, getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type FacilityGrid } from '@/lib/api';
import { BOOKING_FIELDS, type BookingField } from '@/lib/booking-sheet';
import {
  applyGridFilters,
  describeFilters,
  FILTER_PARAM,
  hasFilters,
  readGridFilters,
} from '@/lib/grid-filters';
import { groupOf } from '@/lib/grid-layout';
import { bookingsCsv, scheduleWorkbook, type SheetWords } from './write-sheet';

/**
 * The timetable as a file — POOLSE-54, criterion 9.
 *
 * A route handler rather than a server action, for the reason the register's
 * export already established: the answer is a file, and a server action returns
 * a value to React. This way the button is an ordinary link, the browser does
 * what browsers do with an attachment, and it works with no JavaScript at all.
 *
 * **Everything it needs is in the URL** — the site, the season and every filter.
 * That is what makes an export reproducible: open the same link tomorrow and get
 * the same sheet, which is QA 54.15 and also the only sane way for a filtered
 * export to be shareable.
 *
 * **Not restricted, and that is a decision rather than an oversight** — criterion
 * 10. The rule is that exports carrying *contracted partnership value* are
 * owner/admin. This one carries none: it is drawn from `/facilities/:id/grid`,
 * which returns the timetable and never touches `partner_agreement`, so there is
 * no unit price, no lane-hour rate and no invoice total anywhere in the file. An
 * instructor may take the wall sheet home, which is the point of a wall sheet.
 * The day a price reaches this file, the role check comes with it.
 */

/**
 * Two formats, and only two.
 *
 * `.xlsx` because it is what a club works in and it is the only one of the two
 * that can hold both sheets. `.csv` because it is the one format every other
 * system on earth reads — and it carries the flat sheet alone, which is the half
 * that survives having no merged cells.
 */
type Format = 'xlsx' | 'csv';

const CONTENT_TYPE: Record<Format, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
};

/** A filename a Windows, macOS and Linux machine will all accept unchanged. */
function fileNameFor(locale: string, filtered: boolean, format: Format): string {
  const base = locale === 'en' ? 'schedule' : 'horario';
  const today = new Date().toISOString().slice(0, 10);
  // ASCII only, deliberately. A `Content-Disposition` carrying accented
  // characters needs the RFC 5987 encoding and is mangled by something in the
  // chain often enough that it is not worth the accent.
  return `poolse-${base}${filtered ? '-filtrado' : ''}-${today}.${format}`;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const facilityId = (url.searchParams.get(FILTER_PARAM.facility) ?? '').trim();
  const seasonId = (url.searchParams.get(FILTER_PARAM.season) ?? '').trim();
  const filters = readGridFilters(url.searchParams);
  // Anything unrecognised falls back to the workbook rather than erroring: a
  // mistyped query parameter should still hand somebody their timetable.
  const format: Format = url.searchParams.get('formato') === 'csv' ? 'csv' : 'xlsx';

  const t = await getTranslations();

  if (facilityId === '') {
    return text(t('grid.export.failed'), 400);
  }

  let grid: FacilityGrid;
  try {
    const query = seasonId === '' ? '' : `?seasonId=${encodeURIComponent(seasonId)}`;
    grid = await apiFetch<FacilityGrid>(`/facilities/${facilityId}/grid${query}`);
  } catch (error) {
    /*
     * Plain text, and the real status. Nothing renders this — it is what a
     * browser shows when a download fails — so a translated page would be
     * ceremony, but a 403 must stay a 403 rather than becoming a corrupt
     * spreadsheet the operator opens and puzzles over.
     */
    const status = error instanceof ApiError ? error.status : 500;
    return text(status === 403 ? t('grid.export.forbidden') : t('grid.export.failed'), status);
  }

  const bookings = applyGridFilters(grid.bookings, filters);

  /*
   * Which lanes the sheet is drawn on: one tank by default, as on screen.
   *
   * A four-tank club with six lanes each is 24 lane rows per start time, which
   * on paper is a sheet nobody can read. `all` is an explicit choice there and
   * an explicit choice here.
   */
  const poolIds =
    filters.poolId === 'all'
      ? grid.pools.map((pool) => pool.id)
      : [grid.pools.find((pool) => pool.id === filters.poolId)?.id ?? grid.pools[0]?.id].filter(
          (id): id is string => id !== undefined,
        );

  const lanes = grid.lanes.filter((lane) => poolIds.includes(lane.poolId));

  /*
   * Only the days the season actually offers a slot on — the same rule the
   * screen follows. A column of seven empty Sundays is a fifth of the page spent
   * on a day the club is shut.
   */
  const days = [1, 2, 3, 4, 5, 6, 7].filter((day) =>
    grid.slots.some((slot) => slot.dayGroup === groupOf(day)),
  );

  const locale = await getLocale();

  /*
   * The filter statement, by name.
   *
   * Levels are not on the grid payload — a turma's level reaches the screen as
   * its `subtitle` — so the names are gathered from the bookings themselves.
   * That is enough for the sentence and avoids a second request for a list the
   * sheet only needs one entry of.
   */
  const levels = [
    ...new Map(
      grid.bookings
        .filter((booking) => booking.levelId !== null && booking.subjectType === 'turma')
        .map((booking) => [booking.levelId as string, booking.subtitle ?? '']),
    ),
  ].map(([id, name]) => ({ id, name }));

  const described = describeFilters(filters, {
    instructors: grid.instructors,
    categories: grid.categories,
    partners: grid.partners,
    levels,
    staffing: {
      uncovered: t('grid.export.status.uncovered'),
      to_define: t('grid.export.status.to_define'),
    },
  });

  const filterLine =
    described.length > 0
      ? t('grid.export.filteredBy', { filters: described.join(', ') })
      : t('grid.export.unfiltered');

  const field = Object.fromEntries(
    BOOKING_FIELDS.map((name) => [name, t(`grid.export.field.${name}`)]),
  ) as Record<BookingField, string>;

  const words: SheetWords = {
    field,
    subject: {
      turma: t('grid.export.subject.turma'),
      parceria: t('grid.export.subject.parceria'),
      evento: t('grid.export.subject.evento'),
      manutencao: t('grid.export.subject.manutencao'),
    },
    status: {
      assigned: t('grid.export.status.assigned'),
      to_define: t('grid.export.status.to_define'),
      external: t('grid.export.status.external'),
      uncovered: t('grid.export.status.uncovered'),
    },
    weekday: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((day) => [day, t(`week.${day}`)])),
    scheduleSheet: t('grid.export.scheduleSheet'),
    bookingsSheet: t('grid.export.bookingsSheet'),
    noLane: t('grid.export.noLane'),
    offGrid: t('grid.export.offGrid'),
    title: t('grid.export.printTitle', { facility: grid.facilityName }),
    /*
     * The season, and what the sheet was filtered by — criterion 5.
     *
     * On paper there is no toolbar to glance at, so a filtered export that did
     * not say so is somebody pinning up half a timetable believing it is all of
     * it. A draft says so too, in the same line.
     */
    subtitle: [
      grid.seasonName ?? '',
      grid.seasonStatus === 'draft' ? t('grid.export.draft') : '',
      filterLine,
    ]
      .filter((part) => part !== '')
      .join(' · '),
  };

  const sheet = { slots: grid.slots, lanes, bookings, days };
  const body = format === 'csv' ? bookingsCsv(sheet, words) : await scheduleWorkbook(sheet, words);

  return new Response(body, {
    headers: {
      'content-type': CONTENT_TYPE[format],
      'content-disposition': `attachment; filename="${fileNameFor(locale, hasFilters(filters), format)}"`,
      // A timetable changes as a season is built and this is a snapshot of it; a
      // cached copy handed back tomorrow would be wrong in a way nobody would
      // think to check.
      'cache-control': 'no-store',
    },
  });
}

function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
