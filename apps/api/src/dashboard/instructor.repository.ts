import { withOrg } from '@poolse/db';

/**
 * The instructor band's reads — POOLSE-66, slice 3.
 *
 * **"Mine" is `class_session.resolved_instructor_id`, and nothing else.** It is
 * the generated `coalesce(substitute, instructor)` that POOLSE-51 added for the
 * one-person-one-building exclusion, and the session's own instructor is stamped
 * from the booking or the turma when sessions are generated and re-stamped when
 * a turma changes hands. So a stand-in sees the class they are covering, the
 * regular instructor does not see it that week, and the dashboard cannot
 * disagree with the constraint that refuses a double booking — one definition.
 *
 * **Every join to `class_group` is LEFT.** A parceria session carries no
 * `class_group_id` and reaches its group through the booking; an inner join is
 * how partnership hours have vanished from three other queries in this
 * codebase. The instructor of a parceria is standing on the same deck.
 *
 * **Days are the site's.** "Hoje" and "amanhã" are a day offset computed in SQL
 * against the facility's timezone, never in the browser — a derived answer is
 * derived once, on the server — and the client only chooses the words for it.
 *
 * No money anywhere in here: AC 8, and asserted on the raw payload.
 */

/** Where a session's site lives, and so which clock "today" is read on. */
const TZ = `coalesce(f.timezone, 'Europe/Lisbon')`;

const JOINS = `
  FROM class_session cs
  LEFT JOIN class_group cg
         ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
  LEFT JOIN class_schedule sch
         ON sch.id = cs.schedule_id AND sch.organization_id = cs.organization_id
  LEFT JOIN partner_group pg
         ON pg.id = sch.partner_group_id AND pg.organization_id = sch.organization_id
  LEFT JOIN partner pa
         ON pa.id = pg.partner_id AND pa.organization_id = pg.organization_id
  LEFT JOIN student_level l
         ON l.id = coalesce(cg.level_id, pg.level_id) AND l.organization_id = cs.organization_id
  LEFT JOIN pool p
         ON p.id = cs.pool_id AND p.organization_id = cs.organization_id
  LEFT JOIN facility f
         ON f.id = coalesce(p.facility_id, sch.facility_id) AND f.organization_id = cs.organization_id
`;

/** The register has a mark on it: the class happened. */
const REGISTER_TAKEN = `EXISTS (
  SELECT 1 FROM attendance a
   WHERE a.class_session_id = cs.id AND a.organization_id = cs.organization_id
)`;

/**
 * Still the instructor's next thing to deal with.
 *
 * Upcoming or in progress — or **finished within the register window with no
 * register taken**, because "Marcar presenças" is the one action this card
 * exists to put in front of somebody, and moving on to next Tuesday the minute
 * the class ends would take it away while it is still owed. A parceria takes no
 * register, ever, so it moves on when it ends.
 */
const STILL_NEXT = `
  cs.status <> 'cancelled'
  AND cs.starts_at > now() - interval '90 minutes'
  AND (cs.ends_at > now() OR (cs.class_group_id IS NOT NULL AND NOT ${REGISTER_TAKEN}))
`;

export interface NextClass {
  sessionId: string;
  classGroupId: string | null;
  /** True for a partnership's hour. It has no register and no turma page. */
  partner: boolean;
  className: string;
  levelName: string | null;
  poolName: string | null;
  /** Lane positions, in pool order. Empty when nobody has placed it. */
  lanes: number[];
  startsAt: string;
  /** `YYYY-MM-DD` and `HH:MM` on the site's clock. */
  localDate: string;
  localTime: string;
  durationMinutes: number;
  /** 0 is today on the site's clock, 1 tomorrow, and so on. */
  dayOffset: number;
  /** ISO weekday, Monday 1. */
  weekday: number;
  /** Active enrolments for a turma, the school's headcount for a parceria. */
  enrolled: number;
  /** Null is "not measured" and is said as such, never as zero. */
  capacity: number | null;
  /** From 30 minutes before the start to 90 after, and only for a turma. */
  registerOpen: boolean;
  registerTaken: boolean;
  /** Set when the reader is the stand-in: whose class this normally is. */
  coveringFor: string | null;
}

interface NextRow {
  id: string;
  class_group_id: string | null;
  partner: boolean;
  class_name: string;
  level_name: string | null;
  pool_name: string | null;
  lanes: number[];
  starts_at: Date;
  local_date: string;
  local_time: string;
  duration_minutes: number;
  day_offset: number;
  weekday: number;
  enrolled: number;
  capacity: number | null;
  register_open: boolean;
  register_taken: boolean;
  covering_for: string | null;
}

