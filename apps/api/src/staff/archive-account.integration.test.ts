import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PeopleDedupController } from '../students/students.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';
import { StaffController } from './staff.controller.js';

/**
 * Staff do not become students on the same login (Rui, 07-11-2026): the Owner takes
 * a past role away, refuses the downgrade, and archives the account instead.
 *
 * Run: pnpm api:test
 */

const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 2 });
after(async () => {
  await owner.end();
  await closeHarness();
});

async function refusal(attempt: Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await attempt;
  } catch (error) {
    return (error as { getResponse(): Record<string, unknown> }).getResponse();
  }
  throw new Error('It was not refused');
}

async function giveRole(tenant: ScratchTenant, membership: string, role: string): Promise<void> {
  await owner.query(
    `INSERT INTO membership_role (organization_id, membership_id, role) VALUES ($1, $2, $3::member_role)`,
    [tenant.organizationId, membership, role],
  );
}

async function studentOn(tenant: ScratchTenant, membership: string): Promise<string> {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, membership_id)
     VALUES ($1, 'Rui', 'Antigo', $2) RETURNING id`,
    [tenant.organizationId, membership],
  );
  return rows[0]!.id;
}

test('the Owner removes a past student role; an Admin does not', async () => {
  await withScratchTenant(async (tenant) => {
    const admin = await addMember(tenant, 'Rita', 'Secretaria', ['admin']);
    const coach = await addMember(tenant, 'Ana', 'Ribeiro', ['instructor']);
    await giveRole(tenant, coach, 'student');
    const roles = new PeopleDedupController();

    await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, () =>
      expectStatus(() => roles.revoke(coach, 'student'), 403),
    );
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      assert.deepEqual(await roles.revoke(coach, 'student'), { revoked: true });
    });
  });
});

test('staff do not become students on the same login', async () => {
  await withScratchTenant(async (tenant) => {
    const coach = await addMember(tenant, 'Ana', 'Ribeiro', ['instructor']);
    const both = await addMember(tenant, 'Rui', 'Dois', ['instructor']);
    await giveRole(tenant, both, 'student');
    const enrolled = await addMember(tenant, 'Eva', 'Ativa', ['maintenance']);
    await studentOn(tenant, enrolled);
    const parent = await addMember(tenant, 'Pedro', 'Pai', ['guardian']);
    const roles = new PeopleDedupController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      assert.equal((await refusal(roles.grant(coach, { role: 'student' })))['code'], 'new_account_needed');
      assert.equal((await refusal(roles.revoke(both, 'instructor')))['code'], 'new_account_needed');
      assert.equal((await refusal(roles.revoke(enrolled, 'maintenance')))['code'], 'new_account_needed');

      // Somebody who is not a student loses a staff role as before.
      assert.deepEqual(await roles.revoke(coach, 'instructor'), { revoked: true });
      // The other direction stays: a student may become staff.
      assert.deepEqual(await roles.grant(parent, { role: 'student' }), { granted: true });
      assert.deepEqual(await roles.grant(parent, { role: 'instructor' }), { granted: true });
    });
  });
});

test('archiving stops the login, keeps the history, and keeps a student record unlinked', async () => {
  await withScratchTenant(async (tenant) => {
    const coach = await addMember(tenant, 'Ana', 'Ribeiro', ['instructor']);
    const { rows: login } = await owner.query<{ id: string }>(
      `INSERT INTO app_user (clerk_user_id, cached_email, cached_first_name, cached_last_name, birth_date)
       VALUES ($1, $2, 'Ana', 'DaConta', '1990-05-17') RETURNING id`,
      [`user_archive_${coach}`, `${coach}@example.test`],
    );
    await owner.query(
      `UPDATE membership SET app_user_id = $1, first_name = NULL, last_name = NULL, email = NULL WHERE id = $2`,
      [login[0]!.id, coach],
    );
    const student = await studentOn(tenant, coach);
    const staff = new StaffController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      assert.deepEqual(await staff.archive(coach), { archived: true });
      await expectStatus(() => staff.archive(coach), 404);
    });

    const { rows: person } = await owner.query<{ gone: boolean; roles: number }>(
      `SELECT m.archived_at IS NOT NULL AS gone,
              (SELECT count(*)::int FROM membership_role r
                WHERE r.membership_id = m.id AND r.archived_at IS NULL) AS roles
         FROM membership m WHERE m.id = $1`,
      [coach],
    );
    assert.deepEqual(person[0], { gone: true, roles: 0 });

    // The record keeps the name it was reading through the login.
    const { rows: record } = await owner.query<{
      membership_id: string | null;
      last_name: string;
      archived_at: Date | null;
    }>(`SELECT membership_id, last_name, archived_at FROM student WHERE id = $1`, [student]);
    assert.equal(record[0]!.membership_id, null);
    assert.equal(record[0]!.archived_at, null);
    assert.equal(record[0]!.last_name, 'DaConta');

    const { rows: audit } = await owner.query(
      `SELECT 1 FROM audit_log WHERE action = 'staff.account_archived' AND entity_id = $1`,
      [coach],
    );
    assert.equal(audit.length, 1);
  });
});

test('archiving is the Owner’s, and refused while somebody depends on the account', async () => {
  await withScratchTenant(async (tenant) => {
    const admin = await addMember(tenant, 'Rita', 'Secretaria', ['admin']);
    const coach = await addMember(tenant, 'Ana', 'Ribeiro', ['instructor']);
    const parent = await addMember(tenant, 'Pedro', 'Pai', ['guardian', 'instructor']);
    await owner.query(
      `INSERT INTO class_group (organization_id, season_id, facility_id, name, instructor_membership_id)
       VALUES ($1, $2, $3, 'Golfinhos', $4)`,
      [tenant.organizationId, tenant.seasonId, tenant.facilityId, coach],
    );
    const child = await studentOn(tenant, await addMember(tenant, 'Filho', 'Pai', ['student']));
    await owner.query(
      `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id) VALUES ($1, $2, $3)`,
      [tenant.organizationId, child, parent],
    );
    const { rows: held } = await owner.query<{ membership_id: string }>(
      `SELECT membership_id FROM membership_role WHERE organization_id = $1 AND role = 'owner' AND archived_at IS NULL`,
      [tenant.organizationId],
    );
    const ownerId = held[0]!.membership_id;
    const staff = new StaffController();

    await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, () =>
      expectStatus(() => staff.archive(coach), 403),
    );
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const teaching = await refusal(staff.archive(coach));
      assert.equal(teaching['code'], 'staff_still_teaches');
      assert.equal(teaching['turmas'], 1);
      const family = await refusal(staff.archive(parent));
      assert.equal(family['code'], 'staff_answers_for_children');
      assert.equal(family['children'], 1);
      assert.equal((await refusal(staff.archive(ownerId)))['code'], 'owner_account');
    });
  });
});

test('another club’s person is not found', async () => {
  await withScratchTenant(async (home) => {
    await withScratchTenant(async (away) => {
      const coach = await addMember(away, 'Ana', 'Ribeiro', ['instructor']);
      await actingAs(home, { roles: ['owner'] }, () => expectStatus(() => new StaffController().archive(coach), 404));
    });
  });
});
