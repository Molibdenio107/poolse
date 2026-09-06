import type { GridBooking, GridSlot } from './api';
import { slotsFor, toMinutes, toTime } from './grid-layout.ts';

/**
 * The calendar's pixel scale, its snapping, and its colours — round 6.
 *
 * Kept apart from the grid component for the reason the rest of `lib` is: this
 * is the only real arithmetic in the view, and a file full of JSX cannot be
 * imported by the plain `node --test` runner the rest of the library uses.
 *
 * **Why a pixel scale at all.** The board next door draws a slot as a table row,
 * so a 45-minute class in a 60-minute slot fills the row and reads as an hour.
 * That is a lie the operator has to know to discount. Here a block's top and
 * height come from its minutes, so it is three-quarters of the slot, and two
 * classes that overlap by ten minutes overlap by ten minutes on screen.
 */

/**
 * Pixels per minute.
 *
 * One a minute puts an hour at 60px, which is close to what Google Calendar
 * uses (48) and a little roomier, because a Poolse block carries an instructor's
 * name under the turma where a calendar entry carries only a title. A pool day
 * of 06:00–23:00 comes out at 1020px, which scrolls in one gesture.
 *
 * Exported because the current-time line, the drag maths and the auto-scroll all
 * have to agree with the blocks; a second constant is how they stop agreeing.
 */
export const PX_PER_MINUTE = 1;

/** Below this a block cannot show its time as well as its name. */
export const TIME_VISIBLE_MIN_HEIGHT = 34;

/** Nothing is drawn shorter than this, or a 10-minute block has no hit area. */
export const MIN_BLOCK_HEIGHT = 18;

export function minutesToPx(minutes: number): number {
  return minutes * PX_PER_MINUTE;
}

export function pxToMinutes(px: number): number {
  return px / PX_PER_MINUTE;
}

export interface DayRange {
  /** Minutes from midnight where the canvas starts. */
  startMinutes: number;
  endMinutes: number;
}

/**
 * The vertical extent the grid has to draw.
 *
 * Taken from the slots the facility actually has, widened to whole hours so the
 * gutter reads 07:00 rather than 07:12, and widened again by anything already
 * booked outside them. That last part matters: a booking can sit outside the
 * grid — the schema allows a null `slotId` — and a canvas sized only to the
 * slots would clip it out of sight rather than showing a problem.
 *
 * Falls back to a plausible pool day when a facility has no grid at all, so the
 * screen renders an empty week instead of a zero-height nothing.
 */
export function dayRange(
  slots: readonly GridSlot[],
  bookings: readonly GridBooking[],
): DayRange {
  const starts: number[] = [];
  const ends: number[] = [];

  for (const slot of slots) {
    starts.push(toMinutes(slot.startTime));
    ends.push(toMinutes(slot.endTime));
  }
  for (const booking of bookings) {
    starts.push(toMinutes(booking.startTime));
    ends.push(toMinutes(booking.startTime) + booking.durationMinutes);
  }

  if (starts.length === 0) return { startMinutes: 7 * 60, endMinutes: 22 * 60 };

  const start = Math.floor(Math.min(...starts) / 60) * 60;
  const end = Math.ceil(Math.max(...ends) / 60) * 60;

  // A facility whose slots are all inside one hour would otherwise give a canvas
  // with no room to drop anything into.
  return { startMinutes: start, endMinutes: Math.max(end, start + 120) };
}

/** Whole-hour marks down the gutter. */
export function hourMarks(range: DayRange): number[] {
  const marks: number[] = [];
  for (let m = range.startMinutes; m <= range.endMinutes; m += 60) marks.push(m);
  return marks;
}

/**
 * The snap step, in minutes.
 *
 * There is no stored "slot increment" — a facility's grid is a list of explicit
 * `facility_time_slot` rows, which is a better description of a real timetable
 * than a single number would be (06:30 for the masters, then 45-minute pitches
 * with a hole at lunch). So the step is derived: the greatest common divisor of
 * every slot's start and length, which for an ordinary grid comes out at exactly
 * the 15, 30 or 60 the club set it up with, and for a ragged one comes out at
 * something that can still express every row it has.
 *
 * Clamped to 5 at the bottom: a club with an 06:32 slot should not get a
 * one-minute snap and a drag that never lands anywhere twice.
 */
export function snapStep(slots: readonly GridSlot[]): number {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

  let step = 0;
  for (const slot of slots) {
    step = gcd(step, toMinutes(slot.startTime));
    step = gcd(step, toMinutes(slot.endTime) - toMinutes(slot.startTime));
  }

  if (step <= 0) return 15;
  return Math.max(5, Math.min(60, step));
}

/**
 * Snap a moved block's start.
 *
 * A slot boundary wins over the arithmetic step whenever one is close, because
 * the club's own rows are what the timetable is made of and landing exactly on
 * 06:30 matters more than landing on a tidy multiple. Only when nothing is
 * within half a step does it fall back to the step itself — which is what lets a
 * block be dropped into a gap the grid has no row for, rather than refusing.
 */
