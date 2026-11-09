import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { AppController } from './app.controller.js';
import { familyStudents } from '../students/students.repository.js';
import { mayActForStudent } from '../students/redemption.repository.js';
import { actingAs, addMember, closeHarness, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * POOLSE-206 — a parent's link stops counting at 18, and the parent who pays
 * keeps paying: the adult son's fees on *Pagamentos*, and nothing else of him.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

interface Family {
  mother: string;
  son: string;
  daughter: string;
}

async function seed(tenant: ScratchTenant): Promise<Family> {
  const org = tenant.organizationId;
  const mother = await addMember(tenant, 'Marta', 'Lopes', ['guardian']);
  const student = async (first: string, years: number): Promise<string> => {
    const [row] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name, birth_date)
       VALUES ($1, $2, 'Lopes', (club_today() - make_interval(years => $3))::date) RETURNING id`,
      [org, first, years],
    );
    return row!.id;
  };
  const son = await student('Afonso', 19);
  const daughter = await student('Inês', 12);
  for (const child of [son, daughter]) {
    await tenant.sql(
      `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
       VALUES ($1, $2, $3, 'Mãe', true)`,
      [org, child, mother],
    );
  }
  return { mother, son, daughter };
}

const asMother = <T>(tenant: ScratchTenant, family: Family, fn: () => Promise<T>): Promise<T> =>
  actingAs(tenant, { membershipId: family.mother, roles: ['guardian'] }, fn);

test('the adult son leaves every family read, and the 12-year-old stays (QA 3, QA 5)', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    const mine = await familyStudents(tenant.organizationId, family.mother);
    assert.deepEqual(mine.map((one) => one.id), [family.daughter]);
    assert.equal(await mayActForStudent(tenant.organizationId, family.mother, family.son), false);
    assert.equal(await mayActForStudent(tenant.organizationId, family.mother, family.daughter), true);
    const [answer] = await tenant.sql<{ may: boolean }>(
      `SELECT family_may_answer($1, $2, $3) AS may`,
      [tenant.organizationId, family.son, family.mother],
    );
    assert.equal(answer!.may, false, 'she cannot answer Vou / Não vou for him');
  });
});

test('the mother who pays still sees the adult son on Pagamentos (rule 4)', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    const { family: chips, children } = await asMother(tenant, family, () => new AppController().fees());
    assert.deepEqual(chips.map((one) => one.id).sort(), [family.son, family.daughter].sort());
    assert.equal(children.length, 2);
    const one = await asMother(tenant, family, () => new AppController().fees(family.son));
    assert.equal(one.children[0]!.id, family.son);
  });
});

test('a parent who does not pay sees nothing of the adult son, fees included', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    const father = await addMember(tenant, 'Paulo', 'Lopes', ['guardian']);
    await tenant.sql(
      `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
       VALUES ($1, $2, $3, 'Pai', false)`,
      [tenant.organizationId, family.son, father],
    );
    const answer = await actingAs(tenant, { membershipId: father, roles: ['guardian'] }, () =>
      new AppController().fees(),
    );
    assert.deepEqual(answer.family, []);
  });
});

test('an acompanhante keeps an adult in the family reads (QA 2)', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    await tenant.sql(`UPDATE guardian_link SET kind = 'accompanying' WHERE student_id = $1`, [family.son]);
    const mine = await familyStudents(tenant.organizationId, family.mother);
    assert.deepEqual(mine.map((one) => one.id).sort(), [family.son, family.daughter].sort());
  });
});
