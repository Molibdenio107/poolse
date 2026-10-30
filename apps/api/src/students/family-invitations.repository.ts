import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { displayName, personName } from '../people/names.js';
import { searchPredicate } from '../common/search.js';

/**
 * A family is invited from the student's record — POOLSE-129 (Rui, 30-10-2026).
 *
 * The invitation names the person the club already has: a live guardian of the
 * student, or the student themself once they may answer for themselves (12, by
 * `self_answer_min_age()`, the rule `family_may_answer` reads). Nothing here
 * makes a placeholder for a family — the 29-10 bug was exactly a family
 * placeholder the guardian rule refused, and a second membership for a mother
 * the club already has is the duplicate the NIF rule exists to prevent.
 *
 * Accepting binds the login to that row (`accept_invitation`), so the child's
 * `guardian_link` or `student.membership_id` is the login's from the first
 * sign-in.
 */

export type InviteeKind = 'guardian' | 'self';
export type InviteeState = 'none' | 'invited' | 'expired' | 'in_app';

export interface Invitee {
  kind: InviteeKind;
  /** Null only for a student who has no membership yet; inviting makes one. */
  membershipId: string | null;
  name: string;
  relationship: string | null;
  email: string | null;
  phone: string | null;
  state: InviteeState;
  invitation: {
    id: string;
    /** Null for a link shared by hand. */
    email: string | null;
    createdAt: string;
    expiresAt: string;
    delivery: string;
  } | null;
}

/**
 * The student may hold their own login — one definition, the one
 * `family_may_answer` uses. An adult on the adult path is over 12 by
 * construction, so the age is the whole test; a missing birth date is never a
 * guess.
 */
export const SELF_INVITABLE = (s: string): string =>
  `(${s}.birth_date IS NOT NULL
    AND date_part('year', age(club_today(), ${s}.birth_date)) >= self_answer_min_age())`;

/**
 * "Somebody on this record could be in the app and is not, and nobody has asked
 * them yet" — the *Por convidar* filter, and the bulk invite's candidates.
 * Shared so the list's count and the bulk preview cannot disagree.
 */
export const HAS_UNINVITED = (s: string): string => `(
  EXISTS (
    SELECT 1
      FROM guardian_link gl
      JOIN membership gm ON gm.id = gl.guardian_membership_id AND gm.organization_id = gl.organization_id
     WHERE gl.student_id = ${s}.id AND gl.organization_id = ${s}.organization_id
       AND gl.archived_at IS NULL AND gm.archived_at IS NULL
       AND gm.app_user_id IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM invitation i
          WHERE i.membership_id = gm.id AND i.organization_id = gm.organization_id
            AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
       )
  )
  OR (${SELF_INVITABLE(s)}
      AND NOT EXISTS (
        SELECT 1 FROM membership sm
         WHERE sm.id = ${s}.membership_id AND sm.organization_id = ${s}.organization_id
           AND (sm.app_user_id IS NOT NULL OR EXISTS (
             SELECT 1 FROM invitation i
              WHERE i.membership_id = sm.id AND i.organization_id = sm.organization_id
                AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
           ))
      ))
)`;

interface InviteeRow {
  kind: InviteeKind;
  membership_id: string | null;
  name: string;
  relationship: string | null;
  email: string | null;
  phone: string | null;
  has_login: boolean;
  invitation_id: string | null;
  invitation_email: string | null;
  invitation_created_at: Date | null;
  invitation_expires_at: Date | null;
  invitation_delivery: string | null;
}

