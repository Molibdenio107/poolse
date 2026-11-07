import { instructorPhotoSql } from '../tenant/app-view.js';
import { ENROLLED_IN_SESSION, NOT_COMING_TO_SESSION } from '../dashboard/instructor.repository.js';
import { withOrg } from '@poolse/db';
import { mayAnswer, needsBirthDate } from '../feedback/feedback.repository.js';

/**
 * The family agenda — POOLSE-90 slice 1.
 *
 * Every read here is about students the controller already chose from the
 * reader's own records (`familyStudents`); nothing here decides whose child it
 * is. "Their lesson" is the family band's rule (`family.repository.ts`): a
 * session of a turma the student was enrolled in on the day it lands — joined on
 * or before it, not ended before it, not merely waiting — the predicate
 * `familyMayReadPlan` reads too, so the agenda and the plan cannot disagree.
 *
 * It reads **`class_session`, never the pattern**: a week moved by hand is shown
 * where it lands, and a cancelled or closed week is shown cancelled, in words.
 * A closure is not re-derived here. `apply_closures` already cancelled every
 * session it reaches (through `session_reach`, lanes included) and stamped its
 * `closure_id`, so the session itself says it was closed. A parceria and a
 * free-swim block have no turma and no students, and never appear.
 *
 * Coming lessons only (Rui, 21-10-2026, Open 1): from now, on the club's clock,
 * for two weeks. **One lesson by id also answers once it is over**, inside the
 * feedback window (POOLSE-116), so a family can say how it went; the list
 * itself stays coming lessons, and the past ones are `readRecent`'s.
 */

const TZ = `coalesce(f.timezone, 'Europe/Lisbon')`;

/** The agenda's window, in days from the club's today. */
export const AGENDA_DAYS = 14;

export interface AgendaEntry {
  studentId: string;
  sessionId: string;
  className: string;
  levelName: string | null;
  siteName: string | null;
  poolId: string | null;
  poolName: string | null;
  lanes: number[];
  /** `YYYY-MM-DD` and `HH:MM` on the site's clock — where the week lands. */
  localDate: string;
  localTime: string;
  durationMinutes: number;
  /** The teacher's first name — the stand-in's when one is set. */
  instructorFirstName: string | null;
  /** Their photo: Clerk's, or the file the club holds (POOLSE-194). */
  instructorPhotoUrl: string | null;
  standIn: boolean;
  status: 'scheduled' | 'cancelled' | 'completed';
  /** Cancelled because a closure reaches it — *Encerrado*. */
  byClosure: boolean;
  /** The last day of the closure that reached it, `YYYY-MM-DD` — POOLSE-174. */
  closedUntil: string | null;
  cancellationReason: string | null;
  /** Moved for this week only — *Mudou*. */
  moved: boolean;
  /**
   * *Vou / Não vou* — POOLSE-90 slice 2: the last answer (true *Vou*, false
   * *Não vou*) or null when nobody has answered.
   */
  going: boolean | null;
  /** This reader answers for this child (`family_may_answer()`). */
  mayAnswer: boolean;
  /** The reader is this student, and no date of birth is held — POOLSE-186. */
  needsBirthDate: boolean;
  /**
   * The lesson still takes an answer: a turma's, not cancelled, not started.
   * The trigger on `session_notice` is the guard; this only says it in advance.
   */
  noticeOpen: boolean;
}

/**
 * One line on the family's calendar — POOLSE-175. A lesson, or with
 * `generated: false` a day of the weekly pattern past the sessions the club has
 * generated, which has no session and opens nothing.
 */
export interface CalendarEntry extends Omit<AgendaEntry, 'sessionId'> {
  sessionId: string | null;
  generated: boolean;
  /** This child's mark, past lessons only. Never anybody else's. */
  attendance: 'present' | 'absent' | 'excused' | null;
  /** The lesson's page answers it: the condition `/app/lessons/:id` applies. */
  opens: boolean;
}

export interface CalendarClosure {
  id: string;
  reason: string;
  /** Inside the window asked for, which may cut a longer closure. */
  startsOn: string;
  endsOn: string;
  scope: 'site' | 'tank';
}

/** The lesson page's window, in one place: the read below and `opens` agree. */
const LESSON_PAGE_ANSWERS = `(cs.occurs_on <= club_today() + ${AGENDA_DAYS - 1}
                  AND lesson_feedback_closes_on(cs.organization_id, cs.pool_id, cs.starts_at) >= club_today())`;

