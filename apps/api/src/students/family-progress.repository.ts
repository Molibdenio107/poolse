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

export interface ProgressBest {
  stroke: string;
  distanceM: number;
  timeMs: number;
  swumOn: string;
}

export interface ProgressTime {
  id: string;
  stroke: string;
  distanceM: number;
  timeMs: number;
  swumOn: string;
  lessonName: string | null;
  meetName: string | null;
  official: boolean;
  selfReported: boolean;
}

/** How many times one read carries: a phone asks for the next ones as it scrolls. */
export const TIMES_PAGE = 20;

// A result whose meet was archived leaves with it, as the progression read has it.
const LIVE_RECORD = `r.organization_id = $1 AND r.student_id = $2 AND r.archived_at IS NULL
  AND (r.meet_id IS NULL OR sm.archived_at IS NULL)`;
const WITH_MEET = `LEFT JOIN swim_meet sm ON sm.id = r.meet_id AND sm.organization_id = r.organization_id`;

/**
 * The tab's first screen, in one read whatever the history's length: the fastest
 * swim per stroke and distance (Rui, 06-11-2026: one line each, so 25 m and 50 m
 * pools fold together here, unlike the office's bests), and the sum of the distances.
 */
export async function progressSummary(
  organizationId: string,
  studentId: string,
): Promise<{ bests: ProgressBest[]; totalDistanceM: number; timesTotal: number; favouriteStroke: string | null }> {
  return withOrg(organizationId, async (tx) => {
    const { rows: bests } = await tx.query<ProgressBest>(
      `SELECT DISTINCT ON (r.stroke, r.distance_m)
              r.stroke::text AS stroke, r.distance_m AS "distanceM", r.time_ms AS "timeMs",
              to_char(r.swum_on, 'YYYY-MM-DD') AS "swumOn"
         FROM student_record r
         ${WITH_MEET}
        WHERE ${LIVE_RECORD}
        ORDER BY r.stroke, r.distance_m, r.time_ms, r.swum_on`,
      [organizationId, studentId],
    );
    const { rows: totals } = await tx.query<{ metres: string; times: number; favourite: string | null }>(
      `SELECT coalesce(sum(r.distance_m), 0)::text AS metres, count(r.id)::int AS times,
              (SELECT favourite_stroke::text FROM student WHERE organization_id = $1 AND id = $2) AS favourite
         FROM student_record r
         ${WITH_MEET}
        WHERE ${LIVE_RECORD}`,
      [organizationId, studentId],
    );
    return {
      bests,
      totalDistanceM: Number(totals[0]?.metres ?? 0),
      timesTotal: totals[0]?.times ?? 0,
      favouriteStroke: totals[0]?.favourite ?? null,
    };
  });
}

/** One page of every time, newest first. */
export async function listProgressTimes(organizationId: string, studentId: string, offset: number): Promise<ProgressTime[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<ProgressTime>(
      `SELECT r.id, r.stroke::text AS stroke, r.distance_m AS "distanceM", r.time_ms AS "timeMs",
              to_char(r.swum_on, 'YYYY-MM-DD') AS "swumOn",
              lg.name AS "lessonName", sm.name AS "meetName",
              coalesce(sm.official, false) AS official, r.self_reported AS "selfReported"
         FROM student_record r
         ${WITH_MEET}
         LEFT JOIN class_session ls ON ls.id = r.class_session_id AND ls.organization_id = r.organization_id
         LEFT JOIN class_group lg ON lg.id = ls.class_group_id AND lg.organization_id = ls.organization_id
        WHERE ${LIVE_RECORD}
        ORDER BY r.swum_on DESC, r.recorded_at DESC
        LIMIT ${TIMES_PAGE} OFFSET $3`,
      [organizationId, studentId, offset],
    );
    return rows;
  });
}

export interface ProgressLesson {
  id: string;
  /** The lesson's own day: a time swum in it takes this date. */
  day: string;
  time: string;
  className: string;
}

/**
 * The child's own lessons of the last 30 days, newest first: what a time can be
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
          AND cs.occurs_on >= club_today() - 30
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
