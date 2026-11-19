import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { AppFreeSwimController } from './app-free-swim.controller.js';
import { occupancyCache, type FreeSwimSchedule } from './free-swim.repository.js';
import { BookingsController } from '../facilities/bookings.controller.js';
import { PassProductsController, ReceptionController } from '../reception/passes.controller.js';
import { actingAs, addMember, closeHarness, ownerSql, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * *Horário de nado livre* in the app — POOLSE-237.
 *
 * The timetable is the calendar's free-swim sessions on the site's clock, a
 * shut tank says until when, and "now" is `pool_occupancy()` as a count and a
 * percentage — only where the tank has a capacity, never a person.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/** A tank with three lanes and one free-swim block whose generated lessons are cleared. */
async function freeSwimTank(
  tenant: ScratchTenant,
  capacity: number | null,
): Promise<{ poolId: string; laneIds: string[]; scheduleId: string }> {
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, max_capacity)
     VALUES ($1, $2, 'Tanque livre', $3) RETURNING id`,
    [tenant.organizationId, tenant.facilityId, capacity],
  );
  await tenant.sql(
    `INSERT INTO lane (organization_id, pool_id, name, position)
     SELECT $1, $2, 'Pista ' || n, n FROM generate_series(2, 3) AS n`,
    [tenant.organizationId, pool!.id],
  );
  const lanes = await tenant.sql<{ id: string }>(`SELECT id FROM lane WHERE pool_id = $1 ORDER BY position`, [
    pool!.id,
  ]);
  const laneIds = lanes.map((lane) => lane.id);
  const { id } = await new BookingsController().freeSwim({
    facilityId: tenant.facilityId,
    seasonId: tenant.seasonId,
    title: 'Natação livre',
    weekday: 1,
    startTime: '07:00',
    durationMinutes: 60,
    laneIds,
  });
  // The pattern's own lessons would land anywhere in the window; the test places its own.
  await ownerSql(`DELETE FROM class_session_lane WHERE session_id IN (SELECT id FROM class_session WHERE schedule_id = $1)`, [id]);
  await ownerSql(`DELETE FROM class_session WHERE schedule_id = $1`, [id]);
  return { poolId: pool!.id, laneIds, scheduleId: id };
}

/** One lesson of the block, `startsIn` from now, holding `lanes` of the tank's lanes. */
async function lesson(
  tenant: ScratchTenant,
  scheduleId: string,
  laneIds: string[],
  startsIn: string,
  lanes = laneIds.length,
): Promise<void> {
  const [session] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_session (organization_id, schedule_id, starts_at, duration_minutes, occurs_on)
     VALUES ($1, $2, now() + $3::interval, 60, ((now() + $3::interval) AT TIME ZONE 'Europe/Lisbon')::date)
     RETURNING id`,
    [tenant.organizationId, scheduleId, startsIn],
  );
  await tenant.sql(
    `INSERT INTO class_session_lane (organization_id, session_id, lane_id, starts_at, ends_at, cancelled)
     SELECT s.organization_id, s.id, l, s.starts_at, s.starts_at + interval '60 minutes', false
       FROM class_session s, unnest($2::uuid[]) AS l WHERE s.id = $1`,
    [session!.id, laneIds.slice(0, lanes)],
  );
}

async function swimmersIn(tenant: ScratchTenant, poolId: string, count: number): Promise<void> {
  const single = (
    await new PassProductsController().create(tenant.facilityId, {
      kind: 'single',
      name: `Entrada ${Math.random()}`,
      amountCents: 400,
    })
  ).id;
  for (let i = 0; i < count; i += 1) {
    await new ReceptionController().sell(tenant.facilityId, { productId: single, checkInPoolId: poolId });
  }
}

async function siteDay(tenant: ScratchTenant, offsetDays: number): Promise<string> {
  const [row] = await tenant.sql<{ day: string }>(
    `SELECT ((now() AT TIME ZONE timezone)::date + $2::int)::text AS day FROM facility WHERE id = $1`,
    [tenant.facilityId, offsetDays],
  );
  return row!.day;
}

/** Every key at every depth, so a person's field cannot slip in unnoticed. */
function keysOf(value: unknown, into = new Set<string>(), path = ''): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => keysOf(item, into, `${path}[]`));
  else if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      into.add(`${path}.${key}`);
      keysOf(inner, into, `${path}.${key}`);
    }
  }
  return into;
}

