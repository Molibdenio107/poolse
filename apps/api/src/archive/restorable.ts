import type { Tx } from '@poolse/db';
import { displayName } from '../people/names.js';

/**
 * What the bin can bring back — POOLSE-78.
 *
 * **A registry, not "every table with `archived_at`".** About thirty tables are
 * soft-deletable and most of them are history nobody archives from a screen (a
 * cleaning log, a stocktake line). These nine are what an Owner or Admin archives
 * by pressing a button today, which was Rui's answer on 12-10-2026. Staff are
 * excluded because bringing a person back touches seats, Clerk and invitations;
 * a season has its own lifecycle; an invoice has no `archived_at` at all.
 *
 * Each kind's `kind` is the `entity_type` its archive path writes to `audit_log`,
 * and `action` is that path's own action name. The names are not uniform —
 * `maintenance.taskArchived` sits beside `student.archived` — and they stay as
 * they are, because renaming history would orphan every entry already written.
 * So the bin reads this list and never a `*.archived` pattern.
 */

export type RestorableKindName =
  | 'student'
  | 'class_group'
  | 'facility'
  | 'pool'
  | 'space'
  | 'inventory_item'
  | 'maintenance_task'
  | 'partner'
  | 'student_fee'
  | 'swim_meet';

/**
 * One child of an archive action, as recorded in `audit_log.data.cascade`.
 *
 * Most children are rows whose `archived_at` was set in the same statement as
 * the parent's. Two are not: archiving a turma *ends* its enrolments — a status,
 * not an archive — and the `enrollment_ends_its_fees` trigger then closes their
 * fee lines. Undoing the turma without undoing those would bring back a class
 * with nobody in it, so both are part of the cascade, carrying what they were.
 */
export type CascadeItem =
  | { entityType: ArchivedChild; id: string }
  | { entityType: 'enrollment'; id: string; status: 'active' | 'waiting' }
  | { entityType: 'student_fee.ends_on'; id: string; endsOn: string };

/** Children restored by clearing `archived_at`, keyed on the column naming the parent. */
export const ARCHIVED_CHILDREN = {
  pool: { table: 'pool', parentColumn: 'facility_id' },
  class_schedule: { table: 'class_schedule', parentColumn: 'class_group_id' },
  partner_contact: { table: 'partner_contact', parentColumn: 'partner_id' },
  partner_group: { table: 'partner_group', parentColumn: 'partner_id' },
  // POOLSE-81: a meet's results leave and come back with it.
  student_record: { table: 'student_record', parentColumn: 'meet_id' },
} as const;

export type ArchivedChild = keyof typeof ARCHIVED_CHILDREN;

export interface RestorableKind {
  kind: RestorableKindName;
  /** The action the archive path writes. */
  action: string;
  table: string;
  /** `archive.kind.<kind>` in the catalogue. */
  labelKey: string;
  /**
   * How the bin names a row: `from` aliases the row as `t`, `name` is the
   * club's own words for it and `detail` an optional enum the screen translates.
   * Read from the row at list time rather than from the audit entry, because two
   * of the nine archive paths never wrote a name.
   */
  label: { from: string; name: string; detail?: string };
  /** Rows that must be live before this one may be. A null column is no parent. */
  parents: { kind: RestorableKindName; column: string }[];
  /** What the archive path takes with it. Empty for most kinds. */
  cascades: (ArchivedChild | 'enrollment' | 'student_fee.ends_on')[];
}

