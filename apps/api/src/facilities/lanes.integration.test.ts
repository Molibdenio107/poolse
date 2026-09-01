import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import { FacilitiesController } from './facilities.controller.js';
import { actingAs, closeHarness, withScratchTenant } from '../test/harness.js';

/**
 * Lanes, through the endpoints that make them — POOLSE-43.
 *
 * `packages/db/test/lanes.sql` proves what the schema guarantees. This proves
 * the half above it: that the form's "número de pistas" really does add and
 * remove lane rows, that shrinking a tank past a class refuses in a way the
 * screen can act on, and that a pool nobody gave a lane count to still has a
 * lane — which is the invariant everything downstream is built on.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

async function siteWithPool(
  facilities: FacilitiesController,
  laneCount: number | null,
): Promise<{ facilityId: string; poolId: string }> {
  const { id: facilityId } = await facilities.create({ name: `Piscina ${Date.now()}` });
  const { id: poolId } = await facilities.addPool(facilityId, {
    name: 'Tanque Grande',
    kind: 'indoor',
    ...(laneCount === null ? {} : { laneCount }),
  });
  return { facilityId, poolId };
}

test('a pool created without a lane count still has one lane', async () => {
  await withScratchTenant(async (tenant) => {
    const facilities = new FacilitiesController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { poolId } = await siteWithPool(facilities, null);

      const pool = await facilities.pool(poolId);
      // The invariant the whole lane model rests on: there is no "no lane" case,
      // so a learner tank is simply a pool with one lane.
      assert.equal(pool.laneCount, 1);
    });
  });
});

test('the lane count on the form is the number of lane rows', async () => {
  await withScratchTenant(async (tenant) => {
    const facilities = new FacilitiesController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { poolId } = await siteWithPool(facilities, 6);

      assert.equal((await facilities.pool(poolId)).laneCount, 6);
    });
  });
});

test('raising the count adds lanes and leaves the existing ones alone', async () => {
  await withScratchTenant(async (tenant) => {
    const facilities = new FacilitiesController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { poolId } = await siteWithPool(facilities, 4);

      await facilities.editPool(poolId, {
        name: 'Tanque Grande',
        kind: 'indoor',
        laneCount: 6,
      });

      assert.equal((await facilities.pool(poolId)).laneCount, 6);
    });
  });
});

test('lowering the count archives the top lanes when nothing is on them', async () => {
  await withScratchTenant(async (tenant) => {
    const facilities = new FacilitiesController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { poolId } = await siteWithPool(facilities, 6);

      await facilities.editPool(poolId, {
        name: 'Tanque Grande',
        kind: 'indoor',
        laneCount: 3,
      });

      assert.equal((await facilities.pool(poolId)).laneCount, 3);

      // Soft-deleted, so the count came down without destroying the history —
      // and the freed names can be used again.
      const [row] = await tenant.sql<{ archived: string }>(
        `SELECT count(*)::text AS archived FROM lane
          WHERE pool_id = $1 AND archived_at IS NOT NULL`,
        [poolId],
      );
      assert.equal(row?.archived, '3');
    });
  });
});

test('lowering the count is refused while a turma is on one of those lanes', async () => {
  await withScratchTenant(async (tenant) => {
    const facilities = new FacilitiesController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { poolId } = await siteWithPool(facilities, 6);

      // A turma on Pista 5, put there directly: this test is about the refusal,
      // not about the turma endpoints.
      const [lane] = await tenant.sql<{ id: string }>(
        `SELECT id FROM lane WHERE pool_id = $1 AND position = 5`,
        [poolId],
      );
      await tenant.sql(
        `INSERT INTO class_group (organization_id, season_id, name, pool_id, lane_id)
         VALUES ($1, (SELECT id FROM season WHERE organization_id = $1 AND archived_at IS NULL),
                 'Infantis A', $2, $3)`,
        [tenant.organizationId, poolId, lane?.id],
      );

      await assert.rejects(
        facilities.editPool(poolId, { name: 'Tanque Grande', kind: 'indoor', laneCount: 4 }),
        (error: unknown) => {
          assert.ok(error instanceof ConflictException);

          // The lanes and the turmas travel with the refusal, because "no" on
          // its own leaves the operator opening every turma to find the one in
          // the way.
          const body = error.getResponse() as { message: string; lanes: string[]; groups: string[] };
          assert.equal(body.message, 'lanesInUse');
          assert.deepEqual(body.lanes, ['Pista 5']);
          assert.deepEqual(body.groups, ['Infantis A']);
          return true;
        },
      );

      // And the refusal took the whole edit with it: the lanes are untouched.
      assert.equal((await facilities.pool(poolId)).laneCount, 6);
    });
  });
});

test('a refused lane change rolls back the rest of the pool edit', async () => {
  await withScratchTenant(async (tenant) => {
    const facilities = new FacilitiesController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { poolId } = await siteWithPool(facilities, 6);

      const [lane] = await tenant.sql<{ id: string }>(
        `SELECT id FROM lane WHERE pool_id = $1 AND position = 6`,
        [poolId],
      );
      await tenant.sql(
        `INSERT INTO class_group (organization_id, season_id, name, pool_id, lane_id)
         VALUES ($1, (SELECT id FROM season WHERE organization_id = $1 AND archived_at IS NULL),
                 'Cadetes', $2, $3)`,
        [tenant.organizationId, poolId, lane?.id],
      );

      await assert.rejects(
        facilities.editPool(poolId, {
          name: 'Nome Novo',
          kind: 'outdoor',
          laneCount: 2,
        }),
      );

      // The name and the kind must not have survived a failed save. One
      // transaction, or an operator ends up with a renamed pool and a refusal
      // message about lanes.
      const pool = await facilities.pool(poolId);
      assert.equal(pool.name, 'Tanque Grande');
      assert.equal(pool.kind, 'indoor');
    });
  });
});

test('an instructor cannot change a pool at all', async () => {
  await withScratchTenant(async (tenant) => {
    const facilities = new FacilitiesController();
    let poolId = '';

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      poolId = (await siteWithPool(facilities, 4)).poolId;
    });

    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      // Hiding a control is never the control — the endpoint refuses it.
      await assert.rejects(
        facilities.editPool(poolId, { name: 'Tanque Grande', kind: 'indoor', laneCount: 8 }),
      );
    });

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      assert.equal((await facilities.pool(poolId)).laneCount, 4);
    });
  });
});
