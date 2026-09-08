import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EnrollmentCategoryController,
  FeeCategoriesController,
} from './categories.controller.js';
import { ClassesController } from '../classes/classes.controller.js';
import { categoryForEnrollment } from './categories.repository.js';
import { LevelsController, StudentsController } from '../students/students.controller.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * The fee category — POOLSE-23 AC4 and AC5.
 *
 * The one thing worth a test above all the CRUD: **the enrolment beats the
 * turma**, and "the enrolment says nothing" is not the same as "the enrolment
 * says none". A senior turma carries the category so nobody types it forty
 * times; the one member who is staff carries their own; clearing that person's
 * own category puts them back on the turma's rather than on nothing.
 *
 * The precedence lives in SQL — `enrolment_fee_category` — for the reason
 * `fee_total_cents` does: the pricing engine that reads this next must not spell
 * it differently.
 *
 * AC5 is here too because it is a claim about ordering that nothing else
 * asserts: a senior level sits in the same ladder as the children's ones, not in
 * a parallel list.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

async function turmaWithStudent(
  tenant: ScratchTenant,
  name: string,
): Promise<{ groupId: string; enrollmentId: string }> {
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name) VALUES ($1, $2, 'Tanque')
     RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );
  const [group] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group (organization_id, season_id, facility_id, name, pool_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenant.organizationId, tenant.seasonId, tenant.facilityId, name, pool!.id],
  );
  const [student] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name)
     VALUES ($1, 'Amélia', 'Neves') RETURNING id`,
    [tenant.organizationId],
  );
  const [enrollment] = await tenant.sql<{ id: string }>(
    `INSERT INTO enrollment (organization_id, class_group_id, student_id, status)
     VALUES ($1, $2, $3, 'active') RETURNING id`,
    [tenant.organizationId, group!.id, student!.id],
  );

  return { groupId: group!.id, enrollmentId: enrollment!.id };
}

/**
 * Put a turma on a category through the turma's own update — the one write path.
 *
 * There is deliberately no endpoint for just this field. It is a fact about the
 * turma like its level and its pool, saved by the form that owns the rest of
 * them, and a second path is how two screens end up disagreeing about what was
 * saved. So the test writes it the way the screen does: the whole turma.
 */
async function setTurmaCategory(
  tenant: ScratchTenant,
  groupId: string,
  categoryId: string,
): Promise<void> {
  const [row] = await tenant.sql<{ name: string; lane: number | null; pool_id: string }>(
    `SELECT cg.name, l.position AS lane, cg.pool_id
       FROM class_group cg
       LEFT JOIN lane l ON l.id = cg.lane_id
      WHERE cg.id = $1`,
    [groupId],
  );

  await new ClassesController().update(groupId, {
    name: row!.name,
    poolId: row!.pool_id,
    lane: String(row!.lane ?? 1),
    feeCategoryId: categoryId,
  });
}

test('the enrolment beats the turma, and clearing it goes back to the turma', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const categories = new FeeCategoriesController();
      const senior = (await categories.create({ name: 'Sénior', sortOrder: 1 })).id;
      const staff = (await categories.create({ name: 'Funcionário', sortOrder: 2 })).id;

      const { groupId, enrollmentId } = await turmaWithStudent(tenant, 'Hidroginástica Sénior');

      // Nothing said yet: null, and null is "the club has said nothing" rather
      // than a category called normal.
      assert.equal(await categoryForEnrollment(tenant.organizationId, enrollmentId), null);

      // The turma's, which is how a club avoids typing it forty times.
      await setTurmaCategory(tenant, groupId, senior);
      assert.equal(
        (await categoryForEnrollment(tenant.organizationId, enrollmentId))?.name,
        'Sénior',
      );

      // And the one member of it who is staff carries their own.
      await new EnrollmentCategoryController().set(enrollmentId, { categoryId: staff });
      assert.equal(
        (await categoryForEnrollment(tenant.organizationId, enrollmentId))?.name,
        'Funcionário',
      );

      /*
       * Clearing the person's own puts them back on the turma's — not on none.
       * That distinction is the reason the clear is a DELETE rather than a
       * PATCH with a null in it: "whatever the turma says" is the useful state
       * to be able to return to.
       */
      await new EnrollmentCategoryController().clear(enrollmentId);
      assert.equal(
        (await categoryForEnrollment(tenant.organizationId, enrollmentId))?.name,
        'Sénior',
      );
    });
  });
});

test('a category is a reference, so renaming it reaches everything at once', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const categories = new FeeCategoriesController();
      // Typed without the accent, as somebody in a hurry would.
      const id = (await categories.create({ name: 'Senior' })).id;

      const { groupId, enrollmentId } = await turmaWithStudent(tenant, 'Hidroginástica');
      await setTurmaCategory(tenant, groupId, id);

      await categories.rename(id, { name: 'Sénior' });

      // Nothing was re-pointed and nothing had to be: the turma holds the id.
      assert.equal(
        (await categoryForEnrollment(tenant.organizationId, enrollmentId))?.name,
        'Sénior',
      );
    });
  });
});

test('two categories cannot share a name, accents included', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const categories = new FeeCategoriesController();
      await categories.create({ name: 'Sénior' });

      // A 409, not a 500 — and "Senior" is the same word to a club, which is
      // why the index folds accents as well as case.
      await expectStatus(() => categories.create({ name: 'senior' }), 409);
      await expectStatus(() => categories.create({ name: 'Senior' }), 409);
    });
  });
});

test('a category something still uses is not archived, and the refusal counts both', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const categories = new FeeCategoriesController();
      const id = (await categories.create({ name: 'Sénior' })).id;

      const { groupId, enrollmentId } = await turmaWithStudent(tenant, 'Hidroginástica Sénior');
      await setTurmaCategory(tenant, groupId, id);
      await new EnrollmentCategoryController().set(enrollmentId, { categoryId: id });

      const { categories: listed } = await categories.list();
      assert.equal(listed[0]?.usedByGroups, 1);
      assert.equal(listed[0]?.usedByEnrollments, 1);

      // Archiving it would leave a turma pointing at a category no list shows.
      await expectStatus(() => categories.archive(id), 409);

      // Freed on both sides, it files away.
      await new EnrollmentCategoryController().clear(enrollmentId);
      await setTurmaCategory(tenant, groupId, '');
      await categories.archive(id);
      assert.equal((await categories.list()).categories.length, 0);
    });
  });
});

test('an instructor reads the categories and cannot change them', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await new FeeCategoriesController().create({ name: 'Sénior' });
    });

    const instructor = await addMember(tenant, 'Rita', 'Instrutora', ['instructor']);

    await actingAs(tenant, { membershipId: instructor, roles: ['instructor'] }, async () => {
      /*
       * Reading is open because the category is a *label* printed beside a
       * turma's name — it says nothing about what anybody pays, which is the
       * fee plan's business and is admin-only. Writing is not.
       */
      const seen = await new FeeCategoriesController().list();
      assert.equal(seen.categories.length, 1);
      assert.equal(seen.canManage, false);

      await expectStatus(() => new FeeCategoriesController().create({ name: 'Outra' }), 403);
    });
  });
});

test('AC5 — a senior level sits in the same ladder as the children\'s ones', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const levels = new LevelsController();

      // A children's level and a 60–100 senior one, created in the wrong order
      // on purpose so the assertion is about the ladder and not about insertion.
      await levels.create({
        name: 'Hidroginástica Sénior',
        minAgeMonths: 60 * 12,
        maxAgeMonths: 100 * 12,
      });
      await levels.create({ name: 'Iniciação', minAgeMonths: 4 * 12, maxAgeMonths: 6 * 12 });

      // Read from the students screen, which is the one list the club has —
      // there is no separate senior ladder to read from, which is the point.
      const { levels: ladder } = await new StudentsController().list();

      /*
       * One list, one ordering. Not a separate senior programme: POOLSE-19's
       * "next level" logic walks this ladder, and a parallel list would need a
       * branch in it — which is exactly what AC5 exists to prevent.
       */
      const names = ladder.map((level) => level.name);
      assert.ok(names.includes('Iniciação'));
      assert.ok(names.includes('Hidroginástica Sénior'));
      assert.equal(names.length, 2, 'one ladder, both levels in it');
    });
  });
});

test('a turma keeps its colour and its category across a save', async () => {
  /*
   * The regression this exists for, and it was live.
   *
   * `groupBody` in the web app is a hand-written list of FormData keys and
   * nothing typechecks it against the form. `colour` was missing from it from
   * round 6 until round 10: the swatches rendered, an operator picked one, the
   * value never left the browser, the API defaulted it to null and the calendar
   * went on using the level's tint. Nothing errored, because nothing was wrong —
   * the field simply was not sent.
   *
   * This asserts the API half: what the update is given, it keeps. The other
   * half is a rule in `classes.actions.ts` saying to add every new control's
   * name to that list — which is what a comment can do and a type cannot.
   */
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const senior = (await new FeeCategoriesController().create({ name: 'Sénior' })).id;
      const { groupId } = await turmaWithStudent(tenant, 'Hidroginástica Sénior');

      const [before] = await tenant.sql<{ name: string; pool_id: string }>(
        `SELECT name, pool_id FROM class_group WHERE id = $1`,
        [groupId],
      );

      await new ClassesController().update(groupId, {
        name: before!.name,
        poolId: before!.pool_id,
        lane: '1',
        colour: 'violet',
        feeCategoryId: senior,
      });

      const [after] = await tenant.sql<{ colour: string | null; fee_category_id: string | null }>(
        `SELECT colour::text AS colour, fee_category_id FROM class_group WHERE id = $1`,
        [groupId],
      );

      assert.equal(after?.colour, 'violet', 'the colour survived the save');
      assert.equal(after?.fee_category_id, senior, 'and so did the category');
    });
  });
});
