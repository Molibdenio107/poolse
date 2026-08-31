import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { LevelsController, StudentsController } from './students.controller.js';
import { actingAs, closeHarness, withScratchTenant } from '../test/harness.js';

/**
 * Escalões, and who they admit — round 5.
 *
 * Three rules that only a database can prove. That two escalões may share a name
 * when they admit different sexes, which is how a club writes "Cadetes
 * femininos" and "Cadetes masculinos". That one which admits nobody is refused.
 * And that two claiming exactly the same ages for the same sex are refused —
 * which is a duplicate, not the parallel programme an overlap usually is.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

test('two escalões may share a name when they admit different sexes', async () => {
  await withScratchTenant(async (tenant) => {
    const levels = new LevelsController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await levels.create({
        name: 'Cadetes',
        minAgeMonths: 96,
        maxAgeMonths: 132,
        admitsMale: false,
        admitsFemale: true,
      });
      await levels.create({
        name: 'Cadetes',
        minAgeMonths: 96,
        maxAgeMonths: 144,
        admitsMale: true,
        admitsFemale: false,
      });

      const listed = (await new StudentsController().list()).levels.filter(
        (level) => level.name === 'Cadetes',
      );
      assert.equal(listed.length, 2, 'the club writes the name once and means two escalões');
      assert.deepEqual(
        listed.map((level) => [level.admitsMale, level.admitsFemale]).sort(),
        [
          [false, true],
          [true, false],
        ].sort(),
      );
    });
  });
});

test('an escalão that admits nobody is refused, naming the field', async () => {
  await withScratchTenant(async (tenant) => {
    const levels = new LevelsController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      let refusal: unknown;
      try {
        await levels.create({ name: 'Ninguém', admitsMale: false, admitsFemale: false });
      } catch (error) {
        refusal = error;
      }
      assert.equal((refusal as { status?: number }).status, 400);
      assert.equal(
        ((refusal as { response?: { fields?: Record<string, string> } }).response?.fields ?? {})
          .admitsMale,
        'students.levelAdmitsNobody',
      );
    });
  });
});

test('an escalão written with no sexes named at all is misto', async () => {
  await withScratchTenant(async (tenant) => {
    const levels = new LevelsController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      // Everything written before round 5 posts no flags. It must keep working,
      // and it must mean "everybody" rather than "nobody".
      await levels.create({ name: 'Iniciação' });

      const [made] = (await new StudentsController().list()).levels.filter(
        (level) => level.name === 'Iniciação',
      );
      assert.equal(made?.admitsMale, true);
      assert.equal(made?.admitsFemale, true);
    });
  });
});

/**
 * The duplicate-range rule.
 *
 * Enforced by a trigger rather than a unique index: an index is checked against
 * every existing row the moment it is built, and a club whose ladder already
 * holds a duplicate could not have migrated at all. The trigger refuses the
 * duplicate the next time either row is written, which is when a person is
 * present to be told.
 */
test('two escalões may not claim exactly the same ages for the same sex', async () => {
  await withScratchTenant(async (tenant) => {
    const levels = new LevelsController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await levels.create({
        name: 'Benjamins',
        minAgeMonths: 60,
        maxAgeMonths: 96,
        admitsMale: true,
        admitsFemale: false,
      });

      // The same ages for the same members, under a different name: one escalão
      // entered twice, and nothing could tell an operator which of them a child
      // belongs in.
      let refusal: unknown;
      try {
        await levels.create({
          name: 'Escola',
          minAgeMonths: 60,
          maxAgeMonths: 96,
          admitsMale: true,
          admitsFemale: false,
        });
      } catch (error) {
        refusal = error;
      }
      assert.equal((refusal as { status?: number }).status, 409);

      // The same ages for the other sex is a different escalão, and allowed.
      await levels.create({
        name: 'Benjamins femininos',
        minAgeMonths: 60,
        maxAgeMonths: 96,
        admitsMale: false,
        admitsFemale: true,
      });

      // A misto escalão on those ages, though, would be the boys' one twice
      // over — it admits them too.
      let mixed: unknown;
      try {
        await levels.create({ name: 'Escola misto', minAgeMonths: 60, maxAgeMonths: 96 });
      } catch (error) {
        mixed = error;
      }
      assert.equal((mixed as { status?: number }).status, 409);
    });
  });
});