/**
 * The reader's next class. Null when they teach nothing from now on.
 *
 * `plannable` narrows it to a lesson that can carry a plan — a turma, or a
 * parceria the club runs (`managed_lessons`) — which is the plan card's
 * question, and the same rule `occurrenceOf` applies before it answers.
 */
export async function readNextClass(
  organizationId: string,
  membershipId: string,
  options: { plannable?: boolean } = {},
): Promise<NextClass | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<NextRow>(
      `SELECT cs.id,
              cs.class_group_id,
              (cs.class_group_id IS NULL) AS partner,
              coalesce(cg.name, pg.name, sch.title, '?') AS class_name,
              l.name AS level_name,
              p.name AS pool_name,
              coalesce((
                SELECT array_agg(ln.position ORDER BY ln.position)
                  FROM class_session_lane csl
                  JOIN lane ln ON ln.id = csl.lane_id
                 WHERE csl.session_id = cs.id
              ), '{}') AS lanes,
              cs.starts_at,
              to_char(cs.starts_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS local_date,
              to_char(cs.starts_at AT TIME ZONE ${TZ}, 'HH24:MI')    AS local_time,
              cs.duration_minutes,
              ((cs.starts_at AT TIME ZONE ${TZ})::date - (now() AT TIME ZONE ${TZ})::date)::int
                AS day_offset,
              extract(ISODOW FROM cs.starts_at AT TIME ZONE ${TZ})::int AS weekday,
              (coalesce((
                SELECT count(*) FROM enrollment e
                 WHERE e.organization_id = cs.organization_id
                   AND e.class_group_id = cs.class_group_id
                   AND e.status = 'active'
              ), 0) + coalesce(CASE WHEN cs.class_group_id IS NULL THEN pg.participant_count END, 0))::int
                AS enrolled,
              cg.capacity,
              (cs.class_group_id IS NOT NULL
               AND now() BETWEEN cs.starts_at - interval '30 minutes'
                             AND cs.starts_at + interval '90 minutes') AS register_open,
              ${REGISTER_TAKEN} AS register_taken,
              CASE WHEN cs.substitute_instructor_membership_id = $1
                        AND cs.instructor_membership_id IS DISTINCT FROM $1
                   THEN short_name(coalesce(ru.cached_first_name, rm.first_name),
                                   coalesce(ru.cached_last_name,  rm.last_name))
              END AS covering_for
         ${JOINS}
         LEFT JOIN membership rm
                ON rm.id = cs.instructor_membership_id AND rm.organization_id = cs.organization_id
         LEFT JOIN app_user ru ON ru.id = rm.app_user_id
        WHERE cs.resolved_instructor_id = $1
          AND ${STILL_NEXT}
          AND ($2::boolean IS NOT TRUE
               OR cs.class_group_id IS NOT NULL
               OR coalesce(pa.managed_lessons, false))
        ORDER BY cs.starts_at, cs.id
        LIMIT 1`,
      [membershipId, options.plannable === true],
    );

    const row = rows[0];
    if (row === undefined) return null;

    return {
      sessionId: row.id,
      classGroupId: row.class_group_id,
      partner: row.partner,
      className: row.class_name,
      levelName: row.level_name,
      poolName: row.pool_name,
      lanes: row.lanes,
      startsAt: row.starts_at.toISOString(),
      localDate: row.local_date,
      localTime: row.local_time,
      durationMinutes: row.duration_minutes,
      dayOffset: row.day_offset,
      weekday: row.weekday,
      enrolled: row.enrolled,
      capacity: row.capacity,
      registerOpen: row.register_open,
      registerTaken: row.register_taken,
      coveringFor: row.covering_for,
    };
  });
}

export interface WeekClass {
  sessionId: string;
  classGroupId: string | null;
  partner: boolean;
  className: string;
  poolName: string | null;
  localDate: string;
  localTime: string;
  weekday: number;
  dayOffset: number;
  durationMinutes: number;
  cancelled: boolean;
  registerTaken: boolean;
  /** Already over on the site's clock. */
  past: boolean;
  /** Enrolled that day — null for a parceria, which counts heads, not students. */
  enrolled: number | null;
  /** *Não vou* answers on this lesson — POOLSE-90 slice 2. */
  notComing: number;
}

/**
 * The reader's classes this week, Monday to Sunday on each site's clock.
 *
 * **Cancelled ones included**, with the flag: a strip that silently dropped
 * Wednesday would read as Wednesday being free, and an instructor who planned
 * the drills for it is exactly the person who needs to be told it is off.
 *
 * The UTC window either side is there so the index narrows the rows before the
 * timezone cast does the exact work, the same pattern as today's occupancy.
 */
