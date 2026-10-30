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

import type { MaritalStatus, StudentIdentity } from './identity.js';

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
  /**
   * The student's own NIF.
   *
   * A bare "NIF" column belongs here rather than to the guardian: it sits in
   * the student's row, and the guardian's own column is named after them in
   * every sheet that has both. The mapping step makes either a one-click
   * correction, which is what it is for.
   */
  'taxNumber',
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
  /**
   * Sócio — POOLSE-42, AC6.
   *
   * Anything a person writes for yes. A club's spreadsheet has an "S" column
   * or a "Sim", never a JSON boolean, and refusing to understand "x" would
   * make the operator retype two hundred cells to satisfy a parser.
   *
   * The mensalidade plan and its periodicity are deliberately *not* here.
   * They belong to a facility, and a student with no enrolment gives the
   * import no way to know which one — guessing would assign a price from the
   * wrong site, which is the failure this ticket's composite keys exist to
   * prevent. Fees are assigned on the student page, where the site is known.
   */
  'isSocio',
  'socioNumber',
  /** Sócio desde — POOLSE-134. A date, read the way a birth date is. */
  'socioSince',
  /** The FPN licence — POOLSE-81, Excel parity with the student form. */
  'federationLicence',
  /**
   * Género — round 5.
   *
   * Read the way every other yes/no column here is read: whatever a person
   * wrote. "M", "masc", "rapaz", "H" for homem; "F", "fem", "rapariga". Anything
   * else is left unrecorded rather than guessed at, and a first name is never
   * used to decide it — that is a guess with a person's identity in it.
   */
  'gender',
  /**
   * Whether the club's own file says this student has paid.
   *
   * Poolse cannot always turn that into a settled occurrence: a student imported
   * today has no mensalidade yet, and inventing one from a level name would be
   * inventing a price. So it is recorded for what it is — paid up to this month
   * — and the register reads it where the student has no fee line. Where there
   * is one, the import settles the occurrence properly as well.
   */
  'isPaid',
  /**
   * Address and identity — POOLSE-131. All optional, all the student's own.
   * A matched student has only its blanks filled, like every field here.
   */
  'addressLine',
  'locality',
  'postalCode',
  'parentOneName',
  'parentTwoName',
  'maritalStatus',
  'profession',
  'education',
  'birthplace',
  'nationality',
  'snsNumber',
] as const;

/** The identity fields, as one group — POOLSE-131. */
export const IDENTITY_IMPORT_FIELDS = [
  'addressLine',
  'locality',
  'postalCode',
  'parentOneName',
  'parentTwoName',
  'maritalStatus',
  'profession',
  'education',
  'birthplace',
  'nationality',
  'snsNumber',
] as const satisfies readonly ImportField[];

export type IdentityImportField = (typeof IDENTITY_IMPORT_FIELDS)[number];

export type ImportField = (typeof IMPORT_FIELDS)[number];

/** A row as it arrives: mapped to field names, every value still a string. */
export type RawImportRow = Partial<Record<ImportField, string>>;

/**
 * Machine keys, never sentences.
 *
 * Same rule as `ApiError.fields`: the API has no message catalogues, so it says
 * *what* is wrong and the web app owns how that reads in pt-PT and en.
 */
/**
 * What refuses a row.
 *
 * Deliberately short, and it got shorter. An importer that refuses a student
 * because their spreadsheet is missing something the register does not require
 * is an importer that fails most real files: only the name is mandatory in the
 * database, and only two other things can genuinely not be written — a date that
 * is not a date, and a NIF the unique index would reject mid-commit.
 *
 * Everything else that used to refuse a row is now an `ImportWarningCode`:
 * said out loud on the preview, and imported anyway.
 */
export type ImportProblemCode =
  | 'nameRequired'
  | 'tooLong'
  | 'badDate'
  | 'futureDate'
  | 'ancientDate'
  /** POOLSE-131: a value the column cannot hold, quoted back. */
  | 'badPostalCode'
  | 'badSnsNumber'
  | 'badNationality'
  | 'badMaritalStatus'
  /** POOLSE-134: the sócio number belongs to another student, quoted back. */
  | 'socioNumberTaken';

