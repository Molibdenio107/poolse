import { withOrg } from '@poolse/db';

/**
 * The family band's reads — POOLSE-66 slice 5, built 15 October 2026.
 *
 * Every read is about **one student**, chosen by the controller from the
 * reader's own records (`familyStudents`); nothing here decides whose child it
 * is. "Their lesson" is a session of a turma the student was enrolled in on the
 * day it falls — joined on or before it, not ended before it, not merely
 * waiting — the same predicate `familyMayReadPlan` uses, so the card and the
 * plan read cannot disagree about which lessons are theirs. A parceria has no
 * students and never appears.
 *
 * Days are the site's (`facility.timezone`), and the month is `club_today()`'s.
 */

const TZ = `coalesce(f.timezone, 'Europe/Lisbon')`;

/** The student's enrolment covering the session's day. `$1` is the student. */
const ENROLLED_THAT_DAY = `
  JOIN enrollment e
    ON e.organization_id = cs.organization_id
   AND e.class_group_id = cs.class_group_id
   AND e.student_id = $1
   AND e.status <> 'waiting'
   AND e.joined_on <= cs.occurs_on
   AND (e.ended_on IS NULL OR e.ended_on >= cs.occurs_on)
`;

export interface ChildNextClass {
  sessionId: string;
  className: string;
  levelName: string | null;
  poolId: string | null;
  poolName: string | null;
  /** Lane positions, in pool order. Empty when nobody has placed it. */
  lanes: number[];
  /** `YYYY-MM-DD` and `HH:MM` on the site's clock — the week's own hour. */
  localDate: string;
  localTime: string;
  durationMinutes: number;
  /** 0 is today on the site's clock, 1 tomorrow. */
  dayOffset: number;
  /** ISO weekday, Monday 1. */
  weekday: number;
  /** Whoever teaches that lesson: the stand-in when one is set. */
  instructorName: string | null;
}

/**
 * The child's next lesson that is still to happen and not cancelled — so a
 * cancelled week gives the following one (QA 5), and a week moved by hand is
 * read at its new hour, because this reads `class_session` and not the pattern
 * (QA 7).
 */
export async function readChildNextClass(
  organizationId: string,
  studentId: string,
): Promise<ChildNextClass | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      class_name: string;
      level_name: string | null;
      pool_id: string | null;
      pool_name: string | null;
      lanes: number[];
      local_date: string;
      local_time: string;
      duration_minutes: number;
      day_offset: number;
      weekday: number;
      instructor_name: string | null;
    }>(
      `SELECT cs.id,
              cg.name AS class_name,
              l.name AS level_name,
              p.id AS pool_id,
              p.name AS pool_name,
              coalesce((
                SELECT array_agg(ln.position ORDER BY ln.position)
                  FROM class_session_lane csl
                  JOIN lane ln ON ln.id = csl.lane_id
                 WHERE csl.session_id = cs.id
              ), '{}') AS lanes,
              to_char(cs.starts_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS local_date,
              to_char(cs.starts_at AT TIME ZONE ${TZ}, 'HH24:MI')    AS local_time,
              cs.duration_minutes,
              ((cs.starts_at AT TIME ZONE ${TZ})::date - (now() AT TIME ZONE ${TZ})::date)::int
                AS day_offset,
              extract(ISODOW FROM cs.starts_at AT TIME ZONE ${TZ})::int AS weekday,
              short_name(coalesce(iu.cached_first_name, im.first_name),
                         coalesce(iu.cached_last_name,  im.last_name)) AS instructor_name
         FROM class_session cs
         JOIN class_group cg
           ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
         ${ENROLLED_THAT_DAY}
         LEFT JOIN student_level l
                ON l.id = cg.level_id AND l.organization_id = cs.organization_id
         LEFT JOIN pool p
                ON p.id = cs.pool_id AND p.organization_id = cs.organization_id
         LEFT JOIN facility f
                ON f.id = p.facility_id AND f.organization_id = cs.organization_id
         LEFT JOIN membership im
                ON im.id = cs.resolved_instructor_id AND im.organization_id = cs.organization_id
         LEFT JOIN app_user iu ON iu.id = im.app_user_id
        WHERE cs.status <> 'cancelled'
          AND cs.ends_at > now()
        ORDER BY cs.starts_at, cs.id
        LIMIT 1`,
      [studentId],
    );

    const row = rows[0];
    if (row === undefined) return null;
    return {
      sessionId: row.id,
      className: row.class_name,
      levelName: row.level_name,
      poolId: row.pool_id,
      poolName: row.pool_name,
      lanes: row.lanes,
      localDate: row.local_date,
      localTime: row.local_time,
      durationMinutes: row.duration_minutes,
      dayOffset: row.day_offset,
      weekday: row.weekday,
      instructorName: row.instructor_name,
    };
  });
}

