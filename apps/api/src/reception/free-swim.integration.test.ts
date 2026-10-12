import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { PassProductsController, ReceptionController } from './passes.controller.js';
import { InvoicesController } from '../billing/invoices.controller.js';
import { BookingsController } from '../facilities/bookings.controller.js';
import { freeSwim, moneyPeriod, occupancyToday, tankIsNearlyFull } from '../dashboard/resolvers.js';
import { assertRegistryIsSound } from '../dashboard/widget-registry.js';
import type { ResolverContext } from '../dashboard/widget-registry.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * Free swim, slice 2 — POOLSE-68 AC 6, the lane grid and the dashboard card.
 *
 * **Pass revenue is its own figure.** It is summed from sale lines not since
 * credited, and the mensalidades card does not move when an entry is sold.
 *
 * **A free-swim block holds lanes and counts nobody.** It is refused on a lane
 * already held, materialises as sessions with lane rows (which is what keeps a
 * turma off it), adds nothing to occupancy and is not a class on the dashboard.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

function context(tenant: ScratchTenant): ResolverContext {
  return {
    organizationId: tenant.organizationId,
    membershipId: tenant.ownerMembershipId,
    roles: ['owner'],
    facilityIds: [tenant.facilityId],
    ownFacilityIds: [tenant.facilityId],
    scope: { mode: 'all', facilityId: null },
    locale: 'pt-PT',
  };
}

async function tank(tenant: ScratchTenant, capacity: number | null): Promise<{ poolId: string; laneIds: string[] }> {
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
  const lanes = await tenant.sql<{ id: string }>(
    `SELECT id FROM lane WHERE pool_id = $1 ORDER BY position`,
    [pool!.id],
  );
  return { poolId: pool!.id, laneIds: lanes.map((lane) => lane.id) };
}

test('pass revenue is its own figure: credited sales leave it, and mensalidades never see it', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { poolId } = await tank(tenant, null);
      const products = new PassProductsController();
      const single = (await products.create(tenant.facilityId, { kind: 'single', name: 'Entrada', amountCents: 400 })).id;
      const pack = (
        await products.create(tenant.facilityId, { kind: 'pack', name: 'Pack 10', entries: 10, amountCents: 3500 })
      ).id;
      const swimmer = await addMember(tenant, 'Inês', 'Receita', []);
      const reception = new ReceptionController();

      await reception.sell(tenant.facilityId, { productId: single, checkInPoolId: poolId });
      const mistaken = await reception.sell(tenant.facilityId, { productId: single });
      await reception.sell(tenant.facilityId, { productId: pack, membershipId: swimmer });
      await new InvoicesController().credit(tenant.facilityId, mistaken.invoiceId, {});

      const { month } = await reception.read(tenant.facilityId);
      assert.equal(month.salesCents, 3900, 'one entry and one pack; the credited entry is out');
      assert.equal(month.sales, 2);
      assert.equal(month.entries, 1);
      assert.equal(month.provenance, 'actual');

      // The mensalidades card has nothing to sum, and a pass sale does not give it something.
      assert.equal(await moneyPeriod(context(tenant)), null);

      const card = await freeSwim(context(tenant));
      assert.equal(card?.month.salesCents, 3900);
      assert.equal(card?.products, 2);
    });
  });
});

test('the card is empty for a club that sells no free swim, and lifts when a tank is nearly full', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      assert.equal(await freeSwim(context(tenant)), null);

      const { poolId } = await tank(tenant, 2);
      const single = (
        await new PassProductsController().create(tenant.facilityId, { kind: 'single', name: 'Entrada', amountCents: 400 })
      ).id;
      const reception = new ReceptionController();

      await reception.sell(tenant.facilityId, { productId: single, checkInPoolId: poolId });
      assert.equal(tankIsNearlyFull(await freeSwim(context(tenant))), false, 'one of two is half');

      await reception.sell(tenant.facilityId, { productId: single, checkInPoolId: poolId });
      assert.equal(tankIsNearlyFull(await freeSwim(context(tenant))), true);

      // The registry still holds every rule it asserts with the new card in it.
      assertRegistryIsSound();
    });
  });
});

