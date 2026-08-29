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