export interface ChildAttendance {
  /** `YYYY-MM`, the club's current month. */
  month: string;
  /** Lessons of theirs this month that have started and were not cancelled. */
  held: number;
  present: number;
  absent: number;
  excused: number;
  /** Held, and the register says nothing about them yet. */
  unmarked: number;
}

/**
 * This month so far — Rui, 15 October 2026: the calendar month on the club's
 * clock, not the fee period. Null when nothing of theirs has been held yet.
 */
export async function readChildAttendance(
  organizationId: string,
  studentId: string,
): Promise<ChildAttendance | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      month: string;
      held: number;
      present: number;
      absent: number;
      excused: number;
    }>(
      `SELECT to_char(club_today(), 'YYYY-MM') AS month,
              count(*)::int AS held,
              count(*) FILTER (WHERE a.status = 'present')::int AS present,
              count(*) FILTER (WHERE a.status = 'absent')::int  AS absent,
              count(*) FILTER (WHERE a.status = 'excused')::int AS excused
         FROM class_session cs
         ${ENROLLED_THAT_DAY}
         LEFT JOIN attendance a
                ON a.class_session_id = cs.id
               AND a.organization_id = cs.organization_id
               AND a.student_id = $1
        WHERE cs.status <> 'cancelled'
          AND cs.starts_at <= now()
          AND cs.occurs_on >= date_trunc('month', club_today())::date
          AND cs.occurs_on <= club_today()`,
      [studentId],
    );

    const row = rows[0];
    if (row === undefined || row.held === 0) return null;
    return {
      month: row.month,
      held: row.held,
      present: row.present,
      absent: row.absent,
      excused: row.excused,
      unmarked: row.held - row.present - row.absent - row.excused,
    };
  });
}

export interface PoolTemperature {
  poolName: string;
  /** Degrees Celsius as recorded — a string, because the column is numeric. */
  celsius: string;
  /** When the sample was taken, on the site's clock. */
  localDate: string;
  localTime: string;
}

/**
 * The latest recorded water temperature of one pool — temperature only, by
 * Rui's call: the chemistry belongs to the public water page, where a club
 * opens one.
 */
export async function readPoolTemperature(
  organizationId: string,
  poolId: string,
): Promise<PoolTemperature | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<PoolTemperature>(
      `SELECT p.name AS "poolName",
              v.value::text AS celsius,
              to_char(pa.taken_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS "localDate",
              to_char(pa.taken_at AT TIME ZONE ${TZ}, 'HH24:MI')    AS "localTime"
         FROM pool_analysis pa
         JOIN pool_analysis_value v
           ON v.analysis_id = pa.id AND v.organization_id = pa.organization_id
          AND v.metric = 'temperature'
         JOIN pool p ON p.id = pa.pool_id AND p.organization_id = pa.organization_id
         LEFT JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
        WHERE pa.pool_id = $1 AND pa.archived_at IS NULL
        ORDER BY pa.taken_at DESC
        LIMIT 1`,
      [poolId],
    );
    return rows[0] ?? null;
  });
}
