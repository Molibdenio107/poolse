import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyExamMapping,
  carriesNoExam,
  EMPTY_EXAM_MAPPING,
  EXAM_EXPORT_FIELDS,
  EXAM_FIELDS,
  hasExamKey,
  matchExamColumns,
  parseExamDate,
  parseExamResult,
  RESULT_EXPORT_WORD,
} from './exam-sheet.ts';
import { parseCsv } from './sheet.ts';

/**
 * The exame médico round trip — POOLSE-133.
 *
 * An exported file must map itself when it comes back, in either locale: the
 * header row is `exams.field.*` read from the catalogue on disk, so rewording a
 * label breaks this test rather than silently breaking the round trip.
 *
 * Run: pnpm web:test
 */
function headersFor(locale: string): string[] {
  const path = new URL(`../messages/${locale}.json`, import.meta.url);
  const catalogue = JSON.parse(readFileSync(path, 'utf8')) as Record<string, Record<string, unknown>>;
  const field = catalogue['exams']?.['field'] as Record<string, string> | undefined;
  assert.ok(field !== undefined, `exams.field is missing from ${locale}`);
  return EXAM_EXPORT_FIELDS.map((name) => {
    const label = field[name];
    assert.ok(label !== undefined, `exams.field.${name} is missing from ${locale}`);
    return label;
  });
}

for (const locale of ['pt-PT', 'en']) {
  test(`an exported ${locale} exam list maps itself when it comes back`, () => {
    const headers = headersFor(locale);
    // The shape the export writes: ISO dates, the Portuguese result word, and a
    // student with no exam whose row is blank past the birth date.
    const sheet = parseCsv(
      [
        headers.join(';'),
        `Ana Ferreira;123456789;2012-03-04;2026-09-01;${RESULT_EXPORT_WORD.fit};2027-08-31`,
        `Bruno Lopes;;2011-11-20;2026-02-10;${RESULT_EXPORT_WORD.fit_with_conditions};`,
        'Rita Nunes;;2013-06-15;;;',
      ].join('\n'),
    );

    const { mapping } = matchExamColumns(sheet);
    EXAM_EXPORT_FIELDS.forEach((name, column) => {
      assert.equal(mapping[name], column, `"${headers[column]}" should map to ${name}, not ${String(mapping[name])}`);
    });
    assert.equal(hasExamKey(mapping), true);
  });
}

test('every exported column is one the vocabulary knows, and every field is exported', () => {
  for (const name of EXAM_EXPORT_FIELDS) assert.ok((EXAM_FIELDS as readonly string[]).includes(name));
  for (const name of EXAM_FIELDS) assert.ok(EXAM_EXPORT_FIELDS.includes(name), `${name} is never exported`);
});

test('the result the export writes reads back as the same result', () => {
  for (const [result, word] of Object.entries(RESULT_EXPORT_WORD)) {
    assert.equal(parseExamResult(word), result);
  }
});

test('a result reads in either language, and nonsense is no result', () => {
  assert.equal(parseExamResult('apto'), 'fit');
  assert.equal(parseExamResult('NÃO APTO'), 'unfit');
  assert.equal(parseExamResult('Inapto'), 'unfit');
  assert.equal(parseExamResult('Fit with conditions'), 'fit_with_conditions');
  assert.equal(parseExamResult('Unfit'), 'unfit');
  assert.equal(parseExamResult('fit_with_conditions'), 'fit_with_conditions');
  assert.equal(parseExamResult('talvez'), null);
  assert.equal(parseExamResult(''), null);
});

test('a date is ISO or day first, and an impossible one is none', () => {
  assert.equal(parseExamDate('2026-09-01'), '2026-09-01');
  assert.equal(parseExamDate('03/04/2026'), '2026-04-03');
  assert.equal(parseExamDate('3-4-2026'), '2026-04-03');
  assert.equal(parseExamDate('31/02/2026'), null);
  assert.equal(parseExamDate('03/04/26'), null);
  assert.equal(parseExamDate(''), null);
});

test('three date columns are not read as each other', () => {
  const sheet = parseCsv(
    ['Nome;NIF;Nascimento;Data;Validade;Resultado', 'Ana;123456789;04/03/2012;01/09/2026;31/08/2027;Apto'].join('\n'),
  );
  const { mapping } = matchExamColumns(sheet);
  assert.equal(mapping.birthDate, 2);
  // A bare "Data" abbreviates "data do exame" better than the birth date's
  // words, which is the likely reading on an exam sheet; the mapping step shows
  // every field with a sample, so a wrong one is seen before the preview.
  assert.equal(mapping.examinedOn, 3);
  assert.equal(mapping.validUntil, 4);
  assert.equal(mapping.result, 5);
});

test('a mapped row is the API shape, and a row with no exam is blank', () => {
  const mapping = { ...EMPTY_EXAM_MAPPING, studentName: 0, taxNumber: 1, examinedOn: 2, result: 3, validUntil: 4 };
  assert.deepEqual(applyExamMapping(['Ana', '123 456 789', '01/09/2026', 'Apto', ''], mapping), {
    studentName: 'Ana',
    taxNumber: '123456789',
    birthDate: null,
    examinedOn: '2026-09-01',
    result: 'fit',
    validUntil: null,
  });
  assert.equal(carriesNoExam(['Ana', '123456789', '', '', ''], mapping), true);
  assert.equal(carriesNoExam(['Ana', '123456789', '2026-09-01', '', ''], mapping), false);
});