/**
 * What is worth saying but never worth refusing over.
 *
 * A warning is the honest middle: the row imports, and the operator is told what
 * the file did not contain or what the import will do about it. Silence here
 * would be worse than a refusal — a guardian quietly dropped, or a level quietly
 * created, is a surprise found weeks later.
 */
export type ImportWarningCode =
  | 'noGuardian'
  | 'guardianNotRecorded'
  | 'levelWillBeCreated'
  /** The row's NIF belongs to somebody else, so it is not copied onto this one. */
  | 'taxNumberBelongsToAnother';

export interface ImportWarning {
  field: ImportField;
  code: ImportWarningCode;
  value?: string;
}

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
/**
 * A field this row would fill in on a student who already exists.
 *
 * Only ever a blank being filled. Nothing an operator typed into Poolse can be
 * overwritten by a spreadsheet, which is what makes re-importing last year's
 * file harmless rather than destructive — the commonest thing a club will
 * actually do with this feature.
 */
export interface ImportUpdate {
  field:
    | 'birthDate'
    | 'levelId'
    | 'contactEmail'
    | 'contactPhone'
    | 'taxNumber'
    | 'notes'
    | 'federationLicence'
    | 'isSocio'
    | 'socioNumber'
    | 'socioSince'
    | IdentityImportField;
  /** What would be written. `levelId` carries the level's name, for the screen. */
  value: string;
}

export interface ImportDuplicate {
  kind: 'register' | 'file';
  /** The existing student, when `kind` is `register`. */
  studentId?: string;
  name: string;
  /** The earlier row's spreadsheet line, when `kind` is `file`. */
  line?: number;
  /**
   * Which rung of the ladder matched — POOLSE-17's, reused.
   *
   * A NIF is an identity; a name and a birthday are a strong hint. Saying which
   * one matched is what lets somebody judge a match they are surprised by.
   */
  matchedOn: 'taxNumber' | 'nameAndBirthDate';
}

