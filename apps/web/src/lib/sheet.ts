/**
 * Slice 1.10 — turning somebody's spreadsheet into a grid, and guessing what
 * its columns mean.
 *
 * Everything here is pure and runs in either half of the app. Reading a `.xlsx`
 * needs a library and a Node buffer and so lives in `read-sheet.ts`, which is
 * server-only; this file is the part with the rules in it, and the part worth
 * testing.
 *
 * Two things it does:
 *
 * - **CSV, with the delimiter sniffed.** Portuguese Excel writes `;` because the
 *   comma is the decimal separator. A parser that assumes `,` reads a Portuguese
 *   export as one enormous column, which looks exactly like a corrupt file to
 *   the person who just exported it.
 * - **A first guess at the mapping.** Guessing is a convenience, never a
 *   decision: every guess is shown as a correctable control, and a column it
 *   cannot place is left unmapped rather than attached to whatever was nearest.
 */

/**
 * The fields a column can be pointed at.
 *
 * The API has this list too, and it is the authority — it drops keys it does not
 * know. Repeated here rather than shared because the web app and the API share
 * no code package, and the failure mode of the copies drifting is a column that
 * is ignored, not a column that is written to the wrong place.
 */
export const IMPORT_FIELDS = [
  'fullName',
  'firstName',
  'lastName',
  'birthDate',
  'levelName',
  'contactEmail',
  'contactPhone',
  'taxNumber',
  'notes',
  'guardianName',
  'guardianRelationship',
  'guardianPhone',
  'guardianEmail',
  'guardianTaxNumber',
  'isSocio',
  'socioNumber',
  'gender',
  'isPaid',
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

/** A parsed file: the header row, and everything under it. */
export interface Sheet {
  headers: string[];
  rows: string[][];
}

/**
 * One sheet of a workbook, with the tab's own name.
 *
 * A club's file is very often a tab per turma, or a page of instructions in
 * front of the register. Reading only the first one meant a perfectly good file
 * came back as "no rows with data", so every sheet is read and the operator
 * says which is the register. A CSV is one sheet named after the file, so the
 * two formats present the same shape.
 */
export interface NamedSheet extends Sheet {
  name: string;
}

/** Field to column index, or null where nothing is mapped. */
export type Mapping = Record<ImportField, number | null>;

export const EMPTY_MAPPING: Mapping = {
  fullName: null,
  firstName: null,
  lastName: null,
  birthDate: null,
  levelName: null,
  contactEmail: null,
  contactPhone: null,
  taxNumber: null,
  notes: null,
  guardianName: null,
  guardianRelationship: null,
  guardianPhone: null,
  guardianEmail: null,
  guardianTaxNumber: null,
  isSocio: null,
  socioNumber: null,
  gender: null,
  isPaid: null,
};

/**
 * The same normalisation the API uses on level names: accents and case removed.
 *
 * A header reading "Data de Nascimento" and one reading "DATA NASCIMENTO" are
 * the same header, and a Portuguese spreadsheet will contain either.
 */
function key(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * The delimiter this file is actually using.
 *
 * Counted outside quotes on the header line only: a quoted field may contain any
 * of them, and the header is the line least likely to be quoted at all. Ties go
 * to the semicolon, because that is what Excel writes in a Portuguese locale and
 * this product's first customers are Portuguese.
 */
function sniffDelimiter(line: string): string {
  const counts = { ';': 0, ',': 0, '\t': 0 };
  let quoted = false;

  for (const character of line) {
    if (character === '"') quoted = !quoted;
    else if (!quoted && character in counts) counts[character as keyof typeof counts] += 1;
  }

  const best = (Object.entries(counts) as [string, number][]).reduce(
    (winner, entry) => (entry[1] > winner[1] ? entry : winner),
    [';', 0] as [string, number],
  );
  return best[1] === 0 ? ';' : best[0];
}

/**
 * A CSV, as CSVs actually arrive.
 *
 * Handles quoted fields, doubled quotes inside them, embedded newlines, CRLF and
 * a UTF-8 BOM — which Excel writes and which otherwise turns the first header
 * into something that matches nothing, silently.
 *
 * Written here rather than pulled in because the parsing is forty lines and the
 * delimiter sniffing above is the part that actually matters for pt-PT files;
 * a library would need configuring for that anyway.
 */
export function parseCsv(input: string): Sheet {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? undefined : text.indexOf('\n'));
  const delimiter = sniffDelimiter(firstLine);

  const grid: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    grid.push(row);
    row = [];
  };

  for (let at = 0; at < text.length; at += 1) {
    const character = text[at];

    if (quoted) {
      if (character === '"') {
        // A doubled quote is one literal quote; a single one closes the field.
        if (text[at + 1] === '"') {
          field += '"';
          at += 1;
        } else quoted = false;
      } else field += character;
      continue;
    }

    if (character === '"' && field === '') quoted = true;
    else if (character === delimiter) endField();
    else if (character === '\n') endRow();
    else field += character ?? '';
  }

  // Whatever is left when the text runs out, unless it ran out cleanly on a
  // newline — otherwise every file gains a phantom empty last row.
  if (field !== '' || row.length > 0) endRow();

  return toSheet(grid);
}

