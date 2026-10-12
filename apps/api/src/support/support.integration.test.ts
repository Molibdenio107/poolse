import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { authStorage } from '../auth/auth.context.js';
import { listMemberships } from '../identity/identity.repository.js';
import { PeopleController } from '../invitations/people.controller.js';
import { PlatformSupportController } from '../platform/support.controller.js';
import { IncidentsController } from '../safety/incidents.controller.js';
import { SalariesController } from '../staff/compensation.controller.js';
import { PeopleSearchController, StudentsController } from '../students/students.controller.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  removeAppUser,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';
import { SupportGrantsController } from './support.controller.js';

/**
 * Support access — POOLSE-79 slice 1, QA 1–6 and 9.
 *
 * The club grants, the operator enters as a membership of their own, and it
 * ends on time with nothing having run. The part most likely to go quietly
 * wrong is QA 5: a list that shows Poolse support as one of the club's staff.
 * Every list that names the club's people is called here with a live support
 * membership in the club, rather than trusting a grep.
 *
 * Run: pnpm api:test   (needs pnpm db:up and DATABASE_PLATFORM_URL)
 */

const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 2 });
const grants = new SupportGrantsController();
const platform = new PlatformSupportController();

after(async () => {
  await owner.end();
  await closeHarness();
});

/** A platform operator with a login and a name the people searches can find. */
async function makeOperator(): Promise<{ clerkUserId: string; appUserId: string }> {
  const clerkUserId = `user_test_support_${process.pid}_${Math.floor(performance.now())}`;
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO app_user (clerk_user_id, cached_first_name, cached_last_name, cached_email)
     VALUES ($1, 'Zacarias', 'Suporte', 'zacarias.suporte@example.test') RETURNING id`,
    [clerkUserId],
  );
  await owner.query(`INSERT INTO platform_admin (clerk_user_id, note) VALUES ($1, 'support test')`, [
    clerkUserId,
  ]);
  return { clerkUserId, appUserId: rows[0]!.id };
}

async function dropOperator(clerkUserId: string): Promise<void> {
  await owner.query('DELETE FROM platform_admin WHERE clerk_user_id = $1', [clerkUserId]);
  await owner.query('DELETE FROM platform_audit_log WHERE clerk_user_id = $1', [clerkUserId]);
}

function asOperator<T>(clerkUserId: string, fn: () => Promise<T>): Promise<T> {
  return authStorage.run({ clerkUserId, sessionId: `sess_${clerkUserId}` } as never, fn);
}

/** The Owner opens a window, and the operator walks in through it. */
async function enter(
  tenant: ScratchTenant,
  clerkUserId: string,
  hours = 24,
): Promise<{ grantId: string; membershipId: string }> {
  const { grant } = await actingAs(tenant, { roles: ['owner'] }, () => grants.open({ hours }));
  const entered = await asOperator(clerkUserId, () => platform.enter(grant.id));
  return { grantId: grant.id, membershipId: entered.membershipId };
}

async function withOperator(fn: (tenant: ScratchTenant, op: { clerkUserId: string }) => Promise<void>) {
  let clerkUserId: string | null = null;
  try {
    await withScratchTenant(async (tenant) => {
      // Inside the tenant, not before it: the harness's first sweep removes any
      // `user_test_%` login with no membership, which this one has not got yet.
      const op = await makeOperator();
      clerkUserId = op.clerkUserId;
      try {
        await fn(tenant, op);
      } finally {
        // The platform's trail names the club, so it goes before the club does.
        await dropOperator(op.clerkUserId);
      }
    });
  } finally {
    if (clerkUserId !== null) await removeAppUser(clerkUserId);
  }
}

function clubOf<M extends { organizationId: string }>(memberships: M[], tenant: ScratchTenant): M | undefined {
  return memberships.find((one) => one.organizationId === tenant.organizationId);
}

test('QA 1: a 24 h grant lets the operator in as an admin, with the end time for the banner', async () => {
  await withOperator(async (tenant, op) => {
    const { grantId } = await enter(tenant, op.clerkUserId);

    const membership = clubOf(await listMemberships(op.clerkUserId), tenant);
    assert.ok(membership, 'the club is listed for the operator');
    assert.deepEqual(membership.roles, ['admin']);
    assert.ok(membership.supportExpiresAt, 'the banner knows when it ends');

    const hours = (Date.parse(membership.supportExpiresAt!) - Date.now()) / 3_600_000;
    assert.ok(hours > 23.9 && hours <= 24, `ends in 24 h, not ${hours}`);

    const open = await asOperator(op.clerkUserId, () => platform.open());
    assert.ok(open.grants.some((one) => one.grantId === grantId));
  });
});

test('QA 2: once the window has passed, the operator is not a member — and nothing ran', async () => {
  await withOperator(async (tenant, op) => {
    const { grantId } = await enter(tenant, op.clerkUserId);

    // The clock passing, made instant. No job is called below.
    await owner.query(
      `UPDATE support_grant SET starts_at = now() - interval '2 days', expires_at = now() - interval '1 day'
        WHERE id = $1`,
      [grantId],
    );

    assert.equal(clubOf(await listMemberships(op.clerkUserId), tenant), undefined);
    await asOperator(op.clerkUserId, () => expectStatus(() => platform.enter(grantId), 404));

    const listed = await actingAs(tenant, { roles: ['owner'] }, () => grants.list());
    assert.equal(listed.grants[0]?.state, 'expired');
  });
});

test('QA 3: revoking ends the session on the next request', async () => {
  await withOperator(async (tenant, op) => {
    const { grantId } = await enter(tenant, op.clerkUserId);

    await actingAs(tenant, { roles: ['owner'] }, () => grants.revoke(grantId));
    assert.equal(clubOf(await listMemberships(op.clerkUserId), tenant), undefined);

    const listed = await actingAs(tenant, { roles: ['owner'] }, () => grants.list());
    assert.equal(listed.grants[0]?.state, 'revoked');
    await actingAs(tenant, { roles: ['owner'] }, () => expectStatus(() => grants.revoke(grantId), 404));
  });
});

test('QA 4: what support does is in the club’s log under the support membership', async () => {
  await withOperator(async (tenant, op) => {
    const { membershipId } = await enter(tenant, op.clerkUserId);
    const [student] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name)
       VALUES ($1, 'Alice', 'Melo') RETURNING id`,
      [tenant.organizationId],
    );

    await actingAs(
      tenant,
      { membershipId, roles: ['admin'], clerkUserId: op.clerkUserId },
      () => new StudentsController().archive(student!.id),
    );

    const [entry] = await tenant.sql<{ actor_membership_id: string }>(
      `SELECT actor_membership_id FROM audit_log WHERE action = 'student.archived' AND entity_id = $1`,
      [student!.id],
    );
    assert.equal(entry?.actor_membership_id, membershipId);

    const trail = await tenant.sql<{ action: string }>(
      `SELECT action FROM audit_log WHERE action LIKE 'support.%' ORDER BY created_at`,
    );
    assert.deepEqual(
      trail.map((row) => row.action),
      ['support.granted', 'support.entered'],
    );
  });
});

