import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { seedEnergy } from '@poolse/db/seed-energy';
import { EnergyController } from './energy.controller.js';
import { actingAs, closeHarness, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * The demo club's Custo por utilização — POOLSE-102.
 *
 * The energy seed, run on a club with one taught tank, has to leave that
 * tank's cost report fully populated: every month with consumption priced, so
 * cost per lesson hour, per bather and per m³ are numbers rather than the
 * sentence saying why they are not. A second run writes nothing — on the same
 * day, and a month later, which is the run that used to fail.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

const NOTHING = { meters: 0, readings: 0, invoices: 0, tariffs: 0 };

function firstOf(back: number, hour: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1, hour)).toISOString();
}

/** The demo tank as the main seed leaves it: a volume, a turma, last month's lessons, swimmers. */
async function aTaughtTank(tenant: ScratchTenant): Promise<string> {
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind, volume_litres)
     VALUES ($1, $2, 'Piscina principal', 'indoor', 431250) RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );
  const [group] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group (organization_id, season_id, name, pool_id)
     VALUES ($1, $2, 'Iniciação A', $3) RETURNING id`,
    [tenant.organizationId, tenant.seasonId, pool!.id],
  );
  for (const hour of [9, 11]) {
    const at = firstOf(1, hour);
    const [session] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_session (organization_id, class_group_id, pool_id, starts_at, duration_minutes, occurs_on)
       VALUES ($1, $2, $3, $4, 45, $5) RETURNING id`,
      [tenant.organizationId, group!.id, pool!.id, at, at.slice(0, 10)],
    );
    for (const name of ['Ana', 'Rui', 'Eva']) {
      const [student] = await tenant.sql<{ id: string }>(
        `INSERT INTO student (organization_id, first_name, last_name) VALUES ($1, $2, $3) RETURNING id`,
        [tenant.organizationId, name, `Demo${hour}`],
      );
      await tenant.sql(
        `INSERT INTO attendance (organization_id, class_session_id, student_id, status, recorded_by_membership_id)
         VALUES ($1, $2, $3, 'present', $4)`,
        [tenant.organizationId, session!.id, student!.id, tenant.ownerMembershipId],
      );
    }
  }
  return pool!.id;
}

/** The seed runs as the owner login, across RLS, as `pnpm db:seed` does. */
async function asSeed<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: process.env['DATABASE_URL'] });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

test("the energy seed populates the demo tank's cost per use, and a second run changes nothing", async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTaughtTank(tenant);

    await asSeed(async (client) => {
      const first = await seedEnergy(client, tenant.organizationId);
      assert.equal(first.meters, 4, 'Geral, Bomba de calor, iluminação and the gas boiler');
      assert.equal(first.tariffs, 2, "the tank's two meters are priced");
      assert.equal(first.invoices, 24, 'twelve electricity bills and twelve gas bills');
      assert.deepEqual(await seedEnergy(client, tenant.organizationId), NOTHING, 'idempotent');
    });

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const report = await new EnergyController().costReport(poolId);
      assert.ok(report);
      assert.equal(report.months.length, 12, 'the trend covers twelve months');
      assert.deepEqual(
        report.sources.map((source) => source.name).sort(),
        ['Bomba de calor', 'Gás natural — caldeira'],
        'the tank is its own two meters, never the Geral',
      );
      assert.ok(report.monthsWithConsumption >= 12);
      assert.equal(report.monthsPriced, report.monthsWithConsumption, 'every month is priced');
      assert.equal(typeof report.costCents, 'number');
      assert.ok(report.allocatableMinutes > 0, 'lessons were taught in a priced month');

      // The three rates the screen shows, each a number.
      const perLessonHour = (report.costCents! - (report.unallocatedCents ?? 0)) / (report.allocatableMinutes / 60);
      assert.ok(Number.isFinite(perLessonHour) && perLessonHour > 0, `cost per lesson hour ${perLessonHour}`);
      assert.equal(report.bathers, 6);
      assert.ok(report.cubicMetres !== null && report.cubicMetres > 400);
    });
  });
});

test('seeded a month ago and again today, the dials keep running and each month is billed once', async () => {
  await withScratchTenant(async (tenant) => {
    await aTaughtTank(tenant);
    const now = new Date();
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 12));

    await asSeed(async (client) => {
      await seedEnergy(client, tenant.organizationId, lastMonth);
      // The first version recomputed every reading from today, and the dial
      // trigger refused the run a month later.
      const later = await seedEnergy(client, tenant.organizationId, now);
      assert.equal(later.meters, 0);
      assert.equal(later.readings, 3, "this month's reading on each of the three dials");
      assert.equal(later.invoices, 2, "last month's bill on each supply");
      assert.deepEqual(await seedEnergy(client, tenant.organizationId, now), NOTHING);

      // No period billed twice, and every bill's kWh is what its dial read.
      const { rows } = await client.query<{ periods: number; bills: number; mismatched: number }>(
        `SELECT count(DISTINCT (i.meter_id, i.period_start))::int AS periods,
                count(*)::int AS bills,
                count(*) FILTER (WHERE
                  (SELECT sum(r.kwh) FROM energy_invoice_register r WHERE r.invoice_id = i.id)
                  <> (SELECT e.value FROM energy_reading e
                       WHERE e.meter_id = i.meter_id AND e.taken_at::date = i.period_end + 1)
                   - (SELECT e.value FROM energy_reading e
                       WHERE e.meter_id = i.meter_id AND e.taken_at::date = i.period_start))::int AS mismatched
           FROM energy_invoice i
          WHERE i.organization_id = $1`,
        [tenant.organizationId],
      );
      assert.equal(rows[0]!.bills, rows[0]!.periods, 'one bill per supply per period');
      assert.equal(rows[0]!.bills, 26, 'thirteen months billed on each supply');
      assert.equal(rows[0]!.mismatched, 0, 'every bill reads what its dial read');
    });
  });
});
