import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  backLabelKey,
  backTarget,
  currentHref,
  originBack,
  readFrom,
  stampFrom,
  withFrom,
} from './back.ts';

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

test('the destinations POOLSE-91 added are named, and a sub-section is never a record', () => {
  // The six the ticket names.
  assert.equal(backLabelKey('/dashboard/profile'), 'back.toProfile');
  assert.equal(backLabelKey('/dashboard/profile?tab=support'), 'back.toProfile');
  assert.equal(backLabelKey('/dashboard/profile/subscription'), 'back.toSubscription');
  assert.equal(backLabelKey('/dashboard/students/pedidos?section=queue'), 'back.toRequests');
  assert.equal(
    backLabelKey('/dashboard/facilities/staff/qualifications?section=attention&page=2'),
    'back.toQualifications',
  );
  assert.equal(backLabelKey('/dashboard/facilities/incidents?site=abc'), 'incidents.backToList');

  // A task, a space and an incident were once announced as "the site": the
  // record rule read any unknown segment under /facilities as a site id.
  assert.equal(backLabelKey('/dashboard/facilities/tasks/6f2a-1b'), 'back.toTask');
  assert.equal(backLabelKey('/dashboard/facilities/spaces/6f2a-1b'), 'back.toSpace');
  assert.equal(backLabelKey('/dashboard/facilities/incidents/6f2a-1b'), 'incidents.backToList');
  assert.equal(backLabelKey('/dashboard/facilities/6f2a-1b?tab=maintenance'), 'facilities.backToSite');

  // One student, one turma, one document — and their sections are not records.
  assert.equal(backLabelKey('/dashboard/students/6f2a-1b?tab=fees'), 'back.toStudent');
  assert.equal(backLabelKey('/dashboard/students/guardians'), 'students.backToGuardians');
  assert.equal(backLabelKey('/dashboard/classes/6f2a-1b'), 'back.toClass');
  assert.equal(backLabelKey('/dashboard/classes/seasons'), 'back.toSeasons');
  assert.equal(backLabelKey('/dashboard/faturacao/6f2a-1b'), 'back.toInvoice');
  assert.equal(backLabelKey('/dashboard/faturacao?view=outstanding'), 'invoices.backToList');
});

test('a menu page has a way back only when it was linked into', () => {
  assert.equal(originBack(undefined), undefined, 'opened from the menu');
  assert.equal(originBack('https://evil.example'), undefined, 'a forged origin is no origin');
  assert.deepEqual(originBack('/dashboard/facilities/abc?tab=people'), {
    href: '/dashboard/facilities/abc?tab=people',
    labelKey: 'facilities.backToSite',
  });
});

test('the origin is the whole page: path, tab, section, page, filters and its own from', () => {
  assert.equal(currentHref('/dashboard', {}), '/dashboard');
  assert.equal(
    currentHref('/dashboard/facilities/staff/qualifications', { section: 'attention', page: '2' }),
    '/dashboard/facilities/staff/qualifications?section=attention&page=2',
  );
  assert.equal(
    currentHref('/dashboard/facilities/abc', new URLSearchParams('tab=maintenance&from=%2Fdashboard')),
    '/dashboard/facilities/abc?tab=maintenance&from=%2Fdashboard',
  );
});

test('a link to another page carries this one; a link to this page carries its origin on', () => {
  const here = new URLSearchParams('tab=maintenance&from=%2Fdashboard');

  // dashboard → site → task: the task learns the site, tab and the site's own origin.
  const task = stampFrom('/dashboard/facilities/tasks/t1', '/dashboard/facilities/abc', here);
  const back = new URL(task, 'https://poolse.test').searchParams.get('from') ?? undefined;
  assert.equal(readFrom(back), '/dashboard/facilities/abc?tab=maintenance&from=%2Fdashboard');
  // … and Voltar from the site, once back on it, is the dashboard.
  const site = new URL(back ?? '', 'https://poolse.test').searchParams.get('from') ?? undefined;
  assert.equal(readFrom(site), '/dashboard');

  // Another tab, or page 2, of the same page: not its own origin.
  assert.equal(
    stampFrom('/dashboard/facilities/abc?tab=pools', '/dashboard/facilities/abc', here),
    '/dashboard/facilities/abc?tab=pools&from=%2Fdashboard',
  );
  assert.equal(
    stampFrom('/dashboard/students?page=2', '/dashboard/students', new URLSearchParams()),
    '/dashboard/students?page=2',
  );

  // Untouched: outside the app, or a link that already says where it is from.
  assert.equal(stampFrom('mailto:a@b.pt', '/dashboard', here), 'mailto:a@b.pt');
  assert.equal(stampFrom('/files/x', '/dashboard', here), '/files/x');
  assert.equal(stampFrom('/dashboard/x?from=%2Fdashboard', '/dashboard/y', here), '/dashboard/x?from=%2Fdashboard');
});

test('a chain that loops forgets its oldest hops instead of growing without end', () => {
  let origin = '/dashboard';
  for (let hop = 0; hop < 40; hop++) {
    const page = hop % 2 === 0 ? '/dashboard/facilities/abc' : '/dashboard/facilities/staff';
    const href = withFrom(page, origin);
    origin = currentHref(page, new URL(href, 'https://poolse.test').searchParams);
  }
  assert.ok(origin.length < 6000, `grew to ${origin.length}`);
  assert.notEqual(readFrom(origin), null, 'still a usable origin');
});
