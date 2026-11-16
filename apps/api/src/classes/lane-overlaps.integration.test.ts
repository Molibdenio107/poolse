import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ClassesController } from './classes.controller.js';
import { AttentionController } from '../attention/attention.controller.js';
import { BookingsController } from '../facilities/bookings.controller.js';
import { actingAs, closeHarness, withScratchTenant } from '../test/harness.js';

/**
 * Turmas on one lane at one hour — Rui, 14-11-2026. Saved and warned, never
 * refused; counted on the bell until the calendar spreads them. Turmas side by
 * side in different lanes are normal and say nothing.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

test('a turma on a lane another holds at that hour saves, warns, and lights the bell until moved', async () => {
  await withScratchTenant(async (tenant) => {
    const [pool] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool (organization_id, facility_id, name, kind) VALUES ($1, $2, 'Tanque', 'indoor') RETURNING id`,
      [tenant.organizationId, tenant.facilityId],
    );
    await tenant.sql(
      `INSERT INTO lane (organization_id, pool_id, name, position) SELECT $1, $2, 'Pista ' || n, n FROM generate_series(2, 4) AS n`,
      [tenant.organizationId, pool!.id],
    );
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const classes = new ClassesController();
      const slot = { weekday: 1, startTime: '18:00', durationMinutes: 45 };
      const golfinhos = await classes.create({ name: 'Golfinhos', poolId: pool!.id, lane: 1 });
      assert.deepEqual((await classes.schedule(golfinhos.id, slot)).laneOverlaps, []);

      // Another lane at the same hour: normal, nothing said.
      const tubaroes = await classes.create({ name: 'Tubarões', poolId: pool!.id, lane: 2 });
      assert.deepEqual((await classes.schedule(tubaroes.id, slot)).laneOverlaps, []);

      // The same lane, half an hour in: saved, and named.
      const bebes = await classes.create({ name: 'Bebés', poolId: pool!.id, lane: 1 });
      const added = await classes.schedule(bebes.id, { weekday: 1, startTime: '18:30', durationMinutes: 45 });
      assert.equal(added.added, true);
      assert.deepEqual(added.laneOverlaps, [{ weekday: 1, startTime: '18:30', other: 'Golfinhos', otherStartTime: '18:00' }]);
      assert.equal((await new AttentionController().read()).menu['overlaps'], 1);

      // Moved to a free lane: the circle clears by itself.
      await classes.update(bebes.id, { name: 'Bebés', poolId: pool!.id, lane: 3 });
      assert.equal((await new AttentionController().read()).menu['overlaps'], undefined);
    });
  });
});

test('Distribuir pelas pistas moves the second of two turmas on one lane to a free one (16-11-2026)', async () => {
  await withScratchTenant(async (tenant) => {
    const [pool] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool (organization_id, facility_id, name, kind) VALUES ($1, $2, 'Tanque', 'indoor') RETURNING id`,
      [tenant.organizationId, tenant.facilityId],
    );
    await tenant.sql(
      `INSERT INTO lane (organization_id, pool_id, name, position) SELECT $1, $2, 'Pista ' || n, n FROM generate_series(2, 3) AS n`,
      [tenant.organizationId, pool!.id],
    );
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const classes = new ClassesController();
      const golfinhos = await classes.create({ name: 'Golfinhos', poolId: pool!.id, lane: 1 });
      await classes.schedule(golfinhos.id, { weekday: 1, startTime: '18:00', durationMinutes: 45 });
      const bebes = await classes.create({ name: 'Bebés', poolId: pool!.id, lane: 1 });
      await classes.schedule(bebes.id, { weekday: 1, startTime: '18:30', durationMinutes: 45 });
      assert.equal((await new AttentionController().read()).menu['overlaps'], 1);

      const bookings = new BookingsController();
      assert.deepEqual(await bookings.distribute(tenant.facilityId, pool!.id), { placed: 1, unplaced: 0 });
      assert.equal((await new AttentionController().read()).menu['overlaps'], undefined, 'nothing left to spread');
      const [golf] = await tenant.sql<{ lane: number }>(
        `SELECT l.position AS lane FROM booking_lane bl JOIN lane l ON l.id = bl.lane_id
           JOIN class_schedule cs ON cs.id = bl.schedule_id WHERE cs.class_group_id = $1`,
        [golfinhos.id],
      );
      assert.equal(golf!.lane, 1, 'the first holder stays on lane 1');
    });
  });
});
