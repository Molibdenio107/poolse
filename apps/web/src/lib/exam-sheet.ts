// `.ts` on the specifier, as in `salary-sheet.ts`: `node --test` reaches this
// module and its resolver adds no extensions.
import { matchFields, type MatchResult, type MatchSpec, type Sheet } from './sheet.ts';

/**
 * The exame médico spreadsheet's vocabulary — POOLSE-133.
 *
 * One row per student: who it is (a name, and a NIF or a birth date to find
 * them by), and their latest exam — the day, the result and how long it holds.
 * The API matches by NIF, else by name *and* birth date, which a person then
 * confirms on the preview; never by name alone, and never creating a student.
 *
 * **What the export writes, this reads back.** The header row is `exams.field.*`
 * from the catalogue, and the result is written as the Portuguese word in both
 * locales (the gender column's precedent), so a file exported under `en`
 * re-imports under `pt-PT`. Dates are ISO, as the register's export writes them.
 * `exam-sheet.test.ts` proves the round trip against the catalogue on disk.
 */

export const EXAM_FIELDS = [
  'studentName',
  'taxNumber',
  'birthDate',
  'examinedOn',
  'result',
  'validUntil',
] as const;

export type ExamField = (typeof EXAM_FIELDS)[number];

export type ExamMapping = Record<ExamField, number | null>;

export const EMPTY_EXAM_MAPPING: ExamMapping = {
  studentName: null,
  taxNumber: null,
  birthDate: null,
  examinedOn: null,
  result: null,
  validUntil: null,
};

/**
 * The header words each field answers to, already in the matcher's normal form
 * (lower case, no accents, punctuation as spaces).
 *
 * **Three date columns is the difficulty.** A bare "Data" is no field's
 * synonym; the matcher's abbreviation rule reads it as the exam date (the
 * likely meaning on this sheet), and the mapping step shows every field with a
 * sample, so a birth date taken for an exam date is seen before the preview.
 */
const SYNONYMS: [ExamField, string[]][] = [
  [
    'studentName',
    ['nome do aluno', 'nome', 'aluno', 'atleta', 'nadador', 'nome completo', 'student name', 'name', 'student', 'swimmer', 'athlete', 'full name'],
  ],
  [
    'taxNumber',
    ['nif', 'nif do aluno', 'contribuinte', 'numero de contribuinte', 'n contribuinte', 'tax number nif', 'tax number', 'student nif', 'vat', 'tax id'],
  ],
  [
    'birthDate',
    ['data de nascimento', 'nascimento', 'data nascimento', 'data nasc', 'dt nasc', 'date of birth', 'birth date', 'birthdate', 'dob', 'born'],
  ],
  [
    'examinedOn',
    ['data do exame', 'data exame', 'exame', 'exame medico', 'realizado em', 'feito em', 'exam date', 'date of exam', 'examined on', 'exam', 'medical exam'],
  ],
  [
    'result',
    ['resultado', 'aptidao', 'parecer', 'classificacao', 'result', 'outcome', 'fitness'],
  ],
  [
    'validUntil',
    ['valido ate', 'validade', 'data de validade', 'valida ate', 'expira', 'expira em', 'valid until', 'valid to', 'expiry', 'expiry date', 'expires', 'expires on'],
  ],
];

const isDateColumn = (looks: string[]): boolean => looks.includes('date');

/** The dates must hold dates. The NIF is never shape-matched: nine digits is also a phone. */
const EXPECTED_SHAPE: Partial<Record<ExamField, (looks: string[]) => boolean>> = {
  birthDate: isDateColumn,
  examinedOn: isDateColumn,
  validUntil: isDateColumn,
};

export const EXAM_MATCH: MatchSpec<ExamField> = {
  empty: EMPTY_EXAM_MAPPING,
  synonyms: SYNONYMS,
  expectedShape: EXPECTED_SHAPE,
};

/** Which column is which, with how sure it is about each. */
export function matchExamColumns(sheet: Sheet): MatchResult<ExamField> {
  return matchFields(sheet, EXAM_MATCH);
}

