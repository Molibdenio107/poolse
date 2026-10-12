import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { LifeguardPeriodsController, LifeguardRosterController } from './roster.controller.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * Vigilance periods — 12 October 2026.
 *
 * A period writes the days at once — the site's opening hours of each day or a
 * typed window, on several tanks — skipping days the site is shut and days a
 * closure covers, and counting rather than refusing a day the person already
 * holds. Ending it removes the days from a date on and keeps the ones before.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/** A Monday four weeks out, so every day is in the future and fixed. */
function aMonday(): string {
  const day = new Date();
  day.setUTCHours(12, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() + 28 + ((8 - day.getUTCDay()) % 7));
  return day.toISOString().slice(0, 10);
}

function plus(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const HOUR = 3_600_000;

/** Two tanks; open Mondays 09–13 and Wednesdays 17–21, shut the rest of the week. */
async function setUp(tenant: ScratchTenant): Promise<{ pools: string[]; monday: string; ana: string }> {
  const pools: string[] = [];
  for (const name of ['Tanque 25m', 'Tanque aprendizagem']) {
    const [pool] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool (organization_id, facility_id, name) VALUES ($1, $2, $3) RETURNING id`,
      [tenant.organizationId, tenant.facilityId, name],
    );
    pools.push(pool!.id);
  }
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const hours = weekday === 1 ? ['09:00', '13:00'] : weekday === 3 ? ['17:00', '21:00'] : null;
    await tenant.sql(
      `INSERT INTO facility_hours (organization_id, facility_id, weekday, available, opens_at, closes_at)
       VALUES ($1, $2, $3, $4, $5::time, $6::time)
       ON CONFLICT (organization_id, facility_id, weekday)
       DO UPDATE SET available = EXCLUDED.available, opens_at = EXCLUDED.opens_at,
                     closes_at = EXCLUDED.closes_at`,
      // A shut day still carries hours (NOT NULL); `available` is what shuts it.
      [tenant.organizationId, tenant.facilityId, weekday, hours !== null, hours?.[0] ?? '09:00', hours?.[1] ?? '13:00'],
    );
  }
  const ana = await addMember(tenant, 'Ana', 'Vigilante', ['instructor']);
  return { pools, monday: aMonday(), ana };
}

test('a period over opening hours on two tanks writes each open day, and skips a closure', async () => {
  await withScratchTenant(async (tenant) => {
    const { pools, monday, ana } = await setUp(tenant);
    // A feriado on the second Monday.
    await tenant.sql(
      `INSERT INTO closure (organization_id, facility_id, starts_on, ends_on, reason)
       VALUES ($1, $2, $3::date, $3::date, 'Feriado')`,
      [tenant.organizationId, tenant.facilityId, plus(monday, 7)],
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const made = await new LifeguardRosterController().addPeriod(tenant.facilityId, {
        membershipId: ana,
        poolIds: pools,
        startsOn: monday,
        endsOn: plus(monday, 13),
        // Friday is asked for and the site is shut on Fridays: nothing to write.
        weekdays: [1, 3, 5],
        hours: 'opening',
      });
      // Two weeks × (Mon + Wed) × two tanks, less the feriado's two.
      assert.equal(made.written, 6);
      assert.equal(made.clashes, 0);

      const week = await new LifeguardRosterController().read(tenant.facilityId, monday, '14');
      assert.equal(week.duties.length, 6);
      for (const duty of week.duties) {
        assert.equal(duty.periodId, made.id);
        assert.equal(new Date(duty.endsAt).getTime() - new Date(duty.startsAt).getTime(), 4 * HOUR);
      }
      // Covered, so no gaps on either tank on those days; the feriado is no gap either.
      assert.equal(week.gaps.length, 0);

      const listed = week.periods.find((period) => period.id === made.id);
      assert.deepEqual(listed?.weekdays, [1, 3, 5]);
      assert.equal(listed?.from, null, 'opening hours');
      assert.equal(listed?.pools.length, 2);
    });
  });
});

test('typed hours past midnight end the next day', async () => {
  await withScratchTenant(async (tenant) => {
    const { pools, monday, ana } = await setUp(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const made = await new LifeguardRosterController().addPeriod(tenant.facilityId, {
        membershipId: ana,
        poolIds: [pools[0]],
        startsOn: monday,
        endsOn: monday,
        weekdays: [1],
        hours: 'fixed',
        from: '22:00',
        to: '02:00',
      });
      assert.equal(made.written, 1);
      const day = await new LifeguardRosterController().read(tenant.facilityId, monday, '2');
      const duty = day.duties[0]!;
      assert.equal(new Date(duty.endsAt).getTime() - new Date(duty.startsAt).getTime(), 4 * HOUR);
    });
  });
});

test('a day the person already holds is left and counted, not a refusal of the period', async () => {
  await withScratchTenant(async (tenant) => {
    const { pools, monday, ana } = await setUp(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const roster = new LifeguardRosterController();
      await roster.add(tenant.facilityId, { poolId: pools[0], membershipId: ana, day: monday, from: '09:00', to: '10:00' });

      const made = await roster.addPeriod(tenant.facilityId, {
        membershipId: ana,
        poolIds: pools,
        startsOn: monday,
        endsOn: plus(monday, 6),
        weekdays: [1, 3],
        hours: 'opening',
      });
      assert.equal(made.written, 3);
      assert.equal(made.clashes, 1);
    });
  });
});

test('ending a period removes its days from a date on and keeps the ones before', async () => {
  await withScratchTenant(async (tenant) => {
    const { pools, monday, ana } = await setUp(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const roster = new LifeguardRosterController();
      const periods = new LifeguardPeriodsController();
      const made = await roster.addPeriod(tenant.facilityId, {
        membershipId: ana,
        poolIds: [pools[0]],
        startsOn: monday,
        endsOn: plus(monday, 13),
        weekdays: [1, 3],
        hours: 'opening',
      });
      assert.equal(made.written, 4);

      // The past is the record: an end before today is refused.
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      await expectStatus(() => periods.end(made.id, { from: yesterday }), 400);

      const { removed } = await periods.end(made.id, { from: plus(monday, 7) });
      assert.equal(removed, 2, 'the second week');

      const after = await roster.read(tenant.facilityId, monday, '14');
      assert.equal(after.duties.length, 2, 'the first week stays');
      assert.equal(after.periods.find((p) => p.id === made.id)?.endsOn, plus(monday, 6));

      // Ended from its own first day, it has nothing left and leaves the list.
      await periods.end(made.id, { from: monday });
      const gone = await roster.read(tenant.facilityId, monday, '14');
      assert.equal(gone.duties.length, 0);
      assert.equal(gone.periods.some((p) => p.id === made.id), false);
    });
  });
});

test('a period needs a weekday, a tank, a staff member, and is the office’s to set', async () => {
  await withScratchTenant(async (tenant) => {
    const { pools, monday, ana } = await setUp(tenant);
    const parent = await addMember(tenant, 'Carla', 'Mae', ['guardian']);
    const base = { membershipId: ana, poolIds: pools, startsOn: monday, endsOn: monday, weekdays: [1], hours: 'opening' };

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const roster = new LifeguardRosterController();
      await expectStatus(() => roster.addPeriod(tenant.facilityId, { ...base, weekdays: [] }), 400);
      await expectStatus(() => roster.addPeriod(tenant.facilityId, { ...base, poolIds: [] }), 400);
      await expectStatus(() => roster.addPeriod(tenant.facilityId, { ...base, membershipId: parent }), 400);
      await expectStatus(() => roster.addPeriod(tenant.facilityId, { ...base, endsOn: plus(monday, -1) }), 400);
      await expectStatus(() => roster.addPeriod(tenant.facilityId, { ...base, endsOn: plus(monday, 500) }), 400);
      await expectStatus(() => roster.addPeriod(tenant.facilityId, { ...base, hours: 'fixed', from: '10:00', to: '10:00' }), 400);
    });

    await actingAs(tenant, { membershipId: ana, roles: ['instructor'] }, async () => {
      await expectStatus(() => new LifeguardRosterController().addPeriod(tenant.facilityId, base), 403);
    });

    const [{ count } = { count: -1 }] = await tenant.sql<{ count: number }>(
      'SELECT count(*)::int AS count FROM lifeguard_period',
    );
    assert.equal(count, 0, 'nothing was written');
  });
});
