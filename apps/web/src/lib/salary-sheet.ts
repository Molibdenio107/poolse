// The `.ts` on the specifier is not a slip: this module is reached by
// `node --test`, whose resolver does not add extensions. `partner-sheet.ts` and
// `inventory-sheet.ts` carry one for the same reason.
import { looksNumeric, matchFields, type MatchResult, type MatchSpec, type Sheet } from './sheet.ts';

/**
 * The salaries importer's vocabulary — POOLSE-59.
 *
 * The sixth sibling of `sheet.ts`, after the register's, the inventory's, the
 * timetable's, the water log's and the partnerships'. They share the scoring,
 * the abbreviation rule and the shape check — `matchFields` — and share none of
 * the words: "Nome" is a child on one sheet, a pile of pranchas on another, a
 * school on a third and a colleague here.
 *
 * **A person is matched by email or by NIF, never by name.** The name column is
 * carried so the preview is legible and so an exported file reads like a pay
 * list rather than a table of ids — it is never a key. Two people called Ana
 * Silva is not an edge case in a club with forty staff, and matching them by
 * name would put one of them on the other's salary.
 *
 * **The export writes the contract, not the derived figures.** *Mensal* and *Por
 * hora* are columns on the screen and are absent from this list, because one of
 * the two is always an estimate computed from the other — re-importing an
 * estimate as an amount would turn a rounding into a pay rise. What leaves and
 * comes back is what somebody agreed: the type, the gross amount, the contracted
 * hours, the pay periods and the date it starts.
 */

export const SALARY_FIELDS = [
  'name',
  'email',
  'taxNumber',
  'kind',
  'amount',
  'weeklyHours',
  'payPeriods',
  'effectiveFrom',
  'provenance',
  'note',
] as const;

export type SalaryField = (typeof SALARY_FIELDS)[number];

export type SalaryMapping = Record<SalaryField, number | null>;

export const EMPTY_SALARY_MAPPING: SalaryMapping = {
  name: null,
  email: null,
  taxNumber: null,
  kind: null,
  amount: null,
  weeklyHours: null,
  payPeriods: null,
  effectiveFrom: null,
  provenance: null,
  note: null,
};

/**
 * The header words each field answers to, in pt-PT and en.
 *
 * **The difficulty here is the three numeric columns**, not two names: an
 * amount, a count of hours and a count of months are all digits, and a club's
 * own sheet labels them "Vencimento", "Horas" and "Meses" in whatever order it
 * pleases. They are separated by words rather than by shape — the shape check
 * only confirms — because getting them the wrong way round writes a wage of €14
 * and a contract of 1,200 hours a week, which is a mistake nobody would think to
 * look for.
 *
 * `amount` deliberately does **not** answer to "mensal" or "monthly": those are
 * what the *type* column says in its cells, and a heading claimed by the wrong
 * one of a pair is how the register's own list got its longest comment.
 */
const SYNONYMS: [SalaryField, string[]][] = [
  [
    'name',
    [
      'nome',
      'colaborador',
      'colaboradora',
      'funcionario',
      'funcionário',
      'pessoa',
      'staff',
      'name',
      'employee',
      'person',
      'full name',
    ],
  ],
  ['email', ['email', 'e-mail', 'correio eletronico', 'correio eletrónico', 'mail', 'endereco', 'endereço']],
  [
    'taxNumber',
    ['nif', 'contribuinte', 'nº contribuinte', 'numero de contribuinte', 'número de contribuinte', 'nif/vat', 'tax number', 'vat', 'tax id'],
  ],
  [
    'kind',
    ['tipo', 'tipo de contrato', 'contrato', 'regime', 'type', 'contract', 'contract type', 'kind'],
  ],
  [
    'amount',
    [
      'valor bruto',
      'valor',
      'vencimento',
      'salario',
      'salário',
      'ordenado',
      'remuneracao',
      'remuneração',
      'bruto',
      'montante',
      'amount',
      'gross amount',
      'gross',
      'salary',
      'wage',
      'rate',
      'pay',
    ],
  ],
  [
    'weeklyHours',
    [
      'horas semanais',
      'horas',
      'horas/semana',
      'horas por semana',
      'carga horaria',
      'carga horária',
      'weekly hours',
      'hours',
      'hours per week',
      'contracted hours',
    ],
  ],
  [
    'payPeriods',
    [
      'meses de vencimento',
      'meses',
      'subsidios',
      'subsídios',
      'periodos',
      'períodos',
      'pay periods',
      'pay periods per year',
      'periods',
      'months',
    ],
  ],
  [
    'effectiveFrom',
    [
      'em vigor desde',
      'desde',
      'inicio',
      'início',
      'data de inicio',
      'data de início',
      'data',
      'effective since',
      'effective from',
      'since',
      'start date',
      'from',
      'date',
    ],
  ],
  /*
   * Where the figure came from — `docs/financials.md` §2.
   *
   * Rarely a column in a club's own sheet, and always one in ours: an export
   * that dropped it would re-import an owner's estimate as a contracted wage,
   * which is the one thing the financial rules exist to prevent. Absent means
   * `contracted`, which is what a typed rate is.
   */
  [
    'provenance',
    ['proveniencia', 'proveniência', 'origem', 'fonte', 'provenance', 'source', 'origin'],
  ],
  ['note', ['nota', 'notas', 'observacoes', 'observações', 'comentario', 'comentário', 'note', 'notes', 'comment', 'remarks']],
];

