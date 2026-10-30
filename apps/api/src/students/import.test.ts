import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isMinorOn,
  normaliseKey,
  parseImportDate,
  splitFullName,
  validateImportRows,
  type ExistingStudent,
  type ImportContext,
  type RawImportRow,
} from './import.js';

/**
 * Slice 1.10 — the import's rules, tested without a database.
 *
 * These are the cases a real club spreadsheet produces, and every one of them
 * was a decision rather than an accident: day-first dates, accent-insensitive
 * level names, a "Nome" column with no surname column, the same child listed
 * four times because the sheet has one row per class attended.
 *
 * The rule that most needs a test is the one the preview promises: a row with a
 * problem is not importable, and a row that is merely a duplicate still is. The
 * screen unticks duplicates; the server refuses problems. Confusing the two
 * either loses rows silently or writes a second copy of every child.
 *
 * Run: pnpm api:test
 */

const CONTEXT: ImportContext = {
  levels: [
    { id: 'level-adaptacao', name: 'Adaptação' },
    { id: 'level-iniciacao', name: 'Iniciação' },
    { id: 'level-adultos', name: 'Adultos' },
  ],
  ageOfMajority: 18,
  existing: [],
  today: '2026-08-31',
};

function withContext(overrides: Partial<ImportContext>): ImportContext {
  return { ...CONTEXT, ...overrides };
}

function validate(rows: RawImportRow[], overrides: Partial<ImportContext> = {}) {
  return validateImportRows(rows, withContext(overrides));
}

/** A student already in the register, with everything blank unless said. */
function existing(overrides: Partial<ExistingStudent> & { id: string }): ExistingStudent {
  return {
    firstName: '',
    lastName: '',
    birthDate: null,
    taxNumber: null,
    displayName: '',
    levelId: null,
    contactEmail: null,
    contactPhone: null,
    notes: null,
    federationLicence: null,
    identity: null,
    isSocio: false,
    socioNumber: null,
    socioSince: null,
    ...overrides,
  };
}

/** A row that passes cleanly, so a test can vary one thing about it. */
const ADULT: RawImportRow = { firstName: 'Rita', lastName: 'Nunes', birthDate: '1988-04-12' };

test('a date is read day-first, because a Portuguese sheet is written that way', () => {
  assert.deepEqual(parseImportDate('03/04/2015'), { date: '2015-04-03' });
  assert.deepEqual(parseImportDate('3-4-2015'), { date: '2015-04-03' });
  assert.deepEqual(parseImportDate('3.4.2015'), { date: '2015-04-03' });

  // ISO is unambiguous and stays itself.
  assert.deepEqual(parseImportDate('2015-04-03'), { date: '2015-04-03' });
  assert.deepEqual(parseImportDate('2015-04-03T00:00:00.000Z'), { date: '2015-04-03' });

  // A day that does not exist is refused rather than rolled into the next month.
  assert.deepEqual(parseImportDate('31/02/2015'), { error: 'badDate' });
  assert.deepEqual(parseImportDate('2015-02-31'), { error: 'badDate' });

  // A two-digit year is refused rather than guessed: "05" is 1905 or 2005.
  assert.deepEqual(parseImportDate('03/04/15'), { error: 'badDate' });
  assert.deepEqual(parseImportDate('qualquer coisa'), { error: 'badDate' });
});

test("Excel's serial numbers survive its own 1900 leap-year bug", () => {
  // The two anchors everybody checks a serial reader against.
  assert.deepEqual(parseImportDate('1'), { date: '1899-12-31' });
  assert.deepEqual(parseImportDate('42005'), { date: '2015-01-01' });

  // Not a serial: out of range, so a stray number is a bad date rather than 1900.
  assert.deepEqual(parseImportDate('0'), { error: 'badDate' });
});

test('a full-name column becomes both parts, and one word becomes both', () => {
  assert.deepEqual(splitFullName('Maria Santos Silva'), { first: 'Maria', last: 'Santos Silva' });
  assert.deepEqual(splitFullName('  Ana   Lopes '), { first: 'Ana', last: 'Lopes' });
  assert.deepEqual(splitFullName('Ana'), { first: 'Ana', last: 'Ana' });

  const { rows } = validate([{ fullName: 'Maria Santos Silva' }]);
  assert.equal(rows[0]?.firstName, 'Maria');
  assert.equal(rows[0]?.lastName, 'Santos Silva');
  assert.equal(rows[0]?.importable, true);
});

