import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ApiError, apiFetch, type FacilityGrid, type GridBooking } from '@/lib/api';
import {
  applyGridFilters,
  describeFilters,
  FILTER_PARAM,
  readGridFilters,
  type GridFilters,
} from '@/lib/grid-filters';
import {
  cellAt,
  groupOf,
  instructorDisplay,
  rowTimes,
  slotAt,
  slotsFor,
  toMinutes,
  toTime,
  type PlacedCell,
} from '@/lib/grid-layout';
import { PrintButton } from '../../facilities/pools/[poolId]/report/print-button';

/**
 * The timetable, for the wall — POOLSE-54.
 *
 * **The printed sheet is the product, as far as the club is concerned.** It goes
 * on the wall by the office, it goes to the school, it goes home with the head
 * coach. A scheduler that cannot produce it has moved the club's work into a
 * computer and left the artefact behind.
 *
 * **A print page, not a generated PDF** — criterion 11, and the same call the
 * water-quality report already made and wrote down: every browser has a mature
 * PDF writer behind Ctrl+P, and "Save as PDF" from a page laid out for paper
 * beats a hand-built document on fonts, accents and selectable text. A PDF
 * library would be a second layout engine that knows nothing about this app.
 *
 * **A separate render, not a print stylesheet over the grid** — criterion 8, and
 * the thing the ticket's Dev note says is most likely to be got wrong. The
 * screen has sticky rails, a scroll container, drag targets and a density
 * toggle; the sheet has a fixed page, headers that repeat on page two, and no
 * interaction. What the two share is `lib/grid-layout.ts` — the placement engine
 * — so they can differ in every way except *which class is in lane 3 at 09:30*.
 *
 * **It is a real `<table>`, and that is load-bearing.** A browser repeats
 * `<thead>` at the top of every printed page for free (54.6), and `break-inside:
 * avoid` on a `<tbody>` keeps a slot's six lane rows together (54.5). Doing this
 * with the screen's CSS grid would mean computing page breaks by hand.
 *
 * **Monochrome, and it has to survive a photocopier** — criterion 3. Every
 * cell's meaning is text: the group name, the instructor and the headcount are
 * written, the legend is written, and an uncovered slot carries `!!` beside the
 * words as a mark that survives greyscale. Colour is printed where a category
 * has one, but nothing depends on it.
 */

/** What one square of the sheet turns out to be, once the spans are resolved. */
type PrintCell =
  | { kind: 'block'; cell: PlacedCell<GridBooking & { startMinutes: number }> }
  | { kind: 'covered' }
  | { kind: 'closed' }
  | { kind: 'empty' };

