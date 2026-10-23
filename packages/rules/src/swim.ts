/**
 * Swim times and events — POOLSE-85.
 *
 * Here rather than in either app for the usual reason: the entry-times grid
 * reads what a coach typed and the API refuses what it cannot read, and a form
 * that accepts "1.05.00" while the API reads it differently is the bug this
 * package exists to prevent.
 */

export type SwimStroke = 'freestyle' | 'backstroke' | 'breaststroke' | 'butterfly' | 'medley';
export type SwimCourse = 'scm' | 'lcm';

export interface SwimEvent {
  stroke: SwimStroke;
  distanceM: number;
}

/**
 * The individual events an FPN championship sets entry times for, in the
 * order a published table lists them. The grid draws these rows; a time for
 * any other event is still accepted by the API (a club's own standard may set
 * one), it is just not offered as a row.
 */
export const INDIVIDUAL_EVENTS: readonly SwimEvent[] = [
  { stroke: 'freestyle', distanceM: 50 },
  { stroke: 'freestyle', distanceM: 100 },
  { stroke: 'freestyle', distanceM: 200 },
  { stroke: 'freestyle', distanceM: 400 },
  { stroke: 'freestyle', distanceM: 800 },
  { stroke: 'freestyle', distanceM: 1500 },
  { stroke: 'backstroke', distanceM: 50 },
  { stroke: 'backstroke', distanceM: 100 },
  { stroke: 'backstroke', distanceM: 200 },
  { stroke: 'breaststroke', distanceM: 50 },
  { stroke: 'breaststroke', distanceM: 100 },
  { stroke: 'breaststroke', distanceM: 200 },
  { stroke: 'butterfly', distanceM: 50 },
  { stroke: 'butterfly', distanceM: 100 },
  { stroke: 'butterfly', distanceM: 200 },
  { stroke: 'medley', distanceM: 100 },
  { stroke: 'medley', distanceM: 200 },
  { stroke: 'medley', distanceM: 400 },
];

const SHAPE = /^(?:(\d{1,3}):)?(\d{1,2})[.,](\d{2})$/;

/**
 * A typed time in integer milliseconds, `''` for an empty cell, or `null` for
 * something that is not a time.
 *
 * Accepted: `m:ss.hh` and `ss.hh` — with a comma or a point before the
 * hundredths, because a Portuguese keyboard types a comma. Exactly two
 * hundredths, and seconds below 60 when minutes are given. Refused: `1.05.00`,
 * `65`, `1:5.00`-style guesses — reading an ambiguous figure as *some* time
 * produces an entry time that is silently wrong, which is worse than asking.
 */
export function parseSwimTime(raw: string): number | '' | null {
  const text = raw.trim();
  if (text === '') return '';
  const match = SHAPE.exec(text);
  if (match === null) return null;
  const minutes = match[1] === undefined ? 0 : Number(match[1]);
  const seconds = Number(match[2]);
  const hundredths = Number(match[3]);
  if (match[1] !== undefined && (seconds >= 60 || match[2]!.length !== 2)) return null;
  const ms = (minutes * 60 + seconds) * 1000 + hundredths * 10;
  return ms > 0 && ms < 86_400_000 ? ms : null;
}

/** `m:ss.hh`, or `ss.hh` under a minute — the shape `parseSwimTime` reads back. */
export function formatSwimTime(timeMs: number): string {
  const totalHundredths = Math.round(timeMs / 10);
  const minutes = Math.floor(totalHundredths / 6000);
  const seconds = Math.floor((totalHundredths % 6000) / 100);
  const fraction = `${totalHundredths % 100}`.padStart(2, '0');
  if (minutes === 0) return `${seconds}.${fraction}`;
  return `${minutes}:${`${seconds}`.padStart(2, '0')}.${fraction}`;
}

/** A gap as a signed figure, `+1.24` still to find or `−0.80` inside the time. */
export function formatGap(gapMs: number): string {
  const sign = gapMs > 0 ? '+' : gapMs < 0 ? '−' : '±';
  return `${sign}${formatSwimTime(Math.abs(gapMs))}`;
}

/**
 * The FPN's age groups for natação pura, 2025/2026 — POOLSE-111.
 *
 * **This reverses "Poolse ships none" (Rui, 19-10-2026) for this one table**
 * (Rui, 23-10-2026): a club on its first visit to Mínimos needs a live grid,
 * and every Portuguese club types the same nine rows. They are the federation's
 * *Política Desportiva — Enquadramento Territorial NP 2025-2026* ages, one ladder
 * for both sexes, and the age is the one reached in the **second** calendar year
 * of the season: FPN Comunicado 26/25 puts Cadetes A (12) at born 2014 and
 * Juniores (17–18) at born 2008–2009 for 2025/2026. Seeded rows are ordinary
 * groups afterwards — renamed, re-banded or archived on Escalões like any other.
 *
 * Ages, inclusive; null is open-ended (Cadetes C, 9 and under; Seniores, 19 and over).
 */
export const FPN_AGE_GROUPS: readonly { name: string; minAge: number | null; maxAge: number | null }[] = [
  { name: 'Cadetes C', minAge: null, maxAge: 9 },
  { name: 'Cadetes B', minAge: 10, maxAge: 11 },
  { name: 'Cadetes A', minAge: 12, maxAge: 12 },
  { name: 'Infantis B', minAge: 13, maxAge: 13 },
  { name: 'Infantis A', minAge: 14, maxAge: 14 },
  { name: 'Juvenis B', minAge: 15, maxAge: 15 },
  { name: 'Juvenis A', minAge: 16, maxAge: 16 },
  { name: 'Juniores', minAge: 17, maxAge: 18 },
  { name: 'Seniores', minAge: 19, maxAge: null },
];

/**
 * The FPN's groups as birth years for a season ending in `seasonEndYear` (2026
 * for 2025/2026). Born from is the youngest age's birth year read backwards:
 * aged 12 in 2026 is born 2014. Gender is null — the FPN's bands are the same
 * for both.
 */
export function fpnAgeGroups(
  seasonEndYear: number,
): { name: string; bornFrom: number | null; bornTo: number | null }[] {
  return FPN_AGE_GROUPS.map((group) => ({
    name: group.name,
    bornFrom: group.maxAge === null ? null : seasonEndYear - group.maxAge,
    bornTo: group.minAge === null ? null : seasonEndYear - group.minAge,
  }));
}
