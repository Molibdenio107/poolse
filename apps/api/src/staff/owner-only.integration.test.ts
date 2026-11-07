import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PeopleDedupController } from '../students/students.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';
import { StaffController } from './staff.controller.js';

/**
 * What only the Owner changes on somebody else's record (Rui, 07-11-2026): the NIF,
 * the NISS, the ID document, the contract, the notes and staff roles. An Admin reads
 * them and keeps the everyday things, so the office is not stuck.
 *
 * Run: pnpm api:test
 */

const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 2 });
after(async () => {
  await owner.end();
  await closeHarness();
});

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

async function people(tenant: ScratchTenant): Promise<{ admin: string; coach: string }> {
  const admin = await addMember(tenant, 'Rita', 'Secretaria', ['admin']);
  const coach = await addMember(tenant, 'Ana', 'Ribeiro', ['instructor']);
  return { admin, coach };
}

async function giveLogin(membership: string): Promise<void> {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO app_user (clerk_user_id, cached_email) VALUES ($1, $2) RETURNING id`,
    [`user_owner_only_${membership}`, `${membership}@example.test`],
  );
  await owner.query(
    `UPDATE membership SET app_user_id = $1, first_name = NULL, last_name = NULL, email = NULL WHERE id = $2`,
    [rows[0]!.id, membership],
  );
}

test('an Admin reads what only the Owner writes, and keeps the everyday', async () => {
  await withScratchTenant(async (tenant) => {
    const { admin, coach } = await people(tenant);
    const staff = new StaffController();
    const roles = new PeopleDedupController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await staff.editDetails(coach, { taxNumber: '123 456 789' });
      await staff.update(coach, { firstName: 'Ana', lastName: 'Ribeiro', notes: 'Boa com os mais novos' });
    });

    await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, async () => {
      // Refused.
      await expectStatus(() => staff.editDetails(coach, { taxNumber: '500 000 000' }), 403);
      await expectStatus(() => staff.editIdentity(coach, { birthDate: '1990-05-17' }), 403);
      await expectStatus(() => staff.fileIdPhoto(coach, 'front', 'cc.png', PNG), 403);
      await expectStatus(() => staff.removeIdPhoto(coach, 'front'), 403);
      await expectStatus(() => staff.editContract(coach, { kind: 'services' }), 403);
      await expectStatus(() => staff.fileContract(coach, 'c.pdf', PDF), 403);
      await expectStatus(() => staff.removeContract(coach), 403);
      await expectStatus(
        () => staff.update(coach, { firstName: 'Ana', lastName: 'Ribeiro', notes: 'Outra coisa' }),
        403,
      );
      await expectStatus(() => roles.grant(coach, { role: 'maintenance' }), 403);
      await expectStatus(() => roles.revoke(coach, 'instructor'), 403);

      // Read.
      const record = await staff.one(coach);
      assert.equal(record.notes, 'Boa com os mais novos');
      assert.equal((await staff.details(coach)).taxNumber, '123456789');
      assert.equal((await staff.contract(coach)).canEdit, false);

      // Kept: a phone beside unchanged notes, the address, and a family role.
      const saved = await staff.update(coach, {
        firstName: 'Ana',
        lastName: 'Ribeiro',
        phone: '912345678',
        notes: 'Boa com os mais novos',
      });
      assert.equal(saved.phone, '912345678');
      assert.equal(saved.notes, 'Boa com os mais novos', 'nothing cleared by an Admin');
      await staff.editDetails(coach, { address: 'Rua Nova 2' });
      await roles.grant(coach, { role: 'guardian' });
    });
  });
});

test('the person keeps their own identity, an Admin included', async () => {
  await withScratchTenant(async (tenant) => {
    const { admin } = await people(tenant);
    await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, async () => {
      const saved = await new StaffController().editIdentity(admin, { birthDate: '1990-05-17' });
      assert.equal(saved.birthDate, '1990-05-17');
      await expectStatus(() => new StaffController().editDetails(admin, { taxNumber: '123 456 789' }), 403);
    });
  });
});

test('a student who is still one keeps the role; archived, it goes and the login stays', async () => {
  await withScratchTenant(async (tenant) => {
    const person = await addMember(tenant, 'Carlos', 'Silva', ['student']);
    await giveLogin(person);
    const [row] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name, birth_date, membership_id)
       VALUES ($1, 'Carlos', 'Silva', '1990-01-01', $2) RETURNING id`,
      [tenant.organizationId, person],
    );
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const roles = new PeopleDedupController();
      await expectStatus(() => roles.revoke(person, 'student'), 409);
      await tenant.sql(`UPDATE student SET archived_at = now() WHERE id = $1`, [row!.id]);
      await roles.grant(person, { role: 'instructor' });
      await roles.revoke(person, 'student');
      assert.deepEqual([...(await new StaffController().one(person)).roles], ['instructor']);
    });
    const logins = await tenant.sql(`SELECT 1 FROM membership WHERE id = $1 AND app_user_id IS NOT NULL`, [person]);
    assert.equal(logins.length, 1);
  });
});

