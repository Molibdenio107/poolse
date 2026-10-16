import { withOrg, type Tx } from '@poolse/db';
import { sameValue } from '../audit/change.js';
import { windowed, TOTAL_COUNT, type PageQuery, type Paginated } from '../common/pagination.js';
import { personShortName, shortName } from '../people/names.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { STUDENT_CHANGE, setStudentLevelIn } from '../students/students.repository.js';
import {
  CLASS_GROUP_CHANGE,
  NoSuchLaneError,
  classGroupWriteError,
  lockClassGroupInput,
  updateClassGroupIn,
  type ClassGroupInput,
} from '../classes/classes.repository.js';
import {
  RegisterRefusedError,
  currentMark,
  saveRegisterIn,
  type AttendanceStatus,
} from '../classes/attendance.repository.js';

/**
 * A record's *Atividade*, and putting a field back — POOLSE-80.
 *
 * **The list is the audit log, read for one record.** A student's own entries
 * and every register mark of theirs; a turma's own entries and the marks in its
 * sessions. Newest first, paginated, Owner and Admin (the controller says so).
 *
 * **A revert is the entity's own update, never an UPDATE of its own.** It reads
 * the entry, locks the record, decides field by field, and then calls the same
 * function the form calls — so validation, triggers, capacity rules and the
 * audit entry all run. That entry carries `revertOf`, which is what makes a
 * revert revertible like any other change. Nothing in the history is edited.
 *
 * **A field changed again since is a conflict, not an overwrite.** The refusal
 * carries the three values; the caller answers per field with `before` (put it
 * back anyway) or `current` (leave it).
 */

export type ActivityKind = 'student' | 'class_group';

/** The actions a revert understands, and the fields of each it may write back. */
const REVERTIBLE: Record<string, readonly string[]> = {
  'student.updated': STUDENT_CHANGE.values,
  'student.filled': STUDENT_CHANGE.values,
  'class_group.updated': CLASS_GROUP_CHANGE.values,
  'attendance.changed': ['status'],
};

/** Fields whose value is a row's id, so the screen is sent the row's name too. */
const ID_FIELDS = ['levelId', 'poolId', 'instructorMembershipId', 'feeCategoryId'] as const;
type IdField = (typeof ID_FIELDS)[number];

export interface ActivityValue {
  value: unknown;
  /** The name behind an id, or null when the value is not an id (or the row is gone). */
  label: string | null;
}

export interface ActivityField {
  field: string;
  before: ActivityValue;
  after: ActivityValue;
  revertible: boolean;
}

export interface ActivityEntry {
  id: string;
  action: string;
  createdAt: string;
  actor: { membershipId: string; name: string } | null;
  fields: ActivityField[];
  /** Fields that moved and whose values are kept out of the log. */
  withheld: string[];
  /** The entry this one reverted, when it was a revert. */
  revertOf: string | null;
  /** For a register mark: which class, which day, which child. */
  session: { id: string; date: string } | null;
  student: { id: string; name: string } | null;
  revertible: boolean;
}

interface Row {
  id: string;
  action: string;
  created_at: Date;
  actor_membership_id: string | null;
  actor_name: string | null;
  data: Record<string, unknown>;
  session_id: string | null;
  session_date: string | null;
  student_id: string | null;
  student_name: string | null;
  total_count: number;
}

export async function listActivity(
  organizationId: string,
  kind: ActivityKind,
  id: string,
  page: PageQuery,
): Promise<Paginated<ActivityEntry> | null> {
  return withOrg(organizationId, async (tx) => {
    const table = kind === 'student' ? 'student' : 'class_group';
    const { rows: exists } = await tx.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id]);
    if (exists.length === 0) return null;

    const scope =
      kind === 'student'
        ? `(a.entity_type = 'student' AND a.entity_id = $1)
           OR (a.action = 'attendance.changed' AND a.data->>'studentId' = $1::text)`
        : `(a.entity_type = 'class_group' AND a.entity_id = $1)
           OR (a.action = 'attendance.changed' AND a.entity_type = 'class_session'
               AND a.entity_id IN (SELECT id FROM class_session WHERE class_group_id = $1))`;

    const result = await windowed<Row, Row>(
      page,
      (limit, offset) =>
        tx.query<Row>(
          `SELECT a.id, a.action, a.created_at, a.actor_membership_id,
                  ${personShortName('a.actor_membership_id')} AS actor_name,
                  a.data,
                  s.id AS session_id, s.occurs_on::text AS session_date,
                  st.id AS student_id,
                  CASE WHEN st.id IS NULL THEN NULL ELSE ${shortName('st')} END AS student_name,
                  ${TOTAL_COUNT}
             FROM audit_log a
             LEFT JOIN class_session s
               ON a.entity_type = 'class_session' AND s.id = a.entity_id
             LEFT JOIN student st
               ON a.action = 'attendance.changed' AND st.id::text = a.data->>'studentId'
            WHERE ${scope}
            ORDER BY a.created_at DESC, a.id DESC
            LIMIT $2 OFFSET $3`,
          [id, limit, offset],
        ),
      (row) => row,
    );

    const labels = await labelsFor(
      tx,
      result.items.flatMap((row) => [
        ...Object.entries(asRecord(row.data['before'])),
        ...Object.entries(asRecord(row.data['after'])),
      ]),
    );

    return { ...result, items: result.items.map((row) => toEntry(row, labels)) };
  });
}

