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

/*
 * -----------------------------------------------------------------------------
 * The other axis
 * -----------------------------------------------------------------------------
 *
 * The vertical scale has lived here since round 6 and the horizontal one lived
 * in the grid component, which is the asymmetry that let a real bug through: the
 * time a drag resolved to came from how far the pointer had *travelled*, and the
 * pista it resolved to came from whichever column the pointer was *over*. Those
 * are different questions, and for any block wider than one lane they give
 * different answers.
 *
 * Both axes are arithmetic over a constant. Both belong in the file the test
 * runner can import.
 */

/**
 * One lane column.
 *
 * 64px: a six-lane pool then fits a week across a laptop without scrolling
 * sideways, which is worth more than the tail of a truncated turma name. The
 * full name is on the hover card.
 */
export const COL_WIDTH = 64;

/** The time gutter down the left. */
export const GUTTER = 56;

/**
 * The rule between one day and the next, in pixels.
 *
 * **This number and the `border-l-2` class have to agree**, and they are apart
 * because Tailwind needs a literal class name. They stopped agreeing once: the
 * rule went from 1px to 2px to make the days findable and the block layer went
 * on adding 1, so every block drifted a pixel per day, up to seven by Sunday.
 * Change both or neither.
 */
export const DAY_RULE = 2;

/**
 * The column a class with no pista is drawn in — round 8.
 *
 * A booking may occupy no lane at all: `laneIds` is empty, which is an ordinary
 * state for a class nobody has placed in the tank yet. Until now the grid drew
 * none of them — `xOf` had no column to ask for and returned null — so six of
 * the dev tenant's bookings existed, were refused by nothing, and were invisible.
 * A class the screen cannot show reads as a class that is not there.
 *
 * **A synthetic lane rather than a special case in the geometry.** The whole
 * horizontal scale is `columnX(day, laneIndex, laneCount)` with one uniform
 * stride per day, and every part of the drag measures with it. Making the column
 * a lane that happens to be first keeps that ruler exactly as it was; giving
 * some days an extra column and not others would make the stride depend on the
 * day, which is the shape of bug rounds 6 and 7 were spent removing.
 *
 * It is prepended only when the week actually contains such a class, so a club
 * that always assigns pistas never sees it.
 *
 * **It is display-only.** A block can be dragged *out* of it into a real pista,
 * which is the point — the invisible six become visible and fixable. A block
 * cannot be dragged *into* it: removing a class's pistas by dragging is an easy
 * accident with no undo, and every write path below floors its column index past
 * this one and filters this id out of any lane list it builds.
 */
export const NO_LANE_ID = '__poolse:no-lane__';

/** Where a (day, lane) column starts, in the scrolling canvas. */
export function columnX(dayIndex: number, laneIndex: number, laneCount: number): number {
  return GUTTER + dayIndex * (laneCount * COL_WIDTH + DAY_RULE) + DAY_RULE + laneIndex * COL_WIDTH;
}

/**
 * The inverse: the column nearest a given offset.
 *
 * Rounding rather than flooring, because the input is a column edge that has
 * been dragged — halfway across is the point at which it should step. The carry
 * loops are what let a block dragged off the right-hand end of Tuesday arrive at
 * the left-hand end of Wednesday instead of sticking to Tuesday's last pista.
 */
export function columnAt(
  x: number,
  laneCount: number,
  dayCount: number,
): { dayIndex: number; laneIndex: number } {
  const stride = laneCount * COL_WIDTH + DAY_RULE;
  const inside = x - GUTTER;

  let dayIndex = Math.floor(inside / stride);
  let laneIndex = Math.round((inside - dayIndex * stride - DAY_RULE) / COL_WIDTH);

  while (laneIndex >= laneCount) {
    laneIndex -= laneCount;
    dayIndex += 1;
  }
  while (laneIndex < 0) {
    laneIndex += laneCount;
    dayIndex -= 1;
  }

  return {
    dayIndex: Math.max(0, Math.min(dayCount - 1, dayIndex)),
    laneIndex: Math.max(0, Math.min(laneCount - 1, laneIndex)),
  };
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
 * **The level's own stored colour, not its position** — round 6.
 *
 * Position used to decide it, which worked and was invisible: a club that
 * reordered its levels repainted its whole week and had no way to say
 * "Iniciados is the green one". Levels now carry a colour, backfilled from the
 * position they had, so nothing changed on the day and the club can now say it.
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

  const chosenByLevel = order.get(booking.levelId);
  if (chosenByLevel === undefined) return null;
  return chosenByLevel;
}

/**
 * Each level's tint, by id, built once per render.
 *
 * Reads the colour the level carries. A level with none — only possible for one
 * created since the backfill without a colour being picked — is simply absent
 * from the map, and everything at it takes the neutral, which is the honest
 * answer: nobody has said.
 */
export function levelOrder(
  levels: readonly { id: string; colour?: string | null }[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const level of levels) {
    const tint = COLOUR_INDEX[level.colour ?? ''];
    if (tint !== undefined) map.set(level.id, tint);
  }
  return map;
}
