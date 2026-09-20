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
 * Heating cost per lesson hour — POOLSE-28, at the month grain.
 *
 * The arithmetic is three divisions, so what these tests are for is the four
 * ways the report can be quietly wrong: a cancelled session counted as taught,
 * a parceria's hours dropped because somebody inner-joined `class_group`, an
 * absent student counted as a bather, and a month's energy silently discarded
 * because nothing was taught to charge it to.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/**
 * An instant on the first of a month, `back` months ago, at `hour` UTC.
 *
 * The hour matters: `class_session` is unique on (class_group_id, starts_at),
 * so two lessons of one turma on one day must start at different times — which
 * is true of a real timetable and was not true of this file's first draft.
 */
function firstOf(back: number, hour = 8): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1, hour)).toISOString();
}

function firstDay(back: number): string {
  return firstOf(back).slice(0, 10);
}

function monthKey(back: number): string {
  return firstOf(back).slice(0, 7);
}

interface Site {
  poolId: string;
  meterId: string;
  groupId: string;
}

/**
 * A tank of 500 m³ with its own sub-meter, priced at €0.20/kWh, and a turma.
 *
 * The dial runs 1000 → 1400 → 1900: 400 kWh two months ago and 500 kWh last
 * month, which at €0.20 is €80.00 and €100.00.
 */
async function aHeatedPool(tenant: ScratchTenant): Promise<Site> {
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind, volume_litres)
     VALUES ($1, $2, 'Tanque Grande', 'indoor', 500000) RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );

  const [group] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group (organization_id, season_id, name, pool_id)
     VALUES ($1, $2, 'Iniciados A', $3) RETURNING id`,
    [tenant.organizationId, tenant.seasonId, pool!.id],
  );

  const controller = new EnergyController();
  const { id: meterId } = await controller.create(tenant.facilityId, {
    name: 'Bomba de calor',
    kind: 'heating',
    poolId: pool!.id,
    initialIndex: 1000,
  });

  await controller.record(meterId, { takenAt: firstOf(2), value: 1400 });
  await controller.record(meterId, { takenAt: firstOf(1), value: 1900 });
  await controller.price(meterId, { unitPrice: 0.2, effectiveFrom: firstDay(3) });

  return { poolId: pool!.id, meterId, groupId: group!.id };
}

/** One session in the tank, `back` months ago, of `minutes`. */
async function aSession(
  tenant: ScratchTenant,
  site: Site,
  back: number,
  minutes: number,
  options?: { cancelled?: boolean; partnership?: boolean; hour?: number },
): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_session
       (organization_id, class_group_id, pool_id, starts_at, duration_minutes, occurs_on, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      tenant.organizationId,
      // A parceria session carries no turma at all — the case three earlier
      // queries in this codebase dropped by inner-joining `class_group`.
      options?.partnership === true ? null : site.groupId,
      site.poolId,
      firstOf(back, options?.hour ?? 8),
      minutes,
      firstDay(back),
      options?.cancelled === true ? 'cancelled' : 'scheduled',
    ],
  );
  return row!.id;
}

/**
 * Marks `count` people present on a session, and optionally some who were not.
 *
 * `attendance_status` is `present | absent | excused` — POOLSE-13 dropped
 * `late`, and an earlier draft of this file used it, which is how the report's
 * own query was caught doing the same.
 */
async function markPresent(
  tenant: ScratchTenant,
  sessionId: string,
  count: number,
  extras?: { absent?: number; excused?: number },
): Promise<void> {
  const states: string[] = [
    ...Array<string>(count).fill('present'),
    ...Array<string>(extras?.absent ?? 0).fill('absent'),
    ...Array<string>(extras?.excused ?? 0).fill('excused'),
  ];

  for (const [index, status] of states.entries()) {
    const [student] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name)
       VALUES ($1, $2, 'Silva') RETURNING id`,
      [tenant.organizationId, `Aluno${sessionId.slice(0, 4)}${index}`],
    );
    await tenant.sql(
      `INSERT INTO attendance
         (organization_id, class_session_id, student_id, status, recorded_by_membership_id)
       VALUES ($1, $2, $3, $4::attendance_status, $5)`,
      [tenant.organizationId, sessionId, student!.id, status, tenant.ownerMembershipId],
    );
  }
}

test('28 — a tank reports what it cost per turma hour, per bather and per m³', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const site = await aHeatedPool(tenant);

      // Last month: two hours taught, ten people in the water, €100.00 of heat.
      const one = await aSession(tenant, site, 1, 60, { hour: 8 });
      const two = await aSession(tenant, site, 1, 60, { hour: 10 });
      await markPresent(tenant, one, 6);
      await markPresent(tenant, two, 4);

      const report = await new EnergyController().costReport(site.poolId);

      assert.equal(report.poolName, 'Tanque Grande');
      assert.equal(report.cubicMetres, 500, '500 000 litres is 500 m³');
      assert.deepEqual(
        report.sources.map((s) => [s.name, s.fullyPriced]),
        [['Bomba de calor', true]],
        'the report names the meter it is the sum of',
      );

      const byMonth = new Map(report.months.map((m) => [m.month, m]));
      const last = byMonth.get(monthKey(1))!;
      assert.equal(last.kwh, 500);
      assert.equal(last.costCents, 10000, '500 kWh × €0.20');
      assert.equal(last.taughtMinutes, 120);
      assert.equal(last.bathers, 10);
      assert.equal(last.unallocated, false);

      // The window's totals: €180.00 over 2 hours and 10 bathers.
      assert.equal(report.costCents, 18000, 'both months, 400 + 500 kWh at €0.20');
      assert.equal(report.kwh, 900);
      assert.equal(report.taughtMinutes, 120);
      assert.equal(report.bathers, 10);
      assert.equal(report.monthsWithConsumption, 2);
      assert.equal(report.monthsPriced, 2);
    });
  });
});

