import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import type { CascadeItem } from '../archive/restorable.js';

/**
 * A pool's calendar, an import's record, and taking either back (Rui, 12-11-2026).
 *
 * **A pool already with a calendar is never imported onto silently.** The
 * preview names what is there (`calendarsOf`); Confirmar is refused until the
 * operator says *Substituir*, and then `archiveCalendarIn` puts the whole of it
 * in the bin — turmas, slots, events, natação livre, parcerias — before the new
 * rows are written, in the same transaction. Turmas with students stay unless
 * ticked; their enrolments end with them, restorably, as archiving one turma does.
 *
 * **An import is a record** (`timetable_import`): what it wrote points at it, so
 * *Desfazer* archives exactly that. Either way the future lessons of an archived
 * slot go too, except a lesson something already points at (attendance, a
 * reposição, a family's notice), which stays as a record. The bin brings it all
 * back as one entry, and the lessons are topped up again afterwards.
 */

export interface PoolCalendar {
  poolId: string;
  poolName: string;
  /** Live turmas in the pool and season. */
  turmas: number;
  /** Live weekly slots of every kind in the pool and season. */
  slots: number;
  /** Turmas with active or waiting students, which stay unless ticked. */
  inUse: { id: string; name: string; students: number }[];
}

/** A pool's slots in a season: the slot's own pool or its turma's, or any lane of that pool. */
const POOL_SLOTS = `
  SELECT cs.id, cs.class_group_id
    FROM class_schedule cs
    LEFT JOIN class_group cg ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
   WHERE cs.archived_at IS NULL
     AND cs.facility_id = $1
     AND coalesce(cs.season_id, cg.season_id) = $2
     AND (coalesce(cs.pool_id, cg.pool_id) = $3
          OR EXISTS (SELECT 1 FROM booking_lane b JOIN lane l ON l.id = b.lane_id AND l.organization_id = b.organization_id
                      WHERE b.schedule_id = cs.id AND b.organization_id = cs.organization_id AND l.pool_id = $3))`;

const POOL_TURMAS = `
  SELECT cg.id, cg.name,
         (SELECT count(*)::int FROM enrollment e
           WHERE e.class_group_id = cg.id AND e.organization_id = cg.organization_id AND e.status <> 'ended') AS students
    FROM class_group cg
   WHERE cg.archived_at IS NULL AND cg.facility_id = $1 AND cg.season_id = $2 AND cg.pool_id = $3`;

/** What each named pool already holds in the season; pools with nothing are left out. */
export async function calendarsOf(tx: Tx, facilityId: string, seasonId: string, poolIds: string[]): Promise<PoolCalendar[]> {
  const out: PoolCalendar[] = [];
  for (const poolId of poolIds) {
    const { rows: pool } = await tx.query<{ name: string }>(`SELECT name FROM pool WHERE id = $1`, [poolId]);
    const { rows: slots } = await tx.query<{ id: string }>(POOL_SLOTS, [facilityId, seasonId, poolId]);
    const { rows: turmas } = await tx.query<{ id: string; name: string; students: number }>(POOL_TURMAS, [facilityId, seasonId, poolId]);
    // A calendar is weekly slots: turmas made by hand with no times yet are not one,
    // and an import may fill them in (QA 7).
    if (slots.length === 0) continue;
    out.push({
      poolId,
      poolName: pool[0]?.name ?? '',
      turmas: turmas.length,
      slots: slots.length,
      inUse: turmas.filter((turma) => turma.students > 0).map((turma) => ({ id: turma.id, name: turma.name, students: turma.students })),
    });
  }
  return out;
}

/**
 * The slots and turmas a replace would archive, for the preview to judge the
 * new rows without them (no clash with what is about to leave, no name taken by
 * a turma about to be archived). Kept turmas — in use, not ticked — stay.
 */
export async function replacedBy(
  tx: Tx,
  facilityId: string,
  seasonId: string,
  poolIds: string[],
  keepTurmaIds: string[],
): Promise<{ slotIds: Set<string>; turmaIds: Set<string> }> {
  const keep = new Set(keepTurmaIds);
  const slotIds = new Set<string>();
  const turmaIds = new Set<string>();
  for (const poolId of poolIds) {
    const { rows: slots } = await tx.query<{ id: string; class_group_id: string | null }>(POOL_SLOTS, [facilityId, seasonId, poolId]);
    for (const slot of slots) if (slot.class_group_id === null || !keep.has(slot.class_group_id)) slotIds.add(slot.id);
    const { rows: turmas } = await tx.query<{ id: string }>(POOL_TURMAS, [facilityId, seasonId, poolId]);
    for (const turma of turmas) if (!keep.has(turma.id)) turmaIds.add(turma.id);
  }
  return { slotIds, turmaIds };
}