export async function readAgenda(
  organizationId: string,
  membershipId: string,
  studentIds: string[],
  sessionId: string | null = null,
): Promise<AgendaEntry[]> {
  const rows = await readEntries(organizationId, membershipId, studentIds, sessionId, null);
  return rows.map(({ attendance: _attendance, opens: _opens, ...entry }) => entry);
}

async function readEntries(
  organizationId: string,
  membershipId: string,
  studentIds: string[],
  sessionId: string | null,
  window: { from: string; to: string } | null,
): Promise<(AgendaEntry & Pick<CalendarEntry, 'attendance' | 'opens'>)[]> {
  if (studentIds.length === 0) return [];
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<AgendaEntry & Pick<CalendarEntry, 'attendance' | 'opens'>>(
      `SELECT s.id AS "studentId",
              cs.id AS "sessionId",
              cg.name AS "className",
              l.name AS "levelName",
              f.name AS "siteName",
              p.id AS "poolId",
              p.name AS "poolName",
              coalesce((
                SELECT array_agg(ln.position ORDER BY ln.position)
                  FROM class_session_lane csl
                  JOIN lane ln ON ln.id = csl.lane_id
                 WHERE csl.session_id = cs.id
              ), '{}') AS lanes,
              to_char(cs.starts_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS "localDate",
              to_char(cs.starts_at AT TIME ZONE ${TZ}, 'HH24:MI')    AS "localTime",
              cs.duration_minutes AS "durationMinutes",
              split_part(coalesce(iu.cached_first_name, im.first_name), ' ', 1) AS "instructorFirstName",
              ${instructorPhotoSql('iu', 'im')} AS "instructorPhotoUrl",
              cs.substitute_instructor_membership_id IS NOT NULL AS "standIn",
              cs.status::text AS status,
              cs.closure_id IS NOT NULL AS "byClosure",
              CASE WHEN cs.closure_id IS NOT NULL THEN (
                SELECT k.until::text FROM pool_closure_at(cs.organization_id, cs.pool_id, cs.starts_at) k LIMIT 1
              ) END AS "closedUntil",
              cs.cancellation_reason AS "cancellationReason",
              cs.moved_at IS NOT NULL AS moved,
              sn.going,
              ${mayAnswer('s', '$3::uuid')} AS "mayAnswer",
              ${needsBirthDate('s', '$3::uuid')} AS "needsBirthDate",
              (cs.status <> 'cancelled' AND cs.starts_at > now()) AS "noticeOpen",
              mark.status::text AS attendance,
              ${LESSON_PAGE_ANSWERS} AS opens
         FROM unnest($1::uuid[]) AS chosen(id)
         JOIN student_person s ON s.id = chosen.id AND s.archived_at IS NULL
         JOIN enrollment e
           ON e.organization_id = s.organization_id
          AND e.student_id = s.id
          AND e.status <> 'waiting'
         JOIN class_session cs
           ON cs.organization_id = e.organization_id
          AND cs.class_group_id = e.class_group_id
          AND e.joined_on <= cs.occurs_on
          AND (e.ended_on IS NULL OR e.ended_on >= cs.occurs_on)
         JOIN class_group cg
           ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
         LEFT JOIN student_level l
                ON l.id = cg.level_id AND l.organization_id = cs.organization_id
         LEFT JOIN pool p
                ON p.id = cs.pool_id AND p.organization_id = cs.organization_id
         LEFT JOIN facility f
                ON f.id = coalesce(p.facility_id, cg.facility_id) AND f.organization_id = cs.organization_id
         LEFT JOIN membership im
                ON im.id = cs.resolved_instructor_id AND im.organization_id = cs.organization_id
         LEFT JOIN app_user iu ON iu.id = im.app_user_id
         LEFT JOIN session_notice sn
                ON sn.organization_id = cs.organization_id AND sn.class_session_id = cs.id AND sn.student_id = s.id
         LEFT JOIN attendance mark
                ON mark.organization_id = cs.organization_id AND mark.class_session_id = cs.id
               AND mark.student_id = s.id
        WHERE (
                ($2::uuid IS NULL AND $4::date IS NULL
                  AND cs.occurs_on BETWEEN club_today() AND club_today() + ${AGENDA_DAYS - 1}
                  AND cs.ends_at > now())
             OR (cs.id = $2::uuid AND ${LESSON_PAGE_ANSWERS})
             OR ($4::date IS NOT NULL AND cs.occurs_on BETWEEN $4::date AND $5::date)
              )
        ORDER BY cs.starts_at, s.first_name, cs.id`,
      [studentIds, sessionId, membershipId, window?.from ?? null, window?.to ?? null],
    );
    return rows;
  });
}

