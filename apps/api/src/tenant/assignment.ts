import { ForbiddenException } from '@nestjs/common';
import { withOrg } from '@poolse/db';
import { currentTenant } from './tenant.context.js';
import { hasRole } from './roles.js';

/**
 * "Is this mine?" — slice 1.12.
 *
 * `roles.ts` answers *what kind of person is this*. This answers the question
 * every module-1 screen has been deferring since slice 1.4: **which turmas are
 * this instructor's own.** Six controllers carry a comment pointing at 1.12, and
 * every one of them is the same missing predicate.
 *
 * ---------------------------------------------------------------------------
 * The three things that make this harder than `instructor_membership_id = me`
 * ---------------------------------------------------------------------------
 *
 * **A booking can override its turma's instructor.** POOLSE-46 added
 * `class_schedule.instructor_membership_id` so a substitute on a Tuesday shows
 * as the substitute. An instructor covering one booking of somebody else's turma
 * is the assigned instructor *of that booking*, and reading only the turma's
 * column would refuse them the register for the class they are about to teach.
 *
 * **A session can override both.** `class_session.resolved_instructor_id` is a
 * generated column — `coalesce(substitute, instructor)` — added by POOLSE-51 so
 * an exclusion constraint could compare it. It is the right thing to test a
 * session against precisely because it is generated: there is no code path that
 * could write a session whose resolved instructor disagrees with the columns
 * behind it.
 *
 * **Owner and admin are never refused.** A club where the office cannot fix last
 * Tuesday's register because the instructor has left is a club that phones
 * support. Every check here passes immediately for them, which also means these
 * functions can be called unconditionally at the top of a handler without the
 * caller having to remember the exemption.
 *
 * ---------------------------------------------------------------------------
 * What this is not
 * ---------------------------------------------------------------------------
 *
 * It is **authorisation, not isolation**. Tenant isolation is structural and
 * lives in the database; if one of these calls were missing, the worst case is
 * an instructor marking a colleague's register *inside their own club*, not
 * seeing another club. Every query here still runs inside `withOrg`.
 *
 * And it is deliberately **not** applied to the student register, the medical
 * notes or the lane grid. Those three were each decided on their own merits and
 * the answer was "any instructor": a child in the water with epilepsy is a
 * safety matter for whoever is at the poolside, and the grid is the sheet on the
 * wall. Narrowing them would be a different decision from this one.
 */

/** Raised when an instructor reaches for a turma that is not theirs. */
function refuse(what: 'turma' | 'session'): never {
  throw new ForbiddenException({
    code: 'not_your_turma',
    message:
      what === 'turma'
        ? 'That turma is not assigned to you'
        : 'That class is not assigned to you',
  });
}

/**
 * Every turma this person is the assigned instructor of.
 *
 * The union of the two places an assignment can live: the turma's own column,
 * and any booking of it that names them. A person covering one Tuesday of
 * Cadetes gets Cadetes in this list — which is right, because they need its
 * register and its students on the night they teach it.
 */
export async function myTurmaIds(
  organizationId: string,
  membershipId: string,
): Promise<string[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `SELECT cg.id
         FROM class_group cg
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
          )`,
      [membershipId],
    );
    return rows.map((row) => row.id);
  });
}

/**
 * Does this person teach this turma?
 *
 * True for owners and admins without a query — they may act on anything, and
 * asking the database first would be a round trip to reach a foregone answer.
 */
export async function isMyTurma(classGroupId: string): Promise<boolean> {
  if (hasRole('owner', 'admin')) return true;

  const { organizationId, membershipId } = currentTenant();
  if (membershipId === null || membershipId === undefined) return false;

  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `SELECT 1
         FROM class_group cg
        WHERE cg.id = $1
          AND cg.archived_at IS NULL
          AND (
            cg.instructor_membership_id = $2
            OR EXISTS (
              SELECT 1 FROM class_schedule cs
               WHERE cs.class_group_id = cg.id
                 AND cs.organization_id = cg.organization_id
                 AND cs.archived_at IS NULL
                 AND cs.instructor_membership_id = $2
            )
          )`,
      [classGroupId, membershipId],
    );
    return (rowCount ?? 0) > 0;
  });
}

/**
 * Does this person teach this particular class, on this particular night?
 *
 * Read from `resolved_instructor_id`, so a substitute is the assigned instructor
 * of the session they are covering and the person they are covering for is not.
 * That is the whole point of a substitute, and marking a register is exactly the
 * thing the substitute has to be able to do.
 *
 * A session whose turma is theirs also counts, for the ordinary case where no
 * substitute exists and the generator stamped the turma's own instructor.
 */
