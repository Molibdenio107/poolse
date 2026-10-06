import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actingAs,
  addMember,
  closeHarness,
  countStatements,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';
import { DashboardController } from './dashboard.controller.js';
import type { Dashboard } from './compose.js';
import type { MaintenanceOpen, MoneyPeriod, OccupancyToday, PeopleSummary } from './management.repository.js';
import { people as resolvePeople, staffCost, type WaterQualityWidget } from './resolvers.js';
import type { ResolverContext } from './widget-registry.js';
import type { SalarySummary } from '../staff/compensation.repository.js';
import { SpacesController } from '../spaces/spaces.controller.js';
import { FacilitiesController } from '../facilities/facilities.controller.js';

/**
 * The management band's aggregates — POOLSE-66 slice 2b, against a real club.
 *
 * What this file owns: that each of the six figures is this club's and agrees
 * with the rule it borrows; that "every site" is the sum of each site (QA 10);
 * that the number of statements does not grow with the number of sites (QA 11);
 * and the three small writes the slice added — the remembered selector, a
 * request's severity, and a site's water threshold — including who may not.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

const dashboard = new DashboardController();
const spaces = new SpacesController();
const facilities = new FacilitiesController();

after(async () => {
  await closeHarness();
});

function context(tenant: ScratchTenant, roles: string[]): ResolverContext {
  return {
    organizationId: tenant.organizationId,
    membershipId: tenant.ownerMembershipId,
    roles,
    facilityIds: [tenant.facilityId],
    scope: { mode: 'all', facilityId: null },
    locale: 'pt-PT',
  };
}

function card<T>(page: Dashboard, id: string): { state: string; data: T } | undefined {
  return page.bands
    .flatMap((band) => band.widgets)
    .find((one) => one.id === id) as { state: string; data: T } | undefined;
}

/** A second site, so a club can be asked about one site or every site. */
async function addSite(tenant: ScratchTenant, name: string): Promise<string> {
  const [site] = await tenant.sql<{ id: string }>(
    `INSERT INTO facility (organization_id, name) VALUES ($1, $2) RETURNING id`,
    [tenant.organizationId, name],
  );
  return site!.id;
}

/**
 * A monthly mensalidade line at `facilityId`, current this month, for a new
 * student. Returns the line id, so a test can pay it.
 */
