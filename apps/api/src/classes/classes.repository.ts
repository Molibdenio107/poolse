import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';

export interface ScheduleSlot {
  id: string;
  /** ISO weekday: Monday 1 … Sunday 7. */
  weekday: number;
  /** Wall-clock at the facility, "HH:MM". Never an instant — see the migration. */
  startTime: string;
  durationMinutes: number;
}

export interface EnrolledStudent {
  enrollmentId: string;
  studentId: string;
  firstName: string;
  lastName: string;
  status: 'active' | 'waiting';
  waitingPosition: number | null;
}

export interface ClassGroup {
  id: string;
  name: string;
  levelId: string | null;
  levelName: string | null;
  poolId: string | null;
  poolName: string | null;
  instructorMembershipId: string | null;
  instructorName: string | null;
  capacity: number | null;
  lane: number | null;
  schedules: ScheduleSlot[];
  students: EnrolledStudent[];
}

export class DuplicateNameError extends Error {}
export class FullError extends Error {}
export class AlreadyEnrolledError extends Error {}

/**
 * Every turma, with its pattern and everybody in it.
 *
 * One query rather than three, because both screens this feeds need all of it at
 * once: the week grid shows who is in each slot, and the list shows how full each
 * turma is. Fetching students separately would be a request per turma — the
 * classic shape that looks fine with three of them and falls over with thirty.
 */
const GROUP_COLUMNS = `
  cg.id,
  cg.name,
  cg.level_id,
  l.name  AS level_name,
  cg.pool_id,
  p.name  AS pool_name,
  cg.instructor_membership_id,
  nullif(btrim(coalesce(u.cached_first_name, '') || ' ' ||
               coalesce(u.cached_last_name, '')), '') AS instructor_name,
  cg.capacity,
  cg.lane,
  (
    SELECT coalesce(
             json_agg(
               json_build_object('id', cs.id, 'weekday', cs.weekday,
                                 'startTime', to_char(cs.start_time, 'HH24:MI'),
                                 'durationMinutes', cs.duration_minutes)
               ORDER BY cs.weekday, cs.start_time
             ), '[]'::json)
      FROM class_schedule cs
     WHERE cs.organization_id = cg.organization_id
       AND cs.class_group_id = cg.id
       AND cs.archived_at IS NULL
  ) AS schedules,
  (
    SELECT coalesce(
             json_agg(
               json_build_object('enrollmentId', e.id, 'studentId', s.id,
                                 'firstName', s.first_name, 'lastName', s.last_name,
                                 'status', e.status, 'waitingPosition', e.waiting_position)
               ORDER BY e.status, e.waiting_position NULLS FIRST, s.last_name, s.first_name
             ), '[]'::json)
      FROM enrollment e
      JOIN student s
        ON s.id = e.student_id AND s.organization_id = e.organization_id
     WHERE e.organization_id = cg.organization_id
       AND e.class_group_id = cg.id
       AND e.status <> 'ended'
       AND s.archived_at IS NULL
  ) AS students
`;

const GROUP_JOINS = `
  FROM class_group cg
  LEFT JOIN student_level l ON l.id = cg.level_id AND l.organization_id = cg.organization_id
  LEFT JOIN pool p         ON p.id = cg.pool_id  AND p.organization_id = cg.organization_id
  LEFT JOIN membership m   ON m.id = cg.instructor_membership_id
                          AND m.organization_id = cg.organization_id
  LEFT JOIN app_user u     ON u.id = m.app_user_id
`;

interface GroupRow {
  id: string;
  name: string;
  level_id: string | null;
  level_name: string | null;
  pool_id: string | null;
  pool_name: string | null;
  instructor_membership_id: string | null;
  instructor_name: string | null;
  capacity: number | null;
  lane: number | null;
  schedules: ScheduleSlot[] | null;
  students: EnrolledStudent[] | null;
}

function toGroup(row: GroupRow): ClassGroup {
  return {
    id: row.id,
    name: row.name,
    levelId: row.level_id,
    levelName: row.level_name,
    poolId: row.pool_id,
    poolName: row.pool_name,
    instructorMembershipId: row.instructor_membership_id,
    instructorName: row.instructor_name,
    capacity: row.capacity,
    lane: row.lane,
    schedules: row.schedules ?? [],
    students: row.students ?? [],
  };
}

export async function listClassGroups(organizationId: string): Promise<ClassGroup[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<GroupRow>(
      `SELECT ${GROUP_COLUMNS} ${GROUP_JOINS}
        WHERE cg.archived_at IS NULL
        ORDER BY cg.name`,
    );
    return rows.map(toGroup);
  });
}

export async function findClassGroup(
  organizationId: string,
  groupId: string,
): Promise<ClassGroup | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<GroupRow>(
      `SELECT ${GROUP_COLUMNS} ${GROUP_JOINS}
        WHERE cg.id = $1 AND cg.archived_at IS NULL`,
      [groupId],
    );
    const row = rows[0];
    return row ? toGroup(row) : null;
  });
}

