// `.ts` on the specifier: `node --test` reaches this module and does not add extensions.
import { matchFields, type MatchResult, type MatchSpec, type Sheet } from './sheet.ts';

/**
 * The entry-times importer's vocabulary — POOLSE-85, slice 2.
 *
 * **The file is the FPN's table as published, wide** (Rui, 19-10-2026): one row
 * per event, one column per age group and gender.
 *
 *     Prova          Juvenis F   Juvenis M   Juniores F   Juniores M
 *     50 Livres      29,80       27,10       29,20        26,40
 *     100 Livres     1:04,50     59,30       1:03,10      57,90
 *
 * So the fields are not a fixed list. Beside `event` (or `distance` + `stroke`)
 * there is one field per age group of the standard's season, `group:<id>`, and
 * the matcher is built at read time from those groups. Everything else is the
 * shared `matchFields`, unchanged.
 *
 * **A heading that names the group but not the gender is never guessed.**
 * "Juvenis" over two Juvenis bands abbreviates both "Juvenis Femininos" and
 * "Juvenis Masculinos", scores *unsure*, and is asked — a whole column of girls'
 * times filed under the boys is the mistake this importer must not make quietly.
 */

export type QualifyingStroke = 'freestyle' | 'backstroke' | 'breaststroke' | 'butterfly' | 'medley';
export type QualifyingField = string;
export type QualifyingMapping = Record<QualifyingField, number | null>;

export interface SheetAgeGroup {
  id: string;
  name: string;
  gender: 'male' | 'female' | null;
}

export const BASE_FIELDS = ['event', 'distance', 'stroke'] as const;
export const groupField = (id: string): string => `group:${id}`;
export const groupOf = (field: string): string | null =>
  field.startsWith('group:') ? field.slice('group:'.length) : null;

const FEMALE = ['f', 'fem', 'femininos', 'feminino', 'femininas', 'raparigas', 'meninas', 'senhoras', 'girls', 'women', 'female'];
const MALE = ['m', 'masc', 'masculinos', 'masculino', 'rapazes', 'meninos', 'homens', 'boys', 'men', 'male'];

const BASE_SYNONYMS: [QualifyingField, string[]][] = [
  ['event', ['prova', 'provas', 'evento', 'distancia e estilo', 'distancia estilo', 'event', 'events', 'race']],
  ['distance', ['distancia', 'metros', 'distance', 'metres', 'meters']],
  ['stroke', ['estilo', 'tecnica', 'nado', 'stroke', 'style']],
];