async function addMonthlyLine(
  tenant: ScratchTenant,
  facilityId: string,
  amountCents: number,
): Promise<string> {
  const [level] = await tenant.sql<{ id: string }>(
    `INSERT INTO student_level (organization_id, name, sort_order)
     VALUES ($1, 'Nível ' || floor(random() * 1e6)::text, 1) RETURNING id`,
    [tenant.organizationId],
  );
  // One monthly period per site, by unique key: reuse it where provisioning
  // already made one, and make it where it did not (a site added by the test).
  const [existing] = await tenant.sql<{ id: string }>(
    `SELECT id FROM fee_period
      WHERE facility_id = $1 AND months = 1 AND archived_at IS NULL LIMIT 1`,
    [facilityId],
  );
  const [period] = existing
    ? [existing]
    : await tenant.sql<{ id: string }>(
        `INSERT INTO fee_period (organization_id, facility_id, name, months, is_default, sort_order)
         VALUES ($1, $2, 'Mensal', 1, true, 1) RETURNING id`,
        [tenant.organizationId, facilityId],
      );
  const [plan] = await tenant.sql<{ id: string }>(
    `INSERT INTO fee_plan (organization_id, facility_id, kind, level_id, lessons_per_week,
                           amount_cents, vat_exempt)
     VALUES ($1, $2, 'mensalidade', $3, 2, $4, true) RETURNING id`,
    [tenant.organizationId, facilityId, level!.id, amountCents],
  );
  const [student] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, birth_date)
     VALUES ($1, 'Aluno', 'N' || floor(random() * 1e6)::text, DATE '2015-03-01') RETURNING id`,
    [tenant.organizationId],
  );
  const [line] = await tenant.sql<{ id: string }>(
    `INSERT INTO student_fee (organization_id, student_id, fee_plan_id, fee_period_id,
                              amount_cents, starts_on)
     VALUES ($1, $2, $3, $4, $5, date_trunc('month', current_date)::date) RETURNING id`,
    [tenant.organizationId, student!.id, plan!.id, period!.id, amountCents],
  );
  return line!.id;
}

async function payThisMonth(tenant: ScratchTenant, lineId: string): Promise<void> {
  await tenant.sql(
    `INSERT INTO student_fee_payment (organization_id, student_fee_id, period_start)
     VALUES ($1, $2, date_trunc('month', current_date)::date)`,
    [tenant.organizationId, lineId],
  );
}

test('66.2b money — this month, paid and not, by the per-student rule', async () => {
  await withScratchTenant(async (tenant) => {
    const paid = await addMonthlyLine(tenant, tenant.facilityId, 4500);
    await addMonthlyLine(tenant, tenant.facilityId, 3000);
    await payThisMonth(tenant, paid);

    /*
     * Whether the unpaid line is overdue depends on today and the site's due
     * day, so the expectation asks the same SQL function rather than guessing a
     * calendar — the point is that the widget and `fee_due_on` agree, and a
     * test pinned to a date would fail on the wrong days of the month.
     */
    const [rule] = await tenant.sql<{ late: boolean }>(
      `SELECT fee_due_on(date_trunc('month', current_date)::date, payment_due_day) < current_date
                AS late
         FROM facility WHERE id = $1`,
      [tenant.facilityId],
    );

    const page = await actingAs(tenant, { roles: ['owner'] }, () => dashboard.read());
    const money = card<MoneyPeriod>(page, 'mgmt.money.period');

    assert.equal(money?.state, 'ok');
    assert.equal(money!.data.paidCents, 4500);
    assert.equal(money!.data.overdueCents, rule!.late ? 3000 : 0);
    assert.equal(money!.data.dueCents, rule!.late ? 0 : 3000);
    assert.equal(money!.data.lines, 2);
    assert.equal(money!.data.students, 2);
  });
});

test('66.2b money — another club\'s lines are not in this club\'s total', async () => {
  await withScratchTenant(async (mine) => {
    await addMonthlyLine(mine, mine.facilityId, 1000);

    await withScratchTenant(async (theirs) => {
      await addMonthlyLine(theirs, theirs.facilityId, 99_900);

      const page = await actingAs(mine, { roles: ['owner'] }, () => dashboard.read());
      const money = card<MoneyPeriod>(page, 'mgmt.money.period');
      const total = money!.data.paidCents + money!.data.dueCents + money!.data.overdueCents;
      assert.equal(total, 1000, 'only this club');
    });
  });
});

test('66.2b QA 10 — every site is the sum of each site', async () => {
  await withScratchTenant(async (tenant) => {
    const second = await addSite(tenant, 'Pavilhão Norte');
    await addMonthlyLine(tenant, tenant.facilityId, 4000);
    await addMonthlyLine(tenant, second, 2500);
    await addMonthlyLine(tenant, second, 1500);

    const total = (page: Dashboard): number => {
      const money = card<MoneyPeriod>(page, 'mgmt.money.period')!.data;
      return money.paidCents + money.dueCents + money.overdueCents;
    };

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const all = await dashboard.read();
      const first = await dashboard.read(tenant.facilityId);
      const other = await dashboard.read(second);

      assert.equal(all.scope.mode, 'all');
      assert.equal(first.scope.facilityId, tenant.facilityId);
      assert.equal(total(first), 4000);
      assert.equal(total(other), 4000);
      assert.equal(total(all), total(first) + total(other));
    });
  });
});

test('66.2b QA 11 — the statement count does not grow with the number of sites', async () => {
  await withScratchTenant(async (tenant) => {
    const read = (): Promise<{ statements: string[] }> =>
      actingAs(tenant, { roles: ['owner'] }, () => countStatements(() => dashboard.read()));

    const one = await read();
    for (const name of ['Sede Sul', 'Sede Este', 'Sede Oeste', 'Sede Centro']) {
      await addSite(tenant, name);
    }
    const five = await read();

    assert.equal(
      five.statements.length,
      one.statements.length,
      `one site ran ${one.statements.length} statements and five ran ${five.statements.length}`,
    );
  });
});

test('66.2b occupancy — today, at the site, without the cancelled class', async () => {
  await withScratchTenant(async (tenant) => {
    const [pool] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool (organization_id, facility_id, name, kind, max_capacity)
       VALUES ($1, $2, 'Tanque de Hoje', 'indoor', 10) RETURNING id`,
      [tenant.organizationId, tenant.facilityId],
    );
    const [group] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, season_id, facility_id, name, pool_id)
       VALUES ($1, $2, $3, 'Sem Professor A', $4) RETURNING id`,
      [tenant.organizationId, tenant.seasonId, tenant.facilityId, pool!.id],
    );
    for (const name of ['Rita', 'Tiago']) {
      const [student] = await tenant.sql<{ id: string }>(
        `INSERT INTO student (organization_id, first_name, last_name) VALUES ($1, $2, 'Hoje')
         RETURNING id`,
        [tenant.organizationId, name],
      );
      await tenant.sql(
        `INSERT INTO enrollment (organization_id, class_group_id, student_id, status)
         VALUES ($1, $2, $3, 'active')`,
        [tenant.organizationId, group!.id, student!.id],
      );
    }

    // Noon in Lisbon today, so the test cannot cross midnight on the way.
    const noon = `(date_trunc('day', now() AT TIME ZONE 'Europe/Lisbon') + interval '12 hours')
                    AT TIME ZONE 'Europe/Lisbon'`;
    await tenant.sql(
      `INSERT INTO class_session
         (organization_id, class_group_id, pool_id, starts_at, duration_minutes, occurs_on)
       VALUES ($1, $2, $3, ${noon}, 45, (now() AT TIME ZONE 'Europe/Lisbon')::date)`,
      [tenant.organizationId, group!.id, pool!.id],
    );
    await tenant.sql(
      `INSERT INTO class_session
         (organization_id, class_group_id, pool_id, starts_at, duration_minutes, occurs_on,
          status, cancellation_reason)
       VALUES ($1, $2, $3, ${noon} + interval '2 hours', 45,
               (now() AT TIME ZONE 'Europe/Lisbon')::date, 'cancelled', 'Avaria')`,
      [tenant.organizationId, group!.id, pool!.id],
    );

    const page = await actingAs(tenant, { roles: ['admin'] }, () => dashboard.read());
    const today = card<OccupancyToday>(page, 'mgmt.occupancy.today');

    assert.equal(today?.state, 'ok');
    assert.equal(today!.data.classes, 1, 'the cancelled class is not counted');
    assert.equal(today!.data.swimmers, 2);
    assert.equal(today!.data.withoutInstructor, 1, 'nobody resolves, and nothing is external');
    assert.deepEqual(
      { swimmers: today!.data.peak?.swimmers, capacity: today!.data.peak?.capacity },
      { swimmers: 2, capacity: 10 },
    );
  });
});

test('66.2b maintenance — open requests by kind and severity, and overdue rooms', async () => {
  await withScratchTenant(async (tenant) => {
    const [space] = await tenant.sql<{ id: string }>(
      `INSERT INTO space (organization_id, facility_id, name, expected_cleaning_interval_hours)
       VALUES ($1, $2, 'Balneário Norte', 24) RETURNING id`,
      [tenant.organizationId, tenant.facilityId],
    );

    // Through the endpoint, so the severity a reporter chooses is what lands.
    await actingAs(tenant, { roles: ['owner'] }, () =>
      spaces.report(space!.id, { type: 'fault', description: 'Chuveiro partido', severity: 'high' }),
    );
    await actingAs(tenant, { roles: ['owner'] }, () =>
      spaces.report(space!.id, { type: 'restock', description: 'Sabonete' }),
    );

    const page = await actingAs(tenant, { roles: ['owner'] }, () => dashboard.read());
    const open = card<MaintenanceOpen>(page, 'mgmt.maintenance.open');

    assert.equal(open?.state, 'ok');
    assert.deepEqual(
      [...open!.data.open].sort((a, b) => a.type.localeCompare(b.type)),
      [
        { type: 'fault', severity: 'high', count: 1 },
        { type: 'restock', severity: 'normal', count: 1 },
      ],
      'a report that sends no severity is normal',
    );
    assert.equal(open!.data.overdueCleanings, 1, 'a room with a schedule and no cleaning is overdue');
  });
});

test('66.2b water — out of range by the shared bands, and due by the site threshold', async () => {
  await withScratchTenant(async (tenant) => {
    const [bad] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool (organization_id, facility_id, name, kind)
       VALUES ($1, $2, 'Tanque Ácido', 'indoor') RETURNING id`,
      [tenant.organizationId, tenant.facilityId],
    );
    await tenant.sql(
      `INSERT INTO pool (organization_id, facility_id, name, kind)
       VALUES ($1, $2, 'Tanque Esquecido', 'indoor')`,
      [tenant.organizationId, tenant.facilityId],
    );
    const [analysis] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool_analysis (organization_id, pool_id, taken_at)
       VALUES ($1, $2, now() - interval '1 hour') RETURNING id`,
      [tenant.organizationId, bad!.id],
    );
    await tenant.sql(
      `INSERT INTO pool_analysis_value (organization_id, analysis_id, metric, value, unit)
       VALUES ($1, $2, 'ph', 8.4, 'pH')`,
      [tenant.organizationId, analysis!.id],
    );

    const before = await actingAs(tenant, { roles: ['owner'] }, () => dashboard.read());
    const water = card<WaterQualityWidget>(before, 'mgmt.waterquality.alerts')!.data;
    assert.deepEqual(
      water.flagged.map((pool) => [pool.poolName, pool.outOfRange, pool.due]),
      [['Tanque Ácido', ['ph'], false]],
      'no threshold set means no tank is due — null enforces nothing',
    );

    await actingAs(tenant, { roles: ['owner'] }, () =>
      facilities.waterThreshold(tenant.facilityId, { hours: 24 }),
    );

    const after_ = await actingAs(tenant, { roles: ['owner'] }, () => dashboard.read());
    const flagged = card<WaterQualityWidget>(after_, 'mgmt.waterquality.alerts')!.data.flagged;
    assert.ok(
      flagged.some((pool) => pool.poolName === 'Tanque Esquecido' && pool.due),
      'a tank never analysed is due once a threshold is set',
    );
    assert.ok(
      !flagged.some((pool) => pool.poolName === 'Tanque Ácido' && pool.due),
      'an hour-old analysis is within 24 hours',
    );
  });
});

test('66.2b people — club-wide counts, and invitations about to lapse', async () => {
  await withScratchTenant(async (tenant) => {
    await addMember(tenant, 'Inês', 'Admin', ['admin']);
    await addMember(tenant, 'Rui', 'Treino', ['instructor', 'maintenance']);
    const [invited] = await tenant.sql<{ id: string }>(
      `INSERT INTO membership (organization_id, status, first_name, last_name, email)
       VALUES ($1, 'invited', 'Quase', 'Expirada', 'quase@example.test') RETURNING id`,
      [tenant.organizationId],
    );
    await tenant.sql(
      `INSERT INTO invitation (organization_id, membership_id, email, roles, token_hash, expires_at)
       VALUES ($1, $2, 'quase@example.test', ARRAY['instructor']::member_role[],
               md5(random()::text), now() + interval '2 hours')`,
      [tenant.organizationId, invited!.id],
    );

    /*
     * Through the resolver, not the page: people and staff cost are the band's
     * slow-moving figures and the lowest priorities, so on an owner's page the
     * four-card cap is entitled to leave them out. What is asserted here is the
     * figure; what the cap keeps is `compose.test.ts`'s business.
     */
    const people = (await resolvePeople(context(tenant, ['owner']))) as PeopleSummary;

    assert.equal(people.staff, 3, 'the owner, the admin, and the instructor counted once');
    assert.equal(people.byRole.instructor, 1);
    assert.equal(people.byRole.maintenance, 1);
    assert.equal(people.expiringInvitations, 1);
  });
});

test("66.2b staff cost — an admin's figure says the owner is left out", async () => {
  await withScratchTenant(async (tenant) => {
    await addMember(tenant, 'Inês', 'Admin', ['admin']);

    const asOwner = (await staffCost(context(tenant, ['owner']))) as SalarySummary;
    const asAdmin = (await staffCost(context(tenant, ['admin']))) as SalarySummary;

    assert.equal(asOwner.ownerExcluded, false);
    assert.equal(asAdmin.ownerExcluded, true, 'and the card says so in words');
  });
});

test('66.2b selector — remembered per person, and refused for what it cannot name', async () => {
  await withScratchTenant(async (tenant) => {
    const second = await addSite(tenant, 'Pavilhão Norte');

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await dashboard.rememberScope({ facilityId: second });
      const remembered = await dashboard.read();
      assert.deepEqual(remembered.scope.facilityId, second, 'no ?facility, so the remembered one');

      const linked = await dashboard.read(tenant.facilityId);
      assert.equal(linked.scope.facilityId, tenant.facilityId, 'a link that names a site wins');

      await dashboard.rememberScope({ facilityId: null });
      assert.equal((await dashboard.read()).scope.mode, 'all');

      await expectStatus(
        () => dashboard.rememberScope({ facilityId: '00000000-0000-4000-8000-000000000000' }),
        404,
      );
      await expectStatus(() => dashboard.rememberScope({ facilityId: 'sede' }), 400);
    });

    const instructor = await addMember(tenant, 'Nuno', 'Treino', ['instructor']);
    await actingAs(tenant, { membershipId: instructor, roles: ['instructor'] }, () =>
      expectStatus(() => dashboard.rememberScope({ facilityId: second }), 403),
    );

    // An archived site still remembered reads as every site, not as an error.
    await actingAs(tenant, { roles: ['owner'] }, () =>
      dashboard.rememberScope({ facilityId: second }),
    );
    await tenant.sql(`UPDATE facility SET archived_at = now() WHERE id = $1`, [second]);
    const page = await actingAs(tenant, { roles: ['owner'] }, () => dashboard.read());
    assert.equal(page.scope.mode, 'all');
  });
});

test('66.2b severity — chosen at report, re-graded by a manager only', async () => {
  await withScratchTenant(async (tenant) => {
    const [space] = await tenant.sql<{ id: string }>(
      `INSERT INTO space (organization_id, facility_id, name) VALUES ($1, $2, 'Arrecadação')
       RETURNING id`,
      [tenant.organizationId, tenant.facilityId],
    );

    await actingAs(tenant, { roles: ['owner'] }, () =>
      expectStatus(
        () => spaces.report(space!.id, { type: 'fault', description: 'x', severity: 'urgent' }),
        400,
      ),
    );

    await actingAs(tenant, { roles: ['owner'] }, () =>
      spaces.report(space!.id, { type: 'fault', description: 'Porta presa' }),
    );
    const [request] = await tenant.sql<{ id: string; severity: string }>(
      `SELECT id, severity::text FROM maintenance_request WHERE space_id = $1`,
      [space!.id],
    );
    assert.equal(request!.severity, 'normal');

    const instructor = await addMember(tenant, 'Nuno', 'Treino', ['instructor']);
    await actingAs(tenant, { membershipId: instructor, roles: ['instructor'] }, () =>
      expectStatus(() => spaces.severity(space!.id, request!.id, { severity: 'high' }), 403),
    );

    await actingAs(tenant, { roles: ['admin'] }, () =>
      spaces.severity(space!.id, request!.id, { severity: 'high' }),
    );
    const [graded] = await tenant.sql<{ severity: string }>(
      `SELECT severity::text FROM maintenance_request WHERE id = $1`,
      [request!.id],
    );
    assert.equal(graded!.severity, 'high');
  });
});

test('66.2b water threshold — whole hours or null, owner and admin only', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await expectStatus(() => facilities.waterThreshold(tenant.facilityId, { hours: 0 }), 400);
      await expectStatus(() => facilities.waterThreshold(tenant.facilityId, { hours: 2.5 }), 400);
      await facilities.waterThreshold(tenant.facilityId, { hours: 48 });
      assert.equal((await facilities.one(tenant.facilityId)).waterAnalysisMaxAgeHours, 48);
      await facilities.waterThreshold(tenant.facilityId, { hours: null });
      assert.equal((await facilities.one(tenant.facilityId)).waterAnalysisMaxAgeHours, null);
    });

    const instructor = await addMember(tenant, 'Nuno', 'Treino', ['instructor']);
    await actingAs(tenant, { membershipId: instructor, roles: ['instructor'] }, () =>
      expectStatus(() => facilities.waterThreshold(tenant.facilityId, { hours: 24 }), 403),
    );
  });
});
