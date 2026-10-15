import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { FacilitiesController } from './facilities.controller.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * Who may open a site's own page — 15 October 2026, Rui's call.
 *
 * The site page is where the club is configured, so owner and admin open it;
 * maintenance opens it too, for its Espaços, Manutenção and Energia tabs. An
 * instructor and a family have the Instalações list, and the list's flags say
 * which links on it lead somewhere that will answer.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

test('owner, admin and maintenance open the site page; an instructor is refused', async () => {
  await withScratchTenant(async (tenant) => {
    for (const role of ['owner', 'admin', 'maintenance'] as const) {
      await actingAs(tenant, { roles: [role] }, async () => {
        const site = await new FacilitiesController().one(tenant.facilityId);
        assert.equal(site.id, tenant.facilityId, role);
        assert.equal(site.canManage, role !== 'maintenance', role);
      });
    }

    // Poolse support works as an admin inside the grant's window — POOLSE-79.
    await actingAs(tenant, { roles: ['admin'], support: true }, async () => {
      assert.equal((await new FacilitiesController().one(tenant.facilityId)).canManage, true);
    });

    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      await expectStatus(() => new FacilitiesController().one(tenant.facilityId), 403);
    });
  });
});

test('the list is everybody’s, and its flags match what the pages answer', async () => {
  await withScratchTenant(async (tenant) => {
    const expected = {
      owner: { canManage: true, canOpenSite: true, canOpenPools: true },
      admin: { canManage: true, canOpenSite: true, canOpenPools: true },
      maintenance: { canManage: false, canOpenSite: true, canOpenPools: true },
      instructor: { canManage: false, canOpenSite: false, canOpenPools: true },
      guardian: { canManage: false, canOpenSite: false, canOpenPools: false },
      student: { canManage: false, canOpenSite: false, canOpenPools: false },
    } as const;

    for (const [role, flags] of Object.entries(expected)) {
      await actingAs(tenant, { roles: [role as keyof typeof expected] }, async () => {
        const list = await new FacilitiesController().list();
        assert.ok(list.facilities.some((f) => f.id === tenant.facilityId), role);
        assert.deepEqual(
          { canManage: list.canManage, canOpenSite: list.canOpenSite, canOpenPools: list.canOpenPools },
          flags,
          role,
        );
      });
    }
  });
});