export function snapStart(
  minutes: number,
  weekday: number,
  slots: readonly GridSlot[],
  step: number,
): number {
  // A slot belongs to a day *group* — weekday, Saturday, Sunday — so the day's
  // own rows come from the same helper the board and the printed sheet use.
  const sameDay = slotsFor(slots, weekday);

  let nearest: number | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const slot of sameDay) {
    const start = toMinutes(slot.startTime);
    const gap = Math.abs(start - minutes);
    if (gap < distance) {
      distance = gap;
      nearest = start;
    }
  }

  if (nearest !== null && distance <= step / 2) return nearest;
  return Math.round(minutes / step) * step;
}

/**
 * Snap a resized block's end, and never let it collapse.
 *
 * Same rule as the start, against slot *ends*, with a floor of one step so the
 * bottom edge cannot be dragged up past the top one and leave a block of zero
 * minutes that nothing can grab again.
 */
export function snapDuration(
  startMinutes: number,
  endMinutes: number,
  weekday: number,
  slots: readonly GridSlot[],
  step: number,
): number {
  const sameDay = slotsFor(slots, weekday);

  let nearest: number | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const slot of sameDay) {
    const end = toMinutes(slot.endTime);
    const gap = Math.abs(end - endMinutes);
    if (gap < distance) {
      distance = gap;
      nearest = end;
    }
  }

  const snapped =
    nearest !== null && distance <= step / 2
      ? nearest
      : Math.round(endMinutes / step) * step;

  return Math.max(step, snapped - startMinutes);
}

/** The time a snapped start lands on, for the confirmation to say out loud. */
export function startTimeOf(minutes: number): string {
  return toTime(minutes);
}

/**
 * Which of the eight tints a booking wears.
 *
 * **Keyed on the level's place in the club's own order, not on a hash of its
 * id.** The API sends levels `ORDER BY sort_order, name`, so position is that
 * order. Adding a level at the end leaves every colour before it alone, which is
 * the property that matters — a hash would repaint the whole week the first time
 * somebody renamed anything, and reordering the levels is meant to change what
 * they look like, because reordering them is a statement about the club.
 *
 * Three cases the level cannot answer, all deliberate:
 *   - a `parceria` keeps the partner's own colour, which already beat every
 *     other colour on the old board and still should: on a week with three
 *     schools in it, which school is the question being asked.
 *   - an `evento` or `manutencao` has no level and never will; it takes the
 *     neutral.
 *   - a turma whose level nobody has set takes the neutral too, rather than
 *     borrowing whichever tint index 0 happens to be — a colour that means "not
 *     said" must not look like a colour that means "Iniciados".
 */
export const LEVEL_TINTS = 8;

/** The eight tints, in the order the tokens are numbered. */
const COLOUR_INDEX: Record<string, number> = {
  teal: 1,
  green: 2,
  lime: 3,
  amber: 4,
  orange: 5,
  rose: 6,
  magenta: 7,
  violet: 8,
};

/**
 * The CSS colour a stored class-colour token paints with.
 *
 * `rgb(var(--level-N))` rather than a hex, so the swatch a club picked follows
 * the theme: the same token is a different colour in dark mode, which is the
 * whole reason these are tokens. Null for anything unrecognised, so a value from
 * a newer build is simply not painted rather than rendering as `rgb(var())`.
 */
export function classColourVar(colour: string | null | undefined): string | null {
  if (colour === null || colour === undefined) return null;
  const index = COLOUR_INDEX[colour];
  return index === undefined ? null : `rgb(var(--level-${index}))`;
}

export function levelTint(
  booking: Pick<GridBooking, 'subjectType' | 'levelId'> & { classColour?: string | null },
  order: ReadonlyMap<string, number>,
): number | null {
  if (booking.subjectType !== 'turma') return null;

  /*
   * The turma's own colour wins — round 6.
   *
   * A level answers "what kind of class is this"; it cannot answer "which one is
   * mine", and a club with Competição A and Competição B had no way to tell them
   * apart. When somebody has chosen, that choice is the answer; the level is what
   * the grid falls back to, which is what every uncoloured club goes on seeing.
   */
  const chosen = booking.classColour ?? null;
  if (chosen !== null && COLOUR_INDEX[chosen] !== undefined) return COLOUR_INDEX[chosen]!;

  if (booking.levelId === null) return null;

  const place = order.get(booking.levelId);
  if (place === undefined) return null;

  // Wraps rather than running out. A club with nine levels gets a repeat, which
  // the legend makes readable because it names every level in words.
  return (place % LEVEL_TINTS) + 1;
}

/**
 * A level's place in the club's order, by id, built once per render.
 *
 * Takes the list as it arrives from the API, which is already sorted — see
 * `classes.controller.ts`, `ORDER BY sort_order, name`. Sorting it again here
 * would be a second opinion about an order the club has already given.
 */
export function levelOrder(levels: readonly { id: string }[]): Map<string, number> {
  return new Map(levels.map((level, index) => [level.id, index]));
}
