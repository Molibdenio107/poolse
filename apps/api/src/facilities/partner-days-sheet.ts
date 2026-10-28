/**
 * Days, an hour and a length, read from a partnerships sheet — POOLSE-117.
 *
 * Pure, like the rest of the importer. **Read in both languages whatever the
 * reader's**, because a file exported under `en` comes back under `pt-PT`:
 * *Seg, Qua*, *2ª e 4ª*, *segunda-feira e quinta*, *Mon/Wed* all mean days.
 *
 * **A range is refused, never guessed** (the ticket's open point, decided by
 * its default): *Seg a Qua* may mean three days or two, and a timetable that
 * guessed wrong books a school on a day it does not come.
 */

const DAY_WORDS: [number, string[]][] = [
  [1, ['seg', 'segunda', '2a', '2ª', 'mon', 'monday']],
  [2, ['ter', 'terca', 'terça', '3a', '3ª', 'tue', 'tues', 'tuesday']],
  [3, ['qua', 'quarta', '4a', '4ª', 'wed', 'wednesday']],
  [4, ['qui', 'quinta', '5a', '5ª', 'thu', 'thur', 'thurs', 'thursday']],
  [5, ['sex', 'sexta', '6a', '6ª', 'fri', 'friday']],
  [6, ['sab', 'sabado', 'sábado', 'sat', 'saturday']],
  [7, ['dom', 'domingo', 'sun', 'sunday']],
];

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

const LOOKUP = new Map<string, number>();
for (const [day, words] of DAY_WORDS) for (const word of words) LOOKUP.set(fold(word), day);

export type DaysRead = { days: number[] } | { error: 'badDays' | 'dayRange' };

/** ISO weekdays in a cell, sorted and unique; a range or an unknown word is refused. */
export function readDays(raw: string): DaysRead {
  // "segunda-feira" is one word; strip the "-feira" before hyphens can mean "to".
  const text = fold(raw).replace(/-?\s*feira/g, '').replace(/\./g, '');
  if (text === '') return { days: [] };
  if (/\s(a|ate|to)\s|[–-]|\bthrough\b/.test(` ${text} `)) return { error: 'dayRange' };

  const tokens = text
    .split(/[,;/+&]|\s+e\s+|\s+and\s+|\s+/)
    .map((token) => token.trim())
    .filter((token) => token !== '' && token !== 'e' && token !== 'and');
  const days = new Set<number>();
  for (const token of tokens) {
    const day = LOOKUP.get(token);
    if (day === undefined) return { error: 'badDays' };
    days.add(day);
  }
  return { days: [...days].sort((a, b) => a - b) };
}

/**
 * An hour, as a sheet writes one: *10:00*, *10h*, *10h30*, *10.30*, or the
 * fraction of a day a spreadsheet stores a time as (0.4166… is 10:00).
 */
export function readClock(raw: string): string | null {
  const text = fold(raw).replace(/\s/g, '');
  if (text === '') return null;
  const fraction = Number(text);
  if (Number.isFinite(fraction) && fraction > 0 && fraction < 1 && text.includes('.')) {
    const minutes = Math.round(fraction * 24 * 60);
    return clock(Math.floor(minutes / 60), minutes % 60);
  }
  const match = text.match(/^(\d{1,2})(?:[:h.](\d{2})?)?(?::\d{2})?$/);
  if (match === null) return null;
  return clock(Number(match[1]), Number(match[2] ?? '0'));
}

function clock(hours: number, minutes: number): string | null {
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** A length in minutes: *45*, *45 min*, *1h*, *1h30*, *01:30*. Null when it is not one. */
export function readMinutes(raw: string): number | null {
  const text = fold(raw).replace(/\s/g, '').replace(/minutos|minutes|mins|min|m$/, '');
  if (text === '') return null;
  let minutes: number;
  const hours = text.match(/^(\d{1,2})[h:](\d{2})?$/);
  if (hours !== null) minutes = Number(hours[1]) * 60 + Number(hours[2] ?? '0');
  else if (/^\d{1,3}$/.test(text)) minutes = Number(text);
  else return null;
  return minutes >= 5 && minutes <= 480 ? minutes : null;
}
