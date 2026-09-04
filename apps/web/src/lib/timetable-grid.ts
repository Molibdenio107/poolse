// The `.ts` on the specifier is not a slip: this module is reached by
// `node --test`, whose resolver does not add extensions. `booking-sheet.ts` and
// `inventory-sheet.ts` carry one for the same reason.
import type { Sheet } from './sheet.ts';

/**
 * Reading the wall timetable — POOLSE-57.
 *
 * A club's own file is not a table. It is the sheet pinned by the office door:
 * **days across the top, times down the side, class names in the cells**, and a
 * squad's block written `Masters (1-3)` because it takes three lanes.
 *
 *          Segunda      Terça        Quarta
 *  06:30   Masters 1-3               Masters 1-3
 *  09:30   6A (1-3)                  6A (1-3)
 *          6B (4-6)
 *  19:15                Infantis 2
 *                       Juvenis 3
 *
 * There are **no columns to map**. `Segunda` is a heading, `06:30` is a heading,
 * and the thing between them is a booking — so `matchFields`, which is the right
 * tool for every other importer in this codebase, is the wrong one here.
 *
 * ---------------------------------------------------------------------------
 * Deterministic first, and good enough alone
 * ---------------------------------------------------------------------------
 *
 * This finds the day row by looking for weekday names, finds the time column by
 * looking for clock values, and reads what is in between. A club whose sheet is
 * tidy never needs anything more, which matters because the layout agent is
 * optional — no key, no call, and the importer still has to work.
 *
 * What it deliberately does *not* attempt: a sheet with two grids side by side,
 * one per tank; a grid rotated so times run across; a legend that redefines what
 * a cell means. Those are the agent's, and this returns what it found plus what
 * it could not place so the agent has something to start from.
 */

/** Monday 1 … Sunday 7, in both languages and the forms clubs abbreviate to. */
const WEEKDAY_WORDS: [number, string[]][] = [
  [1, ['segunda', 'segunda-feira', '2a', '2ª', 'seg', 'monday', 'mon']],
  [2, ['terca', 'terça', 'terca-feira', '3a', '3ª', 'ter', 'tuesday', 'tue']],
  [3, ['quarta', 'quarta-feira', '4a', '4ª', 'qua', 'wednesday', 'wed']],
  [4, ['quinta', 'quinta-feira', '5a', '5ª', 'qui', 'thursday', 'thu']],
  [5, ['sexta', 'sexta-feira', '6a', '6ª', 'sex', 'friday', 'fri']],
  [6, ['sabado', 'sábado', 'sab', 'saturday', 'sat']],
  [7, ['domingo', 'dom', 'sunday', 'sun']],
];

/** Accents and case off, punctuation to spaces — the fold every matcher uses. */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9ª]+/g, ' ')
    .trim();
}

/** Which weekday a heading names, or null. Whole-word, so "Segunda" beats "2". */
export function readWeekday(cell: string): number | null {
  const key = fold(cell);
  if (key === '') return null;

  for (const [weekday, words] of WEEKDAY_WORDS) {
    if (words.some((word) => fold(word) === key)) return weekday;
  }
  // A heading is often "Segunda 15/09" or "2ª feira" — the day is the first word
  // and the rest is a date the pattern does not carry.
  for (const [weekday, words] of WEEKDAY_WORDS) {
    if (words.some((word) => key.split(' ').includes(fold(word)))) return weekday;
  }
  return null;
}

/** `06:30`, `6h30`, `6.30`, `06h` — the ways a sheet writes an hour. */
export function readTime(cell: string): string | null {
  const text = cell.trim();
  if (text === '') return null;

  const withMinutes = /^(\d{1,2})\s*[:hH.]\s*(\d{2})/.exec(text);
  if (withMinutes !== null) {
    const hours = Number(withMinutes[1]);
    const minutes = Number(withMinutes[2]);
    if (hours <= 24 && minutes <= 59) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
    return null;
  }

  // "18h" and "18" — an hour on its own. Only where it reads as an hour of the
  // day, so a headcount column of 24s is never mistaken for midnight.
  const bare = /^(\d{1,2})\s*[hH]?$/.exec(text);
  if (bare !== null) {
    const hours = Number(bare[1]);
    if (hours >= 5 && hours <= 23) return `${String(hours).padStart(2, '0')}:00`;
  }

  return null;
}