/**
 * The family's calendar for a window: the lessons there are, each with this
 * child's mark, and the weekly pattern on the days after the turma's last
 * generated lesson.
 *
 * **The pattern is never a promise past what it can know.** Not before today,
 * not after the turma's or season's end or the child's enrolment, and not on a
 * day a closure shuts (`closure_day_shut`, the one definition).
 */
export async function readCalendar(
  organizationId: string,
  membershipId: string,
  studentIds: string[],
  window: { from: string; to: string },
): Promise<CalendarEntry[]> {
  if (studentIds.length === 0) return [];
  const lessons = await readEntries(organizationId, membershipId, studentIds, null, window);
  const pattern = await withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<CalendarEntry>(
      `SELECT s.id AS "studentId",
              NULL::uuid AS "sessionId",
              cg.name AS "className",
              l.name AS "levelName",
              f.name AS "siteName",
              p.id AS "poolId",
              p.name AS "poolName",
              '{}'::int[] AS lanes,
              to_char(d.day, 'YYYY-MM-DD') AS "localDate",
              to_char(sch.start_time, 'HH24:MI') AS "localTime",
              sch.duration_minutes AS "durationMinutes",
              split_part(coalesce(iu.cached_first_name, im.first_name), ' ', 1) AS "instructorFirstName",
              ${instructorPhotoSql('iu', 'im')} AS "instructorPhotoUrl",
              false AS "standIn",
              'scheduled' AS status,
              false AS "byClosure",
              NULL::text AS "closedUntil",
              NULL::text AS "cancellationReason",
              false AS moved,
              NULL::boolean AS going,
              false AS "mayAnswer",
              false AS "needsBirthDate",
              false AS "noticeOpen",
              NULL::text AS attendance,
              false AS opens,
              false AS generated
         FROM unnest($1::uuid[]) AS chosen(id)
         JOIN student_person s ON s.id = chosen.id AND s.archived_at IS NULL
         JOIN enrollment e
           ON e.organization_id = s.organization_id AND e.student_id = s.id AND e.status <> 'waiting'
         JOIN class_group cg
           ON cg.id = e.class_group_id AND cg.organization_id = e.organization_id AND cg.archived_at IS NULL
         JOIN class_schedule sch
           ON sch.class_group_id = cg.id AND sch.organization_id = cg.organization_id AND sch.archived_at IS NULL
         LEFT JOIN season se ON se.id = cg.season_id AND se.organization_id = cg.organization_id
         LEFT JOIN student_level l ON l.id = cg.level_id AND l.organization_id = cg.organization_id
         LEFT JOIN pool p ON p.id = cg.pool_id AND p.organization_id = cg.organization_id
         LEFT JOIN facility f
                ON f.id = coalesce(p.facility_id, cg.facility_id) AND f.organization_id = cg.organization_id
         LEFT JOIN membership im
                ON im.id = coalesce(sch.instructor_membership_id, cg.instructor_membership_id)
               AND im.organization_id = cg.organization_id
         LEFT JOIN app_user iu ON iu.id = im.app_user_id
        CROSS JOIN LATERAL (
              SELECT gs::date AS day FROM generate_series($2::date, $3::date, interval '1 day') gs
             ) d
        WHERE extract(ISODOW FROM d.day) = sch.weekday
          AND d.day >= club_today()
          AND d.day > coalesce((SELECT max(x.occurs_on) FROM class_session x
                                 WHERE x.class_group_id = cg.id AND x.organization_id = cg.organization_id),
                               club_today() - 1)
          AND d.day <= coalesce(cg.ends_on, se.ends_on, d.day)
          AND e.joined_on <= d.day AND (e.ended_on IS NULL OR e.ended_on >= d.day)
          AND NOT closure_day_shut(cg.organization_id, coalesce(p.facility_id, cg.facility_id),
                                   array_remove(ARRAY[p.id], NULL), d.day)`,
      [studentIds, window.from, window.to],
    );
    return rows;
  });

  return [...lessons.map((one) => ({ ...one, generated: true })), ...pattern].sort(
    (a, b) => `${a.localDate} ${a.localTime}`.localeCompare(`${b.localDate} ${b.localTime}`),
  );
}

