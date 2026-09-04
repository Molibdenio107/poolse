import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ClassesController } from './classes.controller.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';
import type { ScratchTenant } from '../test/harness.js';

/**
 * Saving a turma — POOLSE-R2-01.
 *
 * Reported as "Save returns 500, with no changes, on a seeded class". It was
 * `UPDATE class_session SET lane_id = …` against a table that has never had a
 * `lane_id` column: a session keeps its lanes in `class_session_lane`, because
 * the exclusion constraint that stops two classes sharing a lane needs a row per
 * lane and a time range, and one column cannot say "lanes 1 to 3".
 *
 * So every save failed, on every input — and creating worked, which is what hid
 * it. These tests are the shape of that: a save that changes nothing must
 * succeed, and the lane must actually reach the sessions.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

async function twoLanes(tenant: ScratchTenant): Promise<{ pool: string; lanes: string[] }> {
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind)
     VALUES ($1, $2, 'Tanque', 'indoor') RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );
  await tenant.sql(`UPDATE lane SET name = 'Pista 1' WHERE pool_id = $1 AND position = 1`, [
    pool!.id,
  ]);
  await tenant.sql(
    `INSERT INTO lane (organization_id, pool_id, name, position)
     VALUES ($1, $2, 'Pista 2', 2)`,
    [tenant.organizationId, pool!.id],
  );
  const lanes = await tenant.sql<{ id: string }>(
    `SELECT id FROM lane WHERE pool_id = $1 ORDER BY position`,
    [pool!.id],
  );
  return { pool: pool!.id, lanes: lanes.map((one) => one.id) };
}

test('saving a turma with nothing changed succeeds', async () => {
  // The exact gesture from the report: open it, touch nothing, press Save.
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const classes = new ClassesController();
      const { pool } = await twoLanes(tenant);

      const { id } = await classes.create({ name: 'Cadetes', poolId: pool, capacity: 7 });
      const before = await classes.one(id);

      const saved = await classes.update(id, {
        name: before.name,
        levelId: before.levelId,
        poolId: before.poolId,
        instructorMembershipId: before.instructorMembershipId,
        capacity: before.capacity,
        lane: before.lane,
      });

      assert.deepEqual(saved, { updated: true });

      const after = await classes.one(id);
      assert.equal(after.name, 'Cadetes');
      assert.equal(after.poolId, pool, 'the pool survived the save');
      assert.equal(after.capacity, 7);
    });
  });
});

test('a save with every field empty is still a save, not a 500', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const classes = new ClassesController();
      const { id } = await classes.create({ name: 'Sem nada' });

      const saved = await classes.update(id, {
        name: 'Sem nada',
        levelId: '',
        poolId: '',
        instructorMembershipId: '',
        capacity: '',
        lane: '',
      });
      assert.deepEqual(saved, { updated: true });
    });
  });
});

test('the lane reaches the sessions the turma already has', async () => {
  /*
   * What the broken statement was trying to do. A session's lanes live in
   * `class_session_lane`, so moving the turma has to move those rows — otherwise
   * the calendar goes on drawing the class in the lane it left.
   */
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const classes = new ClassesController();
      const { pool, lanes } = await twoLanes(tenant);
      const { id } = await classes.create({ name: 'Infantis', poolId: pool, lane: 1 });

      // A session in the future, as generation would leave one.
      const [session] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_session
           (organization_id, class_group_id, pool_id, starts_at, duration_minutes, status)
         VALUES ($1, $2, $3, now() + interval '7 days', 45, 'scheduled')
         RETURNING id`,
        [tenant.organizationId, id, pool],
      );
      await tenant.sql(
        `INSERT INTO class_session_lane
           (organization_id, session_id, lane_id, starts_at, ends_at, cancelled)
         SELECT $1, s.id, $2, s.starts_at, s.ends_at, false
           FROM class_session s WHERE s.id = $3`,
        [tenant.organizationId, lanes[0], session!.id],
      );

      // Move the turma to lane 2.
      await classes.update(id, { name: 'Infantis', poolId: pool, lane: 2 });

      const held = await tenant.sql<{ lane_id: string }>(
        `SELECT lane_id FROM class_session_lane WHERE session_id = $1`,
        [session!.id],
      );
      assert.deepEqual(
        held.map((one) => one.lane_id),
        [lanes[1]],
        'the session followed the turma onto Pista 2',
      );
    });
  });
});

test('moving a turma onto a busy lane is a conflict, not a crash', async () => {
  // The exclusion constraint is right to refuse it; a 500 is the wrong way to
  // say so, and a 500 is what a bare 23P01 would have been.
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const classes = new ClassesController();
      const { pool, lanes } = await twoLanes(tenant);

      const mine = await classes.create({ name: 'Meu', poolId: pool, lane: 1 });
      const theirs = await classes.create({ name: 'Outro', poolId: pool, lane: 2 });

      // Both have a session at the same hour; the second already holds Pista 1.
      for (const [group, lane] of [
        [theirs.id, lanes[0]],
        [mine.id, lanes[1]],
      ] as const) {
        const [session] = await tenant.sql<{ id: string }>(
          `INSERT INTO class_session
             (organization_id, class_group_id, pool_id, starts_at, duration_minutes, status)
           VALUES ($1, $2, $3, date_trunc('day', now()) + interval '7 days 10 hours', 45,
                   'scheduled')
           RETURNING id`,
          [tenant.organizationId, group, pool],
        );
        await tenant.sql(
          `INSERT INTO class_session_lane
             (organization_id, session_id, lane_id, starts_at, ends_at, cancelled)
           SELECT $1, s.id, $2, s.starts_at, s.ends_at, false
             FROM class_session s WHERE s.id = $3`,
          [tenant.organizationId, lane, session!.id],
        );
      }

      await expectStatus(
        () => classes.update(mine.id, { name: 'Meu', poolId: pool, lane: 1 }),
        409,
      );
    });
  });
});
