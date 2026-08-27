import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLandingRoute } from './landing.ts';

/**
 * Where somebody lands after signing in — POOLSE-37.
 *
 * Scenarios 37.1 to 37.6 and 37.9. The rest are Clerk's redirect behaviour and a
 * browser, which this cannot reach; what it can pin is the rule itself, which is
 * the part with a decision in it.
 */

test('37.1 and 37.2 an owner and an admin land on Instalações', () => {
  assert.equal(resolveLandingRoute(['owner']), '/dashboard/facilities');
  assert.equal(resolveLandingRoute(['admin']), '/dashboard/facilities');
});

test('37.3 an instructor lands on their turmas, not Instalações', () => {
  assert.equal(resolveLandingRoute(['instructor']), '/dashboard/classes');
});

test('37.6 the strongest role wins', () => {
  // An instructor who is also an admin lands where an admin lands, whichever
  // order the roles arrive in.
  assert.equal(resolveLandingRoute(['instructor', 'admin']), '/dashboard/facilities');
  assert.equal(resolveLandingRoute(['admin', 'instructor']), '/dashboard/facilities');

  assert.equal(resolveLandingRoute(['student', 'owner']), '/dashboard/facilities');
});

test('37.9 a role whose destination is not built falls through', () => {
  // Maintenance tasks are module 2. Rather than a permission error or a page
  // that does not exist, they get somewhere every member can open.
  assert.equal(resolveLandingRoute(['maintenance']), '/dashboard/calendar');

  // And a maintenance user who also teaches lands on the timetable — the chain
  // keeps walking rather than stopping at the strongest role it recognises.
  assert.equal(resolveLandingRoute(['maintenance', 'instructor']), '/dashboard/classes');
});

test('37.5 a student and a guardian land somewhere they can open', () => {
  // Their own area is the mobile app, which does not exist yet. Never a
  // permission error — AC5.
  assert.equal(resolveLandingRoute(['student']), '/dashboard/calendar');
  assert.equal(resolveLandingRoute(['guardian']), '/dashboard/calendar');
});

test('somebody holding no roles still lands somewhere', () => {
  // An accepted invitation that granted nothing, or a membership mid-setup.
  assert.equal(resolveLandingRoute([]), '/dashboard/calendar');
});

test('a role this build does not know is ignored', () => {
  assert.equal(resolveLandingRoute(['treasurer']), '/dashboard/calendar');
  assert.equal(resolveLandingRoute(['treasurer', 'admin']), '/dashboard/facilities');
});

test('the landing route is never the resolver itself', () => {
  // 37.8: the one shape that would loop. Asserted for every role rather than
  // reasoned about, because it is cheap and a loop is very expensive.
  const everyRole = ['owner', 'admin', 'instructor', 'maintenance', 'guardian', 'student'];
  for (const role of everyRole) {
    const destination = resolveLandingRoute([role]);
    assert.notEqual(destination, '/dashboard/start');
    assert.ok(destination.startsWith('/dashboard/'));
  }
});
