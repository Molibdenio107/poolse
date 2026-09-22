import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { actingAs, closeHarness, withScratchTenant, type ScratchTenant } from '../test/harness.js';
import { DashboardController } from './dashboard.controller.js';
import type { Dashboard } from './compose.js';
import type { ChecklistWidget, SubscriptionWidget, TasksWidget } from './resolvers.js';

/**
 * The dashboard endpoint, against a real club — POOLSE-66, slice 1.
 *
 * `compose.test.ts` proves what the page does when a widget misbehaves and
 * `widget-registry.test.ts` proves the gating, both without a database. What is
 * left for this file is the half neither can reach: that the endpoint actually
 * *uses* them, that a resolver's data is this club's and not another's, and that
 * the payload of somebody who may not see a widget does not contain it — asserted
 * on the raw JSON, because "absent from the payload" is the promise and a shape
 * assertion would pass on a widget that was merely blank.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

const controller = new DashboardController();

after(async () => {
  await closeHarness();
});

function card(page: Dashboard, id: string): { state: string; data: unknown } | undefined {
  return page.bands.flatMap((band) => band.widgets).find((one) => one.id === id);
}

function ids(page: Dashboard): string[] {
  return page.bands.flatMap((band) => band.widgets.map((one) => one.id));
}

async function addTask(tenant: ScratchTenant, title: string): Promise<void> {
  await tenant.sql(
    `INSERT INTO maintenance_task (organization_id, facility_id, title, interval_days)
          VALUES ($1, $2, $3, 30)`,
    [tenant.organizationId, tenant.facilityId, title],
  );
}

test('66.1 — an owner gets both bands, in order, each widget once', async () => {
  await withScratchTenant(async (tenant) => {
    await addTask(tenant, 'Verificar filtros');

    const page = await actingAs(tenant, { roles: ['owner'] }, () => controller.read());

    assert.deepEqual(
      page.bands.map((band) => band.id),
      ['management', 'operational'],
      'the personal band is absent, not empty — the owner holds no role in it',
    );
    assert.deepEqual(
      page.bands.map((band) => band.order),
      [0, 1],
    );

    const all = ids(page);
    assert.equal(new Set(all).size, all.length, 'no widget twice');

    /*
     * A scratch tenant is provisioned on a trial, so the subscription widget has
     * something true to say — and it says it from `readSubscription`, the same
     * function `/subscription` answers from, so the two cannot disagree.
     */
    const subscription = card(page, 'mgmt.subscription');
    assert.equal(subscription?.state, 'ok');
    const data = subscription?.data as SubscriptionWidget;
    assert.equal(data.status, 'trialing');
    assert.ok((data.trialDaysLeft ?? 0) > 0, 'a fresh trial has days left');

    const tasks = card(page, 'maint.mytasks');
    assert.equal(tasks?.state, 'ok');
    assert.equal((tasks?.data as TasksWidget).total, 1);

    // The club has a site, so the onboarding checklist is not on the page.
    assert.equal(card(page, 'setup.checklist'), undefined);
  });
});

test('66.2 — an instructor’s payload contains no mgmt key whatsoever', async () => {
  await withScratchTenant(async (tenant) => {
    await addTask(tenant, 'Limpar balneário');

    const page = await actingAs(tenant, { roles: ['instructor'] }, () => controller.read());

    /*
     * On the raw JSON, deliberately. "A widget you may not see is absent from
     * the payload" is the promise the registry makes, and an assertion about the
     * *shape* would pass just as well against a widget that was sent blank —
     * which is the thing this is meant to make impossible.
     */
    assert.ok(!JSON.stringify(page).includes('"mgmt.'), 'no management widget reached the wire');

    assert.deepEqual(
      page.bands.map((band) => band.id),
      ['operational'],
      'and the operational band is at the top, because it is the only one',
    );
    assert.deepEqual(ids(page), ['maint.mytasks']);

    // The selector is the management band's control, so its list is not sent.
    assert.deepEqual(page.scope.facilities, []);
  });
});

