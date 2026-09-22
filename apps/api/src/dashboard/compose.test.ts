import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeDashboard, ONBOARDING_WIDGET_ID, type Dashboard } from './compose.js';
import type { ResolverContext, WidgetDefinition } from './widget-registry.js';

/**
 * What the page does when a widget misbehaves — POOLSE-66, slice 1.
 *
 * Proved against resolvers that throw, hang and return nothing, rather than
 * against the real catalogue: the rules being tested are the *page's*, and the
 * only honest way to test "one resolver fell over" is a resolver that falls
 * over. No database, so this runs in milliseconds.
 *
 * Run: pnpm api:test
 */

const CTX: ResolverContext = {
  organizationId: '00000000-0000-0000-0000-0000000000aa',
  membershipId: '00000000-0000-0000-0000-0000000000bb',
  roles: ['owner'],
  facilityIds: [],
  scope: { mode: 'all', facilityId: null },
  locale: 'pt-PT',
};

const SITE = [{ id: '00000000-0000-0000-0000-0000000000cc', name: 'Sede' }];

function widget(over: Partial<WidgetDefinition> & { id: string }): WidgetDefinition {
  return {
    band: 'management',
    roles: ['owner'],
    scope: 'tenant',
    size: 1,
    priority: 10,
    resolver: () => Promise.resolve({ ok: true }),
    ...over,
  };
}

async function compose(
  registry: WidgetDefinition[],
  over: Partial<Parameters<typeof composeDashboard>[1]> = {},
): Promise<Dashboard> {
  return composeDashboard(CTX, {
    kind: 'business',
    sites: SITE,
    selector: SITE,
    registry,
    timeoutMs: 40,
    ...over,
  });
}

function card(page: Dashboard, id: string): { state: string; data: unknown } | undefined {
  return page.bands.flatMap((band) => band.widgets).find((one) => one.id === id);
}

test('one resolver falling over costs that widget and nothing else', async () => {
  const page = await compose([
    widget({ id: 'mgmt.good' }),
    widget({ id: 'mgmt.broken', resolver: () => Promise.reject(new Error('column "cs" missing')) }),
    widget({ id: 'mgmt.alsogood', priority: 5 }),
  ]);

  assert.equal(card(page, 'mgmt.broken')?.state, 'error');
  assert.equal(card(page, 'mgmt.broken')?.data, null, 'and it carries no half-built data');
  assert.equal(card(page, 'mgmt.good')?.state, 'ok');
  assert.equal(card(page, 'mgmt.alsogood')?.state, 'ok');
});

test('a resolver that hangs is an error on its own card, not a page that waits', async () => {
  const started = Date.now();
  const page = await compose([
    widget({ id: 'mgmt.slow', resolver: () => new Promise(() => {}) }),
    widget({ id: 'mgmt.quick' }),
  ]);

  assert.equal(card(page, 'mgmt.slow')?.state, 'error');
  assert.equal(card(page, 'mgmt.quick')?.state, 'ok');
  // Resolvers run in parallel, so the page costs one timeout, not one each.
  assert.ok(Date.now() - started < 400, 'the page did not wait on them in turn');
});

test('nothing to show is empty, which is not an error', async () => {
  const page = await compose([
    widget({ id: 'mgmt.none', resolver: () => Promise.resolve(null) }),
    /*
     * And a resolver answering `0` or `false` has answered. Testing falsiness
     * rather than null is how "zero outstanding" becomes "could not load".
     */
    widget({ id: 'mgmt.zero', resolver: () => Promise.resolve(0) }),
    widget({ id: 'mgmt.false', resolver: () => Promise.resolve(false) }),
  ]);

  assert.equal(card(page, 'mgmt.none')?.state, 'empty');
  assert.equal(card(page, 'mgmt.zero')?.state, 'ok');
  assert.equal(card(page, 'mgmt.false')?.state, 'ok');
});

test('a band is absent when the reader holds no role in it', async () => {
  const page = await compose([
    widget({ id: 'mgmt.one' }),
    widget({ id: 'inst.one', band: 'operational', roles: ['instructor'] }),
  ]);

  assert.deepEqual(
    page.bands.map((band) => band.id),
    ['management'],
    'not present-and-empty — the client should not have to tell those apart',
  );
  assert.equal(page.bands[0]!.order, 0);
});

