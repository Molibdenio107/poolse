import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { EnergyController } from '../energy/energy.controller.js';
import { actingAs, closeHarness, withScratchTenant, type ScratchTenant } from '../test/harness.js';
import { foldIntoMonths, readClimate, saveClimate, HDD_BASE_C } from './climate.repository.js';
import { climateHistoryEnabled, type ClimateDay } from './open-meteo.js';
import { ClimateService, window } from './climate.service.js';

/**
 * Air temperature beside consumption — roadmap 5.4b, POOLSE-28 AC 7.
 *
 * **Nothing here reaches the network.** The archive call is flag-gated and the
 * flag is off in tests, which is itself one of the assertions: a suite that
 * quietly called a third-party API would be a suite that fails when somebody
 * runs it on a train. The fold from daily means into months is pure and is
 * tested directly; the storage and the join are tested against the database.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/** A run of days at a fixed temperature, starting on `from`. */
function days(from: string, count: number, meanC: number): ClimateDay[] {
  const start = new Date(`${from}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => {
    const day = new Date(start.getTime() + i * 86_400_000);
    return {
      date: day.toISOString().slice(0, 10),
      meanC,
      minC: meanC - 3,
      maxC: meanC + 3,
    };
  });
}

/** A site with coordinates, so the filler would have something to ask about. */
async function placeOnTheMap(tenant: ScratchTenant): Promise<void> {
  await tenant.sql(
    `UPDATE facility SET latitude = 39.743, longitude = -8.807
      WHERE organization_id = $1 AND id = $2`,
    [tenant.organizationId, tenant.facilityId],
  );
}

test('5.4b — the archive is off unless a deployment turns it on', async () => {
  assert.equal(
    climateHistoryEnabled(),
    false,
    'no WEATHER_HISTORY_ENABLED means no call — the free pilot and every dev machine',
  );

  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await placeOnTheMap(tenant);

      // The whole sweep, with the flag off: no rows, no request, no error.
      const result = await new ClimateService().run(tenant.organizationId);
      assert.deepEqual(result, { sites: 0, months: 0 });
      assert.deepEqual(await readClimate(tenant.organizationId, tenant.facilityId, 24), []);
    });
  });
});

test('5.4b — daily means fold into months, and HDD is summed per day', async () => {
  // Thirty-one days at 5.5 °C: ten degrees below the 15.5 base, every day.
  const cold = foldIntoMonths(days('2026-01-01', 31, 5.5));
  assert.equal(cold.length, 1);
  assert.equal(cold[0]!.month, '2026-01');
  assert.equal(cold[0]!.meanC, 5.5);
  assert.equal(cold[0]!.daysCounted, 31);
  assert.equal(cold[0]!.heatingDegreeDays, 310, '10 degrees x 31 days');
  assert.equal(cold[0]!.hddBaseC, HDD_BASE_C, 'the base travels with the figure');

  // A warm month needs no heating at all, and HDD floors at zero rather than
  // going negative — a hot August does not earn the club credit.
  const warm = foldIntoMonths(days('2026-08-01', 31, 25));
  assert.equal(warm[0]!.heatingDegreeDays, 0);
  assert.equal(warm[0]!.meanC, 25);

  /*
   * The reason HDD exists beside the mean. Two months with the SAME mean: one
   * steady, one a mild month around a hard cold snap. They need different
   * amounts of heating and a mean cannot tell them apart.
   */
  const steady = foldIntoMonths(days('2026-02-01', 20, 10));
  const snap = foldIntoMonths([...days('2026-03-01', 10, 0), ...days('2026-03-11', 10, 20)]);
  assert.equal(steady[0]!.meanC, snap[0]!.meanC, 'the same mean');
  assert.notEqual(
    steady[0]!.heatingDegreeDays,
    snap[0]!.heatingDegreeDays,
    'and a different amount of heating — which is what the mean alone would hide',
  );
  assert.equal(steady[0]!.heatingDegreeDays, 110, '5.5 below base x 20 days');
  assert.equal(snap[0]!.heatingDegreeDays, 155, '15.5 x 10 cold days, and nothing for the warm ones');
});

test('5.4b — a month spanning the boundary lands in its own month', async () => {
  const folded = foldIntoMonths([...days('2026-01-30', 2, 4), ...days('2026-02-01', 3, 8)]);
  assert.deepEqual(
    folded.map((m) => [m.month, m.daysCounted]),
    [['2026-01', 2], ['2026-02', 3]],
    'and they come back in calendar order',
  );
});

test('5.4b — a refetch corrects in place rather than duplicating', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const month = new Date().toISOString().slice(0, 7);

      await saveClimate(tenant.organizationId, tenant.facilityId, [
        { month, meanC: 9.1, minC: 2, maxC: 15, heatingDegreeDays: 120, hddBaseC: HDD_BASE_C, daysCounted: 20 },
      ]);
      // The same month again, longer and corrected — the shape the daily job
      // produces as the current month fills in.
      await saveClimate(tenant.organizationId, tenant.facilityId, [
        { month, meanC: 9.4, minC: 2, maxC: 17, heatingDegreeDays: 175, hddBaseC: HDD_BASE_C, daysCounted: 30 },
      ]);

      const stored = await readClimate(tenant.organizationId, tenant.facilityId, 24);
      assert.equal(stored.length, 1, 'one row per site per month, by the natural key');
      assert.equal(stored[0]!.meanC, 9.4, 'and the later answer wins');
      assert.equal(stored[0]!.daysCounted, 30);
    });
  });
});

test('5.4b — the temperature reaches the meter through its site', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new EnergyController();
      const { id } = await controller.create(tenant.facilityId, {
        name: 'Geral',
        kind: 'total',
        initialIndex: 0,
      });

      const now = new Date();
      const monthOf = (back: number): string =>
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
          .toISOString()
          .slice(0, 7);

      await saveClimate(tenant.organizationId, tenant.facilityId, [
        { month: monthOf(13), meanC: 7.2, minC: 1, maxC: 14, heatingDegreeDays: 250, hddBaseC: HDD_BASE_C, daysCounted: 31 },
        { month: monthOf(1), meanC: 10.8, minC: 4, maxC: 18, heatingDegreeDays: 140, hddBaseC: HDD_BASE_C, daysCounted: 31 },
      ]);

      const { monthly } = await controller.one(id);
      const byMonth = new Map(monthly.months.map((m) => [m.month, m]));

      assert.equal(byMonth.get(monthOf(1))!.meanTempC, 10.8);
      assert.equal(
        byMonth.get(monthOf(1))!.previousMeanTempC,
        7.2,
        'and the same month a year earlier comes with it',
      );
      assert.equal(byMonth.get(monthOf(2))!.meanTempC, null, 'a month nobody fetched is null');
    });
  });
});

test('5.4b — a mean over nine months is not set against one over twelve', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new EnergyController();
      const { id } = await controller.create(tenant.facilityId, {
        name: 'Geral',
        kind: 'total',
        initialIndex: 0,
      });

      const now = new Date();
      const at = (back: number): string =>
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1, 8)).toISOString();
      const monthOf = (back: number): string => at(back).slice(0, 7);

      // Two comparable months: 13↔1 and 14↔2.
      await controller.record(id, { takenAt: at(14), value: 100 });
      await controller.record(id, { takenAt: at(13), value: 200 });
      await controller.record(id, { takenAt: at(2), value: 900 });
      await controller.record(id, { takenAt: at(1), value: 1000 });

      // Temperature for only one of the two pairs.
      await saveClimate(tenant.organizationId, tenant.facilityId, [
        { month: monthOf(13), meanC: 7, minC: 1, maxC: 14, heatingDegreeDays: 250, hddBaseC: HDD_BASE_C, daysCounted: 31 },
        { month: monthOf(1), meanC: 11, minC: 4, maxC: 18, heatingDegreeDays: 140, hddBaseC: HDD_BASE_C, daysCounted: 31 },
      ]);

      const { monthly } = await controller.one(id);

      assert.equal(monthly.yearOnYear.comparableMonths, 2);
      assert.equal(
        monthly.yearOnYear.meanTempC,
        null,
        'one pair of twelve has no temperature, so the headline says nothing',
      );
      assert.equal(monthly.yearOnYear.previousMeanTempC, null);

      // Fill the other pair and the sentence becomes sayable.
      await saveClimate(tenant.organizationId, tenant.facilityId, [
        { month: monthOf(14), meanC: 9, minC: 2, maxC: 16, heatingDegreeDays: 200, hddBaseC: HDD_BASE_C, daysCounted: 31 },
        { month: monthOf(2), meanC: 13, minC: 6, maxC: 20, heatingDegreeDays: 90, hddBaseC: HDD_BASE_C, daysCounted: 31 },
      ]);

      const filled = await controller.one(id);
      assert.equal(filled.monthly.yearOnYear.meanTempC, 12, 'the mean of 11 and 13');
      assert.equal(filled.monthly.yearOnYear.previousMeanTempC, 8, 'and of 7 and 9');
    });
  });
});

test('5.4b — the window asks for finished days only', () => {
  const { start, end } = window(25);
  assert.match(start, /^\d{4}-\d{2}-01$/, 'it starts on the first of a month');
  assert.ok(end < new Date().toISOString().slice(0, 10), 'and stops before today');
});
