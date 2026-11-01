import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { LevelsController, StudentSportLevelController, StudentsController } from './students.controller.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * A level per sport — POOLSE-148, slice A.
 *
 * A student in swimming and tennis holds a level in each, independently: the
 * swimming level stays on the record's own field, every other sport's in its
 * row, and one write path picks the home from the level's own sport.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

async function enableTennis(organizationId: string): Promise<void> {
  const owner = new pg.Client({ connectionString: process.env['DATABASE_URL'] });
  await owner.connect();
  try {
    await owner.query("UPDATE organization SET enabled_sports = '{pool,tennis}' WHERE id = $1", [organizationId]);
  } finally {
    await owner.end();
  }
}

test('a student holds a swimming and a tennis level, each set on its own (QA 1, 2)', async () => {
  await withScratchTenant(async (tenant) => {
    await enableTennis(tenant.organizationId);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const levels = new LevelsController();
      const { id: golfinhos } = await levels.create({ name: 'Golfinhos' });
      const { id: tennisOne } = await levels.create({ name: 'Iniciação', sportId: 'tennis' });
      const { id: tennisTwo } = await levels.create({ name: 'Iniciação 2', sportId: 'tennis' });

      const students = new StudentsController();
      const { id } = await students.create({ firstName: 'Ana', lastName: 'Dupla', levelId: golfinhos });

      const sportLevel = new StudentSportLevelController();
      await sportLevel.set(id, { sport: 'tennis', levelId: tennisOne });
      await sportLevel.set(id, { sport: 'tennis', levelId: tennisTwo });

      const record = await students.one(id);
      assert.equal(record.levelId, golfinhos, 'the swimming level did not move');
      assert.deepEqual(record.sportLevels, [{ sport: 'tennis', levelId: tennisTwo, levelName: 'Iniciação 2' }]);

      // A level from the other ladder is refused, on both paths.
      await expectStatus(() => sportLevel.set(id, { sport: 'tennis', levelId: golfinhos }), 400);
      await expectStatus(
        () => students.update(id, { firstName: 'Ana', lastName: 'Dupla', levelId: tennisOne }),
        400,
      );
      // A sport the club does not have.
      await expectStatus(() => sportLevel.set(id, { sport: 'padel', levelId: null }), 400);

      // Clearing the tennis level leaves swimming's alone.
      await sportLevel.set(id, { sport: 'tennis', levelId: null });
      const cleared = await students.one(id);
      assert.deepEqual(cleared.sportLevels, []);
      assert.equal(cleared.levelId, golfinhos);

      // And swimming's own, through the same endpoint, is the record's field.
      await sportLevel.set(id, { sport: 'pool', levelId: null });
      assert.equal((await students.one(id)).levelId, null);
    });
  });
});

test('a pool-only record is unchanged; an instructor may not set a level (QA 3, 5)', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { id } = await new StudentsController().create({ firstName: 'Rui', lastName: 'Só' });
      assert.deepEqual((await new StudentsController().one(id)).sportLevels, []);
      await expectStatus(() => new StudentSportLevelController().set(id, { sport: 'tennis', levelId: null }), 400);
    });
    const [student] = await tenant.sql<{ id: string }>(`SELECT id FROM student LIMIT 1`);
    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      await expectStatus(() => new StudentSportLevelController().set(student!.id, { sport: 'pool', levelId: null }), 403);
    });
  });
});
