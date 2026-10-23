import { Client } from 'pg';

/**
 * A partner with no agreement — POOLSE-105, QA 1–4.
 *
 * *E2E · Escola do contrato* on the owner's club's first site. Every run starts
 * it with no live agreement: a previous run's agreements are archived, never
 * deleted, and their contract versions go with them out of view. Development
 * database only, owner login.
 */

export const PARTNER = 'E2E · Escola do contrato';

export async function partnerContractFixture(email: string): Promise<{ partnerId: string }> {
  const url = process.env['DATABASE_URL'];
  if (url === undefined) throw new Error('DATABASE_URL is not set — run with --env-file=../../.env');
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    await db.query('BEGIN');
    const org = (
      await db.query<{ organization_id: string }>(
        `SELECT m.organization_id FROM app_user u
           JOIN membership m ON m.app_user_id = u.id AND m.archived_at IS NULL
           JOIN membership_role r ON r.membership_id = m.id AND r.role = 'owner' AND r.archived_at IS NULL
          WHERE u.cached_email = $1 LIMIT 1`,
        [email],
      )
    ).rows[0]!.organization_id;

    let partnerId = (
      await db.query<{ id: string }>(
        `SELECT id FROM partner WHERE organization_id = $1 AND name = $2 AND archived_at IS NULL`,
        [org, PARTNER],
      )
    ).rows[0]?.id;
    if (partnerId === undefined) {
      const facilityId = (
        await db.query<{ id: string }>(
          `SELECT id FROM facility WHERE organization_id = $1 AND archived_at IS NULL ORDER BY created_at LIMIT 1`,
          [org],
        )
      ).rows[0]!.id;
      partnerId = (
        await db.query<{ id: string }>(
          `INSERT INTO partner (organization_id, facility_id, name, type) VALUES ($1, $2, $3, 'escola') RETURNING id`,
          [org, facilityId, PARTNER],
        )
      ).rows[0]!.id;
    }

    // Back to a partner with no agreement and no contract: what QA 1 opens on.
    await db.query(
      `UPDATE partner_agreement SET archived_at = now() WHERE partner_id = $1 AND archived_at IS NULL`,
      [partnerId],
    );
    await db.query('COMMIT');
    return { partnerId };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    await db.end();
  }
}