test('QA 1, 2 and 6 — the week, the lanes, and "now" as a count and a percentage, with no person in it', async () => {
  await withScratchTenant(async (tenant) => {
    const guardian = await addMember(tenant, 'Rita', 'Família', ['guardian']);
    let answer: FreeSwimSchedule = { sites: [] };
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { poolId, laneIds, scheduleId } = await freeSwimTank(tenant, 20);
      await lesson(tenant, scheduleId, laneIds, '-10 minutes');
      await lesson(tenant, scheduleId, laneIds, '1 day', 2);
      await swimmersIn(tenant, poolId, 3);
    });
    await actingAs(tenant, { membershipId: guardian, roles: ['guardian'] }, async () => {
      answer = await new AppFreeSwimController().read();
    });

    assert.equal(answer.sites.length, 1);
    const site = answer.sites[0]!;
    assert.equal(site.facilityId, tenant.facilityId);
    assert.equal(site.days[0]!.date, await siteDay(tenant, 0), 'the first day is today on the site’s calendar');
    assert.ok(site.days.length >= 1 && site.days.length <= 2, 'today, and tomorrow’s two lanes');
    assert.equal(site.days[0]!.sessions[0]!.lanes, 3);
    assert.equal(site.days[0]!.sessions[0]!.poolName, 'Tanque livre');
    assert.match(site.days[0]!.sessions[0]!.from, /^\d{2}:\d{2}$/);

    assert.equal(site.now.length, 1);
    const now = site.now[0]!;
    assert.equal(now.occupied, 3);
    assert.equal(now.capacity, 20);
    assert.equal(now.percent, 15);
    assert.match(now.readAt, /^\d{2}:\d{2}$/);

    assert.deepEqual(
      [...keysOf(answer)].sort(),
      [
        '.sites',
        '.sites[].days',
        '.sites[].days[].closed',
        '.sites[].days[].date',
        '.sites[].days[].sessions',
        '.sites[].days[].sessions[].from',
        '.sites[].days[].sessions[].lanes',
        '.sites[].days[].sessions[].poolName',
        '.sites[].days[].sessions[].to',
        '.sites[].facilityId',
        '.sites[].name',
        '.sites[].now',
        '.sites[].now[].capacity',
        '.sites[].now[].from',
        '.sites[].now[].occupied',
        '.sites[].now[].percent',
        '.sites[].now[].poolName',
        '.sites[].now[].readAt',
        '.sites[].now[].to',
        '.sites[].today',
      ],
      'exactly the documented keys: no name, id of a person, pass or check-in',
    );
  });
});

test('QA 3 — a tank with no capacity shows its hours and no number', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { poolId, laneIds, scheduleId } = await freeSwimTank(tenant, null);
      await lesson(tenant, scheduleId, laneIds, '-10 minutes');
      await swimmersIn(tenant, poolId, 2);
      const { sites } = await new AppFreeSwimController().read();
      assert.equal(sites[0]!.days[0]!.sessions.length, 1);
      assert.deepEqual(sites[0]!.now, []);
    });
  });
});

test('QA 4 — a shut tank reads Encerrado até its last day, and a cancelled lesson is not shown', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { poolId, laneIds, scheduleId } = await freeSwimTank(tenant, 20);
      await lesson(tenant, scheduleId, laneIds, '2 days');
      const from = await siteDay(tenant, 2);
      const until = await siteDay(tenant, 3);
      await tenant.sql(
        `INSERT INTO closure (organization_id, facility_id, pool_id, starts_on, ends_on, reason, source)
         VALUES ($1, $2, $3, $4::date, $5::date, 'Obras', 'manual')`,
        [tenant.organizationId, tenant.facilityId, poolId, from, until],
      );
      await tenant.sql(`UPDATE class_session SET status = 'cancelled' WHERE schedule_id = $1`, [scheduleId]);

      const { sites } = await new AppFreeSwimController().read();
      const shut = sites[0]!.days.find((day) => day.date === from);
      assert.ok(shut, 'the shut day is listed');
      assert.deepEqual(shut.sessions, [], 'the cancelled lesson is not shown');
      assert.deepEqual(shut.closed, [{ poolName: 'Tanque livre', until }]);
      assert.deepEqual(
        sites[0]!.days.find((day) => day.date === until)?.closed,
        [{ poolName: 'Tanque livre', until }],
        'the second day of the closure says so too',
      );
    });
  });
});

test('QA 7 — a club with reception off answers no sites', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { laneIds, scheduleId } = await freeSwimTank(tenant, 20);
      await lesson(tenant, scheduleId, laneIds, '1 hour');
    });
    await ownerSql(`UPDATE organization SET disabled_modules = '{reception}' WHERE id = $1`, [tenant.organizationId]);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      assert.deepEqual(await new AppFreeSwimController().read(), { sites: [] });
    });
  });
});

test('QA 5 and 9 — the figure is cached 30 s per club and tank, and never answers another club', async () => {
  await withScratchTenant(async (club) => {
    let poolId = '';
    await actingAs(club, { roles: ['owner'] }, async () => {
      const tank = await freeSwimTank(club, 20);
      poolId = tank.poolId;
      await lesson(club, tank.scheduleId, tank.laneIds, '-10 minutes');
      await swimmersIn(club, poolId, 1);
      assert.equal((await new AppFreeSwimController().read()).sites[0]!.now[0]!.occupied, 1);

      await swimmersIn(club, poolId, 1);
      assert.equal(
        (await new AppFreeSwimController().read()).sites[0]!.now[0]!.occupied,
        1,
        'inside 30 s the cached figure stands',
      );

      const key = `${club.organizationId}:${poolId}`;
      occupancyCache.set(key, { ...occupancyCache.get(key)!, at: Date.now() - 31_000 });
      assert.equal((await new AppFreeSwimController().read()).sites[0]!.now[0]!.occupied, 2, 'and then it is read again');
    });

    await withScratchTenant(async (other) => {
      await actingAs(other, { roles: ['owner'] }, async () => {
        assert.deepEqual(await new AppFreeSwimController().read(), { sites: [] }, 'another club sees nothing of it');
      });
    });
    for (const key of occupancyCache.keys()) {
      assert.ok(key.startsWith(`${club.organizationId}:`) || !key.includes(poolId), 'a key is always its club’s');
    }
  });
});
