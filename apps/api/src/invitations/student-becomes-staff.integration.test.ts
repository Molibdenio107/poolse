import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { StaffController } from '../staff/staff.controller.js';
import { PeopleDedupController, StudentsController } from '../students/students.controller.js';
import { actingAs, addMember, closeHarness, withScratchTenant, type ScratchTenant } from '../test/harness.js';
import { InvitationsController } from './invitations.controller.js';

/**
 * A student becomes an employee (Rui, 07-11-2026): one person, one login, and the
 * invitation screen is the door somebody will try first. It refuses, names the
 * record, and the record has to open for somebody who is not staff yet.
 *
 * Run: pnpm api:test
 */

const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 2 });
after(async () => {
  await owner.end();
  await closeHarness();
});

async function studentWithLogin(tenant: ScratchTenant): Promise<{ membership: string; student: string; email: string }> {
  const membership = await addMember(tenant, 'Carlos', 'Silva', ['student']);
  const email = `carlos-${membership}@example.test`;
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO app_user (clerk_user_id, cached_email) VALUES ($1, $2) RETURNING id`,
    [`user_staff_${membership}`, email],
  );
  await owner.query(
    `UPDATE membership SET app_user_id = $1, first_name = NULL, last_name = NULL, email = NULL WHERE id = $2`,
    [rows[0]!.id, membership],
  );
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, birth_date, membership_id)
     VALUES ($1, 'Carlos', 'Silva', '1990-01-01', $2) RETURNING id`,
    [tenant.organizationId, membership],
  );
  return { membership, student: row!.id, email };
}

async function refusal(attempt: Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await attempt;
  } catch (error) {
    return (error as { response: Record<string, unknown> }).response;
  }
  return assert.fail('the invitation went through');
}

for (const archived of [true, false]) {
  test(`a student with a login, ${archived ? 'archived' : 'still a student'}, becomes an instructor on their record`, async () => {
    await withScratchTenant(async (tenant) => {
      const { membership, student, email } = await studentWithLogin(tenant);

      await actingAs(tenant, { roles: ['owner'] }, async () => {
        if (archived) await new StudentsController().archive(student);

        const refused = await refusal(
          new InvitationsController().create({ email, roles: ['instructor'] } as never),
        );
        assert.equal(refused['code'], 'person_in_app');
        assert.equal(refused['membershipId'], membership, 'the refusal names the record to open');

        // The link the screen shows has to land somewhere.
        const record = await new StaffController().one(membership);
        assert.deepEqual([...record.roles], ['student']);

        await new PeopleDedupController().grant(membership, { role: 'instructor' });
        assert.deepEqual([...(await new StaffController().one(membership)).roles].sort(), ['instructor', 'student']);
      });

      const logins = await tenant.sql(`SELECT 1 FROM membership WHERE id = $1 AND app_user_id IS NOT NULL`, [membership]);
      assert.equal(logins.length, 1, 'one person, one login');
    });
  });
}

test('a student with no login is invited as a new member of staff', async () => {
  await withScratchTenant(async (tenant) => {
    await tenant.sql(
      `INSERT INTO student (organization_id, first_name, last_name, birth_date, contact_email)
       VALUES ($1, 'Rita', 'Costa', '1990-01-01', 'rita@example.test')`,
      [tenant.organizationId],
    );
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const made = await new InvitationsController().create({ email: 'rita@example.test', roles: ['instructor'] } as never);
      assert.equal(made.email, 'rita@example.test');
    });
  });
});
