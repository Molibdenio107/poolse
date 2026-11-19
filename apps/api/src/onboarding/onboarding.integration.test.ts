import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { withOrg } from '@poolse/db';
import { authStorage } from '../auth/auth.context.js';
import { OrganizationsController } from '../organizations/organizations.controller.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  removeTenant,
  withScratchTenant,
  withoutTenantScope,
} from '../test/harness.js';
import { OnboardingController } from './onboarding.controller.js';
import { readWizard, startWizard } from './onboarding.repository.js';

/**
 * The Owner's setup steps — POOLSE-228, QA 1, 7, 8, 9 and 10.
 *
 * A club made through `POST /organizations` opens on the wizard; a club made any
 * other way (the harness, like the pilot before this ticket) never does. The
 * pointer moves only for the Owner, only on their own row.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

let count = 0;

async function signedUpUser(): Promise<string> {
  count += 1;
  const clerkUserId = `user_test_onboard_${process.pid}_${count}_${Math.floor(performance.now())}`;
  await withoutTenantScope(async (tx) => {
    await tx.query(`SELECT provision_app_user($1, $2, 'Olga', 'Dona', NULL, now())`, [
      clerkUserId,
      `${clerkUserId}@example.test`,
    ]);
  });
  return clerkUserId;
}

function asSignedIn<T>(clerkUserId: string, fn: () => Promise<T>): Promise<T> {
  return authStorage.run({ clerkUserId, sessionId: `sess_${clerkUserId}` } as never, fn);
}

test('POOLSE-228 — a club made from now on opens on the wizard; a personal pool never does', async () => {
  for (const kind of ['business', 'personal'] as const) {
    const clerkUserId = await signedUpUser();
    let organizationId: string | null = null;
    try {
      const made = await asSignedIn(clerkUserId, () =>
        new OrganizationsController().create({ name: `Clube ${kind}`, kind }, { headers: {} } as never),
      );
      organizationId = made.organizationId;
      const wizard = await readWizard(made.organizationId, made.membershipId);
      if (kind === 'business') assert.deepEqual(wizard, { step: 'club', skipped: [], finished: false });
      else assert.equal(wizard, null);
    } finally {
      if (organizationId !== null) await removeTenant(organizationId, clerkUserId);
    }
  }
});

test('POOLSE-228 — a club from before has no wizard, and nothing makes one', async () => {
  await withScratchTenant(async (tenant) => {
    const onboarding = new OnboardingController();
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      assert.deepEqual(await onboarding.read(), { wizard: null });
      await expectStatus(() => onboarding.step({ step: 'club', outcome: 'skipped' }), 404);
    });
    const [row] = await tenant.sql<{ n: number }>(
      'SELECT count(*)::int AS n FROM onboarding_progress WHERE organization_id = $1',
      [tenant.organizationId],
    );
    assert.equal(row?.n, 0);
  });
});

test('POOLSE-228 — every step skippable, resumable, and finished after the last', async () => {
  await withScratchTenant(async (tenant) => {
    await startWizard(tenant.organizationId, tenant.ownerMembershipId);
    const onboarding = new OnboardingController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      let { wizard } = await onboarding.step({ step: 'club', outcome: 'skipped' });
      assert.deepEqual(wizard, { step: 'places', skipped: ['club'], finished: false });

      // Resumable: what was saved is what a later read opens.
      assert.deepEqual((await onboarding.read()).wizard, wizard);

      ({ wizard } = await onboarding.step({ step: 'places', outcome: 'done' }));
      assert.equal(wizard.step, 'team');

      // Voltar to a skipped step, then done: it leaves the skipped list.
      ({ wizard } = await onboarding.step({ step: 'club', outcome: 'open' }));
      assert.equal(wizard.step, 'club');
      ({ wizard } = await onboarding.step({ step: 'club', outcome: 'done' }));
      assert.deepEqual(wizard, { step: 'places', skipped: [], finished: false });

      await onboarding.step({ step: 'team', outcome: 'skipped' });
      ({ wizard } = await onboarding.step({ step: 'import', outcome: 'done' }));
      assert.deepEqual(wizard, { step: null, skipped: ['team'], finished: true });

      // Finished is finished: nothing reopens it.
      await expectStatus(() => onboarding.step({ step: 'club', outcome: 'open' }), 404);
    });
  });
});

test('POOLSE-228 — only the Owner, only their own row, only known steps', async () => {
  await withScratchTenant(async (tenant) => {
    await startWizard(tenant.organizationId, tenant.ownerMembershipId);
    const admin = await addMember(tenant, 'Alda', 'Admin', ['admin']);
    const coach = await addMember(tenant, 'Caio', 'Coach', ['instructor']);
    const parent = await addMember(tenant, 'Paula', 'Mae', ['guardian']);
    const onboarding = new OnboardingController();

    for (const [membershipId, roles] of [
      [admin, ['admin']],
      [coach, ['instructor']],
      [parent, ['guardian']],
    ] as const) {
      await actingAs(tenant, { membershipId, roles: [...roles] }, async () => {
        await expectStatus(() => onboarding.read(), 403);
        await expectStatus(() => onboarding.step({ step: 'club', outcome: 'skipped' }), 403);
      });
    }

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await expectStatus(() => onboarding.step({ step: 'pool', outcome: 'done' }), 400);
      await expectStatus(() => onboarding.step({ step: 'club', outcome: 'finish' }), 400);
      // A membership id in the body is not a way to reach anybody else's row.
      await onboarding.step({ step: 'club', outcome: 'skipped', membershipId: admin, organizationId: 'x' });
    });

    const rows = await withOrg(tenant.organizationId, async (tx) =>
      (
        await tx.query<{ membership_id: string; skipped: string[] }>(
          'SELECT membership_id, wizard_skipped::text[] AS skipped FROM onboarding_progress',
        )
      ).rows,
    );
    assert.deepEqual(rows, [{ membership_id: tenant.ownerMembershipId, skipped: ['club'] }]);
  });
});

test('POOLSE-228 second pass — the menus wait for the setup, and Ir para o painel brings them back', async () => {
  const { guidedSetupFor } = await import('../identity/details-gate.js');
  await withScratchTenant(async (tenant) => {
    const admin = await addMember(tenant, 'Alda', 'Admin', ['admin']);
    const summary = (membershipId: string, roles: string[]): never =>
      ({ organizationId: tenant.organizationId, membershipId, roles, view: null, supportExpiresAt: null }) as never;
    const onboarding = new OnboardingController();

    // An older club: no setup, menus as always.
    assert.equal(await guidedSetupFor(summary(tenant.ownerMembershipId, ['owner'])), false);

    await startWizard(tenant.organizationId, tenant.ownerMembershipId);
    assert.equal(await guidedSetupFor(summary(tenant.ownerMembershipId, ['owner'])), true);
    // Only the Owner is guided; an Admin keeps the menus and cannot hide or show them.
    assert.equal(await guidedSetupFor(summary(admin, ['admin'])), false);
    await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, async () => {
      await expectStatus(() => onboarding.menus(), 403);
    });

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      assert.deepEqual(await onboarding.menus(), { menusShown: true });
    });
    assert.equal(await guidedSetupFor(summary(tenant.ownerMembershipId, ['owner'])), false);
  });

  // Finishing the setup brings them back without the button.
  await withScratchTenant(async (tenant) => {
    await startWizard(tenant.organizationId, tenant.ownerMembershipId);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const onboarding = new OnboardingController();
      for (const step of ['club', 'places', 'team', 'import'] as const) await onboarding.step({ step, outcome: 'done' });
    });
    assert.equal(
      await guidedSetupFor({
        organizationId: tenant.organizationId,
        membershipId: tenant.ownerMembershipId,
        roles: ['owner'],
        view: null,
        supportExpiresAt: null,
      } as never),
      false,
    );
  });
});
