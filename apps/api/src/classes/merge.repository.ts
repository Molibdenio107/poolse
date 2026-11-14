import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';

/**
 * *Juntar turmas* — Rui, 14-11-2026.
 *
 * A turma is a group of students. A timetable import cannot know who is in each
 * class, so it made one turma per hour; when two of those are really the same
 * people, the office joins them. Everything the others hold moves into the one
 * kept — its weekly slots, its lessons (taught ones included, with their
 * registers), its students, its plans and challenges, the leads and transfers
 * pointing at it — and the others are archived, empty. One transaction.
 *
 * Refused, with nothing written, when:
 * - a turma is not this club's, archived, or of another season (`not_found` / `other_season`);
 * - two of them meet on the same weekday at the same hour (`same_hour`): one turma
 *   cannot have the same slot twice, and that pair is two groups, not one;
 * - the students would not fit the kept turma's capacity (`over_capacity`, with numbers).
 * A student clash (POOLSE-144) is the trigger's, and the caller maps it.
 *
 * Not undone through the bin: the archived turmas come back empty. The audit
 * entry lists what moved.
 */
export type MergeRefusal =
  | { refused: 'not_found' }
  | { refused: 'other_season' }
  | { refused: 'same_hour'; weekday: number; startTime: string }
  | { refused: 'over_capacity'; capacity: number; students: number }
  | { refused: 'name_taken' };

/** Thrown inside the transaction so everything before it rolls back. */
export class MergeNameTaken extends Error {
  constructor() {
    super('merge_name_taken');
  }
}

export interface MergeDone {
  refused: null;
  slots: number;
  students: number;
  turmas: number;
}

export async function mergeClassGroups(
  organizationId: string,
  targetId: string,
  sourceIds: string[],
  /** The joined turma's name, else it keeps its own. */
  name: string | null = null,
): Promise<MergeDone | MergeRefusal> {
  try {
    return await withOrg(organizationId, async (tx) =>
      mergeIn(tx, targetId, [...new Set(sourceIds)].filter((id) => id !== targetId), name),
    );
  } catch (error) {
    if (error instanceof MergeNameTaken) return { refused: 'name_taken' };
    throw error;
  }
}