const INVITEES_SQL = `
  WITH s AS (
    SELECT * FROM student WHERE id = $1 AND archived_at IS NULL
  ),
  people AS (
    SELECT 'guardian'::text AS kind, gl.guardian_membership_id AS membership_id,
           gl.relationship, gl.is_primary, 0 AS rank
      FROM guardian_link gl
      JOIN s ON gl.student_id = s.id AND gl.organization_id = s.organization_id
     WHERE gl.archived_at IS NULL
    UNION ALL
    SELECT 'self', s.membership_id, NULL, false, 1
      FROM s s
     WHERE ${SELF_INVITABLE('s')}
  )
  SELECT p.kind,
         p.membership_id,
         CASE WHEN p.kind = 'self' THEN ${displayName('s')}
              ELSE coalesce(${personName('p.membership_id')}, '') END AS name,
         p.relationship,
         CASE WHEN p.kind = 'self'
              THEN coalesce(person_email(s.membership_id)::text, s.contact_email::text)
              ELSE person_email(p.membership_id)::text END AS email,
         CASE WHEN p.kind = 'self' THEN coalesce(m.phone, s.contact_phone)
              ELSE coalesce(m.phone, u.contact_phone) END AS phone,
         (m.app_user_id IS NOT NULL) AS has_login,
         i.id AS invitation_id,
         i.email::text AS invitation_email,
         i.created_at AS invitation_created_at,
         i.expires_at AS invitation_expires_at,
         i.delivery::text AS invitation_delivery
    FROM people p
    CROSS JOIN s
    LEFT JOIN membership m ON m.id = p.membership_id AND m.organization_id = s.organization_id
    LEFT JOIN app_user u ON u.id = m.app_user_id
    LEFT JOIN LATERAL (
      SELECT i2.* FROM invitation i2
       WHERE i2.membership_id = p.membership_id
         AND i2.organization_id = s.organization_id
         AND i2.accepted_at IS NULL AND i2.revoked_at IS NULL
       ORDER BY i2.created_at DESC
       LIMIT 1
    ) i ON true
   ORDER BY p.rank, p.is_primary DESC, name
`;

function toInvitee(row: InviteeRow, now: Date): Invitee {
  const invitation = row.invitation_id === null ? null : {
    id: row.invitation_id,
    email: row.invitation_email,
    createdAt: row.invitation_created_at!.toISOString(),
    expiresAt: row.invitation_expires_at!.toISOString(),
    delivery: row.invitation_delivery ?? 'pending',
  };
  const state: InviteeState = row.has_login
    ? 'in_app'
    : invitation === null
      ? 'none'
      : new Date(invitation.expiresAt) > now ? 'invited' : 'expired';
  return {
    kind: row.kind,
    membershipId: row.membership_id,
    name: row.name,
    relationship: row.relationship,
    email: row.email,
    phone: row.phone,
    state,
    invitation,
  };
}

/** Null when the student does not exist here (another club's id included). */
export async function listInvitees(
  organizationId: string,
  studentId: string,
): Promise<{ studentName: string; organizationName: string; invitees: Invitee[] } | null> {
  return withOrg(organizationId, async (tx) => {
    const student = await tx.query<{ name: string; organization_name: string }>(
      `SELECT ${displayName('s')} AS name, o.name AS organization_name
         FROM student s JOIN organization o ON o.id = s.organization_id
        WHERE s.id = $1 AND s.archived_at IS NULL`,
      [studentId],
    );
    const head = student.rows[0];
    if (!head) return null;
    const { rows } = await tx.query<InviteeRow>(INVITEES_SQL, [studentId]);
    const now = new Date();
    return {
      studentName: head.name,
      organizationName: head.organization_name,
      invitees: rows.map((row) => toInvitee(row, now)),
    };
  });
}

/**
 * May this instructor invite this student's family? Only a student actively
 * enrolled in a turma they teach — the same union `myTurmaIds` reads (the
 * turma's own instructor, or named on one of its weekly slots).
 */
export async function teachesStudent(
  organizationId: string,
  membershipId: string,
  studentId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `SELECT 1 FROM enrollment e
         JOIN class_group cg ON cg.id = e.class_group_id AND cg.organization_id = e.organization_id
        WHERE e.student_id = $1 AND e.status = 'active' AND cg.archived_at IS NULL
          AND (${TEACHES('cg', '$2')})
        LIMIT 1`,
      [studentId, membershipId],
    );
    return (rowCount ?? 0) > 0;
  });
}

const TEACHES = (cg: string, member: string): string => `
  ${cg}.instructor_membership_id = ${member}
  OR EXISTS (
    SELECT 1 FROM class_schedule cs
     WHERE cs.class_group_id = ${cg}.id AND cs.organization_id = ${cg}.organization_id
       AND cs.archived_at IS NULL AND cs.instructor_membership_id = ${member}
  )`;