function toEntry(row: Row, labels: Labels): ActivityEntry {
  const before = asRecord(row.data['before']);
  const after = asRecord(row.data['after']);
  const allowed = REVERTIBLE[row.action] ?? [];
  const hasBefore = row.data['before'] !== undefined;

  const fields = Object.keys(after).map((field) => ({
    field,
    before: { value: before[field] ?? null, label: labelOf(labels, field, before[field]) },
    after: { value: after[field] ?? null, label: labelOf(labels, field, after[field]) },
    revertible: hasBefore && allowed.includes(field),
  }));

  return {
    id: row.id,
    action: row.action,
    createdAt: row.created_at.toISOString(),
    actor:
      row.actor_membership_id === null
        ? null
        : { membershipId: row.actor_membership_id, name: row.actor_name ?? '' },
    fields,
    withheld: Array.isArray(row.data['withheld']) ? (row.data['withheld'] as string[]) : [],
    revertOf: typeof row.data['revertOf'] === 'string' ? row.data['revertOf'] : null,
    session:
      row.session_id !== null && row.action === 'attendance.changed'
        ? { id: row.session_id, date: row.session_date ?? '' }
        : null,
    student:
      row.student_id !== null ? { id: row.student_id, name: row.student_name ?? '' } : null,
    revertible: fields.some((field) => field.revertible),
  };
}

// ---------------------------------------------------------------------------
// Labels — the name behind an id, so no screen shows a uuid
// ---------------------------------------------------------------------------

type Labels = Map<string, string>;

const LABEL_SQL: Record<IdField, string> = {
  levelId: `SELECT id, name FROM student_level WHERE id = ANY($1::uuid[])`,
  poolId: `SELECT id, name FROM pool WHERE id = ANY($1::uuid[])`,
  instructorMembershipId: `SELECT id, ${personShortName('id')} AS name FROM membership WHERE id = ANY($1::uuid[])`,
  feeCategoryId: `SELECT id, name FROM fee_category WHERE id = ANY($1::uuid[])`,
};

async function labelsFor(tx: Tx, pairs: [string, unknown][]): Promise<Labels> {
  const labels: Labels = new Map();
  for (const field of ID_FIELDS) {
    const ids = [
      ...new Set(
        pairs
          .filter(([name, value]) => name === field && typeof value === 'string')
          .map(([, value]) => value as string),
      ),
    ];
    if (ids.length === 0) continue;
    const { rows } = await tx.query<{ id: string; name: string }>(LABEL_SQL[field], [ids]);
    for (const row of rows) labels.set(`${field}:${row.id}`, row.name);
  }
  return labels;
}

