import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { OrganizationsController } from './organizations.controller.js';
import { listMemberships } from '../identity/identity.repository.js';
import { authStorage } from '../auth/auth.context.js';
import { withOrg } from '@poolse/db';
import {
  closeHarness,
  expectStatus,
  removeAppUser,
  removeTenant,
  withoutTenantScope,
} from '../test/harness.js';

/**
 * Signing up for one's own pool — slice 4.5.
 *
 * Every other integration test provisions its tenant through the harness. This
 * one goes through the controller, because the controller is what is under
 * test: the kind it parses, the default it falls back to, and what the new
 * tenant opens with. `docs/data-model.md`, decision 1 — a personal user is their
 * own organization, and this is the proof that nothing about that is special.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

let count = 0;

/**
 * An app_user with no organization, as the dashboard's create form sees them.
 *
 * Provisioned directly rather than through the Clerk API, which `ensureAppUser`
 * would otherwise call for an id it does not know.
 */
async function signedUpUser(): Promise<string> {
  count += 1;
  const clerkUserId = `user_test_signup_${process.pid}_${count}_${Math.floor(performance.now())}`;
  await withoutTenantScope(async (tx) => {
    await tx.query(`SELECT provision_app_user($1, $2, 'Ana', 'Lopes', NULL, now())`, [
      clerkUserId,
      `${clerkUserId}@example.test`,
    ]);
  });
  return clerkUserId;
}

/** Runs `fn` as a signed-in person who belongs to no organization yet. */
function asSignedIn<T>(clerkUserId: string, fn: () => Promise<T>): Promise<T> {
  return authStorage.run({ clerkUserId, sessionId: `sess_${clerkUserId}` } as never, fn);
}

test('4.5 — a personal signup opens with a pool, and /me says which kind it is', async () => {
  const clerkUserId = await signedUpUser();
  let organizationId: string | null = null;

  try {
    const created = await asSignedIn(clerkUserId, () =>
      new OrganizationsController().create({ name: 'Piscina de casa', kind: 'personal' }),
    );
    organizationId = created.organizationId;

    assert.ok(created.poolId, 'a personal tenant opens with its pool already there');

    const memberships = await listMemberships(clerkUserId);
    assert.equal(memberships.length, 1);
    assert.equal(memberships[0]?.organizationKind, 'personal');
    assert.deepEqual(memberships[0]?.roles, ['owner']);

    // Inside the tenant, because a read outside it returns nothing — which the
    // first run of this test proved, as the isolation suite promises.
    const [pool] = await withOrg(created.organizationId, async (tx) =>
      (
        await tx.query<{ name: string; facility_id: string; seasons: number }>(
          `SELECT p.name, p.facility_id,
                  (SELECT count(*)::int FROM season s WHERE s.organization_id = p.organization_id) AS seasons
             FROM pool p WHERE p.id = $1 AND p.organization_id = $2`,
          [created.poolId, created.organizationId],
        )
      ).rows,
    );
    assert.equal(pool?.name, 'Piscina de casa', 'named like the site, which is named like the tenant');
    assert.equal(pool?.facility_id, created.facilityId);
    assert.equal(pool?.seasons, 0, 'a season is a turmas concept and there are none');
  } finally {
    if (organizationId !== null) await removeTenant(organizationId, clerkUserId);
  }
});

test('4.5 — no kind means a club, exactly as every caller before this slice expects', async () => {
  const clerkUserId = await signedUpUser();
  let organizationId: string | null = null;

  try {
    const created = await asSignedIn(clerkUserId, () =>
      new OrganizationsController().create({ name: 'Clube de Bairro' }),
    );
    organizationId = created.organizationId;

    assert.equal(created.poolId, null, 'a club describes its own tanks');
    const memberships = await listMemberships(clerkUserId);
    assert.equal(memberships[0]?.organizationKind, 'business');
  } finally {
    if (organizationId !== null) await removeTenant(organizationId, clerkUserId);
  }
});

test('4.5 — a kind that is neither is refused, not coerced', async () => {
  const clerkUserId = await signedUpUser();

  try {
    await expectStatus(
      () =>
        asSignedIn(clerkUserId, () =>
          new OrganizationsController().create({ name: 'Algo', kind: 'hotel' }),
        ),
      400,
    );
  } finally {
    await removeAppUser(clerkUserId);
  }
});
