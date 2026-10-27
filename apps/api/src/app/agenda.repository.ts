import { withOrg } from '@poolse/db';

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
  standIn: boolean;
  status: 'scheduled' | 'cancelled' | 'completed';
  /** Cancelled because a closure reaches it — *Encerrado*. */
  byClosure: boolean;
  cancellationReason: string | null;
  /** Moved for this week only — *Mudou*. */
  moved: boolean;
}

export async function readAgenda(
  organizationId: string,
  studentIds: string[],
  sessionId: string | null = null,
): Promise<AgendaEntry[]> {
  if (studentIds.length === 0) return [];
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<AgendaEntry>(
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
              cs.substitute_instructor_membership_id IS NOT NULL AS "standIn",
              cs.status::text AS status,
              cs.closure_id IS NOT NULL AS "byClosure",
              cs.cancellation_reason AS "cancellationReason",
              cs.moved_at IS NOT NULL AS moved
         FROM unnest($1::uuid[]) AS chosen(id)
         JOIN student s ON s.id = chosen.id AND s.archived_at IS NULL
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
        WHERE (
                ($2::uuid IS NULL
                  AND cs.occurs_on BETWEEN club_today() AND club_today() + ${AGENDA_DAYS - 1}
                  AND cs.ends_at > now())
             OR (cs.id = $2::uuid
                  AND cs.occurs_on BETWEEN club_today() - lesson_feedback_window()
                                       AND club_today() + ${AGENDA_DAYS - 1})
              )
        ORDER BY cs.starts_at, s.first_name, cs.id`,
      [studentIds, sessionId],
    );
    return rows;
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
}

/**
 * *Últimas aulas* — POOLSE-116: the lessons these students attended (marked
 * present) inside the feedback window, newest first. A lesson the child missed
 * is not here: there is nothing to say about it.
 */
export async function readRecent(organizationId: string, studentIds: string[]): Promise<RecentLesson[]> {
  if (studentIds.length === 0) return [];
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<RecentLesson>(
      `SELECT s.id AS "studentId",
              cs.id AS "sessionId",
              cg.name AS "className",
              to_char(cs.starts_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS "localDate",
              to_char(cs.starts_at AT TIME ZONE ${TZ}, 'HH24:MI')    AS "localTime",
              fb.mood,
              club_today() <= cs.occurs_on + lesson_feedback_window() AS open
         FROM unnest($1::uuid[]) AS chosen(id)
         JOIN student s ON s.id = chosen.id AND s.archived_at IS NULL
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
        WHERE cs.occurs_on >= club_today() - lesson_feedback_window()
          AND cs.ends_at <= now()
        ORDER BY cs.starts_at DESC, s.first_name, cs.id`,
      [studentIds],
    );
    return rows;
  });
}