/**
 * A grid becomes a sheet: first non-empty row is the header, blank rows go.
 *
 * Blank rows are not an edge case. A club spreadsheet has a blank line between
 * the swimmers and the note about who has paid, and importing that line as a
 * nameless student is a refusal the operator has to read and dismiss for no
 * reason.
 */
export function toSheet(grid: string[][]): Sheet {
  const filled = grid.filter((row) => row.some((cell) => cell.trim() !== ''));
  const [headers = [], ...rest] = filled;

  const width = filled.reduce((widest, row) => Math.max(widest, row.length), 0);
  const pad = (row: string[]): string[] =>
    Array.from({ length: width }, (_, at) => (row[at] ?? '').trim());

  return { headers: pad(headers), rows: rest.map(pad) };
}

/**
 * The header words each field answers to, in pt-PT and en.
 *
 * Order matters on the second pass: the guardian's columns are tried before the
 * student's, so "Email do encarregado" is not claimed by `contactEmail` for
 * containing the word "email".
 */
const SYNONYMS: [ImportField, string[]][] = [
  ['guardianRelationship', ['parentesco', 'relacao', 'grau de parentesco', 'relationship']],
  /*
   * Before `guardianName`, deliberately: "NIF do encarregado" contains
   * "encarregado", and the name would otherwise claim the column.
   */
  [
    'guardianTaxNumber',
    ['nif do encarregado', 'nif encarregado', 'contribuinte do encarregado', 'guardian nif'],
  ],
  /*
   * The student's own NIF takes the *bare* forms — "NIF", "Contribuinte".
   *
   * The column sits in the student's row, and every sheet that carries both
   * names the guardian's after them. Guessing wrongly costs one dropdown on the
   * mapping step; guessing nothing costs one dropdown too, so the more useful
   * guess wins. It is listed after the guardian's so that "NIF do encarregado"
   * is claimed by its exact match before this can reach for it.
   */
  /*
   * Género and payment — round 5.
   *
   * Both before the sócio pair, because "género" is unambiguous and "pago" must
   * not be reached for by `isSocio`'s looser forms.
   */
  ['gender', ['genero', 'sexo', 'm f', 'gender', 'sex']],
  ['isPaid', ['pago', 'pagou', 'esta pago', 'mensalidade paga', 'paid', 'is paid']],
  ['socioNumber', ['numero de socio', 'n socio', 'numero socio', 'membership number']],
  ['isSocio', ['socio', 'e socio', 'associado', 'member', 'is member']],
  [
    'taxNumber',
    ['nif do aluno', 'nif aluno', 'nif', 'contribuinte', 'numero de contribuinte', 'tax number', 'student nif'],
  ],
  [
    'guardianPhone',
    [
      'telefone do encarregado',
      'telemovel do encarregado',
      'contacto do encarregado',
      'telefone encarregado',
      'contacto responsavel',
      'guardian phone',
      'parent phone',
    ],
  ],
  [
    'guardianEmail',
    ['email do encarregado', 'email encarregado', 'guardian email', 'parent email'],
  ],
  [
    'guardianName',
    [
      'encarregado de educacao',
      'encarregado',
      'responsavel',
      'nome do encarregado',
      'guardian',
      'parent',
      'parent name',
    ],
  ],
  [
    'birthDate',
    [
      'data de nascimento',
      'data nascimento',
      'nascimento',
      'dt nascimento',
      'birth date',
      'date of birth',
      'birthday',
      'dob',
    ],
  ],
  ['levelName', ['nivel', 'escalao', 'grupo de nivel', 'level', 'class level']],
  ['contactEmail', ['email', 'e mail', 'correio electronico', 'mail']],
  [
    'contactPhone',
    ['telefone', 'telemovel', 'contacto', 'tel', 'tlm', 'phone', 'mobile', 'contact'],
  ],
  ['notes', ['notas', 'observacoes', 'obs', 'notes', 'comments', 'remarks']],
  ['firstName', ['primeiro nome', 'nome proprio', 'first name', 'given name', 'forename']],
  ['lastName', ['apelido', 'apelidos', 'ultimo nome', 'last name', 'surname', 'family name']],
  ['fullName', ['nome completo', 'nome do aluno', 'nome', 'aluno', 'atleta', 'full name', 'name', 'student']],
];