test('bands render in their fixed order whatever order the registry is written in', async () => {
  const page = await composeDashboard(
    { ...CTX, roles: ['owner', 'instructor', 'guardian'] },
    {
      kind: 'business',
      sites: SITE,
      selector: SITE,
      timeoutMs: 40,
      registry: [
        widget({ id: 'me.one', band: 'personal', roles: ['guardian'] }),
        widget({ id: 'inst.one', band: 'operational', roles: ['instructor'] }),
        widget({ id: 'mgmt.one', roles: ['owner'] }),
      ],
    },
  );

  assert.deepEqual(
    page.bands.map((band) => band.id),
    ['management', 'operational', 'personal'],
  );
  assert.deepEqual(
    page.bands.map((band) => band.order),
    [0, 1, 2],
  );

  // A person holding three roles sees each widget once.
  const ids = page.bands.flatMap((band) => band.widgets.map((one) => one.id));
  assert.equal(new Set(ids).size, ids.length);
});

test('a band keeps four, by priority, and ties do not shuffle between requests', async () => {
  const registry = [1, 2, 3, 4, 5, 6].map((n) =>
    widget({ id: `mgmt.w${n}`, priority: n === 6 ? 100 : 10 }),
  );

  const first = await compose(registry);
  const second = await compose([...registry].reverse());

  const ids = (page: Dashboard): string[] => page.bands[0]!.widgets.map((one) => one.id);

  assert.equal(ids(first).length, 4);
  assert.equal(ids(first)[0], 'mgmt.w6', 'priority decides');
  assert.deepEqual(ids(first), ids(second), 'and a tie breaks on the id, not on the file order');
});

test('an escalation can still change which four a band keeps', async () => {
  /*
   * The ticket's "priority boosted when the trial is under five days". It is a
   * predicate on the resolved data, so it can only be applied after resolving —
   * which is why every allowed widget resolves, not only the four that would
   * have survived a cap decided in advance.
   */
  const registry = [
    ...[1, 2, 3, 4].map((n) => widget({ id: `mgmt.w${n}`, priority: 50 })),
    widget({
      id: 'mgmt.trial',
      priority: 10,
      resolver: () => Promise.resolve({ daysLeft: 3 }),
      escalate: (data) => (data as { daysLeft: number }).daysLeft < 5,
      escalatedPriority: 90,
    }),
  ];

  const urgent = await compose(registry);
  assert.equal(urgent.bands[0]!.widgets[0]!.id, 'mgmt.trial', 'it floats to the top');

  // And without the escalation it is cut by the cap, which is the point of the
  // cap: four things somebody reads beats six things they scroll past.
  const calm = await compose(
    registry.map((one) =>
      one.id === 'mgmt.trial'
        ? { ...one, resolver: () => Promise.resolve({ daysLeft: 40 }) }
        : one,
    ),
  );
  assert.equal(card(calm, 'mgmt.trial'), undefined);
});

test('a club with no sites gets the checklist and nothing else', async () => {
  const registry = [
    widget({ id: ONBOARDING_WIDGET_ID, priority: 100 }),
    widget({ id: 'mgmt.money' }),
    widget({ id: 'inst.one', band: 'operational', roles: ['owner'] }),
  ];

  const bare = await compose(registry, { sites: [], selector: [] });
  assert.deepEqual(
    bare.bands.flatMap((band) => band.widgets.map((one) => one.id)),
    [ONBOARDING_WIDGET_ID],
    'no empty cards beside it',
  );

  // And the other direction, so the two halves cannot drift: a club with a site
  // never sees the checklist.
  const running = await compose(registry);
  assert.equal(card(running, ONBOARDING_WIDGET_ID), undefined);
  assert.equal(card(running, 'mgmt.money')?.state, 'ok');
});

test('the scope travels back with the page', async () => {
  const one = SITE[0]!;
  const page = await composeDashboard(
    { ...CTX, scope: { mode: 'facility', facilityId: one.id } },
    { kind: 'business', sites: SITE, selector: SITE, registry: [widget({ id: 'mgmt.one' })] },
  );

  assert.deepEqual(page.scope, { mode: 'facility', facilityId: one.id, facilities: SITE });
});
