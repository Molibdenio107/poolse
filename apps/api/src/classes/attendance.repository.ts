import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { displayName, nameOrder, shortName } from '../people/names.js';

/**
 * The register for one class — slice 1.8.
 *
 * "An instructor marks a class in under a minute" is the acceptance criterion,
 * and it shapes the whole module: one read that returns the class with everybody
 * already listed, and one write that takes the lot. A screen that saved a student
 * at a time would be a screen somebody abandons halfway through, leaving a class
 * half-marked and nobody able to tell whether the rest were absent.
 */

/**
 * Three states, and `late` is deliberately not one of them — POOLSE-13.
 *
 * Late arrival is not recorded anywhere: somebody who arrives late is present.
 * The enum value was dropped rather than merely hidden, so there is no way for a
 * later caller to set it and no column quietly holding the old distinction.
 */
export type AttendanceStatus = 'present' | 'absent' | 'excused';

export interface RegisterEntry {
  studentId: string;
  firstName: string;
  lastName: string;
  /** Null until somebody marks them. Not the same as `absent`. */
  status: AttendanceStatus | null;
  note: string | null;
  recordedByName: string | null;
  recordedAt: string | null;
  /** False for a trial, a make-up, or a sibling brought along. */
  enrolled: boolean;
}

export interface Register {
  sessionId: string;
  className: string;
  poolName: string | null;
  lane: number | null;
  /** Local calendar date at the facility. */
  localDate: string;
  /** Local wall-clock, "HH:MM". */
  localTime: string;
  durationMinutes: number;
  status: 'scheduled' | 'cancelled' | 'completed';
  instructorName: string | null;
  entries: RegisterEntry[];
}

/*
 * Who marked the register. An audit line rather than a list row, so it carries
 * the full legal name — POOLSE-32 criterion 3.
 */
const NAME_SQL = `display_name(u.cached_first_name, u.cached_last_name)`;

/**
 * One class, and everybody who might be in it.
 *
 * The list is a union rather than a join: enrolled students, plus anybody
 * already marked who is not enrolled. Without the second half, marking a trial
 * student and then reopening the screen would lose them — the mark would still
 * be in the table, invisible, and the register would not add up.
 *
 * Ordered by name, because that is the order an instructor reads a poolside
 * queue in, and a register that reorders itself between visits is one people
 * lose their place in.
 */
