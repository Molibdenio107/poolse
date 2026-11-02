/**
 * The pool the calendar opens on — Rui, 02-11-2026, reversing "no tank until
 * somebody chooses one" (12-10-2026): the page opened empty. It opens on the
 * pool this person last looked at, remembered on this device; the first time,
 * the club's first pool. The timetable import starts on the same pool and can
 * be changed there.
 *
 * `localStorage`, wrapped: a private window or a blocked store simply forgets.
 */
const KEY = 'poolse.calendar.pool';

export function rememberedPool(available: readonly string[]): string {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(KEY);
  } catch {
    stored = null;
  }
  return stored !== null && available.includes(stored) ? stored : (available[0] ?? '');
}

export function rememberPool(poolId: string): void {
  try {
    window.localStorage.setItem(KEY, poolId);
  } catch {
    // Nothing to do: the choice holds for this visit.
  }
}
