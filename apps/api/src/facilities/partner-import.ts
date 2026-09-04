/**
 * What an imported partnerships row means, and why it is refused — POOLSE-48.
 *
 * The same shape as `inventory.ts` and `students/import.ts`, and deliberately
 * so: preview and commit are one function called twice, because the failure this
 * feature cannot afford is an operator approving a preview and a different set
 * of rows being written. Everything here is pure — no database, no HTTP, no
 * spreadsheet. The web app reads the file and maps the columns; this is handed
 * rows already keyed by Poolse's field names and says what each resolves to.
 *
 * ---------------------------------------------------------------------------
 * One row is one group. That is the whole design.
 * ---------------------------------------------------------------------------
 *
 * A school's sheet has a row per class and the school's name repeating down the
 * column. Twelve rows across three schools is **three partners with twelve
 * groups**, not twelve partners.
 *
 * This is the opposite of the register, where a repeated name is a duplicate to
 * warn about, and it is what the ticket names as most likely to be got wrong. So
 * the preview is a *tree* rather than a list: partners at the top with their
 * groups nested, and a count that says "3 parcerias, 12 turmas". A flat list of
 * twelve rows each saying "this partner already exists" would be technically
 * true and completely misleading — it would read as twelve problems.
 *
 * A **group** repeated on the same partner is the one that behaves like the
 * inventory: it is a stocktake, reported as an update with the old and new
 * participant counts side by side, unticked by default.
 */

