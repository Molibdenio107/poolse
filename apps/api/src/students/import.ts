/**
 * Slice 1.10 — what an imported row means, and why it is refused.
 *
 * This module is deliberately pure: no database, no HTTP, no spreadsheet. It is
 * handed rows that have *already* been mapped to Poolse's field names and it
 * says, for each one, what the values resolve to and what is wrong with them.
 *
 * That line matters more than it looks. The roadmap calls 1.10 the onboarding
 * path — "a customer who cannot get their spreadsheet in never becomes a
 * customer" — and the thing that makes an import trustworthy is that the preview
 * and the commit cannot disagree. They cannot disagree here because there is one
 * function and both call it: the endpoint takes a `commit` flag rather than
 * having a second code path that validates "the same way".
 *
 * Reading a `.xlsx` is the web app's job (`lib/sheet.ts`), because a file is a
 * transport detail and this is the rule. The API never sees a spreadsheet.
 */

/** The Poolse fields a spreadsheet column can be pointed at. */
export const IMPORT_FIELDS = [
  /**
   * One column holding the whole name, which is what most club spreadsheets
   * actually have. Split on the first space, exactly as the guardian picker
   * splits a typed name, so the two never disagree about "Maria Santos Silva".
   *
   * Ignored when `firstName` is mapped: a sheet with both is a sheet where
   * somebody mapped the more precise thing on purpose.
   */
  'fullName',
  'firstName',
  'lastName',
  'birthDate',
  'levelName',
  'contactEmail',
  'contactPhone',
  'notes',
  'guardianName',
  'guardianRelationship',
  'guardianPhone',
  'guardianEmail',
  /**
   * The guardian's NIF.
   *
   * Here because the database insists a guardian carry a NIF *or* an email —
   * `guardian_needs_a_key`, POOLSE-17: a guardian is where duplicates come from,
   * so a guardian has to be dedupable. A club sheet very often has the NIF and
   * not the address, because the NIF is what an invoice needs, and without this
   * column those clubs could not import a single child.
   */
  'guardianTaxNumber',
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

/** A row as it arrives: mapped to field names, every value still a string. */
export type RawImportRow = Partial<Record<ImportField, string>>;

/**
 * Machine keys, never sentences.
 *
 * Same rule as `ApiError.fields`: the API has no message catalogues, so it says
 * *what* is wrong and the web app owns how that reads in pt-PT and en.
 */
export type ImportProblemCode =
  | 'nameRequired'
  | 'tooLong'
  | 'badDate'
  | 'futureDate'
  | 'ancientDate'
  | 'unknownLevel'
  | 'guardianRequired'
  | 'guardianKeyRequired';

export interface ImportProblem {
  field: ImportField;
  code: ImportProblemCode;
  /** What was in the cell, so the message can quote it back. */
  value?: string;
}

/**
 * Somebody this club may already have.
 *
 * `register` is a student already in Poolse; `file` is an earlier row of the
 * same spreadsheet — the second is at least as common as the first, because a
 * sheet with one row per *class attended* lists the same child four times.
 */
export interface ImportDuplicate {
  kind: 'register' | 'file';
  /** The existing student, when `kind` is `register`. */
  studentId?: string;
  name: string;
  /** The earlier row's spreadsheet line, when `kind` is `file`. */
  line?: number;
}

export interface ImportGuardian {
  name: string;
  relationship: string;
  phone: string | null;
  email: string | null;
  taxNumber: string | null;
}

export interface ImportRow {
  /** 0-based position among the data rows — the client's stable handle. */
  index: number;
  /** The line in the spreadsheet, counting the header as line 1. */
  line: number;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  levelId: string | null;
  /** What the cell said, kept even when it matched nothing, so the error can quote it. */
  levelName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
  guardian: ImportGuardian | null;
  problems: ImportProblem[];
  duplicate: ImportDuplicate | null;
  /**
   * Whether this row *can* be written. A duplicate is not a problem — it is a
   * thing to be told before deciding — so it never clears this flag. The client
   * unticks duplicates by default; the server obeys the tick.
   */
  importable: boolean;
}

/** A level, as this module needs it: an id and a name to match against. */
export interface ImportLevel {
  id: string;
  name: string;
}

export interface ExistingStudent {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  displayName: string;
}

export interface ImportContext {
  levels: ImportLevel[];
  /** The club's maioridade in years — POOLSE-22, never a literal. */
  ageOfMajority: number;
  /**
   * The relationship to record when the sheet has no column for it.
   *
   * A spreadsheet almost never has a "Parentesco" column and a guardian link
   * requires one, so the mapping step asks for it once for the whole file rather
   * than failing every row of every real import. The web app supplies the text
   * because the web app owns the catalogue.
   */
  defaultRelationship: string;
  /** Students already in the register. Built by the repository. */
  existing: ExistingStudent[];
  /** What "today" is, as `YYYY-MM-DD`. Injected so the tests are not seasonal. */
  today: string;
}

/** Well past any club's largest register, and small enough to hold in memory twice. */
export const MAX_IMPORT_ROWS = 2000;

const MAX_NAME = 120;
const MAX_EMAIL = 254;
const MAX_PHONE = 40;
const MAX_NOTES = 2000;
/** A NIF is nine digits; the column is text, and other countries are longer. */
const MAX_NIF = 40;

/** The oldest plausible birth date, matching the CHECK on `student.birth_date`. */
const EARLIEST_BIRTH_DATE = '1900-01-01';

/**
 * The comparison key for a name or a level.
 *
 * Accents and case are stripped for the same reason `strip_accents` exists in
 * SQL — "Iniciação" typed as "iniciacao" is the same level, and a Portuguese
 * register where that is not true is a register that grows a second copy of
 * every child.
 *
 * Deliberately JavaScript on *both* sides of every comparison. Normalising the
 * spreadsheet here and the register in SQL would be two implementations of one
 * rule, which is the kind of near-agreement that fails on one accent in a year.
 */
export function normaliseKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** First space splits, same as the guardian picker. "Ana" alone becomes both parts. */
export function splitFullName(full: string): { first: string; last: string } {
  const trimmed = full.trim().replace(/\s+/g, ' ');
  const cut = trimmed.indexOf(' ');
  if (cut === -1) return { first: trimmed, last: trimmed };
  return { first: trimmed.slice(0, cut), last: trimmed.slice(cut + 1) };
}

/**
 * Excel's own date encoding: days since 1899-12-30.
 *
 * The epoch is two days before 1900-01-01 rather than one, because Excel
 * believes 1900 was a leap year. That bug is older than most of the people in
 * the register and it is in the file format — copying it is the only way to read
 * the file correctly.
 *
 * Bounded, so a column of lane numbers does not silently become a column of
 * 1900 birthdays.
 */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MIN_SERIAL = 1;
const MAX_SERIAL = 2_958_465; // 9999-12-31

function fromExcelSerial(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < MIN_SERIAL || serial > MAX_SERIAL) return null;
  return new Date(EXCEL_EPOCH_MS + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
}

function isRealDate(iso: string): boolean {
  const parsed = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso;
}

/**
 * A birth date out of a spreadsheet cell.
 *
 * **Day first, always.** `03/04/2015` is the third of April, because pt-PT is
 * the source locale and a Portuguese club's spreadsheet is written the way a
 * Portuguese person writes a date. An American sheet would be read wrongly and
 * nothing in the cell says which it is — which is precisely why the preview
 * shows the *resolved* date beside every row before anything is written. The
 * operator sees 3 April and either agrees or fixes the column.
 *
 * A two-digit year is refused rather than guessed. "05" is 1905 for a masters
 * swimmer and 2005 for a teenager, and a register that quietly picks one is
 * worse than one that asks.
 */
export function parseImportDate(raw: string): { date: string } | { error: 'badDate' } {
  const value = raw.trim();
  if (value === '') return { date: '' };

  // ISO first: unambiguous, and what a database export looks like.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return isRealDate(value) ? { date: value } : { error: 'badDate' };
  }

  // An ISO timestamp, which is what a CSV written by another system carries.
  const stamped = /^(\d{4}-\d{2}-\d{2})[T ]/.exec(value);
  const stampedDate = stamped?.[1];
  if (stampedDate !== undefined) {
    return isRealDate(stampedDate) ? { date: stampedDate } : { error: 'badDate' };
  }

  const written = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(value);
  if (written) {
    const composed = `${written[3]}-${(written[2] ?? '').padStart(2, '0')}-${(written[1] ?? '').padStart(2, '0')}`;
    return isRealDate(composed) ? { date: composed } : { error: 'badDate' };
  }

  if (/^\d+([.,]\d+)?$/.test(value)) {
    const serial = fromExcelSerial(Number(value.replace(',', '.')));
    return serial === null ? { error: 'badDate' } : { date: serial };
  }

  return { error: 'badDate' };
}

