// The `.ts` on the specifier is not a slip: this module is reached by
// `node --test`, whose resolver does not add extensions. `inventory-sheet.ts`
// and `booking-sheet.ts` carry one for the same reason.
import { matchFields, type MatchResult, type MatchSpec, type Sheet } from './sheet.ts';

/**
 * The partnerships importer's vocabulary — POOLSE-48.
 *
 * The fourth sibling of `sheet.ts`, after the register's, the inventory's and
 * the timetable's. They share the scoring, the abbreviation rule and the shape
 * check — `matchFields` — and share none of the words, because "Nome" means a
 * child on one sheet, a pile of pranchas on another and a school here.
 *
 * **One row is one group, not one partner**, and that is the thing this file
 * exists to make possible. A school's sheet has a row per class with the school
 * name repeating down the column:
 *
 *     Escola              Turma      Alunos
 *     ES D. Dinis         6A         24
 *     ES D. Dinis         6B         22
 *     ES D. Dinis         10G 11B    27
 *
 * Three rows, one partner, three groups. On the register a repeated name is a
 * duplicate to warn about; here it is the normal case, and reading it the
 * register's way would produce three schools called the same thing.
 */

export const PARTNER_FIELDS = [
  'partnerName',
  'partnerType',
  'groupName',
  'participantCount',
  'levelName',
  'tag',
  'ownInstructorName',
  'contactName',
  'contactEmail',
  'contactPhone',
  'notes',
] as const;

export type PartnerField = (typeof PARTNER_FIELDS)[number];

export type PartnerMapping = Record<PartnerField, number | null>;

export const EMPTY_PARTNER_MAPPING: PartnerMapping = {
  partnerName: null,
  partnerType: null,
  groupName: null,
  participantCount: null,
  levelName: null,
  tag: null,
  ownInstructorName: null,
  contactName: null,
  contactEmail: null,
  contactPhone: null,
  notes: null,
};

/**
 * The header words each field answers to, in pt-PT and en.
 *
 * **The two name columns are the whole difficulty**, and they are the same
 * difficulty the register has between a child and their guardian: `partnerName`
 * and `groupName` are both "nome" to somebody in a hurry, and getting them the
 * wrong way round imports a list of classes as a list of schools.
 *
 * They are separated by the words a club actually types. A partner is the
 * *entity* — escola, agrupamento, entidade, instituição — and a group is the
 * *class* — turma, ano, grupo. `partnerName` deliberately claims the bare
 * "nome", because a sheet with one name column and a headcount beside it is a
 * sheet listing whose classes these are.
 *
 * `contactName` is listed after both, and answers only to headings that say
 * contact or responsável — never to a bare "nome", which would take the column
 * out from under the partner on a sheet that has one.
 */
const SYNONYMS: [PartnerField, string[]][] = [
  [
    'partnerName',
    [
      'nome',
      'parceria',
      'parceiro',
      'entidade',
      'escola',
      'agrupamento',
      'instituicao',
      'instituição',
      'organizacao',
      'organização',
      'cliente',
      'partner',
      'organisation',
      'organization',
      'school',
      'client',
    ],
  ],
  [
    'partnerType',
    ['tipo', 'tipo de entidade', 'tipo de parceria', 'natureza', 'type', 'kind', 'partner type'],
  ],
  [
    'groupName',
    [
      'turma',
      'grupo',
      'classe',
      'ano',
      'nome da turma',
      'nome do grupo',
      'group',
      'class',
      'group name',
      'form',
    ],
  ],
  [
    'participantCount',
    [
      'alunos',
      'n de alunos',
      'numero de alunos',
      'número de alunos',
      'participantes',
      'inscritos',
      'quantidade',
      'qtd',
      'total',
      'headcount',
      'participants',
      'pupils',
      'students',
      'count',
    ],
  ],
  ['levelName', ['nivel', 'nível', 'escalao', 'escalão', 'level', 'grade']],
  ['tag', ['tag', 'etiqueta', 'marcador', 'programa', 'de', 'desporto escolar', 'label']],
  [
    'ownInstructorName',
    [
      'professor',
      'professor da entidade',
      'professor responsavel',
      'professor responsável',
      'docente',
      'monitor',
      'tecnico',
      'técnico',
      'instructor',
      'teacher',
      'own instructor',
    ],
  ],
  [
    'contactName',
    [
      'contacto',
      'nome do contacto',
      'responsavel',
      'responsável',
      'coordenador',
      'coordenadora',
      'contact',
      'contact name',
      'coordinator',
    ],
  ],
  ['contactEmail', ['email', 'e-mail', 'correio electronico', 'correio eletrónico', 'mail']],
  [
    'contactPhone',
    ['telefone', 'telemovel', 'telemóvel', 'contacto telefonico', 'tlf', 'tlm', 'phone', 'mobile'],
  ],
  ['notes', ['notas', 'observacoes', 'observações', 'obs', 'notes', 'remarks', 'comments']],
];

/**
 * What a column's values should look like, for confirming or contradicting.
 *
 * The count, because a column headed "Alunos" full of words is a sheet whose
 * headers have shifted and would otherwise import forty classes of nobody; and
 * the email, because an address is unmistakable and a column of them is worth
 * recognising whatever somebody called it.
 */
const EXPECTED_SHAPE: Partial<Record<PartnerField, (looks: string[]) => boolean>> = {
  participantCount: (looks) => looks.some((shape) => /^\d+ digits$/.test(shape)),
  contactEmail: (looks) => looks.includes('email'),
};

/** An address is an address whatever the heading says. */
const SHAPE_ONLY: readonly PartnerField[] = ['contactEmail'];

export const PARTNER_MATCH: MatchSpec<PartnerField> = {
  empty: EMPTY_PARTNER_MAPPING,
  synonyms: SYNONYMS,
  expectedShape: EXPECTED_SHAPE,
  shapeOnly: SHAPE_ONLY,
};

/** Which column is which, with how sure it is about each. */
export function matchPartnerColumns(sheet: Sheet): MatchResult<PartnerField> {
  return matchFields(sheet, PARTNER_MATCH);
}

/** One row, keyed by field name — exactly what the API's `rows` expects. */
export function applyPartnerMapping(
  row: string[],
  mapping: PartnerMapping,
): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const field of PARTNER_FIELDS) {
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
 * Both names, and only both names. The ticket is explicit that a sheet with no
 * headcount column is still worth having — it is the list of which classes come,
 * which is most of what a club wants written down in August.
 */
export function hasPartnerAndGroup(mapping: PartnerMapping): boolean {
  return mapping.partnerName !== null && mapping.groupName !== null;
}
