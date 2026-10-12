import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { TOTAL_COUNT, paginated, totalOf, type PageQuery, type Paginated } from '../common/pagination.js';
import { personShortName } from '../people/names.js';
import {
  ARCHIVED_CHILDREN,
  RESTORABLE,
  UNIQUE_FIELDS,
  cascadeAt,
  restorableByAction,
  restorableKind,
  type CascadeItem,
  type RestorableKind,
  type RestorableKindName,
} from './restorable.js';

/**
 * Arquivados — POOLSE-78.
 *
 * The bin is built from `audit_log`, one row per *archive action*, not per row:
 * archiving a site and its three tanks is one entry with three children. No
 * column was added to any table — the cascade is in the entry's `data`, and
 * where an older entry has none, `cascadeAt` finds it by the archive's own
 * timestamp.
 *
 * Only actions a person did are offered. A job — the trial clock, a closure —
 * writes with no membership, and undoing what a machine decided is not this
 * screen's business.
 */

export interface ArchiveEntry {
  /** The audit entry's id — what *Restaurar* and the toast's *Anular* send. */
  id: string;
  kind: RestorableKindName;
  entityId: string;
  /** The club's own words for the row, read from the row now. */
  name: string;
  /** An enum the screen translates — a fee line's kind. */
  detail: string | null;
  archivedAt: string;
  actor: { membershipId: string; name: string } | null;
  /** Children per kind: `{ pool: 3 }` renders "+ 3 tanques". */
  children: Record<string, number>;
  /** False once the row is live again, by this bin or any other way. */
  archived: boolean;
}

export interface ArchiveFilters {
  kind: RestorableKindName | null;
  actorMembershipId: string | null;
  from: string | null;
  to: string | null;
}

interface EntryRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  at: string;
  archived_at: Date;
  cascade: unknown;
  actor_membership_id: string;
  actor_name: string | null;
  total_count: number;
}

const ACTIONS = RESTORABLE.map((one) => one.action);

/**
 * An archive that was the consequence of another change is not offered — sweep,
 * 12-10-2026. Turning sócio off archives the quota line with a `reason`, and
 * restoring it alone would bill a non-member, because nothing re-checks the
 * flag. Undoing the cause is how that one comes back.
 */
const NOT_A_CONSEQUENCE = `NOT (a.data ? 'reason')`;

export async function listArchive(
  organizationId: string,
  filters: ArchiveFilters,
  page: PageQuery,
): Promise<Paginated<ArchiveEntry>> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<EntryRow>(
      `SELECT a.id, a.action, a.entity_type, a.entity_id,
              a.created_at::text AS at, a.created_at AS archived_at,
              a.data -> 'cascade' AS cascade,
              a.actor_membership_id,
              ${personShortName('a.actor_membership_id')} AS actor_name,
              ${TOTAL_COUNT}
         FROM audit_log a
        WHERE a.action = ANY($1::text[])
          AND a.actor_membership_id IS NOT NULL
          AND a.entity_id IS NOT NULL
          AND ${NOT_A_CONSEQUENCE}
          AND ($2::text IS NULL OR a.entity_type = $2)
          AND ($3::uuid IS NULL OR a.actor_membership_id = $3)
          AND ($4::date IS NULL OR (a.created_at AT TIME ZONE 'Europe/Lisbon')::date >= $4::date)
          AND ($5::date IS NULL OR (a.created_at AT TIME ZONE 'Europe/Lisbon')::date <= $5::date)
        ORDER BY a.created_at DESC, a.id
        LIMIT $6 OFFSET $7`,
      [
        ACTIONS,
        filters.kind,
        filters.actorMembershipId,
        filters.from,
        filters.to,
        page.limit,
        page.offset,
      ],
    );

    const labels = await labelsFor(tx, rows);
    const items: ArchiveEntry[] = [];

    for (const row of rows) {
      const kind = kindOf(row);
      if (kind === undefined) continue;

      const cascade = Array.isArray(row.cascade)
        ? (row.cascade as CascadeItem[])
        : await cascadeAt(tx, kind, row.entity_id, row.at);

      const label = labels.get(row.id);
      items.push({
        id: row.id,
        kind: kind.kind,
        entityId: row.entity_id,
        name: label?.name ?? '',
        detail: label?.detail ?? null,
        archivedAt: row.archived_at.toISOString(),
        actor: { membershipId: row.actor_membership_id, name: row.actor_name ?? '' },
        children: countChildren(cascade),
        archived: label?.stillArchived ?? false,
      });
    }

    return paginated(items, totalOf(rows), page);
  });
}

