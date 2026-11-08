import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';
import { AppController } from './app.controller.js';
import { viewReadRoute } from '../tenant/app-view.js';

/**
 * The teacher's *Alunos* tab and *Início*'s feedback (Rui, 07-11-2026): only the
 * students of the turmas they teach, a card with who to call, and never under a view.
 *
 * Run: pnpm api:test
 */

after(closeHarness);

async function turmas(tenant: ScratchTenant): Promise<{ ana: string; bruno: string; rosa: string; tiago: string }> {
  const ana = await addMember(tenant, 'Ana', 'Ribeiro', ['instructor']);
  const bruno = await addMember(tenant, 'Bruno', 'Carvalho', ['instructor']);
  const parent = await addMember(tenant, 'Pedro', 'Silva', ['guardian']);
  await tenant.sql(`UPDATE membership SET phone = '912345678' WHERE id = $1`, [parent]);
  const group = async (name: string, teacher: string): Promise<string> => {
    const [row] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, season_id, facility_id, name, instructor_membership_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [tenant.organizationId, tenant.seasonId, tenant.facilityId, name, teacher],
    );
    return row!.id;
  };
  const enrol = async (first: string, groupId: string): Promise<string> => {
    const [row] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name, favourite_stroke)
       VALUES ($1, $2, 'Silva', 'backstroke') RETURNING id`,
      [tenant.organizationId, first],
    );
    await tenant.sql(
      `INSERT INTO enrollment (organization_id, class_group_id, student_id, status) VALUES ($1, $2, $3, 'active')`,
      [tenant.organizationId, groupId, row!.id],
    );
    return row!.id;
  };
  const rosa = await enrol('Rosa', await group('Golfinhos', ana));
  const tiago = await enrol('Tiago', await group('Tubarões', bruno));
  await tenant.sql(
    `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
     VALUES ($1, $2, $3, 'Pai', true)`,
    [tenant.organizationId, rosa, parent],
  );
  return { ana, bruno, rosa, tiago };
}

test('a teacher lists the students of their own turmas and opens a card', async () => {
  await withScratchTenant(async (tenant) => {
    const { ana, rosa, tiago } = await turmas(tenant);
    const app = new AppController();
    await actingAs(tenant, { membershipId: ana, roles: ['instructor'] }, async () => {
      const { students } = await app.teachingStudentList();
      assert.deepEqual(students.map((one) => [one.id, one.turmas]), [[rosa, ['Golfinhos']]]);

      const card = await app.teachingStudent(rosa);
      assert.equal(card.favouriteStroke, 'backstroke');
      assert.deepEqual(card.contact.people.map((one) => [one.kind, one.phone]), [['guardian', '912345678']]);

      // Another teacher's student is not found.
      await expectStatus(() => app.teachingStudent(tiago), 404);
      await expectStatus(() => app.teachingStudent('not-a-uuid'), 404);
      assert.deepEqual((await app.teachingFeedback()).lessons, []);

      // The join QR: the club's public address, only while pre-registration is open.
      await tenant.sql(`UPDATE organization SET public_registration_open = false WHERE id = $1`, [tenant.organizationId]);
      assert.deepEqual(await app.joinLink(), { slug: null });
      await tenant.sql(`UPDATE organization SET public_registration_open = true WHERE id = $1`, [tenant.organizationId]);
      assert.equal(typeof (await app.joinLink()).slug, 'string');
    });
    const audit = await tenant.sql(`SELECT 1 FROM audit_log WHERE action = 'student.contact_read' AND entity_id = $1`, [rosa]);
    assert.equal(audit.length, 1);
  });
});

test('nobody else reads them: another role, another club, a view', async () => {
  await withScratchTenant(async (tenant) => {
    const { rosa } = await turmas(tenant);
    const app = new AppController();
    for (const role of ['owner', 'maintenance', 'guardian', 'student'] as const) {
      await actingAs(tenant, { roles: [role] }, async () => {
        await expectStatus(() => app.teachingStudentList(), 403);
        await expectStatus(() => app.teachingStudent(rosa), 403);
        await expectStatus(() => app.teachingFeedback(), 403);
      });
    }
    // A family invites friends too; the office and maintenance have the back office.
    for (const role of ['guardian', 'student'] as const) {
      await actingAs(tenant, { roles: [role] }, async () => {
        assert.ok('slug' in (await app.joinLink()));
      });
    }
    for (const role of ['owner', 'maintenance'] as const) {
      await actingAs(tenant, { roles: [role] }, () => expectStatus(() => app.joinLink(), 403));
    }
    await withScratchTenant(async (away) => {
      const coach = await addMember(away, 'Eva', 'Fora', ['instructor']);
      await actingAs(away, { membershipId: coach, roles: ['instructor'] }, () =>
        expectStatus(() => app.teachingStudent(rosa), 404),
      );
    });
  });
  const id = '00000000-0000-4000-8000-000000000000';
  assert.equal(viewReadRoute('GET', '/app/teaching/students'), null);
  assert.equal(viewReadRoute('GET', `/app/teaching/students/${id}`), null);
  assert.equal(viewReadRoute('GET', '/app/teaching/feedback'), null);
  assert.equal(viewReadRoute('GET', '/app/join-link'), null);
});