/**
 * How sure the matcher is about one column.
 *
 * The whole point of the mapping step is to stop being a wall of twelve
 * dropdowns. Something has to decide which matches are worth a person's
 * attention, and this is it:
 *
 *   `certain`  the header *is* a name for this field. Shown folded away.
 *   `likely`   the header contains or abbreviates one. Shown folded away, but
 *              counted separately so the summary can be honest about it.
 *   `unsure`   something matched, but not enough to act on quietly. Asked.
 *
 * Only `unsure` and unmatched columns become questions. A screen that asks about
 * everything is a screen people click through without reading, which is worse
 * than not asking.
 */
export type MatchConfidence = 'certain' | 'likely' | 'unsure';

export interface ColumnMatch {
  field: ImportField;
  column: number;
  confidence: MatchConfidence;
  /** Machine key for why, so the interface can say it in either language. */
  reason: 'exact' | 'contains' | 'abbreviation' | 'shape' | 'agent';
}

export interface MatchResult {
  mapping: Mapping;
  matches: ColumnMatch[];
  /** Columns nothing claimed, by index. These are offered as questions. */
  unmatched: number[];
}

/**
 * What a column's values look like — never what they are.
 *
 * This exists so a header nobody can read ("Contacto 1", "Coluna B") can still
 * be placed: a column of nine digits beside a column with "@" in it tells you
 * most of what a person would work out by glancing at the sheet.
 *
 * **It is deliberately a description, not a sample.** These shapes are also what
 * gets sent to the model when the heuristic gives up, and a register of
 * children's names and telephone numbers is not something to hand to an API to
 * save somebody a dropdown. "9 digits" carries the signal; "912345678" carries a
 * child's mother's phone number.
 */
export interface ColumnShape {
  index: number;
  header: string;
  /** Rough percentage of rows with anything in them. */
  filled: number;
  /** How repetitive the column is — a level repeats, a name does not. */
  repeats: boolean;
  /** The dominant shapes, most common first: 'email', 'date', '9 digits', … */
  looks: string[];
}

function shapeOf(value: string): string | null {
  const text = value.trim();
  if (text === '') return null;
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)) return 'email';
  if (/^\d{4}-\d{2}-\d{2}/.test(text) || /^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$/.test(text)) {
    return 'date';
  }

  const digits = text.replace(/[\s.\-+()]/g, '');
  if (/^\d+$/.test(digits)) return `${digits.length} digits`;

  const words = text.split(/\s+/).length;
  return words === 1 ? 'one word' : `${Math.min(words, 4)} words`;
}

/** The shape of every column, computed once per sheet. */
export function describeColumns(sheet: Sheet): ColumnShape[] {
  return sheet.headers.map((header, index) => {
    const values = sheet.rows.map((row) => (row[index] ?? '').trim());
    const filled = values.filter((value) => value !== '');

    const counts = new Map<string, number>();
    for (const value of filled) {
      const shape = shapeOf(value);
      if (shape !== null) counts.set(shape, (counts.get(shape) ?? 0) + 1);
    }

    const looks = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([shape]) => shape);

    return {
      index,
      header,
      filled: sheet.rows.length === 0 ? 0 : Math.round((filled.length / sheet.rows.length) * 100),
      // Fewer than half the filled values are distinct: a lookup, not an identity.
      repeats: filled.length > 3 && new Set(filled).size * 2 <= filled.length,
      looks,
    };
  });
}

