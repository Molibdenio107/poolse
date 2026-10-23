import { Client } from 'pg';

/**
 * Mínimos with no age groups yet — POOLSE-111, QA 1.
 *
 * Its own draft season, *E2E · Mínimos 2025/26* (ending in 2026, so the FPN's
 * groups land on the years FPN Comunicado 26/25 gives), with one standard. Every
 * run starts the season with no live age group — the ones a previous run's
 * one click made are archived, never deleted — so the empty Tempos tab is what
 * the test opens. Development database only, owner login.
 */

export const SEASON = 'E2E · Mínimos 2025/26';
export const STANDARD = 'E2E · Nacionais de Infantis';

export async function qualifyingFixture(email: string): Promise<{ seasonId: string; standardId: string }> {
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

    let seasonId = (
      await db.query<{ id: string }>(
        `SELECT id FROM season WHERE organization_id = $1 AND name = $2 AND archived_at IS NULL`,
        [org, SEASON],
      )
    ).rows[0]?.id;
    if (seasonId === undefined) {
      seasonId = (
        await db.query<{ id: string }>(
          // A draft: a club has one published season, and it is not this one.
          `INSERT INTO season (organization_id, name, starts_on, ends_on, status)
           VALUES ($1, $2, DATE '2025-09-01', DATE '2026-08-31', 'draft') RETURNING id`,
          [org, SEASON],
        )
      ).rows[0]!.id;
    }

    let standardId = (
      await db.query<{ id: string }>(
        `SELECT id FROM qualifying_standard WHERE season_id = $1 AND name = $2 AND archived_at IS NULL`,
        [seasonId, STANDARD],
      )
    ).rows[0]?.id;
    if (standardId === undefined) {
      standardId = (
        await db.query<{ id: string }>(
          `INSERT INTO qualifying_standard (organization_id, season_id, name) VALUES ($1, $2, $3) RETURNING id`,
          [org, seasonId, STANDARD],
        )
      ).rows[0]!.id;
    }

    // Back to no groups: what QA 1 opens on.
    await db.query(
      `UPDATE federation_age_group SET archived_at = now() WHERE season_id = $1 AND archived_at IS NULL`,
      [seasonId],
    );
    await db.query('COMMIT');
    return { seasonId, standardId };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    await db.end();
  }
}