function plain(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * The matcher for one season's groups. A gendered group answers to its name
 * plus a gender word ("juvenis f", "juvenis femininos"); a group for both
 * answers to its bare name.
 */
export function qualifyingMatchSpec(groups: SheetAgeGroup[]): MatchSpec<QualifyingField> {
  const empty: QualifyingMapping = { event: null, distance: null, stroke: null };
  const synonyms: [QualifyingField, string[]][] = [...BASE_SYNONYMS];
  for (const group of groups) {
    const field = groupField(group.id);
    empty[field] = null;
    const name = plain(group.name);
    const words = group.gender === null ? [] : group.gender === 'female' ? FEMALE : MALE;
    synonyms.push([
      field,
      group.gender === null ? [name] : words.flatMap((word) => [`${name} ${word}`, `${word} ${name}`]),
    ]);
  }
  return { empty, synonyms };
}

export function matchQualifyingColumns(sheet: Sheet, groups: SheetAgeGroup[]): MatchResult<QualifyingField> {
  return matchFields(sheet, qualifyingMatchSpec(groups));
}

/** Enough to import anything: an event (or distance and stroke) and one group. */
export function canImport(mapping: QualifyingMapping): boolean {
  const event = mapping['event'] !== null || (mapping['distance'] !== null && mapping['stroke'] !== null);
  const group = Object.keys(mapping).some((field) => groupOf(field) !== null && mapping[field] !== null);
  return event && group;
}

/**
 * Stroke words, Portuguese and English, singular and plural, and the FPN's one-
 * letter codes. Single letters are read only on their own after a distance
 * ("100 L") — "100 M" is refused rather than read as metres or as mariposa.
 */
const STROKE_WORDS: [QualifyingStroke, string[]][] = [
  ['freestyle', ['livre', 'livres', 'crol', 'crawl', 'free', 'freestyle', 'fr', 'l']],
  ['backstroke', ['costas', 'back', 'backstroke', 'bk', 'c']],
  ['breaststroke', ['brucos', 'bruco', 'breast', 'breaststroke', 'br', 'b']],
  ['butterfly', ['mariposa', 'borboleta', 'butterfly', 'fly', 'fl']],
  ['medley', ['estilos', 'estilo individual', 'medley', 'individual medley', 'im', 'e']],
];

/**
 * "100 Livres", "100 m Livre", "100L", "200 Estilos", "100 Free" → an event.
 * Null for anything else, a relay included ("4x100", "estafeta").
 */
export function parseEvent(raw: string): { stroke: QualifyingStroke; distanceM: number } | null {
  const text = plain(raw);
  if (text === '' || /\b(estafeta|estafetas|relay|relays)\b/.test(text) || /\d\s*x\s*\d/.test(raw.toLowerCase())) {
    return null;
  }
  // "100m" and "100 m" are metres; a lone "m" after the distance and nothing else is not read.
  const match = /^(\d{2,4})\s*(?:(?:m|metros|metres|meters)\b)?\s*(.*)$/.exec(text.replace(/^(\d+)([a-z])/, '$1 $2'));
  if (match === null) return null;
  const distanceM = Number(match[1]);
  const rest = (match[2] ?? '').trim();
  if (rest === '' || distanceM < 25 || distanceM > 1500) return null;
  return strokeOf(rest) === null ? null : { stroke: strokeOf(rest)!, distanceM };
}

/** A stroke column's value on its own: "Livres", "Costas", "Medley". */
export function strokeOf(raw: string): QualifyingStroke | null {
  const text = plain(raw);
  for (const [stroke, words] of STROKE_WORDS) {
    if (words.includes(text)) return stroke;
  }
  return null;
}

export interface SheetCell {
  /** The sheet row, 0-based, for "linha N" on the preview. */
  row: number;
  ageGroupId: string;
  /** What the event cell said, for a refusal to quote. */
  eventLabel: string;
  stroke: QualifyingStroke | null;
  distanceM: number | null;
  /** The time as typed; the API reads it with `parseSwimTime`. */
  time: string;
}

/**
 * The mapped sheet as cells — one per (row, mapped group) with something in it.
 * An empty cell is not sent: in an import it means "no time in the file", which
 * leaves the existing time alone.
 */
export function cellsOf(sheet: Sheet, mapping: QualifyingMapping): SheetCell[] {
  const cells: SheetCell[] = [];
  const groupColumns = Object.entries(mapping).flatMap(([field, column]) => {
    const id = groupOf(field);
    return id === null || column === null ? [] : [{ id, column }];
  });
  const at = (row: string[], field: string): string => {
    const column = mapping[field];
    return column === null || column === undefined ? '' : (row[column] ?? '').trim();
  };

  sheet.rows.forEach((row, index) => {
    let label: string;
    let event: { stroke: QualifyingStroke; distanceM: number } | null;
    if (mapping['event'] !== null && mapping['event'] !== undefined) {
      label = at(row, 'event');
      event = parseEvent(label);
    } else {
      const distance = at(row, 'distance');
      const stroke = at(row, 'stroke');
      label = `${distance} ${stroke}`.trim();
      const distanceM = Number(distance.replace(/\s*m$/i, ''));
      const parsedStroke = strokeOf(stroke);
      event =
        parsedStroke !== null && Number.isInteger(distanceM) && distanceM >= 25 && distanceM <= 1500
          ? { stroke: parsedStroke, distanceM }
          : null;
    }
    for (const { id, column } of groupColumns) {
      const time = (row[column] ?? '').trim();
      // A row with nothing for this group says nothing — and a blank row is not an event to refuse.
      if (time === '' || label === '') continue;
      cells.push({
        row: index,
        ageGroupId: id,
        eventLabel: label,
        stroke: event?.stroke ?? null,
        distanceM: event?.distanceM ?? null,
        time,
      });
    }
  });
  return cells;
}

/**
 * The export's header for a group — `<name> F` / `<name> M`, or the bare name
 * for both. It is the shortest heading `qualifyingMatchSpec` maps *certain*,
 * which is what makes a round trip map itself.
 */
export function exportHeader(group: SheetAgeGroup): string {
  return group.gender === null ? group.name : `${group.name} ${group.gender === 'female' ? 'F' : 'M'}`;
}

/**
 * The export, as a grid: the header row, then one row per event that has a
 * time in this pool length for any group. Events in the FPN's order, then any
 * other event the standard carries. Written by the export route and read back
 * by the round-trip test, so the two cannot drift.
 */
export function exportGrid({
  groups,
  times,
  course,
  eventHeader,
  strokeName,
  formatTime,
  order,
}: {
  groups: SheetAgeGroup[];
  times: { ageGroupId: string; stroke: QualifyingStroke; distanceM: number; course: string; timeMs: number }[];
  course: string;
  eventHeader: string;
  strokeName: (stroke: QualifyingStroke) => string;
  formatTime: (timeMs: number) => string;
  order: readonly { stroke: QualifyingStroke; distanceM: number }[];
}): string[][] {
  const inCourse = times.filter((time) => time.course === course);
  const events = [...order];
  for (const time of inCourse) {
    if (!events.some((e) => e.stroke === time.stroke && e.distanceM === time.distanceM)) {
      events.push({ stroke: time.stroke, distanceM: time.distanceM });
    }
  }
  const grid: string[][] = [[eventHeader, ...groups.map(exportHeader)]];
  for (const event of events) {
    const cells = groups.map((group) => {
      const found = inCourse.find(
        (time) => time.ageGroupId === group.id && time.stroke === event.stroke && time.distanceM === event.distanceM,
      );
      return found === undefined ? '' : formatTime(found.timeMs);
    });
    if (cells.every((cell) => cell === '')) continue;
    grid.push([`${event.distanceM} m ${strokeName(event.stroke)}`, ...cells]);
  }
  return grid;
}
