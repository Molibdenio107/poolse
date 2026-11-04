import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { FacilitiesController } from './facilities.controller.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * Recintos — POOLSE-122.
 *
 * A pool is one kind of recinto, and nothing the pilot sees changes: the API
 * adds a pool exactly as before, the recinto comes with it by trigger, and the
 * site read answers `playingAreas` beside `pools` — the same rows until
 * POOLSE-125 switches the menu. The schema half is `packages/db/test/playing-areas.sql`.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

/** The owner login, for the one switch the app may not write: `enabled_sports`. */
const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 1 });

after(async () => {
  await owner.end();
  await closeHarness();
});

test('a pool added through the API arrives with its recinto, and archives with it', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new FacilitiesController();
      const { id: poolId } = await controller.addPool(tenant.facilityId, {
        name: 'Piscina Recinto',
        kind: 'indoor',
      });

      const site = await controller.one(tenant.facilityId);
      const area = site.playingAreas.find((a) => a.poolId === poolId);
      assert.ok(area, 'the new pool has a recinto on the site read');
      assert.equal(area.sportId, 'pool');
      assert.equal(area.name, 'Piscina Recinto');

      // Every live pool has exactly one live recinto, and no other recinto exists yet.
      assert.deepEqual(
        site.playingAreas.map((a) => a.poolId).sort(),
        site.pools.map((p) => p.id).sort(),
      );

      await controller.archivePoolById(poolId);
      const [row] = await tenant.sql<{ archived: boolean }>(
        'SELECT archived_at IS NOT NULL AS archived FROM playing_area WHERE id = $1',
        [area.id],
      );
      assert.equal(row!.archived, true, 'archiving the pool archived its recinto');

      const after = await controller.one(tenant.facilityId);
      assert.equal(after.playingAreas.some((a) => a.id === area.id), false);
    });
  });
});

test('a name a recinto holds is a 409, accents and case aside', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new FacilitiesController();
      await controller.addPool(tenant.facilityId, { name: 'Piscina Olímpica', kind: 'indoor' });
      await expectStatus(
        () => controller.addPool(tenant.facilityId, { name: 'PISCINA OLIMPICA', kind: 'indoor' }),
        409,
      );
    });
  });
});

test('another club\'s site answers 404, recintos and all', async () => {
  await withScratchTenant(async (other) => {
    await withScratchTenant(async (tenant) => {
      await actingAs(tenant, { roles: ['owner'] }, async () => {
        await expectStatus(() => new FacilitiesController().one(other.facilityId), 404);
      });
    });
  });
});

test("another club's site takes no pool and no recinto: 404, and nothing written there — POOLSE-152", async () => {
  await withScratchTenant(async (other) => {
    await withScratchTenant(async (tenant) => {
      // Tennis on for the acting club, so the refusal is about the site and not the sport.
      await owner.query("UPDATE organization SET enabled_sports = '{pool,tennis}' WHERE id = $1", [
        tenant.organizationId,
      ]);
      const counts = async (): Promise<{ pools: number; areas: number }> => {
        const [row] = await other.sql<{ pools: number; areas: number }>(
          'SELECT (SELECT count(*)::int FROM pool) AS pools, (SELECT count(*)::int FROM playing_area) AS areas',
        );
        return row!;
      };
      const before = await counts();

      await actingAs(tenant, { roles: ['owner'] }, async () => {
        const controller = new FacilitiesController();
        await expectStatus(() => controller.addPool(other.facilityId, { name: 'Intrusa', kind: 'indoor' }), 404);
        await expectStatus(
          () => controller.addPlayingArea(other.facilityId, { sportId: 'tennis', name: 'Intruso' }),
          404,
        );
      });

      assert.deepEqual(await counts(), before, "the other club's site is untouched");
    });
  });
});
