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

      // Slice B: a sport's register reads that sport's level, row and filter alike;
      // the general register reads the swimming one. She is in a tennis turma, so
      // the tennis register lists her.
      const [court] = await tenant.sql<{ id: string }>(
        `INSERT INTO playing_area (organization_id, facility_id, sport_id, name) VALUES ($1, $2, 'tennis', 'Campo') RETURNING id`,
        [tenant.organizationId, tenant.facilityId],
      );
      const [turma] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_group (organization_id, season_id, facility_id, name, playing_area_id)
         VALUES ($1, $2, $3, 'Ténis', $4) RETURNING id`,
        [tenant.organizationId, tenant.seasonId, tenant.facilityId, court!.id],
      );
      await tenant.sql(
        `INSERT INTO enrollment (organization_id, class_group_id, student_id, status) VALUES ($1, $2, $3, 'active')`,
        [tenant.organizationId, turma!.id, id],
      );
      const row = async (levelId: string | undefined, sport: string | undefined) => {
        const result = await students.list(undefined, levelId, undefined, undefined, undefined, undefined, sport);
        return result.students.items.find((one) => one.id === id);
      };
      const tennisList = await students.list(undefined, tennisTwo);
      assert.equal(tennisList.students.items.some((one) => one.id === id), false, 'the general list filters by swimming');
      assert.equal((await row(undefined, undefined))?.levelName, 'Golfinhos');
      assert.equal((await row(undefined, 'tennis'))?.levelName, 'Iniciação 2');
      assert.equal((await row(tennisTwo, 'tennis'))?.levelId, tennisTwo, 'the tennis filter reads the tennis level');
      assert.equal(await row(tennisOne, 'tennis'), undefined);

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