export interface ClassGroupInput {
  name: string;
  levelId: string | null;
  poolId: string | null;
  instructorMembershipId: string | null;
  capacity: number | null;
  lane: number | null;
}

export async function createClassGroup(
  organizationId: string,
  input: ClassGroupInput,
): Promise<string> {
  try {
    return await withOrg(organizationId, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO class_group (
           organization_id, name, level_id, pool_id, instructor_membership_id, capacity, lane
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          organizationId,
          input.name,
          input.levelId,
          input.poolId,
          input.instructorMembershipId,
          input.capacity,
          input.lane,
        ],
      );

      const id = rows[0]?.id;
      if (!id) throw new Error('Could not create the class group');

      await recordAudit(tx, {
        action: 'class_group.created',
        entityType: 'class_group',
        entityId: id,
        data: { name: input.name },
      });

      return id;
    });
  } catch (error) {
    throw asDuplicate(error, input.name);
  }
}

export async function updateClassGroup(
  organizationId: string,
  groupId: string,
  input: ClassGroupInput,
): Promise<boolean> {
  try {
    return await withOrg(organizationId, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `UPDATE class_group
            SET name = $2, level_id = $3, pool_id = $4,
                instructor_membership_id = $5, capacity = $6, lane = $7
          WHERE id = $1 AND archived_at IS NULL
        RETURNING id`,
        [
          groupId,
          input.name,
          input.levelId,
          input.poolId,
          input.instructorMembershipId,
          input.capacity,
          input.lane,
        ],
      );
      if (!rows[0]) return false;

      await recordAudit(tx, {
        action: 'class_group.updated',
        entityType: 'class_group',
        entityId: groupId,
        data: { name: input.name },
      });
      return true;
    });
  } catch (error) {
    throw asDuplicate(error, input.name);
  }
}

/**
 * Archiving a turma ends the enrollments in it.
 *
 * Leaving them live would leave students attached to a class that no longer
 * runs, and every screen that lists "what is this child enrolled in" would have
 * to special-case it.
 */
export async function archiveClassGroup(
  organizationId: string,
  groupId: string,
): Promise<{ archived: boolean; ended: number }> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string; name: string }>(
      `UPDATE class_group SET archived_at = now()
        WHERE id = $1 AND archived_at IS NULL
      RETURNING id, name`,
      [groupId],
    );
    const group = rows[0];
    if (!group) return { archived: false, ended: 0 };

    await tx.query(
      `UPDATE class_schedule SET archived_at = now()
        WHERE class_group_id = $1 AND archived_at IS NULL`,
      [groupId],
    );

    const ended = await tx.query(
      `UPDATE enrollment SET status = 'ended', ended_on = current_date
        WHERE class_group_id = $1 AND status <> 'ended'`,
      [groupId],
    );

    await recordAudit(tx, {
      action: 'class_group.archived',
      entityType: 'class_group',
      entityId: groupId,
      data: { name: group.name, endedEnrollments: ended.rowCount ?? 0 },
    });

    return { archived: true, ended: ended.rowCount ?? 0 };
  });
}

// ---------------------------------------------------------------------------
// The weekly pattern
// ---------------------------------------------------------------------------

export async function addSchedule(
  organizationId: string,
  groupId: string,
  weekday: number,
  startTime: string,
  durationMinutes: number,
): Promise<'added' | 'not_found' | 'duplicate'> {
  return withOrg(organizationId, async (tx) => {
    const group = await tx.query(
      'SELECT 1 FROM class_group WHERE id = $1 AND archived_at IS NULL',
      [groupId],
    );
    if (group.rows.length === 0) return 'not_found';

    try {
      await tx.query(
        `INSERT INTO class_schedule (
           organization_id, class_group_id, weekday, start_time, duration_minutes
         ) VALUES ($1, $2, $3, $4::time, $5)`,
        [organizationId, groupId, weekday, startTime, durationMinutes],
      );
    } catch (error) {
      if (error instanceof Error && (error as { code?: string }).code === '23505') {
        return 'duplicate';
      }
      throw error;
    }

    await recordAudit(tx, {
      action: 'class_schedule.added',
      entityType: 'class_group',
      entityId: groupId,
      data: { weekday, startTime, durationMinutes },
    });

    return 'added';
  });
}