export type CreateOutcome =
  | { kind: 'created'; invitationId: string; email: string | null; expiresAt: string; roles: string[] }
  | { kind: 'not_found' }
  | { kind: 'has_login' }
  | { kind: 'already_invited' }
  | { kind: 'email_taken' }
  | { kind: 'no_email' };

export interface CreateFamilyInvitation {
  organizationId: string;
  invitedByMembershipId: string;
  studentId: string;
  /** A guardian's membership, or null for the student themself. */
  membershipId: string | null;
  /** `email` sends it; `link` makes one to share by hand, with no address. */
  channel: 'email' | 'link';
  /** Typed on the row when the person has none on file. Already normalised. */
  email: string | null;
  tokenHash: string;
  expiresAt: Date;
  /**
   * *Convidar aluno* — the student was created in this same transaction from a
   * name and a contact, with no birth date, by somebody inviting the student
   * themself. The 12-year rule cannot be read without a date, and the person
   * typing the form is saying who the login is for.
   */
  newStudent?: true;
}

export async function createFamilyInvitation(input: CreateFamilyInvitation): Promise<CreateOutcome> {
  return withOrg(input.organizationId, (tx) => createFamilyInvitationIn(tx, input));
}

/**
 * One invitation, inside the caller's transaction — the single path the
 * student's row and the bulk invite share.
 */
