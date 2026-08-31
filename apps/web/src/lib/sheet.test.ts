import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyMapping,
  guessMapping,
  hasName,
  parseCsv,
  toSheet,
  EMPTY_MAPPING,
  EXPORT_FIELDS,
} from './sheet.ts';

/**
 * Slice 1.10 — reading a real spreadsheet.
 *
 * Every case here came from thinking about what a swimming club's file actually
 * looks like rather than what a CSV specification says: semicolons because Excel
 * writes them in a Portuguese locale, a BOM because Excel writes that too, a
 * blank line before the note about who has paid, and a "Nome do encarregado"
 * column sitting next to "Nome".
 *
 * The last of those is the one worth guarding. Reading the guardian's column as
 * the student's name imports a register of parents, and it would look plausible
 * enough on the preview to be approved.
 *
 * Run: pnpm web:test
 */

test('a Portuguese export is semicolon-delimited, and is read as such', () => {
  const sheet = parseCsv('Nome;Data de nascimento\nRita Nunes;12/04/1988');

  assert.deepEqual(sheet.headers, ['Nome', 'Data de nascimento']);
  assert.deepEqual(sheet.rows, [['Rita Nunes', '12/04/1988']]);
});

test('a comma-delimited file still works, and so does a tab-delimited one', () => {
  assert.deepEqual(parseCsv('Nome,Nivel\nRita,Adultos').rows, [['Rita', 'Adultos']]);
  assert.deepEqual(parseCsv('Nome\tNivel\nRita\tAdultos').rows, [['Rita', 'Adultos']]);
});

test("Excel's byte-order mark does not swallow the first header", () => {
  const sheet = parseCsv('﻿Nome;Nivel\nRita;Adultos');

  assert.deepEqual(sheet.headers, ['Nome', 'Nivel']);
  // Without the strip the header is "﻿Nome", which matches nothing and
  // leaves the name column unmapped for no visible reason.
  assert.equal(guessMapping(sheet.headers).fullName, 0);
});

test('quotes, doubled quotes, embedded delimiters and newlines survive', () => {
  const sheet = parseCsv('Nome;Notas\n"Nunes, Rita";"disse ""adoro"";\nnada mais"');

  assert.deepEqual(sheet.rows, [['Nunes, Rita', 'disse "adoro";\nnada mais']]);
});

test('CRLF is a line ending, not a stray character on every row', () => {
  const sheet = parseCsv('Nome;Nivel\r\nRita;Adultos\r\n');

  assert.deepEqual(sheet.headers, ['Nome', 'Nivel']);
  assert.deepEqual(sheet.rows, [['Rita', 'Adultos']]);
  assert.equal(sheet.rows.length, 1, 'and the trailing newline is not a row');
});

test('blank lines are dropped, and short rows are padded to the widest', () => {
  const sheet = toSheet([
    ['Nome', 'Nivel', 'Telefone'],
    ['Rita'],
    ['', '', ''],
    ['Tiago', 'Adultos', '912345678'],
  ]);

  assert.deepEqual(sheet.rows, [
    ['Rita', '', ''],
    ['Tiago', 'Adultos', '912345678'],
  ]);
});

test('the guardian columns are not claimed by the student ones', () => {
  const mapping = guessMapping([
    'Nome',
    'Data de nascimento',
    'Nome do encarregado',
    'Telefone do encarregado',
    'Email do encarregado',
  ]);

  assert.equal(mapping.fullName, 0);
  assert.equal(mapping.birthDate, 1);
  assert.equal(mapping.guardianName, 2);
  assert.equal(mapping.guardianPhone, 3);
  assert.equal(mapping.guardianEmail, 4);

  // And the student's own contact columns stay unmapped rather than borrowing
  // the guardian's — this is the failure that would import parents as children.
  assert.equal(mapping.contactPhone, null);
  assert.equal(mapping.contactEmail, null);
});

test('headers are matched whatever their accents, caps and punctuation', () => {
  const mapping = guessMapping(['NOME COMPLETO', 'Data de Nascimento', 'Nível', 'E-mail']);

  assert.equal(mapping.fullName, 0);
  assert.equal(mapping.birthDate, 1);
  assert.equal(mapping.levelName, 2);
  assert.equal(mapping.contactEmail, 3);
});

