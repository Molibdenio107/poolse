import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { SpacesController } from './spaces.controller.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * Espaços, cleanings and issues — the permission matrix and the overdue rule.
 *
 * Three tiers rather than the usual two, and the middle one is the reason this
 * file exists. *Logging a cleaning and reporting a fault are open to every
 * management login*, including instructors and maintenance, because they are the
 * people actually in the building. *Resolving* is narrower — owner, admin,
 * maintenance — because closing somebody's report is a judgement that the work
 * was done, not a note that it was noticed.
 *
 * An instructor who can report but not resolve is the exact pair most likely to
 * be flattened into one `requireRole` by a later change, so both halves are
 * asserted against the same fixture.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

const controller = new SpacesController();

test('a space is created, listed, and carries its schedule', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { id } = await controller.create({
        facilityId: tenant.facilityId,
        name: 'Balneário Masculino',
        type: 'changing_room',
        intervalHours: 24,
      });

      const list = await controller.list(tenant.facilityId);
      assert.equal(list.items.length, 1);

      const space = list.items[0]!;
      assert.equal(space.id, id);
      assert.equal(space.name, 'Balneário Masculino');
      assert.equal(space.intervalHours, 24);

      /*
       * Never cleaned, with a schedule set, is overdue — not blank. A balneário
       * nobody has ever cleaned is the most overdue thing on the site, and
       * treating an absence of history as "fine" would hide exactly the spaces
       * this feature exists to surface.
       */
      assert.equal(space.lastCleanedAt, null);
      assert.equal(space.overdue, true);
      assert.equal(space.openIssues, 0);
    });
  });
});

test('no schedule is never overdue, and out of service is never overdue', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      // Null interval: not measured, enforces nothing — the same rule a null
      // tank ceiling follows.
      await controller.create({
        facilityId: tenant.facilityId,
        name: 'Parque',
        type: 'outdoor',
      });

      // Out of service, with a schedule. Nobody cleans a room that is shut.
      await controller.create({
        facilityId: tenant.facilityId,
        name: 'Balneário Feminino',
        type: 'changing_room',
        intervalHours: 1,
        active: false,
      });

      const list = await controller.list(tenant.facilityId);
      for (const space of list.items) {
        assert.equal(space.overdue, false, `${space.name} should not be overdue`);
      }
    });
  });
});

test('an instructor may clean and report, and may not resolve', async () => {
  await withScratchTenant(async (tenant) => {
    let spaceId = '';

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const created = await controller.create({
        facilityId: tenant.facilityId,
        name: 'Sala de Máquinas',
        type: 'technical',
        intervalHours: 168,
      });
      spaceId = created.id;
    });

    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      // Both allowed: the instructor is the person who found the problem.
      await controller.clean(spaceId, { note: 'Chão lavado' });
      await controller.report(spaceId, {
        type: 'fault',
        description: 'A bomba faz um ruído estranho',
      });

      const detail = await controller.detail(spaceId);
      assert.equal(detail.cleanings.items.length, 1);
      assert.equal(detail.issues.length, 1);

      // What the screen is told matches what the guards will do.
      assert.equal(detail.canLog, true);
      assert.equal(detail.canResolve, false);
      assert.equal(detail.canManage, false);

      const issueId = detail.issues[0]!.id;
      await expectStatus(() => controller.resolve(spaceId, issueId, {}), 403);

      // And an instructor may not delete anything, per the standing rule.
      await expectStatus(() => controller.archive(spaceId), 403);
      await expectStatus(
        () => controller.removeCleaning(spaceId, detail.cleanings.items[0]!.id),
        403,
      );
    });
  });
});

test('a student may not log, report or read the club through this route', async () => {
  await withScratchTenant(async (tenant) => {
    let spaceId = '';

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const created = await controller.create({
        facilityId: tenant.facilityId,
        name: 'Receção',
        type: 'reception',
      });
      spaceId = created.id;
    });

    await actingAs(tenant, { roles: ['student'] }, async () => {
      await expectStatus(() => controller.clean(spaceId, {}), 403);
      await expectStatus(
        () => controller.report(spaceId, { type: 'fault', description: 'Porta' }),
        403,
      );
      await expectStatus(() => controller.create({ facilityId: tenant.facilityId, name: 'X' }), 403);
    });
  });
});

