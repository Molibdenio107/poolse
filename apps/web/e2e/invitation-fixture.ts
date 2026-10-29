import { createHash, randomBytes } from 'node:crypto';
import { Client } from 'pg';

/**
 * A pending student invitation in the E2E user's club — 29-10-2026.
 *
 * Made as `createInvitation` makes one: a bare placeholder membership, its role,
 * the invitation holding only the hash. A fresh token each run (the hash cannot
 * be read back), and the previous run's pending invitations to this address are
 * revoked first. Nothing here accepts it. Development database only, owner login.
 */
export const INVITED_EMAIL = 'convidado+e2e@example.test';

export async function invitationFixture(ownerEmail: string): Promise<{ token: string; club: string }> {
  const url = process.env['DATABASE_URL'];
  if (url === undefined) throw new Error('DATABASE_URL is not set — run with --env-file=../../.env');
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    await db.query('BEGIN');
    const owner = (
      await db.query<{ organization_id: string; membership_id: string; name: string }>(
        `SELECT m.organization_id, m.id AS membership_id, o.name FROM app_user u
           JOIN membership m ON m.app_user_id = u.id AND m.archived_at IS NULL
           JOIN membership_role r ON r.membership_id = m.id AND r.role = 'owner' AND r.archived_at IS NULL
           JOIN organization o ON o.id = m.organization_id
          WHERE u.cached_email = $1 LIMIT 1`,
        [ownerEmail],
      )
    ).rows[0]!;
    await db.query(
      `UPDATE invitation SET revoked_at = now()
        WHERE organization_id = $1 AND email = $2::citext AND accepted_at IS NULL AND revoked_at IS NULL`,
      [owner.organization_id, INVITED_EMAIL],
    );
    const membership = (
      await db.query<{ id: string }>(
        `INSERT INTO membership (organization_id, status) VALUES ($1, 'invited') RETURNING id`,
        [owner.organization_id],
      )
    ).rows[0]!.id;
    await db.query(`INSERT INTO membership_role (organization_id, membership_id, role) VALUES ($1, $2, 'student')`, [
      owner.organization_id,
      membership,
    ]);
    const token = randomBytes(32).toString('base64url');
    await db.query(
      `INSERT INTO invitation (organization_id, email, roles, token_hash, expires_at, membership_id, invited_by_membership_id)
       VALUES ($1, $2::citext, ARRAY['student']::member_role[], $3, now() + interval '1 day', $4, $5)`,
      [owner.organization_id, INVITED_EMAIL, createHash('sha256').update(token, 'utf8').digest('hex'), membership, owner.membership_id],
    );
    await db.query('COMMIT');
    return { token, club: owner.name };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    await db.end();
  }
}