test('QA 5: support is no member of staff — not listed, not searchable, not a seat', async () => {
  await withOperator(async (tenant, op) => {
    const instructor = await addMember(tenant, 'Ana', 'Costa', ['instructor']);
    const before = await actingAs(tenant, { roles: ['owner'] }, () => new PeopleController().list());

    const { membershipId } = await enter(tenant, op.clerkUserId);
    const isSupport = (id: string | undefined) => id === membershipId;

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const people = await new PeopleController().list();
      assert.ok(!people.members.items.some((one) => isSupport(one.membershipId)), 'Pessoas');
      assert.ok(!people.transferCandidates.some((one) => isSupport(one.membershipId)), 'transfer');
      assert.deepEqual(people.counts, before.counts, 'the team is the same size');
      assert.equal(people.members.total, before.members.total);

      const staffOnly = await new PeopleController().list('staff');
      assert.ok(!staffOnly.members.items.some((one) => isSupport(one.membershipId)), 'staff scope');

      const admins = await new PeopleController().list(undefined, 'admin');
      assert.ok(!admins.members.items.some((one) => isSupport(one.membershipId)), 'admin chip');

      const found = await new PeopleSearchController().search('Zacarias');
      assert.deepEqual(found.people, [], 'people search');

      for (const kind of ['member', 'staff']) {
        const picked = await new IncidentsController().people(kind, 'Zacarias');
        assert.deepEqual(picked.people, [], `incident picker (${kind})`);
      }

      const salaries = await new SalariesController().list();
      assert.ok(
        !salaries.salaries.items.some((row) => isSupport((row as { membershipId?: string }).membershipId)),
        'salaries',
      );
      assert.ok(
        salaries.salaries.items.some((row) => (row as { membershipId?: string }).membershipId === instructor),
        'the instructor is still on the pay list — the filter is not hiding everyone',
      );
    });
  });
});

test('QA 6 and 9: only the Owner grants — not an Admin, and not support itself', async () => {
  await withOperator(async (tenant, op) => {
    const admin = await addMember(tenant, 'Bea', 'Admin', ['admin']);
    await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, async () => {
      await expectStatus(() => grants.list(), 403);
      await expectStatus(() => grants.open({ hours: 24 }), 403);
    });

    const { grantId, membershipId } = await enter(tenant, op.clerkUserId);
    await actingAs(tenant, { membershipId, roles: ['admin'], clerkUserId: op.clerkUserId }, async () => {
      await expectStatus(() => grants.list(), 403);
      await expectStatus(() => grants.revoke(grantId), 403);
    });

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await expectStatus(() => grants.open({ hours: 5 }), 400);
      // One window at a time.
      await expectStatus(() => grants.open({ hours: 24 }), 409);
    });
  });
});

test('leaving ends the grant and is on both trails', async () => {
  await withOperator(async (tenant, op) => {
    const { grantId } = await enter(tenant, op.clerkUserId);
    await asOperator(op.clerkUserId, () => platform.leave(grantId));

    assert.equal(clubOf(await listMemberships(op.clerkUserId), tenant), undefined);
    const listed = await actingAs(tenant, { roles: ['owner'] }, () => grants.list());
    assert.equal(listed.grants[0]?.state, 'ended');

    const { rows } = await owner.query<{ action: string }>(
      `SELECT action FROM platform_audit_log WHERE clerk_user_id = $1 ORDER BY created_at`,
      [op.clerkUserId],
    );
    assert.deepEqual(
      rows.map((row) => row.action),
      ['support.entered', 'support.ended'],
    );
  });
});