test('an explicit first name wins over the whole-name column', () => {
  const { rows } = validate([{ fullName: 'Ignorado Completamente', firstName: 'Rita', lastName: 'Nunes' }]);
  assert.equal(rows[0]?.firstName, 'Rita');
  assert.equal(rows[0]?.lastName, 'Nunes');
});

test('a row with no name at all is refused, and says which column it wanted', () => {
  const { rows, summary } = validate([{ birthDate: '1988-04-12' }]);
  assert.equal(rows[0]?.importable, false);
  assert.deepEqual(rows[0]?.problems, [{ field: 'fullName', code: 'nameRequired' }]);
  assert.equal(summary.refused, 1);
  assert.equal(summary.importable, 0);
});

test('a level matches whatever the accents and the caps were', () => {
  const { rows } = validate([
    { ...ADULT, levelName: 'iniciacao' },
    { ...ADULT, firstName: 'Tiago', levelName: 'INICIAÇÃO' },
    { ...ADULT, firstName: 'Marta', levelName: ' Adaptacao ' },
  ]);

  assert.equal(rows[0]?.levelId, 'level-iniciacao');
  assert.equal(rows[1]?.levelId, 'level-iniciacao');
  assert.equal(rows[2]?.levelId, 'level-adaptacao');
});

test('a level the club does not have is created, not refused', () => {
  const { rows, summary } = validate([
    { ...ADULT, levelName: 'Pré-competição' },
    { ...ADULT, firstName: 'Tiago', levelName: 'pre competicao' },
    { ...ADULT, firstName: 'Marta', levelName: 'Hidroginástica' },
  ]);

  assert.equal(rows[0]?.importable, true, 'a new level never fails its row');
  assert.equal(rows[0]?.levelId, null, 'it has no id until the commit makes one');
  assert.deepEqual(rows[0]?.warnings, [
    { field: 'levelName', code: 'levelWillBeCreated', value: 'Pré-competição' },
  ]);

  // Two spellings of one name make one level, because the comparison ignores
  // accents and case — the same rule that finds an existing level.
  assert.deepEqual(summary.levelsToCreate, ['Pré-competição', 'Hidroginástica']);
});

test('an existing level is matched rather than created again', () => {
  const { rows, summary } = validate([{ ...ADULT, levelName: 'iniciacao' }]);

  assert.equal(rows[0]?.levelId, 'level-iniciacao');
  assert.deepEqual(rows[0]?.warnings, []);
  assert.deepEqual(summary.levelsToCreate, []);
});

test('a birth date in the future is a typo every time', () => {
  const { rows } = validate([{ firstName: 'Rita', lastName: 'Nunes', birthDate: '01/01/2030' }]);
  assert.equal(rows[0]?.problems[0]?.code, 'futureDate');
  assert.equal(rows[0]?.birthDate, null, 'and the value is not carried through');
});

test('a minor with no guardian is flagged, and imported anyway', () => {
  // POOLSE-04 criterion 2 still governs the create form. The import does not
  // enforce it, because a club's sheet very often has no guardian column and
  // refusing every child in it makes the onboarding path useless.
  const child = { firstName: 'Duarte', lastName: 'Melo', birthDate: '12/05/2016' };

  const { rows, summary } = validate([child]);
  assert.equal(rows[0]?.importable, true);
  assert.deepEqual(rows[0]?.problems, []);
  assert.deepEqual(rows[0]?.warnings, [{ field: 'guardianName', code: 'noGuardian' }]);
  assert.equal(summary.minorsWithoutGuardian, 1, 'and counted, so the count is visible');
});

test('an adult with no guardian is not flagged — there is nothing to say', () => {
  const { rows, summary } = validate([ADULT]);
  assert.deepEqual(rows[0]?.warnings, []);
  assert.equal(summary.minorsWithoutGuardian, 0);
});