/** Enough to import anything: a way to find the student, and the exam's day and result. */
export function hasExamKey(mapping: ExamMapping): boolean {
  return (
    (mapping.taxNumber !== null || (mapping.studentName !== null && mapping.birthDate !== null)) &&
    mapping.examinedOn !== null &&
    mapping.result !== null
  );
}

/** The columns an export writes, in reading order. `exam-sheet.test.ts` holds both lists still. */
export const EXAM_EXPORT_FIELDS: ExamField[] = [
  'studentName',
  'taxNumber',
  'birthDate',
  'examinedOn',
  'result',
  'validUntil',
];

export type ExamResult = 'fit' | 'fit_with_conditions' | 'unfit';

/** The result as the export writes it — the Portuguese word, in either locale. */
export const RESULT_EXPORT_WORD: Record<ExamResult, string> = {
  fit: 'Apto',
  fit_with_conditions: 'Apto condicionalmente',
  unfit: 'Não apto',
};

function normal(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const RESULT_WORDS: [ExamResult, string[]][] = [
  ['unfit', ['nao apto', 'inapto', 'nao apta', 'inapta', 'unfit', 'not fit', 'unfit to compete']],
  [
    'fit_with_conditions',
    [
      'apto condicionalmente',
      'apta condicionalmente',
      'apto condicional',
      'apto com condicoes',
      'apto com restricoes',
      'condicionado',
      'condicional',
      'fit with conditions',
      'conditionally fit',
      'fit with restrictions',
    ],
  ],
  ['fit', ['apto', 'apta', 'fit']],
];

/**
 * A result cell, in either language or as the enum's own spelling. Anything
 * else is null, which the API answers as an incomplete row — never a guess.
 */
export function parseExamResult(raw: string): ExamResult | null {
  const value = normal(raw);
  if (value === '') return null;
  const spelled = value.replace(/ /g, '_');
  if (spelled === 'fit' || spelled === 'fit_with_conditions' || spelled === 'unfit') return spelled;
  for (const [result, words] of RESULT_WORDS) {
    if (words.includes(value)) return result;
  }
  return null;
}

function isRealDate(iso: string): boolean {
  const parsed = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso;
}

/**
 * A date cell as `YYYY-MM-DD`, or null. ISO first (what the export and a date
 * cell read through `readSheet` both are), then day first — `03/04/2015` is the
 * third of April, as the register's importer reads it. A two-digit year is
 * refused rather than guessed.
 */
export function parseExamDate(raw: string): string | null {
  const value = raw.trim();
  if (value === '') return null;
  const iso = /^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$/.exec(value)?.[1];
  if (iso !== undefined) return isRealDate(iso) ? iso : null;
  const written = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(value);
  if (written !== null) {
    const composed = `${written[3]}-${(written[2] ?? '').padStart(2, '0')}-${(written[1] ?? '').padStart(2, '0')}`;
    return isRealDate(composed) ? composed : null;
  }
  return null;
}

/** What one row sends to `POST /medical-exams/import`. */
export interface ExamImportRow {
  studentName: string;
  taxNumber: string | null;
  birthDate: string | null;
  examinedOn: string | null;
  result: ExamResult | null;
  validUntil: string | null;
}

/** One row, mapped and normalised — exactly the shape the API expects. */
export function applyExamMapping(row: string[], mapping: ExamMapping): ExamImportRow {
  const cell = (field: ExamField): string => {
    const at = mapping[field];
    return at === null ? '' : (row[at] ?? '').trim();
  };
  const nif = cell('taxNumber').replace(/\s+/g, '');
  return {
    studentName: cell('studentName'),
    taxNumber: nif === '' ? null : nif,
    birthDate: parseExamDate(cell('birthDate')),
    examinedOn: parseExamDate(cell('examinedOn')),
    result: parseExamResult(cell('result')),
    validUntil: parseExamDate(cell('validUntil')),
  };
}

/**
 * A row that carries no exam at all — the export's line for a student who has
 * none. Nothing to import and nothing wrong, so the preview says so quietly
 * rather than listing it as a refusal.
 */
export function carriesNoExam(row: string[], mapping: ExamMapping): boolean {
  const empty = (field: ExamField): boolean => {
    const at = mapping[field];
    return at === null || (row[at] ?? '').trim() === '';
  };
  return empty('examinedOn') && empty('result') && empty('validUntil');
}
