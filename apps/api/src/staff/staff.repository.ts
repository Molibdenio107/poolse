import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';

/**
 * The staff record — POOLSE-39.
 *
 * A record that can be created but not corrected is the complaint that produced
 * this ticket. Name, phone and notes are editable; email is not, because it is
 * the login identity and lives with Clerk.
 */

export interface StaffRecord {
  membershipId: string;
  appUserId: string | null;
  clerkUserId: string | null;
  firstName: string | null;
  lastName: string | null;
  /** Read-only everywhere. Rendered from the identity source, never editable. */
  email: string | null;
  phone: string | null;
  notes: string | null;
  status: string;
  roles: string[];
  /** Set while a re-invite is outstanding — AC4. */
  pendingInvite: { id: string; email: string; expiresAt: string } | null;
  /** So the Alunos side of one Person is reachable from here — AC7. */
  studentId: string | null;
}

export async function findStaff(
  organizationId: string,
  membershipId: string,
): Promise<StaffRecord | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      membership_id: string;
      app_user_id: string | null;
      clerk_user_id: string | null;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      phone: string | null;
      notes: string | null;
      status: string;
      roles: string[];
      pending_id: string | null;
      pending_email: string | null;
      pending_expires: Date | null;
      student_id: string | null;
    }>(
      `SELECT m.id AS membership_id,
              m.app_user_id,
              u.clerk_user_id,
              coalesce(u.cached_first_name, m.first_name) AS first_name,
              coalesce(u.cached_last_name,  m.last_name)  AS last_name,
              person_email(m.id)::text AS email,
              -- Their own number where they have an account, the club's record
              -- where they do not. Same resolution rule as the name.
              coalesce(u.contact_phone, m.phone) AS phone,
              m.notes,
              m.status::text AS status,
              coalesce((
                SELECT array_agg(mr.role::text ORDER BY mr.role)
                  FROM membership_role mr
                 WHERE mr.membership_id = m.id AND mr.archived_at IS NULL
              ), '{}') AS roles,
              i.id AS pending_id,
              i.email::text AS pending_email,
              i.expires_at AS pending_expires,
              (
                SELECT s.id FROM student s
                 WHERE s.membership_id = m.id AND s.archived_at IS NULL
                 LIMIT 1
              ) AS student_id
         FROM membership m
         LEFT JOIN app_user u ON u.id = m.app_user_id
         /*
          * The pending re-invite, if there is one.
          *
          * A re-invite is the only invitation whose membership already holds a
          * login — every other one points at a placeholder made moments before.
          * That is what tells the two apart without a flag column.
          */
         LEFT JOIN invitation i
                ON i.membership_id = m.id
               AND i.organization_id = m.organization_id
               AND i.accepted_at IS NULL
               AND i.revoked_at IS NULL
               AND m.app_user_id IS NOT NULL
        WHERE m.id = $1 AND m.archived_at IS NULL`,
      [membershipId],
    );

    const row = rows[0];
    if (row === undefined) return null;

    return {
      membershipId: row.membership_id,
      appUserId: row.app_user_id,
      clerkUserId: row.clerk_user_id,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      phone: row.phone,
      notes: row.notes,
      status: row.status,
      roles: row.roles,
      pendingInvite:
        row.pending_id === null
          ? null
          : {
              id: row.pending_id,
              email: row.pending_email ?? '',
              expiresAt: (row.pending_expires ?? new Date()).toISOString(),
            },
      studentId: row.student_id,
    };
  });
}

export interface StaffEdit {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  notes: string | null;
}

/**
 * Saves the fields that are ours to save — AC1, AC8.
 *
 * **Where there is a login, Clerk owns the name.** The caller writes it there
 * first and passes `clerkHandled` so this does not also try: the check
 * constraint from POOLSE-17 refuses club-held names on somebody Clerk names, and
 * writing both would be the silently-reverting bug decision 3 warns about.
 *
 * Every changed field is audited with its old and new value. That is AC8, and it
 * is also the only way to answer "who changed this and to what" six months later
 * — the row itself only remembers the winner.
 */
