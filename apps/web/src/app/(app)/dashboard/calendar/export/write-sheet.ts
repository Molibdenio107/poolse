import 'server-only';
import ExcelJS from 'exceljs';
import type { GridBooking, GridLane, GridSlot } from '@/lib/api';
import { BOOKING_FIELDS, type BookingField } from '@/lib/booking-sheet';
import {
  cellAt,
  instructorDisplay,
  rowTimes,
  slotAt,
  slotsFor,
  toMinutes,
  toTime,
} from '@/lib/grid-layout';

/**
 * The timetable as a workbook — POOLSE-54, criterion 6.
 *
 * **Two sheets, and the reason there are two is the reason neither can be
 * dropped.** `Horário` is the grid as a grid: merged cells, a class spanning
 * three lanes, shaped like the sheet on the wall, for somebody who wants to
 * fiddle with next season in Excel. `Marcações` is flat, one row per booking,
 * and it is what makes this export data rather than a picture — a club plans in
 * Excel and brings the file back.
 *
 * The ticket's Dev note is explicit about why they cannot be one sheet: merged
 * cells are exactly what makes the grid look right and exactly what makes a
 * sheet hostile to re-import. So there are two, and the flat one carries the
 * contract.
 *
 * `server-only` for the same reason as the register's writer: a workbook library
 * has no business in a browser bundle, and the import barrier makes that a build
 * error rather than a megabyte nobody notices.
 */

/** The words a locale gives the four subject types and the four staffing states. */
export interface SheetWords {
  subject: Record<string, string>;
  status: Record<string, string>;
  field: Record<BookingField, string>;
  weekday: Record<number, string>;
  scheduleSheet: string;
  bookingsSheet: string;
  noLane: string;
  offGrid: string;
  title: string;
  subtitle: string;
}

/** The grid, already filtered, with the rows it is to be drawn on. */
export interface SheetGrid {
  slots: GridSlot[];
  lanes: GridLane[];
  bookings: GridBooking[];
  days: number[];
}

/** A booking with its start expressed the way the placement engine wants it. */
type Timed = GridBooking & { startMinutes: number };

function timed(bookings: readonly GridBooking[]): Timed[] {
  return bookings.map((booking) => ({ ...booking, startMinutes: toMinutes(booking.startTime) }));
}

function laneLabel(lane: GridLane, manyPools: boolean): string {
  return manyPools ? `${lane.poolName} · ${lane.name}` : lane.name;
}

/**
 * One booking as the cells of one row of `Marcações`.
 *
 * Built as a record keyed by field and read back *through* `BOOKING_FIELDS`,
 * rather than as a positional array kept in the right order by hand — the same
 * guard the register's writer uses. Adding a column then cannot silently shift
 * every value one place to the left.
 *
 * **Every cell is a string**, including the times and the counts. A time-typed
 * cell is rendered by Excel in whatever the reader's locale says, so the same
 * file would show a different hour in Lisbon and in Chicago, and a re-import
 * would read back a class that has moved.
 */
function bookingRow(
  booking: GridBooking,
  lanes: readonly GridLane[],
  words: SheetWords,
): string[] {
  const mine = booking.laneIds
    .map((id) => lanes.find((lane) => lane.id === id))
    .filter((lane): lane is GridLane => lane !== undefined);

  const who = instructorDisplay(booking);

  const values: Record<BookingField, string> = {
    subject: words.subject[booking.subjectType] ?? booking.subjectType,
    name: booking.name,
    // Only for a parceria. A turma's subtitle is its level, which has its own
    // column — putting it here would make every turma look like a partnership.
    partner: booking.subjectType === 'parceria' ? (booking.subtitle ?? '') : '',
    weekday: words.weekday[booking.weekday] ?? String(booking.weekday),
    startTime: booking.startTime,
    endTime: toTime(toMinutes(booking.startTime) + booking.durationMinutes),
    durationMinutes: String(booking.durationMinutes),
    pool: mine[0]?.poolName ?? '',
    lanes: mine.map((lane) => lane.name).join(', '),
    // The name, whoever it belongs to — the club's instructor, the school's
    // teacher, or nobody. The state column beside it says which.
    instructor: who.name ?? '',
    instructorStatus: words.status[booking.instructorStatus] ?? booking.instructorStatus,
    // Zero is a real answer — a group nobody has sized yet — and null is not, so
    // the blank and the 0 are kept apart.
    headcount: booking.headcount === null ? '' : String(booking.headcount),
    category: booking.categoryName ?? '',
    // A turma's level. A partner group can carry one too, and the grid's
    // `subtitle` is the partner's name in that case, so this reads the id-backed
    // field rather than the display line.
    level: booking.subjectType === 'turma' ? (booking.subtitle ?? '') : '',
    notes: booking.groupNotes ?? '',
  };

  return BOOKING_FIELDS.map((field) => values[field]);
}