async function mergeIn(tx: Tx, targetId: string, sourceIds: string[], name: string | null): Promise<MergeDone | MergeRefusal> {
  if (sourceIds.length === 0) return { refused: 'not_found' };
  const all = [targetId, ...sourceIds];
  const { rows: groups } = await tx.query<{ id: string; season_id: string; capacity: number | null }>(
    `SELECT id, season_id, capacity FROM class_group
      WHERE id = ANY($1::uuid[]) AND archived_at IS NULL
      FOR UPDATE`,
    [all],
  );
  if (groups.length !== all.length) return { refused: 'not_found' };
  const target = groups.find((group) => group.id === targetId)!;
  if (groups.some((group) => group.season_id !== target.season_id)) return { refused: 'other_season' };

  const { rows: twice } = await tx.query<{ weekday: number; start_time: string }>(
    `SELECT weekday, to_char(start_time, 'HH24:MI') AS start_time
       FROM class_schedule
      WHERE class_group_id = ANY($1::uuid[]) AND archived_at IS NULL
      GROUP BY weekday, start_time
     HAVING count(*) > 1
      ORDER BY weekday, start_time
      LIMIT 1`,
    [all],
  );
  if (twice[0] !== undefined) {
    return { refused: 'same_hour', weekday: twice[0].weekday, startTime: twice[0].start_time };
  }

  const { rows: people } = await tx.query<{ n: number }>(
    `SELECT count(DISTINCT student_id)::int AS n FROM enrollment
      WHERE class_group_id = ANY($1::uuid[]) AND status = 'active'`,
    [all],
  );
  const students = people[0]?.n ?? 0;
  if (target.capacity !== null && students > target.capacity) {
    return { refused: 'over_capacity', capacity: target.capacity, students };
  }

  const slots = await tx.query(
    `UPDATE class_schedule SET class_group_id = $1
      WHERE class_group_id = ANY($2::uuid[]) AND archived_at IS NULL`,
    [targetId, sourceIds],
  );
  await tx.query(`UPDATE class_session SET class_group_id = $1 WHERE class_group_id = ANY($2::uuid[])`, [
    targetId,
    sourceIds,
  ]);

  // A student already in the kept turma has the second enrolment ended; the rest move, fees and all.
  await tx.query(
    `UPDATE enrollment e SET status = 'ended', ended_on = club_today()
      WHERE e.class_group_id = ANY($2::uuid[]) AND e.status <> 'ended'
        AND EXISTS (SELECT 1 FROM enrollment k
                     WHERE k.class_group_id = $1 AND k.student_id = e.student_id AND k.status <> 'ended')`,
    [targetId, sourceIds],
  );
  // One student in two of the joined turmas: the first enrolment moves, the others end.
  await tx.query(
    `UPDATE enrollment e SET status = 'ended', ended_on = club_today()
      WHERE e.class_group_id = ANY($1::uuid[]) AND e.status <> 'ended'
        AND EXISTS (SELECT 1 FROM enrollment o
                     WHERE o.class_group_id = ANY($1::uuid[]) AND o.student_id = e.student_id
                       AND o.status <> 'ended' AND o.id < e.id)`,
    [sourceIds],
  );
  const moved = await tx.query(
    `UPDATE enrollment SET class_group_id = $1
      WHERE class_group_id = ANY($2::uuid[]) AND status <> 'ended'`,
    [targetId, sourceIds],
  );

  // A plan or a challenge is one per turma per day: the kept turma's wins, the other is archived.
  for (const table of ['lesson_plan', 'lesson_challenge'] as const) {
    await tx.query(
      `UPDATE ${table} x SET archived_at = now()
        WHERE x.class_group_id = ANY($2::uuid[]) AND x.archived_at IS NULL
          AND EXISTS (SELECT 1 FROM ${table} k
                       WHERE k.class_group_id = $1 AND k.on_date = x.on_date AND k.archived_at IS NULL)`,
      [targetId, sourceIds],
    );
    await tx.query(
      `UPDATE ${table} x SET archived_at = now()
        WHERE x.class_group_id = ANY($1::uuid[]) AND x.archived_at IS NULL
          AND EXISTS (SELECT 1 FROM ${table} o
                       WHERE o.class_group_id = ANY($1::uuid[]) AND o.on_date = x.on_date
                         AND o.archived_at IS NULL AND o.id < x.id)`,
      [sourceIds],
    );
    await tx.query(
      `UPDATE ${table} SET class_group_id = $1 WHERE class_group_id = ANY($2::uuid[]) AND archived_at IS NULL`,
      [targetId, sourceIds],
    );
  }
  await tx.query(`UPDATE lead SET requested_class_group_id = $1 WHERE requested_class_group_id = ANY($2::uuid[])`, [
    targetId,
    sourceIds,
  ]);
  await tx.query(`UPDATE transfer_proposal SET to_class_group_id = $1 WHERE to_class_group_id = ANY($2::uuid[])`, [
    targetId,
    sourceIds,
  ]);

  await tx.query(`UPDATE class_group SET archived_at = now() WHERE id = ANY($1::uuid[])`, [sourceIds]);
  if (name !== null) {
    // "Masters · 07:00" joined with "Masters · 19:00" is "Masters" — unless another live turma has it.
    const { rowCount } = await tx.query(
      `SELECT 1 FROM class_group WHERE archived_at IS NULL AND id <> $1 AND lower(strip_accents(name)) = lower(strip_accents($2))`,
      [targetId, name],
    );
    if ((rowCount ?? 0) > 0) throw new MergeNameTaken();
    await tx.query(`UPDATE class_group SET name = $2 WHERE id = $1`, [targetId, name]);
  }
  await recordAudit(tx, {
    action: 'class_group.merged',
    entityType: 'class_group',
    entityId: targetId,
    data: { from: sourceIds, slots: slots.rowCount ?? 0, enrolments: moved.rowCount ?? 0 },
  });

  return { refused: null, slots: slots.rowCount ?? 0, students, turmas: sourceIds.length };
}