export interface ImportGuardian {
  name: string;
  /**
   * Null unless the sheet actually had a column for it.
   *
   * There used to be a control on the mapping step asking the operator to name
   * one relationship for the whole file, because `parseStudent` requires one on
   * the create form. It was ceremony: this imports a list of students, the
   * column almost never exists, and `guardian_link.relationship` is nullable.
   */
  relationship: string | null;
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
  taxNumber: string | null;
  notes: string | null;
  isSocio: boolean;
  socioNumber: string | null;
  /** Sócio desde, `YYYY-MM-DD` — POOLSE-134. */
  socioSince: string | null;
  federationLicence: string | null;
  /** Masculino or feminino. Null is "the sheet did not say", which is normal. */
  gender: 'male' | 'female' | null;
  /** True when the file says this student is paid up. */
  isPaid: boolean;
  /** Address and identity — POOLSE-131. Null when the row carries none of it. */
  identity: StudentIdentity | null;
  guardian: ImportGuardian | null;
  problems: ImportProblem[];
  warnings: ImportWarning[];
  duplicate: ImportDuplicate | null;
  /**
   * What a commit would fill in on the matched student.
   *
   * Empty when the row matches nobody, and empty when it matches somebody who
   * already has everything the row carries — which is the ordinary outcome of
   * importing the same file twice, and the reason that costs nothing.
   */
  updates: ImportUpdate[];
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

/**
 * A student already in the register, as the importer needs to see them.
 *
 * Carries every field an import could fill in, because deciding whether a value
 * is worth writing means knowing whether there is already one there. Loading
 * them is the same single query either way.
 */
export interface ExistingStudent {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  taxNumber: string | null;
  displayName: string;
  levelId: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
  federationLicence: string | null;
  /** What is on file of the identity group — POOLSE-131. */
  identity: StudentIdentity | null;
  /** The sócio on file — POOLSE-134. */
  isSocio: boolean;
  socioNumber: string | null;
  socioSince: string | null;
}

export interface ImportContext {
  levels: ImportLevel[];
  /** The club's maioridade in years — POOLSE-22, never a literal. */
  ageOfMajority: number;
  /** Students already in the register. Built by the repository. */
  existing: ExistingStudent[];
  /** What "today" is, as `YYYY-MM-DD`. Injected so the tests are not seasonal. */
  today: string;
}

/**
 * The largest register one import may carry.
 *
 * Measured rather than guessed: 2 000 students is a 119 KB `.xlsx` and a 489 KB
 * JSON payload, and 10 000 is 566 KB and 2.4 MB. The file size was never the
 * binding constraint — this number was, and at 2 000 it was smaller than any
 * real municipality with several pools.
 *
 * Past 10 000 the thing that needs redesigning is the rows-as-JSON round trip,
 * not this constant, so raising it further without that work would only move
 * the failure somewhere less obvious.
 */
export const MAX_IMPORT_ROWS = 10_000;

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

/**
 * A spreadsheet's idea of yes.
 *
 * Portuguese and English, plus the bare marks people actually type into a
 * narrow column. Anything else is no — including an empty cell, which is the
 * overwhelmingly common case and must not become a club of two hundred members.
 */
const YES = new Set(['sim', 's', 'yes', 'y', 'true', 'verdadeiro', 'x', '1', 'sócio', 'socio']);

/**
 * Género, as a club's spreadsheet writes it — round 5.
 *
 * Portuguese and English, single letters and whole words. Anything unrecognised
 * is left unrecorded: a column of "outro" or a stray "1" is not evidence, and a
 * wrong guess here is wrong about a person rather than about a number. The first
 * name is deliberately never consulted.
 */
export function readsAsGender(value: string): 'male' | 'female' | null {
  const said = value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (said === '') return null;

  if (['m', 'masc', 'masculino', 'male', 'h', 'homem', 'rapaz', 'menino', 'boy'].includes(said)) {
    return 'male';
  }
  if (
    ['f', 'fem', 'feminino', 'female', 'mulher', 'rapariga', 'menina', 'girl'].includes(said)
  ) {
    return 'female';
  }
  return null;
}

/**
 * Estado civil as a spreadsheet writes it — POOLSE-131.
 *
 * The export writes the Portuguese word ("Casado/a"), the gender column's
 * precedent, so a file exported in either language re-imports; the English word
 * and the enum's own spelling are read too. Undefined is "not a marital status".
 */
export function readsAsMaritalStatus(value: string): MaritalStatus | null | undefined {
  const word = normaliseKey(value).replace(/ /g, '');
  if (word === '') return null;
  if (/^(solteir|single)/.test(word)) return 'single';
  if (/^(casad|married)/.test(word)) return 'married';
  if (/^(uniaodefacto|uniaodefato|uniaodefacto|civilunion|civilpartner|domesticpartner)/.test(word)) {
    return 'civil_union';
  }
  if (/^(divorciad|divorced|separad|separated)/.test(word)) return 'divorced';
  if (/^(viuv|widow)/.test(word)) return 'widowed';
  return undefined;
}

/**
 * A nationality as a spreadsheet writes it — POOLSE-131.
 *
 * The export writes the ISO code ("PT"), which is the same in both languages;
 * a club's own file says "Portugal" or "Portuguesa". The country's name in
 * pt-PT or en comes back through `Intl.DisplayNames`, so no list of countries is
 * kept here; the commonest demonyms are. Undefined is "not a country".
 */
const DEMONYMS: [string, string[]][] = [
  ['PT', ['portuguesa', 'portugues', 'portuguese']],
  ['BR', ['brasileira', 'brasileiro', 'brazilian']],
  ['ES', ['espanhola', 'espanhol', 'spanish']],
  ['FR', ['francesa', 'frances', 'french']],
  ['GB', ['britanica', 'britanico', 'inglesa', 'ingles', 'british', 'english']],
  ['DE', ['alema', 'alemao', 'german']],
  ['IT', ['italiana', 'italiano', 'italian']],
  ['UA', ['ucraniana', 'ucraniano', 'ukrainian']],
  ['RO', ['romena', 'romeno', 'romanian']],
  ['AO', ['angolana', 'angolano', 'angolan']],
  ['CV', ['cabo verdiana', 'cabo verdiano', 'cape verdean']],
  ['MZ', ['mocambicana', 'mocambicano', 'mozambican']],
  ['US', ['americana', 'americano', 'american']],
];

/**
 * Codes `Intl` names that are not a country to write on a form: retired ones it
 * aliases to a living country (DD is "Germany"), and the groupings and
 * reserved territories (EU, UN, ZZ). Kosovo's XK stays, as clubs write it.
 */
const NOT_COUNTRIES = new Set(
  (
    'AN BU CS DD DY FX HV NH RH SU TP UK VD YD YU ZR ' +
    'AC CP CQ DG EA EU EZ IC QO TA UN XA XB ZZ'
  ).split(' '),
);

let countriesByName: Map<string, string> | null = null;

function countryNames(): Map<string, string> {
  if (countriesByName !== null) return countriesByName;
  const names = new Map<string, string>();
  const readers = ['pt-PT', 'pt', 'en'].map(
    (locale) => new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' }),
  );
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const first of letters) {
    for (const second of letters) {
      const code = `${first}${second}`;
      if (NOT_COUNTRIES.has(code)) continue;
      for (const reader of readers) {
        const name = reader.of(code);
        if (name === undefined || name === code) continue;
        const named = normaliseKey(name);
        if (!names.has(named)) names.set(named, code);
      }
    }
  }
  for (const [code, words] of DEMONYMS) for (const word of words) names.set(word, code);
  countriesByName = names;
  return names;
}