function labelOf(labels: Labels, field: string, value: unknown): string | null {
  return typeof value === 'string' ? (labels.get(`${field}:${value}`) ?? null) : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// ---------------------------------------------------------------------------
// Revert
// ---------------------------------------------------------------------------

export type Resolution = 'before' | 'current';

export interface RevertConflict {
  field: string;
  before: ActivityValue;
  after: ActivityValue;
  current: ActivityValue;
}

/** A revert that did not happen, with what the screen needs to say why. */
export class RevertRefusal extends Error {
  constructor(
    readonly code:
      | 'not_found'
      | 'revert_not_revertible'
      | 'revert_nothing'
      | 'revert_conflict'
      | 'revert_target_gone',
    readonly detail: { conflicts?: RevertConflict[]; field?: string; label?: string | null } = {},
  ) {
    super(code);
  }
}

interface Entry {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  data: Record<string, unknown>;
}

export async function revertChange(
  organizationId: string,
  entryId: string,
  resolve: Record<string, Resolution>,
): Promise<void> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<Entry>(
      `SELECT id, action, entity_type, entity_id, data FROM audit_log WHERE id = $1`,
      [entryId],
    );
    const entry = rows[0];
    if (!entry || entry.entity_id === null) throw new RevertRefusal('not_found');

    const allowed = REVERTIBLE[entry.action];
    if (allowed === undefined || entry.data['before'] === undefined) {
      throw new RevertRefusal('revert_not_revertible');
    }
    const before = asRecord(entry.data['before']);
    const after = asRecord(entry.data['after']);
    const fields = Object.keys(before).filter((field) => allowed.includes(field));
    if (fields.length === 0) throw new RevertRefusal('revert_not_revertible');

    const context = { revertOf: entry.id };

    if (entry.action === 'attendance.changed') {
      const studentId = String(entry.data['studentId'] ?? '');
      const mark = await currentMark(tx, entry.entity_id, studentId);
      const plan = await decide(tx, fields, before, after, mark, resolve);
      let saved: boolean;
      try {
        saved = await saveRegisterIn(
          tx,
          organizationId,
          entry.entity_id,
          currentTenant().membershipId,
          [
            {
              studentId,
              status: (plan['status'] ?? null) as AttendanceStatus | null,
              note: mark.note,
            },
          ],
          context,
        );
      } catch (error) {
        /*
         * A *falta justificada* that minted a reposição credit cannot be cleared
         * (23503, the credit names it) nor changed once the credit was booked or
         * spent (23001) — the register's own rule, said in the register's words.
         * The closest thing this product has to the ticket's "already invoiced".
         */
        const code = (error as { code?: string }).code;
        if (code === '23503' || code === '23001') throw new RegisterRefusedError('credited');
        throw error;
      }
      if (!saved) throw new RevertRefusal('not_found');
      return;
    }

    if (entry.entity_type === 'student') {
      const { rows: current } = await tx.query<{ levelId: string | null }>(
        `SELECT level_id AS "levelId" FROM student
          WHERE id = $1 AND archived_at IS NULL FOR UPDATE`,
        [entry.entity_id],
      );
      if (!current[0]) throw new RevertRefusal('not_found');
      const plan = await decide(tx, fields, before, after, current[0], resolve);
      const levelId = (plan['levelId'] ?? null) as string | null;
      const moved = await setStudentLevelIn(tx, entry.entity_id, levelId, context);
      if (moved === 'bad_level') await refuseGone(tx, 'levelId', levelId);
      if (moved === 'not_found') throw new RevertRefusal('not_found');
      return;
    }

    if (entry.entity_type === 'class_group') {
      const current = await lockClassGroupInput(tx, entry.entity_id);
      if (current === null) throw new RevertRefusal('not_found');
      const plan = await decide(tx, fields, before, after, { ...current }, resolve);
      const next = { ...current, ...plan } as ClassGroupInput;
      await requireLive(tx, plan);
      try {
        await updateClassGroupIn(tx, organizationId, entry.entity_id, next, context);
      } catch (error) {
        // A lane the pool no longer has is a value since archived, like a level.
        if (error instanceof NoSuchLaneError) {
          throw new RevertRefusal('revert_target_gone', { field: 'lane', label: String(error.lane) });
        }
        throw classGroupWriteError(error, next.name);
      }
      return;
    }

    throw new RevertRefusal('revert_not_revertible');
  });
}

/**
 * Field by field: what to write back.
 *
 * Still as that edit left it → its `before`. Already back where it was → nothing
 * to do for that field. Changed again since → a conflict, unless the caller
 * answered for it. A plan that writes nothing is refused rather than recorded as
 * a revert that changed nothing.
 */
async function decide(
  tx: Tx,
  fields: string[],
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  current: Record<string, unknown>,
  resolve: Record<string, Resolution>,
): Promise<Record<string, unknown>> {
  const plan: Record<string, unknown> = {};
  const conflicts: string[] = [];

  for (const field of fields) {
    const now = current[field] ?? null;
    if (sameValue(now, before[field])) continue;
    if (sameValue(now, after[field]) || resolve[field] === 'before') {
      plan[field] = before[field] ?? null;
      continue;
    }
    if (resolve[field] === 'current') continue;
    conflicts.push(field);
  }

  if (conflicts.length > 0) {
    const labels = await labelsFor(
      tx,
      conflicts.flatMap((field) => [
        [field, before[field]] as [string, unknown],
        [field, after[field]] as [string, unknown],
        [field, current[field]] as [string, unknown],
      ]),
    );
    const value = (field: string, v: unknown): ActivityValue => ({
      value: v ?? null,
      label: labelOf(labels, field, v),
    });
    throw new RevertRefusal('revert_conflict', {
      conflicts: conflicts.map((field) => ({
        field,
        before: value(field, before[field]),
        after: value(field, after[field]),
        current: value(field, current[field]),
      })),
    });
  }

  if (Object.keys(plan).length === 0) throw new RevertRefusal('revert_nothing');
  return plan;
}

/**
 * A value a revert would write back that names a row since archived — a level
 * nobody teaches any more, a tank closed for good — is a 409 naming it, never a
 * foreign-key error.
 */
async function requireLive(tx: Tx, plan: Record<string, unknown>): Promise<void> {
  const checks: [IdField, string][] = [
    ['levelId', 'SELECT 1 FROM student_level WHERE id = $1 AND archived_at IS NULL'],
    ['poolId', 'SELECT 1 FROM pool WHERE id = $1 AND archived_at IS NULL'],
    ['instructorMembershipId', 'SELECT 1 FROM membership WHERE id = $1 AND archived_at IS NULL'],
  ];
  for (const [field, sql] of checks) {
    const value = plan[field];
    if (typeof value !== 'string') continue;
    const { rows } = await tx.query(sql, [value]);
    if (rows.length === 0) await refuseGone(tx, field, value);
  }
}

async function refuseGone(tx: Tx, field: IdField, value: string | null): Promise<never> {
  const labels = value === null ? new Map<string, string>() : await labelsFor(tx, [[field, value]]);
  throw new RevertRefusal('revert_target_gone', { field, label: labelOf(labels, field, value) });
}