/**
 * Whether somebody born on this date is under the club's maioridade.
 *
 * Whole years, compared as date strings, because both sides are calendar dates
 * and `Date` arithmetic across a birthday is where the off-by-one-day bugs live.
 */
export function isMinorOn(birthDate: string, today: string, majority: number): boolean {
  const year = Number(birthDate.slice(0, 4));
  const adultOn = `${String(year + majority).padStart(4, '0')}-${birthDate.slice(5)}`;
  return today < adultOn;
}

function text(row: RawImportRow, field: ImportField): string {
  return (row[field] ?? '').trim().replace(/\s+/g, ' ');
}

function capped(
  value: string,
  field: ImportField,
  max: number,
  problems: ImportProblem[],
): string | null {
  if (value === '') return null;
  if (value.length > max) {
    problems.push({ field, code: 'tooLong' });
    return null;
  }
  return value;
}

/**
 * Everything one row means, and everything wrong with it.
 *
 * `seen` is carried across rows by `validateImportRows` so the second Maria in a
 * file is told about the first. It is a parameter rather than module state, so
 * two imports can never contaminate each other.
 */
function validateRow(
  raw: RawImportRow,
  index: number,
  context: ImportContext,
  levelsByKey: Map<string, ImportLevel>,
  existingByKey: Map<string, ExistingStudent>,
  seen: Map<string, ImportRow>,
): ImportRow {
  const problems: ImportProblem[] = [];

  // ---- name -------------------------------------------------------------
  let firstName = text(raw, 'firstName');
  let lastName = text(raw, 'lastName');
  const fullName = text(raw, 'fullName');

  if (firstName === '' && fullName !== '') {
    const split = splitFullName(fullName);
    firstName = split.first;
    if (lastName === '') lastName = split.last;
  }
  // A "Nome" column with no surname column: the split supplies both, and a
  // one-word name becomes both parts rather than half a record.
  if (lastName === '' && firstName !== '') lastName = firstName;

  if (firstName === '') {
    problems.push({
      field: raw.firstName === undefined ? 'fullName' : 'firstName',
      code: 'nameRequired',
    });
  } else if (firstName.length > MAX_NAME || lastName.length > MAX_NAME) {
    problems.push({ field: 'firstName', code: 'tooLong' });
  }

  // ---- birth date -------------------------------------------------------
  let birthDate: string | null = null;
  const rawDate = text(raw, 'birthDate');
  if (rawDate !== '') {
    const parsed = parseImportDate(rawDate);
    if ('error' in parsed) {
      problems.push({ field: 'birthDate', code: 'badDate', value: rawDate });
    } else if (parsed.date > context.today) {
      problems.push({ field: 'birthDate', code: 'futureDate', value: rawDate });
    } else if (parsed.date < EARLIEST_BIRTH_DATE) {
      problems.push({ field: 'birthDate', code: 'ancientDate', value: rawDate });
    } else {
      birthDate = parsed.date;
    }
  }

  // ---- level ------------------------------------------------------------
  const levelName = text(raw, 'levelName');
  let levelId: string | null = null;
  if (levelName !== '') {
    const match = levelsByKey.get(normaliseKey(levelName));
    if (match === undefined) {
      // Named rather than nulled. A level that quietly vanished is a hundred
      // students in "sem nível" and nobody knowing which hundred.
      problems.push({ field: 'levelName', code: 'unknownLevel', value: levelName });
    } else {
      levelId = match.id;
    }
  }

  // ---- contact ----------------------------------------------------------
  const contactEmail = capped(text(raw, 'contactEmail'), 'contactEmail', MAX_EMAIL, problems);
  const contactPhone = capped(text(raw, 'contactPhone'), 'contactPhone', MAX_PHONE, problems);
  const notes = capped((raw.notes ?? '').trim(), 'notes', MAX_NOTES, problems);

  // ---- guardian ---------------------------------------------------------
  const guardianName = text(raw, 'guardianName');
  const guardianPhone = capped(text(raw, 'guardianPhone'), 'guardianPhone', MAX_PHONE, problems);
  const guardianEmail = capped(text(raw, 'guardianEmail'), 'guardianEmail', MAX_EMAIL, problems);
  const guardianNif = capped(text(raw, 'guardianTaxNumber'), 'guardianTaxNumber', MAX_NIF, problems);
  const relationship = text(raw, 'guardianRelationship') || context.defaultRelationship;

  const guardian: ImportGuardian | null =
    guardianName === ''
      ? null
      : {
          name: guardianName.slice(0, MAX_NAME),
          relationship,
          phone: guardianPhone,
          email: guardianEmail,
          taxNumber: guardianNif,
        };

  /*
   * A minor needs a guardian — POOLSE-04, criterion 2, and the same rule
   * `parseStudent` enforces on the form.
   *
   * The import does not get an exemption. It gets something better: the preview
   * names every row this refuses *before* anything is written, so the operator
   * maps a guardian column and tries again rather than discovering a register
   * full of children nobody can be telephoned about.
   *
   * A row with no birth date is never blocked, exactly as on the form — missing
   * dates are the normal case in a real spreadsheet.
   */
  if (
    birthDate !== null &&
    isMinorOn(birthDate, context.today, context.ageOfMajority) &&
    guardian === null
  ) {
    problems.push({ field: 'guardianName', code: 'guardianRequired' });
  }

  /*
   * **A guardian needs an email or a NIF, whatever the child's age.**
   *
   * This is `guardian_needs_a_key` — a database trigger, not a preference: a
   * guardian is where duplicates come from, so a guardian has to be dedupable.
   * A telephone number is not a key and does not satisfy it.
   *
   * Checked here rather than left to the trigger because the trigger fires
   * *during the commit*, and one row failing it rolls the entire import back
   * with a message from PL/pgSQL. Refusing the row on the preview turns a
   * five-hundred error into a line the operator can see and fix.
   */
  if (guardian !== null && guardian.email === null && guardian.taxNumber === null) {
    problems.push({ field: 'guardianEmail', code: 'guardianKeyRequired' });
  }

  // ---- duplicates -------------------------------------------------------
  const key = `${normaliseKey(`${firstName} ${lastName}`)}|${birthDate ?? ''}`;
  let duplicate: ImportDuplicate | null = null;

  if (firstName !== '') {
    const earlier = seen.get(key);
    const already = existingByKey.get(key);

    if (earlier !== undefined) {
      duplicate = {
        kind: 'file',
        name: `${earlier.firstName} ${earlier.lastName}`,
        line: earlier.line,
      };
    } else if (already !== undefined) {
      duplicate = { kind: 'register', studentId: already.id, name: already.displayName };
    }
  }

  const row: ImportRow = {
    index,
    // +1 for the header, +1 because a spreadsheet's own row numbers start at one.
    line: index + 2,
    firstName,
    lastName,
    birthDate,
    levelId,
    levelName: levelName === '' ? null : levelName,
    contactEmail,
    contactPhone,
    notes,
    guardian,
    problems,
    duplicate,
    importable: problems.length === 0,
  };

  if (firstName !== '' && !seen.has(key)) seen.set(key, row);
  return row;
}

export interface ImportSummary {
  total: number;
  /** Rows that can be written at all. */
  importable: number;
  /** Rows with at least one problem. */
  refused: number;
  /** Importable rows that match something already known. */
  duplicates: number;
}

export function validateImportRows(
  rows: RawImportRow[],
  context: ImportContext,
): { rows: ImportRow[]; summary: ImportSummary } {
  const levelsByKey = new Map(context.levels.map((level) => [normaliseKey(level.name), level]));
  const existingByKey = new Map(
    context.existing.map((student) => [
      `${normaliseKey(`${student.firstName} ${student.lastName}`)}|${student.birthDate ?? ''}`,
      student,
    ]),
  );

  const seen = new Map<string, ImportRow>();
  const validated = rows.map((raw, index) =>
    validateRow(raw, index, context, levelsByKey, existingByKey, seen),
  );

  return {
    rows: validated,
    summary: {
      total: validated.length,
      importable: validated.filter((row) => row.importable).length,
      refused: validated.filter((row) => !row.importable).length,
      duplicates: validated.filter((row) => row.importable && row.duplicate !== null).length,
    },
  };
}