test('28 — a cancelled session teaches nothing and its heat is unallocated', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const site = await aHeatedPool(tenant);

      // The only session that month was cancelled by a closure. The tank was
      // still heated — QA 28.3.
      const off = await aSession(tenant, site, 1, 60, { cancelled: true });
      await markPresent(tenant, off, 5);

      const report = await new EnergyController().costReport(site.poolId);
      const byMonth = new Map(report.months.map((m) => [m.month, m]));
      const last = byMonth.get(monthKey(1))!;

      assert.equal(last.taughtMinutes, 0, 'a cancelled session is not taught');
      assert.equal(last.bathers, 0, 'and nobody was in the water to be counted');
      assert.equal(last.kwh, 500, 'but the consumption is still there');
      assert.equal(last.costCents, 10000);
      assert.equal(last.unallocated, true, 'so the month says so rather than dividing by zero');

      assert.equal(report.taughtMinutes, 0);
      assert.equal(
        report.unallocatedCents,
        18000,
        'and the window reports every unallocated euro, not a rate',
      );
    });
  });
});

test('28 — a parceria heated the same water', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const site = await aHeatedPool(tenant);

      await aSession(tenant, site, 1, 60, { hour: 8 });
      // No class_group_id at all. Inner-joining that table drops this hour
      // silently and nothing errors — the failure this assertion exists for.
      await aSession(tenant, site, 1, 90, { partnership: true, hour: 10 });

      const report = await new EnergyController().costReport(site.poolId);
      assert.equal(report.taughtMinutes, 150, 'the partnership hour and a half counts');
    });
  });
});

test('28 — a bather is somebody who was in the water', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const site = await aHeatedPool(tenant);

      const session = await aSession(tenant, site, 1, 60);
      // Seven in the water, two marked absent and one excused — neither of
      // those was there to be heated. QA 28.2's denominator, with reposição
      // guests included by construction: a guest has an ordinary attendance row.
      await markPresent(tenant, session, 7, { absent: 2, excused: 1 });

      const report = await new EnergyController().costReport(site.poolId);
      assert.equal(report.bathers, 7, 'present counts; absent and excused do not');
    });
  });
});

test('28 — a tank with no volume and a meter with no rate say so', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const [pool] = await tenant.sql<{ id: string }>(
        `INSERT INTO pool (organization_id, facility_id, name, kind)
         VALUES ($1, $2, 'Tanque sem medidas', 'indoor') RETURNING id`,
        [tenant.organizationId, tenant.facilityId],
      );

      const controller = new EnergyController();
      const { id: meterId } = await controller.create(tenant.facilityId, {
        name: 'Bomba',
        kind: 'heating',
        poolId: pool!.id,
        initialIndex: 0,
      });
      await controller.record(meterId, { takenAt: firstOf(1), value: 300 });

      const report = await controller.costReport(pool!.id);

      assert.equal(report.cubicMetres, null, 'not measured — the screen says which figure is missing');
      assert.equal(report.costCents, null, 'and no rate means no cost, never a zero');
      assert.equal(report.kwh, 300, 'the kWh are still reported');
      assert.equal(report.monthsWithConsumption, 1);
      assert.equal(report.monthsPriced, 0, 'so the panel can say 0 of 1');
      assert.deepEqual(
        report.sources.map((s) => s.fullyPriced),
        [false],
        'and the meter is named as the unpriced one',
      );
    });
  });
});

test('28 — a tank nobody meters reports nothing rather than a plausible number', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const [pool] = await tenant.sql<{ id: string }>(
        `INSERT INTO pool (organization_id, facility_id, name, kind, volume_litres)
         VALUES ($1, $2, 'Tanque sem contador', 'indoor', 250000) RETURNING id`,
        [tenant.organizationId, tenant.facilityId],
      );

      const controller = new EnergyController();
      // A site-wide dial. It is NOT this tank's: its kWh heat the changing
      // rooms and light the car park too, and splitting them would be a guess.
      const { id: general } = await controller.create(tenant.facilityId, {
        name: 'Geral',
        kind: 'total',
        initialIndex: 0,
      });
      await controller.record(general, { takenAt: firstOf(1), value: 9000 });
      await controller.price(general, { unitPrice: 0.2, effectiveFrom: firstDay(3) });

      const report = await controller.costReport(pool!.id);

      assert.deepEqual(report.sources, [], 'nothing meters this tank');
      assert.equal(report.kwh, null, 'so there is nothing to report, not a share of the site');
      assert.equal(report.costCents, null);
      assert.equal(report.cubicMetres, 250);
    });
  });
});

