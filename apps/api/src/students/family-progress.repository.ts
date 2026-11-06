import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import type { Course } from './records.repository.js';

/**
 * What a family records on *Progressos* (Rui, 06-11-2026): its own swim times,
 * marked `self_reported`. Who may write is `family_may_answer()`, the rule
 * *Vem à aula?* reads. A family removes only what it entered.
 */

export interface ProgressPool {
  id: string;
  name: string;
  facilityName: string;
  /** Null where the club has not set it. */
  lengthM: number | null;
}

export async function mayEnterProgress(
  organizationId: string,
  studentId: string,
  membershipId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ ok: boolean }>(
      'SELECT family_may_answer($1, $2, $3) AS ok',
      [organizationId, studentId, membershipId],
    );
    return rows[0]?.ok === true;
  });
}

/** Every live tank, by site, with its length: what a time was swum in. */
export async function listProgressPools(organizationId: string): Promise<ProgressPool[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<ProgressPool>(
      `SELECT p.id, p.name, f.name AS "facilityName", p.length_m::float8 AS "lengthM"
         FROM pool p
         JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
        WHERE p.organization_id = $1 AND p.archived_at IS NULL AND f.archived_at IS NULL
        ORDER BY f.name, p.name`,
      [organizationId],
    );
    return rows;
  });
}

/**
 * The course a tank's length gives. Null for any other length: a best is per 25 m
 * or 50 m, and a 33 m pool is neither, so nobody guesses (POOLSE-81).
 */
export function courseOfLength(lengthM: number | null): Course | null {
  return lengthM === 25 ? 'scm' : lengthM === 50 ? 'lcm' : null;
}

export interface ProgressLesson {
  id: string;
  /** The lesson's own day: a time swum in it takes this date. */
  day: string;
  time: string;
  className: string;
}

/**
 * The child's own lessons of the last 60 days, newest first: what a time can be
 * filed under. Only turmas this child was in that day, and `class_group` is joined
 * rather than left joined because a parceria has no students to pick from it.
 */
export async function listProgressLessons(organizationId: string, studentId: string): Promise<ProgressLesson[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<ProgressLesson>(
      `SELECT cs.id, to_char(cs.occurs_on, 'YYYY-MM-DD') AS day,
              to_char(cs.starts_at AT TIME ZONE f.timezone, 'HH24:MI') AS time,
              cg.name AS "className"
         FROM class_session cs
         JOIN class_group cg ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
         JOIN facility f ON f.id = cg.facility_id AND f.organization_id = cg.organization_id
         JOIN enrollment e
           ON e.class_group_id = cg.id AND e.organization_id = cg.organization_id
          AND e.student_id = $2 AND e.status <> 'waiting'
          AND e.joined_on <= cs.occurs_on AND (e.ended_on IS NULL OR e.ended_on >= cs.occurs_on)
        WHERE cs.organization_id = $1
          AND cs.status <> 'cancelled'
          AND cs.starts_at <= now()
          AND cs.occurs_on >= club_today() - 60
        ORDER BY cs.starts_at DESC
        LIMIT 30`,
      [organizationId, studentId],
    );
    return rows;
  });
}

/** A family takes back a time it typed, and nothing else. */
export async function archiveOwnTime(
  organizationId: string,
  studentId: string,
  recordId: string,
  membershipId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE student_record SET archived_at = now()
        WHERE organization_id = $1 AND student_id = $2 AND id = $3 AND archived_at IS NULL
          AND self_reported AND recorded_by_membership_id = $4`,
      [organizationId, studentId, recordId, membershipId],
    );
    if ((rowCount ?? 0) === 0) return false;
    await recordAudit(tx, {
      action: 'student_record.archived',
      entityType: 'student',
      entityId: studentId,
      data: { recordId, selfReported: true },
    });
    return true;
  });
}