test('66.3 — a student gets a page with no bands at all', async () => {
  await withScratchTenant(async (tenant) => {
    await addTask(tenant, 'Testar cloro');

    const page = await actingAs(tenant, { roles: ['student'] }, () => controller.read());

    assert.deepEqual(page.bands, []);
    const json = JSON.stringify(page);
    assert.ok(!json.includes('"mgmt.'));
    assert.ok(!json.includes('"maint.'));
    assert.ok(!json.includes('"inst.'));
  });
});

test('66.4 — a resolver answers about this club and no other', async () => {
  await withScratchTenant(async (mine) => {
    await withScratchTenant(async (theirs) => {
      await addTask(mine, 'A minha');
      await addTask(theirs, 'A deles');
      await addTask(theirs, 'A deles também');

      const page = await actingAs(mine, { roles: ['owner'] }, () => controller.read());
      const tasks = card(page, 'maint.mytasks')?.data as TasksWidget;

      assert.equal(tasks.total, 1, 'one task, and it is this club’s');

      const theirPage = await actingAs(theirs, { roles: ['owner'] }, () => controller.read());
      assert.equal((card(theirPage, 'maint.mytasks')?.data as TasksWidget).total, 2);
    });
  });
});

test('66.5 — nothing outstanding is empty, and empty is still a card', async () => {
  await withScratchTenant(async (tenant) => {
    const page = await actingAs(tenant, { roles: ['maintenance'] }, () => controller.read());

    const tasks = card(page, 'maint.mytasks');
    assert.equal(tasks?.state, 'empty', 'not error, and not missing');
    assert.equal(tasks?.data, null);

    /*
     * A maintenance-only reader holds nothing in the management band, so it is
     * absent — which also means their one band is the first thing on the page.
     */
    assert.deepEqual(
      page.bands.map((band) => band.id),
      ['operational'],
    );
  });
});

test('66.6 — a club with no sites is told what to do, and nothing else', async () => {
  await withScratchTenant(async (tenant) => {
    await tenant.sql('UPDATE facility SET archived_at = now() WHERE organization_id = $1', [
      tenant.organizationId,
    ]);

    const page = await actingAs(tenant, { roles: ['owner'] }, () => controller.read());

    assert.deepEqual(ids(page), ['setup.checklist'], 'no empty cards beside it');

    const steps = (card(page, 'setup.checklist')?.data as ChecklistWidget).steps;
    assert.deepEqual(
      steps.map((step) => step.id),
      ['facility', 'pools', 'prices', 'staff', 'students'],
    );
    assert.equal(steps[0]!.done, false, 'there is no site');
    assert.equal(
      steps.find((step) => step.id === 'staff')!.done,
      false,
      'the founder alone is not staff — a step that is already ticked says nothing',
    );
  });
});

test('66.7 — the selector: a stranger’s site is a 404, a mistyped one is ignored', async () => {
  await withScratchTenant(async (mine) => {
    await withScratchTenant(async (theirs) => {
      await actingAs(mine, { roles: ['owner'] }, async () => {
        const all = await controller.read();
        assert.equal(all.scope.mode, 'all');
        assert.equal(all.scope.facilityId, null);
        assert.equal(all.scope.facilities.length, 1);

        const one = await controller.read(mine.facilityId);
        assert.equal(one.scope.mode, 'facility');
        assert.equal(one.scope.facilityId, mine.facilityId);

        /*
         * Malformed is no filter at all: it arrives from a link or a bookmark,
         * and a mistyped one should show the club rather than an error page —
         * the reading `/platform/tenants` already takes for its own filter.
         */
        for (const nonsense of ['', '  ', 'todas', 'null', '42']) {
          const page = await controller.read(nonsense);
          assert.equal(page.scope.mode, 'all', `"${nonsense}" is not a filter`);
        }

        /*
         * A well-formed uuid this club does not have is a different question —
         * not a typo but somebody else's site — and answering it with "here is
         * everything instead" would quietly widen what was asked for.
         */
        await assert.rejects(
          () => controller.read(theirs.facilityId),
          (error: { status?: number }) => error.status === 404,
        );
      });
    });
  });
});