test('English headers are guessed too, because half the sheets are exports', () => {
  const mapping = guessMapping(['First name', 'Surname', 'Date of birth', 'Level', 'Phone']);

  assert.equal(mapping.firstName, 0);
  assert.equal(mapping.lastName, 1);
  assert.equal(mapping.birthDate, 2);
  assert.equal(mapping.levelName, 3);
  assert.equal(mapping.contactPhone, 4);
});

test('a sheet with both name halves does not also claim the whole-name column', () => {
  const mapping = guessMapping(['Nome próprio', 'Apelido']);

  assert.equal(mapping.firstName, 0);
  assert.equal(mapping.lastName, 1);
  assert.equal(mapping.fullName, null, 'or the screen implies a column that is ignored');
});

test('a column nothing recognises is left alone rather than attached to the nearest', () => {
  const mapping = guessMapping(['Nome', 'Quota paga', 'Tamanho do fato']);

  assert.equal(mapping.fullName, 0);
  assert.equal(mapping.notes, null);
  assert.equal(mapping.levelName, null);
});

test('no column is claimed twice', () => {
  const mapping = guessMapping(['Nome', 'Nome', 'Nome']);
  const used = Object.values(mapping).filter((at): at is number => at !== null);

  assert.equal(new Set(used).size, used.length);
});

test('a mapped row carries only what was mapped and only what was filled in', () => {
  const mapping = { ...EMPTY_MAPPING, fullName: 0, birthDate: 1, levelName: 2 };

  assert.deepEqual(applyMapping(['Rita Nunes', '12/04/1988', ''], mapping), {
    fullName: 'Rita Nunes',
    birthDate: '12/04/1988',
  });
});

test('a mapping with no name column is not enough to import anything', () => {
  assert.equal(hasName(EMPTY_MAPPING), false);
  assert.equal(hasName({ ...EMPTY_MAPPING, fullName: 0 }), true);
  assert.equal(hasName({ ...EMPTY_MAPPING, firstName: 3 }), true);
});


/**
 * Slice 1.11 — what the exporter writes, the importer reads.
 *
 * The export's header row is not prose written for the file. It is
 * `students.import.field.*` out of the catalogue: the same labels the mapping
 * step puts above its dropdowns. So a club can export the register, edit it in
 * Excel, and import the result without touching a single column — and this is
 * the test that keeps it true.
 *
 * It reads the real catalogues rather than a fixture, deliberately. The failure
 * being guarded against is somebody rewording a label months from now — "Nível"
 * becoming "Nível do aluno", say — which breaks the round trip silently and
 * nowhere near this file. A fixture would keep passing while the product broke.
 */
function catalogue(locale: string): Record<string, Record<string, Record<string, string>>> {
  const path = new URL(`../messages/${locale}.json`, import.meta.url);
  return JSON.parse(readFileSync(path, 'utf8')) as never;
}

for (const locale of ['pt-PT', 'en']) {
  test(`an exported ${locale} file maps itself when it comes back`, () => {
    const field = catalogue(locale)['students']?.['import']?.['field'] as unknown as Record<
      string,
      string
    >;

    const headers = EXPORT_FIELDS.map((name) => {
      const label = field[name];
      assert.ok(label !== undefined, `students.import.field.${name} is missing from ${locale}`);
      return label;
    });

    const mapping = guessMapping(headers);

    EXPORT_FIELDS.forEach((name, column) => {
      assert.equal(
        mapping[name],
        column,
        `"${headers[column]}" should map to ${name}, not ${String(mapping[name])}`,
      );
    });

    // And the whole-name column stays out of it: the two halves were exported
    // separately so that nothing has to be split on the way back in.
    assert.equal(mapping.fullName, null);
  });
}

test('every exported column is one the importer knows about', () => {
  // Belt and braces on the contract: a field added to the export that the
  // import has never heard of would be dropped by the API without a word.
  for (const name of EXPORT_FIELDS) {
    assert.ok(name in EMPTY_MAPPING, `${name} is not an import field`);
  }
});