export async function createFamilyInvitationIn(
  tx: Tx,
  input: CreateFamilyInvitation,
): Promise<CreateOutcome> {
  const target = await resolveTarget(tx, input.studentId, input.membershipId, input.newStudent === true);
  if (target === null) return { kind: 'not_found' };
  if (target.hasLogin) return { kind: 'has_login' };

  // An address typed on the row is saved on the person first — the next
  // invitation, the next message and the register read it from there.
  if (input.email !== null && target.email === null) {
    const saved = await saveEmail(tx, input.studentId, target, input.email);
    if (!saved) return { kind: 'email_taken' };
  }

  const email = input.channel === 'link' ? null : (input.email ?? target.email);
  if (input.channel === 'email' && email === null) return { kind: 'no_email' };

  let membershipId = target.membershipId;
  if (membershipId === null) membershipId = await giveStudentAMembership(tx, input);

  // A link that ran out still holds the person's place in the one-live-invite
  // index; it is withdrawn so a new one can go. A live one is never replaced
  // here — that is *Novo link*, which the screen offers on purpose.
  await tx.query(
    `UPDATE invitation SET revoked_at = now()
      WHERE (membership_id = $1 OR ($2::citext IS NOT NULL AND email = $2::citext))
        AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= now()`,
    [membershipId, email],
  );

  await tx.query('SAVEPOINT family_invitation');
  try {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO invitation (
         organization_id, email, roles, token_hash, expires_at,
         membership_id, invited_by_membership_id
       )
       VALUES ($1, $2::citext, ARRAY[$3]::member_role[], $4, $5, $6, $7)
       RETURNING id`,
      [
        input.organizationId,
        email,
        target.role,
        input.tokenHash,
        input.expiresAt,
        membershipId,
        input.invitedByMembershipId,
      ],
    );
    await tx.query('RELEASE SAVEPOINT family_invitation');
    const invitationId = rows[0]!.id;

    // The address is the person's, readable by every admin elsewhere; the log
    // says that one went out and to whom, never the token.
    await recordAudit(tx, {
      action: 'invitation.created',
      entityType: 'invitation',
      entityId: invitationId,
      data: {
        roles: [target.role],
        membershipId,
        studentId: input.studentId,
        channel: input.channel,
      },
    });

    return {
      kind: 'created',
      invitationId,
      email,
      expiresAt: input.expiresAt.toISOString(),
      roles: [target.role],
    };
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      await tx.query('ROLLBACK TO SAVEPOINT family_invitation');
      return { kind: 'already_invited' };
    }
    throw error;
  }
}

interface Target {
  kind: InviteeKind;
  membershipId: string | null;
  role: 'guardian' | 'student';
  email: string | null;
  hasLogin: boolean;
}

/**
 * The person on this student's record — never anybody else's. A membership that
 * is not a live guardian of *this* student, or a student who may not hold their
 * own login, is not found: the same answer as another club's id.
 */
async function resolveTarget(
  tx: Tx,
  studentId: string,
  membershipId: string | null,
  anyAge = false,
): Promise<Target | null> {
  if (membershipId === null) {
    const { rows } = await tx.query<{ membership_id: string | null; email: string | null; has_login: boolean }>(
      `SELECT s.membership_id,
              coalesce(person_email(s.membership_id)::text, s.contact_email::text) AS email,
              coalesce(m.app_user_id IS NOT NULL, false) AS has_login
         FROM student s
         LEFT JOIN membership m ON m.id = s.membership_id AND m.organization_id = s.organization_id
        WHERE s.id = $1 AND s.archived_at IS NULL AND ($2::boolean OR ${SELF_INVITABLE('s')})
        FOR UPDATE OF s`,
      [studentId, anyAge],
    );
    const row = rows[0];
    if (!row) return null;
    return { kind: 'self', membershipId: row.membership_id, role: 'student', email: row.email, hasLogin: row.has_login };
  }

  const { rows } = await tx.query<{ email: string | null; has_login: boolean }>(
    `SELECT person_email(m.id)::text AS email, m.app_user_id IS NOT NULL AS has_login
       FROM guardian_link gl
       JOIN student s ON s.id = gl.student_id AND s.organization_id = gl.organization_id
       JOIN membership m ON m.id = gl.guardian_membership_id AND m.organization_id = gl.organization_id
      WHERE gl.student_id = $1 AND gl.guardian_membership_id = $2
        AND gl.archived_at IS NULL AND s.archived_at IS NULL AND m.archived_at IS NULL
      FOR UPDATE OF m`,
    [studentId, membershipId],
  );
  const row = rows[0];
  if (!row) return null;
  return { kind: 'guardian', membershipId, role: 'guardian', email: row.email, hasLogin: row.has_login };
}

/** False when another live person in the club already holds that address. */
async function saveEmail(tx: Tx, studentId: string, target: Target, email: string): Promise<boolean> {
  await tx.query('SAVEPOINT family_email');
  try {
    if (target.kind === 'guardian') {
      await tx.query(`UPDATE membership SET email = $2::citext WHERE id = $1 AND app_user_id IS NULL`, [
        target.membershipId,
        email,
      ]);
    } else {
      await tx.query(`UPDATE student SET contact_email = $2::citext WHERE id = $1`, [studentId, email]);
    }
    await tx.query('RELEASE SAVEPOINT family_email');
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      await tx.query('ROLLBACK TO SAVEPOINT family_email');
      return false;
    }
    throw error;
  }
  // Named, never valued: the log is readable by every admin (POOLSE-80).
  await recordAudit(tx, {
    action: target.kind === 'guardian' ? 'person.updated' : 'student.updated',
    entityType: target.kind === 'guardian' ? 'membership' : 'student',
    entityId: target.kind === 'guardian' ? target.membershipId! : studentId,
    data: { withheld: ['email'], reason: 'invitation' },
  });
  return true;
}

/**
 * A student who will hold their own login needs a membership for it to bind
 * to. Active, not `invited`, so revoking the invitation leaves the student's own
 * record alone; it carries the `student` role the login arrives with.
 */
async function giveStudentAMembership(tx: Tx, input: CreateFamilyInvitation): Promise<string> {
  // The student's own name, as the club holds it, until a login binds it —
  // `accept_invitation` then clears it, Clerk owning the name from there.
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO membership (organization_id, status, first_name, last_name)
     SELECT $1, 'active', s.first_name, s.last_name FROM student s WHERE s.id = $2
     RETURNING id`,
    [input.organizationId, input.studentId],
  );
  const id = rows[0]!.id;
  await tx.query(
    `INSERT INTO membership_role (organization_id, membership_id, role) VALUES ($1, $2, 'student')`,
    [input.organizationId, id],
  );
  await tx.query(`UPDATE student SET membership_id = $2 WHERE id = $1`, [input.studentId, id]);
  return id;
}

/**
 * The invitation on this student's row, if it is one — reissue and revoke act
 * only on an invitation addressed to somebody on this record, so an instructor
 * scoped to their own turmas cannot reach another family's link by its id.
 */