/** Everybody who has archived something the bin offers — the person filter. */
export async function listArchiveActors(
  organizationId: string,
): Promise<{ membershipId: string; name: string }[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string; name: string }>(
      `SELECT DISTINCT a.actor_membership_id AS id,
              ${personShortName('a.actor_membership_id')} AS name
         FROM audit_log a
        WHERE a.action = ANY($1::text[]) AND a.actor_membership_id IS NOT NULL
          AND ${NOT_A_CONSEQUENCE}
        ORDER BY 2`,
      [ACTIONS],
    );
    return rows.map((row) => ({ membershipId: row.id, name: row.name }));
  });
}

function kindOf(row: { action: string; entity_type: string }): RestorableKind | undefined {
  const kind = restorableByAction(row.action);
  return kind?.kind === row.entity_type ? kind : undefined;
}

function countChildren(cascade: CascadeItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of cascade) counts[item.entityType] = (counts[item.entityType] ?? 0) + 1;
  return counts;
}

/**
 * One query per kind on the page, never one per row: the page is ten entries
 * across at most nine kinds. Whether the row is *still archived by this action*
 * is compared in SQL, because JavaScript's Date drops the microseconds that
 * make two archives of one row distinguishable.
 */
async function labelsFor(
  tx: Tx,
  rows: EntryRow[],
): Promise<Map<string, { name: string; detail: string | null; stillArchived: boolean }>> {
  const byKind = new Map<RestorableKind, string[]>();
  for (const row of rows) {
    const kind = kindOf(row);
    if (kind === undefined) continue;
    byKind.set(kind, [...(byKind.get(kind) ?? []), row.id]);
  }

  const labels = new Map<string, { name: string; detail: string | null; stillArchived: boolean }>();
  for (const [kind, ids] of byKind) {
    const { rows: found } = await tx.query<{
      entry_id: string;
      name: string;
      detail: string | null;
      still_archived: boolean;
    }>(
      `SELECT a.id AS entry_id, ${kind.label.name} AS name,
              ${kind.label.detail ?? 'NULL::text'} AS detail,
              coalesce(t.archived_at = a.created_at, false) AS still_archived
         FROM audit_log a
         JOIN ${kind.label.from} ON t.id = a.entity_id AND t.organization_id = a.organization_id
        WHERE a.id = ANY($1::uuid[])`,
      [ids],
    );
    for (const row of found) {
      labels.set(row.entry_id, {
        name: row.name,
        detail: row.detail,
        stillArchived: row.still_archived,
      });
    }
  }
  return labels;
}

// ---------------------------------------------------------------------------
// Restoring
// ---------------------------------------------------------------------------

export type RestoreRefusalCode =
  | 'already_restored'
  | 'parent_archived'
  | 'restore_conflict'
  | 'licence_exceeded'
  | 'pool_full'
  | 'class_full';

/**
 * A refusal carrying its figures as structure — the trigger-refusal convention.
 * The controller turns it into a 409; the screen composes the sentence.
 */