test('a guardian with an email is recorded, with no relationship invented', () => {
  const complete = validate([
    {
      firstName: 'Duarte',
      lastName: 'Melo',
      birthDate: '12/05/2016',
      guardianName: 'Sofia Melo',
      guardianEmail: 'sofia@example.test',
    },
  ]);

  assert.equal(complete.rows[0]?.importable, true);
  assert.deepEqual(complete.rows[0]?.guardian, {
    name: 'Sofia Melo',
    // Null, not a phrase the mapping step made somebody pick for the whole file.
    relationship: null,
    phone: null,
    email: 'sofia@example.test',
    taxNumber: null,
  });
  assert.deepEqual(complete.rows[0]?.warnings, []);
});

/**
 * `guardian_needs_a_key` — POOLSE-17 — requires a guardian to carry a NIF or an
 * email, because a guardian is where duplicates come from: without a key the
 * same mother arrives once per child.
 *
 * So a guardian with neither is not written. The student still is, and the row
 * says what happened — refusing the child over their mother's missing email
 * would fail most real files, and dropping her in silence would be worse.
 */
test('a guardian with only a telephone number is not recorded, and the row says so', () => {
  const child = { firstName: 'Duarte', lastName: 'Melo', birthDate: '12/05/2016' };

  const phoneOnly = validate([
    { ...child, guardianName: 'Sofia Melo', guardianPhone: '912345678' },
  ]);

  assert.equal(phoneOnly.rows[0]?.importable, true, 'the student is not refused');
  assert.equal(phoneOnly.rows[0]?.guardian, null, 'but the guardian is not written');
  assert.deepEqual(phoneOnly.rows[0]?.warnings, [
    { field: 'guardianEmail', code: 'guardianNotRecorded', value: 'Sofia Melo' },
  ]);

  const withNif = validate([
    {
      ...child,
      guardianName: 'Sofia Melo',
      guardianPhone: '912345678',
      guardianTaxNumber: '123456789',
    },
  ]);
  assert.equal(withNif.rows[0]?.importable, true);
  assert.equal(withNif.rows[0]?.guardian?.taxNumber, '123456789');
  assert.deepEqual(withNif.rows[0]?.warnings, []);
});

test('a relationship column is used when the sheet actually has one', () => {
  const { rows } = validate([
    {
      firstName: 'Duarte',
      lastName: 'Melo',
      birthDate: '12/05/2016',
      guardianName: 'Sofia Melo',
      guardianEmail: 'sofia@example.test',
      guardianRelationship: 'Mãe',
    },
  ]);
  assert.equal(rows[0]?.guardian?.relationship, 'Mãe');
});

test('only the name is required — everything else may be missing', () => {
  // The database asks for a first and last name and nothing else. The importer
  // now asks for exactly the same, which is the whole point of this pass.
  const { rows } = validate([{ fullName: 'Duarte Melo' }]);

  assert.equal(rows[0]?.importable, true);
  assert.deepEqual(rows[0]?.problems, []);
  assert.equal(rows[0]?.birthDate, null);
  assert.equal(rows[0]?.contactEmail, null);
  assert.equal(rows[0]?.contactPhone, null);
  assert.equal(rows[0]?.levelId, null);
  assert.equal(rows[0]?.guardian, null);
});

test('maioridade comes from the club, not from a hardcoded eighteen', () => {
  const child = { firstName: 'Duarte', lastName: 'Melo', birthDate: '2010-01-01' };

  assert.equal(validate([child]).summary.minorsWithoutGuardian, 1, 'a minor at 18');
  assert.equal(
    validate([child], { ageOfMajority: 16 }).summary.minorsWithoutGuardian,
    0,
    'an adult where the club says 16',
  );
});

test('the birthday itself makes somebody an adult, not the day after', () => {
  assert.equal(isMinorOn('2008-08-31', '2026-08-31', 18), false, 'eighteen today');
  assert.equal(isMinorOn('2008-09-01', '2026-08-31', 18), true, 'eighteen tomorrow');
});

test('the same child twice in one file is flagged against the earlier line', () => {
  const rows = validate([
    { firstName: 'Rita', lastName: 'Nunes', birthDate: '1988-04-12' },
    { firstName: 'Tiago', lastName: 'Sousa', birthDate: '1990-02-02' },
    { firstName: 'RITA', lastName: 'nunes', birthDate: '12/04/1988' },
  ]).rows;

  assert.equal(rows[0]?.duplicate, null);
  assert.equal(rows[1]?.duplicate, null);
  assert.deepEqual(rows[2]?.duplicate, {
    kind: 'file',
    name: 'Rita Nunes',
    line: 2,
    matchedOn: 'nameAndBirthDate',
  });

  // And it stays importable: a duplicate is a thing to be told, not a refusal.
  assert.equal(rows[2]?.importable, true);
});