/**
 * A cell's text, split into what the class is called and which lanes it takes.
 *
 * `Masters (1-3)`, `6A [1-3]`, `Absolutos 5,6`, `Infantis — Pista 2`. The lanes
 * are left as the sheet wrote them: expanding `1-3` needs to know which lanes
 * the pool has, which is the API's job, not this one's.
 */
export function readCell(raw: string): { name: string; laneNames: string[] } | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text === '') return null;

  // Bracketed is unambiguous and is tried first: "Masters (1-3)".
  const bracketed = /^(.*?)\s*[([{]\s*([^)\]}]+?)\s*[)\]}]\s*$/.exec(text);
  if (bracketed !== null) {
    const name = bracketed[1]!.trim();
    const inside = bracketed[2]!.trim();
    if (name !== '' && looksLikeLanes(inside)) {
      return { name, laneNames: splitLanes(inside) };
    }
  }

  // Otherwise a trailing run of lane-ish text: "Absolutos 5,6", "Infantis - 2".
  const trailing = /^(.*?)[\s—–-]+((?:pistas?\s*)?[\d\s,;/·+-]*\d)\s*$/i.exec(text);
  if (trailing !== null) {
    const name = trailing[1]!.trim();
    const tail = trailing[2]!.trim();
    if (name !== '' && looksLikeLanes(tail)) {
      return { name, laneNames: splitLanes(tail) };
    }
  }

  // No lanes written. The class is still real; the API refuses it for having no
  // lane and says so, which is a better answer than guessing one.
  return { name: text, laneNames: [] };
}

/** Digits, separators and the word "pista" — and at least one digit. */
function looksLikeLanes(text: string): boolean {
  return /\d/.test(text) && /^(?:pistas?\s*)?[\d\s,;/·+aeto-]*$/i.test(fold(text));
}