/**
 * The closures reaching these children's sites and tanks in a window, as days:
 * every day asked of `closure_reaches`, the one definition, so a closure that
 * repeats each year lands where it should. Asked at both halves of the day,
 * because a half-day closure still shuts part of it.
 */
export async function readCalendarClosures(
  organizationId: string,
  studentIds: string[],
  window: { from: string; to: string },
): Promise<CalendarClosure[]> {
  if (studentIds.length === 0) return [];
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<CalendarClosure>(
      `WITH places AS (
         SELECT DISTINCT coalesce(p.facility_id, cg.facility_id) AS site, cg.pool_id AS tank
           FROM enrollment e
           JOIN class_group cg ON cg.id = e.class_group_id AND cg.organization_id = e.organization_id
           LEFT JOIN pool p ON p.id = cg.pool_id AND p.organization_id = cg.organization_id
          WHERE e.student_id = ANY ($1::uuid[])
            AND e.status <> 'waiting'
            AND cg.archived_at IS NULL
            AND (e.ended_on IS NULL OR e.ended_on >= $2::date)
       ), days AS (
         SELECT gs::date AS day FROM generate_series($2::date, $3::date, interval '1 day') gs
       )
       SELECT c.id,
              c.reason,
              min(d.day)::text AS "startsOn",
              max(d.day)::text AS "endsOn",
              CASE WHEN c.pool_id IS NULL THEN 'site' ELSE 'tank' END AS scope
         FROM closure c
        CROSS JOIN places pl
        CROSS JOIN days d
        WHERE c.archived_at IS NULL
          AND (closure_reaches(c.facility_id, c.pool_id, c.starts_on, c.ends_on, c.repeats_annually, c.part_of_day,
                               pl.site, array_remove(ARRAY[pl.tank], NULL), d.day + time '09:00')
            OR closure_reaches(c.facility_id, c.pool_id, c.starts_on, c.ends_on, c.repeats_annually, c.part_of_day,
                               pl.site, array_remove(ARRAY[pl.tank], NULL), d.day + time '15:00'))
        GROUP BY c.id, c.reason, c.pool_id
        ORDER BY min(d.day), c.id`,
      [studentIds, window.from, window.to],
    );
    return rows;
  });
}

/** Who a lesson expects, as numbers and never names — POOLSE-174, rule 6. */
export interface LessonCount {
  enrolled: number | null;
  notComing: number;
}

export async function readLessonCount(organizationId: string, sessionId: string): Promise<LessonCount> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<LessonCount>(
      `SELECT ${ENROLLED_IN_SESSION} AS enrolled, ${NOT_COMING_TO_SESSION} AS "notComing"
         FROM class_session cs WHERE cs.id = $1`,
      [sessionId],
    );
    return rows[0] ?? { enrolled: null, notComing: 0 };
  });
}

/** Who is in a lesson, as another family may see it — POOLSE-194. */
export interface Classmates {
  instructor: { name: string; photoUrl: string | null; standIn: boolean } | null;
  enrolled: number | null;
  notComing: number;
  /** The reader's own and adults, but those who said *Não vou*. */
  people: { name: string; photoFileId: string | null; going: boolean | null; challengeDone: boolean | null }[];
  /**
   * Everybody else, as figures and never as rows: a row per child, in order, is a
   * child. `going` and `done` are null under `HIDDEN_FLOOR`, where a figure would
   * say who it was.
   */
  hidden: { count: number; going: number | null; done: number | null };
}

/** Fewer hidden students than this, and what they said stays unsaid. */
const HIDDEN_FLOOR = 3;

