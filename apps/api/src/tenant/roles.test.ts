import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { tenantStorage } from './tenant.context.js';
import { canArchive, canInvite, grantableRoles, requireGrantable } from './roles.js';

/**
 * The invitation matrix — POOLSE-01.
 *
 * Worth a test rather than a reading, because this table is explicitly expected
 * to change: "maintenance cannot invite" is marked *for now*, and the row that
 * matters most — nobody, ever, may grant `owner` — is the one a later edit is
 * most likely to loosen by accident while widening something else.
 *
 * Run: pnpm api:test
 */
function as<T>(roles: string[], run: () => T): T {
  return tenantStorage.run(
    {
      organizationId: '00000000-0000-0000-0000-000000000001',
      membershipId: '00000000-0000-0000-0000-000000000002',
      appUserId: '00000000-0000-0000-0000-000000000003',
      roles,
    },
    run,
  );
}

test('nobody may grant owner, not even the owner', () => {
  // The rule the whole matrix hangs on. `membership_role_one_owner` enforces one
  // owner per organization, and the club changes hands through
  // `transfer_ownership` — an invitation offering `owner` would either violate
  // that index or reopen the licence-sharing hole it closed.
  for (const roles of [['owner'], ['admin'], ['owner', 'admin'], ['instructor']]) {
    assert.equal(
      as(roles, grantableRoles).includes('owner'),
      false,
      `${roles.join('+')} was offered owner`,
    );
  }
});

test('an owner and an admin may grant everything except owner', () => {
  const expected = ['admin', 'instructor', 'maintenance', 'student', 'guardian'];
  assert.deepEqual(as(['owner'], grantableRoles), expected);
  assert.deepEqual(as(['admin'], grantableRoles), expected);
});

test('an instructor may invite only the families they teach', () => {
  assert.deepEqual(as(['instructor'], grantableRoles), ['student', 'guardian']);

  // The escalation the matrix exists to stop: an instructor who can invite an
  // admin can invite themselves one.
  assert.equal(as(['instructor'], grantableRoles).includes('admin'), false);
  assert.equal(as(['instructor'], grantableRoles).includes('instructor'), false);
});

test('students, guardians and maintenance may invite nobody', () => {
  for (const role of ['student', 'guardian', 'maintenance']) {
    assert.deepEqual(as([role], grantableRoles), [], `${role} could invite somebody`);
    assert.equal(as([role], canInvite), false);
  }
});

test('holding two roles grants the union of both', () => {
  // An owner who also teaches should be able to do everything either can. The
  // product has no concept of a "primary" role and this is where that shows.
  const both = as(['instructor', 'admin'], grantableRoles);
  assert.deepEqual(both, ['admin', 'instructor', 'maintenance', 'student', 'guardian']);

  // And a role with nothing to grant does not subtract from one that has.
  assert.deepEqual(as(['maintenance', 'instructor'], grantableRoles), ['student', 'guardian']);
});

test('the order does not depend on which roles the caller holds', () => {
  // The invite dialog lists roles the same way for everybody, so two admins
  // comparing screens are not looking at different orders.
  assert.deepEqual(as(['admin', 'instructor'], grantableRoles), as(['instructor', 'admin'], grantableRoles));
});

test('requireGrantable refuses what the matrix does not allow', () => {
  // Criterion 3: a hand-crafted request is refused exactly as a stale page is.
  assert.throws(
    () => as(['instructor'], () => requireGrantable(['admin'])),
    ForbiddenException,
  );
  assert.throws(() => as(['owner'], () => requireGrantable(['owner'])), ForbiddenException);
  assert.throws(() => as(['student'], () => requireGrantable(['student'])), ForbiddenException);

  // And allows what it does.
  assert.doesNotThrow(() => as(['instructor'], () => requireGrantable(['student', 'guardian'])));
  assert.doesNotThrow(() => as(['admin'], () => requireGrantable(['instructor'])));
});

test('an unknown role grants nothing rather than everything', () => {
  // If the enum ever gains a value this table has not been taught, the safe
  // answer is silence. A lookup miss must not become a wildcard.
  assert.deepEqual(as(['auditor'], grantableRoles), []);
  assert.equal(as(['auditor'], canInvite), false);
});

test('archiving belongs to owners and admins — POOLSE-03', () => {
  assert.equal(as(['owner'], canArchive), true);
  assert.equal(as(['admin'], canArchive), true);
  assert.equal(as(['instructor'], canArchive), false);
  assert.equal(as(['maintenance'], canArchive), false);
  assert.equal(as(['student'], canArchive), false);
  assert.equal(as(['guardian'], canArchive), false);
});
