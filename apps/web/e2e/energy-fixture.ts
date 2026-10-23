import { Client } from 'pg';
import { seedEnergy } from '../../../packages/db/src/seed-energy.ts';

/**
 * The Energia dashboard's own data — POOLSE-106.
 *
 * The demo club's energy (POOLSE-102's seed) in the E2E user's club, so the
 * dashboard has a year of electricity and gas bills to draw, plus one supply
 * whose last bill ended sixty days ago — QA 2's missing bill. Idempotent like
 * the seed it calls: found again by the meter's name and the bill's period.
 * Development database only, through the owner login, as the other fixtures.
 */

export const STALE_METER = 'Gás — balneários';

export interface EnergyFixture {
  facilityId: string;
  staleMeterId: string;
}

export async function energyFixture(email: string): Promise<EnergyFixture> {
  const url = process.env['DATABASE_URL'];
  if (url === undefined) throw new Error('DATABASE_URL is not set — run with --env-file=../../.env');
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    const org = (
      await db.query<{ organization_id: string }>(
        `SELECT m.organization_id FROM app_user u
           JOIN membership m ON m.app_user_id = u.id AND m.archived_at IS NULL
           JOIN membership_role r ON r.membership_id = m.id AND r.role = 'owner' AND r.archived_at IS NULL
          WHERE u.cached_email = $1 LIMIT 1`,
        [email],
      )
    ).rows[0]?.organization_id;
    if (org === undefined) throw new Error(`No owner membership for ${email}`);

    await seedEnergy(db, org);

    const facilityId = (
      await db.query<{ id: string }>(
        `SELECT id FROM facility WHERE organization_id = $1 AND archived_at IS NULL ORDER BY created_at LIMIT 1`,
        [org],
      )
    ).rows[0]!.id;

    let staleMeterId = (
      await db.query<{ id: string }>(
        `SELECT id FROM energy_meter WHERE organization_id = $1 AND name = $2 AND archived_at IS NULL`,
        [org, STALE_METER],
      )
    ).rows[0]?.id;
    if (staleMeterId === undefined) {
      staleMeterId = (
        await db.query<{ id: string }>(
          `INSERT INTO energy_meter (organization_id, facility_id, name, kind, carrier, unit, reads, cpe)
           VALUES ($1, $2, $3, 'heating', 'gas', 'kWh', 'interval_consumption', 'PT1601000000999888GN')
           RETURNING id`,
          [org, facilityId, STALE_METER],
        )
      ).rows[0]!.id;
    }

    // Its one bill ended sixty days ago, whatever today is: re-dated each run.
    const ended = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    const began = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    const bill = await db.query<{ id: string }>(
      `SELECT id FROM energy_invoice WHERE organization_id = $1 AND meter_id = $2 AND archived_at IS NULL`,
      [org, staleMeterId],
    );
    if (bill.rows[0] === undefined) {
      await db.query(
        `INSERT INTO energy_invoice
           (organization_id, meter_id, supplier, invoice_number, issued_on, period_start, period_end,
            subtotal_cents, vat_cents, total_cents, document_total_cents)
         VALUES ($1, $2, 'Galp', 'E2E-GAS-1', $4, $3, $4, 5000, 1150, 6150, 6150)`,
        [org, staleMeterId, began, ended],
      );
    } else {
      await db.query(
        `UPDATE energy_invoice SET period_start = $3, period_end = $4, issued_on = $4
          WHERE organization_id = $1 AND id = $2`,
        [org, bill.rows[0].id, began, ended],
      );
    }

    return { facilityId, staleMeterId };
  } finally {
    await db.end();
  }
}