/**
 * The fields a shape alone may place, with no help from the header.
 *
 * Only the student's own email. A column of addresses under an unreadable
 * heading is far more likely to be the family's one contact than specifically
 * the guardian's — a sheet that separates the two always labels which is which.
 * Guessing "guardian" here would quietly file every student's address under
 * somebody else.
 */
const SHAPE_ONLY: ImportField[] = ['contactEmail'];

/** What each field's values should look like, for confirming or contradicting a guess. */
const EXPECTED_SHAPE: Partial<Record<ImportField, (looks: string[]) => boolean>> = {
  contactEmail: (looks) => looks.includes('email'),
  guardianEmail: (looks) => looks.includes('email'),
  birthDate: (looks) => looks.includes('date'),
  contactPhone: (looks) => looks.some((shape) => /^(9|10|11|12|13) digits$/.test(shape)),
  guardianPhone: (looks) => looks.some((shape) => /^(9|10|11|12|13) digits$/.test(shape)),
  taxNumber: (looks) => looks.includes('9 digits'),
  guardianTaxNumber: (looks) => looks.includes('9 digits'),
};

const tokens = (value: string): string[] => key(value).split(' ').filter(Boolean);

/**
 * Whether every word of the header is at least the start of a word in the
 * synonym — "enc educacao" against "encarregado de educacao", "dt nasc" against
 * "data de nascimento", "tlm" against "telemovel".
 *
 * Abbreviation is how club spreadsheets are actually written, and it is the
 * single biggest source of columns the old exact-then-substring matcher left for
 * a person to place by hand.
 */
function abbreviates(header: string, synonym: string): boolean {
  const headerWords = tokens(header);
  const synonymWords = tokens(synonym);
  if (headerWords.length === 0 || headerWords.length > synonymWords.length) return false;

  let at = 0;
  for (const word of headerWords) {
    // Three letters before an abbreviation is believed: "a" prefixes half the
    // dictionary, and a one-letter match is noise wearing a match's clothes.
    const found = synonymWords.findIndex(
      (candidate, index) =>
        index >= at && (candidate === word || (word.length >= 3 && candidate.startsWith(word))),
    );
    if (found === -1) return false;
    at = found + 1;
  }
  return true;
}

/** A whole-word containment test, so "nif" does not match "nifty". */
function containsWord(header: string, synonym: string): boolean {
  return ` ${header} `.includes(` ${synonym} `);
}

interface Candidate {
  field: ImportField;
  column: number;
  score: number;
  reason: ColumnMatch['reason'];
}

function scoreOne(
  field: ImportField,
  synonyms: string[],
  shape: ColumnShape,
): Candidate | null {
  const header = key(shape.header);
  if (header === '') return null;

  /*
   * Plain variables rather than a closure over a nullable.
   *
   * TypeScript's control flow does not follow an assignment made inside a
   * callback, so the tidier `consider()` helper left every later read narrowed
   * to `never`. Two locals and an explicit sentinel are duller and compile.
   */
  let score = 0;
  let reason: ColumnMatch['reason'] = 'exact';

  for (const synonym of synonyms) {
    let candidate = 0;
    let how: ColumnMatch['reason'] = 'exact';

    if (header === synonym) {
      candidate = 100;
      how = 'exact';
    } else if (containsWord(header, synonym)) {
      candidate = 72;
      how = 'contains';
    } else if (abbreviates(header, synonym)) {
      candidate = 58;
      how = 'abbreviation';
    }

    if (candidate > score) {
      score = candidate;
      reason = how;
    }
  }

  const expected = EXPECTED_SHAPE[field];
  if (expected !== undefined && shape.looks.length > 0) {
    if (expected(shape.looks)) {
      if (score > 0) {
        // Agreement nudges a guess up; it never invents one on its own except
        // where the shape is genuinely distinctive.
        score = Math.min(score + 12, 100);
      } else if (shape.looks.includes('email') && SHAPE_ONLY.includes(field)) {
        // An email column is an email column whatever the heading says.
        score = 42;
        reason = 'shape';
      }
    } else if (score > 0) {
      /*
       * The header says phone and the column holds dates. Trust the values.
       *
       * This applies to an *exact* header match too, and deliberately: a column
       * headed "Telefone" full of dates means the sheet is mislabelled or its
       * headers have shifted by one, and both are worth a question. The penalty
       * is sized to drop even a perfect header match into `unsure`, which is the
       * band the screen asks about.
       */
      score -= 45;
    }
  }

  if (score <= 0) return null;
  return { field, column: shape.index, score, reason };
}

