import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { detailsMissingFor } from './details-gate.js';
import { findAppUser, listMemberships } from './identity.repository.js';
import { addMember, closeHarness, removeAppUser, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * What the active club still needs from a person — POOLSE-227, rules 1–3, 9, 11,
 * against the real database: the name and mobile on the login, the NIF and
 * morada on the person's own membership, the adult path from the student row.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 1 });
const logins: string[] = [];

after(async () => {
  for (const id of logins) await removeAppUser(id);
  await owner.end();
  await closeHarness();
});

/** Gives a typed-in member a login, with the name and mobile given or not. */
async function withLogin(
  membershipId: string,
  details: { first?: string; last?: string; phone?: string },
): Promise<string> {
  const clerkUserId = `user_test_gate_${membershipId}`;
  logins.push(clerkUserId);
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO app_user (clerk_user_id, cached_email, cached_first_name, cached_last_name, contact_phone)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [clerkUserId, `${membershipId}@example.test`, details.first ?? null, details.last ?? null, details.phone ?? null],
  );
  await owner.query(
    `UPDATE membership SET app_user_id = $1, first_name = NULL, last_name = NULL, email = NULL WHERE id = $2`,
    [rows[0]!.id, membershipId],
  );
  return clerkUserId;
}

async function gapsOf(tenant: ScratchTenant, clerkUserId: string): Promise<string[]> {
  const user = await findAppUser(clerkUserId);
  const memberships = await listMemberships(clerkUserId);
  return detailsMissingFor(user!, memberships.find((one) => one.organizationId === tenant.organizationId));
}

test('POOLSE-227 — each role is asked only for its own missing details', async () => {
  await withScratchTenant(async (tenant) => {
    // An admin needs a name; the mobile is optional (Rui, 19-11-2026), so none is still complete.
    const admin = await addMember(tenant, 'Ana', 'Admin', ['admin']);
    const adminLogin = await withLogin(admin, { first: 'Ana', last: 'Admin' });
    assert.deepEqual(await gapsOf(tenant, adminLogin), []);
    await owner.query(`UPDATE app_user SET cached_last_name = NULL WHERE clerk_user_id = $1`, [adminLogin]);
    assert.deepEqual(await gapsOf(tenant, adminLogin), ['lastName']);

    // An instructor gives a name and a mobile; no NIF or morada is required (Rui, 19-11-2026).
    const coach = await addMember(tenant, 'Rui', 'Coach', ['instructor']);
    const coachLogin = await withLogin(coach, { first: 'Rui', last: 'Coach', phone: '913000000' });
    assert.deepEqual(await gapsOf(tenant, coachLogin), []);

    // A guardian with no name on Clerk and no mobile.
    const parent = await addMember(tenant, 'Pai', 'Silva', ['guardian']);
    const parentLogin = await withLogin(parent, {});
    assert.deepEqual(await gapsOf(tenant, parentLogin), ['firstName', 'lastName', 'mobile']);
  });
});

test('POOLSE-227 — a student is asked only on the adult path', async () => {
  await withScratchTenant(async (tenant) => {
    const grown = await addMember(tenant, 'Joana', 'Adulta', ['student']);
    const grownLogin = await withLogin(grown, { first: 'Joana', last: 'Adulta' });
    await tenant.sql(
      `INSERT INTO student (organization_id, first_name, last_name, birth_date, membership_id)
       VALUES ($1, 'Joana', 'Adulta', '1990-03-04', $2)`,
      [tenant.organizationId, grown],
    );
    assert.deepEqual(await gapsOf(tenant, grownLogin), ['mobile']);

    const young = await addMember(tenant, 'Tiago', 'Novo', ['student']);
    const youngLogin = await withLogin(young, {});
    await tenant.sql(
      `INSERT INTO student (organization_id, first_name, last_name, birth_date, membership_id)
       VALUES ($1, 'Tiago', 'Novo', (current_date - interval '13 years')::date, $2)`,
      [tenant.organizationId, young],
    );
    assert.deepEqual(await gapsOf(tenant, youngLogin), []);
  });
});

test('POOLSE-227 — never under a view or a support membership', async () => {
  await withScratchTenant(async (tenant) => {
    const coach = await addMember(tenant, 'Vera', 'Vista', ['instructor']);
    const login = await withLogin(coach, {});
    const user = await findAppUser(login);
    const [membership] = (await listMemberships(login)).filter((one) => one.organizationId === tenant.organizationId);
    assert.ok((await detailsMissingFor(user!, membership)).length > 0);

    const viewing = {
      id: 'v',
      hat: 'family',
      expiresAt: new Date().toISOString(),
      membershipId: coach,
      appUserId: '',
      roles: ['guardian'],
      sports: [],
    };
    assert.deepEqual(await detailsMissingFor(user!, { ...membership!, view: viewing }), []);
    assert.deepEqual(await detailsMissingFor(user!, { ...membership!, supportExpiresAt: new Date().toISOString() }), []);
    assert.deepEqual(await detailsMissingFor(user!, undefined), []);
  });
});
