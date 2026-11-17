import type { FacilityDay } from './api';

/**
 * Is the site open on this weekday, at this hour — POOLSE-QA-03 and QA-04.
 *
 * One function, because the bug was that there were none. A booking can be made
 * in three places — dragged onto the calendar, placed from the unscheduled list,
 * and picked in the parceria editor — and the opening-hours rule was enforced in
 * none of them. Each screen had grown its own idea of "available": the board
 * checked whether the club opened *at all* that day, and the parceria editor
 * checked only whether a slot belonged to the weekday or the Saturday grid.
 *
 * So a site opening at 12:30 on Tuesday offered 06:30 as an ordinary choice on
 * every one of them. The API refused it — `outsideHours`, and it always had —
 * which is why this never wrote anything wrong. What it cost was every operator
 * who was invited to pick a time and then told no.
 *
 * The API stays the authority. This is the screen agreeing with it in advance.
 */
export function withinHours(
  hours: readonly FacilityDay[],
  weekday: number,
  startTime: string,
  endTime: string,
): boolean {
  const day = hours.find((entry) => entry.weekday === weekday);

  // A club that never said is a club with no rule to break. Unknown stays open
  // and the API remains the thing that decides.
  if (day === undefined) return true;
  if (!day.available) return false;

  /*
   * Compared as `HH:MM` text, which is safe here and only here: both sides are
   * zero-padded wall-clock at the same site, so lexical order is clock order.
   * `24:00` is a real closing time and still sorts last.
   *
   * The end is compared too, not just the start — a 45-minute class beginning
   * at 21:45 against a 22:00 close is half of it in the car park.
   */
  return startTime.slice(0, 5) >= day.opensAt.slice(0, 5)
    && endTime.slice(0, 5) <= day.closesAt.slice(0, 5);
}

/** "06:30–22:00" for a weekday, or null when the club never said. */
export function hoursLabel(
  hours: readonly FacilityDay[],
  weekday: number,
): string | null {
  const day = hours.find((entry) => entry.weekday === weekday);
  if (day === undefined) return null;
  return `${day.opensAt.slice(0, 5)}\u2013${day.closesAt.slice(0, 5)}`;
}

/**
 * Has anybody set this site's opening hours yet (Rui, 17-11-2026)?
 *
 * A site is born with seven days open 00:00–24:00, which the schema means as
 * "nobody has narrowed this yet" (`facility_hours`, its default). So "never
 * set" is exactly that: no rows, or every day still open all day. A club that
 * truly opens round the clock reads as unset too, and the warning that follows
 * only invites it to say so.
 */
export function hoursUnset(hours: readonly FacilityDay[]): boolean {
  return hours.every(
    (day) => day.available && day.opensAt.slice(0, 5) === '00:00' && day.closesAt.slice(0, 5) === '24:00',
  );
}

/** "HH:MM" plus minutes, as wall-clock text that may run past 24:00 (it compares as later). */
export function addMinutes(startTime: string, minutes: number): string {
  const [hours, mins] = startTime.slice(0, 5).split(':').map(Number) as [number, number];
  const total = hours * 60 + mins + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