export default async function SchedulePrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const one = (name: string): string => {
    const value = params[name];
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
  };

  const facilityId = one(FILTER_PARAM.facility);
  const seasonId = one(FILTER_PARAM.season);
  // A4 unless A3 was asked for. Fourteen slots by six lanes by five days does
  // not fit A4 at a size anybody can read from a metre away, and the honest
  // options are a second page size or a font nobody can read — so, both sizes.
  const paper = one(FILTER_PARAM.paper) === 'a3' ? 'A3' : 'A4';

  if (facilityId === '') notFound();

  const t = await getTranslations();
  const format = await getFormatter();

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const single = Array.isArray(value) ? value[0] : value;
    if (single !== undefined) search.set(key, single);
  }
  const filters: GridFilters = readGridFilters(search);

  let grid: FacilityGrid;
  try {
    const query = seasonId === '' ? '' : `?seasonId=${encodeURIComponent(seasonId)}`;
    grid = await apiFetch<FacilityGrid>(`/facilities/${facilityId}/grid${query}`);
  } catch (error) {
    // A 404 is a site that is not this tenant's, which is the same answer — 54.13.
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }

  const bookings = applyGridFilters(grid.bookings, filters).map((booking) => ({
    ...booking,
    startMinutes: toMinutes(booking.startTime),
  }));

  /*
   * One tank unless every tank was asked for — the screen's own default, and for
   * the same reason: four tanks of six lanes is 24 lane rows per start time,
   * which on paper is a sheet nobody can read at any page size.
   */
  const poolIds =
    filters.poolId === 'all'
      ? grid.pools.map((pool) => pool.id)
      : [grid.pools.find((pool) => pool.id === filters.poolId)?.id ?? grid.pools[0]?.id].filter(
          (id): id is string => id !== undefined,
        );

  const lanes = grid.lanes.filter((lane) => poolIds.includes(lane.poolId));
  const laneKeys = new Set(lanes.map((lane) => lane.id));
  const manyPools = poolIds.length > 1;

  // Only the days the season offers a slot on. A column of empty Sundays is a
  // fifth of the page spent on a day the club is shut.
  const days = [1, 2, 3, 4, 5, 6, 7].filter((day) =>
    grid.slots.some((slot) => slot.dayGroup === groupOf(day)),
  );

  const times = rowTimes(grid.slots, days);

  /*
   * The sheet, resolved before anything is rendered.
   *
   * `cellAt` answers for the lane a booking *starts* on and says how many lanes
   * it takes. In a CSS grid the lanes it swallows simply have nothing placed on
   * them; in a table they must emit **no `<td>` at all**, or the row grows by
   * one cell and every day to the right of it shifts across by a column.
   *
   * So the whole sheet is walked once here and each cell comes out as one of
   * three things — a block, an empty cell, or nothing — and the render below
   * just prints what it is told.
   */
  const sheet = layOut();

  function layOut(): Map<string, PrintCell> {
    const map = new Map<string, PrintCell>();

    for (const startTime of times) {
      for (const day of days) {
        const slot = slotAt(grid.slots, day, startTime);

        if (slot === undefined) {
          for (const lane of lanes) map.set(`${startTime}|${day}|${lane.id}`, { kind: 'closed' });
          continue;
        }

        const daySlots = slotsFor(grid.slots, day);

        lanes.forEach((lane, laneIndex) => {
          const key = `${startTime}|${day}|${lane.id}`;
          // Already swallowed by a block that began on a lane above this one.
          if (map.has(key)) return;

          const cell = cellAt(bookings, day, lane.id, slot, daySlots, laneKeys);
          if (cell === null) {
            map.set(key, { kind: 'empty' });
            return;
          }

          map.set(key, { kind: 'block', cell });

          for (let below = 1; below < cell.span; below += 1) {
            const swallowed = lanes[laneIndex + below];
            if (swallowed !== undefined) {
              map.set(`${startTime}|${day}|${swallowed.id}`, { kind: 'covered' });
            }
          }
        });
      }
    }

    return map;
  }

  /*
   * The legend is built from what is actually on the sheet, not from every
   * category the club has ever defined — the same rule the screen's legend
   * follows. A legend listing eight colours for a sheet showing two is a legend
   * nobody reads twice, and on paper it is ink spent on nothing.
   */
  const legend = [
    ...new Map(
      bookings
        .filter((booking) => booking.categoryName !== null)
        .map((booking) => [booking.categoryId as string, booking.categoryName as string]),
    ),
  ].map(([id, name]) => ({ id, name }));

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

  /*
   * Everything the grid cannot draw, named underneath rather than dropped — the
   * same block the screen carries. A booking whose time matches no slot, or
   * whose day this sheet does not show, is still a class that occupies the pool.
   */
  const offGrid = bookings.filter(
    (booking) =>
      booking.slotId === null ||
      !days.includes(booking.weekday) ||
      !booking.laneIds.some((id) => laneKeys.has(id)),
  );

  const poolName =
    manyPools
      ? null
      : (grid.pools.find((pool) => pool.id === poolIds[0])?.name ?? null);

  return (
    <main className="bg-white p-6 text-black print:p-0">
      {/*
        The page geometry, and the only two things on this page that are CSS
        rather than markup. `@page` is not expressible in Tailwind, and the size
        has to be chosen per request — so it is a style tag with one rule in it.

        `landscape` is not negotiable: the sheet is five days wide.
      */}
      <style>{`
        @page { size: ${paper} landscape; margin: 8mm; }
        @media print {
          /* A slot's lane rows stay together — 54.5. */
          tbody { break-inside: avoid; page-break-inside: avoid; }
          /* And the day names come back at the top of page two — 54.6. */
          thead { display: table-header-group; }
        }
      `}</style>

      {/*
        `print:hidden` is what lets these controls live on the page they print:
        on screen while somebody chooses a paper size, absent from the paper.
      */}
      <div className="mb-6 flex flex-wrap items-center gap-3 print:hidden">
        <PrintButton label={t('grid.export.print')} />
        <span className="text-sm">{t('grid.export.paper')}:</span>
        {(['a4', 'a3'] as const).map((size) => {
          const next = new URLSearchParams(search);
          next.set(FILTER_PARAM.paper, size);
          return (
            <a
              key={size}
              href={`?${next}`}
              aria-current={paper.toLowerCase() === size ? 'page' : undefined}
              className={`rounded border px-2 py-1 text-sm ${
                paper.toLowerCase() === size ? 'border-black font-semibold' : 'border-black/30'
              }`}
            >
              {size.toUpperCase()}
            </a>
          );
        })}
      </div>

      <header className="mb-3 border-b border-black/40 pb-2">
        <h1 className="text-xl font-bold">
          {t('grid.export.printTitle', { facility: grid.facilityName })}
        </h1>
        <p className="mt-0.5 text-sm">
          {[grid.seasonName, poolName].filter((part) => part !== null).join(' · ')}
        </p>

        {/*
          A draft is next year's plan. Saying so on the sheet is the difference
          between a planning document and a timetable somebody follows — 54.11.
        */}
        {grid.seasonStatus === 'draft' && (
          <p className="mt-1 inline-block border-2 border-black px-2 py-0.5 text-sm font-bold uppercase">
            {t('grid.export.draft')}
          </p>
        )}

        {/*
          What this sheet is not showing — 54.4. On paper there is no toolbar to
          glance at, so a filtered sheet that did not say so is somebody pinning
          up half a timetable believing it is all of it.
        */}
        <p className="mt-1 text-sm font-medium">
          {described.length > 0
            ? t('grid.export.filteredBy', { filters: described.join(', ') })
            : t('grid.export.unfiltered')}
        </p>

        <p className="mt-0.5 text-xs">
          {t('grid.export.generated', {
            date: format.dateTime(new Date(), { dateStyle: 'long', timeStyle: 'short' }),
          })}
        </p>
      </header>

      <table className="w-full border-collapse text-[8.5pt] leading-tight">
        <caption className="sr-only">
          {t('grid.export.printTitle', { facility: grid.facilityName })}
        </caption>

        <thead>
          <tr>
            <th className="border border-black/50 px-1 py-0.5 text-left align-bottom">
              {t('grid.export.field.startTime')}
            </th>
            <th className="border border-black/50 px-1 py-0.5 text-left align-bottom">
              {t('grid.export.field.lanes')}
            </th>
            {days.map((day) => (
              <th key={day} className="border border-black/50 px-1 py-0.5 text-center align-bottom">
                {t(`week.${day}`)}
              </th>
            ))}
          </tr>
        </thead>

        {times.map((startTime) => (
          <tbody key={startTime} className="break-inside-avoid">
            {lanes.map((lane, laneIndex) => (
              <tr key={lane.id}>
                {/*
                  The hour, once per slot rather than once per lane. Six repeats
                  of "09:30" is six times the ink for one fact, and the eye stops
                  reading it — so it spans its lane rows, as on screen.
                */}
                {laneIndex === 0 && (
                  <th
                    scope="rowgroup"
                    rowSpan={lanes.length}
                    className="w-[11mm] border border-black/50 px-1 py-0.5 text-left align-top font-mono text-[8pt] font-normal"
                  >
                    {startTime}
                  </th>
                )}
                <th
                  scope="row"
                  className="w-[22mm] border border-black/50 px-1 py-0.5 text-left align-top text-[8pt] font-normal"
                >
                  {manyPools ? `${lane.poolName} · ${lane.name}` : lane.name}
                </th>

                {days.map((day) => {
                  const cell = sheet.get(`${startTime}|${day}|${lane.id}`);

                  // A lane a block above it already covers. No element at all —
                  // an empty `<td>` here would push the rest of the week right.
                  if (cell === undefined || cell.kind === 'covered') return null;

                  if (cell.kind === 'closed') {
                    /*
                      A day with no slot at this time. Hatched rather than blank:
                      an empty cell on a wall sheet reads as "free", and this is
                      "the club does not run anything then", which is a different
                      thing to tell somebody looking for water.
                    */
                    return (
                      <td
                        key={day}
                        className="border border-black/50 bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(0,0,0,0.12)_3px,rgba(0,0,0,0.12)_6px)]"
                      />
                    );
                  }

                  if (cell.kind === 'empty') {
                    return <td key={day} className="border border-black/50 px-1 py-0.5" />;
                  }

                  return (
                    <Cell
                      key={day}
                      booking={cell.cell.booking}
                      continues={cell.cell.continues}
                      span={cell.cell.span}
                      words={{
                        uncovered: t('grid.export.status.uncovered'),
                        toDefine: t('grid.export.status.to_define'),
                      }}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        ))}
      </table>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4 text-[8pt]">
        {/*
          The legend, as words. On a photocopy the swatches are all grey, so the
          category's name is what identifies it — criterion 3. The swatch is a
          convenience for the colour copy, never the carrier of the meaning.
        */}
        {legend.length > 0 && (
          <div>
            <p className="font-bold">{t('grid.export.legend')}</p>
            <ul className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5">
              {legend.map((category) => (
                <li key={category.id}>{category.name}</li>
              ))}
            </ul>
          </div>
        )}

        <p>
          {/* The mark's own key, so `!!` is never a mystery on a photocopy. */}
          <span className="font-mono font-bold">!!</span> = {t('grid.export.status.uncovered')}
          {' · '}
          <span className="font-mono">???</span> = {t('grid.export.status.to_define')}
        </p>
      </div>

      {offGrid.length > 0 && (
        <section className="mt-3 border-t border-black/40 pt-2 text-[8pt]">
          <p className="font-bold">{t('grid.export.offGrid')}</p>
          <ul className="mt-0.5 flex flex-col gap-0.5">
            {offGrid.map((booking) => (
              <li key={booking.id} className="flex flex-wrap gap-x-3">
                <span className="font-mono">{booking.startTime}</span>
                <span>{t(`week.${booking.weekday}`)}</span>
                <span className="font-semibold">{booking.name}</span>
                {booking.laneIds.length === 0 && <span>{t('grid.export.noLane')}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

/**
 * One class on the sheet — criterion 3, and the reason the whole page is
 * monochrome.
 *
 * Three lines, all of them text: what it is, who is running it, and how many.
 * That is what makes the sheet survive a photocopier, and it is also what makes
 * it readable at a metre — a reader is looking for a name, not a colour.
 *
 * `rowSpan` is what makes a three-lane class one block rather than three copies
 * of it (54.7); the row above skips the lanes it swallows.
 */
function Cell({
  booking,
  continues,
  span,
  words,
}: {
  booking: GridBooking & { startMinutes: number };
  continues: boolean;
  span: number;
  words: { uncovered: string; toDefine: string };
}): React.ReactElement {
  const who = instructorDisplay(booking);

  return (
    <td
      rowSpan={span}
      className="border border-black/50 px-1 py-0.5 align-top"
      // A left rule in the category's colour where there is one. It costs almost
      // no toner, adds nothing a greyscale reader needs, and helps somebody
      // scanning a colour copy for "the school block".
      style={
        booking.partnerColour === null
          ? undefined
          : { borderLeft: `2.5pt solid ${booking.partnerColour}` }
      }
    >
      <span className="block font-semibold">
        {continues ? `(${booking.name})` : booking.name}
        {/*
          The end time, on a class that is not one row long. Without it a reader
          cannot tell a 45-minute class from a 90-minute one on paper, where
          there is nothing to hover over.
        */}
        {!continues && (
          <span className="ml-1 font-mono text-[7pt] font-normal">
            {toTime(booking.startMinutes + booking.durationMinutes)}
          </span>
        )}
      </span>

      <span className="block">
        {who.state === 'uncovered' && <span className="mr-1 font-mono font-bold">!!</span>}
        {who.state === 'to_define' && <span className="mr-1 font-mono">???</span>}
        {who.name ?? (who.state === 'uncovered' ? words.uncovered : words.toDefine)}
      </span>

      {booking.headcount !== null && (
        <span className="block font-mono text-[7pt]">{booking.headcount}</span>
      )}
    </td>
  );
}
