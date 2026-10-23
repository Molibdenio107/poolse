import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { seedEnergy } from '@poolse/db/seed-energy';
import { EnergyInvoicesController } from './invoices.controller.js';
import { EnergyController } from './energy.controller.js';
import { readBillingOverview } from '../platform/platform.repository.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * The Energia dashboard — POOLSE-106, QA 1, 2 and 6 through the API, and the
 * read count /admin shows.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

function monthsAgo(back: number, day = 1): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, day, 12)).toISOString().slice(0, 10);
}

function lastDay(back: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back + 1, 0, 12)).toISOString().slice(0, 10);
}

/** A tank with a turma, last month's lessons and swimmers — the demo club's shape. */
async function aTaughtTank(tenant: ScratchTenant): Promise<void> {
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind, volume_litres)
     VALUES ($1, $2, 'Piscina principal', 'indoor', 431250) RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );
  const [group] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group (organization_id, season_id, name, pool_id) VALUES ($1, $2, 'Iniciação', $3) RETURNING id`,
    [tenant.organizationId, tenant.seasonId, pool!.id],
  );
  const at = `${monthsAgo(1)}T09:00:00Z`;
  const [session] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_session (organization_id, class_group_id, pool_id, starts_at, duration_minutes, occurs_on)
     VALUES ($1, $2, $3, $4, 60, $5) RETURNING id`,
    [tenant.organizationId, group!.id, pool!.id, at, monthsAgo(1)],
  );
  for (const name of ['Ana', 'Rui']) {
    const [student] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name) VALUES ($1, $2, 'Silva') RETURNING id`,
      [tenant.organizationId, name],
    );
    await tenant.sql(
      `INSERT INTO attendance (organization_id, class_session_id, student_id, status, recorded_by_membership_id)
       VALUES ($1, $2, $3, 'present', $4)`,
      [tenant.organizationId, session!.id, student!.id, tenant.ownerMembershipId],
    );
  }
}

/** One bill on a meter, with one energy line in kWh. */
async function aBill(
  tenant: ScratchTenant,
  meterId: string,
  periodStart: string,
  periodEnd: string,
  totalCents: number,
  kwh: number,
): Promise<void> {
  const [bill] = await tenant.sql<{ id: string }>(
    `INSERT INTO energy_invoice
       (organization_id, meter_id, supplier, invoice_number, issued_on, period_start, period_end,
        subtotal_cents, vat_cents, total_cents, document_total_cents)
     VALUES ($1, $2, 'Teste', $3, $4, $5, $4, $6, 0, $6, $6) RETURNING id`,
    [tenant.organizationId, meterId, `T-${meterId.slice(0, 6)}-${periodEnd}`, periodEnd, periodStart, totalCents],
  );
  await tenant.sql(
    `INSERT INTO energy_invoice_line
       (organization_id, invoice_id, position, kind, description, quantity, unit, unit_price, amount_cents,
        discount_cents, total_cents, vat_rate)
     VALUES ($1, $2, 0, 'energy', 'Consumo', $3, 'kWh', 0.1, $4, 0, $4, 23)`,
    [tenant.organizationId, bill!.id, kwh, totalCents],
  );
}

async function seeded(tenant: ScratchTenant): Promise<void> {
  await aTaughtTank(tenant);
  const client = new pg.Client({ connectionString: process.env['DATABASE_URL'] });
  await client.connect();
  try {
    await seedEnergy(client, tenant.organizationId);
  } finally {
    await client.end();
  }
}

test('QA 1 — the owner sees twelve months by carrier, this month, and cost per lesson hour and swimmer', async () => {
  await withScratchTenant(async (tenant) => {
    await seeded(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const summary = await new EnergyInvoicesController().summary();
      assert.equal(summary.canSeeMoney, true);
      assert.equal(summary.months.length, 12, 'a fixed window of twelve months');
      assert.equal(summary.months.at(-1)!.month, monthsAgo(0).slice(0, 7), 'ending with this month');

      // The seed bills electricity on the Geral and gas on the boiler, every month.
      assert.ok((summary.lastTwelve.electricity.cents ?? 0) > 0);
      assert.ok((summary.lastTwelve.gas.cents ?? 0) > 0);
      assert.equal(summary.lastTwelve.water.cents, null, 'no water bill is not a zero');
      assert.deepEqual(summary.metered, { electricity: 3, gas: 1, water: 0 });
      // The last month billed is last month: a period ends before its bill arrives.
      assert.equal(summary.lastBilledMonth, monthsAgo(1).slice(0, 7));

      // POOLSE-28's figures, summed over the club's tanks.
      assert.ok(summary.perUse);
      assert.equal(summary.perUse.poolsCounted, 1);
      assert.equal(summary.perUse.bathers, 2);
      assert.equal(summary.perUse.lessonHours, 1);
      assert.ok((summary.perUse.perLessonHourCents ?? 0) > 0, 'cost per lesson hour is a number');
      assert.ok((summary.perUse.perBatherCents ?? 0) > 0, 'cost per swimmer is a number');
      assert.deepEqual(summary.missing, [], 'every supply was billed last month');
    });
  });
});

test('a change against last year compares only the months billed in both years', async () => {
  await withScratchTenant(async (tenant) => {
    const meter = await actingAs(tenant, { roles: ['owner'] }, () =>
      new EnergyController().create(tenant.facilityId, { name: 'Geral', kind: 'total', cpe: 'PT0002000012345678AB' }),
    );
    // Last month and the same month a year before; and one more this year with no partner.
    await aBill(tenant, meter.id, monthsAgo(1), lastDay(1), 30_000, 2_000);
    await aBill(tenant, meter.id, monthsAgo(13), lastDay(13), 25_000, 1_800);
    await aBill(tenant, meter.id, monthsAgo(2), lastDay(2), 28_000, 1_900);

    await actingAs(tenant, { roles: ['admin'] }, async () => {
      const { lastTwelve } = await new EnergyInvoicesController().summary();
      assert.equal(lastTwelve.electricity.cents, 58_000);
      assert.equal(lastTwelve.electricity.comparedMonths, 1);
      assert.equal(lastTwelve.electricity.previousCents, 25_000);
      assert.equal(lastTwelve.electricity.currentComparedCents, 30_000, 'the unpartnered month is not compared');
    });
  });
});

test('QA 2 — a supply with no bill for 50 days is missing; a sub-meter is never', async () => {
  await withScratchTenant(async (tenant) => {
    const { stale, sub } = await actingAs(tenant, { roles: ['owner'] }, async () => {
      const api = new EnergyController();
      const staleMeter = await api.create(tenant.facilityId, { name: 'Gás', kind: 'heating', carrier: 'gas', cpe: 'PT1601000000483112GN' });
      const subMeter = await api.create(tenant.facilityId, { name: 'Bomba', kind: 'pump' });
      return { stale: staleMeter.id, sub: subMeter.id };
    });
    const ended = new Date(Date.now() - 50 * 86_400_000).toISOString().slice(0, 10);
    const began = new Date(Date.now() - 80 * 86_400_000).toISOString().slice(0, 10);
    await aBill(tenant, stale, began, ended, 9_000, 1_000);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { missing } = await new EnergyInvoicesController().summary();
      assert.deepEqual(
        missing.map((m) => [m.meterId, m.carrier, m.lastPeriodEnd]),
        [[stale, 'gas', ended]],
      );
      assert.ok(!missing.some((m) => m.meterId === sub), 'no supply point, never billed: not a supply');
    });
  });
});

test('QA 6 — maintenance reads the dashboard with every euro withheld; an instructor is refused', async () => {
  await withScratchTenant(async (tenant) => {
    await seeded(tenant);
    await actingAs(tenant, { roles: ['maintenance'] }, async () => {
      const summary = await new EnergyInvoicesController().summary();
      assert.equal(summary.canSeeMoney, false);
      assert.equal(summary.perUse, null);
      for (const month of summary.months) {
        for (const carrier of ['electricity', 'gas', 'water'] as const) {
          assert.equal(month.carriers[carrier].cents, null, `${month.month} ${carrier}`);
        }
      }
      for (const carrier of ['electricity', 'gas', 'water'] as const) {
        assert.equal(summary.lastTwelve[carrier].cents, null);
        assert.equal(summary.lastTwelve[carrier].previousCents, null);
        assert.equal(summary.thisMonth.carriers[carrier].cents, null);
      }
      assert.ok((summary.lastTwelve.electricity.quantity ?? 0) > 0, 'the kWh stay');
      // Nothing in the payload is a euro figure.
      assert.doesNotMatch(JSON.stringify(summary), /"(cents|previousCents|currentComparedCents)":\d/);
    });
    await actingAs(tenant, { roles: ['instructor'] }, () =>
      expectStatus(() => new EnergyInvoicesController().summary(), 403),
    );
  });
});

test("another club's bills are not in the summary", async () => {
  await withScratchTenant(async (tenant) => {
    await seeded(tenant);
    await withScratchTenant(async (other) => {
      await actingAs(other, { roles: ['owner'] }, async () => {
        const summary = await new EnergyInvoicesController().summary();
        assert.equal(summary.lastTwelve.electricity.cents, null);
        assert.deepEqual(summary.metered, { electricity: 0, gas: 0, water: 0 });
      });
    });
  });
});

test('a read is logged by the club and counted on /admin for this month', async () => {
  await withScratchTenant(async (tenant) => {
    const before = (await readBillingOverview()).energyReads.at(-1)!;
    await actingAs(tenant, { roles: ['maintenance'] }, async () => {
      const api = new EnergyInvoicesController();
      await api.recordRead({ succeeded: true });
      await api.recordRead({ succeeded: false });
    });
    const after = (await readBillingOverview()).energyReads;
    assert.equal(after.length, 6, 'six months, every one present');
    assert.equal(after.at(-1)!.reads - before.reads, 2);
    assert.equal(after.at(-1)!.unread - before.unread, 1, 'a read that found nothing is still a paid call');

    await actingAs(tenant, { roles: ['instructor'] }, () =>
      expectStatus(() => new EnergyInvoicesController().recordRead({ succeeded: true }), 403),
    );
  });
});