test('somebody already in the register is matched on name and birth date', () => {
  const { rows, summary } = validate([{ firstName: 'Rita', lastName: 'Nunes', birthDate: '1988-04-12' }], {
    existing: [
      existing({
        id: 'student-1',
        firstName: 'Rita',
        lastName: 'Nunes',
        birthDate: '1988-04-12',
        displayName: 'Rita Nunes',
      }),
    ],
  });

  assert.deepEqual(rows[0]?.duplicate, {
    kind: 'register',
    studentId: 'student-1',
    name: 'Rita Nunes',
    matchedOn: 'nameAndBirthDate',
  });
  assert.equal(summary.duplicates, 1);
  assert.equal(summary.importable, 1, 'still importable — the operator decides');
});

test('a different birth date is a different person, however alike the names', () => {
  const { rows } = validate([{ firstName: 'Rita', lastName: 'Nunes', birthDate: '1988-04-12' }], {
    existing: [
      existing({
        id: 'student-1',
        firstName: 'Rita',
        lastName: 'Nunes',
        birthDate: '1995-04-12',
        displayName: 'Rita Nunes',
      }),
    ],
  });
  assert.equal(rows[0]?.duplicate, null);
});

test('the summary counts what the screen shows', () => {
  const { summary } = validate([
    { firstName: 'Rita', lastName: 'Nunes', birthDate: '1988-04-12' },
    { firstName: 'Rita', lastName: 'Nunes', birthDate: '1988-04-12' },
    // A minor with no guardian, and a row with no name: two refusals.
    { firstName: 'Duarte', lastName: 'Melo', birthDate: '12/05/2016' },
    { birthDate: '1990-01-01' },
  ]);

  assert.deepEqual(summary, {
    total: 4,
    // The child now imports — only the nameless row is refused.
    importable: 3,
    refused: 1,
    duplicates: 1,
    toUpdate: 0,
    toCreate: 2,
    flagged: 1,
    minorsWithoutGuardian: 1,
    levelsToCreate: [],
  });
});

test('lines are numbered as the spreadsheet numbers them, header included', () => {
  const { rows } = validate([ADULT, { ...ADULT, firstName: 'Tiago' }]);
  assert.equal(rows[0]?.line, 2, 'the first data row is line 2');
  assert.equal(rows[1]?.line, 3);
});

test('the key that compares names ignores case, accents and punctuation', () => {
  assert.equal(normaliseKey('João  Silva-Santos'), 'joao silva santos');
  assert.equal(normaliseKey('JOAO SILVA SANTOS'), 'joao silva santos');
});


/**
 * A student's own NIF — the rule the unique index would otherwise enforce
 * mid-commit.
 *
 * Every other duplicate here is a judgement the operator gets to make, because
 * two children really can share a name and a birthday. A NIF cannot be shared:
 * `student_tax_number_uq` refuses it, and refusing it during the commit would
 * roll back every other row in the file. So this is a refusal on the preview,
 * for the same reason the guardian key rule is.
 */
/**
 * The identity ladder — a NIF, else a name and a birth date.
 *
 * A NIF match used to *refuse* the row, on the reasoning that the unique index
 * would reject it anyway. That was backwards: the strongest signal the file
 * carries was the only thing that could stop it. Now it is what makes the row an
 * update of the person it belongs to — even when the name in the sheet does not
 * match the name in the register, which is exactly the case a NIF is for.
 */
test('a NIF matches the person it belongs to, whatever the sheet calls them', () => {
  const { rows, summary } = validate(
    [{ fullName: 'Rita Nunes', taxNumber: '123456789', contactPhone: '912345678' }],
    {
      existing: [
        existing({
          id: 'student-1',
          firstName: 'Marta',
          lastName: 'Vaz',
          taxNumber: '123456789',
          displayName: 'Marta Vaz',
        }),
      ],
    },
  );

  assert.equal(rows[0]?.importable, true, 'no longer a refusal');
  assert.deepEqual(rows[0]?.duplicate, {
    kind: 'register',
    studentId: 'student-1',
    name: 'Marta Vaz',
    matchedOn: 'taxNumber',
  });
  assert.deepEqual(rows[0]?.updates, [{ field: 'contactPhone', value: '912345678' }]);
  assert.equal(summary.toUpdate, 1);
  assert.equal(summary.toCreate, 0);
});