function confidenceOf(score: number): MatchConfidence | null {
  if (score >= 90) return 'certain';
  if (score >= 65) return 'likely';
  if (score >= 40) return 'unsure';
  return null;
}

/**
 * Which column is which, with how sure it is about each.
 *
 * Every (field, column) pair is scored and the best ones are taken first, rather
 * than the old first-come-first-served walk down a synonym list. That ordering
 * mattered: it is what let a weak match on an early field claim a column that a
 * later field matched exactly.
 *
 * Anything it cannot place is left null and offered as a question. An unmapped
 * column costs one dropdown; a wrongly mapped one costs a hundred bad rows.
 */
export function matchColumns(sheet: Sheet): MatchResult {
  const shapes = describeColumns(sheet);

  const candidates: Candidate[] = [];
  for (const [field, synonyms] of SYNONYMS) {
    for (const shape of shapes) {
      const candidate = scoreOne(field, synonyms, shape);
      if (candidate !== null) candidates.push(candidate);
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const mapping: Mapping = { ...EMPTY_MAPPING };
  const matches: ColumnMatch[] = [];
  const usedColumns = new Set<number>();

  for (const candidate of candidates) {
    const confidence = confidenceOf(candidate.score);
    if (confidence === null) continue;
    if (mapping[candidate.field] !== null || usedColumns.has(candidate.column)) continue;

    mapping[candidate.field] = candidate.column;
    usedColumns.add(candidate.column);
    matches.push({
      field: candidate.field,
      column: candidate.column,
      confidence,
      reason: candidate.reason,
    });
  }

  /*
   * A sheet with "Nome" and "Apelido" has both halves already, and the API
   * ignores `fullName` when `firstName` is present — so showing it as mapped
   * would claim a column that is not read.
   */
  if (mapping.firstName !== null && mapping.fullName !== null) {
    const column = mapping.fullName;
    mapping.fullName = null;
    const at = matches.findIndex((match) => match.field === 'fullName');
    if (at !== -1) matches.splice(at, 1);
    usedColumns.delete(column);
  }

  const unmatched = shapes
    .filter((shape) => shape.header !== '' && !usedColumns.has(shape.index))
    .map((shape) => shape.index);

  return { mapping, matches, unmatched };
}

/** Just the mapping, for callers that do not care how sure it was. */
export function guessMapping(headers: string[]): Mapping {
  return matchColumns({ headers, rows: [] }).mapping;
}

/** One row, keyed by field name — exactly what the API's `rows` expects. */
export function applyMapping(row: string[], mapping: Mapping): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const field of IMPORT_FIELDS) {
    const at = mapping[field];
    if (at === null) continue;
    const value = (row[at] ?? '').trim();
    if (value !== '') mapped[field] = value;
  }
  return mapped;
}

/**
 * The columns an export writes, in the order a person reads them — slice 1.11.
 *
 * It lives here, beside `guessMapping`, because it is one half of a contract
 * with the other: **what the exporter writes, the importer must read back.** The
 * header row of an exported file is `students.import.field.*` from the
 * catalogue — the very labels the mapping step shows — so a club can export,
 * edit in Excel and import the result without touching a single dropdown.
 *
 * `sheet.test.ts` asserts that round trip against the real catalogue in both
 * locales, which is what stops somebody renaming a label and silently breaking
 * it.
 *
 * `firstName` and `lastName` rather than `fullName`, so nothing is guessed on
 * the way back: splitting "Maria Santos Silva" is a heuristic, and both parts
 * are already known at export time.
 */
export const EXPORT_FIELDS: ImportField[] = [
  'firstName',
  'lastName',
  'birthDate',
  'levelName',
  'contactEmail',
  'contactPhone',
  'taxNumber',
  'notes',
  'guardianName',
  'guardianRelationship',
  'guardianPhone',
  'guardianEmail',
  'guardianTaxNumber',
  'isSocio',
  'socioNumber',
  'gender',
  'isPaid',
];

/** Whether enough is mapped to mean anything: a name, in one form or the other. */
export function hasName(mapping: Mapping): boolean {
  return mapping.firstName !== null || mapping.fullName !== null;
}
