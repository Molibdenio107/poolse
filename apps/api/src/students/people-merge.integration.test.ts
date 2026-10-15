import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { PeopleDedupController } from './students.controller.js';
import { withoutTenantScope, type Tx } from '@poolse/db';
import { actingAs, addMember, closeHarness, expectStatus, removeAppUser, withScratchTenant } from '../test/harness.js';

/**
 * Merging two records of one person — run as the app's own login.
 *
 * The SQL test of `merge_memberships` runs as the database owner, so nothing
 * had ever run it as `poolse_app` (sweep of 15-10-2026). These do: an ordinary
 * duplicate merges, and the two merges that are not a duplicate at all are
 * refused — absorbing the Owner, which would hand an Admin the club, and
 * absorbing somebody with a login of their own.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

test('an admin merges two records of one person, as the app login', async () => {
  await withScratchTenant(async (tenant) => {
    const admin = await addMember(tenant, 'Carla', 'Admin', ['admin']);
    const keep = await addMember(tenant, 'Ana', 'Ribeiro', ['instructor']);
    const absorb = await addMember(tenant, 'Ana', 'Ribeiro', ['maintenance']);

    await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, async () => {
      const result = await new PeopleDedupController().merge({ keepId: keep, absorbId: absorb });
      assert.equal(result.merged, true);
    });

    const roles = await tenant.sql<{ role: string }>(
      `SELECT role::text AS role FROM membership_role
        WHERE membership_id = $1 AND archived_at IS NULL ORDER BY role`,
      [keep],
    );
    assert.deepEqual(roles.map((r) => r.role), ['instructor', 'maintenance']);
  });
});

test("an admin cannot absorb the Owner's record and become Owner", async () => {
  await withScratchTenant(async (tenant) => {
    const admin = await addMember(tenant, 'Carla', 'Admin', ['admin']);

    await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, async () => {
      await expectStatus(
        () => new PeopleDedupController().merge({ keepId: admin, absorbId: tenant.ownerMembershipId }),
        409,
      );
    });

    const [owner] = await tenant.sql<{ membership_id: string }>(
      `SELECT membership_id FROM membership_role WHERE role = 'owner' AND archived_at IS NULL
          AND membership_id IN (SELECT id FROM membership WHERE organization_id = $1)`,
      [tenant.organizationId],
    );
    assert.equal(owner?.membership_id, tenant.ownerMembershipId, 'the Owner is still the Owner');
  });
});

test('two records that each have their own login are not a duplicate to merge', async () => {
  await withScratchTenant(async (tenant) => {
    const admin = await addMember(tenant, 'Carla', 'Admin', ['admin']);
    const other = await addMember(tenant, 'Rui', 'Outro', ['instructor']);
    // Give both a login of their own, the way sign-up does.
    const clerks: string[] = [];
    for (const [membershipId, clerk] of [[admin, 'user_merge_a'], [other, 'user_merge_b']] as const) {
      const clerkUserId = `${clerk}_${tenant.organizationId.slice(0, 8)}`;
      clerks.push(clerkUserId);
      const appUserId = await withoutTenantScope(async (tx: Tx) => {
        const { rows } = await tx.query<{ id: string }>(
          `SELECT provision_app_user($1, $2, 'Teste', 'Merge', NULL, now()) AS id`,
          [clerkUserId, `${clerkUserId}@example.test`],
        );
        return rows[0]!.id;
      });
      await tenant.sql(
        `UPDATE membership SET app_user_id = $2, first_name = NULL, last_name = NULL, email = NULL WHERE id = $1`,
        [membershipId, appUserId],
      );
    }

    await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, async () => {
      await expectStatus(() => new PeopleDedupController().merge({ keepId: admin, absorbId: other }), 409);
    });

    // The tenant teardown removes memberships; the logins are ours to remove.
    await tenant.sql(
      'UPDATE membership SET app_user_id = NULL, first_name = $2, last_name = $2 WHERE id = ANY($1)',
      [[admin, other], 'Teste'],
    );
    for (const clerkUserId of clerks) await removeAppUser(clerkUserId);
  });
});
