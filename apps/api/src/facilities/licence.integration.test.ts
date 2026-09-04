import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { FacilitiesController } from './facilities.controller.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';
import type { ScratchTenant } from '../test/harness.js';

/**
 * A subscription covers one facility.
 *
 * **This is a commercial limit, not a modelling one**, and the distinction is
 * the whole point. Backlog story B4 — "one facility per client" as a *schema*
 * rule — was rejected and stays rejected: a municipality with pools in two
 * buildings must not be forced into two organizations with two staff lists and
 * two invoices. So `organization 1 —— N facility` is unchanged, and what is
 * bounded is how many that tenant has paid for.
 *
 * The limit lives in the database because the application layer already forgot
 * once: the POOLSE-55 reference seed created a second facility to keep its demo
 * bookings off a developer's own club, which silently handed an organization a
 * site it had not bought, and nothing objected.
 *
 * The harness raises every scratch tenant's plan out of the way, because most
 * fixtures model two-site clubs and would otherwise be refused by a rule they
 * are not about. **This file is the one place that sets it back to 1**, which is
 * also what a real new organization gets.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/** The default a real organization is provisioned with. */
async function onePlan(tenant: { sql: ScratchTenant['sql']; organizationId: string }): Promise<void> {
  await tenant.sql('UPDATE organization SET max_facilities = 1 WHERE id = $1', [
    tenant.organizationId,
  ]);
}

test('a second facility is refused, and the refusal is about money', async () => {
  await withScratchTenant(async (tenant) => {
    await onePlan(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      // A provisioned organization arrives with one site and a plan for one.
      const [org] = await tenant.sql<{ max_facilities: number }>(
        'SELECT max_facilities FROM organization WHERE id = $1',
        [tenant.organizationId],
      );
      assert.equal(org!.max_facilities, 1);

      /*
       * 402, not 403 and not 409. `Payment Required` is the one status that says
       * what is true: the request is well-formed, the owner is entitled to make
       * it, and the answer is about the plan. A 403 would tell an owner they may
       * not do something they may.
       */
      await expectStatus(
        () => new FacilitiesController().create({ name: 'Piscina Norte' }),
        402,
      );
    });
  });
});

test('raising the plan raises the limit, and nothing else has to change', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await tenant.sql('UPDATE organization SET max_facilities = 2 WHERE id = $1', [
        tenant.organizationId,
      ]);

      // The municipality case: two buildings, one organization, one staff list.
      const second = await new FacilitiesController().create({ name: 'Piscina Norte' });
      assert.ok(second.id);

      // And the third is refused, so the limit is a limit rather than a toggle.
      await expectStatus(
        () => new FacilitiesController().create({ name: 'Piscina Sul' }),
        402,
      );
    });
  });
});

test('archiving a site frees its place', async () => {
  await withScratchTenant(async (tenant) => {
    await onePlan(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const facilities = new FacilitiesController();

      /*
       * A club that closes one pool and opens another has not bought a second
       * licence. Making them ask support to free a slot they can see is free
       * would be a support ticket for something obviously right.
       */
      await facilities.archive(tenant.facilityId);

      const replacement = await facilities.create({ name: 'Piscina Nova' });
      assert.ok(replacement.id);
    });
  });
});

test('the database refuses it even when nothing goes through the API', async () => {
  await withScratchTenant(async (tenant) => {
    await onePlan(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      /*
       * The case that produced this migration. A seed, a script or a migration
       * writing straight to the table gets the same answer as the endpoint —
       * which is the difference between a licence and a suggestion.
       */
      await assert.rejects(
        () =>
          tenant.sql(`INSERT INTO facility (organization_id, name) VALUES ($1, 'Por trás')`, [
            tenant.organizationId,
          ]),
        /facility_licence_exceeded/,
      );
    });
  });
});

test('un-archiving is an insert as far as the licence is concerned', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await tenant.sql('UPDATE organization SET max_facilities = 2 WHERE id = $1', [
        tenant.organizationId,
      ]);

      const second = await new FacilitiesController().create({ name: 'Piscina Norte' });
      await new FacilitiesController().archive(second.id);

      // Back to one live site of two allowed, so restoring it is fine.
      await tenant.sql('UPDATE facility SET archived_at = NULL WHERE id = $1', [second.id]);

      // Now the plan shrinks under them — two live sites, one allowed. The
      // existing rows stay; what is refused is bringing a third back to life.
      await tenant.sql('UPDATE organization SET max_facilities = 1 WHERE id = $1', [
        tenant.organizationId,
      ]);
      await new FacilitiesController().archive(second.id);

      await assert.rejects(
        () => tenant.sql('UPDATE facility SET archived_at = NULL WHERE id = $1', [second.id]),
        /facility_licence_exceeded/,
      );
    });
  });
});

test('an ordinary edit to a site that is already live is never refused', async () => {
  await withScratchTenant(async (tenant) => {
    await onePlan(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      // The trigger fires on `archived_at`, so renaming the one site a club has
      // must not trip a count that includes itself.
      await new FacilitiesController().update(tenant.facilityId, { name: 'Piscina Municipal' });

      const [row] = await tenant.sql<{ name: string }>(
        'SELECT name FROM facility WHERE id = $1',
        [tenant.facilityId],
      );
      assert.equal(row!.name, 'Piscina Municipal');
    });
  });
});