test('28 — the report is a management question, not a maintenance one', async () => {
  await withScratchTenant(async (tenant) => {
    let poolId = '';
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const site = await aHeatedPool(tenant);
      poolId = site.poolId;
    });

    // Maintenance reads what the bomba cost on the meter's own page — that is a
    // fact about the tank. Whether a turma earns its heating is not.
    await actingAs(tenant, { roles: ['maintenance'] }, async () => {
      await expectStatus(() => new EnergyController().costReport(poolId), 403);
    });

    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      await expectStatus(() => new EnergyController().costReport(poolId), 403);
    });

    await actingAs(tenant, { roles: ['admin'] }, async () => {
      const report = await new EnergyController().costReport(poolId);
      assert.equal(report.costCents, 18000, 'an admin gets the whole report');
    });
  });
});

test('28 — another tenant\'s tank is indistinguishable from none', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await expectStatus(
        () => new EnergyController().costReport('00000000-0000-0000-0000-000000000000'),
        404,
      );
    });
  });
});

test('28 — each turma carries its share, and the shares sum to the whole', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const site = await aHeatedPool(tenant);

      // A second turma in the same tank, so there is something to split.
      const [other] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_group (organization_id, season_id, name, pool_id)
         VALUES ($1, $2, 'Adultos', $3) RETURNING id`,
        [tenant.organizationId, tenant.seasonId, site.poolId],
      );

      /*
       * Iniciados teaches one hour; Adultos three — both last month.
       *
       * The month before has 400 kWh (€80.00) and no lessons at all, so that
       * money is **unallocated** and is not shared out: charging an empty
       * month's heat to the turmas that did teach would inflate every share.
       * What is allocatable is last month's €100.00 over four hours — €25.00 an
       * hour, so €25.00 and €75.00.
       */
      await aSession(tenant, site, 1, 60, { hour: 8 });
      await tenant.sql(
        `INSERT INTO class_session
           (organization_id, class_group_id, pool_id, starts_at, duration_minutes, occurs_on)
         VALUES ($1, $2, $3, $4, 180, $5)`,
        [tenant.organizationId, other!.id, site.poolId, firstOf(1, 14), firstDay(1)],
      );

      const controller = new EnergyController();
      const report = await controller.costReport(site.poolId);

      assert.equal(report.taughtMinutes, 240);
      assert.equal(report.unallocatedCents, 8000, 'the month with no lessons keeps its own heat');

      const byGroup = new Map(report.byGroup.map((g) => [g.groupId, g.shareCents]));
      assert.equal(byGroup.get(site.groupId), 2500, 'one hour of four, of the allocatable €100.00');
      assert.equal(byGroup.get(other!.id), 7500, 'three hours of four');

      // The property that makes a share safe to quote: the parts are the whole.
      const parts = report.byGroup.reduce((total, g) => total + (g.shareCents ?? 0), 0);
      assert.equal(parts + (report.unallocatedCents ?? 0), report.costCents);

      // And the turma's own page reads the same row, never its own arithmetic.
      const mine = await controller.groupCost(site.groupId);
      assert.equal(mine.poolName, 'Tanque Grande');
      assert.equal(mine.share?.shareCents, 2500);
      assert.equal(mine.share?.taughtMinutes, 60);
      assert.equal(mine.costPerHourCents, 2500, '€25.00 an hour in this tank');
    });
  });
});

test('28 — a parceria carries a share under no turma', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const site = await aHeatedPool(tenant);

      await aSession(tenant, site, 1, 60, { hour: 8 });
      await aSession(tenant, site, 1, 60, { partnership: true, hour: 10 });

      const report = await new EnergyController().costReport(site.poolId);
      const partnership = report.byGroup.find((g) => g.groupId === null);

      assert.notEqual(partnership, undefined, 'the partnership hour is a row, not a gap');
      assert.equal(partnership?.taughtMinutes, 60);
      // Half of the allocatable €100.00 — the earlier month taught nothing.
      assert.equal(partnership?.shareCents, 5000);
    });
  });
});

test('28 — a turma in a tank nobody meters gets no figure, not a zero', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const [pool] = await tenant.sql<{ id: string }>(
        `INSERT INTO pool (organization_id, facility_id, name, kind)
         VALUES ($1, $2, 'Tanque sem contador', 'indoor') RETURNING id`,
        [tenant.organizationId, tenant.facilityId],
      );
      const [group] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_group (organization_id, season_id, name, pool_id)
         VALUES ($1, $2, 'Iniciados', $3) RETURNING id`,
        [tenant.organizationId, tenant.seasonId, pool!.id],
      );

      const answer = await new EnergyController().groupCost(group!.id);
      assert.equal(answer.costPerHourCents, null);
      assert.equal(answer.share, null, 'no session, no row — and no zero');
    });
  });
});