export const RESTORABLE: readonly RestorableKind[] = [
  {
    kind: 'student',
    action: 'student.archived',
    table: 'student',
    labelKey: 'archive.kind.student',
    label: { from: 'student t', name: displayName('t') },
    parents: [],
    cascades: [],
  },
  {
    kind: 'class_group',
    action: 'class_group.archived',
    table: 'class_group',
    labelKey: 'archive.kind.class_group',
    label: { from: 'class_group t', name: 't.name' },
    parents: [
      { kind: 'facility', column: 'facility_id' },
      { kind: 'pool', column: 'pool_id' },
    ],
    cascades: ['class_schedule', 'enrollment', 'student_fee.ends_on'],
  },
  {
    kind: 'facility',
    action: 'facility.archived',
    table: 'facility',
    labelKey: 'archive.kind.facility',
    label: { from: 'facility t', name: 't.name' },
    parents: [],
    cascades: ['pool'],
  },
  {
    kind: 'pool',
    action: 'pool.archived',
    table: 'pool',
    labelKey: 'archive.kind.pool',
    label: { from: 'pool t', name: 't.name' },
    parents: [{ kind: 'facility', column: 'facility_id' }],
    cascades: [],
  },
  {
    kind: 'space',
    action: 'space.archived',
    table: 'space',
    labelKey: 'archive.kind.space',
    label: { from: 'space t', name: 't.name' },
    parents: [{ kind: 'facility', column: 'facility_id' }],
    cascades: [],
  },
  {
    kind: 'inventory_item',
    action: 'inventory.item.archived',
    table: 'inventory_item',
    labelKey: 'archive.kind.inventory_item',
    label: { from: 'inventory_item t', name: 't.name' },
    parents: [
      { kind: 'facility', column: 'facility_id' },
      { kind: 'space', column: 'space_id' },
    ],
    cascades: [],
  },
  {
    kind: 'maintenance_task',
    action: 'maintenance.taskArchived',
    table: 'maintenance_task',
    labelKey: 'archive.kind.maintenance_task',
    label: { from: 'maintenance_task t', name: 't.title' },
    parents: [
      { kind: 'facility', column: 'facility_id' },
      { kind: 'pool', column: 'pool_id' },
      { kind: 'space', column: 'space_id' },
      { kind: 'inventory_item', column: 'inventory_item_id' },
    ],
    cascades: [],
  },
  {
    kind: 'partner',
    action: 'partner.archived',
    table: 'partner',
    labelKey: 'archive.kind.partner',
    label: { from: 'partner t', name: 't.name' },
    parents: [{ kind: 'facility', column: 'facility_id' }],
    cascades: ['partner_contact', 'partner_group'],
  },
  {
    kind: 'student_fee',
    action: 'student_fee.archived',
    table: 'student_fee',
    labelKey: 'archive.kind.student_fee',
    // A fee line has no name of its own: it is somebody's mensalidade.
    label: {
      from: `student_fee t
             JOIN student s ON s.id = t.student_id AND s.organization_id = t.organization_id`,
      name: displayName('s'),
      detail: 't.kind::text',
    },
    parents: [{ kind: 'student', column: 'student_id' }],
    cascades: [],
  },
  {
    // POOLSE-81: a meet, with its results.
    kind: 'swim_meet',
    action: 'swim_meet.archived',
    table: 'swim_meet',
    labelKey: 'archive.kind.swim_meet',
    label: { from: 'swim_meet t', name: 't.name' },
    parents: [],
    cascades: ['student_record'],
  },
];

/**
 * Which field a partial unique index guards, so a clash on restore is a
 * sentence — "Já existe um tanque com o nome «Piscina 1»" — and not a 500.
 *
 * Keyed on the index name, because that is what a 23505 carries. Children's
 * indexes are here too: restoring a site brings back its tanks, and one of
 * *those* may be the row that clashes.
 */
export const UNIQUE_FIELDS: Record<string, { field: string; column: string }> = {
  student_tax_number_uq: { field: 'taxNumber', column: 'tax_number' },
  student_socio_number_uq: { field: 'socioNumber', column: 'socio_number' },
  class_group_name_uq: { field: 'name', column: 'name' },
  facility_name_uq: { field: 'name', column: 'name' },
  pool_name_uq: { field: 'name', column: 'name' },
  space_name_uq: { field: 'name', column: 'name' },
  inventory_item_name_uq: { field: 'name', column: 'name' },
  partner_name_uq: { field: 'name', column: 'name' },
  partner_group_name_uq: { field: 'name', column: 'name' },
  student_fee_one_seguro_uq: { field: 'kind', column: 'kind::text' },
  student_fee_one_inscricao_uq: { field: 'kind', column: 'kind::text' },
};

export function restorableByKind(kind: string): RestorableKind | undefined {
  return RESTORABLE.find((one) => one.kind === kind);
}

/** For an archive path naming its own kind, where absence is a programming error. */
export function restorableKind(kind: RestorableKindName): RestorableKind {
  const found = restorableByKind(kind);
  if (found === undefined) throw new Error(`RESTORABLE has no ${kind}`);
  return found;
}

export function restorableByAction(action: string): RestorableKind | undefined {
  return RESTORABLE.find((one) => one.action === action);
}

