import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyMapping,
  describeColumns,
  guessMapping,
  hasName,
  matchColumns,
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


/**
 * The confident matcher — what turns twelve dropdowns into two questions.
 *
 * The screen only asks about columns the matcher is unsure of, so the value of
 * every test here is the same: a match that is confident had better be right,
 * because nobody is going to be shown it.
 *
 * Abbreviation is the case that earns its keep. Club spreadsheets are written by
 * people typing into a narrow column, so they say "Enc. Educação", "Tlm", "Dt
 * Nasc" — and the old exact-then-substring matcher left every one of those for a
 * human to place by hand.
 */
test('an abbreviated header is matched, and known to be a guess', () => {
  const { mapping, matches } = matchColumns({
    headers: ['Nome', 'Dt Nasc', 'Enc. Educação', 'Tlm'],
    rows: [['Rita Nunes', '12/04/1988', 'Ana Nunes', '912345678']],
  });

  assert.equal(mapping.fullName, 0);
  assert.equal(mapping.birthDate, 1);
  assert.equal(mapping.guardianName, 2);
  assert.equal(mapping.contactPhone, 3);

  const birth = matches.find((match) => match.field === 'birthDate');
  assert.equal(birth?.reason, 'abbreviation');
});

test('an exact header is certain; an abbreviation is not', () => {
  const { matches } = matchColumns({
    headers: ['Nome completo', 'Enc. Educação'],
    rows: [['Rita Nunes', 'Ana Nunes']],
  });

  assert.equal(matches.find((m) => m.field === 'fullName')?.confidence, 'certain');
  const guardian = matches.find((m) => m.field === 'guardianName');
  assert.notEqual(guardian?.confidence, 'certain', 'an abbreviation is never certain');
});

test('the values contradict the header, and the values win', () => {
  // A column headed "Telefone" holding dates is a column somebody mislabelled,
  // or a sheet whose headers shifted. Either way it must not be imported as a
  // phone number without being asked about.
  const { matches } = matchColumns({
    headers: ['Nome', 'Telefone'],
    rows: [
      ['Rita Nunes', '12/04/1988'],
      ['Tiago Sousa', '01/09/1990'],
      ['Marta Lopes', '03/03/1975'],
      ['Ana Melo', '15/07/1982'],
    ],
  });

  const phone = matches.find((match) => match.field === 'contactPhone');
  assert.notEqual(phone?.confidence, 'certain');
});

test('a column of email addresses is recognised whatever it is called', () => {
  const { mapping } = matchColumns({
    headers: ['Nome', 'Coluna B'],
    rows: [
      ['Rita Nunes', 'rita@example.test'],
      ['Tiago Sousa', 'tiago@example.test'],
      ['Marta Lopes', 'marta@example.test'],
      ['Ana Melo', 'ana@example.test'],
    ],
  });

  assert.equal(mapping.contactEmail, 1, 'the shape places it when the header cannot');
});

test('columns nothing matched are reported, so the screen can ask about them', () => {
  const { unmatched, mapping } = matchColumns({
    headers: ['Nome', 'Quota paga', 'Tamanho do fato'],
    rows: [['Rita Nunes', 'Sim', 'M']],
  });

  assert.equal(mapping.fullName, 0);
  assert.deepEqual(unmatched, [1, 2]);
});

test('the best match for a column wins, whatever order the fields are in', () => {
  // "NIF" scores exactly against the student's NIF and only weakly against the
  // guardian's. Walking the synonym list in order used to let whichever field
  // came first take the column.
  const { mapping } = matchColumns({
    headers: ['Nome', 'NIF do encarregado', 'NIF'],
    rows: [['Rita Nunes', '111111111', '222222222']],
  });

  assert.equal(mapping.guardianTaxNumber, 1);
  assert.equal(mapping.taxNumber, 2);
});

test('a column is described by its shape, never by its contents', () => {
  const [name, phone, email, level] = describeColumns({
    headers: ['Nome', 'Telemóvel', 'Email', 'Nível'],
    rows: [
      ['Rita Nunes', '912345678', 'rita@example.test', 'Adultos'],
      ['Tiago Sousa', '913456789', 'tiago@example.test', 'Adultos'],
      ['Marta Lopes', '', 'marta@example.test', 'Adultos'],
      ['Ana Melo', '915678901', 'ana@example.test', 'Iniciação'],
    ],
  });

  assert.deepEqual(name?.looks, ['2 words']);
  assert.deepEqual(phone?.looks, ['9 digits']);
  assert.deepEqual(email?.looks, ['email']);

  assert.equal(phone?.filled, 75, 'and how much of it is filled in');
  assert.equal(level?.repeats, true, 'a level repeats; a name does not');
  assert.equal(name?.repeats, false);

  // The thing that matters most about this function: no value appears in it.
  const described = JSON.stringify([name, phone, email, level]);
  assert.ok(!described.includes('912345678'), 'no telephone number');
  assert.ok(!described.includes('rita@example.test'), 'no email address');
  assert.ok(!described.includes('Rita'), 'no name');
});
