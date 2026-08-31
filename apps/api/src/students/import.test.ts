import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isMinorOn,
  normaliseKey,
  parseImportDate,
  splitFullName,
  validateImportRows,
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
  defaultRelationship: 'Encarregado de educação',
  existing: [],
  today: '2026-08-31',
};

function withContext(overrides: Partial<ImportContext>): ImportContext {
  return { ...CONTEXT, ...overrides };
}

function validate(rows: RawImportRow[], overrides: Partial<ImportContext> = {}) {
  return validateImportRows(rows, withContext(overrides));
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

test('an unknown level is an error naming the value, never a silent null', () => {
  const { rows } = validate([{ ...ADULT, levelName: 'Pré-competição' }]);

  assert.equal(rows[0]?.importable, false);
  assert.equal(rows[0]?.levelId, null);
  assert.deepEqual(rows[0]?.problems, [
    { field: 'levelName', code: 'unknownLevel', value: 'Pré-competição' },
  ]);
  // Kept, so the message can quote back what the cell actually said.
  assert.equal(rows[0]?.levelName, 'Pré-competição');
});

test('a birth date in the future is a typo every time', () => {
  const { rows } = validate([{ firstName: 'Rita', lastName: 'Nunes', birthDate: '01/01/2030' }]);
  assert.equal(rows[0]?.problems[0]?.code, 'futureDate');
  assert.equal(rows[0]?.birthDate, null, 'and the value is not carried through');
});

test('a minor needs a guardian — the same rule as the form', () => {
  const child = { firstName: 'Duarte', lastName: 'Melo', birthDate: '12/05/2016' };

  const none = validate([child]).rows[0];
  assert.equal(none?.importable, false);
  assert.deepEqual(none?.problems, [{ field: 'guardianName', code: 'guardianRequired' }]);

  const complete = validate([
    { ...child, guardianName: 'Sofia Melo', guardianEmail: 'sofia@example.test' },
  ]);
  assert.equal(complete.rows[0]?.importable, true);
  assert.deepEqual(complete.rows[0]?.guardian, {
    name: 'Sofia Melo',
    // No "Parentesco" column, so the one the mapping step asked for once.
    relationship: 'Encarregado de educação',
    phone: null,
    email: 'sofia@example.test',
    taxNumber: null,
  });
});

/**
 * The rule the database enforces with a trigger, checked here so it becomes a
 * line on the preview instead of a PL/pgSQL error rolling the whole import back.
 *
 * A telephone number is not a dedup key — `guardian_needs_a_key`, POOLSE-17 —
 * and a guardian who cannot be deduplicated is how a club ends up with the same
 * mother four times, once per child.
 */
test('a guardian needs an email or a NIF, and a telephone number is neither', () => {
  const child = { firstName: 'Duarte', lastName: 'Melo', birthDate: '12/05/2016' };

  const phoneOnly = validate([
    { ...child, guardianName: 'Sofia Melo', guardianPhone: '912345678' },
  ]);
  assert.equal(phoneOnly.rows[0]?.importable, false);
  assert.deepEqual(phoneOnly.rows[0]?.problems, [
    { field: 'guardianEmail', code: 'guardianKeyRequired' },
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
});

test('the key rule applies to an adult student, whose guardian is written too', () => {
  // No age check runs on an adult, but the guardian is still created and the
  // trigger still fires. Refusing it here is what keeps the commit atomic.
  const rows = validate([
    { firstName: 'Rita', lastName: 'Nunes', birthDate: '1988-04-12', guardianName: 'Sofia Melo' },
  ]).rows;

  assert.equal(rows[0]?.importable, false);
  assert.equal(rows[0]?.problems[0]?.code, 'guardianKeyRequired');
});

test('a mapped relationship column beats the default', () => {
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

test('a student with no birth date is never blocked for a guardian', () => {
  // The commonest shape of a real import, and refusing it would fail most rows.
  const { rows } = validate([{ firstName: 'Duarte', lastName: 'Melo' }]);
  assert.equal(rows[0]?.importable, true);
  assert.equal(rows[0]?.birthDate, null);
});

test('maioridade comes from the club, not from a hardcoded eighteen', () => {
  // Sixteen years and a day old on the day this runs.
  const child = { firstName: 'Duarte', lastName: 'Melo', birthDate: '2010-01-01' };

  assert.equal(validate([child]).rows[0]?.importable, false, 'a minor at 18');
  assert.equal(
    validate([child], { ageOfMajority: 16 }).rows[0]?.importable,
    true,
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
  assert.deepEqual(rows[2]?.duplicate, { kind: 'file', name: 'Rita Nunes', line: 2 });

  // And it stays importable: a duplicate is a thing to be told, not a refusal.
  assert.equal(rows[2]?.importable, true);
});

test('somebody already in the register is matched on name and birth date', () => {
  const { rows, summary } = validate([{ firstName: 'Rita', lastName: 'Nunes', birthDate: '1988-04-12' }], {
    existing: [
      {
        id: 'student-1',
        firstName: 'Rita',
        lastName: 'Nunes',
        birthDate: '1988-04-12',
        displayName: 'Rita Nunes',
      },
    ],
  });

  assert.deepEqual(rows[0]?.duplicate, {
    kind: 'register',
    studentId: 'student-1',
    name: 'Rita Nunes',
  });
  assert.equal(summary.duplicates, 1);
  assert.equal(summary.importable, 1, 'still importable — the operator decides');
});

test('a different birth date is a different person, however alike the names', () => {
  const { rows } = validate([{ firstName: 'Rita', lastName: 'Nunes', birthDate: '1988-04-12' }], {
    existing: [
      {
        id: 'student-1',
        firstName: 'Rita',
        lastName: 'Nunes',
        birthDate: '1995-04-12',
        displayName: 'Rita Nunes',
      },
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

  assert.deepEqual(summary, { total: 4, importable: 2, refused: 2, duplicates: 1 });
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