/** Who is in the lesson, with `$2` the reader's own: the one definition of both reads below. */
const LESSON_PEOPLE = `WITH x AS (
           SELECT s.first_name, s.last_name, s.photo_file_id, sn.going, fb.challenge_done,
                  coalesce(s.id = ANY($2::uuid[]) OR student_is_adult_path(s.organization_id, s.id), false) AS shown,
                  EXISTS (SELECT 1 FROM consent pc
                           WHERE pc.organization_id = s.organization_id AND pc.student_id = s.id
                             AND pc.kind = 'photo' AND pc.granted AND pc.withdrawn_at IS NULL) AS consented
             FROM class_session cs
             JOIN enrollment e
               ON e.organization_id = cs.organization_id AND e.class_group_id = cs.class_group_id
              AND e.status <> 'waiting' AND e.joined_on <= cs.occurs_on
              AND (e.ended_on IS NULL OR e.ended_on >= cs.occurs_on)
             JOIN student_person s ON s.id = e.student_id AND s.organization_id = e.organization_id AND s.archived_at IS NULL
             LEFT JOIN session_notice sn
               ON sn.organization_id = cs.organization_id AND sn.class_session_id = cs.id AND sn.student_id = s.id
             LEFT JOIN lesson_feedback fb
               ON fb.organization_id = cs.organization_id AND fb.class_session_id = cs.id
              AND fb.student_id = s.id AND fb.archived_at IS NULL
            WHERE cs.id = $1 AND sn.going IS NOT FALSE
         )`;

/**
 * The lesson's people for this reader — POOLSE-194 (Rui, 06-11-2026).
 *
 * **In SQL, and only what may leave.** A minor who is not the reader's own leaves
 * as a figure and never as a row: a blank painted over on a screen is still in the
 * response, and a row's place in a sorted list is a name. Minor means not proved adult, so `student_is_adult_path()`
 * decides: a declared date or a live guardian hides the person. *Não vou* is a
 * count, so those rows never leave. The numbers are the instructor's own.
 */
export async function readClassmates(
  organizationId: string,
  sessionId: string,
  mine: string[],
): Promise<Classmates> {
  return withOrg(organizationId, async (tx) => {
    const lesson = await tx.query<{
      enrolled: number | null;
      not_coming: number;
      instructor: string | null;
      photo_url: string | null;
      stand_in: boolean;
    }>(
      `SELECT ${ENROLLED_IN_SESSION} AS enrolled, ${NOT_COMING_TO_SESSION} AS not_coming,
              split_part(coalesce(iu.cached_first_name, im.first_name), ' ', 1) AS instructor,
              ${instructorPhotoSql('iu', 'im')} AS photo_url,
              cs.substitute_instructor_membership_id IS NOT NULL AS stand_in
         FROM class_session cs
         LEFT JOIN membership im ON im.id = cs.resolved_instructor_id AND im.organization_id = cs.organization_id
         LEFT JOIN app_user iu ON iu.id = im.app_user_id
        WHERE cs.id = $1`,
      [sessionId],
    );
    const row = lesson.rows[0];
    const people = await tx.query<{
      name: string;
      photo_file_id: string | null;
      going: boolean | null;
      challenge_done: boolean | null;
    }>(
      `${LESSON_PEOPLE}
       SELECT btrim(split_part(x.first_name, ' ', 1) || ' ' || left(x.last_name, 1) || '.') AS name,
              CASE WHEN x.consented THEN x.photo_file_id END AS photo_file_id,
              x.going, x.challenge_done
         FROM x
        WHERE x.shown
        ORDER BY x.going IS TRUE DESC, x.first_name`,
      [sessionId, mine],
    );
    const hidden = await tx.query<{ count: number; going: number; done: number }>(
      `${LESSON_PEOPLE}
       SELECT count(*)::int AS count,
              count(*) FILTER (WHERE x.going IS TRUE)::int AS going,
              count(*) FILTER (WHERE x.challenge_done IS TRUE)::int AS done
         FROM x
        WHERE NOT x.shown`,
      [sessionId, mine],
    );
    const figures = hidden.rows[0] ?? { count: 0, going: 0, done: 0 };
    return {
      instructor:
        row === undefined || row.instructor === null || row.instructor === ''
          ? null
          : { name: row.instructor, photoUrl: row.photo_url, standIn: row.stand_in },
      enrolled: row?.enrolled ?? null,
      notComing: row?.not_coming ?? 0,
      people: people.rows.map((one) => ({
        name: one.name,
        photoFileId: one.photo_file_id,
        going: one.going,
        challengeDone: one.challenge_done,
      })),
      hidden: {
        count: figures.count,
        going: figures.count < HIDDEN_FLOOR ? null : figures.going,
        done: figures.count < HIDDEN_FLOOR ? null : figures.done,
      },
    };
  });
}