test('a NIF is the same number however it is punctuated', () => {
  const { rows } = validate([{ fullName: 'Rita Nunes', taxNumber: '123 456 789' }], {
    existing: [
      existing({ id: 'student-1', taxNumber: '123456789', displayName: 'Marta Vaz' }),
    ],
  });

  assert.equal(rows[0]?.taxNumber, '123 456 789', 'kept as it was written');
  assert.equal(rows[0]?.duplicate?.matchedOn, 'taxNumber', 'and compared without the spaces');
});

test('the same NIF twice in one file is one person, not two records', () => {
  const rows = validate([
    { fullName: 'Rita Nunes', taxNumber: '123456789' },
    { fullName: 'Rita Nunes Silva', taxNumber: '123456789' },
  ]).rows;

  assert.equal(rows[0]?.duplicate, null, 'the first occurrence is the one that acts');
  assert.deepEqual(rows[1]?.duplicate, {
    kind: 'file',
    name: 'Rita Nunes',
    line: 2,
    matchedOn: 'taxNumber',
  });
});

/**
 * Filling blanks, and only blanks.
 *
 * This is what makes re-importing last year's file harmless: a club that
 * exports, edits two rows and imports the lot back cannot flatten everything
 * else with a stale copy of itself.
 */
test('a match fills what is empty and leaves what is not', () => {
  const { rows } = validate(
    [
      {
        fullName: 'Rita Nunes',
        birthDate: '12/04/1988',
        contactEmail: 'nova@example.test',
        contactPhone: '912345678',
        levelName: 'Adultos',
      },
    ],
    {
      existing: [
        existing({
          id: 'student-1',
          firstName: 'Rita',
          lastName: 'Nunes',
          birthDate: '1988-04-12',
          displayName: 'Rita Nunes',
          // Already known, and therefore untouchable by a spreadsheet.
          contactEmail: 'antiga@example.test',
        }),
      ],
    },
  );

  assert.deepEqual(rows[0]?.updates, [
    { field: 'contactPhone', value: '912345678' },
    { field: 'levelId', value: 'Adultos' },
  ]);
});

test('a match with nothing new to say updates nothing', () => {
  // Importing the same file twice. The second time costs nothing and writes
  // nothing, which is the property that makes the feature safe to use casually.
  const { rows, summary } = validate([{ fullName: 'Rita Nunes', birthDate: '12/04/1988' }], {
    existing: [
      existing({
        id: 'student-1',
        firstName: 'Rita',
        lastName: 'Nunes',
        birthDate: '1988-04-12',
        displayName: 'Rita Nunes',
      }),
    ],
  });

  assert.deepEqual(rows[0]?.updates, []);
  assert.equal(summary.toUpdate, 0, 'a match that changes nothing is not an update');
  assert.equal(summary.duplicates, 1, 'but it is still a match');
});

test('a NIF belonging to somebody else is not copied across', () => {
  // Matched on the name, but the NIF in the sheet is another student's. Writing
  // it would violate the unique index mid-commit and take the import down.
  const { rows } = validate(
    [{ fullName: 'Rita Nunes', birthDate: '12/04/1988', taxNumber: '123456789' }],
    {
      existing: [
        existing({
          id: 'student-1',
          firstName: 'Rita',
          lastName: 'Nunes',
          birthDate: '1988-04-12',
          displayName: 'Rita Nunes',
        }),
        existing({ id: 'student-2', taxNumber: '123456789', displayName: 'Marta Vaz' }),
      ],
    },
  );

  // The NIF match wins the identity, so this is Marta — and her NIF is already
  // hers, so there is nothing to fill.
  assert.equal(rows[0]?.duplicate?.studentId, 'student-2');
  assert.deepEqual(rows[0]?.updates, [{ field: 'birthDate', value: '1988-04-12' }]);
});