export async function invitationOnRecord(
  organizationId: string,
  studentId: string,
  invitationId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `SELECT 1 FROM invitation i
         JOIN student s ON s.id = $1 AND s.organization_id = i.organization_id
        WHERE i.id = $2
          AND i.accepted_at IS NULL AND i.revoked_at IS NULL
          AND (i.membership_id = s.membership_id OR EXISTS (
                SELECT 1 FROM guardian_link gl
                 WHERE gl.student_id = s.id AND gl.guardian_membership_id = i.membership_id
                   AND gl.archived_at IS NULL))`,
      [studentId, invitationId],
    );
    return (rowCount ?? 0) > 0;
  });
}

// ---------------------------------------------------------------------------
// *Convidar famílias* — preview and commit on one path.
// ---------------------------------------------------------------------------

/** Per club per Lisbon day, every family invitation counted (rule 13). */
export const FAMILY_INVITATION_DAILY_CEILING = 200;

export interface BulkFilters {
  search: string | null;
  levelId: string | null;
  /** Set for an instructor: only students enrolled in a turma they teach. */
  teacherMembershipId: string | null;
}

export interface BulkCandidate {
  studentId: string;
  membershipId: string | null;
  email: string;
}

export interface BulkPreview {
  students: number;
  /** Will receive the email. */
  byEmail: number;
  /** No address on file: they stay on *Por convidar*, to share by hand. */
  phoneOnly: number;
  inApp: number;
  alreadyInvited: number;
  sentToday: number;
  ceiling: number;
  candidates: BulkCandidate[];
}

export async function previewBulk(organizationId: string, filters: BulkFilters): Promise<BulkPreview> {
  return withOrg(organizationId, (tx) => previewBulkIn(tx, filters));
}

export async function previewBulkIn(tx: Tx, filters: BulkFilters): Promise<BulkPreview> {
  const { rows: students } = await tx.query<{ id: string }>(
    `SELECT s.id FROM student s
      WHERE s.archived_at IS NULL
        AND ($1::uuid IS NULL OR s.level_id = $1::uuid)
        AND ${searchPredicate(
          `s.first_name || ' ' || s.last_name || ' ' ||
           coalesce(s.contact_email::text, '') || ' ' || coalesce(s.contact_phone, '')`,
          '$2',
        )}
        AND ($3::uuid IS NULL OR EXISTS (
              SELECT 1 FROM enrollment e
                JOIN class_group cg ON cg.id = e.class_group_id AND cg.organization_id = e.organization_id
               WHERE e.student_id = s.id AND e.status = 'active' AND cg.archived_at IS NULL
                 AND (${TEACHES('cg', '$3')})))`,
    [filters.levelId, filters.search, filters.teacherMembershipId],
  );

  const now = new Date();
  const seen = new Set<string>();
  const preview: BulkPreview = {
    students: students.length,
    byEmail: 0,
    phoneOnly: 0,
    inApp: 0,
    alreadyInvited: 0,
    sentToday: 0,
    ceiling: FAMILY_INVITATION_DAILY_CEILING,
    candidates: [],
  };

  for (const student of students) {
    const { rows } = await tx.query<InviteeRow>(INVITEES_SQL, [student.id]);
    for (const row of rows) {
      // A mother of three is one invitation, not three.
      const key = row.membership_id ?? `self:${student.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const invitee = toInvitee(row, now);
      if (invitee.state === 'in_app') preview.inApp += 1;
      else if (invitee.state === 'invited') preview.alreadyInvited += 1;
      else if (invitee.email === null) preview.phoneOnly += 1;
      else {
        preview.byEmail += 1;
        preview.candidates.push({ studentId: student.id, membershipId: invitee.kind === 'self' ? null : invitee.membershipId, email: invitee.email });
      }
    }
  }

  const today = await tx.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM invitation
      WHERE roles <@ ARRAY['guardian', 'student']::member_role[]
        AND (created_at AT TIME ZONE 'Europe/Lisbon')::date = club_today()`,
  );
  preview.sentToday = today.rows[0]?.n ?? 0;
  return preview;
}