export interface WaterReading {
  poolId: string;
  /** Degrees Celsius as recorded — a string, because the column is numeric. */
  celsius: string;
  /** When the sample was taken, as an instant: the screen says how long ago. */
  takenAt: string;
}

/**
 * The latest recorded water temperature of each pool given — temperature only,
 * the family band's rule. A pool nothing has measured is simply absent, never
 * a dash pretending to be a reading.
 */
export async function readWater(organizationId: string, poolIds: string[]): Promise<WaterReading[]> {
  if (poolIds.length === 0) return [];
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<WaterReading>(
      `SELECT DISTINCT ON (pa.pool_id)
              pa.pool_id AS "poolId",
              v.value::text AS celsius,
              to_char(pa.taken_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "takenAt"
         FROM pool_analysis pa
         JOIN pool_analysis_value v
           ON v.analysis_id = pa.id AND v.organization_id = pa.organization_id
          AND v.metric = 'temperature'
        WHERE pa.pool_id = ANY($1::uuid[]) AND pa.archived_at IS NULL
        ORDER BY pa.pool_id, pa.taken_at DESC`,
      [poolIds],
    );
    return rows;
  });
}

export interface RecentLesson {
  studentId: string;
  sessionId: string;
  className: string;
  /** `YYYY-MM-DD` and `HH:MM` on the site's clock. */
  localDate: string;
  localTime: string;
  /** The mood given, 1–5, or null when nobody has answered yet. */
  mood: number | null;
  /** Still inside the window — *Dar feedback* when there is no mood yet. */
  open: boolean;
  /** The reader answers for this child; else the list offers nothing to do. */
  mayAnswer: boolean;
}

/**
 * *Últimas aulas* — POOLSE-116: the lessons these students attended (marked
 * present) inside the feedback window, newest first. A lesson the child missed
 * is not here: there is nothing to say about it.
 */
export async function readRecent(
  organizationId: string,
  membershipId: string,
  studentIds: string[],
): Promise<RecentLesson[]> {
  if (studentIds.length === 0) return [];
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<RecentLesson>(
      `SELECT s.id AS "studentId",
              cs.id AS "sessionId",
              cg.name AS "className",
              to_char(cs.starts_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS "localDate",
              to_char(cs.starts_at AT TIME ZONE ${TZ}, 'HH24:MI')    AS "localTime",
              fb.mood,
              club_today() <= lesson_feedback_closes_on(cs.organization_id, cs.pool_id, cs.starts_at) AS open,
              ${mayAnswer('s', '$2::uuid')} AS "mayAnswer"
         FROM unnest($1::uuid[]) AS chosen(id)
         JOIN student_person s ON s.id = chosen.id AND s.archived_at IS NULL
         JOIN attendance a
           ON a.organization_id = s.organization_id AND a.student_id = s.id AND a.status = 'present'
         JOIN class_session cs
           ON cs.id = a.class_session_id AND cs.organization_id = a.organization_id
          AND cs.status <> 'cancelled'
         JOIN class_group cg
           ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
         LEFT JOIN pool p
                ON p.id = cs.pool_id AND p.organization_id = cs.organization_id
         LEFT JOIN facility f
                ON f.id = coalesce(p.facility_id, cg.facility_id) AND f.organization_id = cs.organization_id
         LEFT JOIN lesson_feedback fb
                ON fb.organization_id = cs.organization_id AND fb.class_session_id = cs.id
               AND fb.student_id = s.id AND fb.archived_at IS NULL
        WHERE lesson_feedback_closes_on(cs.organization_id, cs.pool_id, cs.starts_at) >= club_today()
          AND cs.ends_at <= now()
          -- Enrolled that day, as the lesson page and the write require: a
          -- reposição guest is marked present too, but the family app has never
          -- shown a make-up lesson, and listing one that 404s is worse (sweep 27-10).
          AND EXISTS (
                SELECT 1 FROM enrollment e
                 WHERE e.organization_id = cs.organization_id AND e.student_id = s.id
                   AND e.class_group_id = cs.class_group_id AND e.status <> 'waiting'
                   AND e.joined_on <= cs.occurs_on AND (e.ended_on IS NULL OR e.ended_on >= cs.occurs_on))
        ORDER BY cs.starts_at DESC, s.first_name, cs.id`,
      [studentIds, membershipId],
    );
    return rows;
  });
}
