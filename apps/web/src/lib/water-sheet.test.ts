import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyWaterMapping,
  hasReadings,
  matchWaterColumns,
  EMPTY_WATER_MAPPING,
  WATER_EXPORT_FIELDS,
} from './water-sheet.ts';
import { parseCsv } from './sheet.ts';

/**
 * Round 5, ticket 5 — reading a club's water log.
 *
 * The cases here are what a Portuguese pool's analysis sheet actually looks
 * like, not what a specification says: a "Data" column, "pH" spelled four ways,
 * and two chlorine columns whose headings differ by one word.
 *
 * The chlorine pair is the test that matters. "Cloro livre" and "Cloro
 * combinado" both contain "cloro", and a matcher that took the first synonym to
 * fit would put the combined reading in the free column — which is not a
 * cosmetic error. Free chlorine is the disinfectant and combined is the irritant;
 * swapping them turns a pool that needs shocking into one that reads fine.
 *
 * Run: pnpm web:test
 */

test('a Portuguese club sheet maps itself', () => {
  const sheet = parseCsv(
    [
      'Data;Hora;pH;Cloro livre;Cloro combinado;Temperatura;Observações',
      '2026-09-01;08:30;7,4;1,2;0,3;27,5;Tudo normal',
      '2026-09-02;08:15;7,3;1,1;0,2;27,4;',
    ].join('\r\n'),
  );

  const { mapping } = matchWaterColumns(sheet);

  assert.equal(mapping.takenOn, 0, 'Data');
  assert.equal(mapping.takenTime, 1, 'Hora');
  assert.equal(mapping.ph, 2, 'pH');
  assert.equal(mapping.free_chlorine, 3, 'Cloro livre');
  assert.equal(mapping.combined_chlorine, 4, 'Cloro combinado');
  assert.equal(mapping.temperature, 5, 'Temperatura');
  assert.equal(mapping.notes, 6, 'Observações');
});

test('the two chlorines do not swap places', () => {
  // Reversed in the file, so a matcher relying on column order rather than on
  // the words would get both wrong rather than neither.
  const sheet = parseCsv(
    ['Data;Cloro combinado;Cloro livre', '2026-09-01;0,3;1,2'].join('\r\n'),
  );

  const { mapping } = matchWaterColumns(sheet);
  assert.equal(mapping.combined_chlorine, 1);
  assert.equal(mapping.free_chlorine, 2);
});

test('a sheet with one chlorine column calls it the free one', () => {
  // The common case in a small club: one "Cloro" column, which every operator
  // means as the residual free chlorine.
  const sheet = parseCsv(['Data;Cloro;pH', '2026-09-01;1,2;7,4'].join('\r\n'));

  const { mapping } = matchWaterColumns(sheet);
  assert.equal(mapping.free_chlorine, 1);
  assert.equal(mapping.combined_chlorine, null, 'nothing is invented for the other');
});

test('an English sheet maps itself too', () => {
  const sheet = parseCsv(
    [
      'Date,Time,pH,Free chlorine,Combined chlorine,Temperature,Notes',
      '2026-09-01,08:30,7.4,1.2,0.3,27.5,All normal',
    ].join('\r\n'),
  );

  const { mapping } = matchWaterColumns(sheet);
  assert.equal(mapping.takenOn, 0);
  assert.equal(mapping.free_chlorine, 3);
  assert.equal(mapping.combined_chlorine, 4);
  assert.equal(mapping.notes, 6);
});

test('the longer metrics answer to their abbreviations and their full names', () => {
  const sheet = parseCsv(
    [
      'Data;Alcalinidade;Dureza;Ácido cianúrico;Turvação;Sal;Tanque',
      '2026-09-01;110;250;35;0,2;3200;Tanque Grande',
    ].join('\r\n'),
  );

  const { mapping } = matchWaterColumns(sheet);
  assert.equal(mapping.total_alkalinity, 1);
  assert.equal(mapping.calcium_hardness, 2);
  assert.equal(mapping.cyanuric_acid, 3);
  assert.equal(mapping.turbidity, 4);
  assert.equal(mapping.salt, 5);
  assert.equal(mapping.pool, 6, 'a tank column is recognised, not ignored');
});