export async function updateStaff(
  organizationId: string,
  membershipId: string,
  edit: StaffEdit,
  clerkHandled: boolean,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows: before } = await tx.query<{
      first_name: string | null;
      last_name: string | null;
      phone: string | null;
      notes: string | null;
      app_user_id: string | null;
      contact_phone: string | null;
      cached_first_name: string | null;
      cached_last_name: string | null;
    }>(
      `SELECT m.first_name, m.last_name, m.phone, m.notes, m.app_user_id,
              u.contact_phone, u.cached_first_name, u.cached_last_name
         FROM membership m
         LEFT JOIN app_user u ON u.id = m.app_user_id
        WHERE m.id = $1 AND m.archived_at IS NULL`,
      [membershipId],
    );

    const was = before[0];
    if (was === undefined) return false;

    /*
     * The phone belongs to the person where they have an account, and to the
     * club where they do not. Two columns, one field on screen — resolved here
     * so no screen has to know.
     */
    if (was.app_user_id !== null) {
      await tx.query(`UPDATE app_user SET contact_phone = $2 WHERE id = $1`, [
        was.app_user_id,
        edit.phone,
      ]);
    } else {
      await tx.query(
        `UPDATE membership SET first_name = $2, last_name = $3, phone = $4 WHERE id = $1`,
        [membershipId, edit.firstName, edit.lastName, edit.phone],
      );
    }

    // Notes are the club's whoever they are about.
    await tx.query(`UPDATE membership SET notes = $2 WHERE id = $1`, [membershipId, edit.notes]);

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const note = (field: string, from: unknown, to: unknown): void => {
      if ((from ?? null) !== (to ?? null)) changes[field] = { from, to };
    };

    note('firstName', was.cached_first_name ?? was.first_name, edit.firstName);
    note('lastName', was.cached_last_name ?? was.last_name, edit.lastName);
    note('phone', was.contact_phone ?? was.phone, edit.phone);
    note('notes', was.notes, edit.notes);

    if (Object.keys(changes).length > 0) {
      await recordAudit(tx, {
        action: 'staff.updated',
        entityType: 'membership',
        entityId: membershipId,
        data: { changes, nameWrittenToClerk: clerkHandled },
      });
    }

    return true;
  });
}

/**
 * Moves somebody to a new email address — AC3.
 *
 * An invitation attached to **the membership they already have**, not to a fresh
 * placeholder. `accept_invitation` binds `invitation.membership_id` to whoever
 * accepts, so the login lands on the existing record and the Person, their
 * history, roles, turma assignments and audit trail never move.
 *
 * That is the whole mechanism, and it is deliberately the *absence* of new
 * machinery: the failure the ticket names — "a re-invite that silently orphans
 * the old Person and starts a new one" — is impossible if no second membership
 * is ever created.
 *
 * Their existing login keeps working until the new address is accepted, because
 * nothing about the membership changes until then.
 */
export async function reinvite(
  organizationId: string,
  membershipId: string,
  email: string,
  tokenHash: string,
  expiresAt: Date,
  invitedBy: string | null,
): Promise<string | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows: target } = await tx.query<{ id: string; roles: string[] }>(
      `SELECT m.id,
              coalesce((
                SELECT array_agg(mr.role::text)
                  FROM membership_role mr
                 WHERE mr.membership_id = m.id AND mr.archived_at IS NULL
              ), '{}') AS roles
         FROM membership m
        WHERE m.id = $1 AND m.archived_at IS NULL AND m.app_user_id IS NOT NULL`,
      [membershipId],
    );

    // No row means no such staff member, or one with no login to move.
    const person = target[0];
    if (person === undefined) return null;

    // One outstanding re-invite at a time. A second would give two live links to
    // the same record and no way to say which wins.
    await tx.query(
      `UPDATE invitation SET revoked_at = now()
        WHERE membership_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL`,
      [membershipId],
    );

    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO invitation (
         organization_id, email, roles, token_hash, expires_at,
         membership_id, invited_by_membership_id
       )
       VALUES ($1, $2::citext, $3::member_role[], $4, $5, $6, $7)
       RETURNING id`,
      [organizationId, email, person.roles, tokenHash, expiresAt, membershipId, invitedBy],
    );

    const id = rows[0]?.id;
    if (id === undefined) return null;

    await recordAudit(tx, {
      action: 'staff.reinvited',
      entityType: 'membership',
      entityId: membershipId,
      data: { toEmail: email },
    });

    return id;
  });
}

/** Cancels an outstanding re-invite — AC4. The existing login is unaffected. */
export async function cancelReinvite(
  organizationId: string,
  membershipId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string; email: string }>(
      `UPDATE invitation SET revoked_at = now()
        WHERE membership_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
      RETURNING id, email::text AS email`,
      [membershipId],
    );

    if (rows[0] === undefined) return false;

    await recordAudit(tx, {
      action: 'staff.reinvite_cancelled',
      entityType: 'membership',
      entityId: membershipId,
      data: { toEmail: rows[0].email },
    });
    return true;
  });
}