test('a free-swim block holds its lane: a second one there is refused by name, the next lane is not', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { laneIds } = await tank(tenant, null);
      const bookings = new BookingsController();
      const block = {
        facilityId: tenant.facilityId,
        seasonId: tenant.seasonId,
        title: 'Natação livre',
        weekday: 3,
        startTime: '12:00',
        durationMinutes: 60,
      };

      const { id } = await bookings.freeSwim({ ...block, laneIds: [laneIds[0]] });

      const [row] = await tenant.sql<{ subject_type: string; title: string; lanes: number }>(
        `SELECT subject_type::text, title,
                (SELECT count(*)::int FROM booking_lane WHERE schedule_id = cs.id) AS lanes
           FROM class_schedule cs WHERE id = $1`,
        [id],
      );
      assert.equal(row?.subject_type, 'free_swim');
      assert.equal(row?.title, 'Natação livre');
      assert.equal(row?.lanes, 1);

      // Its lessons follow the pattern like any booking's, with their lane rows —
      // which is what the lane exclusion keeps a turma off.
      const [sessions] = await tenant.sql<{ n: number; laned: number }>(
        `SELECT count(*)::int AS n,
                count(*) FILTER (WHERE EXISTS (
                  SELECT 1 FROM class_session_lane l WHERE l.session_id = s.id))::int AS laned
           FROM class_session s WHERE s.schedule_id = $1`,
        [id],
      );
      assert.ok((sessions?.n ?? 0) > 0, 'the season gave it lessons');
      assert.equal(sessions?.n, sessions?.laned, 'every lesson sits in its lane');

      try {
        await bookings.freeSwim({ ...block, laneIds: [laneIds[0]] });
        assert.fail('a second block on a held lane was accepted');
      } catch (error) {
        assert.ok(error instanceof HttpException);
        assert.equal(error.getStatus(), 409);
        assert.equal((error.getResponse() as { message?: string }).message, 'laneTaken');
      }

      await bookings.freeSwim({ ...block, laneIds: [laneIds[1]] });
    });
  });
});

test('a free-swim session counts nobody in the tank and is not a class on the dashboard', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { poolId, laneIds } = await tank(tenant, 10);
      const { id } = await new BookingsController().freeSwim({
        facilityId: tenant.facilityId,
        seasonId: tenant.seasonId,
        title: 'Natação livre',
        weekday: 1,
        startTime: '07:00',
        durationMinutes: 60,
        laneIds: [laneIds[0]],
      });
      // A headcount somebody typed on the block must not be counted a second
      // time on top of the check-ins it stands for.
      await tenant.sql(`UPDATE class_schedule SET headcount_override = 8 WHERE id = $1`, [id]);

      const [session] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_session
           (organization_id, schedule_id, starts_at, duration_minutes, occurs_on)
         VALUES ($1, $2, now() - interval '10 minutes', 60,
                 (now() AT TIME ZONE 'Europe/Lisbon')::date + 400)
         RETURNING id`,
        [tenant.organizationId, id],
      );
      await tenant.sql(
        `INSERT INTO class_session_lane (organization_id, session_id, lane_id, starts_at, ends_at, cancelled)
         SELECT organization_id, id, $2, starts_at, ends_at, false FROM class_session WHERE id = $1`,
        [session!.id, laneIds[0]],
      );

      const row = (await new ReceptionController().read(tenant.facilityId)).pools.find(
        (pool) => pool.poolId === poolId,
      );
      assert.equal(row?.inClasses, 0);

      assert.equal(await occupancyToday(context(tenant)), null, 'free swim is not a class today');
    });
  });
});

test('an instructor may not hold a lane for free swim', async () => {
  await withScratchTenant(async (tenant) => {
    const { laneIds } = await tank(tenant, null);
    const instructor = await addMember(tenant, 'Sem', 'Grelha', ['instructor']);
    await actingAs(tenant, { membershipId: instructor, roles: ['instructor'] }, async () => {
      await expectStatus(
        () =>
          new BookingsController().freeSwim({
            facilityId: tenant.facilityId,
            seasonId: tenant.seasonId,
            title: 'Natação livre',
            weekday: 2,
            startTime: '12:00',
            durationMinutes: 60,
            laneIds: [laneIds[0]],
          }),
        403,
      );
    });
  });
});