/** `1-3`, `1,2,3`, `1 e 2`, `Pista 2` — kept as written, expanded server-side. */
function splitLanes(text: string): string[] {
  const cleaned = text.replace(/^pistas?\s*/i, '').trim();
  // A range is one token: the API expands it against the pool's real lanes.
  if (/^\d+\s*(?:-|–|a|to|\.\.)\s*\d+$/i.test(cleaned)) return [cleaned];

  return cleaned
    .split(/[,;/·+]|\s+e\s+|\s+and\s+|\s+/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/** One booking the reader found, in the shape the API's preview expects. */
export interface GridCandidate {
  weekday: number;
  startTime: string;
  durationMinutes: number;
  name: string;
  laneNames: string[];
  /** The spreadsheet line it came from, so the preview can point at it. */
  line: number;
}

export interface GridReading {
  candidates: GridCandidate[];
  /** Which columns turned out to be days — for the screen to show what it read. */
  days: { column: number; weekday: number; heading: string }[];
  /** The column the times came from. Null when none was found. */
  timeColumn: number | null;
  /** Rows with text in a day column that no time row claimed. The agent's work. */
  unplaced: { line: number; text: string }[];
}

/** When the sheet gives no way to tell how long a class runs. */
const FALLBACK_DURATION = 45;

/**
 * The whole reading, from a sheet as `read-sheet.ts` hands it over.
 *
 * Returns what it found *and* what it could not place, rather than throwing:
 * a half-read grid plus a list of leftovers is exactly what the layout agent
 * needs to start from, and it is also what the screen shows when there is no
 * agent at all.
 */
export function readTimetableGrid(sheet: Sheet): GridReading {
  // The header row is part of the grid here, not a set of field names, so the
  // matrix is rebuilt whole.
  const matrix = [sheet.headers, ...sheet.rows];

  /*
   * The day row: whichever row names the most weekdays.
   *
   * Searched rather than assumed to be the first, because a club's sheet very
   * often opens with a title — "Horário 2026/2027" — and sometimes a blank row
   * after it.
   */
  let headerRow = -1;
  let days: GridReading['days'] = [];

  matrix.forEach((row, index) => {
    const found = row
      .map((cell, column) => ({ column, weekday: readWeekday(cell), heading: cell.trim() }))
      .filter((entry): entry is GridReading['days'][number] => entry.weekday !== null);

    // Ties go to the earlier row: a legend at the foot naming days again should
    // never displace the grid's own header.
    if (found.length > days.length) {
      headerRow = index;
      days = found;
    }
  });

  if (headerRow === -1 || days.length === 0) {
    return { candidates: [], days: [], timeColumn: null, unplaced: [] };
  }

  /*
   * The time column: the one left of the first day that holds the most clocks.
   *
   * Left of, because a cell inside the grid can read "18:00–18:45" and would
   * otherwise win a column that is full of classes.
   */
  const firstDayColumn = Math.min(...days.map((day) => day.column));
  let timeColumn: number | null = null;
  let bestClocks = 0;

  for (let column = 0; column < firstDayColumn; column += 1) {
    let clocks = 0;
    for (let index = headerRow + 1; index < matrix.length; index += 1) {
      if (readTime(matrix[index]?.[column] ?? '') !== null) clocks += 1;
    }
    if (clocks > bestClocks) {
      bestClocks = clocks;
      timeColumn = column;
    }
  }

  if (timeColumn === null) {
    return { candidates: [], days, timeColumn: null, unplaced: [] };
  }

  /*
   * Every row that carries a time, with the row it ends at.
   *
   * A class's length is the gap to the next start — which is how a printed
   * timetable expresses it and the only thing on the sheet that says so. The
   * last row of the day has no next, and takes the length of the one before it
   * rather than a constant, because a club whose rows are 30 minutes should not
   * get a 45-minute last class.
   */
  const timed: { index: number; time: string }[] = [];
  for (let index = headerRow + 1; index < matrix.length; index += 1) {
    const time = readTime(matrix[index]?.[timeColumn] ?? '');
    if (time !== null) timed.push({ index, time });
  }

  const minutes = (clock: string): number => {
    const [h, m] = clock.split(':');
    return Number(h) * 60 + Number(m);
  };

  const candidates: GridCandidate[] = [];
  const unplaced: GridReading['unplaced'] = [];

  timed.forEach((slot, position) => {
    const next = timed[position + 1];
    const previous = timed[position - 1];

    let duration = FALLBACK_DURATION;
    if (next !== undefined) {
      const gap = minutes(next.time) - minutes(slot.time);
      // A gap of four hours is the club's lunch, not a four-hour class.
      if (gap > 0 && gap <= 120) duration = gap;
      else if (previous !== undefined) {
        const back = minutes(slot.time) - minutes(previous.time);
        if (back > 0 && back <= 120) duration = back;
      }
    } else if (previous !== undefined) {
      const back = minutes(slot.time) - minutes(previous.time);
      if (back > 0 && back <= 120) duration = back;
    }

    /*
     * A slot's rows: its own, plus the rows under it that carry no time.
     *
     * That is how a wall sheet stacks two classes in one hour — 6A on one line,
     * 6B on the next, the hour written once. Reading only the timed row would
     * lose every second class in the busiest slots.
     */
    const end = next?.index ?? matrix.length;
    for (let index = slot.index; index < end; index += 1) {
      for (const day of days) {
        const cell = readCell(matrix[index]?.[day.column] ?? '');
        if (cell === null) continue;

        candidates.push({
          weekday: day.weekday,
          startTime: slot.time,
          durationMinutes: duration,
          name: cell.name,
          laneNames: cell.laneNames,
          line: index + 1,
        });
      }
    }
  });

  /*
   * Text in a day column that no timed slot covered — above the header, or
   * below the last time. Reported rather than dropped: it is usually a legend,
   * and occasionally it is a class the reader could not place, which is exactly
   * what the agent is for.
   */
  const covered = new Set<number>();
  timed.forEach((slot, position) => {
    const end = timed[position + 1]?.index ?? matrix.length;
    for (let index = slot.index; index < end; index += 1) covered.add(index);
  });

  matrix.forEach((row, index) => {
    if (index === headerRow || covered.has(index)) return;
    const text = days
      .map((day) => (row[day.column] ?? '').trim())
      .filter((cell) => cell !== '')
      .join(' · ');
    if (text !== '') unplaced.push({ line: index + 1, text });
  });

  return { candidates, days, timeColumn, unplaced };
}