export async function removeSchedule(
  organizationId: string,
  groupId: string,
  scheduleId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE class_schedule SET archived_at = now()
        WHERE id = $1 AND class_group_id = $2 AND archived_at IS NULL
      RETURNING id`,
      [scheduleId, groupId],
    );
    if (!rows[0]) return false;

    await recordAudit(tx, {
      action: 'class_schedule.removed',
      entityType: 'class_group',
      entityId: groupId,
      data: { scheduleId },
    });
    return true;
  });
}

// ---------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------

/**
 * Puts a student in a turma, or on its waiting list.
 *
 * Capacity is checked here so the operator gets a sentence rather than a
 * constraint violation — but the guarantee is the locking trigger in the
 * database, because two people taking the last place at the same moment would
 * both pass this check.
 */
export async function enrol(
  organizationId: string,
  groupId: string,
  studentId: string,
  waiting: boolean,
): Promise<'enrolled' | 'waiting' | 'not_found'> {
  try {
    return await withOrg(organizationId, async (tx) => {
      const group = await tx.query<{ capacity: number | null }>(
        'SELECT capacity FROM class_group WHERE id = $1 AND archived_at IS NULL',
        [groupId],
      );
      if (!group.rows[0]) return 'not_found';

      const student = await tx.query(
        'SELECT 1 FROM student WHERE id = $1 AND archived_at IS NULL',
        [studentId],
      );
      if (student.rows.length === 0) return 'not_found';

      const status = waiting ? 'waiting' : 'active';
      const position = waiting
        ? (
            await tx.query<{ next: number }>(
              `SELECT coalesce(max(waiting_position), 0) + 1 AS next
                 FROM enrollment WHERE class_group_id = $1 AND status = 'waiting'`,
              [groupId],
            )
          ).rows[0]?.next ?? 1
        : null;

      await tx.query(
        `INSERT INTO enrollment (
           organization_id, class_group_id, student_id, status, waiting_position
         ) VALUES ($1, $2, $3, $4::enrollment_status, $5)`,
        [organizationId, groupId, studentId, status, position],
      );

      await recordAudit(tx, {
        action: 'enrollment.created',
        entityType: 'class_group',
        entityId: groupId,
        data: { studentId, status },
      });

      return waiting ? 'waiting' : 'enrolled';
    });
  } catch (error) {
    const code = error instanceof Error ? (error as { code?: string }).code : undefined;
    // 23505 is enrollment_live_uq; 23514 is the capacity trigger, which raises
    // with a check_violation code so it reads like the constraint it is.
    if (code === '23505') throw new AlreadyEnrolledError(studentId);
    if (code === '23514') throw new FullError(groupId);
    throw error;
  }
}

export async function endEnrollment(
  organizationId: string,
  groupId: string,
  enrollmentId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ student_id: string }>(
      `UPDATE enrollment
          SET status = 'ended', ended_on = current_date, waiting_position = NULL
        WHERE id = $1 AND class_group_id = $2 AND status <> 'ended'
      RETURNING student_id`,
      [enrollmentId, groupId],
    );
    if (!rows[0]) return false;

    await recordAudit(tx, {
      action: 'enrollment.ended',
      entityType: 'class_group',
      entityId: groupId,
      data: { studentId: rows[0].student_id },
    });
    return true;
  });
}

// ---------------------------------------------------------------------------
// One student's week
// ---------------------------------------------------------------------------

export interface TimetableEntry {
  classGroupId: string;
  className: string;
  levelName: string | null;
  poolName: string | null;
  instructorName: string | null;
  lane: number | null;
  weekday: number;
  startTime: string;
  durationMinutes: number;
  status: 'active' | 'waiting';
}

export async function timetableFor(
  organizationId: string,
  studentId: string,
): Promise<TimetableEntry[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      class_group_id: string;
      class_name: string;
      level_name: string | null;
      pool_name: string | null;
      instructor_name: string | null;
      lane: number | null;
      weekday: number;
      start_time: string;
      duration_minutes: number;
      status: 'active' | 'waiting';
    }>(
      `
      SELECT cg.id AS class_group_id,
             cg.name AS class_name,
             l.name AS level_name,
             p.name AS pool_name,
             nullif(btrim(coalesce(u.cached_first_name, '') || ' ' ||
                          coalesce(u.cached_last_name, '')), '') AS instructor_name,
             cg.lane,
             cs.weekday,
             to_char(cs.start_time, 'HH24:MI') AS start_time,
             cs.duration_minutes,
             e.status
        FROM enrollment e
        JOIN class_group cg
          ON cg.id = e.class_group_id AND cg.organization_id = e.organization_id
         AND cg.archived_at IS NULL
        JOIN class_schedule cs
          ON cs.class_group_id = cg.id AND cs.organization_id = cg.organization_id
         AND cs.archived_at IS NULL
        LEFT JOIN student_level l ON l.id = cg.level_id AND l.organization_id = cg.organization_id
        LEFT JOIN pool p         ON p.id = cg.pool_id  AND p.organization_id = cg.organization_id
        LEFT JOIN membership m   ON m.id = cg.instructor_membership_id
                                AND m.organization_id = cg.organization_id
        LEFT JOIN app_user u     ON u.id = m.app_user_id
       WHERE e.student_id = $1
         AND e.status <> 'ended'
       ORDER BY cs.weekday, cs.start_time
      `,
      [studentId],
    );

    return rows.map((row) => ({
      classGroupId: row.class_group_id,
      className: row.class_name,
      levelName: row.level_name,
      poolName: row.pool_name,
      instructorName: row.instructor_name,
      lane: row.lane,
      weekday: row.weekday,
      startTime: row.start_time,
      durationMinutes: row.duration_minutes,
      status: row.status,
    }));
  });
}

function asDuplicate(error: unknown, name: string): unknown {
  if (error instanceof Error && (error as { code?: string }).code === '23505') {
    return new DuplicateNameError(name);
  }
  return error;
}
