import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';

/**
 * *O acesso é do encarregado* — POOLSE-218, rule 5.
 *
 * Before *Convidar aluno* asked who uses the app, a parent's email made the
 * parent's login the child's own. This turns such a record round in one
 * transaction: the login stops being the student and becomes the student's
 * encarregado, with what the club holds about it changed and nothing about the
 * person (email, name, sessions) touched.
 *
 * - the membership loses `student` and gains `guardian`;
 * - `student.membership_id` is cleared, so the record reads its own name, which
 *   *Convidar aluno* wrote (the read-through takes the login's only while linked);
 * - a `parental` link joins the two, primary when the record has none;
 * - the login's `birth_date` is cleared when it is the child's (POOLSE-186 put
 *   it there from the parent's own profile);
 * - consents the student "signed" themself are ended (`withdrawn_at`), so the
 *   guardian is asked again on their next visit (Rui, 12-11-2026: archive them).
 *
 * Only when the record still looks like that (`student_login_child_age()`): the
 * same derived answer the warning shows, read again under a lock.
 */
export type HandoverOutcome =
  | { kind: 'not_found' }
  | { kind: 'not_applicable' }
  | { kind: 'done'; consentsEnded: number; birthDateCleared: boolean };

export async function handAccessToGuardian(
  organizationId: string,
  studentId: string,
  actingMembershipId: string,
): Promise<HandoverOutcome> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      membership_id: string | null;
      app_user_id: string | null;
      birth_date: string | null;
      child_age: number | null;
    }>(
      `SELECT s.membership_id, m.app_user_id, s.birth_date::text AS birth_date,
              student_login_child_age(s.id) AS child_age
         FROM student s
         LEFT JOIN membership m ON m.id = s.membership_id AND m.organization_id = s.organization_id
        WHERE s.id = $1 AND s.archived_at IS NULL
        FOR UPDATE OF s`,
      [studentId],
    );
    const found = rows[0];
    if (found === undefined) return { kind: 'not_found' };
    if (found.child_age === null || found.membership_id === null || found.app_user_id === null) {
      return { kind: 'not_applicable' };
    }
    const login = found.membership_id;

    // What the person is to the club: an encarregado, no longer the student.
    await tx.query(
      `UPDATE membership_role SET archived_at = now()
        WHERE membership_id = $1 AND role = 'student' AND archived_at IS NULL`,
      [login],
    );
    await tx.query(
      `INSERT INTO membership_role (organization_id, membership_id, role)
       SELECT $1, $2, 'guardian'
        WHERE NOT EXISTS (SELECT 1 FROM membership_role
                           WHERE membership_id = $2 AND role = 'guardian' AND archived_at IS NULL)`,
      [organizationId, login],
    );

    await tx.query(`UPDATE student SET membership_id = NULL WHERE id = $1`, [studentId]);

    await tx.query(
      `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, is_primary, kind)
       VALUES ($1, $2, $3,
               NOT EXISTS (SELECT 1 FROM guardian_link g
                            WHERE g.student_id = $2 AND g.is_primary AND g.archived_at IS NULL),
               'parental')
       ON CONFLICT (student_id, guardian_membership_id) WHERE archived_at IS NULL
       DO UPDATE SET kind = 'parental'`,
      [organizationId, studentId, login],
    );

    // The child's date, typed into the parent's own profile (POOLSE-186).
    const cleared = await tx.query(
      `UPDATE app_user SET birth_date = NULL WHERE id = $1 AND birth_date = $2::date`,
      [found.app_user_id, found.birth_date],
    );

    const ended = await tx.query(
      `UPDATE consent SET withdrawn_at = now(), withdrawn_by_membership_id = $3
        WHERE student_id = $1 AND granted_by_membership_id = $2 AND withdrawn_at IS NULL`,
      [studentId, login, actingMembershipId],
    );

    const outcome = {
      consentsEnded: ended.rowCount ?? 0,
      birthDateCleared: (cleared.rowCount ?? 0) > 0,
    };
    await recordAudit(tx, {
      action: 'student.access_handed_to_guardian',
      entityType: 'student',
      entityId: studentId,
      data: { membershipId: login, childAge: found.child_age, ...outcome },
    });
    return { kind: 'done', ...outcome };
  });
}
