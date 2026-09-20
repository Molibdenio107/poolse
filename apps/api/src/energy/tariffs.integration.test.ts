import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { EnergyController } from './energy.controller.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * Tariffs — slice 5.3, the half that costs a meter with no bill.
 *
 * The arithmetic is one multiplication, so what these tests are actually for is
 * everything around it: which rate a reading is priced at, what happens to a
 * month the rates only half reach, and the boundary day — `effective_to` is the
 * LAST day at that rate, and a reading taken on it is priced at the old rate.
 * That off-by-one is invisible on screen and wrong by a whole month's euros.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/** An instant on the first of a month, `back` months ago, at 08:00 UTC. */
function firstOf(back: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1, 8)).toISOString();
}

/** `YYYY-MM-01` for a month `back` months ago — the day a rate starts on. */
function firstDay(back: number): string {
  return firstOf(back).slice(0, 10);
}

/** `YYYY-MM` for a month `back` months ago. */
function monthKey(back: number): string {
  return firstOf(back).slice(0, 7);
}

/** A dial reading 1000 when logging began, with three months of figures on it. */
async function aMeterWithThreeMonths(facilityId: string): Promise<string> {
  const controller = new EnergyController();
  const { id } = await controller.create(facilityId, {
    name: 'Bomba de calor',
    kind: 'heating',
    initialIndex: 1000,
  });
  // 400, then 500, then 150 kWh.
  await controller.record(id, { takenAt: firstOf(2), value: 1400 });
  await controller.record(id, { takenAt: firstOf(1), value: 1900 });
  await controller.record(id, { takenAt: firstOf(0), value: 2050 });
  return id;
}

test('5.3 — a rate turns a sub-meter\'s kWh into euros', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new EnergyController();
      const id = await aMeterWithThreeMonths(tenant.facilityId);

      // Before any rate: kWh and nothing else. This is the state every
      // sub-meter in the product was in before this slice.
      const before = await controller.one(id);
      assert.deepEqual(
        before.readings.map((r) => r.costCents),
        [null, null, null],
        'no rate means no cost — a dash, never a zero',
      );
      assert.equal(before.monthly.costCents, null, 'and no total to show');
      assert.equal(before.monthly.monthsPriced, 0);
      assert.equal(before.monthly.monthsWithConsumption, 3);

      await controller.price(id, { unitPrice: 0.1548, effectiveFrom: firstDay(2) });

      const after = await controller.one(id);
      // 400 x 0.1548 = 61.92, 500 x 0.1548 = 77.40, 150 x 0.1548 = 23.22.
      assert.deepEqual(
        after.readings.map((r) => [r.consumed, r.costCents]),
        [[150, 2322], [500, 7740], [400, 6192]],
        'each reading costed at the rate live on the day it was taken',
      );
      assert.deepEqual(
        after.readings.map((r) => r.costProvenance),
        ['estimated', 'estimated', 'estimated'],
        'a contracted rate still yields an estimated cost — the euros were multiplied',
      );

      const byMonth = new Map(after.monthly.months.map((m) => [m.month, m.costCents]));
      assert.equal(byMonth.get(monthKey(0)), 2322);
      assert.equal(byMonth.get(monthKey(1)), 7740);
      assert.equal(byMonth.get(monthKey(2)), 6192);
      assert.equal(byMonth.get(monthKey(3)), null, 'a month with no consumption is not costed');

      assert.equal(after.monthly.costCents, 2322 + 7740 + 6192);
      assert.equal(after.monthly.monthsPriced, 3);
      assert.equal(after.monthly.monthsWithConsumption, 3);
      assert.equal(after.monthly.costProvenance, 'estimated');
    });
  });
});

test('5.3 — a month the rates only half reach is not half-costed', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new EnergyController();
      const id = await aMeterWithThreeMonths(tenant.facilityId);

      // The club only knows its rate from last month onwards.
      await controller.price(id, { unitPrice: 0.2, effectiveFrom: firstDay(1) });

      const { monthly } = await controller.one(id);
      const byMonth = new Map(monthly.months.map((m) => [m.month, m.costCents]));

      assert.equal(byMonth.get(monthKey(2)), null, 'the month before the rate has no cost');
      assert.equal(byMonth.get(monthKey(1)), 10000, '500 kWh x 0.20');
      assert.equal(byMonth.get(monthKey(0)), 3000, '150 kWh x 0.20');

      assert.equal(monthly.monthsWithConsumption, 3);
      assert.equal(monthly.monthsPriced, 2, 'and the panel can say 2 of 3');
      assert.equal(monthly.costCents, 13000, 'the total covers only the months it actually reached');
    });
  });
});