test('a student NIF has no age rule — a minor may carry one', () => {
  // Deliberate: in Portugal a parent deducts the lessons against the child's
  // number, so a club's invoice for a seven-year-old often has one on it.
  const { rows } = validate([
    {
      fullName: 'Duarte Melo',
      birthDate: '12/05/2016',
      taxNumber: '234567891',
      guardianName: 'Sofia Melo',
      guardianEmail: 'sofia@example.test',
    },
  ]);

  assert.equal(rows[0]?.importable, true);
  assert.equal(rows[0]?.taxNumber, '234567891');
});

/**
 * POOLSE-131 — the address and identity columns.
 *
 * What the export writes (an ISO country code, the Portuguese marital word) and
 * what a club's own file says ("Portugal", "Casada", "4000 123 Porto") must all
 * resolve to the one stored value; anything the column cannot hold refuses the
 * row and quotes the cell back.
 */
test('identity cells are read the way a club writes them', () => {
  const { rows } = validate([
    {
      ...ADULT,
      addressLine: '  Rua  das Flores, 12 ',
      postalCode: '4000 123 Porto',
      maritalStatus: 'Casada',
      nationality: 'Portugal',
      snsNumber: '123 456 789',
      parentOneName: 'Ana Nunes',
    },
  ]);

  assert.equal(rows[0]?.importable, true);
  assert.deepEqual(rows[0]?.identity, {
    addressLine: 'Rua das Flores, 12',
    // Taken from after the code, because the Localidade column was empty.
    locality: 'Porto',
    postalCode: '4000-123',
    parentOneName: 'Ana Nunes',
    parentTwoName: null,
    maritalStatus: 'married',
    profession: null,
    education: null,
    birthplace: null,
    nationality: 'PT',
    snsNumber: '123456789',
  });
});

test('a nationality is a code or a name in either language', () => {
  for (const cell of ['PT', 'pt', 'Portugal', 'Portuguesa']) {
    assert.equal(validate([{ ...ADULT, nationality: cell }]).rows[0]?.identity?.nationality, 'PT', cell);
  }
  for (const cell of ['Reino Unido', 'United Kingdom', 'GB']) {
    assert.equal(validate([{ ...ADULT, nationality: cell }]).rows[0]?.identity?.nationality, 'GB', cell);
  }
  assert.equal(validate([{ ...ADULT, nationality: 'Alemanha' }]).rows[0]?.identity?.nationality, 'DE');
});

test('the marital word the export writes reads back, in either language', () => {
  const said: [string, string][] = [
    ['Solteiro/a', 'single'],
    ['Casado/a', 'married'],
    ['União de facto', 'civil_union'],
    ['Divorciado/a', 'divorced'],
    ['Viúvo/a', 'widowed'],
    ['Civil partnership', 'civil_union'],
    ['widowed', 'widowed'],
    ['civil_union', 'civil_union'],
  ];
  for (const [cell, status] of said) {
    assert.equal(validate([{ ...ADULT, maritalStatus: cell }]).rows[0]?.identity?.maritalStatus, status, cell);
  }
});

test('a postal code, an SNS number or a country the column cannot hold refuses the row', () => {
  const { rows, summary } = validate([
    { ...ADULT, postalCode: '40001' },
    { firstName: 'Tiago', lastName: 'Sousa', snsNumber: '12345' },
    { firstName: 'Duarte', lastName: 'Melo', nationality: 'Atlântida' },
    { firstName: 'Sofia', lastName: 'Melo', maritalStatus: 'talvez' },
    { firstName: 'Rui', lastName: 'Melo', nationality: 'ZZ' },
  ]);

  assert.deepEqual(rows[0]?.problems, [{ field: 'postalCode', code: 'badPostalCode', value: '40001' }]);
  assert.deepEqual(rows[1]?.problems, [{ field: 'snsNumber', code: 'badSnsNumber', value: '12345' }]);
  assert.deepEqual(rows[2]?.problems, [{ field: 'nationality', code: 'badNationality', value: 'Atlântida' }]);
  assert.deepEqual(rows[3]?.problems, [{ field: 'maritalStatus', code: 'badMaritalStatus', value: 'talvez' }]);
  assert.equal(rows[4]?.problems[0]?.code, 'badNationality', 'a code that is no country');
  assert.equal(summary.refused, 5);
});

