import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ClassesController } from './classes.controller.js';
import { actingAs, closeHarness, withScratchTenant } from '../test/harness.js';

/**
 * Which concession a turma's list prints — POOLSE-172 moved it from a function
 * asked per student to a join on the same view, so this pins the precedence:
 * the enrolment's own, else the turma's, else none.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

test('a student on the list carries their own category, else the turma’s, else none', async () => {
  await withScratchTenant(async (tenant) => {
    const category = async (name: string): Promise<string> =>
      (
        await tenant.sql<{ id: string }>(
          `INSERT INTO fee_category (organization_id, name) VALUES ($1, $2) RETURNING id`,
          [tenant.organizationId, name],
        )
      )[0]!.id;
    const own = await category('Própria');
    const turmas = await category('Da turma');

    const group = async (name: string, feeCategoryId: string | null): Promise<string> =>
      (
        await tenant.sql<{ id: string }>(
          `INSERT INTO class_group (organization_id, season_id, facility_id, name, fee_category_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [tenant.organizationId, tenant.seasonId, tenant.facilityId, name, feeCategoryId],
        )
      )[0]!.id;
    const withCategory = await group('Com categoria', turmas);
    const without = await group('Sem categoria', null);

    const enrol = async (groupId: string, first: string, feeCategoryId: string | null): Promise<void> => {
      const [student] = await tenant.sql<{ id: string }>(
        `INSERT INTO student (organization_id, first_name, last_name) VALUES ($1, $2, 'Teste') RETURNING id`,
        [tenant.organizationId, first],
      );
      await tenant.sql(
        `INSERT INTO enrollment (organization_id, class_group_id, student_id, status, fee_category_id)
         VALUES ($1, $2, $3, 'active', $4)`,
        [tenant.organizationId, groupId, student!.id, feeCategoryId],
      );
    };
    await enrol(withCategory, 'Ana', own);
    await enrol(withCategory, 'Bia', null);
    await enrol(without, 'Caio', null);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { groups } = await new ClassesController().list('all');
      const names = (id: string) =>
        Object.fromEntries(
          groups.find((g) => g.id === id)!.students.map((s) => [s.firstName, s.feeCategoryName]),
        );
      assert.deepEqual(names(withCategory), { Ana: 'Própria', Bia: 'Da turma' });
      assert.deepEqual(names(without), { Caio: null });
    });
  });
});