test('a bare "Total" is proposed, never silently decided', () => {
  /*
   * "Total" reaches total alkalinity through the shared abbreviation rule, and
   * that is right as far as it goes — in an English sheet it usually is one.
   *
   * What matters is that it is a *proposal*: `matchWaterColumns` returns it in
   * `matches` with the reason it was made, and the wizard renders every field as
   * a select pre-filled with what was proposed. Nothing about this mapping is
   * hidden from the operator, whatever band it scores into.
   *
   * The band itself is deliberately not asserted. It moved from `unsure` to
   * `likely` when `shapeOf` learned to read a Portuguese decimal — the column of
   * numbers now agrees with the guess, which is real evidence — and pinning the
   * score would be pinning an implementation detail of the scorer rather than
   * anything a reader of this file relies on.
   */
  const sheet = parseCsv(['Data;Total;pH', '2026-09-01;110;7,4'].join('\r\n'));

  const { mapping, matches } = matchWaterColumns(sheet);
  assert.equal(mapping.total_alkalinity, 1, 'proposed');

  const total = matches.find((match) => match.field === 'total_alkalinity');
  assert.equal(total?.reason, 'abbreviation', 'and it says why, so the screen can too');

  // The columns it is sure about are still placed with no doubt attached.
  assert.equal(mapping.ph, 2);
  assert.equal(
    matches.find((match) => match.field === 'ph')?.confidence,
    'certain',
    'an exact header match is not made doubtful by its neighbours',
  );
});

test('a metric column full of dates contradicts its own heading', () => {
  /*
   * The check that could not be written until `shapeOf` learned to read a
   * Portuguese decimal — see the note on `EXPECTED_SHAPE`.
   *
   * A column headed "pH" holding dates is a sheet whose headers have shifted by
   * one, which is worth a question rather than a confident mapping. The penalty
   * is sized to drop even an exact header match out of `certain`.
   */
  const shifted = parseCsv(
    ['Data;pH', '2026-09-01;2026-09-01', '2026-09-02;2026-09-02'].join('\r\n'),
  );

  const doubted = matchWaterColumns(shifted).matches.find((match) => match.field === 'ph');
  assert.notEqual(doubted?.confidence, 'certain', 'an exact header over dates is not certain');

  // And the ordinary case is untouched: a pt-PT column of readings agrees with
  // its heading and stays certain, which is the whole reason the check was
  // unusable before.
  const ordinary = parseCsv(['Data;pH', '2026-09-01;7,4', '2026-09-02;7,3'].join('\r\n'));
  assert.equal(
    matchWaterColumns(ordinary).matches.find((match) => match.field === 'ph')?.confidence,
    'certain',
    'a Portuguese decimal is a number, so the shape agrees rather than contradicts',
  );
});

test('a date and one reading is enough; either alone is not', () => {
  const dateOnly = { ...EMPTY_WATER_MAPPING, takenOn: 0 };
  const readingOnly = { ...EMPTY_WATER_MAPPING, ph: 1 };
  const both = { ...EMPTY_WATER_MAPPING, takenOn: 0, ph: 1 };

  // A file of dates is a calendar; a file of readings cannot be put in order,
  // and a water log out of order says nothing about Tuesday.
  assert.equal(hasReadings(dateOnly), false);
  assert.equal(hasReadings(readingOnly), false);
  assert.equal(hasReadings(both), true);
  assert.equal(hasReadings(EMPTY_WATER_MAPPING), false);
});

test('a mapped row keeps only what was mapped and filled', () => {
  const mapping = { ...EMPTY_WATER_MAPPING, takenOn: 0, ph: 1, notes: 2 };

  assert.deepEqual(applyWaterMapping(['2026-09-01', '7,4', 'Tudo normal'], mapping), {
    takenOn: '2026-09-01',
    ph: '7,4',
    notes: 'Tudo normal',
  });

  // An empty cell is absent rather than an empty string: "not measured today" is
  // a different fact from "measured zero", and a pool with zero chlorine is an
  // emergency rather than a blank.
  assert.deepEqual(applyWaterMapping(['2026-09-01', '', ''], mapping), {
    takenOn: '2026-09-01',
  });
});

test('what the export writes, the importer reads back', () => {
  // The round trip the other three importers hold to. Every column the export
  // writes has to be a field this file can place.
  const mapping = { ...EMPTY_WATER_MAPPING };
  for (const field of WATER_EXPORT_FIELDS) {
    assert.ok(field in mapping, `${field} is a mappable field`);
  }
  assert.ok(WATER_EXPORT_FIELDS.includes('takenOn'));
  assert.ok(WATER_EXPORT_FIELDS.includes('ph'));
});
