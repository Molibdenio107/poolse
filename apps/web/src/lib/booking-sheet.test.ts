import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BOOKING_FIELDS,
  EMPTY_BOOKING_MAPPING,
  matchBookingColumns,
  type BookingField,
} from './booking-sheet.ts';
import { parseCsv } from './sheet.ts';

/**
 * The timetable's round trip — POOLSE-54, criterion 7.
 *
 * The `Marcações` sheet is the half of the export that is data rather than a
 * picture: a club plans next season in Excel and brings the file back. That only
 * works if the header row this writes is the header row an importer recognises,
 * which is why the labels are the catalogue's and not prose invented for the
 * file.
 *
 * **The catalogues are read from disk, deliberately.** The failure being guarded
 * against is somebody rewording a label a year from now — "Hora" becoming "Hora
 * de início", say — which breaks the round trip silently and nowhere near this
 * file. A fixture would keep passing while the product broke, which is exactly
 * what `sheet.test.ts` says about the register's own version of this.
 *
 * Run: pnpm web:test
 */
function catalogue(locale: string): Record<string, Record<string, Record<string, string>>> {
  const path = new URL(`../messages/${locale}.json`, import.meta.url);
  return JSON.parse(readFileSync(path, 'utf8')) as never;
}

function headersFor(locale: string): string[] {
  const field = catalogue(locale)['grid']?.['export']?.['field'] as unknown as Record<
    string,
    string
  >;

  return BOOKING_FIELDS.map((name) => {
    const label = field[name];
    assert.ok(label !== undefined, `grid.export.field.${name} is missing from ${locale}`);
    return label;
  });
}

for (const locale of ['pt-PT', 'en']) {
  test(`an exported ${locale} timetable maps itself when it comes back`, () => {
    const headers = headersFor(locale);

    /*
     * Through a real sheet, not the header array alone. The matcher weighs a
     * column's *values* as well as its heading — that is how it tells a duration
     * from a headcount when both are called something plausible — so a test that
     * skipped the rows would be testing half the mechanism.
     */
    const sheet = parseCsv(
      [
        headers.join(';'),
        'Turma;Absolutos;;Terça;19:15;20:00;45;Tanque Grande;Pista 2, Pista 3;Sandra Lopes;Atribuído;18;Competição;Absolutos;',
        'Parceria;6A;ES D. Dinis;Segunda;09:30;10:15;45;Tanque Grande;Pista 1;Prof. Silva;Professor da entidade;24;Desporto escolar;;Entra pela rampa',
      ].join('\n'),
    );

    const { mapping } = matchBookingColumns(sheet);

    BOOKING_FIELDS.forEach((name, column) => {
      assert.equal(
        mapping[name],
        column,
        `"${headers[column]}" should map to ${name}, not ${String(mapping[name])}`,
      );
    });
  });
}

test('every exported column is one the vocabulary knows about', () => {
  // Belt and braces on the contract: a field added to the export that the
  // mapping has never heard of would be a column nothing could ever claim.
  for (const name of BOOKING_FIELDS) {
    assert.ok(name in EMPTY_BOOKING_MAPPING, `${name} is not a booking field`);
  }
});

test('the two time columns do not claim each other', () => {
  /*
   * The trap this vocabulary exists to avoid. "Hora", "Início", "Fim" and
   * "Duração" are four words for one idea and a club's sheet uses whichever two
   * it likes — reading the end time as the start moves every class on the sheet
   * by three quarters of an hour, and it would look entirely plausible.
   */
  const sheet = parseCsv('Início;Fim\n19:15;20:00');
  const { mapping } = matchBookingColumns(sheet);

  assert.equal(mapping.startTime, 0);
  assert.equal(mapping.endTime, 1);
});

test('a sheet with one time column means the time it starts', () => {
  const sheet = parseCsv('Nome;Hora\nAbsolutos;19:15');
  const { mapping } = matchBookingColumns(sheet);

  assert.equal(mapping.startTime, 1);
  assert.equal(mapping.endTime, null);
});

test('a lane column is not a tank column', () => {
  // Both read as "where in the pool" to anybody who has not seen the schema, and
  // putting a lane's name in the pool field would place a class in a tank the
  // club does not have.
  const sheet = parseCsv('Tanque;Pistas\nTanque Grande;Pista 2, Pista 3');
  const { mapping } = matchBookingColumns(sheet);

  assert.equal(mapping.pool, 0);
  assert.equal(mapping.lanes, 1);
});

test('a duration column full of words stops being a certainty', () => {
  /*
   * The shape check earning its place. A column headed "Duração" holding "Manhã"
   * is a sheet whose headers have shifted, and importing it would give every
   * class a length of NaN minutes.
   *
   * It is still *mapped*, and that is `sheet.ts`'s deliberate design rather than
   * a gap: the penalty drops even a perfect header match out of `certain` and
   * into the band the mapping screen asks about, so a person confirms it. A hard
   * refusal would silently drop a column somebody can see is right.
   */
  const sheet = parseCsv(
    ['Nome;Duração', 'Absolutos;Manhã', 'Cadetes;Tarde', 'Infantis;Manhã'].join('\n'),
  );
  const { matches } = matchBookingColumns(sheet);

  const duration = matches.find((match) => match.field === 'durationMinutes');
  assert.notEqual(duration?.confidence, 'certain');

  // And a column of real numbers under the same heading is a certainty.
  const good = parseCsv(['Nome;Duração', 'Absolutos;45', 'Cadetes;45', 'Infantis;90'].join('\n'));
  const found = matchBookingColumns(good).matches.find(
    (match) => match.field === 'durationMinutes',
  );
  assert.equal(found?.confidence, 'certain');
});

test('an English sheet maps with the Portuguese vocabulary present', () => {
  // Both locales live in one synonym list rather than in two, so a club that
  // exported in English and a club that exported in Portuguese are read by the
  // same code — and a mixed file, which is what happens when somebody edits one
  // column heading, still maps.
  const sheet = parseCsv('Name;Day of week;Start;Lanes\nAbsolutos;Tuesday;19:15;Pista 2');
  const { mapping } = matchBookingColumns(sheet);

  assert.equal(mapping.name, 0);
  assert.equal(mapping.weekday, 1);
  assert.equal(mapping.startTime, 2);
  assert.equal(mapping.lanes, 3);
});

test('an unmatched field is null rather than the first spare column', () => {
  const sheet = parseCsv('Nome;Qualquer coisa\nAbsolutos;x');
  const { mapping } = matchBookingColumns(sheet);

  assert.equal(mapping.name, 0);
  for (const field of BOOKING_FIELDS.filter((f) => f !== 'name')) {
    assert.equal(mapping[field as BookingField], null, `${field} claimed a column it should not`);
  }
});
