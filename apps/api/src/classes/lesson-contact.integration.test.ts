import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';
import { AttendanceController } from './attendance.controller.js';
import { viewReadRoute } from '../tenant/app-view.js';

/**
 * Who to call about a child, from the lesson (Rui, 07-11-2026): whoever teaches it,
 * somebody on its roll, one student at a time, and every read on the record.
 *
 * Run: pnpm api:test
 */

after(closeHarness);

async function student(tenant: ScratchTenant, first: string, extra = ''): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name${extra === '' ? '' : ', emergency_contact_name, emergency_contact_phone, emergency_contact_relationship'})
     VALUES ($1, $2, 'Silva'${extra === '' ? '' : `, 'Avó Maria', '${extra}', 'Avó'`}) RETURNING id`,
    [tenant.organizationId, first],
  );
  return row!.id;
}

async function lesson(tenant: ScratchTenant): Promise<{
  sessionId: string;
  ana: string;
  bruno: string;
  rosa: string;
  outsider: string;
}> {
  const ana = await addMember(tenant, 'Ana', 'Ribeiro', ['instructor']);
  const bruno = await addMember(tenant, 'Bruno', 'Carvalho', ['instructor']);
  const parent = await addMember(tenant, 'Pedro', 'Silva', ['guardian']);
  await tenant.sql(`UPDATE membership SET phone = '912345678' WHERE id = $1`, [parent]);
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name) VALUES ($1, $2, 'Tanque') RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );
  const [group] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group (organization_id, season_id, facility_id, name, pool_id, instructor_membership_id)
     VALUES ($1, $2, $3, 'Golfinhos', $4, $5) RETURNING id`,
    [tenant.organizationId, tenant.seasonId, tenant.facilityId, pool!.id, ana],
  );
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_session (organization_id, class_group_id, pool_id, instructor_membership_id, occurs_on, starts_at, ends_at, duration_minutes)
     VALUES ($1, $2, $3, $4, (now() + interval '1 day')::date, now() + interval '1 day',
             now() + interval '1 day 45 minutes', 45) RETURNING id`,
    [tenant.organizationId, group!.id, pool!.id, ana],
  );
  const rosa = await student(tenant, 'Rosa', '934567890');
  const outsider = await student(tenant, 'Tiago');
  await tenant.sql(
    `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
     VALUES ($1, $2, $3, 'Pai', true)`,
    [tenant.organizationId, rosa, parent],
  );
  await tenant.sql(
    `INSERT INTO enrollment (organization_id, class_group_id, student_id, status) VALUES ($1, $2, $3, 'active')`,
    [tenant.organizationId, group!.id, rosa],
  );
  return { sessionId: row!.id, ana, bruno, rosa, outsider };
}

test('the teacher reads who to call, and the read is on the record', async () => {
  await withScratchTenant(async (tenant) => {
    const { sessionId, ana, rosa } = await lesson(tenant);
    await actingAs(tenant, { membershipId: ana, roles: ['instructor'] }, async () => {
      const contact = await new AttendanceController().contact(sessionId, rosa);
      assert.equal(contact.insurance, 'never');
      assert.deepEqual(
        contact.people.map((one) => [one.kind, one.phone]),
        [['guardian', '912345678'], ['emergency', '934567890']],
      );
      // Only the fields a call needs.
      assert.deepEqual(Object.keys(contact.people[0]!).sort(), ['kind', 'name', 'phone', 'primary', 'relationship']);
    });
    const audit = await tenant.sql(
      `SELECT 1 FROM audit_log WHERE action = 'student.contact_read' AND entity_id = $1`,
      [rosa],
    );
    assert.equal(audit.length, 1);
  });
});

test('nobody else reads it: a colleague, a student off the roll, a stand-in’s regular teacher, another club', async () => {
  await withScratchTenant(async (tenant) => {
    const { sessionId, ana, bruno, rosa, outsider } = await lesson(tenant);
    const attendance = new AttendanceController();

    await actingAs(tenant, { membershipId: bruno, roles: ['instructor'] }, () =>
      expectStatus(() => attendance.contact(sessionId, rosa), 403),
    );
    await actingAs(tenant, { membershipId: ana, roles: ['instructor'] }, () =>
      expectStatus(() => attendance.contact(sessionId, outsider), 404),
    );
    for (const role of ['owner', 'maintenance', 'guardian', 'student'] as const) {
      await actingAs(tenant, { roles: [role] }, () => expectStatus(() => attendance.contact(sessionId, rosa), 403));
    }

    await tenant.sql(`UPDATE class_session SET substitute_instructor_membership_id = $1 WHERE id = $2`, [bruno, sessionId]);
    await actingAs(tenant, { membershipId: ana, roles: ['instructor'] }, () =>
      expectStatus(() => attendance.contact(sessionId, rosa), 403),
    );
    await actingAs(tenant, { membershipId: bruno, roles: ['instructor'] }, async () => {
      assert.equal((await attendance.contact(sessionId, rosa)).people.length, 2);
    });

    await withScratchTenant(async (away) => {
      const coach = await addMember(away, 'Eva', 'Fora', ['instructor']);
      await actingAs(away, { membershipId: coach, roles: ['instructor'] }, () =>
        expectStatus(() => attendance.contact(sessionId, rosa), 404),
      );
    });
  });
});

test('a view never opens a family’s numbers', () => {
  const id = '00000000-0000-4000-8000-000000000000';
  assert.equal(viewReadRoute('GET', `/sessions/${id}/contacts/${id}`), null);
});