test('5.3 — effective_to is the last day AT that rate', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new EnergyController();
      const { id } = await controller.create(tenant.facilityId, {
        name: 'AQS',
        kind: 'heating',
        initialIndex: 0,
      });

      /*
       * Fixed dates, not relative ones: this test is about a single day and
       * running it on the 1st of a month must not change what it asserts. The
       * twelve-month window does not apply — the per-reading cost has no
       * window, which is why the assertions below read `readings` and not
       * `monthly`.
       */
      await controller.record(id, { takenAt: '2025-12-31T08:00:00.000Z', value: 100 });
      await controller.record(id, { takenAt: '2026-01-01T08:00:00.000Z', value: 200 });

      await controller.price(id, {
        unitPrice: 0.1,
        effectiveFrom: '2025-01-01',
        effectiveTo: '2025-12-31',
      });
      await controller.price(id, { unitPrice: 0.5, effectiveFrom: '2026-01-01' });

      const { readings } = await controller.one(id);
      const byDay = new Map(readings.map((r) => [r.takenAt.slice(0, 10), r.costCents]));

      // 100 kWh on the closing day is still the old rate: 100 x 0.10 = 10.00.
      assert.equal(byDay.get('2025-12-31'), 1000, 'the closing day is at the old rate');
      // 100 kWh the next day is the new one: 100 x 0.50 = 50.00.
      assert.equal(byDay.get('2026-01-01'), 5000, 'and the next day is at the new one');
    });
  });
});

test('5.3 — one live rate at a time, and the refusal names the field', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new EnergyController();
      const { id } = await controller.create(tenant.facilityId, { name: 'Bomba', kind: 'pump' });

      await controller.price(id, { unitPrice: 0.15, effectiveFrom: '2026-01-01' });

      // An open-ended rate runs to infinity, so anything after it overlaps.
      await expectStatus(
        () => controller.price(id, { unitPrice: 0.2, effectiveFrom: '2026-06-01' }),
        409,
      );
      // And so does one that starts before it and runs past its first day.
      await expectStatus(
        () => controller.price(id, { unitPrice: 0.2, effectiveFrom: '2025-01-01', effectiveTo: '2026-01-01' }),
        409,
      );
      // Ending the day before is fine — the ranges touch and do not overlap.
      await controller.price(id, {
        unitPrice: 0.2,
        effectiveFrom: '2025-01-01',
        effectiveTo: '2025-12-31',
      });

      const { tariffs } = await controller.one(id);
      assert.equal(tariffs.length, 2);
      assert.deepEqual(
        tariffs.map((t) => t.effectiveFrom),
        ['2026-01-01', '2025-01-01'],
        'newest first, and the dates survive as days rather than instants',
      );
      assert.equal(tariffs[0]!.effectiveTo, null, 'the live one is open-ended');
      assert.equal(tariffs[1]!.effectiveTo, '2025-12-31');
    });
  });
});

test('5.3 — a rate can never be actual, and its bounds must bracket it', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new EnergyController();
      const { id } = await controller.create(tenant.facilityId, { name: 'Bomba', kind: 'pump' });

      // A euro that happened is a fatura, and a fatura is energy_invoice.
      await expectStatus(
        () => controller.price(id, { unitPrice: 0.15, effectiveFrom: '2026-01-01', provenance: 'actual' }),
        400,
      );
      await expectStatus(
        () => controller.price(id, { unitPrice: 0, effectiveFrom: '2026-01-01' }),
        400,
      );
      await expectStatus(
        () => controller.price(id, { unitPrice: 0.15, effectiveFrom: '2026-02-01', effectiveTo: '2026-01-01' }),
        400,
      );
      await expectStatus(
        () =>
          controller.price(id, {
            unitPrice: 0.15,
            effectiveFrom: '2026-01-01',
            unitPriceLow: 0.2,
          }),
        400,
      );
      await expectStatus(
        () => controller.price(id, { unitPrice: 0.15, effectiveFrom: '2026-13-01' }),
        400,
      );
    });
  });
});