/**
 * Archive turmas and slots inside a transaction, returning the cascade the bin
 * needs: each turma and slot, each enrolment ended (with what it was) and each
 * fee line that ended with it. Future untouched lessons of those slots go.
 */
export async function archiveTurmasAndSlotsIn(
  tx: Tx,
  turmaIds: string[],
  slotIds: string[],
): Promise<{ cascade: CascadeItem[]; lessonsKept: number }> {
  const turmas = await tx.query<{ id: string }>(
    `UPDATE class_group SET archived_at = now() WHERE id = ANY($1::uuid[]) AND archived_at IS NULL RETURNING id`,
    [turmaIds],
  );
  // A turma's own slots go with it, as archiving one turma does.
  const slots = await tx.query<{ id: string }>(
    `UPDATE class_schedule SET archived_at = now()
      WHERE archived_at IS NULL AND (id = ANY($1::uuid[]) OR class_group_id = ANY($2::uuid[]))
    RETURNING id`,
    [slotIds, turmaIds],
  );
  const ended = await tx.query<{ id: string; was: 'active' | 'waiting' }>(
    `WITH was AS (
       SELECT id, status FROM enrollment
        WHERE class_group_id = ANY($1::uuid[]) AND status <> 'ended'
        FOR UPDATE
     )
     UPDATE enrollment e SET status = 'ended', ended_on = club_today()
       FROM was WHERE e.id = was.id
     RETURNING e.id, was.status::text AS was`,
    [turmaIds],
  );
  const fees = await tx.query<{ id: string; ends_on: string }>(
    `SELECT id, to_char(ends_on, 'YYYY-MM-DD') AS ends_on
       FROM student_fee
      WHERE enrollment_id = ANY($1::uuid[]) AND archived_at IS NULL
        AND updated_at = now() AND ends_on = club_today()`,
    [ended.rows.map((row) => row.id)],
  );

  // Future lessons nothing points at yet; a lesson somebody already used stays as a record.
  const archivedSlots = slots.rows.map((row) => row.id);
  const removed = await tx.query(
    `DELETE FROM class_session s
      WHERE s.schedule_id = ANY($1::uuid[]) AND s.occurs_on >= club_today()
        AND NOT EXISTS (SELECT 1 FROM attendance x WHERE x.class_session_id = s.id)
        AND NOT EXISTS (SELECT 1 FROM reposicao_credit x WHERE x.class_session_id = s.id)
        AND NOT EXISTS (SELECT 1 FROM reposicao_booking x WHERE x.class_session_id = s.id)
        AND NOT EXISTS (SELECT 1 FROM lead x WHERE x.trial_session_id = s.id)
        AND NOT EXISTS (SELECT 1 FROM lesson_feedback x WHERE x.class_session_id = s.id)
        AND NOT EXISTS (SELECT 1 FROM session_notice x WHERE x.class_session_id = s.id)
        AND NOT EXISTS (SELECT 1 FROM message x WHERE x.class_session_id = s.id)
        AND NOT EXISTS (SELECT 1 FROM student_record x WHERE x.class_session_id = s.id)
        AND NOT EXISTS (SELECT 1 FROM lesson_request x WHERE x.class_session_id = s.id)`,
    [archivedSlots],
  );
  const { rows: left } = await tx.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM class_session WHERE schedule_id = ANY($1::uuid[]) AND occurs_on >= club_today()`,
    [archivedSlots],
  );
  void removed;

  return {
    cascade: [
      ...turmas.rows.map((row) => ({ entityType: 'class_group' as const, id: row.id })),
      ...archivedSlots.map((id) => ({ entityType: 'class_schedule' as const, id })),
      ...ended.rows.map((row) => ({ entityType: 'enrollment' as const, id: row.id, status: row.was })),
      ...fees.rows.map((row) => ({ entityType: 'student_fee.ends_on' as const, id: row.id, endsOn: row.ends_on })),
    ],
    lessonsKept: left[0]?.n ?? 0,
  };
}

/** Replace: one bin entry per pool, on the pool, listing everything its calendar lost. */
export async function archiveCalendarIn(
  tx: Tx,
  facilityId: string,
  seasonId: string,
  poolIds: string[],
  keepTurmaIds: string[],
): Promise<void> {
  for (const poolId of poolIds) {
    const plan = await replacedBy(tx, facilityId, seasonId, [poolId], keepTurmaIds);
    if (plan.slotIds.size === 0 && plan.turmaIds.size === 0) continue;
    const { cascade } = await archiveTurmasAndSlotsIn(tx, [...plan.turmaIds], [...plan.slotIds]);
    const { rows } = await tx.query<{ name: string }>(`SELECT name FROM pool WHERE id = $1`, [poolId]);
    await recordAudit(tx, {
      action: 'timetable.calendarReplaced',
      entityType: 'calendar_replaced',
      entityId: poolId,
      data: { name: rows[0]?.name ?? null, cascade },
    });
  }
}

export interface TimetableImportRecord {
  id: string;
  fileName: string | null;
  createdAt: string;
  createdByName: string | null;
  poolNames: string[];
  turmasCreated: number;
  slotsCreated: number;
  replaced: boolean;
  undone: boolean;
}

/** The site's imports, newest first — for *Importações* and its Desfazer. */
export async function listTimetableImports(organizationId: string, facilityId: string): Promise<TimetableImportRecord[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      file_name: string | null;
      created_at: Date;
      created_by_name: string | null;
      pool_names: string[] | null;
      turmas_created: number;
      slots_created: number;
      replaced: boolean;
      undone: boolean;
    }>(
      `SELECT ti.id, ti.file_name, ti.created_at, ti.turmas_created, ti.slots_created, ti.replaced,
              ti.archived_at IS NOT NULL AS undone,
              nullif(btrim(concat_ws(' ', coalesce(u.cached_first_name, m.first_name), coalesce(u.cached_last_name, m.last_name))), '') AS created_by_name,
              (SELECT array_agg(p.name ORDER BY p.name) FROM pool p WHERE p.id = ANY(ti.pool_ids)) AS pool_names
         FROM timetable_import ti
         LEFT JOIN membership m ON m.id = ti.created_by_membership_id AND m.organization_id = ti.organization_id
         LEFT JOIN app_user u ON u.id = m.app_user_id
        WHERE ti.facility_id = $1
        ORDER BY ti.created_at DESC
        LIMIT 20`,
      [facilityId],
    );
    return rows.map((row) => ({
      id: row.id,
      fileName: row.file_name,
      createdAt: row.created_at.toISOString(),
      createdByName: row.created_by_name,
      poolNames: row.pool_names ?? [],
      turmasCreated: row.turmas_created,
      slotsCreated: row.slots_created,
      replaced: row.replaced,
      undone: row.undone,
    }));
  });
}

/** What undoing an import would touch: its turmas with students, for the question. Null when not found. */
export async function importInUse(
  organizationId: string,
  importId: string,
): Promise<{ id: string; name: string; students: number }[] | null> {
  return withOrg(organizationId, async (tx) => {
    const found = await tx.query(`SELECT 1 FROM timetable_import WHERE id = $1 AND archived_at IS NULL`, [importId]);
    if (found.rowCount === 0) return null;
    const { rows } = await tx.query<{ id: string; name: string; students: number }>(
      `SELECT cg.id, cg.name,
              (SELECT count(*)::int FROM enrollment e WHERE e.class_group_id = cg.id AND e.status <> 'ended') AS students
         FROM class_group cg
        WHERE cg.timetable_import_id = $1 AND cg.archived_at IS NULL`,
      [importId],
    );
    return rows.filter((row) => row.students > 0);
  });
}

/**
 * *Desfazer importação*: archive what it wrote — its new turmas and every slot
 * it added (to existing turmas too) — except turmas with students not ticked,
 * and their slots. One bin entry on the import. Null when not found or undone.
 */
export async function undoTimetableImport(
  organizationId: string,
  importId: string,
  archiveInUse: string[],
): Promise<{ turmas: number; slots: number; lessonsKept: number } | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows: found } = await tx.query<{ file_name: string | null }>(
      `UPDATE timetable_import SET archived_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING file_name`,
      [importId],
    );
    if (found.length === 0) return null;

    const ticked = new Set(archiveInUse);
    const { rows: turmas } = await tx.query<{ id: string; students: number }>(
      `SELECT cg.id, (SELECT count(*)::int FROM enrollment e WHERE e.class_group_id = cg.id AND e.status <> 'ended') AS students
         FROM class_group cg WHERE cg.timetable_import_id = $1 AND cg.archived_at IS NULL`,
      [importId],
    );
    const kept = new Set(turmas.filter((turma) => turma.students > 0 && !ticked.has(turma.id)).map((turma) => turma.id));
    const turmaIds = turmas.map((turma) => turma.id).filter((id) => !kept.has(id));
    const { rows: slots } = await tx.query<{ id: string }>(
      `SELECT id FROM class_schedule
        WHERE timetable_import_id = $1 AND archived_at IS NULL
          AND (class_group_id IS NULL OR NOT (class_group_id = ANY($2::uuid[])))`,
      [importId, [...kept]],
    );

    const { cascade, lessonsKept } = await archiveTurmasAndSlotsIn(tx, turmaIds, slots.map((slot) => slot.id));
    await recordAudit(tx, {
      action: 'timetable.importUndone',
      entityType: 'timetable_import',
      entityId: importId,
      data: { name: found[0]!.file_name, cascade },
    });
    return {
      turmas: cascade.filter((item) => item.entityType === 'class_group').length,
      slots: cascade.filter((item) => item.entityType === 'class_schedule').length,
      lessonsKept,
    };
  });
}
