import type { DayGroup, GridSlot } from './api';

/**
 * Where a booking sits on the week grid — POOLSE-49, shared with POOLSE-54.
 *
 * These were private helpers inside `schedule-board.tsx` until the printed sheet
 * needed them. It needs *exactly* them: the sheet on the wall and the screen
 * have to agree about which class is in lane 3 at 09:30 on a Thursday, and two
 * implementations of "which slots does a 90-minute class cover" is two answers
 * to that question with nothing to make them the same one.
 *
 * So the placement lives here, pure and tested, and the two renders stay
 * genuinely separate — POOLSE-54, criterion 8. The screen has sticky rails, drag
 * targets and a density toggle; the sheet has a fixed page, repeating headers
 * and no interaction. Neither is a stylesheet over the other, and both compute
 * position from this file.
 *
 * Nothing here touches React or the DOM, which is why it can be unit-tested and
 * why the print page — a server component — can call it.
 */

/**
 * Which set of slots a day draws from — POOLSE-44.
 *
 * Saturday and Sunday have their own rows because a club that opens at 07:30 on
 * a Saturday and 06:30 on a Tuesday has to be able to say so. That is why the
 * weekend used to be a separate grid: not width, but a different set of rows.
 *
 * One grid handles it by making a *row* a start time rather than a slot, and
 * letting each day answer for itself whether it has a slot at that time. A
 * Saturday-only 07:30 is one row where the weekdays are simply blank.
 */
export function groupOf(weekday: number): DayGroup {
  if (weekday === 6) return 'saturday';
  if (weekday === 7) return 'sunday';
  return 'weekday';
}

export function toMinutes(time: string): number {
  const [h, m] = time.split(':');
  return Number(h) * 60 + Number(m);
}

export function toTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Every slot a booking's own time runs through, in grid order.
 *
 * A class is not obliged to be one row long. A 90-minute masters session in a
 * grid of 45-minute rows covers two, and drawing it one row tall made the second
 * half invisible — the row underneath looked free while the pool was busy.
 *
 * Half-open, so a class ending exactly when the next row starts does not claim
 * it: 09:30–10:15 covers the 09:30 row and not the 10:15 one.
 */
export function slotsCovered(
  startMinutes: number,
  durationMinutes: number,
  slots: readonly GridSlot[],
): GridSlot[] {
  return slots.filter((slot) => {
    const from = toMinutes(slot.startTime);
    const to = toMinutes(slot.endTime);
    return startMinutes < to && from < startMinutes + durationMinutes;
  });
}

/** That day's own slot at this time, if it has one. */
export function slotAt(
  slots: readonly GridSlot[],
  weekday: number,
  startTime: string,
): GridSlot | undefined {
  return slots.find(
    (slot) => slot.dayGroup === groupOf(weekday) && slot.startTime === startTime,
  );
}

/** Only the slots one day actually offers — a Saturday row is not a Tuesday's. */
export function slotsFor(slots: readonly GridSlot[], weekday: number): GridSlot[] {
  return slots.filter((slot) => slot.dayGroup === groupOf(weekday));
}

/**
 * The rows the whole week is drawn on: every start time any shown day offers.
 *
 * Sorted by clock time rather than by the order the slots arrived, so a Saturday
 * 07:30 lands above the weekday 08:45 instead of after it.
 */
export function rowTimes(slots: readonly GridSlot[], days: readonly number[]): string[] {
  const groups = new Set(days.map(groupOf));
  return [
    ...new Set(slots.filter((slot) => groups.has(slot.dayGroup)).map((slot) => slot.startTime)),
  ].sort((a, b) => toMinutes(a) - toMinutes(b));
}

/**
 * The least a thing has to be for this file to place it.
 *
 * Structural rather than the screen's `Placed` or the API's `GridBooking`,
 * because both satisfy it and neither should have to know about the other. The
 * print page builds its own rows; the board keeps its optimistic overlay.
 */