/**
 * What each field's values should look like, for confirming or contradicting.
 *
 * The three numeric columns, because a column headed "Vencimento" full of words
 * is a sheet whose headers have shifted; and the email, because an address is
 * unmistakable and a column of them is worth recognising whatever somebody
 * called it. The NIF is deliberately **not** shape-matched: nine digits is also
 * what a telephone number looks like in Portugal, and claiming a phone column as
 * a tax number would match people to the wrong person rather than to nobody.
 */
const EXPECTED_SHAPE: Partial<Record<SalaryField, (looks: string[]) => boolean>> = {
  amount: looksNumeric,
  weeklyHours: looksNumeric,
  payPeriods: looksNumeric,
  email: (looks) => looks.includes('email'),
};

/** An address is an address whatever the heading says. */
const SHAPE_ONLY: readonly SalaryField[] = ['email'];

export const SALARY_MATCH: MatchSpec<SalaryField> = {
  empty: EMPTY_SALARY_MAPPING,
  synonyms: SYNONYMS,
  expectedShape: EXPECTED_SHAPE,
  shapeOnly: SHAPE_ONLY,
};

/** Which column is which, with how sure it is about each. */
export function matchSalaryColumns(sheet: Sheet): MatchResult<SalaryField> {
  return matchFields(sheet, SALARY_MATCH);
}

/** One row, keyed by field name — exactly what the API's `rows` expects. */
export function applySalaryMapping(
  row: string[],
  mapping: SalaryMapping,
): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const field of SALARY_FIELDS) {
    const at = mapping[field];
    if (at === null) continue;
    const value = (row[at] ?? '').trim();
    if (value !== '') mapped[field] = value;
  }
  return mapped;
}

/**
 * Enough to import anything at all.
 *
 * A key and an amount. Without a key there is nobody to pay; without an amount
 * there is nothing to record — and a file with neither column mapped is a file
 * whose preview would be forty rows of the same complaint.
 *
 * Either key will do, which is the point of having two: a club that keeps NIFs
 * and no work addresses can still import, and so can one with the reverse.
 */
export function hasKeyAndAmount(mapping: SalaryMapping): boolean {
  return (mapping.email !== null || mapping.taxNumber !== null) && mapping.amount !== null;
}

/**
 * The columns an export writes, in the order a person reads them.
 *
 * The other half of a contract with `SYNONYMS` above: **what the exporter
 * writes, the matcher must read back.** The header row of an exported file is
 * `salaries.field.*` straight out of the catalogue — the very labels the mapping
 * step shows — so a club can export the pay list in December, apply the year's
 * rise in the column it already has, and import the file again without touching
 * a dropdown.
 *
 * Written out rather than derived from `SALARY_FIELDS`: the field list is a
 * vocabulary and this is a reading order, and they are free to diverge the day
 * somebody adds a field that belongs at the end of the sheet but not at the end
 * of the mapping step. `salary-sheet.test.ts` holds both halves still.
 */
export const SALARY_EXPORT_FIELDS: SalaryField[] = [
  'name',
  'email',
  'taxNumber',
  'kind',
  'amount',
  'weeklyHours',
  'payPeriods',
  'effectiveFrom',
  /*
   * Carried, so an estimate survives the journey. The three-point *range* is
   * deliberately not: it belongs to a figure nobody has pinned down, the sheet
   * is a list of contracts, and two more columns of blanks on every export is
   * noise. A round trip still changes nothing — an unedited row is not rewritten
   * — and an edited one loses its bounds, which is written down rather than
   * discovered.
   */
  'provenance',
  'note',
];
