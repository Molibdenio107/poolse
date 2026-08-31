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
  'notes',
  'guardianName',
  'guardianRelationship',
  'guardianPhone',
  'guardianEmail',
  'guardianTaxNumber',
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

/** A parsed file: the header row, and everything under it. */
export interface Sheet {
  headers: string[];
  rows: string[][];
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
  notes: null,
  guardianName: null,
  guardianRelationship: null,
  guardianPhone: null,
  guardianEmail: null,
  guardianTaxNumber: null,
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
    [
      'nif do encarregado',
      'nif encarregado',
      'contribuinte',
      'numero de contribuinte',
      'nif',
      'guardian nif',
      'tax number',
    ],
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
 * A first guess at which column is which.
 *
 * Two passes, both refusing to claim a column twice. An exact header match is
 * trusted everywhere; only then does a header that merely *contains* a known
 * word get considered, because "Nome do encarregado" contains "nome" and reading
 * it as the student's name would import a register of parents.
 *
 * Anything it cannot place stays null. An unmapped column is a question the
 * operator answers in one click; a wrongly mapped one is a hundred bad rows.
 */
export function guessMapping(headers: string[]): Mapping {
  const mapping: Mapping = { ...EMPTY_MAPPING };
  const keys = headers.map(key);
  const claimed = new Set<number>();

  const take = (field: ImportField, matches: (header: string, word: string) => boolean): void => {
    for (const [candidate, words] of SYNONYMS) {
      if (candidate !== field) continue;
      for (const word of words) {
        const at = keys.findIndex(
          (header, index) => !claimed.has(index) && header !== '' && matches(header, word),
        );
        if (at !== -1) {
          mapping[field] = at;
          claimed.add(at);
          return;
        }
      }
    }
  };

  for (const [field] of SYNONYMS) take(field, (header, word) => header === word);
  for (const [field] of SYNONYMS) {
    if (mapping[field] === null) take(field, (header, word) => header.includes(word));
  }

  /*
   * A sheet with "Nome" and "Apelido" has both halves already, and the whole-name
   * column would then be read *instead* of nothing — the API ignores `fullName`
   * when `firstName` is present, but showing it as mapped implies it is used.
   */
  if (mapping.firstName !== null && mapping.fullName !== null) {
    mapping.fullName = null;
  }

  return mapping;
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

/** Whether enough is mapped to mean anything: a name, in one form or the other. */
export function hasName(mapping: Mapping): boolean {
  return mapping.firstName !== null || mapping.fullName !== null;
}
