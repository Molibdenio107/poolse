import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';
import { DashboardController } from './dashboard.controller.js';
import type { Dashboard } from './compose.js';
import type { InventoryWatch, OpenFaults, OverdueSpaces } from './maintenance-band.repository.js';
import type { WaterQualityWidget } from './resolvers.js';
import { SpacesController } from '../spaces/spaces.controller.js';
import { FacilitiesController } from '../facilities/facilities.controller.js';

/**
 * The maintenance band — POOLSE-66 slice 4, against a real club.
 *
 * What this file owns: that each card reads every site the reader works at and
 * never the management selector (AC 10); that avarias and reposições are each
 * listed once; that the band carries no money and no management card; that
 * another club's rooms are not here; and the one permission the slice widened —
 * maintenance may record a water analysis, an instructor still may not.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

const dashboard = new DashboardController();
const spaces = new SpacesController();
const facilities = new FacilitiesController();

after(async () => {
  await closeHarness();
});

function card<T>(page: Dashboard, id: string): { state: string; data: T } | undefined {
  return page.bands
    .flatMap((band) => band.widgets)
    .find((one) => one.id === id) as { state: string; data: T } | undefined;
}

async function addSite(tenant: ScratchTenant, name: string): Promise<string> {
  const [site] = await tenant.sql<{ id: string }>(
    `INSERT INTO facility (organization_id, name) VALUES ($1, $2) RETURNING id`,
    [tenant.organizationId, name],
  );
  return site!.id;
}

async function addSpace(
  tenant: ScratchTenant,
  facilityId: string,
  name: string,
  intervalHours: number | null = 24,
): Promise<string> {
  const [space] = await tenant.sql<{ id: string }>(
    `INSERT INTO space (organization_id, facility_id, name, expected_cleaning_interval_hours)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenant.organizationId, facilityId, name, intervalHours],
  );
  return space!.id;
}

const asMaintenance = (tenant: ScratchTenant, membershipId: string, facility?: string) =>
  actingAs(tenant, { membershipId, roles: ['maintenance'] }, () => dashboard.read(facility));

test('66.4 avarias — worst first, mine marked, reposições not listed here', async () => {
  await withScratchTenant(async (tenant) => {
    const joao = await addMember(tenant, 'João', 'Reis', ['maintenance']);
    const room = await addSpace(tenant, tenant.facilityId, 'Balneário');

    await actingAs(tenant, { roles: ['owner'] }, () =>
      spaces.report(room, { type: 'fault', description: 'Torneira a pingar', severity: 'low' }),
    );
    await actingAs(tenant, { membershipId: joao, roles: ['maintenance'] }, () =>
      spaces.report(room, { type: 'fault', description: 'Chuveiro partido', severity: 'high' }),
    );
    await actingAs(tenant, { roles: ['owner'] }, () =>
      spaces.report(room, { type: 'restock', description: 'Sabonete' }),
    );

    const page = await asMaintenance(tenant, joao);
    const faults = card<OpenFaults>(page, 'maint.requests');

    assert.equal(faults?.state, 'ok');
    assert.equal(faults!.data.total, 2, 'avarias only');
    assert.equal(faults!.data.high, 1);
    assert.deepEqual(
      faults!.data.faults.map((f) => [f.description, f.mine]),
      [
        ['Chuveiro partido', true],
        ['Torneira a pingar', false],
      ],
    );
    assert.equal(faults!.data.faults[0]!.spaceName, 'Balneário');

    const operational = page.bands.find((band) => band.id === 'operational')!;
    assert.equal(operational.widgets[0]!.id, 'maint.requests', 'a high avaria goes first');

    const store = card<InventoryWatch>(page, 'maint.inventory');
    assert.equal(store!.data.restockTotal, 1, 'the reposição is the store room’s');
  });
});

test('66.4 overdue rooms — never cleaned is overdue, out of service and no interval are not', async () => {
  await withScratchTenant(async (tenant) => {
    const joao = await addMember(tenant, 'João', 'Reis', ['maintenance']);
    const never = await addSpace(tenant, tenant.facilityId, 'Balneário Norte');
    const clean = await addSpace(tenant, tenant.facilityId, 'Balneário Sul');
    await addSpace(tenant, tenant.facilityId, 'Arrecadação', null);
    const shut = await addSpace(tenant, tenant.facilityId, 'Sauna');
    await tenant.sql(`UPDATE space SET active = false WHERE id = $1`, [shut]);

    await actingAs(tenant, { membershipId: joao, roles: ['maintenance'] }, () =>
      spaces.clean(clean, {}),
    );

    const overdue = card<OverdueSpaces>(await asMaintenance(tenant, joao), 'maint.cleanings.overdue');
    assert.deepEqual(
      overdue!.data.spaces.map((s) => s.id),
      [never],
    );
    assert.equal(overdue!.data.spaces[0]!.lastCleanedAt, null);

    // Logging the cleaning is what the card's button does, and it empties it.
    await actingAs(tenant, { membershipId: joao, roles: ['maintenance'] }, () =>
      spaces.clean(never, {}),
    );
    const after = card(await asMaintenance(tenant, joao), 'maint.cleanings.overdue');
    assert.equal(after?.state, 'empty');
  });
});

test('66.4 water — a tank due at a site with a threshold, and maintenance may now record it', async () => {
  await withScratchTenant(async (tenant) => {
    const joao = await addMember(tenant, 'João', 'Reis', ['maintenance']);
    const ana = await addMember(tenant, 'Ana', 'Lopes', ['instructor']);
    await tenant.sql(`UPDATE facility SET water_analysis_max_age_hours = 24 WHERE id = $1`, [
      tenant.facilityId,
    ]);
    const [pool] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool (organization_id, facility_id, name) VALUES ($1, $2, 'Tanque Grande')
       RETURNING id`,
      [tenant.organizationId, tenant.facilityId],
    );

    let water = card<WaterQualityWidget>(await asMaintenance(tenant, joao), 'maint.waterquality.due');
    assert.deepEqual(
      water!.data.flagged.map((p) => [p.poolName, p.due]),
      [['Tanque Grande', true]],
    );

    await expectStatus(
      () =>
        actingAs(tenant, { membershipId: ana, roles: ['instructor'] }, () =>
          facilities.recordAnalysis(pool!.id, {
            takenAt: new Date().toISOString(),
            values: { ph: 7.4 },
          }),
        ),
      403,
    );

    await actingAs(tenant, { membershipId: joao, roles: ['maintenance'] }, () =>
      facilities.recordAnalysis(pool!.id, {
        takenAt: new Date().toISOString(),
        values: { ph: 7.4 },
      }),
    );

    const detail = await actingAs(tenant, { membershipId: joao, roles: ['maintenance'] }, () =>
      facilities.pool(pool!.id),
    );
    assert.equal(detail.canRecordAnalysis, true);
    assert.equal(detail.canManage, false, 'recording is the only write widened');

    water = card<WaterQualityWidget>(await asMaintenance(tenant, joao), 'maint.waterquality.due');
    assert.equal(water?.state, 'empty', 'recorded, in range, on time');
  });
});

test('66.4 the store room — open reposições and lost property found this week, not returned', async () => {
  await withScratchTenant(async (tenant) => {
    const joao = await addMember(tenant, 'João', 'Reis', ['maintenance']);
    const room = await addSpace(tenant, tenant.facilityId, 'Arrecadação', null);
    await actingAs(tenant, { roles: ['owner'] }, () =>
      spaces.report(room, { type: 'restock', description: 'Pastilhas de cloro' }),
    );
    await tenant.sql(
      `INSERT INTO lost_and_found_item (organization_id, facility_id, description, found_on)
       VALUES ($1, $2, 'Toalha azul', current_date),
              ($1, $2, 'Óculos antigos', current_date - 30)`,
      [tenant.organizationId, tenant.facilityId],
    );
    await tenant.sql(
      `INSERT INTO lost_and_found_item (organization_id, facility_id, description, found_on,
                                        status, returned_at)
       VALUES ($1, $2, 'Touca devolvida', current_date, 'returned', now())`,
      [tenant.organizationId, tenant.facilityId],
    );

    const store = card<InventoryWatch>(await asMaintenance(tenant, joao), 'maint.inventory');
    assert.equal(store!.data.restockTotal, 1);
    assert.equal(store!.data.restocks[0]!.description, 'Pastilhas de cloro');
    assert.deepEqual(
      store!.data.lost.map((l) => l.description),
      ['Toalha azul'],
    );
  });
});

test('66.4 AC 10 — the operational band ignores the selector', async () => {
  await withScratchTenant(async (tenant) => {
    const second = await addSite(tenant, 'Pavilhão Norte');
    const there = await addSpace(tenant, second, 'Balneário do Pavilhão');
    await actingAs(tenant, { roles: ['owner'] }, () =>
      spaces.report(there, { type: 'fault', description: 'Porta empenada' }),
    );

    // An owner who also does maintenance, looking at the first site's money.
    const page = await actingAs(tenant, { roles: ['owner', 'maintenance'] }, () =>
      dashboard.read(tenant.facilityId),
    );
    assert.equal(page.scope.facilityId, tenant.facilityId);
    const faults = card<OpenFaults>(page, 'maint.requests');
    assert.equal(faults!.data.total, 1, "the other site's avaria is still theirs to fix");
  });
});

test('66.4 the band carries no money, no management card and no selector', async () => {
  await withScratchTenant(async (tenant) => {
    const joao = await addMember(tenant, 'João', 'Reis', ['maintenance']);
    await addSite(tenant, 'Pavilhão Norte');

    const page = await asMaintenance(tenant, joao);
    const raw = JSON.stringify(page);
    assert.equal(raw.includes('"mgmt.'), false);
    assert.equal(raw.includes('"inst.'), false);
    assert.equal(/cents/i.test(raw), false);
    assert.deepEqual(page.scope.facilities, [], 'two sites, and still no selector');

    await expectStatus(
      () =>
        actingAs(tenant, { membershipId: joao, roles: ['maintenance'] }, () =>
          dashboard.rememberScope({ facilityId: null }),
        ),
      403,
    );
  });
});

test("66.4 another club's overdue room is not on this club's card", async () => {
  await withScratchTenant(async (mine) => {
    const joao = await addMember(mine, 'João', 'Reis', ['maintenance']);

    await withScratchTenant(async (theirs) => {
      await addSpace(theirs, theirs.facilityId, 'Balneário Alheio');

      const overdue = card(await asMaintenance(mine, joao), 'maint.cleanings.overdue');
      assert.equal(overdue?.state, 'empty');
    });
  });
});