export function readsAsNationality(value: string): string | null | undefined {
  const said = value.trim();
  if (said === '') return null;
  if (/^[A-Za-z]{2}$/.test(said)) {
    const code = said.toUpperCase();
    // A real country: DisplayNames answers undefined for a code that is not one.
    if (NOT_COUNTRIES.has(code)) return undefined;
    const known = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' }).of(code);
    return known === undefined || known === code ? undefined : code;
  }
  return countryNames().get(normaliseKey(said));
}

/**
 * A código postal out of a cell — POOLSE-131.
 *
 * "4000-123", "4000 123" and "4000123" are one code. A Portuguese sheet very
 * often writes the locality after it ("4000-123 Porto"), so the words that
 * follow are handed back to fill an empty Localidade. Undefined is "not a code".
 */
export function readsAsPostalCode(
  value: string,
): { code: string; locality: string | null } | null | undefined {
  const said = value.trim();
  if (said === '') return null;
  const found = /^(\d{4})\s*-?\s*(\d{3})(?:\s+(\D.*))?$/.exec(said);
  if (found === null) return undefined;
  const rest = (found[3] ?? '').trim();
  return { code: `${found[1]}-${found[2]}`, locality: rest === '' ? null : rest };
}

export function readsAsYes(value: string): boolean {
  return YES.has(normaliseKey(value));
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

const IDENTITY_LIMITS: Partial<Record<IdentityImportField, number>> = {
  addressLine: 200,
  locality: 100,
  parentOneName: 160,
  parentTwoName: 160,
  profession: 120,
  education: 120,
  birthplace: 120,
};

/**
 * The identity group out of one row — POOLSE-131. Null when the row carries
 * none of it; a value the column cannot hold refuses the row and is quoted back.
 * The limits and shapes are `identity.ts`'s, the form's own.
 */
function readIdentity(raw: RawImportRow, problems: ImportProblem[]): StudentIdentity | null {
  if (!IDENTITY_IMPORT_FIELDS.some((field) => text(raw, field) !== '')) return null;

  const plain = (field: IdentityImportField): string | null =>
    capped(text(raw, field), field, IDENTITY_LIMITS[field] ?? MAX_NIF, problems);

  let locality = plain('locality');

  let postalCode: string | null = null;
  const postal = text(raw, 'postalCode');
  const readPostal = readsAsPostalCode(postal);
  if (readPostal === undefined) {
    problems.push({ field: 'postalCode', code: 'badPostalCode', value: postal });
  } else if (readPostal !== null) {
    postalCode = readPostal.code;
    if (locality === null && readPostal.locality !== null) {
      locality = capped(readPostal.locality, 'locality', IDENTITY_LIMITS.locality ?? MAX_NIF, problems);
    }
  }

  const maritalCell = text(raw, 'maritalStatus');
  const maritalStatus = readsAsMaritalStatus(maritalCell);
  if (maritalStatus === undefined) {
    problems.push({ field: 'maritalStatus', code: 'badMaritalStatus', value: maritalCell });
  }

  const countryCell = text(raw, 'nationality');
  const nationality = readsAsNationality(countryCell);
  if (nationality === undefined) {
    problems.push({ field: 'nationality', code: 'badNationality', value: countryCell });
  }

  const snsCell = text(raw, 'snsNumber');
  const snsDigits = snsCell.replace(/[\s.\-]/g, '');
  let snsNumber: string | null = null;
  if (snsCell !== '') {
    if (/^\d{9}$/.test(snsDigits)) snsNumber = snsDigits;
    else problems.push({ field: 'snsNumber', code: 'badSnsNumber', value: snsCell });
  }

  return {
    addressLine: plain('addressLine'),
    locality,
    postalCode,
    parentOneName: plain('parentOneName'),
    parentTwoName: plain('parentTwoName'),
    maritalStatus: maritalStatus ?? null,
    profession: plain('profession'),
    education: plain('education'),
    birthplace: plain('birthplace'),
    nationality: nationality ?? null,
    snsNumber,
  };
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
  existingByTax: Map<string, ExistingStudent>,
  seen: Map<string, ImportRow>,
  seenTax: Map<string, ImportRow>,
  socios: { existing: Map<string, ExistingStudent>; seen: Map<string, ImportRow> },
): ImportRow {
  const problems: ImportProblem[] = [];
  const warnings: ImportWarning[] = [];

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
  /*
   * A level the club does not have yet is created, not refused.
   *
   * The old behaviour failed the row and told the operator to go and add the
   * level by hand — which is asking somebody to copy a list out of the
   * spreadsheet they are in the middle of importing. A club's programme *is*
   * whatever their sheet says it is.
   *
   * The match is accent- and case-insensitive, so "iniciacao" finds an existing
   * "Iniciação" rather than creating a second one; only a genuinely new name
   * makes a new level. Nothing is created here — this only says what a commit
   * would do, and the warning is what puts it in front of a person first.
   */
  const levelName = text(raw, 'levelName');
  let levelId: string | null = null;
  if (levelName !== '') {
    const match = levelsByKey.get(normaliseKey(levelName));
    if (match === undefined) {
      warnings.push({ field: 'levelName', code: 'levelWillBeCreated', value: levelName });
    } else {
      levelId = match.id;
    }
  }

  // ---- contact ----------------------------------------------------------
  const contactEmail = capped(text(raw, 'contactEmail'), 'contactEmail', MAX_EMAIL, problems);
  const contactPhone = capped(text(raw, 'contactPhone'), 'contactPhone', MAX_PHONE, problems);
  const taxNumber = capped(text(raw, 'taxNumber'), 'taxNumber', MAX_NIF, problems);
  const notes = capped((raw.notes ?? '').trim(), 'notes', MAX_NOTES, problems);
  const socioNumber = capped(text(raw, 'socioNumber'), 'socioNumber', MAX_NIF, problems);
  const federationLicence = capped(
    text(raw, 'federationLicence'),
    'federationLicence',
    MAX_NIF,
    problems,
  );
  // Sócio desde — POOLSE-134: any date a birth date may be, refused the same way.
  let socioSince: string | null = null;
  const rawSince = text(raw, 'socioSince');
  if (rawSince !== '') {
    const parsed = parseImportDate(rawSince);
    if ('error' in parsed || parsed.date < EARLIEST_BIRTH_DATE) {
      problems.push({ field: 'socioSince', code: 'badDate', value: rawSince });
    } else {
      socioSince = parsed.date;
    }
  }
  // A number on its own says they are a member. Writing one and leaving the
  // yes-column blank is how half of these sheets are actually filled in.
  const isSocio =
    readsAsYes(text(raw, 'isSocio')) || socioNumber !== null || socioSince !== null;
  const gender = readsAsGender(text(raw, 'gender'));
  const isPaid = readsAsYes(text(raw, 'isPaid'));

  // ---- address and identity — POOLSE-131 ---------------------------------
  const identity = readIdentity(raw, problems);

  // ---- guardian ---------------------------------------------------------
  const guardianName = text(raw, 'guardianName');
  const guardianPhone = capped(text(raw, 'guardianPhone'), 'guardianPhone', MAX_PHONE, problems);
  const guardianEmail = capped(text(raw, 'guardianEmail'), 'guardianEmail', MAX_EMAIL, problems);
  const guardianNif = capped(text(raw, 'guardianTaxNumber'), 'guardianTaxNumber', MAX_NIF, problems);
  const relationship = text(raw, 'guardianRelationship');

  /*
   * A guardian is recorded only when they can be told apart from another one.
   *
   * `guardian_needs_a_key` — POOLSE-17 — requires a NIF or an email, because a
   * guardian is where duplicates come from: without a key, the same mother
   * arrives once per child and the register grows four of her.
   *
   * So a named guardian with neither is *not written*, and the row says so. The
   * student still imports. Refusing the whole student over their mother's
   * missing email address would fail most real files, and dropping her silently
   * would be worse than either.
   */
  const guardianKeyed = guardianEmail !== null || guardianNif !== null;

  const guardian: ImportGuardian | null =
    guardianName === '' || !guardianKeyed
      ? null
      : {
          name: guardianName.slice(0, MAX_NAME),
          relationship: relationship === '' ? null : relationship,
          phone: guardianPhone,
          email: guardianEmail,
          taxNumber: guardianNif,
        };

  if (guardianName !== '' && !guardianKeyed) {
    warnings.push({ field: 'guardianEmail', code: 'guardianNotRecorded', value: guardianName });
  }

  /*
   * A minor with nobody attached — said, not refused.
   *
   * POOLSE-04 criterion 2 asks that a minor have a reachable guardian, and the
   * create form still enforces it. The import does not, because a club's
   * spreadsheet very often has no guardian column at all and refusing every
   * child in it makes the onboarding path useless. The count on the preview is
   * what keeps the rule visible: the operator sees how many children arrive
   * without one before deciding to go ahead.
   */
  if (
    birthDate !== null &&
    isMinorOn(birthDate, context.today, context.ageOfMajority) &&
    guardian === null &&
    // A guardian that was named but could not be recorded already has its own,
    // more specific warning. Saying both would be the same fact told twice.
    guardianName === ''
  ) {
    warnings.push({ field: 'guardianName', code: 'noGuardian' });
  }

  /*
   * ---- who this row is ------------------------------------------------------
   *
   * The same ladder POOLSE-17 uses for guardians, one rung lower: **a NIF, else
   * a name and a birth date.** A NIF is an identity — it is issued to exactly
   * one person — so a match on it is a match, full stop. A name and a birthday
   * together are a strong hint and nothing more; twins exist.
   *
   * A NIF match used to be a *refusal*, on the reasoning that the unique index
   * would reject it anyway. That was backwards: the strongest signal the file
   * carries was the one thing that could stop a row. Now it is what makes the
   * row an update, and the index can no longer be violated at all — a NIF that
   * matches nobody is by definition free, and one that matches somebody makes
   * this row that somebody.
   */
  const nifKey = taxNumber === null ? null : normaliseKey(taxNumber).replace(/ /g, '');
  const nameKey = `${normaliseKey(`${firstName} ${lastName}`)}|${birthDate ?? ''}`;

  let duplicate: ImportDuplicate | null = null;
  let matched: ExistingStudent | null = null;

  if (firstName !== '') {
    // An earlier row of this same file is checked first on both rungs: the same
    // child listed twice must never become two records, whichever key spots it.
    const earlier =
      (nifKey !== null && nifKey !== '' ? seenTax.get(nifKey) : undefined) ?? seen.get(nameKey);

    if (earlier !== undefined) {
      duplicate = {
        kind: 'file',
        name: `${earlier.firstName} ${earlier.lastName}`,
        line: earlier.line,
        matchedOn:
          nifKey !== null && nifKey !== '' && seenTax.has(nifKey)
            ? 'taxNumber'
            : 'nameAndBirthDate',
      };
    } else {
      const byTax = nifKey !== null && nifKey !== '' ? existingByTax.get(nifKey) : undefined;
      const byName = existingByKey.get(nameKey);
      matched = byTax ?? byName ?? null;

      if (matched !== null) {
        duplicate = {
          kind: 'register',
          studentId: matched.id,
          name: matched.displayName,
          matchedOn: byTax !== undefined ? 'taxNumber' : 'nameAndBirthDate',
        };
      }
    }
  }

  /*
   * ---- a sócio number held by somebody else — POOLSE-134 ---------------------
   *
   * Refused, never resolved: a number identifies one member, and which of two
   * records is wrong is not something an importer can know. The unique index
   * would otherwise refuse the commit at the last moment and take the whole
   * file with it. The same child listed twice in the file is not a clash.
   */
  if (socioNumber !== null) {
    const holder = socios.existing.get(socioNumber);
    const earlier = socios.seen.get(socioNumber);
    const heldElsewhere = holder !== undefined && holder.id !== matched?.id;
    const earlierInFile =
      earlier !== undefined && !(duplicate?.kind === 'file' && duplicate.line === earlier.line);
    if (heldElsewhere || earlierInFile) {
      problems.push({ field: 'socioNumber', code: 'socioNumberTaken', value: socioNumber });
    }
  }

  /*
   * ---- what a commit would fill in ------------------------------------------
   *
   * Blanks only. A field the register already has stays exactly as it is, so a
   * club that exports, edits two rows and re-imports the lot cannot flatten
   * everything else with a stale copy of itself.
   */
  const updates: ImportUpdate[] = [];
  if (matched !== null) {
    const existingLicences = context.existing.map((other) => ({
      id: other.id,
      licence: other.federationLicence,
    }));
    const fill = (
      field: ImportUpdate['field'],
      existingValue: string | null,
      incoming: string | null,
    ): void => {
      if (incoming === null || incoming === '') return;
      if (existingValue !== null && existingValue !== '') return;
      updates.push({ field, value: incoming });
    };

    fill('birthDate', matched.birthDate, birthDate);
    fill('contactEmail', matched.contactEmail, contactEmail);
    fill('contactPhone', matched.contactPhone, contactPhone);
    fill('notes', matched.notes, notes);
    // The sócio, blanks only — POOLSE-134. Membership only ever turns on here.
    if (isSocio && !matched.isSocio) updates.push({ field: 'isSocio', value: 'true' });
    fill('socioNumber', matched.socioNumber, socioNumber);
    fill('socioSince', matched.socioSince, socioSince);
    // Identity fills only what is empty on file, field by field — POOLSE-131.
    if (identity !== null) {
      for (const field of IDENTITY_IMPORT_FIELDS) {
        fill(field, matched.identity?.[field] ?? null, identity[field]);
      }
    }
    // A licence only when nobody else in the club holds it — two swimmers cannot
    // share one, and a commit refused at the unique index would take the whole
    // file down (the NIF's reasoning below).
    if (
      federationLicence !== null &&
      !existingLicences.some((other) => other.licence === federationLicence && other.id !== matched!.id)
    ) {
      fill('federationLicence', matched.federationLicence, federationLicence);
    }
    // The level carries its *name*, because the screen shows this and an id
    // means nothing to a person. The repository resolves it back.
    fill('levelId', matched.levelId, levelName === '' ? null : levelName);

    /*
     * A NIF is only filled in when it is genuinely free.
     *
     * If this row matched on the name and its NIF belongs to somebody else,
     * copying it across would violate `student_tax_number_uq` mid-commit and
     * take the whole import down. Saying so and moving on is the honest answer:
     * two people cannot share a number, and which of them is wrong is not
     * something an importer can know.
     */
    if (taxNumber !== null && (matched.taxNumber === null || matched.taxNumber === '')) {
      const owner = nifKey === null ? undefined : existingByTax.get(nifKey);
      if (owner === undefined || owner.id === matched.id) {
        updates.push({ field: 'taxNumber', value: taxNumber });
      } else {
        warnings.push({
          field: 'taxNumber',
          code: 'taxNumberBelongsToAnother',
          value: taxNumber,
        });
      }
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
    taxNumber,
    notes,
    isSocio,
    socioNumber,
    socioSince,
    federationLicence,
    gender,
    isPaid,
    identity,
    guardian,
    problems,
    warnings,
    duplicate,
    updates,
    importable: problems.length === 0,
  };

  if (firstName !== '') {
    if (!seen.has(nameKey)) seen.set(nameKey, row);
    if (nifKey !== null && nifKey !== '' && !seenTax.has(nifKey)) seenTax.set(nifKey, row);
  }
  if (socioNumber !== null && !socios.seen.has(socioNumber)) socios.seen.set(socioNumber, row);
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
  /** Matched rows that would actually change something. */
  toUpdate: number;
  /** Rows that would create a student nobody has yet. */
  toCreate: number;
  /** Rows carrying at least one warning — imported, but worth a glance. */
  flagged: number;
  /** Minors arriving with no guardian, counted separately because POOLSE-04 cares. */
  minorsWithoutGuardian: number;
  /** Level names this import would create, in the order first seen. */
  levelsToCreate: string[];
}

/**
 * The level names a commit would create, each as it was *first* written.
 *
 * First rather than last, and it is not a detail: a file spelling it
 * "Pré-competição" on one row and "pre competicao" on another would otherwise
 * put the unaccented version on the club's programme, because the accented rows
 * came earlier and a Map keeps whatever it saw last.
 */
function firstSpellings(rows: ImportRow[]): string[] {
  const seen = new Map<string, string>();

  for (const row of rows) {
    if (!row.importable) continue;
    for (const warning of row.warnings) {
      if (warning.code !== 'levelWillBeCreated') continue;
      const name = warning.value ?? '';
      const levelKey = normaliseKey(name);
      if (!seen.has(levelKey)) seen.set(levelKey, name);
    }
  }

  return [...seen.values()];
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

  const existingByTax = new Map(
    context.existing
      .filter((student) => student.taxNumber !== null)
      .map((student) => [normaliseKey(student.taxNumber ?? '').replace(/ /g, ''), student]),
  );

  const seen = new Map<string, ImportRow>();
  const seenTax = new Map<string, ImportRow>();
  const socios = {
    existing: new Map(
      context.existing
        .filter((student) => student.socioNumber !== null)
        .map((student) => [student.socioNumber ?? '', student]),
    ),
    seen: new Map<string, ImportRow>(),
  };
  const validated = rows.map((raw, index) =>
    validateRow(raw, index, context, levelsByKey, existingByKey, existingByTax, seen, seenTax, socios),
  );

  return {
    rows: validated,
    summary: {
      total: validated.length,
      importable: validated.filter((row) => row.importable).length,
      refused: validated.filter((row) => !row.importable).length,
      duplicates: validated.filter((row) => row.importable && row.duplicate !== null).length,
      toUpdate: validated.filter(
        (row) => row.importable && row.duplicate?.kind === 'register' && row.updates.length > 0,
      ).length,
      toCreate: validated.filter((row) => row.importable && row.duplicate === null).length,
      flagged: validated.filter((row) => row.importable && row.warnings.length > 0).length,
      minorsWithoutGuardian: validated.filter(
        (row) => row.importable && row.warnings.some((warning) => warning.code === 'noGuardian'),
      ).length,
      levelsToCreate: firstSpellings(validated),
    },
  };
}