export async function isMySession(sessionId: string): Promise<boolean> {
  if (hasRole('owner', 'admin')) return true;

  const { organizationId, membershipId } = currentTenant();
  if (membershipId === null || membershipId === undefined) return false;

  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `SELECT 1
         FROM class_session cs
         LEFT JOIN class_group cg
           ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
        WHERE cs.id = $1
          AND (
            cs.resolved_instructor_id = $2
            OR cg.instructor_membership_id = $2
          )`,
      [sessionId, membershipId],
    );
    return (rowCount ?? 0) > 0;
  });
}

/**
 * The turma behind a student, for the surfaces keyed by student rather than
 * class — the advancement queue and the reposição approvals.
 *
 * A student is "mine" if any turma I teach has a live enrolment for them.
 * `status = 'active'` rather than merely un-ended: a child on the *waiting list*
 * for my turma is not in my class, and confirming their advancement or approving
 * their reposição is not yet mine to do. `ended_on` is respected too, so a child
 * who left in December is not mine in March.
 */
export async function isMyStudent(studentId: string): Promise<boolean> {
  if (hasRole('owner', 'admin')) return true;

  const { organizationId, membershipId } = currentTenant();
  if (membershipId === null || membershipId === undefined) return false;

  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `SELECT 1
         FROM enrollment e
         JOIN class_group cg
           ON cg.id = e.class_group_id AND cg.organization_id = e.organization_id
        WHERE e.student_id = $1
          AND cg.archived_at IS NULL
          AND e.status = 'active'
          AND (e.ended_on IS NULL OR e.ended_on >= current_date)
          AND (
            cg.instructor_membership_id = $2
            OR EXISTS (
              SELECT 1 FROM class_schedule cs
               WHERE cs.class_group_id = cg.id
                 AND cs.organization_id = cg.organization_id
                 AND cs.archived_at IS NULL
                 AND cs.instructor_membership_id = $2
            )
          )`,
      [studentId, membershipId],
    );
    return (rowCount ?? 0) > 0;
  });
}

export async function requireMyTurma(classGroupId: string): Promise<void> {
  if (!(await isMyTurma(classGroupId))) refuse('turma');
}

export async function requireMySession(sessionId: string): Promise<void> {
  if (!(await isMySession(sessionId))) refuse('session');
}

export async function requireMyStudent(studentId: string): Promise<void> {
  if (!(await isMyStudent(studentId))) refuse('turma');
}

/**
 * Whether this person should be offered the "minhas / todas" switch at all.
 *
 * An instructor who is only an instructor has one view and does not need a
 * control that says so. An **owner who also teaches** has two real views and is
 * the case the slice's acceptance criterion names — so the switch appears for
 * anybody who both teaches and could see everything.
 */
export function canSeeBothViews(): boolean {
  return hasRole('instructor') && hasRole('owner', 'admin');
}

/** Whether the caller's default view is their own turmas rather than the club's. */
export function teachesOnly(): boolean {
  return hasRole('instructor') && !hasRole('owner', 'admin');
}

/**
 * The two surfaces keyed by neither a turma nor a session — slice 1.12.
 *
 * A reposição booking and an advancement proposal are both decisions an
 * instructor makes, and the tickets that introduced them both said "the assigned
 * instructor" and both settled for "any instructor" pending this slice. They
 * resolve to different questions, and the difference is worth stating:
 *
 * **A reposição is decided by whoever runs the class being joined.** The guest is
 * asking for a place in somebody's water on a particular night, and the person
 * who knows whether there is room is the one teaching it — not the person whose
 * class they missed.
 *
 * **An advancement is decided by whoever teaches the student now.** The proposal
 * says this child has finished their level; the person who can confirm that is
 * the one who has been watching them do it.
 */
export async function requireMyBooking(bookingId: string): Promise<void> {
  if (hasRole('owner', 'admin')) return;

  const { organizationId } = currentTenant();
  const sessionId = await withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ class_session_id: string }>(
      `SELECT class_session_id FROM reposicao_booking
        WHERE id = $1 AND archived_at IS NULL`,
      [bookingId],
    );
    return rows[0]?.class_session_id ?? null;
  });

  // A booking nobody can find is the handler's 404 to raise, not this one's 403 —
  // answering "forbidden" here would tell a stranger the id exists.
  if (sessionId === null) return;

  await requireMySession(sessionId);
}

export async function requireMyProposal(proposalId: string): Promise<void> {
  if (hasRole('owner', 'admin')) return;

  const { organizationId } = currentTenant();
  const studentId = await withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ student_id: string }>(
      `SELECT student_id FROM transfer_proposal WHERE id = $1`,
      [proposalId],
    );
    return rows[0]?.student_id ?? null;
  });

  if (studentId === null) return;

  await requireMyStudent(studentId);
}
