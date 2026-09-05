import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, readCsvCell, toCsv } from './csv.ts';

/**
 * CSV export safety.
 *
 * The tests that matter are the formula ones. A CSV cell beginning `=`, `+`, `-`
 * or `@` is executed by Excel when the operator double-clicks the export, and
 * the payload gets there through the import wizard rather than being typed — a
 * club's old spreadsheet carries it in and the next export carries it back out.
 *
 * This regressed once by being written four times, once per export, each copy
 * escaping the delimiter and none of them the formula. There is one copy now and
 * `pnpm csv:check` fails the build if a fifth appears.
 *
 * Run: pnpm web:test
 */

test('a formula is neutralised, whatever it starts with', () => {
  // The four leads, each a working DDE payload in Excel — not just `=`.
  assert.equal(csvCell('=cmd|\'/c calc\'!A0'), "'=cmd|'/c calc'!A0");
  assert.equal(csvCell('+cmd|\'/c calc\'!A0'), "'+cmd|'/c calc'!A0");
  assert.equal(csvCell('-cmd|\'/c calc\'!A0'), "'-cmd|'/c calc'!A0");
  assert.equal(csvCell('@SUM(1+1)'), "'@SUM(1+1)");

  // Excel strips leading whitespace before deciding, so these are formulas too.
  assert.equal(csvCell('\t=1+1'), "'\t=1+1");
  assert.equal(csvCell('\r=1+1'), '"\'\r=1+1"');
});

test('the apostrophe goes on before the quoting, not after', () => {
  /*
   * The ordering is the whole guarantee. Quoting first would give
   * `"=HYPERLINK(...)"` — Excel strips the quotes and evaluates what is left, so
   * a quoted formula is still a formula. The apostrophe has to be inside.
   */
  const cell = csvCell('=HYPERLINK("http://evil.example";"Clique")');

  assert.ok(cell.startsWith('"\''), 'the apostrophe is inside the quotes');
  assert.doesNotMatch(cell, /^"=/, 'quoting alone does not disarm a formula');
});

test('ordinary data is left exactly alone', () => {
  // Nothing a club actually stores starts with a formula character: names,
  // dates, emails, nine-digit Portuguese phones and taxpayer numbers.
  assert.equal(csvCell('Maria Santos'), 'Maria Santos');
  assert.equal(csvCell('963855201'), '963855201');
  assert.equal(csvCell('2018-04-11'), '2018-04-11');
  assert.equal(csvCell('maria@example.pt'), 'maria@example.pt', 'the @ is not leading');
  assert.equal(csvCell(''), '');
  assert.equal(csvCell('Ana Sofía Gonçalves'), 'Ana Sofía Gonçalves', 'accents untouched');
});

test('the delimiter, quotes and newlines are still escaped', () => {
  // The behaviour the four copies already had, kept.
  assert.equal(csvCell('Santos; Maria'), '"Santos; Maria"');
  assert.equal(csvCell('a "quoted" note'), '"a ""quoted"" note"');
  assert.equal(csvCell('line one\nline two'), '"line one\nline two"');
});

test('a Poolse export re-imports unchanged', () => {
  // The round trip `sheet.test.ts` relies on: what the escape does, the reader
  // undoes, for every shape of value.
  for (const value of [
    '=cmd|\'/c calc\'!A0',
    '@SUM(1+1)',
    '-5',
    '+351912345678',
    'Maria Santos',
    "O'Brien",
    // The two that make the escape reversible rather than merely safe: data that
    // already begins with our own escape character.
    "'89",
    "'=1+1",
    '',
  ]) {
    assert.equal(readCsvCell(csvCell(value).replace(/^"|"$/g, '')), value, value);
  }
});

test('an apostrophe that belongs to the data survives the reader', () => {
  // `csvCell` only ever puts an apostrophe in front of something it escaped, so
  // those are the only ones that come off again.
  assert.equal(readCsvCell("O'Brien"), "O'Brien", 'not leading, not an escape');
  assert.equal(readCsvCell("'89"), "'89", "a foreign file's own apostrophe");
  assert.equal(readCsvCell("''=1+1"), "'=1+1", 'exactly one apostrophe comes off');
  assert.equal(readCsvCell("'=1+1"), '=1+1');
});

test('a file carries the mark, the semicolons and the CRLF', () => {
  const csv = toCsv([
    ['Nome', 'Telefone'],
    ['Maria Santos', '963855201'],
  ]);

  assert.ok(csv.startsWith('﻿'), 'the BOM, or Excel renders every accent as mojibake');
  assert.match(csv, /Nome;Telefone\r\n/, 'semicolons and CRLF');
  assert.ok(csv.endsWith('\r\n'), 'a trailing break, so the last row is a row');
});
