import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appHome, familyOnly, hatsOf } from './app-hats.ts';

/**
 * Who lands where in app mode — POOLSE-90, QA 1 and 2. The router, the switcher
 * and the dashboard's redirect all read this, so it is pinned once here.
 */

test('an owner or admin is sent to the backoffice, whatever else they are', () => {
  assert.equal(appHome(['owner']), '/dashboard');
  assert.equal(appHome(['admin', 'guardian']), '/dashboard');
});

test('a guardian or a student lands on the family agenda', () => {
  assert.equal(appHome(['guardian']), '/app/familia');
  assert.equal(appHome(['student']), '/app/familia');
});

test('an instructor who is a parent has the family home, and the backoffice for the rest', () => {
  const hats = hatsOf(['instructor', 'guardian']);
  // Teaching is not built yet (slice 2), so it is not offered.
  assert.deepEqual(hats.homes, ['family']);
  assert.equal(hats.staff, true);
  assert.equal(familyOnly(['instructor', 'guardian']), false);
});

test('an instructor alone, until their home exists, goes to the backoffice', () => {
  assert.equal(appHome(['instructor']), '/dashboard');
  assert.equal(appHome(['maintenance']), '/dashboard');
});

test('a family and nothing else is family-only', () => {
  assert.equal(familyOnly(['guardian']), true);
  assert.equal(familyOnly(['guardian', 'student']), true);
  assert.equal(familyOnly([]), false);
});
