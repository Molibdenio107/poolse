/**
 * The key the calendar and the schedule board agree on for one slot in a week.
 *
 * **Why it is not in `schedule-board.tsx`.** That file is `'use client'`, and a
 * server component cannot *call* a function exported from a client module — it
 * can only render it as a component or pass it as a prop. The calendar page is a
 * server component and builds this map before the board ever sees it, so the
 * function has to live somewhere both sides may import: a leaf module with no
 * directive and no imports. `lib/pool-metrics.ts` exists for the same reason,
 * from the mirror-image mistake in the other direction.
 *
 * **Turma, weekday and start time** — the three columns `class_schedule`'s own
 * unique index uses, which is what makes a lookup by this key exact rather than
 * a guess. The board draws from the weekly pattern and uses this to find the
 * session for the week on screen, so the two halves must compose it identically;
 * that is the whole reason it is a function and not a template literal written
 * out twice.
 */
export function slotKey(groupId: string, weekday: number, startTime: string): string {
  return `${groupId}|${weekday}|${startTime}`;
}

/**
 * The key for one week's occurrence of a *booking*, which is the one the
 * calendar uses.
 *
 * `slotKey` above identifies a slot by turma, weekday and hour, and that was
 * exact for as long as an occurrence could not leave its pattern's slot. It can
 * now — a one-week move carries a day, an hour and a set of pistas — and the
 * moment it does, the session sits at one slot while the block on the grid is
 * still drawn at the pattern's. The composite key then matched nothing, and
 * every class anybody had moved for a week silently lost its register link, its
 * cancel button, its teacher picker and its lesson plan. It looked like the
 * click had stopped working.
 *
 * A booking's id does not move when one of its weeks does, so this is stable by
 * construction. Both the map and the lookup call it, for the same reason
 * `slotKey` is a function: two hand-written template literals are two things
 * that can drift.
 *
 * `slotKey` stays for the sessions that have no booking behind them at all.
 */
export function bookingKey(scheduleId: string): string {
  return `booking:${scheduleId}`;
}
