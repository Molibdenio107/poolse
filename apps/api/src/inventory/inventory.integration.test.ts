import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { InventoryController } from './inventory.controller.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * The store-room screen loads — round 6, ticket 2.
 *
 * Written because it did not. `GET /inventory` answered 500 for every request
 * in every organization: `locationsAt` aliased a subquery `AS both`, and `BOTH`
 * is a reserved word in SQL — the keyword in `trim(both ' ' from x)` — so the
 * statement never parsed. The page showed "The server hit an error loading this
 * page." and nothing in the trace named an alias.
 *
 * Nothing in the suite could have caught it. `inventory.test.ts` tests the pure
 * validator and never opens a connection; typecheck cannot read SQL; and the
 * query only runs on the one code path nobody had exercised. A reserved word is
 * also the specific class of bug no unit test finds, because it is invisible
 * until Postgres itself is asked.
 *
 * So this loads the endpoint the page loads, twice: **with an empty store and
 * with items in it**. Empty matters as much as populated — `locationsAt` returns
 * no rows either way and still has to parse, and a club's first visit to this
 * screen is the empty one.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

test('an empty store room loads, and so does the location list behind it', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const response = await new InventoryController().list();

      assert.equal(response.facilityId, tenant.facilityId);
      assert.deepEqual(response.items.items, []);
      assert.equal(response.items.total, 0);
      // The query that broke the page. It has nothing to say yet and still has
      // to be a statement Postgres will parse.
      assert.deepEqual(response.locations, []);
      assert.equal(response.canManage, true);
    });
  });
});

test('a store room with kit in it loads, and the places are offered back', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new InventoryController();

      await controller.add({
        facilityId: tenant.facilityId,
        name: 'Pranchas',
        quantity: 18,
        location: 'Arrecadação',
        scope: 'facility',
      });
      await controller.add({
        facilityId: tenant.facilityId,
        name: 'Argolas',
        quantity: 20,
        location: 'armário 2',
        scope: 'facility',
      });

      // Somewhere a thing turned up, which draws on the same vocabulary.
      await controller.recordFound({
        facilityId: tenant.facilityId,
        description: 'Óculos azuis',
        locationFound: 'Balneário masculino',
      });

      const response = await controller.list();

      assert.equal(response.items.total, 2);
      assert.deepEqual(
        response.items.items.map((item) => item.name),
        ['Argolas', 'Pranchas'],
      );

      /*
       * All three places, from both tables, folded for accents rather than
       * sorted by byte — which is what puts "armário 2" first and would put
       * "Arrecadação" after "Zona" under a plain `ORDER BY location`.
       */
      assert.deepEqual(response.locations, ['armário 2', 'Arrecadação', 'Balneário masculino']);
    });
  });
});

test('an instructor may read the store room and is told they may not change it', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      const response = await new InventoryController().list();

      assert.equal(response.canManage, false, 'the screen renders read-only');
      assert.deepEqual(response.items.items, [], 'and it still loads');
    });
  });
});

test('maintenance keeps the store room and lost property, and archives nothing', async () => {
  // Rui, 15-10-2026: maintenance edits the inventory; archiving stays owner/admin.
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['maintenance'] }, async () => {
      const controller = new InventoryController();
      const { id } = await controller.add({
        facilityId: tenant.facilityId,
        name: 'Pranchas',
        quantity: 18,
        scope: 'facility',
      });
      await controller.edit(id, { name: 'Pranchas', quantity: 16, scope: 'facility' });
      const { id: found } = await controller.recordFound({
        facilityId: tenant.facilityId,
        description: 'Toalha',
      });
      await controller.giveBack(found);

      const response = await controller.list();
      assert.equal(response.canManage, true);
      assert.equal(response.canArchive, false);
      assert.equal(response.items.items[0]?.quantity, 16);
      assert.equal((await controller.lostAndFound()).canManage, true);

      await expectStatus(() => controller.remove(id), 403);
      await expectStatus(() => controller.removeFound(found), 403);
    });
  });
});

test('an instructor who is also maintenance edits the store; an instructor alone does not', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['instructor', 'maintenance'] }, async () => {
      assert.equal((await new InventoryController().list()).canManage, true);
    });
    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      await expectStatus(
        () => new InventoryController().add({ facilityId: tenant.facilityId, name: 'X', quantity: 1, scope: 'facility' }),
        403,
      );
    });
  });
});