test('a login’s date of birth: the Owner corrects it on the account, an Admin may not', async () => {
  await withScratchTenant(async (tenant) => {
    const { coach } = await people(tenant);
    await giveLogin(coach);
    const staff = new StaffController();
    await owner.query(
      `UPDATE app_user SET birth_date = '1985-03-03', contact_phone = '912345678', theme_preference = 'dark'
        WHERE id = (SELECT app_user_id FROM membership WHERE id = $1)`,
      [coach],
    );
    await actingAs(tenant, { roles: ['admin'] }, () =>
      expectStatus(() => staff.editIdentity(coach, { birthDate: '1990-05-17' }), 403),
    );
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const saved = await staff.editIdentity(coach, { birthDate: '1990-05-17' });
      assert.equal(saved.birthDate, '1990-05-17');
      assert.equal(saved.birthDateSource, 'login');
    });
    const { rows } = await owner.query<{ phone: string; theme: string }>(
      `SELECT contact_phone AS phone, theme_preference AS theme FROM app_user
        WHERE id = (SELECT app_user_id FROM membership WHERE id = $1)`,
      [coach],
    );
    assert.deepEqual(rows[0], { phone: '912345678', theme: 'dark' }, 'the rest of the profile stays');
  });
});

test('a login’s photo: only the Owner, and only somebody with a login', async () => {
  await withScratchTenant(async (tenant) => {
    const { coach } = await people(tenant);
    const staff = new StaffController();
    await actingAs(tenant, { roles: ['admin'] }, async () => {
      await expectStatus(() => staff.setLoginPhoto(coach, PNG), 403);
      await expectStatus(() => staff.removeLoginPhoto(coach), 403);
    });
    await actingAs(tenant, { roles: ['admin'], support: true }, () =>
      expectStatus(() => staff.setLoginPhoto(coach, PNG), 403),
    );
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await expectStatus(() => staff.setLoginPhoto(coach, Buffer.from('not an image')), 400);
      await expectStatus(() => staff.setLoginPhoto(coach, PNG), 404);
    });
  });
});

test('a login’s name: an Admin and support are refused, the Owner gets through to Clerk', async () => {
  await withScratchTenant(async (tenant) => {
    const { coach } = await people(tenant);
    await giveLogin(coach);
    const body = { firstName: 'Anabela', lastName: 'Ribeiro' };
    const attempt = async (): Promise<unknown> => {
      try {
        await new StaffController().update(coach, body);
        return 'saved';
      } catch (error) {
        return (error as { response?: { code?: unknown } }).response?.code ?? 'reached Clerk';
      }
    };
    await actingAs(tenant, { roles: ['admin'] }, async () => assert.equal(await attempt(), 'name_is_theirs'));
    await actingAs(tenant, { roles: ['admin'], support: true }, async () =>
      assert.equal(await attempt(), 'name_is_theirs'),
    );
    // A test login Clerk has never heard of: past the guard, Clerk refuses it, and nothing changed.
    await actingAs(tenant, { roles: ['owner'] }, async () => assert.notEqual(await attempt(), 'name_is_theirs'));
  });
});