export async function findRegister(
  organizationId: string,
  sessionId: string,
): Promise<Register | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows: sessions } = await tx.query<{
      class_name: string;
      pool_name: string | null;
      lane: number | null;
      local_date: string;
      local_time: string;
      duration_minutes: number;
      status: Register['status'];
      instructor_name: string | null;
    }>(
      `
      SELECT cg.name AS class_name,
             p.name  AS pool_name,
             cs.lane,
             to_char(cs.starts_at AT TIME ZONE coalesce(f.timezone, 'Europe/Lisbon'),
                     'YYYY-MM-DD') AS local_date,
             to_char(cs.starts_at AT TIME ZONE coalesce(f.timezone, 'Europe/Lisbon'),
                     'HH24:MI') AS local_time,
             cs.duration_minutes,
             cs.status,
             (
               SELECT ${NAME_SQL}
                 FROM membership m
                 LEFT JOIN app_user u ON u.id = m.app_user_id
                WHERE m.id = coalesce(cs.substitute_instructor_membership_id,
                                      cs.instructor_membership_id)
             ) AS instructor_name
        FROM class_session cs
        JOIN class_group cg
          ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
        LEFT JOIN pool p     ON p.id = cs.pool_id     AND p.organization_id = cs.organization_id
        LEFT JOIN facility f ON f.id = p.facility_id  AND f.organization_id = cs.organization_id
       WHERE cs.id = $1
      `,
      [sessionId],
    );

    const session = sessions[0];
    // Also the answer for another tenant's session id: RLS hid it, and the
    // caller learns nothing either way.
    if (!session) return null;

    const { rows: entries } = await tx.query<{
      student_id: string;
      first_name: string;
      last_name: string;
      display_name: string;
      short_name: string;
      status: AttendanceStatus | null;
      note: string | null;
      recorded_by_name: string | null;
      recorded_at: Date | null;
      enrolled: boolean;
      is_guest: boolean;
    }>(
      `
      WITH roll AS (
        -- Everybody enrolled in the turma this class belongs to.
        SELECT e.student_id, true AS enrolled, false AS guest
          FROM enrollment e
          JOIN class_session cs
            ON cs.class_group_id = e.class_group_id
           AND cs.organization_id = e.organization_id
         WHERE cs.id = $1
           AND e.status = 'active'

        UNION

        -- Plus anybody already marked who is not on that list. Losing a trial
        -- student on reopening the screen would leave a mark in the table that
        -- nothing displays.
        SELECT a.student_id, false, false
          FROM attendance a
         WHERE a.class_session_id = $1

        UNION

        /*
         * Plus reposição guests — POOLSE-21 criterion 8.
         *
         * They are marked like anybody else and are **not** enrolled: they never
         * appear in the enrollment table at all, so the POOLSE-08 roster, the
         * seat count and POOLSE-19's proposals cannot pick them up by accident.
         * That is the mistake the ticket names as most likely, and the schema
         * makes it require effort rather than care.
         *
         * Confirmed only. A pending request is somebody waiting for an answer,
         * not somebody coming — putting them on the register would have an
         * instructor looking for a child who was never told to turn up.
         */
        SELECT c.student_id, false, true
          FROM reposicao_booking b
          JOIN reposicao_credit c
            ON c.id = b.credit_id AND c.organization_id = b.organization_id
         WHERE b.class_session_id = $1
           AND b.status = 'confirmed'
           AND b.archived_at IS NULL
      )
      SELECT s.id AS student_id,
             s.first_name,
             s.last_name,
             ${displayName('s')} AS display_name,
             ${shortName('s')} AS short_name,
             a.status,
             a.note,
             (
               SELECT ${NAME_SQL}
                 FROM membership m
                 LEFT JOIN app_user u ON u.id = m.app_user_id
                WHERE m.id = a.recorded_by_membership_id
             ) AS recorded_by_name,
             a.recorded_at,
             bool_or(roll.enrolled) AS enrolled,
             bool_or(roll.guest) AS is_guest
        FROM roll
        JOIN student s ON s.id = roll.student_id
        LEFT JOIN attendance a
               ON a.student_id = s.id AND a.class_session_id = $1
       WHERE s.archived_at IS NULL
       GROUP BY s.id, s.first_name, s.last_name, a.status, a.note,
                a.recorded_by_membership_id, a.recorded_at
       ORDER BY ${nameOrder('s')}
      `,
      [sessionId],
    );

    return {
      sessionId,
      className: session.class_name,
      poolName: session.pool_name,
      lane: session.lane,
      localDate: session.local_date,
      localTime: session.local_time,
      durationMinutes: session.duration_minutes,
      status: session.status,
      instructorName: session.instructor_name,
      entries: entries.map((row) => ({
        studentId: row.student_id,
        firstName: row.first_name,
        lastName: row.last_name,
        displayName: row.display_name,
        shortName: row.short_name,
        status: row.status,
        note: row.note,
        recordedByName: row.recorded_by_name,
        recordedAt: row.recorded_at?.toISOString() ?? null,
        enrolled: row.enrolled,
        isGuest: row.is_guest,
      })),
    };
  });
}

export interface Mark {
  studentId: string;
  /** Null clears the mark, putting the student back to "not yet marked". */
  status: AttendanceStatus | null;
  note: string | null;
}

/**
 * Saves a whole register at once.
 *
 * One transaction, one audit entry. Marking is a single act — an instructor
 * looks at a poolside queue and writes the lot — and recording it as fifteen
 * separate events would make the audit log unreadable for the one question it
 * gets asked: who marked this class, and when.
 *
 * A null status deletes rather than storing a fifth "unknown" state. "Not yet
 * marked" is the absence of a row, and having two ways to say it is how a
 * register stops adding up.
 */