test('a row with no identity cells carries none', () => {
  assert.equal(validate([ADULT]).rows[0]?.identity, null);
});

test('identity fills a blank on a matched student and never overwrites one', () => {
  const { rows } = validate(
    [
      {
        fullName: 'Rita Nunes',
        birthDate: '12/04/1988',
        addressLine: 'Rua Nova, 1',
        locality: 'Braga',
        nationality: 'BR',
      },
    ],
    {
      existing: [
        existing({
          id: 'student-1',
          firstName: 'Rita',
          lastName: 'Nunes',
          birthDate: '1988-04-12',
          displayName: 'Rita Nunes',
          identity: {
            addressLine: 'Rua Velha, 9',
            locality: null,
            postalCode: null,
            parentOneName: null,
            parentTwoName: null,
            maritalStatus: null,
            profession: null,
            education: null,
            birthplace: null,
            nationality: 'PT',
            snsNumber: null,
          },
        }),
      ],
    },
  );

  // The address and the nationality on file stay; only the empty town is filled.
  assert.deepEqual(rows[0]?.updates, [{ field: 'locality', value: 'Braga' }]);
});

/**
 * POOLSE-134 — the sócio columns: a date read like a birth date, a number that
 * is refused when somebody else holds it, and blanks filled only.
 */
test('sócio desde is read like a birth date, and a non-date refuses the row', () => {
  const { rows } = validate([
    { ...ADULT, socioSince: '01/09/2020' },
    { firstName: 'Tiago', lastName: 'Sousa', socioSince: 'há muito' },
  ]);

  assert.equal(rows[0]?.socioSince, '2020-09-01');
  assert.equal(rows[0]?.isSocio, true, 'a date on its own says they are a member');
  assert.deepEqual(rows[1]?.problems, [{ field: 'socioSince', code: 'badDate', value: 'há muito' }]);
});

test('a sócio number another student holds is refused, quoting it', () => {
  const { rows } = validate([{ ...ADULT, socioNumber: '42' }], {
    existing: [existing({ id: 'student-9', firstName: 'Ana', lastName: 'Reis', socioNumber: '42', isSocio: true })],
  });

  assert.deepEqual(rows[0]?.problems, [{ field: 'socioNumber', code: 'socioNumberTaken', value: '42' }]);
  assert.equal(rows[0]?.importable, false);
});

test('the same sócio number twice in one file refuses the second row', () => {
  const { rows } = validate([
    { ...ADULT, socioNumber: '7' },
    { firstName: 'Tiago', lastName: 'Sousa', socioNumber: '7' },
  ]);

  assert.deepEqual(rows[0]?.problems, []);
  assert.equal(rows[1]?.problems[0]?.code, 'socioNumberTaken');
});

test('a student holding their own number is no clash, and the sócio fills only blanks', () => {
  const { rows } = validate(
    [{ fullName: 'Rita Nunes', birthDate: '1988-04-12', isSocio: 'Sim', socioNumber: '42', socioSince: '2019-01-01' }],
    {
      existing: [
        existing({
          id: 'student-1',
          firstName: 'Rita',
          lastName: 'Nunes',
          birthDate: '1988-04-12',
          displayName: 'Rita Nunes',
          isSocio: true,
          socioNumber: '42',
          socioSince: '2015-03-01',
        }),
      ],
    },
  );

  assert.deepEqual(rows[0]?.problems, []);
  assert.deepEqual(rows[0]?.updates, [], 'the date on file stays');
});

test('a matched student who is not a sócio becomes one, with number and date', () => {
  const { rows } = validate(
    [{ fullName: 'Rita Nunes', birthDate: '1988-04-12', socioNumber: '43', socioSince: '2026-01-10' }],
    {
      existing: [
        existing({ id: 'student-1', firstName: 'Rita', lastName: 'Nunes', birthDate: '1988-04-12', displayName: 'Rita Nunes' }),
      ],
    },
  );

  assert.deepEqual(rows[0]?.updates, [
    { field: 'isSocio', value: 'true' },
    { field: 'socioNumber', value: '43' },
    { field: 'socioSince', value: '2026-01-10' },
  ]);
});
