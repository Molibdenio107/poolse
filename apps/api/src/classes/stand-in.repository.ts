import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';

/**
 * Who is teaching one lesson — round 6.
 *
 * **A stand-in, not a reassignment.** `class_session.substitute_instructor_
 * membership_id` has existed since slice 1.4 and nothing wrote to it: the column
 * was added because the overlap constraint had to reason about
 * `coalesce(substitute, instructor)`, and the interface to set it was never
 * built. This is that interface.
 *
 * The turma's own instructor is unchanged. A club whose Tuesday teacher is ill
 * puts somebody else on Tuesday; it does not thereby hand them the turma, and
 * the following week goes back to normal on its own — which is exactly what a
 * substitute means and exactly what setting the schedule's instructor would not
 * do.
 */

export interface Candidate {
  membershipId: string;
  name: string | null;
  /** Null when free. Otherwise why they are not, in the club's own words. */
  awayReason: 'vacation' | 'medical' | 'personal' | null;
  /** Already teaching something else at that hour. */
  busy: boolean;
}

/**
 * Everybody who could take this lesson, and what stands in the way.
 *
 * **Nobody is hidden.** An instructor on holiday appears with "de férias"
 * against their name, and the interface draws them greyed and unselectable. A
 * list that simply omitted them would answer "where is Ana?" with silence, and
 * the difference between "on leave" and "left the club" is one an operator
 * needs.
 *
 * `busy` is separate from `awayReason` because they are different problems with
 * different answers: one is solved by choosing another week, the other by
 * choosing another person.
 */
export async function candidatesFor(
  organizationId: string,
  sessionId: string,
): Promise<{ candidates: Candidate[]; currentId: string | null } | null> {
  return withOrg(organizationId, async (tx) => {
    const session = await tx.query<{
      on_date: string;
      starts_at: Date;
      ends_at: Date;
      instructor: string | null;
      substitute: string | null;
    }>(
      /*
       * The lesson's *local* date, not its UTC one.
       *
       * "Is this instructor on leave that day" is a question about the day the
       * club is living in. A 22:30 class in July is already the next day in UTC,
       * so asking in UTC would look up the wrong date for one lesson in ten and
       * only in summer — the kind of bug that is reported as "sometimes it lets
       * me pick somebody who is away". The same expression the calendar renders
       * with, so both agree by construction.
       */
      `SELECT to_char(cs.starts_at AT TIME ZONE coalesce(f.timezone, 'Europe/Lisbon'),
                      'YYYY-MM-DD')                        AS on_date,
              cs.starts_at,
              cs.ends_at,
              cg.instructor_membership_id                  AS instructor,
              cs.substitute_instructor_membership_id       AS substitute
         FROM class_session cs
         LEFT JOIN class_group cg ON cg.id = cs.class_group_id
                                 AND cg.organization_id = cs.organization_id
         LEFT JOIN pool p         ON p.id = cs.pool_id
                                 AND p.organization_id = cs.organization_id
         LEFT JOIN facility f     ON f.id = p.facility_id
                                 AND f.organization_id = cs.organization_id
        WHERE cs.id = $1 AND cs.archived_at IS NULL`,
      [sessionId],
    );
    const lesson = session.rows[0];
    if (lesson === undefined) return null;

    const { rows } = await tx.query<{
      membership_id: string;
      name: string | null;
      away_reason: string | null;
      busy: boolean;
    }>(
      /*
       * Every instructor at the club, with two facts about this particular
       * lesson attached.
       *
       * Away is read from approved leave only: a request somebody has made and
       * nobody has answered yet is not a reason to stop assigning them, and
       * showing it as one would let a pending request quietly veto the timetable.
       */
      `SELECT m.id                                             AS membership_id,
              nullif(btrim(concat_ws(' ',
                coalesce(u.cached_first_name, m.first_name),
                coalesce(u.cached_last_name,  m.last_name))), '') AS name,
              (
                SELECT vr.kind::text
                  FROM vacation_day vd
                  JOIN vacation_request vr ON vr.id = vd.vacation_request_id
                                          AND vr.organization_id = vd.organization_id
                 WHERE vd.membership_id = m.id
                   AND vd.organization_id = m.organization_id
                   AND vd.archived_at IS NULL
                   AND vr.archived_at IS NULL
                   AND vr.status = 'approved'
                   AND vd.day = $2::date
                 LIMIT 1
              )                                                AS away_reason,
              EXISTS (
                SELECT 1
                  FROM class_session other
                 WHERE other.organization_id = m.organization_id
                   AND other.id <> $1
                   AND other.archived_at IS NULL
                   AND other.status <> 'cancelled'
                   /*
                    * The same coalesce(substitute, instructor) the exclusion
                    * constraint uses, so this warns about exactly what the
                    * database would refuse rather than about something adjacent.
                    */
                   AND coalesce(
                         other.substitute_instructor_membership_id,
                         (SELECT g2.instructor_membership_id
                            FROM class_group g2
                           WHERE g2.id = other.class_group_id
                             AND g2.organization_id = other.organization_id)
                       ) = m.id
                   AND tstzrange(other.starts_at, other.ends_at)
                       && tstzrange($3::timestamptz, $4::timestamptz)
              )                                                AS busy
         FROM membership m
         JOIN membership_role mr ON mr.membership_id = m.id
                                AND mr.organization_id = m.organization_id
         LEFT JOIN app_user u ON u.id = m.app_user_id
        WHERE m.archived_at IS NULL
          AND m.status = 'active'
          AND mr.role = 'instructor'
        ORDER BY name NULLS LAST`,
      [sessionId, lesson.on_date, lesson.starts_at, lesson.ends_at],
    );

    return {
      currentId: lesson.substitute ?? lesson.instructor,
      candidates: rows.map((row) => ({
        membershipId: row.membership_id,
        name: row.name,
        awayReason: (row.away_reason as Candidate['awayReason']) ?? null,
        busy: row.busy,
      })),
    };
  });
}