export const PARTNER_IMPORT_FIELDS = [
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

export type PartnerImportField = (typeof PARTNER_IMPORT_FIELDS)[number];

export type RawPartnerRow = Partial<Record<PartnerImportField, string>>;

/** Mirrors the `partner_type` enum. */
export type PartnerType =
  | 'escola'
  | 'agrupamento'
  | 'ipss_misericordia'
  | 'jardim_infancia'
  | 'clube'
  | 'camara'
  | 'empresa'
  | 'outro';

/**
 * What genuinely cannot be written.
 *
 * Short, for the reason the other two importers' lists are short: an importer
 * that refuses a row because the sheet is untidy is an importer that fails most
 * real files. Only the two names are mandatory, and only a count that is not a
 * count can fail on the way in.
 */
export type PartnerProblemCode =
  | 'partnerRequired'
  | 'groupRequired'
  | 'tooLong'
  | 'badCount';

/**
 * Worth saying, never worth refusing over.
 *
 * `unknownType` is the one the ticket calls out: a type nobody recognises
 * imports as `outro` with a warning, because refusing a school over the word in
 * its Tipo column would fail the file for the least important cell in it.
 */
export type PartnerWarningCode =
  | 'unknownType'
  | 'countMissing'
  | 'typeConflict'
  | 'levelNotFound'
  | 'badEmail'
  | 'contactNotReachable';

export interface PartnerProblem {
  field: PartnerImportField;
  code: PartnerProblemCode;
  /** What was in the cell, so the message can quote it back. */
  value?: string;
}

export interface PartnerWarning {
  field: PartnerImportField;
  code: PartnerWarningCode;
  value?: string;
}

/** A field a commit would change on a group the club already has. */
export interface PartnerUpdate {
  field: 'participantCount' | 'tag' | 'ownInstructorName' | 'levelId' | 'notes';
  before: string;
  after: string;
}

export interface PartnerImportRow {
  /** 0-based position among the data rows — the client's stable handle. */
  index: number;
  /** The line in the spreadsheet, counting the header as line 1. */
  line: number;

  partnerName: string;
  partnerType: PartnerType;
  groupName: string;
  participantCount: number;
  levelName: string | null;
  levelId: string | null;
  tag: string | null;
  ownInstructorName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  /**
   * Whether a contact can be written at all — `partner_contact_reachable`.
   *
   * Decided here rather than in the repository, so the preview's warning and the
   * commit's behaviour come from one expression instead of two that can drift.
   */
  contactReachable: boolean;
  notes: string | null;

  /** The partner this row belongs to, as `partnerKey` computes it. */
  partnerKey: string;
  /** The id when the club already has this partner at the site being imported into. */
  partnerId: string | null;
  /** The id when it already has this group on that partner. */
  groupId: string | null;

  problems: PartnerProblem[];
  warnings: PartnerWarning[];
  /** What a commit would change on an existing group. Empty for a new one. */
  updates: PartnerUpdate[];
  /** True when this row names a group the club already has — a stocktake. */
  existing: boolean;
  /** An earlier row of the same file naming the same group. */
  repeatOfLine: number | null;

  importable: boolean;
}

/**
 * The preview's shape: partners, each with its rows.
 *
 * The tree the ticket asks for. A partner appears once however many rows
 * mentioned it, and `isNew` is what lets the button say how many partnerships a
 * commit would create rather than how many lines the file has.
 */
export interface PartnerGroupTree {
  key: string;
  name: string;
  type: PartnerType;
  /** Null when this partnership does not exist at the site yet. */
  partnerId: string | null;
  isNew: boolean;
  /** Indexes into the flat `rows` array, in file order. */
  rows: number[];
}

export interface PartnerSummary {
  total: number;
  importable: number;
  refused: number;
  /** Partnerships a commit would create. */
  partnersToCreate: number;
  /** Partnerships already at this site that would gain groups. */
  partnersExisting: number;
  /** Groups a commit would create. */
  groupsToCreate: number;
  /** Groups already recorded — stocktakes, unticked by default. */
  groupsExisting: number;
  /** Existing groups a commit would actually change. */
  groupsToUpdate: number;
  flagged: number;
}

/** A partner already at the site, with the groups a row could match. */
export interface ExistingPartner {
  id: string;
  name: string;
  type: PartnerType;
  groups: {
    id: string;
    name: string;
    participantCount: number;
    tag: string | null;
    ownInstructorName: string | null;
    levelId: string | null;
    notes: string | null;
  }[];
}

export interface PartnerImportContext {
  existing: ExistingPartner[];
  /** The organization's levels, so a `Nível` column can resolve to one. */
  levels: { id: string; name: string }[];
}

/**
 * The largest partnerships sheet one import may carry.
 *
 * The inventory's 2 000 rather than the register's 10 000, as the ticket asks: a
 * few hundred groups is already an implausible club, and a partnerships file is
 * a list of classes, not a population.
 */
export const MAX_PARTNER_ROWS = 2_000;

const MAX_NAME = 200;
const MAX_SHORT = 120;
const MAX_NOTES = 500;

/**
 * Exactly what the database's unique index does, and nothing more.
 *
 * `partner_name_uq` and `partner_group_name_uq` are both on
 * `lower(strip_accents(name))` — **accents and case only**. No punctuation
 * flattening, no whitespace collapsing.
 *
 * The first version of this went further and flattened punctuation too, which is
 * the dangerous direction to disagree in. It would have read `11H/I` in a file
 * and a recorded `11H I` as the same class, offered the club a stocktake, and
 * overwritten one class's headcount with another's — or marked a real class as a
 * repeat of an earlier line and silently dropped it. A preview that is *stricter*
 * than the database merely promises to create something the commit then refuses,
 * which is visible; a preview that is looser destroys data quietly.
 *
 * So the rule is: whatever the index does. If the index ever gains a
 * `regexp_replace`, this gains the same one on the same day.
 *
 * The accent handling is a superset — `strip_accents` is a `translate()` over
 * the Latin-1 vowels plus ç and ñ, and NFD covers those and more. For a
 * Portuguese club's names the two agree; a character outside that set would be
 * stripped here and kept there, which errs strict.
 */
export function normaliseKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/**
 * The partner type, read the way a person writes it.
 *
 * Every one of these came from thinking about what a club types into a Tipo
 * column, not from the enum: "IPSS", "Misericórdia" and "Santa Casa" are three
 * words for one row of the enum, and "JI" is what somebody writes when they have
 * forty rows to fill in.
 *
 * Anything unrecognised is `outro` **with a warning** — criterion 6. Refusing a
 * school because nobody recognises the word in its type column would fail the
 * file over its least important cell.
 */
const TYPES: [PartnerType, string[]][] = [
  ['agrupamento', ['agrupamento', 'agrupamento de escolas', 'ae', 'school group']],
  [
    'jardim_infancia',
    ['jardim de infancia', 'jardim infancia', 'ji', 'infantario', 'creche', 'pre escolar', 'nursery', 'kindergarten'],
  ],
  [
    'ipss_misericordia',
    ['ipss', 'misericordia', 'santa casa', 'santa casa da misericordia', 'lar', 'charity'],
  ],
  ['escola', ['escola', 'escola secundaria', 'es', 'colegio', 'externato', 'school', 'college']],
  ['clube', ['clube', 'club', 'associacao desportiva', 'sport club', 'team']],
  ['camara', ['camara', 'camara municipal', 'municipio', 'junta', 'council', 'municipality']],
  ['empresa', ['empresa', 'sociedade', 'lda', 'company', 'business']],
  ['outro', ['outro', 'outra', 'other', 'diverso']],
];

export function readPartnerType(raw: string | null): PartnerType | null {
  if (raw === null) return null;
  const key = normaliseKey(raw);
  if (key === '') return null;

  for (const [type, words] of TYPES) {
    // Exact first, across every type, so "escola" does not win a row that says
    // "agrupamento de escolas" merely by being checked earlier.
    if (words.some((word) => normaliseKey(word) === key)) return type;
  }

  for (const [type, words] of TYPES) {
    if (words.some((word) => key.includes(normaliseKey(word)))) return type;
  }

  return null;
}

/** A cell as a trimmed string, or null when there was nothing in it. */
function cell(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const value = raw.trim();
  return value === '' ? null : value;
}

/**
 * The count, read the way a spreadsheet actually writes one.
 *
 * "24", "24 alunos", "1,0" from a cell Excel decided was a float, " 24 " from a
 * padded column. Lifted from the inventory importer rather than written again,
 * as the ticket asks — the two have exactly the same problem.
 *
 * A blank is zero **with a warning**: a sheet with no headcount column is a list
 * of which classes come, which is worth having, and `participant_count` is
 * `NOT NULL DEFAULT 0` precisely so "not sized yet" is expressible.
 */
function readCount(raw: string | null): { value: number } | { error: 'badCount' } {
  if (raw === null) return { value: 0 };

  const digits = raw.replace(',', '.').match(/-?\d+(\.\d+)?/);
  if (digits === null) return { error: 'badCount' };

  const value = Number(digits[0]);
  if (!Number.isFinite(value) || value < 0) return { error: 'badCount' };

  return { value: Math.floor(value) };
}

/** Good enough to be worth storing; the database has no opinion beyond a length. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface PartnerPreview {
  rows: PartnerImportRow[];
  partners: PartnerGroupTree[];
  summary: PartnerSummary;
}

/**
 * The whole preview, from rows already keyed by field name.
 *
 * Called once for the preview and again for the commit, with the same inputs, so
 * what an operator approved is what gets written.
 */
export function previewPartners(
  raw: RawPartnerRow[],
  context: PartnerImportContext,
): PartnerPreview {
  const partnersByKey = new Map<string, ExistingPartner>();
  for (const partner of context.existing) partnersByKey.set(normaliseKey(partner.name), partner);

  const levelsByKey = new Map<string, { id: string; name: string }>();
  for (const level of context.levels) levelsByKey.set(normaliseKey(level.name), level);

  /** Group key -> the earlier row of this file that already claimed it. */
  const seenGroups = new Map<string, number>();
  /** Partner key -> the tree node, so a partner appears once however many rows. */
  const trees = new Map<string, PartnerGroupTree>();

  const rows: PartnerImportRow[] = raw.map((row, index) =>
    validateRow(row, index, partnersByKey, levelsByKey, seenGroups, trees),
  );

  return { rows, partners: [...trees.values()], summary: summarise(rows, trees) };
}

function validateRow(
  raw: RawPartnerRow,
  index: number,
  partnersByKey: Map<string, ExistingPartner>,
  levelsByKey: Map<string, { id: string; name: string }>,
  seenGroups: Map<string, number>,
  trees: Map<string, PartnerGroupTree>,
): PartnerImportRow {
  const problems: PartnerProblem[] = [];
  const warnings: PartnerWarning[] = [];
  const line = index + 2;

  const partnerName = cell(raw.partnerName) ?? '';
  if (partnerName === '') problems.push({ field: 'partnerName', code: 'partnerRequired' });
  else if (partnerName.length > MAX_NAME) {
    problems.push({ field: 'partnerName', code: 'tooLong', value: partnerName });
  }

  const groupName = cell(raw.groupName) ?? '';
  if (groupName === '') problems.push({ field: 'groupName', code: 'groupRequired' });
  else if (groupName.length > MAX_SHORT) {
    problems.push({ field: 'groupName', code: 'tooLong', value: groupName });
  }

  /*
   * The type — criterion 6.
   *
   * Unrecognised is `outro` and a warning. An absent column is `outro` and
   * silence: a sheet with no Tipo at all has not said anything wrong, and
   * warning on every row of it would be noise on the commonest file there is.
   */
  const rawType = cell(raw.partnerType);
  const read = readPartnerType(rawType);
  const partnerType: PartnerType = read ?? 'outro';
  if (rawType !== null && read === null) {
    warnings.push({ field: 'partnerType', code: 'unknownType', value: rawType });
  }

  const rawCount = cell(raw.participantCount);
  const count = readCount(rawCount);
  if ('error' in count) {
    problems.push({ field: 'participantCount', code: 'badCount', value: rawCount ?? '' });
  } else if (rawCount === null) {
    warnings.push({ field: 'participantCount', code: 'countMissing' });
  }

  const levelName = cell(raw.levelName);
  const level = levelName === null ? undefined : levelsByKey.get(normaliseKey(levelName));
  if (levelName !== null && level === undefined) {
    // A level that matches nothing is last year's name or a typo. The group is
    // still imported — the level is a suggestion, not a constraint — but
    // silently dropping it would leave somebody wondering where it went.
    warnings.push({ field: 'levelName', code: 'levelNotFound', value: levelName });
  }

  const contactEmail = cell(raw.contactEmail);
  if (contactEmail !== null && !LOOKS_LIKE_EMAIL.test(contactEmail)) {
    warnings.push({ field: 'contactEmail', code: 'badEmail', value: contactEmail });
  }

  const tag = trim(cell(raw.tag), MAX_SHORT, 'tag', problems);
  const ownInstructorName = trim(
    cell(raw.ownInstructorName),
    MAX_SHORT,
    'ownInstructorName',
    problems,
  );
  const contactName = trim(cell(raw.contactName), MAX_SHORT, 'contactName', problems);
  const contactPhone = trim(cell(raw.contactPhone), 40, 'contactPhone', problems);
  const notes = trim(cell(raw.notes), MAX_NOTES, 'notes', problems);

  /*
   * A contact needs a way to be reached — `partner_contact_reachable`.
   *
   * The database refuses a contact carrying neither an email nor a telephone,
   * on the grounds that a name in a box is not a contact. A sheet with a
   * `Contacto` column and no address is entirely ordinary, so this is a warning
   * on the row and the contact is simply not created — **never a refusal of the
   * import**, and never an insert the commit would blow up on.
   *
   * This is the same class of bug as the register's `guardian_needs_a_key`,
   * which reached production as a 500 that rolled back a whole file. The lesson
   * that time was to find the constraint before the commit does; this is that,
   * done in advance.
   */
  const contactReachable = contactEmail !== null || contactPhone !== null;
  if (contactName !== null && !contactReachable) {
    warnings.push({ field: 'contactName', code: 'contactNotReachable', value: contactName });
  }

  const partnerKey = normaliseKey(partnerName);
  const known = partnersByKey.get(partnerKey);

  /*
   * A type that disagrees with the partner already recorded.
   *
   * Reported, and the recorded one wins: a club that set "IPSS" on the
   * Misericórdia last season did so deliberately, and a spreadsheet saying
   * "outro" should not quietly overwrite it. This is only ever a warning.
   */
  if (known !== undefined && read !== null && read !== known.type) {
    warnings.push({ field: 'partnerType', code: 'typeConflict', value: rawType ?? '' });
  }

  const groupKey = `${partnerKey} ${normaliseKey(groupName)}`;
  const existingGroup =
    known === undefined
      ? undefined
      : known.groups.find((group) => normaliseKey(group.name) === normaliseKey(groupName));

  const repeatOfLine = groupName === '' ? null : (seenGroups.get(groupKey) ?? null);
  if (groupName !== '' && partnerName !== '' && repeatOfLine === null) {
    seenGroups.set(groupKey, line);
  }

  const updates: PartnerUpdate[] = [];
  if (existingGroup !== undefined && !('error' in count)) {
    // The stocktake — criterion 5. Only fields the sheet actually carried: a
    // blank cell is "the file did not say", never "set this to nothing".
    if (rawCount !== null && existingGroup.participantCount !== count.value) {
      updates.push({
        field: 'participantCount',
        before: String(existingGroup.participantCount),
        after: String(count.value),
      });
    }
    pushUpdate(updates, 'tag', existingGroup.tag, tag);
    pushUpdate(updates, 'ownInstructorName', existingGroup.ownInstructorName, ownInstructorName);
    pushUpdate(updates, 'notes', existingGroup.notes, notes);
    if (level !== undefined && existingGroup.levelId !== level.id) {
      updates.push({ field: 'levelId', before: existingGroup.levelId ?? '', after: level.id });
    }
  }

  const importable = problems.length === 0 && repeatOfLine === null;

  /*
   * The tree — criterion 3.
   *
   * Every importable row files itself under its partner, and the partner is
   * created here once however many rows name it. A refused row is deliberately
   * left out: it cannot be committed, so counting it under a partnership would
   * make the button promise something it will not do.
   */
  if (importable) {
    const node = trees.get(partnerKey);
    if (node === undefined) {
      trees.set(partnerKey, {
        key: partnerKey,
        name: known?.name ?? partnerName,
        type: known?.type ?? partnerType,
        partnerId: known?.id ?? null,
        isNew: known === undefined,
        rows: [index],
      });
    } else {
      node.rows.push(index);
    }
  }

  return {
    index,
    line,
    partnerName,
    partnerType: known?.type ?? partnerType,
    groupName,
    participantCount: 'error' in count ? 0 : count.value,
    levelName,
    levelId: level?.id ?? null,
    tag,
    ownInstructorName,
    contactName,
    contactEmail,
    contactPhone,
    contactReachable: contactReachable && (contactName !== null || contactEmail !== null),
    notes,
    partnerKey,
    partnerId: known?.id ?? null,
    groupId: existingGroup?.id ?? null,
    problems,
    warnings,
    updates,
    existing: existingGroup !== undefined,
    repeatOfLine,
    importable,
  };
}

function pushUpdate(
  updates: PartnerUpdate[],
  field: 'tag' | 'ownInstructorName' | 'notes',
  before: string | null,
  after: string | null,
): void {
  // A blank cell means the file did not say, never "clear this". An importer
  // that read silence as an instruction would empty a club's notes column the
  // first time somebody imported a sheet without one.
  if (after === null || before === after) return;
  updates.push({ field, before: before ?? '', after });
}

function trim(
  value: string | null,
  max: number,
  field: PartnerImportField,
  problems: PartnerProblem[],
): string | null {
  if (value === null) return null;
  if (value.length > max) {
    problems.push({ field, code: 'tooLong', value });
    return null;
  }
  return value;
}

function summarise(rows: PartnerImportRow[], trees: Map<string, PartnerGroupTree>): PartnerSummary {
  const importable = rows.filter((row) => row.importable);

  return {
    total: rows.length,
    importable: importable.length,
    refused: rows.length - importable.length,
    partnersToCreate: [...trees.values()].filter((node) => node.isNew).length,
    partnersExisting: [...trees.values()].filter((node) => !node.isNew).length,
    groupsToCreate: importable.filter((row) => !row.existing).length,
    groupsExisting: importable.filter((row) => row.existing).length,
    groupsToUpdate: importable.filter((row) => row.updates.length > 0).length,
    flagged: importable.filter((row) => row.warnings.length > 0).length,
  };
}