/** The two-line summary at the top of the grid sheet — what this is, and of what. */
function writeHeading(sheet: ExcelJS.Worksheet, words: SheetWords, width: number): void {
  const title = sheet.addRow([words.title]);
  title.font = { bold: true, size: 14 };
  sheet.mergeCells(title.number, 1, title.number, Math.max(width, 1));

  const subtitle = sheet.addRow([words.subtitle]);
  subtitle.font = { italic: true };
  sheet.mergeCells(subtitle.number, 1, subtitle.number, Math.max(width, 1));

  sheet.addRow([]);
}

/**
 * `Horário` — the grid, shaped like the grid.
 *
 * Rows are lanes nested inside start times, columns are days, exactly as on
 * screen and on the printed sheet, and a class spanning three lanes is one
 * merged cell. It shares its placement with both of them: `cellAt` decides what
 * is in a cell here as well as there, so a club comparing the workbook with the
 * wall never finds them disagreeing.
 */
function writeSchedule(workbook: ExcelJS.Workbook, grid: SheetGrid, words: SheetWords): void {
  const sheet = workbook.addWorksheet(words.scheduleSheet);
  const manyPools = new Set(grid.lanes.map((lane) => lane.poolId)).size > 1;
  const laneKeys = new Set(grid.lanes.map((lane) => lane.id));
  const bookings = timed(grid.bookings);

  writeHeading(sheet, words, grid.days.length + 2);

  const header = sheet.addRow([
    words.field.startTime,
    words.field.lanes,
    ...grid.days.map((day) => words.weekday[day] ?? String(day)),
  ]);
  header.font = { bold: true };

  // So the day names stay visible once somebody has scrolled past 09:30 — the
  // one piece of formatting that earns its place, as in the register's export.
  sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: header.number }];

  for (const startTime of rowTimes(grid.slots, grid.days)) {
    for (const lane of grid.lanes) {
      const cells: string[] = [startTime, laneLabel(lane, manyPools)];

      for (const day of grid.days) {
        const slot = slotAt(grid.slots, day, startTime);
        if (slot === undefined) {
          cells.push('');
          continue;
        }

        const cell = cellAt(bookings, day, lane.id, slot, slotsFor(grid.slots, day), laneKeys);
        if (cell === null) {
          cells.push('');
          continue;
        }

        /*
         * A continuation prints the name in brackets rather than nothing.
         *
         * A 90-minute class occupies two rows, and leaving the second blank
         * makes the 10:15 row look free while the pool is busy — which is the
         * bug POOLSE-49 fixed on screen and would be a worse one on a sheet
         * somebody is planning against.
         */
        const who = instructorDisplay(cell.booking);
        const lines = [
          cell.continues ? `(${cell.booking.name})` : cell.booking.name,
          who.name ?? words.status[cell.booking.instructorStatus] ?? '',
          cell.booking.headcount === null ? '' : String(cell.booking.headcount),
        ].filter((line) => line !== '');

        cells.push(lines.join('\n'));
      }

      const row = sheet.addRow(cells);
      row.alignment = { vertical: 'top', wrapText: true };
    }
  }

  mergeLaneSpans(sheet, grid, header.number);
  writeOffGrid(sheet, grid, words);

  sheet.getColumn(1).width = 9;
  sheet.getColumn(2).width = 18;
  for (let column = 3; column <= grid.days.length + 2; column += 1) {
    sheet.getColumn(column).width = 24;
  }
}

/**
 * Everything the grid cannot draw, named underneath it rather than dropped.
 *
 * Two honest states end up here and neither is an error: a booking whose time
 * matches no slot, and one with no lane assigned — which is ordinary for a turma
 * created before lanes existed, and for anything on a day this sheet does not
 * show. The screen lists them under the grid for exactly this reason, and a
 * workbook that silently omitted them would be a club planning against a
 * timetable with classes missing from it.
 *
 * `Marcações` has them regardless. This block is so somebody reading only the
 * grid sheet still knows they are there.
 */
function writeOffGrid(sheet: ExcelJS.Worksheet, grid: SheetGrid, words: SheetWords): void {
  const drawn = new Set(grid.lanes.map((lane) => lane.id));

  const stray = grid.bookings.filter(
    (booking) =>
      booking.slotId === null ||
      !grid.days.includes(booking.weekday) ||
      !booking.laneIds.some((id) => drawn.has(id)),
  );

  if (stray.length === 0) return;

  sheet.addRow([]);
  const heading = sheet.addRow([words.offGrid]);
  heading.font = { bold: true };

  for (const booking of stray) {
    sheet.addRow([
      booking.startTime,
      booking.laneIds.length === 0 ? words.noLane : '',
      `${words.weekday[booking.weekday] ?? ''} · ${booking.name}`,
    ]);
  }
}