export async function readMyWeek(
  organizationId: string,
  membershipId: string,
): Promise<WeekClass[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      class_group_id: string | null;
      partner: boolean;
      class_name: string;
      pool_name: string | null;
      local_date: string;
      local_time: string;
      weekday: number;
      day_offset: number;
      duration_minutes: number;
      cancelled: boolean;
      register_taken: boolean;
      past: boolean;
      enrolled: number | null;
      not_coming: number;
    }>(
      `SELECT cs.id,
              cs.class_group_id,
              (cs.class_group_id IS NULL) AS partner,
              coalesce(cg.name, pg.name, sch.title, '?') AS class_name,
              p.name AS pool_name,
              to_char(cs.starts_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS local_date,
              to_char(cs.starts_at AT TIME ZONE ${TZ}, 'HH24:MI')    AS local_time,
              extract(ISODOW FROM cs.starts_at AT TIME ZONE ${TZ})::int AS weekday,
              ((cs.starts_at AT TIME ZONE ${TZ})::date - (now() AT TIME ZONE ${TZ})::date)::int
                AS day_offset,
              cs.duration_minutes,
              (cs.status = 'cancelled') AS cancelled,
              ${REGISTER_TAKEN} AS register_taken,
              (cs.ends_at <= now()) AS past,
              CASE WHEN cs.class_group_id IS NULL THEN NULL ELSE (
                SELECT count(*)::int FROM enrollment e
                 WHERE e.organization_id = cs.organization_id AND e.class_group_id = cs.class_group_id
                   AND e.status <> 'waiting'
                   AND e.joined_on <= cs.occurs_on AND (e.ended_on IS NULL OR e.ended_on >= cs.occurs_on)
              ) END AS enrolled,
              (SELECT count(*)::int FROM session_notice sn
                WHERE sn.organization_id = cs.organization_id AND sn.class_session_id = cs.id
                  AND NOT sn.going) AS not_coming
         ${JOINS}
        WHERE cs.resolved_instructor_id = $1
          AND cs.starts_at >= now() - interval '8 days'
          AND cs.starts_at <  now() + interval '8 days'
          AND date_trunc('week', cs.starts_at AT TIME ZONE ${TZ})
              = date_trunc('week', now() AT TIME ZONE ${TZ})
        ORDER BY cs.starts_at, cs.id`,
      [membershipId],
    );

    return rows.map((row) => ({
      sessionId: row.id,
      classGroupId: row.class_group_id,
      partner: row.partner,
      className: row.class_name,
      poolName: row.pool_name,
      localDate: row.local_date,
      localTime: row.local_time,
      weekday: row.weekday,
      dayOffset: row.day_offset,
      durationMinutes: row.duration_minutes,
      cancelled: row.cancelled,
      registerTaken: row.register_taken,
      past: row.past,
      enrolled: row.enrolled,
      notComing: row.not_coming,
    }));
  });
}

export interface MyTurma {
  id: string;
  name: string;
  levelName: string | null;
  students: number;
  capacity: number | null;
}

/**
 * The turmas this person is responsible for, with how many are in each.
 *
 * "Responsible" is `myTurmaIds`' union — the turma's own instructor, or named on
 * one of its bookings — written here as one grouped statement rather than that
 * function plus a count per turma, which is the loop the ticket forbids.
 * A stand-in for one Tuesday is not responsible for the turma; that is a
 * session's fact, and it is what the next-class card is for.
 */
export async function readMyTurmas(
  organizationId: string,
  membershipId: string,
): Promise<MyTurma[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      name: string;
      level_name: string | null;
      students: number;
      capacity: number | null;
    }>(
      `SELECT cg.id, cg.name, l.name AS level_name, cg.capacity,
              count(e.id) FILTER (WHERE e.status = 'active')::int AS students
         FROM class_group cg
         LEFT JOIN student_level l
                ON l.id = cg.level_id AND l.organization_id = cg.organization_id
         LEFT JOIN enrollment e
                ON e.class_group_id = cg.id AND e.organization_id = cg.organization_id
        WHERE cg.archived_at IS NULL
          AND (
            cg.instructor_membership_id = $1
            OR EXISTS (
              SELECT 1 FROM class_schedule cs
               WHERE cs.class_group_id = cg.id
                 AND cs.organization_id = cg.organization_id
                 AND cs.archived_at IS NULL
                 AND cs.instructor_membership_id = $1
            )
          )
        GROUP BY cg.id, cg.name, l.name, cg.capacity
        ORDER BY lower(cg.name), cg.id`,
      [membershipId],
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      levelName: row.level_name,
      students: row.students,
      capacity: row.capacity,
    }));
  });
}
