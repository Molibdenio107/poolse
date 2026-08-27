import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import {
  grantableRoles,
  requireGrantable,
  requireRole,
  rolesHeld,
  strongestRole,
  strongestRoleOf,
} from './roles.js';
import { tenantStorage } from './tenant.context.js';

/**
 * One Person, many roles — POOLSE-17, the authorisation half.
 *
 * Scenarios 17.3, 17.4 and 17.5 from the ticket's QA section, plus the
 * conventions' standing requirement that every permission rule gets a denial
 * test issued against the rule itself rather than against a hidden button.
 *
 * The ticket names the thing most likely to go wrong: a single-role assumption
 * left somewhere in the authorisation path, which "will silently deny an
 * Instructor who is also a parent, or grant on the wrong role". Every test here
 * gives somebody two roles and checks the union, because one role is the case
 * that already worked.
 */

/** Runs a check as somebody holding exactly these roles. */
function as<T>(roles: string[], fn: () => T): T {
  return tenantStorage.run(
    {
      organizationId: '00000000-0000-0000-0000-000000000001',
      membershipId: '00000000-0000-0000-0000-000000000002',
      appUserId: '00000000-0000-0000-0000-000000000003',
      roles,
    },
    fn,
  );
}

// ---------------------------------------------------------------------------
// 17.3 — the union grants; a weaker role never blocks a stronger one
// ---------------------------------------------------------------------------

test('17.3 an instructor who is also a student may still do instructor things', () => {
  // The exact failure the ticket warns about. If anything anywhere reads "the"
  // role rather than the set, this is where it shows.
  assert.doesNotThrow(() => as(['instructor', 'student'], () => requireRole('instructor')));

  // And the order they arrive in is irrelevant — a set has no first element.
  assert.doesNotThrow(() => as(['student', 'instructor'], () => requireRole('instructor')));
});

test('17.3 holding a weaker role does not subtract from a stronger one', () => {
  assert.doesNotThrow(() => as(['owner', 'student'], () => requireRole('owner')));
  assert.doesNotThrow(() => as(['admin', 'guardian'], () => requireRole('admin')));
});

test('a person with only weak roles is still refused', () => {
  // The negative half. Union means "everything any role grants", not "everything".
  assert.throws(
    () => as(['student', 'guardian'], () => requireRole('instructor')),
    ForbiddenException,
  );
});

// ---------------------------------------------------------------------------
// 17.4 — the invite matrix reads the union, and the API refuses escalation
// ---------------------------------------------------------------------------

test('17.4 an admin who is also a student gets the admin invite list', () => {
  const roles = as(['admin', 'student'], grantableRoles);

  // Everything except owner, in seniority order — the admin list, unaffected by
  // also being a student.
  assert.deepEqual(roles, ['admin', 'instructor', 'maintenance', 'guardian', 'student']);
  assert.ok(!roles.includes('owner'));
});

test('17.4 an admin inviting an owner is refused by the rule, not by the UI', () => {
  assert.throws(
    () => as(['admin', 'student'], () => requireGrantable(['owner'])),
    ForbiddenException,
  );
});

test('17.4 nobody may grant owner — not even an owner', () => {
  // Ownership moves by transfer, and `membership_role_one_owner` enforces it in
  // the database. The matrix agrees rather than leaving two answers.
  assert.throws(() => as(['owner'], () => requireGrantable(['owner'])), ForbiddenException);
});

test('a student holding no other role may grant nothing at all', () => {
  assert.deepEqual(as(['student'], grantableRoles), []);
  assert.throws(() => as(['student'], () => requireGrantable(['student'])), ForbiddenException);
});

// ---------------------------------------------------------------------------
// strongestRole — the one written rule POOLSE-17 AC5 asks for
// ---------------------------------------------------------------------------

test('strongestRole reads the seniority order, not the order given', () => {
  assert.equal(strongestRole(['student', 'owner']), 'owner');
  assert.equal(strongestRole(['guardian', 'instructor']), 'instructor');
  assert.equal(strongestRole(['maintenance', 'admin']), 'admin');
});

test('encarregado de educação outranks student', () => {
  // The confirmed reading of POOLSE-18 AC3, and the one place the API's order
  // used to disagree with the badges.
  assert.equal(strongestRole(['student', 'guardian']), 'guardian');
});

test('strongestRole is null for somebody holding nothing', () => {
  // An unaccepted invitation: a person the club knows about who may do nothing.
  assert.equal(strongestRole([]), null);
});

test('an unknown role does not become the strongest', () => {
  // If the schema gains a role before this list does, it must not outrank Owner.
  assert.equal(strongestRole(['treasurer', 'admin']), 'admin');
  assert.equal(strongestRole(['treasurer']), null);
});

test('strongestRoleOf and rolesHeld read the acting person', () => {
  assert.equal(as(['student', 'admin'], strongestRoleOf), 'admin');

  // The union, in seniority order, whatever order the context holds them in.
  assert.deepEqual(as(['student', 'admin', 'guardian'], rolesHeld), [
    'admin',
    'guardian',
    'student',
  ]);
});

test('rolesHeld drops a role this build does not know', () => {
  // Better a role that does nothing than one that silently authorises.
  assert.deepEqual(as(['treasurer', 'instructor'], rolesHeld), ['instructor']);
});