/**
 * A class across three lanes is one cell, not three — criterion 6.
 *
 * Done as a second pass because a merge needs both its ends to exist, and the
 * rows are written top to bottom. The arithmetic is the only place this file
 * needs to know how the sheet is laid out: the first lane row of a start time is
 * `headerRow + 1 + (timeIndex * lanes) + laneIndex`, which is exactly the order
 * `writeSchedule` wrote them in.
 */
function mergeLaneSpans(sheet: ExcelJS.Worksheet, grid: SheetGrid, headerRow: number): void {
  const laneKeys = new Set(grid.lanes.map((lane) => lane.id));
  const bookings = timed(grid.bookings);
  const times = rowTimes(grid.slots, grid.days);

  times.forEach((startTime, timeIndex) => {
    const firstRow = headerRow + 1 + timeIndex * grid.lanes.length;

    grid.lanes.forEach((lane, laneIndex) => {
      grid.days.forEach((day, dayIndex) => {
        const slot = slotAt(grid.slots, day, startTime);
        if (slot === undefined) return;

        const cell = cellAt(bookings, day, lane.id, slot, slotsFor(grid.slots, day), laneKeys);
        if (cell === null || cell.span < 2) return;

        const top = firstRow + laneIndex;
        const column = 3 + dayIndex;
        // Clipped to the lanes on the sheet: a span reaching past the last lane
        // would merge into the next start time's rows and shift the whole grid.
        const bottom = Math.min(top + cell.span - 1, firstRow + grid.lanes.length - 1);
        if (bottom > top) sheet.mergeCells(top, column, bottom, column);
      });
    });
  });
}

/**
 * `Marcações` — flat, one row per booking, and the half that re-imports.
 *
 * The header row is the field catalogue's own labels, so a file exported here
 * maps itself when it comes back with no dropdown touched.
 * `booking-sheet.test.ts` asserts exactly that, against the real catalogues, in
 * both locales.
 */
function writeBookings(workbook: ExcelJS.Workbook, grid: SheetGrid, words: SheetWords): void {
  const sheet = workbook.addWorksheet(words.bookingsSheet);

  const header = sheet.addRow(BOOKING_FIELDS.map((field) => words.field[field]));
  header.font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  /*
   * Ordered by day and then by clock, not by whatever the API returned. A flat
   * sheet is read by a person before it is read by an importer, and a timetable
   * out of time order is one nobody can check against the wall.
   */
  const ordered = [...grid.bookings].sort(
    (a, b) => a.weekday - b.weekday || toMinutes(a.startTime) - toMinutes(b.startTime),
  );

  for (const booking of ordered) {
    sheet.addRow(bookingRow(booking, grid.lanes, words));
  }

  sheet.columns.forEach((column) => {
    column.width = 20;
  });
}

export async function scheduleWorkbook(grid: SheetGrid, words: SheetWords): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Poolse';
  workbook.created = new Date();

  writeSchedule(workbook, grid, words);
  writeBookings(workbook, grid, words);

  // An ArrayBuffer rather than a Node Buffer: this is handed straight to a web
  // `Response`, which takes the former and not the latter.
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

/** One CSV field, quoted only where it has to be. */
function csvCell(value: string): string {
  return /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * `Marcações` alone, as a CSV — 54.10.
 *
 * Only the flat sheet, because a CSV is one sheet by definition and the grid one
 * is the half that cannot survive the format: merged cells are what make it look
 * like the wall sheet, and a CSV has none. The flat sheet loses nothing.
 *
 * **Semicolons, CRLF, and a byte-order mark** — the convention the register's
 * export already settled, and all three for the same reason: this file has to
 * open correctly by double-click in a Portuguese Excel, which is where it is
 * going. Commas would put the whole row in column A on a machine whose decimal
 * separator is a comma, and without the BOM every accent in it renders as
 * mojibake. Our own readers sniff the delimiter and strip the mark, so the round
 * trip survives either way; Excel is the fussy one.
 */
export function bookingsCsv(grid: SheetGrid, words: SheetWords): string {
  const ordered = [...grid.bookings].sort(
    (a, b) => a.weekday - b.weekday || toMinutes(a.startTime) - toMinutes(b.startTime),
  );

  const lines = [
    BOOKING_FIELDS.map((field) => words.field[field]),
    ...ordered.map((booking) => bookingRow(booking, grid.lanes, words)),
  ].map((row) => row.map(csvCell).join(';'));

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
