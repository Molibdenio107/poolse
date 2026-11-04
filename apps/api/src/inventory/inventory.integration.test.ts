import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
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

// ---------------------------------------------------------------------------
// POOLSE-154 — Localização from the site's own places, and lost and found
// for every working role
// ---------------------------------------------------------------------------

/** The owner login, for the one switch the app may not write: the club's sports. */
const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 1 });
after(() => owner.end());

test('lost and found is every working role\'s: an instructor records and gives back; a family is refused', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      const controller = new InventoryController();
      const { id } = await controller.recordFound({ facilityId: tenant.facilityId, description: 'Óculos' });
      assert.deepEqual(await controller.giveBack(id), { returned: true });
      assert.equal((await controller.lostAndFound()).canManage, true, 'the form is offered');
      // Still not the store room, and still not the bin.
      await expectStatus(() => controller.removeFound(id), 403);
    });
    for (const role of ['guardian', 'student'] as const) {
      await actingAs(tenant, { roles: [role] }, async () => {
        const controller = new InventoryController();
        await expectStatus(
          () => controller.recordFound({ facilityId: tenant.facilityId, description: 'Toalha' }),
          403,
        );
        await expectStatus(() => controller.giveBack('00000000-0000-0000-0000-000000000000'), 403);
      });
    }
  });
});

test('Localização offers the spaces and the other recintos, and saves a space, a court or a pool', async () => {
  await withScratchTenant(async (tenant) => {
    await owner.query("UPDATE organization SET enabled_sports = '{pool,tennis}' WHERE id = $1", [
      tenant.organizationId,
    ]);
    const [space] = await tenant.sql<{ id: string }>(
      `INSERT INTO space (organization_id, facility_id, name) VALUES ($1, $2, 'Arrecadação') RETURNING id`,
      [tenant.organizationId, tenant.facilityId],
    );
    const [court] = await tenant.sql<{ id: string }>(
      `INSERT INTO playing_area (organization_id, facility_id, sport_id, name)
       VALUES ($1, $2, 'tennis', 'Campo 1') RETURNING id`,
      [tenant.organizationId, tenant.facilityId],
    );
    const [pool] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool (organization_id, facility_id, name, kind)
       VALUES ($1, $2, 'Piscina principal', 'indoor'::pool_kind) RETURNING id`,
      [tenant.organizationId, tenant.facilityId],
    );

    await actingAs(tenant, { roles: ['maintenance'] }, async () => {
      const controller = new InventoryController();
      const before = await controller.list(tenant.facilityId);
      assert.deepEqual(before.places.spaces.map((s) => s.name), ['Arrecadação']);
      assert.deepEqual(before.places.recintos.map((r) => r.name), ['Campo 1'], 'a pool is offered as a pool, not here');

      await controller.add({ facilityId: tenant.facilityId, name: 'Esfregona', quantity: 2, spaceId: space!.id });
      await controller.add({ facilityId: tenant.facilityId, name: 'Rede', quantity: 1, playingAreaId: court!.id });
      await controller.add({
        facilityId: tenant.facilityId,
        name: 'Boia',
        quantity: 4,
        scope: 'pools',
        poolIds: [pool!.id],
      });

      const { items } = await controller.list(tenant.facilityId);
      const byName = new Map(items.items.map((item) => [item.name, item]));
      assert.equal(byName.get('Esfregona')?.spaceName, 'Arrecadação');
      assert.equal(byName.get('Rede')?.playingAreaName, 'Campo 1');
      assert.deepEqual(byName.get('Boia')?.poolNames, ['Piscina principal'], 'a boia belongs to the pool');

      // One place, never two.
      await expectStatus(
        () =>
          controller.add({
            facilityId: tenant.facilityId,
            name: 'Cone',
            quantity: 1,
            spaceId: space!.id,
            playingAreaId: court!.id,
          }),
        400,
      );
    });
  });
});

test("another club's space or court is refused by the composite key, and said as a 400", async () => {
  await withScratchTenant(async (other) => {
    const [theirs] = await other.sql<{ id: string }>(
      `INSERT INTO space (organization_id, facility_id, name) VALUES ($1, $2, 'Deles') RETURNING id`,
      [other.organizationId, other.facilityId],
    );
    await withScratchTenant(async (tenant) => {
      await actingAs(tenant, { roles: ['owner'] }, async () => {
        await expectStatus(
          () =>
            new InventoryController().add({
              facilityId: tenant.facilityId,
              name: 'Intruso',
              quantity: 1,
              spaceId: theirs!.id,
            }),
          400,
        );
      });
      const [row] = await tenant.sql<{ n: number }>(`SELECT count(*)::int AS n FROM inventory_item`);
      assert.equal(row!.n, 0, 'nothing was written');
    });
  });
});

test('a returned item stays on the list for seven days after its last change, then leaves it — kept, never deleted', async () => {
  await withScratchTenant(async (tenant) => {
    const insert = (description: string, status: 'found' | 'returned', ageDays: number) =>
      tenant.sql(
        `INSERT INTO lost_and_found_item
           (organization_id, facility_id, description, status, returned_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4::lost_and_found_status,
                 CASE WHEN $4 = 'returned' THEN now() - make_interval(days => $5) END,
                 now() - make_interval(days => $5), now() - make_interval(days => $5))`,
        [tenant.organizationId, tenant.facilityId, description, status, ageDays],
      );
    await insert('Toalha esquecida', 'found', 30);
    await insert('Óculos entregues ontem', 'returned', 2);
    await insert('Fato entregue há muito', 'returned', 8);

    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      const { items } = await new InventoryController().lostAndFound(tenant.facilityId);
      const names = items.map((item) => item.description);
      assert.ok(names.includes('Toalha esquecida'), 'an unclaimed item never leaves on its own');
      assert.ok(names.includes('Óculos entregues ontem'), 'a recent return is still listed');
      assert.equal(names.includes('Fato entregue há muito'), false, 'a week untouched and it leaves the list');

      const recent = items.find((item) => item.description === 'Óculos entregues ontem')!;
      const days = (new Date(recent.leavesListAt!).getTime() - Date.now()) / 86_400_000;
      assert.ok(days > 4.9 && days < 5.1, 'it says when it leaves: five days from now');
      assert.equal(items.find((item) => item.description === 'Toalha esquecida')?.leavesListAt, null);
    });

    const [kept] = await tenant.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM lost_and_found_item WHERE description = 'Fato entregue há muito' AND archived_at IS NULL`,
    );
    assert.equal(kept!.n, 1, 'the row itself is kept');
  });
});