/**
 * Refuses the registry mistakes that would otherwise restore half of something
 * and report success — the same idea as the dashboard's `assertRegistryIsSound`.
 * Run by the unit test, as the dashboard's is.
 */
export function assertRestorableIsSound(registry: readonly RestorableKind[] = RESTORABLE): void {
  const seen = new Set<string>();
  for (const one of registry) {
    for (const key of [`kind:${one.kind}`, `action:${one.action}`]) {
      if (seen.has(key)) throw new Error(`RESTORABLE: ${key} is declared twice`);
      seen.add(key);
    }
    if (one.labelKey !== `archive.kind.${one.kind}`) {
      throw new Error(`RESTORABLE: ${one.kind} has label key ${one.labelKey}`);
    }
    if (!/\bt\b/.test(one.label.from)) {
      throw new Error(`RESTORABLE: ${one.kind}'s label must alias the row as t`);
    }
    for (const parent of one.parents) {
      if (!registry.some((other) => other.kind === parent.kind)) {
        throw new Error(`RESTORABLE: ${one.kind} names parent ${parent.kind}, which is not restorable`);
      }
      if (parent.kind === one.kind) throw new Error(`RESTORABLE: ${one.kind} is its own parent`);
    }
    // A fee line ended by a turma only exists because its enrolment did.
    if (one.cascades.includes('student_fee.ends_on') && !one.cascades.includes('enrollment')) {
      throw new Error(`RESTORABLE: ${one.kind} reopens fee lines without their enrolments`);
    }
  }
}

/**
 * The children one archive action took with it, found by its timestamp.
 *
 * `now()` is the transaction's start, so every row an archive statement touched
 * carries the identical `archived_at` (or `updated_at`) as the audit entry's
 * `created_at`. That makes this exact, and it is used two ways:
 *
 * - by the archive paths, called inside their own transaction with `at`
 *   omitted, to *record* the cascade on the entry they write;
 * - for entries written before POOLSE-78, which recorded no cascade, with `at`
 *   the entry's `created_at`.
 *
 * Enrolments are the one approximation, and only for those old entries: what an
 * ended enrolment *was* is not stored, so one with a waiting position is read as
 * waiting. `archiveClassGroup` records the real status instead.
 */
export async function cascadeAt(
  tx: Tx,
  kind: RestorableKind,
  id: string,
  at?: string,
): Promise<CascadeItem[]> {
  const items: CascadeItem[] = [];

  for (const child of kind.cascades) {
    if (child === 'enrollment') {
      const { rows } = await tx.query<{ id: string; status: 'active' | 'waiting' }>(
        `SELECT id, CASE WHEN waiting_position IS NULL THEN 'active' ELSE 'waiting' END AS status
           FROM enrollment
          WHERE class_group_id = $1 AND status = 'ended'
            AND updated_at = coalesce($2::timestamptz, now())
          ORDER BY id`,
        [id, at ?? null],
      );
      for (const row of rows) items.push({ entityType: 'enrollment', id: row.id, status: row.status });
      continue;
    }

    if (child === 'student_fee.ends_on') {
      const { rows } = await tx.query<{ id: string; ends_on: string }>(
        `SELECT sf.id, to_char(sf.ends_on, 'YYYY-MM-DD') AS ends_on
           FROM student_fee sf
           JOIN enrollment e ON e.id = sf.enrollment_id AND e.organization_id = sf.organization_id
          WHERE e.class_group_id = $1 AND e.status = 'ended'
            AND e.updated_at = coalesce($2::timestamptz, now())
            AND sf.updated_at = coalesce($2::timestamptz, now())
            AND sf.archived_at IS NULL AND sf.ends_on = e.ended_on
          ORDER BY sf.id`,
        [id, at ?? null],
      );
      for (const row of rows) {
        items.push({ entityType: 'student_fee.ends_on', id: row.id, endsOn: row.ends_on });
      }
      continue;
    }

    const { table, parentColumn } = ARCHIVED_CHILDREN[child];
    const { rows } = await tx.query<{ id: string }>(
      `SELECT id FROM ${table}
        WHERE ${parentColumn} = $1 AND archived_at = coalesce($2::timestamptz, now())
        ORDER BY id`,
      [id, at ?? null],
    );
    for (const row of rows) items.push({ entityType: child, id: row.id });
  }

  return items;
}
