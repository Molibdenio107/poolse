import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEMBER_ROLES, bySeniority } from './roles.ts';

/**
 * Role ordering — POOLSE-18.
 *
 * Small, but worth pinning: the badges are the only place a multi-role person's
 * standing is visible, and an order that changed with the order the API happened
 * to return would make the People list look different on every reload.
 */

test('roles sort by seniority, not by the order they arrive in', () => {
  assert.deepEqual(bySeniority(['student', 'owner', 'instructor']), [
    'owner',
    'instructor',
    'student',
  ]);

  // The same set, shuffled, must come out the same way.
  assert.deepEqual(bySeniority(['instructor', 'student', 'owner']), [
    'owner',
    'instructor',
    'student',
  ]);
});

test('the full list comes back in the documented order', () => {
  const shuffled = [...MEMBER_ROLES].reverse();
  assert.deepEqual(bySeniority(shuffled), [
    'owner',
    'admin',
    'instructor',
    'maintenance',
    'guardian',
    'student',
  ]);
});

test('a senior student who is also a guardian reads guardian first', () => {
  // The case POOLSE-17 is about, and the reason the order is not alphabetical:
  // "Encarregado · Aluno" is how a club describes this person.
  assert.deepEqual(bySeniority(['student', 'guardian']), ['guardian', 'student']);
});

test('a role this build has never heard of sorts last, not first', () => {
  // If the schema gains a role before this list does, the badge must not appear
  // above Owner. Last is the harmless answer; first is a lie about their standing.
  assert.deepEqual(bySeniority(['treasurer', 'owner', 'student']), [
    'owner',
    'student',
    'treasurer',
  ]);
});

test('sorting leaves the caller array untouched', () => {
  const roles = ['student', 'owner'];
  bySeniority(roles);
  assert.deepEqual(roles, ['student', 'owner']);
});

test('an empty list is an empty list', () => {
  assert.deepEqual(bySeniority([]), []);
});
