/**
 * Today, as the club reads a calendar — the TypeScript twin of `club_today()`.
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC day: between midnight and
 * one in the morning in a Lisbon summer it is still yesterday, so a payment
 * taken at 00:30 on the 1st landed in the previous month (sweep of 15-10-2026).
 * Same zone as the SQL function, so the two cannot disagree about which day it is.
 */
export function clubToday(now: Date = new Date()): string {
  // en-CA writes ISO dates; the zone is the club's, as in club_today().
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Lisbon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
