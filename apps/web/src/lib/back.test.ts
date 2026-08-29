import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backLabelKey, backTarget, readFrom, withFrom } from './back.ts';

/**
 * Where "Voltar" goes — R4.
 *
 * Two things here are worth a test rather than a read-through.
 *
 * **`readFrom` is a redirect validator**, and the failure mode is not a wrong
 * label but an open redirect: a back button that leaves the app for whatever
 * host was written into the query string. Every rejection below is a payload
 * somebody would actually try, so they are asserted individually rather than as
 * "invalid input returns null".
 *
 * **`backLabelKey` distinguishes a site from the list of sites**, which share a
 * prefix. Longest-prefix matching alone gets this wrong, and getting it wrong is
 * invisible — the button still works, it is just announced as the wrong place.
 *
 * Run: pnpm web:test
 */

test('a back target is accepted only if it is a path inside the app', () => {
  assert.equal(readFrom('/dashboard'), '/dashboard');
  assert.equal(readFrom('/dashboard/facilities/abc'), '/dashboard/facilities/abc');
  assert.equal(readFrom('/dashboard/facilities/staff?role=admin'), '/dashboard/facilities/staff?role=admin');

  // Nothing to go back to.
  assert.equal(readFrom(undefined), null);
  assert.equal(readFrom(''), null);

  // Off-site. `//evil.example` is the one that matters: browsers resolve a
  // protocol-relative URL against the current scheme, so it leaves the app while
  // looking like a path.
  assert.equal(readFrom('//evil.example'), null, 'protocol-relative is not a path');
  assert.equal(readFrom('https://evil.example/dashboard'), null);
  assert.equal(readFrom('javascript:alert(1)'), null);
  assert.equal(readFrom('/dashboard\\@evil.example'), null, 'backslash is normalised to / by some browsers');

  // Inside the app means inside `/dashboard`, not merely starting with the word.
  assert.equal(readFrom('/dashboardish'), null);
  assert.equal(readFrom('/sign-in'), null);

  // Control characters never appear in a path this app wrote.
  assert.equal(readFrom('/dashboard\nLocation: https://evil.example'), null);
  assert.equal(readFrom('/dashboard /x'), null);
});

test('a destination is named by what it is, and a site is not the list of sites', () => {
  assert.equal(backLabelKey('/dashboard'), 'common.backToDashboard');
  assert.equal(backLabelKey('/dashboard/facilities'), 'facilities.backToSites');

  // The pair the prefix table cannot separate on length alone.
  assert.equal(
    backLabelKey('/dashboard/facilities/6f2a-1b'),
    'facilities.backToSite',
    'one site, not the list',
  );
  assert.equal(backLabelKey('/dashboard/facilities/staff'), 'staff.backToStaff');
  assert.equal(backLabelKey('/dashboard/facilities/staff?role=admin'), 'staff.backToStaff');
  assert.equal(backLabelKey('/dashboard/facilities/pools/abc'), 'facilities.backToFacilities');

  assert.equal(backLabelKey('/dashboard/students'), 'students.backToRegister');
  assert.equal(backLabelKey('/dashboard/students/guardians'), 'students.backToGuardians');

  // A section this table has not heard of is still inside the dashboard, and
  // "Voltar ao painel" is true of it. A new section that forgets to add itself
  // here is announced vaguely, never wrongly.
  assert.equal(backLabelKey('/dashboard/unknown-section'), 'common.backToDashboard');

  // The bare fallback is unreachable through `readFrom`, which refuses anything
  // outside /dashboard. It exists so a future caller passing an arbitrary href
  // still gets a working control rather than an exception.
  assert.equal(backLabelKey('/somewhere-else'), 'common.back');
});

test('a page falls back to its own parent when it was not linked into', () => {
  assert.deepEqual(backTarget(undefined, '/dashboard'), {
    href: '/dashboard',
    labelKey: 'common.backToDashboard',
  });

  // A rejected origin is a fallback, never an error and never the origin.
  assert.deepEqual(backTarget('//evil.example', '/dashboard/facilities'), {
    href: '/dashboard/facilities',
    labelKey: 'facilities.backToSites',
  });

  assert.deepEqual(backTarget('/dashboard/facilities/abc', '/dashboard'), {
    href: '/dashboard/facilities/abc',
    labelKey: 'facilities.backToSite',
  });
});

test('stamping a link keeps whatever query it already had', () => {
  assert.equal(
    withFrom('/dashboard/students', '/dashboard/facilities/abc'),
    '/dashboard/students?from=%2Fdashboard%2Ffacilities%2Fabc',
  );

  // The role chip must survive: the link exists to open a filtered list.
  assert.equal(
    withFrom('/dashboard/facilities/staff?role=instructor', '/dashboard/facilities/abc'),
    '/dashboard/facilities/staff?role=instructor&from=%2Fdashboard%2Ffacilities%2Fabc',
  );

  // Round-trips: what a page stamps is what the destination will accept.
  const stamped = withFrom('/dashboard/students', '/dashboard/facilities/abc');
  const value = new URL(stamped, 'https://poolse.test').searchParams.get('from') ?? undefined;
  assert.equal(readFrom(value), '/dashboard/facilities/abc');
});