test('maintenance resolves; a second resolve is refused rather than re-stamped', async () => {
  await withScratchTenant(async (tenant) => {
    let spaceId = '';
    let issueId = '';

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const created = await controller.create({
        facilityId: tenant.facilityId,
        name: 'Arrecadação',
        type: 'storage',
      });
      spaceId = created.id;
      await controller.report(spaceId, { type: 'restock', description: 'Faltam sacos' });
      issueId = (await controller.detail(spaceId)).issues[0]!.id;
    });

    await actingAs(tenant, { roles: ['maintenance'] }, async () => {
      await controller.resolve(spaceId, issueId, { note: 'Repostos' });

      const detail = await controller.detail(spaceId);
      const issue = detail.issues[0]!;
      assert.equal(issue.status, 'resolved');
      assert.notEqual(issue.resolvedAt, null);
      assert.notEqual(issue.resolvedBy, null);
      assert.equal(issue.resolutionNote, 'Repostos');

      /*
       * 409, not a silent second write. Two people close the same fault from two
       * phones; the second must not quietly rewrite who fixed it and when.
       */
      await expectStatus(() => controller.resolve(spaceId, issueId, {}), 409);
    });
  });
});

test('deleting the only cleaning puts the space back to overdue', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { id } = await controller.create({
        facilityId: tenant.facilityId,
        name: 'Balneário',
        type: 'changing_room',
        intervalHours: 24,
      });

      await controller.clean(id, {});
      assert.equal((await controller.detail(id)).space.overdue, false);

      const cleaningId = (await controller.detail(id)).cleanings.items[0]!.id;
      await controller.removeCleaning(id, cleaningId);

      /*
       * The rule the whole feature rests on. An archived log did not happen, so
       * a space whose only cleaning was deleted is overdue again — if it still
       * looked clean, correcting a mistake would hide a dirty room.
       */
      const after = await controller.detail(id);
      assert.equal(after.cleanings.items.length, 0);
      assert.equal(after.space.lastCleanedAt, null);
      assert.equal(after.space.overdue, true);
    });
  });
});

test('the server owns who cleaned and when; the client cannot say', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { id } = await controller.create({
        facilityId: tenant.facilityId,
        name: 'Balneário',
        type: 'changing_room',
      });

      // Extra fields are simply not read: `clean` takes a note and nothing else.
      await controller.clean(id, {
        note: 'ok',
        performedBy: 'somebody-else',
        performedAt: '2001-01-01T00:00:00Z',
      } as { note?: unknown });

      const [row] = await tenant.sql<{ performed_by: string; performed_at: Date }>(
        'SELECT performed_by, performed_at FROM cleaning_log WHERE space_id = $1',
        [id],
      );

      assert.equal(row!.performed_by, tenant.ownerMembershipId);
      assert.ok(
        row!.performed_at.getUTCFullYear() > 2020,
        'the client backdated the cleaning',
      );
    });
  });
});

test('a blank name, a bad type and a zero interval are all refused', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await expectStatus(
        () => controller.create({ facilityId: tenant.facilityId, name: '   ' }),
        400,
      );
      await expectStatus(
        () => controller.create({ facilityId: tenant.facilityId, name: 'X', type: 'kitchen' }),
        400,
      );
      // Zero would mean permanently overdue, which nobody types on purpose.
      await expectStatus(
        () =>
          controller.create({ facilityId: tenant.facilityId, name: 'X', intervalHours: 0 }),
        400,
      );

      // And the same name twice at one site is a 409, accents and case aside.
      await controller.create({ facilityId: tenant.facilityId, name: 'Balneário' });
      await expectStatus(
        () => controller.create({ facilityId: tenant.facilityId, name: 'balneario' }),
        409,
      );
    });
  });
});

test('a blank issue description is refused, and an unknown space is a 404', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { id } = await controller.create({
        facilityId: tenant.facilityId,
        name: 'Receção',
      });

      await expectStatus(() => controller.report(id, { type: 'fault', description: ' ' }), 400);
      await expectStatus(() => controller.report(id, { type: 'broken', description: 'x' }), 400);

      await expectStatus(
        () => controller.detail('00000000-0000-4000-8000-000000000000'),
        404,
      );
    });
  });
});
