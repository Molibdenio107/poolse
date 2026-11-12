// `.ts` on the specifier: this module is reached by `node --test` (see timetable-grid.ts).
import type { GridReading } from './timetable-grid.ts';

/**
 * A timetable read for what it says — POOLSE-223.
 *
 * The shape both readers hand on: the model's reading of a PDF or a photo, and
 * the grid reader's reading of a spreadsheet, converted. One shape, so the
 * mapping step and everything after it is one path whichever file arrived.
 *
 * A row is a block of meaning, not a cell: *Natação Livre (6 pistas)* merged
 * from 10:00 to 13:00 is one row from 10:00 to 13:00, and a cell holding two
 * activities is two rows with the same day and times. The model transcribes; it
 * never decides — no turma matching, no lane picking, no dropping rows it finds
 * odd. Pools and activities are mapped by a person in the next step.
 */
export interface TimetableReadRow {
  /** The pool or tank as the document names it; '' when it names none. */
  sourcePool: string;
  /** ISO weekday, Monday 1 … Sunday 7. */
  weekday: number;
  /** `HH:MM`, as printed. */
  start: string;
  /** `HH:MM`, as printed; the block's last end when it spans printed hours. */
  end: string;
  /** As printed, without its lane count. '' for a closed block. */
  activity: string;
  /** The lane count when the document gives one ("3 pistas"), else null. */
  lanes: number | null;
  /** Lane names when the document gives them ("Pista 2", "1-3"); a count is never here. */
  laneNames: string[];
  /** *Encerrado* / *Fechado*: never a booking (POOLSE-223, decided 2). */
  closed: boolean;
  /** Where it came from, for the preview to point at: a sheet line, or the reading's order. */
  line: number;
}

export interface TimetableReading {
  rows: TimetableReadRow[];
  /** Validity dates as printed ("em vigor de … a …"): shown, never applied (decided 3). */
  validity: string | null;
}

const CLOCK = /^(\d{1,2})[:hH.](\d{2})$/;

/** `HH:MM` to minutes, or null. 24:00 is a valid end. */
export function clockMinutes(raw: string): number | null {
  const match = CLOCK.exec(raw.trim());
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59 || hours > 24 || (hours === 24 && minutes > 0)) return null;
  return hours * 60 + minutes;
}

function clockText(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

const MAX_TEXT = 200;
const MAX_ROWS = 2_000;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : '';
}

/**
 * The model's reply, narrowed by hand: it is somebody else's JSON until proven
 * otherwise. A row whose day or times cannot be read is dropped here rather than
 * passed on, because the schema already required them and a row that broke it is
 * noise, not a class.
 */
export function narrowReading(value: unknown): TimetableReading {
  const record = (value ?? {}) as { rows?: unknown; validity?: unknown };
  const raw = Array.isArray(record.rows) ? record.rows.slice(0, MAX_ROWS) : [];
  const rows: TimetableReadRow[] = [];

  raw.forEach((entry, index) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    const weekday = typeof row['weekday'] === 'number' ? Math.trunc(row['weekday']) : NaN;
    if (!(weekday >= 1 && weekday <= 7)) return;

    const startAt = clockMinutes(text(row['start']));
    const endAt = clockMinutes(text(row['end']));
    if (startAt === null || endAt === null || endAt <= startAt) return;

    const closed = row['closed'] === true;
    const activity = closed ? '' : text(row['activity']);
    if (!closed && activity === '') return;

    const lanes =
      typeof row['lanes'] === 'number' && Number.isInteger(row['lanes']) && row['lanes'] > 0 && row['lanes'] <= 50
        ? row['lanes']
        : null;
    const laneNames = Array.isArray(row['laneNames'])
      ? row['laneNames'].map(text).filter((name) => name !== '').slice(0, 24)
      : [];

    rows.push({
      sourcePool: text(row['sourcePool']),
      weekday,
      start: clockText(startAt),
      end: clockText(endAt),
      activity,
      lanes,
      laneNames,
      closed,
      line: index + 1,
    });
  });

  const validity = text(record.validity);
  return { rows, validity: validity === '' ? null : validity };
}

/** "Hidroginástica (3 pistas)" in a spreadsheet cell: the count, and the name without it. */
const LANE_COUNT = /\(?\s*(\d{1,2})\s*pistas?\s*\)?/i;
const LANE_NAMED = /pista\s*\d/i;
const CLOSED = /^\s*(encerrad[oa]|fechad[oa]|closed)\s*$/i;

/**
 * A spreadsheet's reading in the same shape (POOLSE-223, dev notes): no source
 * pool, the count taken out of the name, and a closed cell marked closed. No
 * model call — a spreadsheet's cells are already cells.
 */
export function fromGridReading(grid: GridReading): TimetableReading {
  const rows = grid.candidates.flatMap((candidate): TimetableReadRow[] => {
    const startAt = clockMinutes(candidate.startTime);
    if (startAt === null) return [];
    const end = clockText(Math.min(startAt + candidate.durationMinutes, 24 * 60));

    const isCount = (value: string): boolean => LANE_COUNT.test(value) && !LANE_NAMED.test(value);
    const inName = isCount(candidate.name) ? LANE_COUNT.exec(candidate.name) : null;
    const inLanes = candidate.laneNames.find(isCount);
    const counted = inName?.[1] ?? (inLanes === undefined ? undefined : LANE_COUNT.exec(inLanes)?.[1]);
    const name = inName === null ? candidate.name : candidate.name.replace(inName[0], '').replace(/\s{2,}/g, ' ').trim();
    const closed = CLOSED.test(name);

    return [
      {
        sourcePool: '',
        weekday: candidate.weekday,
        start: candidate.startTime,
        end,
        activity: closed ? '' : name,
        lanes: counted === undefined || Number(counted) === 0 ? null : Number(counted),
        laneNames: candidate.laneNames.filter((lane) => !isCount(lane)),
        closed,
        line: candidate.line,
      },
    ];
  });
  return { rows, validity: null };
}
