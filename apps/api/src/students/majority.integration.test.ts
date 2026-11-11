import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { MajorityController } from './majority.controller.js';
import { StudentsController } from './students.controller.js';
import { AttentionController } from '../attention/attention.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * POOLSE-207 — *Fez 18 anos*: the office is told when a student comes of age
 * with a parent's link, and what it does is on the record.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

async function cameOfAge(tenant: ScratchTenant, daysAgo = 5): Promise<{ student: string; mother: string }> {
  const mother = await addMember(tenant, 'Marta', 'Lopes', ['guardian']);
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, birth_date, contact_email)
     VALUES ($1, 'Afonso', 'Lopes', (club_today() - interval '18 years' - make_interval(days => $2))::date,
             'afonso@exemplo.pt')
     RETURNING id`,
    [tenant.organizationId, daysAgo],
  );
  await tenant.sql(
    `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
     VALUES ($1, $2, $3, 'Mãe', true)`,
    [tenant.organizationId, row!.id, mother],
  );
  return { student: row!.id, mother };
}

const asOwner = <T>(tenant: ScratchTenant, fn: () => Promise<T>): Promise<T> => actingAs(tenant, { roles: ['owner'] }, fn);

test('QA 3: the list names who came of age, Confirmar clears the row and the circle, and it is on the record', async () => {
  await withScratchTenant(async (tenant) => {
    const { student, mother } = await cameOfAge(tenant);
    const controller = new MajorityController();

    const { students } = await asOwner(tenant, () => controller.list());
    assert.equal(students.length, 1);
    assert.equal(students[0]!.studentId, student);
    assert.deepEqual(students[0]!.parents.map((one) => one.membershipId), [mother]);
    assert.equal(students[0]!.invitable, true, 'an email and no login: Convidar para a app is offered (QA 4)');
    assert.equal((await asOwner(tenant, () => new AttentionController().read())).students[student], 1);

    await asOwner(tenant, () => controller.review(student, { action: 'confirmed' }));
    assert.deepEqual((await asOwner(tenant, () => controller.list())).students, []);
    assert.equal((await asOwner(tenant, () => new AttentionController().read())).students[student], undefined);

    const audit = await tenant.sql<{ action: string }>(
      `SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY created_at`,
      [student],
    );
    assert.ok(audit.some((row) => row.action === 'student.majority_reviewed'));
    const [link] = await tenant.sql<{ kind: string }>(`SELECT kind FROM guardian_link WHERE student_id = $1`, [student]);
    assert.equal(link!.kind, 'parental', 'Confirmar changes nothing');
  });
});

test('É acompanhante turns the link accompanying, on the record, and the adult is back on the guardian path', async () => {
  await withScratchTenant(async (tenant) => {
    const { student } = await cameOfAge(tenant);
    await asOwner(tenant, () => new MajorityController().review(student, { action: 'accompanying' }));
    const [link] = await tenant.sql<{ kind: string }>(`SELECT kind FROM guardian_link WHERE student_id = $1`, [student]);
    assert.equal(link!.kind, 'accompanying');
    const [path] = await tenant.sql<{ adult: boolean }>(
      `SELECT student_is_adult_path($1, $2) AS adult`,
      [tenant.organizationId, student],
    );
    assert.equal(path!.adult, false);
    const [entry] = await tenant.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log WHERE entity_id = $1 AND action = 'guardian.kind_changed'`,
      [student],
    );
    assert.equal(entry!.n, 1);
  });
});

test('Retirar acompanhante archives the link, and only an acompanhante', async () => {
  await withScratchTenant(async (tenant) => {
    const { student } = await cameOfAge(tenant);
    const [link] = await tenant.sql<{ id: string }>(`SELECT id FROM guardian_link WHERE student_id = $1`, [student]);
    const controller = new MajorityController();
    await expectStatus(() => asOwner(tenant, () => controller.removeAcompanhante(student, link!.id)), 404);
    await tenant.sql(`UPDATE guardian_link SET kind = 'accompanying' WHERE id = $1`, [link!.id]);
    await asOwner(tenant, () => controller.removeAcompanhante(student, link!.id));
    const [left] = await tenant.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM guardian_link WHERE student_id = $1 AND archived_at IS NULL`,
      [student],
    );
    assert.equal(left!.n, 0);
  });
});

test('QA 5: a student not pending, or of another club, is a 404; a bad action a 400', async () => {
  await withScratchTenant(async (tenant) => {
    const { student } = await cameOfAge(tenant, 90);
    const controller = new MajorityController();
    await expectStatus(() => asOwner(tenant, () => controller.review(student, { action: 'confirmed' })), 404);
    await expectStatus(() => asOwner(tenant, () => controller.review(student, { action: 'deleted' })), 400);
    const fresh = await cameOfAge(tenant);
    await withScratchTenant(async (other) => {
      await expectStatus(
        () => actingAs(other, { roles: ['owner'] }, () => controller.review(fresh.student, { action: 'confirmed' })),
        404,
      );
      assert.deepEqual((await actingAs(other, { roles: ['owner'] }, () => controller.list())).students, []);
    });
  });
});

test('POOLSE-213: a student of age has their own Fez 18 anos, pending then answered; a minor has none; Por rever lists them', async () => {
  await withScratchTenant(async (tenant) => {
    const { student } = await cameOfAge(tenant);
    const [minor] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name, birth_date)
       VALUES ($1, 'Rita', 'Lopes', (club_today() - interval '12 years')::date) RETURNING id`,
      [tenant.organizationId],
    );
    // With her encarregado: a minor with none is on Por rever for that (11-11-2026), which is not this test.
    const [mother] = await tenant.sql<{ id: string }>(
      `INSERT INTO membership (organization_id, status, first_name, last_name, email)
       VALUES ($1, 'active', 'Ana', 'Lopes', 'ana.lopes.213@example.test') RETURNING id`,
      [tenant.organizationId],
    );
    await tenant.sql(
      `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
       VALUES ($1, $2, $3, 'Mãe', true)`,
      [tenant.organizationId, minor!.id, mother!.id],
    );
    const controller = new MajorityController();

    const pending = await asOwner(tenant, () => controller.one(student));
    assert.equal(pending.show, true);
    assert.equal(pending.pending?.studentId, student);
    assert.deepEqual(pending.decisions, []);
    assert.equal((await asOwner(tenant, () => controller.one(minor!.id))).show, false, 'a minor has no Fez 18 anos');

    // Por rever is the dots' own list: the student of age is on it, the minor is not.
    const listed = await asOwner(tenant, () =>
      new StudentsController().list(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, '1'),
    );
    assert.deepEqual(listed.students.items.map((one) => one.id), [student]);

    await asOwner(tenant, () => controller.review(student, { action: 'accompanying' }));
    const answered = await asOwner(tenant, () => controller.one(student));
    assert.equal(answered.show, true, 'still shown once answered, with the decision');
    assert.equal(answered.pending, null);
    assert.deepEqual(answered.decisions.map((one) => one.action), ['accompanying']);

    // A teacher may not read it.
    await actingAs(tenant, { roles: ['instructor'] }, () => expectStatus(() => controller.one(student), 403));
  });
});