test('5.3 — a cost is never stronger than the rate it came from', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new EnergyController();
      const id = await aMeterWithThreeMonths(tenant.facilityId);

      await controller.price(id, {
        unitPrice: 0.15,
        unitPriceLow: 0.12,
        unitPriceHigh: 0.19,
        provenance: 'assumed',
        effectiveFrom: firstDay(2),
        note: 'A média do ano passado',
      });

      const { readings, monthly, tariffs } = await controller.one(id);
      assert.equal(tariffs[0]!.provenance, 'assumed');
      assert.equal(tariffs[0]!.unitPriceLow, 0.12, 'the bounds are stored from day one');
      assert.equal(tariffs[0]!.unitPriceHigh, 0.19);
      assert.equal(tariffs[0]!.live, true);
      assert.equal(readings[0]!.costProvenance, 'assumed');
      assert.equal(monthly.costProvenance, 'assumed', 'the total is labelled with its weakest part');
    });
  });
});

test('5.3 — a rate that never applied takes its euros with it', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new EnergyController();
      const id = await aMeterWithThreeMonths(tenant.facilityId);

      const { id: tariffId } = await controller.price(id, {
        unitPrice: 0.15,
        effectiveFrom: firstDay(2),
      });

      // A correction: the figure was typed wrong, and it was never 0.15.
      await controller.reprice(id, tariffId, { unitPrice: 0.3, effectiveFrom: firstDay(2) });
      const corrected = await controller.one(id);
      assert.equal(corrected.readings[0]!.costCents, 4500, '150 kWh x 0.30');

      await controller.unprice(id, tariffId);

      const gone = await controller.one(id);
      assert.deepEqual(gone.tariffs, [], 'archived rates are out of the list');
      assert.deepEqual(
        gone.readings.map((r) => r.costCents),
        [null, null, null],
        'and the months it priced are dashes again',
      );
      assert.equal(gone.monthly.costCents, null);
      assert.equal(gone.monthly.monthsPriced, 0);

      // The slot it held is free, which is what makes archiving a way back.
      await controller.price(id, { unitPrice: 0.15, effectiveFrom: firstDay(2) });
    });
  });
});

test('5.3 — maintenance reads what energy costs and does not decide it', async () => {
  await withScratchTenant(async (tenant) => {
    let meterId = '';
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new EnergyController();
      meterId = await aMeterWithThreeMonths(tenant.facilityId);
      await controller.price(meterId, { unitPrice: 0.15, effectiveFrom: firstDay(2) });
    });

    await actingAs(tenant, { roles: ['maintenance'] }, async () => {
      const controller = new EnergyController();
      const { readings, tariffs, canPrice } = await controller.one(meterId);

      assert.equal(canPrice, false, 'the screen is told not to offer the control');
      assert.equal(readings[0]!.costCents, 2250, 'but the cost is not hidden — a fatura is not either');
      assert.equal(tariffs.length, 1, 'nor is the rate it came from');

      // And hiding the control is never the control.
      await expectStatus(
        () => controller.price(meterId, { unitPrice: 0.9, effectiveFrom: '2020-01-01' }),
        403,
      );
      await expectStatus(() => controller.unprice(meterId, tariffs[0]!.id), 403);
      await expectStatus(
        () => controller.reprice(meterId, tariffs[0]!.id, { unitPrice: 0.9, effectiveFrom: '2020-01-01' }),
        403,
      );
    });
  });
});

test('5.3 — an instructor sees no part of the module', async () => {
  await withScratchTenant(async (tenant) => {
    let meterId = '';
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new EnergyController();
      const { id } = await controller.create(tenant.facilityId, { name: 'Bomba', kind: 'pump' });
      meterId = id;
    });

    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      const controller = new EnergyController();
      await expectStatus(() => controller.one(meterId), 403);
      await expectStatus(
        () => controller.price(meterId, { unitPrice: 0.15, effectiveFrom: '2026-01-01' }),
        403,
      );
    });
  });
});