export interface Placeable {
  weekday: number;
  laneIds: string[];
  /** Null means fora da grelha — it belongs to no row and is listed separately. */
  slotId: string | null;
  startMinutes: number;
  durationMinutes: number;
}

export interface PlacedCell<T extends Placeable> {
  booking: T;
  /**
   * A later row of a class that runs past one slot.
   *
   * The first slot draws the label; the ones after it are the same class
   * continuing, joined the way a paper timetable joins them. They cannot be one
   * element: lanes are nested inside slots, so slot 1 lane 1 and slot 2 lane 1
   * are six rows apart with other lanes between them.
   */
  continues: boolean;
  /** How many lane rows it covers, clipped to the lanes actually being drawn. */
  span: number;
}

/**
 * What sits in one cell of the grid — the whole placement rule in one function.
 *
 * A booking is drawn here if its **first** lane is this lane and its own time
 * reaches this slot. Keying on the first lane is what makes a three-lane class
 * one block rather than three copies of it; keying on the time rather than on
 * `slotId` is what makes a 90-minute class appear in both rows it occupies.
 *
 * `visibleLanes` is the set actually on screen or on the page. "Esconder pistas
 * vazias" can hide a lane in the middle of a span, and a block that kept its
 * original height would then overhang the slot below it.
 */
export function cellAt<T extends Placeable>(
  bookings: readonly T[],
  weekday: number,
  laneId: string,
  slot: GridSlot,
  daySlots: readonly GridSlot[],
  visibleLanes: ReadonlySet<string>,
): PlacedCell<T> | null {
  const booking = bookings.find(
    (candidate) =>
      candidate.weekday === weekday &&
      candidate.laneIds[0] === laneId &&
      candidate.slotId !== null &&
      slotsCovered(candidate.startMinutes, candidate.durationMinutes, daySlots).some(
        (covered) => covered.id === slot.id,
      ),
  );

  if (booking === undefined) return null;

  const covered = slotsCovered(booking.startMinutes, booking.durationMinutes, daySlots);

  return {
    booking,
    continues: covered[0]?.id !== slot.id,
    span: Math.max(1, booking.laneIds.filter((id) => visibleLanes.has(id)).length),
  };
}

/* ------------------------------------------------------------------ the cell */

/** Mirrors the `instructor_status` enum — POOLSE-53. */
export type InstructorState = 'assigned' | 'to_define' | 'external' | 'uncovered';

/**
 * Who is teaching a booking, resolved once for both renders.
 *
 * The *words* stay with each render, because the screen and the sheet say them
 * differently — the sheet has to survive a photocopier and carries a mark the
 * screen does not need. What is shared is the part that can be got wrong: which
 * name a state shows, and the precedence between three columns that can each
 * hold one.
 *
 * `external` is the case worth naming. The partner group's own teacher first;
 * then any membership the booking happens to carry; then the partner itself,
 * because "a school is sending somebody" is still more than the club knows about
 * an empty slot — 53.8 and 53.9.
 */
export interface InstructorDisplay {
  state: InstructorState;
  /** The person or entity to print. Null for the two gaps, which have no name. */
  name: string | null;
  /** True for `uncovered` only: the state the club is being warned about. */
  alert: boolean;
}

export function instructorDisplay(booking: {
  instructorStatus: InstructorState;
  instructorName: string | null;
  ownInstructorName: string | null;
  subtitle: string | null;
}): InstructorDisplay {
  switch (booking.instructorStatus) {
    case 'assigned':
      return { state: 'assigned', name: booking.instructorName, alert: false };
    case 'external':
      return {
        state: 'external',
        name: booking.ownInstructorName ?? booking.instructorName ?? booking.subtitle,
        alert: false,
      };
    case 'uncovered':
      return { state: 'uncovered', name: null, alert: true };
    default:
      return { state: 'to_define', name: null, alert: false };
  }
}