export type StandInResult = 'set' | 'missing' | 'away' | 'clash';

/**
 * Puts somebody else on this lesson, or takes the stand-in off again.
 *
 * `membershipId` of null clears it, which is how a club undoes a stand-in: the
 * turma's own instructor comes back, because they were never replaced.
 */
export async function setStandIn(
  organizationId: string,
  sessionId: string,
  membershipId: string | null,
): Promise<StandInResult> {
  return withOrg(organizationId, async (tx) => {
    const session = await tx.query<{ on_date: string }>(
      // The facility's own day, for the same reason as above.
      `SELECT to_char(cs.starts_at AT TIME ZONE coalesce(f.timezone, 'Europe/Lisbon'),
                      'YYYY-MM-DD') AS on_date
         FROM class_session cs
         LEFT JOIN pool p     ON p.id = cs.pool_id AND p.organization_id = cs.organization_id
         LEFT JOIN facility f ON f.id = p.facility_id AND f.organization_id = cs.organization_id
        WHERE cs.id = $1 AND cs.archived_at IS NULL`,
      [sessionId],
    );
    if (session.rowCount === 0) return 'missing';

    if (membershipId !== null) {
      /*
       * Refused server-side, not merely greyed in the interface.
       *
       * The list already draws an absent instructor as unselectable; this is
       * the half that matters, because hiding a control is never the control
       * and the same endpoint is reachable without one.
       */
      const away = await tx.query(
        `SELECT 1
           FROM vacation_day vd
           JOIN vacation_request vr ON vr.id = vd.vacation_request_id
                                   AND vr.organization_id = vd.organization_id
          WHERE vd.membership_id = $1
            AND vd.day = $2::date
            AND vd.archived_at IS NULL
            AND vr.archived_at IS NULL
            AND vr.status = 'approved'`,
        [membershipId, session.rows[0]!.on_date],
      );
      if ((away.rowCount ?? 0) > 0) return 'away';
    }

    try {
      await tx.query(
        `UPDATE class_session
            SET substitute_instructor_membership_id = $2
          WHERE id = $1 AND archived_at IS NULL`,
        [sessionId, membershipId],
      );
    } catch (error) {
      /*
       * 23P01 is the exclusion constraint from slice 1.4, which compares
       * `coalesce(substitute, instructor)` — so it catches the person being put
       * on two lessons at once, whichever way round they arrived at each. The
       * database is what knows; this only names it.
       */
      if (error instanceof Error && (error as { code?: string }).code === '23P01') {
        return 'clash';
      }
      throw error;
    }

    await recordAudit(tx, {
      action: membershipId === null ? 'session.standIn.cleared' : 'session.standIn.set',
      entityType: 'class_session',
      entityId: sessionId,
      data: { membershipId },
    });
    return 'set';
  });
}
