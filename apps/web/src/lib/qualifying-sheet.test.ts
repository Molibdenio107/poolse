import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatSwimTime, INDIVIDUAL_EVENTS, parseSwimTime } from '@poolse/rules';
import {
  canImport,
  cellsOf,
  exportGrid,
  groupField,
  matchQualifyingColumns,
  parseEvent,
  type QualifyingStroke,
  type SheetAgeGroup,
} from './qualifying-sheet.ts';
import { toSheet } from './sheet.ts';

/**
 * The entry-times importer — POOLSE-85 slice 2, QA 1, 2 and 6.
 *
 * The round trip reads the catalogues from disk, as `partner-sheet.test.ts`
 * does: the failure guarded against is somebody rewording "Prova" or a stroke's
 * name a year from now, which breaks the import silently and nowhere near here.
 *
 * Run: pnpm web:test
 */

const GROUPS: SheetAgeGroup[] = [
  { id: 'jf', name: 'Juvenis', gender: 'female' },
  { id: 'jm', name: 'Juvenis', gender: 'male' },
  { id: 'abs', name: 'Absolutos', gender: null },
];

const confidence = (sheet: ReturnType<typeof toSheet>, field: string) =>
  matchQualifyingColumns(sheet, GROUPS).matches.find((m) => m.field === field);

test('QA 1 — "Juvenis F" and "Juvenis M" map certain; a bare "Juvenis" is asked', () => {
  const sheet = toSheet([
    ['Prova', 'Juvenis F', 'Juvenis Masculinos', 'Absolutos'],
    ['100 Livres', '1:04,50', '59,30', '55,00'],
  ]);
  const match = matchQualifyingColumns(sheet, GROUPS);
  assert.equal(match.mapping['event'], 0);
  assert.equal(match.mapping[groupField('jf')], 1);
  assert.equal(match.mapping[groupField('jm')], 2);
  assert.equal(match.mapping[groupField('abs')], 3);
  assert.equal(confidence(sheet, groupField('jf'))?.confidence, 'certain');

  const bare = toSheet([['Prova', 'Juvenis'], ['100 Livres', '1:04,50']]);
  const doubtful = matchQualifyingColumns(bare, GROUPS).matches.find((m) => m.column === 1);
  assert.equal(doubtful?.confidence, 'unsure', 'a heading with no gender is a question, never a guess');
});

test('QA 2 — the ways an event is written, and a relay refused', () => {
  const freestyle100 = { stroke: 'freestyle', distanceM: 100 };
  for (const text of ['100 Livres', '100 m Livre', '100L', '100m livres', '100 Freestyle', '100 Free']) {
    assert.deepEqual(parseEvent(text), freestyle100, text);
  }
  assert.deepEqual(parseEvent('200 Estilos'), { stroke: 'medley', distanceM: 200 });
  assert.deepEqual(parseEvent('50 Bruços'), { stroke: 'breaststroke', distanceM: 50 });
  assert.deepEqual(parseEvent('100 Mariposa'), { stroke: 'butterfly', distanceM: 100 });
  for (const text of ['4x100 Livres', '100 Livres Estafeta', '100 M', '100m', 'Livres', '']) {
    assert.equal(parseEvent(text), null, text);
  }
});

test('an event column or distance + stroke, and at least one group, are needed', () => {
  assert.equal(canImport({ event: 0, distance: null, stroke: null, [groupField('jf')]: 1 }), true);
  assert.equal(canImport({ event: null, distance: 0, stroke: 1, [groupField('jf')]: 2 }), true);
  assert.equal(canImport({ event: 0, distance: null, stroke: null, [groupField('jf')]: null }), false);
  assert.equal(canImport({ event: null, distance: 0, stroke: null, [groupField('jf')]: 1 }), false);
});

test('an empty cell is not sent; an unreadable event still is, to be refused by name', () => {
  const sheet = toSheet([
    ['Prova', 'Juvenis F', 'Juvenis M'],
    ['100 Livres', '1:04,50', ''],
    ['4x100 Livres', '4:10,00', '3:55,00'],
  ]);
  const cells = cellsOf(sheet, { event: 0, distance: null, stroke: null, [groupField('jf')]: 1, [groupField('jm')]: 2 });
  assert.equal(cells.length, 3);
  assert.equal(cells.filter((cell) => cell.stroke === null).length, 2);
});

function catalogue(locale: string): Record<string, Record<string, Record<string, string>>> {
  return JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8')) as never;
}

for (const locale of ['pt-PT', 'en']) {
  test(`QA 6 — the export maps itself and reads back unchanged (${locale})`, () => {
    const messages = catalogue(locale);
    const strokes = messages['progress']!['strokes'] as unknown as Record<QualifyingStroke, string>;
    const eventHeader = (messages['qualifying']!['field'] as unknown as Record<string, string>)['event']!;
    const times = [
      { ageGroupId: 'jf', stroke: 'freestyle' as const, distanceM: 100, course: 'lcm', timeMs: 64500 },
      { ageGroupId: 'jm', stroke: 'freestyle' as const, distanceM: 100, course: 'lcm', timeMs: 59300 },
      { ageGroupId: 'jf', stroke: 'breaststroke' as const, distanceM: 200, course: 'lcm', timeMs: 171230 },
      { ageGroupId: 'abs', stroke: 'medley' as const, distanceM: 400, course: 'lcm', timeMs: 290010 },
      // Another pool length: not in this export.
      { ageGroupId: 'jf', stroke: 'freestyle' as const, distanceM: 50, course: 'scm', timeMs: 28000 },
    ];
    const grid = exportGrid({
      groups: GROUPS,
      times,
      course: 'lcm',
      eventHeader,
      strokeName: (stroke) => strokes[stroke],
      formatTime: formatSwimTime,
      order: INDIVIDUAL_EVENTS,
    });
    const sheet = toSheet(grid);
    const match = matchQualifyingColumns(sheet, GROUPS);
    assert.ok(
      match.matches.every((m) => m.confidence === 'certain'),
      `every exported column maps itself: ${JSON.stringify(match.matches)}`,
    );
    assert.equal(match.unmatched.length, 0);

    const back = cellsOf(sheet, match.mapping).map((cell) => ({
      ageGroupId: cell.ageGroupId,
      stroke: cell.stroke,
      distanceM: cell.distanceM,
      course: 'lcm',
      timeMs: parseSwimTime(cell.time),
    }));
    const key = (t: { ageGroupId: string; stroke: string | null; distanceM: number | null }) =>
      `${t.ageGroupId}|${t.stroke}|${t.distanceM}`;
    assert.deepEqual(
      back.sort((a, b) => key(a).localeCompare(key(b))),
      times.filter((t) => t.course === 'lcm').sort((a, b) => key(a).localeCompare(key(b))),
    );
  });
}
