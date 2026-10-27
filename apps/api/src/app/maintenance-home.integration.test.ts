import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { AppController } from './app.controller.js';
import { SpacesController } from '../spaces/spaces.controller.js';
import { MaintenanceController } from '../maintenance/maintenance.controller.js';
import { actingAs, addMember, closeHarness, withScratchTenant } from '../test/harness.js';

/**
 * The maintenance home — POOLSE-90 slice 3, QA 12, against the database.
 *
 * A maintenance user at a club with two sites: the to-do covers both, a task
 * given to a colleague is not theirs, *Limpo* (the backoffice's own cleaning
 * endpoint) clears the overdue Espaço, *Concluir* clears the due task, and an
 * avaria and a reposição are both on the list.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

test('POOLSE-90 slice 3 — the maintenance to-do covers every site, and one tap clears what it lists', async () => {
  await withScratchTenant(async (tenant) => {
    const org = tenant.organizationId;
    const fixer = await addMember(tenant, 'Mário', 'Manutenção', ['maintenance']);
    const colleague = await addMember(tenant, 'Rita', 'Manutenção', ['maintenance']);

    const [second] = await tenant.sql<{ id: string }>(
      `INSERT INTO facility (organization_id, name) VALUES ($1, 'Pavilhão Norte') RETURNING id`,
      [org],
    );
    const space = async (facilityId: string, name: string): Promise<string> => {
      const [row] = await tenant.sql<{ id: string }>(
        `INSERT INTO space (organization_id, facility_id, name, type, expected_cleaning_interval_hours)
         VALUES ($1, $2, $3, 'changing_room', 24) RETURNING id`,
        [org, facilityId, name],
      );
      return row!.id;
    };
    const southRoom = await space(tenant.facilityId, 'Balneário Sul');
    const northRoom = await space(second!.id, 'Balneário Norte');

    const task = async (facilityId: string, title: string, assignee: string | null): Promise<string> => {
      const [row] = await tenant.sql<{ id: string }>(
        `INSERT INTO maintenance_task (organization_id, facility_id, title, interval_days, assigned_to)
         VALUES ($1, $2, $3, 7, $4) RETURNING id`,
        [org, facilityId, title, assignee],
      );
      return row!.id;
    };
    const mine = await task(second!.id, 'Lavar filtros', fixer);
    const nobodys = await task(tenant.facilityId, 'Verificar cloro', null);
    const theirs = await task(tenant.facilityId, 'Pintar portas', colleague);

    await tenant.sql(
      `INSERT INTO maintenance_request (organization_id, facility_id, space_id, type, description, reported_by)
       VALUES ($1, $2, $3, 'fault', 'Chuveiro avariado', $4),
              ($1, $5, $6, 'restock', 'Falta sabonete', $4)`,
      [org, tenant.facilityId, southRoom, colleague, second!.id, northRoom],
    );

    await actingAs(tenant, { membershipId: fixer, roles: ['maintenance'] }, async () => {
      const home = await new AppController().maintenance();
      assert.deepEqual(home.tasks.map((one) => one.id).sort(), [mine, nobodys].sort(), 'mine and nobody’s, both sites');
      assert.ok(!home.tasks.some((one) => one.id === theirs), "a colleague's task is not on my list");
      assert.deepEqual(home.overdueSpaces.map((one) => one.id).sort(), [northRoom, southRoom].sort());
      assert.deepEqual(home.issues.map((one) => one.type).sort(), ['fault', 'restock']);
      assert.equal(home.spaces.length, 2);

      // Limpo and Concluir are the backoffice's own endpoints.
      await new SpacesController().clean(southRoom, {});
      await new MaintenanceController().complete(mine, {});
      const after = await new AppController().maintenance();
      assert.deepEqual(after.overdueSpaces.map((one) => one.id), [northRoom], 'Limpo clears that Espaço');
      assert.deepEqual(after.tasks.map((one) => one.id), [nobodys], 'Concluir clears that task');
    });
  });
});
