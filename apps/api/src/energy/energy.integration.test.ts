import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { EnergyController } from './energy.controller.js';
import {
  actingAs,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * Energy — slices 5.1 and 5.2.
 *
 * The module is one flag and one piece of arithmetic, so this file is mostly
 * about the arithmetic being right for *both* values of the flag — a dial and
 * an interval figure are turned into consumption in different ways, and a test
 * that covered one would pass with the other silently wrong. The refusals
 * carry their numbers, as every trigger refusal here does, and the dashboard's
 * twelve months are always twelve.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/** A pool at the scratch site, for the "which tank" picker. */
async function aPool(tenant: ScratchTenant): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name) VALUES ($1, $2, 'Tanque')
     RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );
  return row!.id;
}

/** An instant on the first of a month, `back` months ago, at 08:00 UTC. */
function firstOf(back: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1, 8));
  return d.toISOString();
}

/** `YYYY-MM` for a month `back` months ago, in UTC — the scratch site's zone is Lisbon, same month at 08:00. */
function monthKey(back: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
  return `${d.getUTCFullYear()}-${`${d.getUTCMonth() + 1}`.padStart(2, '0')}`;
}

test('5.2 — a dial yields the difference between readings, from the initial index', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new EnergyController();
      const { id } = await controller.create(tenant.facilityId, {
        name: 'Geral',
        kind: 'total',
        initialIndex: 1000,
      });

      await controller.record(id, { takenAt: firstOf(2), value: 1400 });
      await controller.record(id, { takenAt: firstOf(1), value: 1900 });
      await controller.record(id, { takenAt: firstOf(0), value: 2050 });

      const { readings, monthly, meter } = await controller.one(id);

      assert.equal(meter.latestValue, 2050);
      assert.equal(meter.readingCount, 3);

      // Newest first, each with what it says was used since the one before.
      assert.deepEqual(
        readings.map((r) => [r.value, r.consumed]),
        [[2050, 150], [1900, 500], [1400, 400]],
        'the first delta is measured from the initial index',
      );

      assert.equal(monthly.length, 12, 'twelve months, whatever was logged');
      const byMonth = new Map(monthly.map((m) => [m.month, m.consumed]));
      assert.equal(byMonth.get(monthKey(0)), 150);
      assert.equal(byMonth.get(monthKey(1)), 500);
      assert.equal(byMonth.get(monthKey(2)), 400);
      assert.equal(byMonth.get(monthKey(3)), null, 'an empty month is null, not zero');
    });
  });
});

test('5.2 — a dial with no initial index gives nothing for its first reading', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new EnergyController();
      const { id } = await controller.create(tenant.facilityId, { name: 'Bomba', kind: 'pump' });

      await controller.record(id, { takenAt: firstOf(1), value: 500 });
      await controller.record(id, { takenAt: firstOf(0), value: 620 });

      const { readings, monthly } = await controller.one(id);
      assert.deepEqual(
        readings.map((r) => r.consumed),
        [120, null],
        'nothing to measure the first reading from',
      );
      const byMonth = new Map(monthly.map((m) => [m.month, m.consumed]));
      assert.equal(byMonth.get(monthKey(1)), null, 'and that month stays empty rather than zero');
    });
  });
});

test('5.2 — an interval meter is its own consumption', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new EnergyController();
      const { id } = await controller.create(tenant.facilityId, {
        name: 'Fatura',
        kind: 'total',
        reads: 'interval_consumption',
      });

      await controller.record(id, { takenAt: firstOf(1), value: 900 });
      // Lower than the month before, which a dial could never be.
      await controller.record(id, { takenAt: firstOf(0), value: 300 });

      const { readings } = await controller.one(id);
      assert.deepEqual(readings.map((r) => r.consumed), [300, 900]);
    });
  });
});

test('5.1 — a dial does not run backwards, and the refusal quotes the neighbour', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['maintenance'] }, async () => {
      const controller = new EnergyController();
      // A maintenance member may read a meter but not define one.
      await expectStatus(() => controller.create(tenant.facilityId, { name: 'X', kind: 'total' }), 403);
    });

    const id = await actingAs(tenant, { roles: ['owner'] }, async () =>
      (await new EnergyController().create(tenant.facilityId, { name: 'Geral', kind: 'total' })).id,
    );

    await actingAs(tenant, { roles: ['maintenance'] }, async () => {
      const controller = new EnergyController();
      await controller.record(id, { takenAt: firstOf(1), value: 41235 });

      let refusal: unknown = null;
      try {
        await controller.record(id, { takenAt: firstOf(0), value: 4124 });
      } catch (error) {
        refusal = error;
      }
      const response = (refusal as { getResponse?: () => unknown }).getResponse?.() as {
        code: string;
        energyIndex: { neighbour: number; value: number };
        fields: Record<string, string>;
      };
      assert.equal((refusal as { status?: number }).status, 409);
      assert.equal(response.code, 'reading_backwards');
      assert.deepEqual(response.energyIndex, { neighbour: 41235, value: 4124 });
      assert.equal(response.fields['value'], 'energy.readingBackwards');

      // The same instant twice is a conversation, not an overwrite.
      await expectStatus(() => controller.record(id, { takenAt: firstOf(1), value: 41300 }), 409);

      // Archive it, and the corrected figure lands on the same key.
      await controller.unrecord(id, { takenAt: firstOf(1) });
      await controller.record(id, { takenAt: firstOf(1), value: 41300 });
      const { readings } = await controller.one(id);
      assert.deepEqual(readings.map((r) => r.value), [41300]);
    });
  });
});

test('5.1 — a replacement retires the old meter, which then takes no readings', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new EnergyController();
      const poolId = await aPool(tenant);

      const old = await controller.create(tenant.facilityId, { name: 'Bomba', kind: 'pump', poolId });
      await controller.record(old.id, { takenAt: firstOf(1), value: 99990 });

      // The same name is free again once the old dial is retired by the new.
      const fresh = await controller.create(tenant.facilityId, {
        name: 'Bomba',
        kind: 'pump',
        poolId,
        replacedMeterId: old.id,
      });

      const { meters } = await controller.list(tenant.facilityId);
      assert.deepEqual(meters.map((m) => m.id), [fresh.id], 'only the live meter is listed');

      const retired = await controller.one(old.id);
      assert.equal(retired.meter.archived, true);
      assert.equal(retired.canRecord, false, 'its page still opens, its form is gone');
      assert.equal(retired.readings.length, 1, 'and its history stays');

      await expectStatus(() => controller.record(old.id, { takenAt: firstOf(0), value: 100000 }), 409);

      const { meter } = await controller.one(fresh.id);
      assert.equal(meter.replacedMeterName, 'Bomba');
      assert.equal(meter.poolName, 'Tanque');
    });
  });
});

test('5.1 — a name is unique per site, and a foreign pool is refused', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new EnergyController();
      await controller.create(tenant.facilityId, { name: 'Geral', kind: 'total' });
      await expectStatus(() => controller.create(tenant.facilityId, { name: 'geral', kind: 'total' }), 409);
      await expectStatus(
        () =>
          controller.create(tenant.facilityId, {
            name: 'Outro',
            kind: 'pump',
            poolId: '00000000-0000-0000-0000-000000000000',
          }),
        400,
      );
      await expectStatus(
        () => controller.create(tenant.facilityId, { name: 'Fatura', kind: 'total', reads: 'interval_consumption', initialIndex: 5 }),
        400,
      );
    });
  });
});