export class RestoreRefusal extends Error {
  constructor(
    readonly code: RestoreRefusalCode,
    readonly figures: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export interface Restored {
  kind: RestorableKindName;
  entityId: string;
  name: string;
  /** Children brought back, per kind. */
  children: Record<string, number>;
  /**
   * Children of the action that were not brought back, because something else
   * has happened to them since — restored on their own, archived again, edited.
   * Counted rather than silently skipped.
   */
  kept: number;
}

interface EntryForRestore {
  action: string;
  entity_type: string;
  entity_id: string;
  at: string;
  cascade: unknown;
}

/**
 * Undoes one archive action: the row, and exactly the children archived with
 * it, in one transaction. `'not_found'` covers an unknown id, another club's
 * entry (RLS hides it), an action the bin does not offer and one a job did.
 */
export async function restoreArchive(
  organizationId: string,
  entryId: string,
): Promise<Restored | 'not_found'> {
  return withOrg(organizationId, async (tx) => {
    const { rows: entries } = await tx.query<EntryForRestore>(
      `SELECT action, entity_type, entity_id, created_at::text AS at, data -> 'cascade' AS cascade
         FROM audit_log
        WHERE id = $1 AND actor_membership_id IS NOT NULL AND entity_id IS NOT NULL
          AND NOT (data ? 'reason')`,
      [entryId],
    );
    const entry = entries[0];
    if (entry === undefined) return 'not_found';

    const kind = kindOf(entry);
    if (kind === undefined) return 'not_found';

    const parentColumns = kind.parents.map((p, i) => `t.${p.column}::text AS p${i}`).join(', ');
    const { rows: targets } = await tx.query<Record<string, string | boolean | null>>(
      `SELECT coalesce(t.archived_at = $2::timestamptz, false) AS this_archive,
              ${kind.label.name} AS name
              ${parentColumns ? `, ${parentColumns}` : ''}
         FROM ${kind.label.from}
        WHERE t.id = $1
        FOR UPDATE OF t`,
      [entry.entity_id, entry.at],
    );
    const target = targets[0];
    if (target === undefined) return 'not_found';

    // Restored already — by this bin, by a toast, or un-archived some other way.
    if (target['this_archive'] !== true) throw new RestoreRefusal('already_restored');

    for (const [i, parent] of kind.parents.entries()) {
      const parentId = target[`p${i}`];
      if (typeof parentId === 'string') await refuseIfArchived(tx, parent.kind, parentId);
    }

    await attempt(tx, kind.table, entry.entity_id, () =>
      tx.query(`UPDATE ${kind.table} SET archived_at = NULL WHERE id = $1`, [entry.entity_id]),
    );

    /*
     * A fee line whose enrolment ended while it sat in the bin — sweep,
     * 12-10-2026. `enrollment_ends_its_fees` only closes live lines, so this one
     * missed it. Back without an end, it would bill every month from now on for a
     * turma the student has left. It ends when its enrolment did.
     */
    if (kind.kind === 'student_fee') {
      await tx.query(
        `UPDATE student_fee sf SET ends_on = e.ended_on
           FROM enrollment e
          WHERE sf.id = $1 AND sf.ends_on IS NULL
            AND e.id = sf.enrollment_id AND e.organization_id = sf.organization_id
            AND e.status = 'ended'`,
        [entry.entity_id],
      );
    }

    const cascade = Array.isArray(entry.cascade)
      ? (entry.cascade as CascadeItem[])
      : await cascadeAt(tx, kind, entry.entity_id, entry.at);

    const children: Record<string, number> = {};
    let kept = 0;
    for (const item of cascade) {
      if (await restoreChild(tx, item, entry.at)) {
        children[item.entityType] = (children[item.entityType] ?? 0) + 1;
      } else {
        kept += 1;
      }
    }

    const name = String(target['name'] ?? '');
    await recordAudit(tx, {
      action: `${kind.kind}.restored`,
      entityType: kind.kind,
      entityId: entry.entity_id,
      data: { archiveEntryId: entryId, name, children, kept },
    });

    return { kind: kind.kind, entityId: entry.entity_id, name, children, kept };
  });
}

/**
 * A tank cannot come back into a site that is gone. The refusal names the
 * parent and, where one exists, the entry that archived it — so the screen can
 * offer to restore that instead.
 */
async function refuseIfArchived(tx: Tx, kindName: RestorableKindName, id: string): Promise<void> {
  const parent = restorableKind(kindName);
  const { rows } = await tx.query<{ name: string; archived_at: string | null }>(
    `SELECT ${parent.label.name} AS name, t.archived_at::text AS archived_at
       FROM ${parent.label.from}
      WHERE t.id = $1`,
    [id],
  );
  const row = rows[0];
  if (row === undefined || row.archived_at === null) return;

  const { rows: entries } = await tx.query<{ id: string }>(
    `SELECT id FROM audit_log
      WHERE action = $1 AND entity_id = $2 AND created_at = $3::timestamptz
        AND actor_membership_id IS NOT NULL
      LIMIT 1`,
    [parent.action, id, row.archived_at],
  );

  throw new RestoreRefusal('parent_archived', {
    parentKind: parent.kind,
    parentName: row.name,
    parentEntryId: entries[0]?.id ?? null,
  });
}

/**
 * Puts one child back, guarded on its still being as the archive left it.
 * Returns false when it is not — that child has its own history since.
 */
async function restoreChild(tx: Tx, item: CascadeItem, at: string): Promise<boolean> {
  if (item.entityType === 'enrollment') {
    const { rowCount } = await attempt(tx, 'enrollment', item.id, () =>
      tx.query(
        `UPDATE enrollment SET status = $2::enrollment_status, ended_on = NULL
          WHERE id = $1 AND status = 'ended' AND updated_at = $3::timestamptz`,
        [item.id, item.status, at],
      ),
    );
    return (rowCount ?? 0) > 0;
  }

  /*
   * A fee line closed with its turma reopens only on the day it was closed —
   * sweep, 12-10-2026. Reopened later, it would be chargeable for the weeks the
   * turma was gone, with no lessons in them. So it stays ended and is counted as
   * kept, and the toast says so; the office adds a line from today.
   */
  if (item.entityType === 'student_fee.ends_on') {
    const { rowCount } = await tx.query(
      `UPDATE student_fee SET ends_on = NULL
        WHERE id = $1 AND archived_at IS NULL AND ends_on = $2::date
          AND $2::date >= current_date
          AND updated_at = $3::timestamptz`,
      [item.id, item.endsOn, at],
    );
    return (rowCount ?? 0) > 0;
  }

  const { table } = ARCHIVED_CHILDREN[item.entityType];
  const { rowCount } = await attempt(tx, table, item.id, () =>
    tx.query(
      `UPDATE ${table} SET archived_at = NULL WHERE id = $1 AND archived_at = $2::timestamptz`,
      [item.id, at],
    ),
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Runs one restoring write under a savepoint, so a refusal can still read the
 * value it needs to name before the transaction is abandoned.
 *
 * A unique clash is the case that needs it: the error carries the index name
 * and a lowercased key, and the sentence wants the club's own spelling.
 */
async function attempt<T>(tx: Tx, table: string, id: string, write: () => Promise<T>): Promise<T> {
  await tx.query('SAVEPOINT restore_row');
  try {
    const result = await write();
    await tx.query('RELEASE SAVEPOINT restore_row');
    return result;
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT restore_row');
    throw await refusalFor(tx, error, table, id);
  }
}

async function refusalFor(tx: Tx, error: unknown, table: string, id: string): Promise<unknown> {
  const pgError = error as { code?: string; constraint?: string; detail?: string; message?: string };

  if (pgError.code === '23505' && pgError.constraint !== undefined) {
    const unique = UNIQUE_FIELDS[pgError.constraint];
    if (unique === undefined) return error;
    const { rows } = await tx.query<{ value: string | null }>(
      `SELECT ${unique.column} AS value FROM ${table} WHERE id = $1`,
      [id],
    );
    return new RestoreRefusal('restore_conflict', {
      entityType: table,
      field: unique.field,
      value: rows[0]?.value ?? null,
    });
  }

  // The licence — `facility_within_licence` fires on un-archiving a site too.
  const message = pgError.message ?? '';
  if (message.startsWith('facility_licence_exceeded:')) {
    const [current, allowed] = message
      .slice(message.indexOf(':') + 1)
      .split(' of ')
      .map((part) => Number(part.trim()));
    return new RestoreRefusal('licence_exceeded', { current, allowed });
  }

  // A turma coming back into a slot the tank no longer has room for.
  if (typeof pgError.detail === 'string' && pgError.detail.startsWith('pool_capacity|')) {
    const [, max, taken, asked] = pgError.detail.split('|').map(Number);
    return new RestoreRefusal('pool_full', { max, taken, asked });
  }

  // An enrolment reopening into a turma whose capacity was lowered meanwhile.
  const full = /^This class group is full \((\d+) of (\d+)\)/.exec(message);
  if (pgError.code === '23514' && full !== null) {
    return new RestoreRefusal('class_full', { taken: Number(full[1]), capacity: Number(full[2]) });
  }

  return error;
}
