import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';
import { OnboardingController } from './onboarding.controller.js';
import { startWizard } from './onboarding.repository.js';

/**
 * *Vamos começar* — POOLSE-229, QA 1–8, against the real database.
 *
 * Every item ticks from the club's data and un-ticks when the data goes; the
 * skipped setup steps appear only for a club whose wizard was offered; an older
 * club's row, made by a dismissal, never opens that wizard; and another club's
 * turmas and prices never count.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

async function done(tenant: ScratchTenant): Promise<Record<string, boolean>> {
  return actingAs(tenant, { roles: ['owner'] }, async () => {
    const { checklist } = await new OnboardingController().checklist();
    return Object.fromEntries((checklist?.items ?? []).map((item) => [item.key, item.done]));
  });
}

async function facilityOf(tenant: ScratchTenant): Promise<string> {
  const [site] = await tenant.sql<{ id: string }>(
    'SELECT id FROM facility WHERE organization_id = $1 AND archived_at IS NULL ORDER BY created_at LIMIT 1',
    [tenant.organizationId],
  );
  return site!.id;
}

test('POOLSE-229 — an older club sees the four standing items, each ticking from its data', async () => {
  await withScratchTenant(async (tenant) => {
    assert.deepEqual(await done(tenant), { turmas: false, prices: false, public_form: false, tour: false });
    const site = await facilityOf(tenant);

    // A turma in the published shared season.
    const [season] = await tenant.sql<{ id: string }>(
      `UPDATE season SET status = 'published'
        WHERE id = (SELECT id FROM season WHERE organization_id = $1 AND archived_at IS NULL AND sport_id IS NULL
                     ORDER BY created_at LIMIT 1)
        RETURNING id`,
      [tenant.organizationId],
    );
    const [turma] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, name, season_id, facility_id) VALUES ($1, 'Golfinhos', $2, $3) RETURNING id`,
      [tenant.organizationId, season!.id, site],
    );
    await tenant.sql(
      `INSERT INTO fee_plan (organization_id, facility_id, kind, amount_cents) VALUES ($1, $2, 'quota', 3500)`,
      [tenant.organizationId, site],
    );
    await tenant.sql('UPDATE organization SET public_registration_open = true WHERE id = $1', [tenant.organizationId]);
    assert.deepEqual(await done(tenant), { turmas: true, prices: true, public_form: true, tour: false });

    // Live data, not a stored tick: the only turma archived opens its item again.
    await tenant.sql('UPDATE class_group SET archived_at = now() WHERE id = $1', [turma!.id]);
    await tenant.sql('UPDATE organization SET public_registration_open = false WHERE id = $1', [tenant.organizationId]);
    const after = await done(tenant);
    assert.equal(after['turmas'], false);
    assert.equal(after['public_form'], false);
  });
});

test('POOLSE-229 — skipped setup steps join the list, and tick from their own data', async () => {
  await withScratchTenant(async (tenant) => {
    await startWizard(tenant.organizationId, tenant.ownerMembershipId);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const onboarding = new OnboardingController();
      for (const step of ['club', 'places', 'team', 'import'] as const) await onboarding.step({ step, outcome: 'skipped' });
    });
    const before = await done(tenant);
    assert.deepEqual(Object.keys(before), [
      'club_details',
      'places',
      'team',
      'students',
      'turmas',
      'prices',
      'public_form',
      'tour',
    ]);
    assert.ok(Object.values(before).every((value) => !value));

    const site = await facilityOf(tenant);
    await tenant.sql(`UPDATE organization SET vat_number = '501964843' WHERE id = $1`, [tenant.organizationId]);
    await tenant.sql(`UPDATE facility SET address = 'Rua da Piscina, 1' WHERE id = $1`, [site]);
    await tenant.sql(`INSERT INTO pool (organization_id, facility_id, name, kind) VALUES ($1, $2, 'Tanque', 'indoor')`, [
      tenant.organizationId,
      site,
    ]);
    // A pool with the seeded "open, all day" hours is not yet a place set up.
    assert.equal((await done(tenant))['places'], false);
    await tenant.sql(`UPDATE facility_hours SET opens_at = '07:00' WHERE facility_id = $1 AND weekday = 1`, [site]);
    await addMember(tenant, 'Ines', 'Instrutora', ['instructor']);
    await tenant.sql(`INSERT INTO student (organization_id, first_name, last_name) VALUES ($1, 'Tomas', 'Aluno')`, [
      tenant.organizationId,
    ]);
    await tenant.sql(
      `UPDATE onboarding_progress SET tour_finished_at = now() WHERE organization_id = $1 AND membership_id = $2`,
      [tenant.organizationId, tenant.ownerMembershipId],
    );

    const after = await done(tenant);
    for (const key of ['club_details', 'places', 'team', 'students', 'tour']) assert.equal(after[key], true, key);
  });
});

test('POOLSE-229 — the Owner dismisses, an Admin reads; a dismissal never opens the wizard', async () => {
  await withScratchTenant(async (tenant) => {
    const admin = await addMember(tenant, 'Alda', 'Admin', ['admin']);
    const coach = await addMember(tenant, 'Caio', 'Coach', ['instructor']);
    const parent = await addMember(tenant, 'Paula', 'Mae', ['guardian']);
    const onboarding = new OnboardingController();

    await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, async () => {
      const read = await onboarding.checklist();
      assert.equal(read.canDismiss, false);
      assert.ok(read.checklist !== null);
      await expectStatus(() => onboarding.dismissChecklist({ dismissed: true }), 403);
    });
    for (const [membershipId, role] of [
      [coach, 'instructor'],
      [parent, 'guardian'],
    ] as const) {
      await actingAs(tenant, { membershipId, roles: [role] }, async () => {
        await expectStatus(() => onboarding.checklist(), 403);
        await expectStatus(() => onboarding.dismissChecklist({ dismissed: true }), 403);
      });
    }

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await expectStatus(() => onboarding.dismissChecklist({ dismissed: 'yes' }), 400);
      // A membership id in the body reaches nobody else's row.
      await onboarding.dismissChecklist({ dismissed: true, membershipId: admin });
      const read = await onboarding.checklist();
      assert.equal(read.checklist?.dismissed, true);
      // The row a dismissal made is wizard-less: an older club stays without setup steps.
      assert.deepEqual(await onboarding.read(), { wizard: null });
      await onboarding.dismissChecklist({ dismissed: false });
      assert.equal((await onboarding.checklist()).checklist?.dismissed, false);
    });

    const rows = await tenant.sql<{ membership_id: string }>(
      'SELECT membership_id FROM onboarding_progress WHERE organization_id = $1',
      [tenant.organizationId],
    );
    assert.deepEqual(
      rows.map((row) => row.membership_id),
      [tenant.ownerMembershipId],
    );
  });
});

test('POOLSE-229 — another club’s turmas and prices never tick this one', async () => {
  await withScratchTenant(async (mine) => {
    await withScratchTenant(async (theirs) => {
      const site = await facilityOf(theirs);
      await theirs.sql(
        `INSERT INTO fee_plan (organization_id, facility_id, kind, amount_cents) VALUES ($1, $2, 'quota', 3500)`,
        [theirs.organizationId, site],
      );
      await theirs.sql('UPDATE organization SET public_registration_open = true WHERE id = $1', [theirs.organizationId]);
      const ours = await done(mine);
      assert.equal(ours['prices'], false);
      assert.equal(ours['public_form'], false);
      assert.equal((await done(theirs))['prices'], true);
    });
  });
});

test('POOLSE-230 — any member records their own tour; a replay changes nothing; no wizard appears', async () => {
  await withScratchTenant(async (tenant) => {
    const parent = await addMember(tenant, 'Paula', 'Mae', ['guardian']);
    const coach = await addMember(tenant, 'Caio', 'Coach', ['instructor']);
    const onboarding = new OnboardingController();

    await actingAs(tenant, { membershipId: parent, roles: ['guardian'] }, async () => {
      await expectStatus(() => onboarding.tour({ outcome: 'done' }), 400);
      // A membership id in the body reaches nobody else's row.
      await onboarding.tour({ outcome: 'finished', membershipId: coach });
    });
    const [first] = await tenant.sql<{ membership_id: string; at: Date; wizard: Date | null }>(
      `SELECT membership_id, tour_finished_at AS at, wizard_started_at AS wizard
         FROM onboarding_progress WHERE organization_id = $1`,
      [tenant.organizationId],
    );
    assert.equal(first?.membership_id, parent);
    assert.equal(first?.wizard, null);

    // A replay, finished or closed early, keeps the first finish.
    await actingAs(tenant, { membershipId: parent, roles: ['guardian'] }, async () => {
      await onboarding.tour({ outcome: 'finished' });
      await onboarding.tour({ outcome: 'dismissed' });
    });
    const rows = await tenant.sql<{ at: Date; closed: Date | null }>(
      `SELECT tour_finished_at AS at, tour_dismissed_at AS closed FROM onboarding_progress WHERE organization_id = $1`,
      [tenant.organizationId],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.at.getTime(), first!.at.getTime());
    assert.ok(rows[0]!.closed !== null);
  });
});

test('POOLSE-229 second pass — a club that had the setup lists its four setup lines, skipped or not', async () => {
  await withScratchTenant(async (tenant) => {
    await startWizard(tenant.organizationId, tenant.ownerMembershipId);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const onboarding = new OnboardingController();
      for (const step of ['club', 'places', 'team', 'import'] as const) await onboarding.step({ step, outcome: 'done' });
    });
    const lines = await done(tenant);
    for (const key of ['club_details', 'places', 'team', 'students']) assert.equal(lines[key], false, key);
  });
});