export async function saveRegister(
  organizationId: string,
  sessionId: string,
  recordedByMembershipId: string,
  marks: Mark[],
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `SELECT id FROM class_session WHERE id = $1`,
      [sessionId],
    );
    if (!rows[0]) return false;

    const cleared = marks.filter((mark) => mark.status === null).map((mark) => mark.studentId);
    const set = marks.filter((mark) => mark.status !== null);

    if (cleared.length > 0) {
      await tx.query(
        `DELETE FROM attendance WHERE class_session_id = $1 AND student_id = ANY($2::uuid[])`,
        [sessionId, cleared],
      );
    }

    if (set.length > 0) {
      /*
       * One statement for the whole register, and `recorded_at` moves on every
       * change. The timestamp answers "when was this marked", not "when was it
       * first marked" — a correction made a week later is a new claim by a
       * person and is dated accordingly.
       */
      await tx.query(
        `
        INSERT INTO attendance (organization_id, class_session_id, student_id, status,
                                note, recorded_by_membership_id)
        SELECT $1, $2, m.student_id, m.status::attendance_status, m.note, $3
          FROM unnest($4::uuid[], $5::text[], $6::text[]) AS m(student_id, status, note)
        ON CONFLICT (organization_id, class_session_id, student_id) DO UPDATE
           SET status = excluded.status,
               note = excluded.note,
               recorded_by_membership_id = excluded.recorded_by_membership_id,
               recorded_at = now()
        `,
        [
          organizationId,
          sessionId,
          recordedByMembershipId,
          set.map((mark) => mark.studentId),
          set.map((mark) => mark.status),
          set.map((mark) => mark.note),
        ],
      );
    }

    await recordAudit(tx, {
      action: 'attendance.recorded',
      entityType: 'class_session',
      entityId: sessionId,
      data: { marked: set.length, cleared: cleared.length },
    });

    return true;
  });
}

export interface AttendanceSummary {
  present: number;
  absent: number;
  excused: number;
  /** Sessions in the window that nobody has marked yet. */
  unmarked: number;
}

/**
 * One student's attendance across a window — the read a parent conversation
 * makes.
 *
 * `unmarked` is reported rather than folded into absent, because they are
 * different facts and only one of them is about the child. A term that looks
 * like nine absences and is really nine classes nobody got round to marking is
 * exactly the wrong thing to take into a meeting.
 */
export async function summaryForStudent(
  organizationId: string,
  studentId: string,
  from: string,
  to: string,
): Promise<AttendanceSummary> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      present: string;
      absent: string;
      excused: string;
      unmarked: string;
    }>(
      `
      WITH theirs AS (
        SELECT cs.id, a.status
          FROM class_session cs
          JOIN enrollment e
            ON e.class_group_id = cs.class_group_id
           AND e.organization_id = cs.organization_id
           AND e.student_id = $1
           AND e.status = 'active'
          LEFT JOIN attendance a
                 ON a.class_session_id = cs.id AND a.student_id = $1
         WHERE cs.status <> 'cancelled'
           AND cs.starts_at >= $2::date
           AND cs.starts_at < ($3::date + 1)
      )
      SELECT count(*) FILTER (WHERE status = 'present') AS present,
             count(*) FILTER (WHERE status = 'absent')  AS absent,
             count(*) FILTER (WHERE status = 'excused') AS excused,
             count(*) FILTER (WHERE status IS NULL)     AS unmarked
        FROM theirs
      `,
      [studentId, from, to],
    );

    const row = rows[0];
    return {
      present: Number(row?.present ?? 0),
      absent: Number(row?.absent ?? 0),
      excused: Number(row?.excused ?? 0),
      unmarked: Number(row?.unmarked ?? 0),
    };
  });
}
