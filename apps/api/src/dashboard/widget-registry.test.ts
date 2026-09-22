import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertRegistryIsSound,
  BANDS,
  widgetsFor,
  WIDGETS,
  type WidgetDefinition,
} from './widget-registry.js';

/**
 * The registry's own rules — POOLSE-66, slice 1.
 *
 * Every mistake asserted here produces **nothing on screen** rather than an
 * error, which is why they are worth a test at all: a duplicate id renders one
 * card twice, an empty `roles` list makes a widget nobody ever sees, and a
 * facility-scoped widget offered to a role whose sites are not derived yet
 * resolves against an empty list and reports "nothing here" for ever.
 *
 * Gating is tested here rather than through the endpoint because it is a pure
 * function of the registry and the reader. The endpoint's own test then only has
 * to prove that it *uses* this — not to re-derive every combination against a
 * database.
 *
 * Run: pnpm api:test
 */

function widget(over: Partial<WidgetDefinition> & { id: string }): WidgetDefinition {
  return {
    band: 'management',
    roles: ['owner'],
    scope: 'tenant',
    size: 1,
    priority: 10,
    resolver: () => Promise.resolve({}),
    ...over,
  };
}

test('the real registry obeys its own rules', () => {
  assertRegistryIsSound();

  // And every id is dotted, which is what the client keys its rendering on.
  for (const one of WIDGETS) assert.match(one.id, /^[a-z]+\.[a-z.]+$/);
});

test('a widget is offered only to the roles that hold it', () => {
  const registry = [
    widget({ id: 'mgmt.one', roles: ['owner', 'admin'] }),
    widget({ id: 'inst.one', band: 'operational', roles: ['instructor'] }),
    widget({ id: 'me.one', band: 'personal', roles: ['student', 'guardian'] }),
  ];

  const ids = (roles: string[]): string[] =>
    widgetsFor({ roles, kind: 'business' }, registry).map((one) => one.id);

  assert.deepEqual(ids(['admin']), ['mgmt.one']);
  assert.deepEqual(ids(['instructor']), ['inst.one']);
  assert.deepEqual(ids(['guardian']), ['me.one']);

  /*
   * The union, which is the whole model: a club owner who also teaches on
   * Tuesdays is ordinary here, and gets both — once each.
   */
  assert.deepEqual(ids(['owner', 'instructor']).sort(), ['inst.one', 'mgmt.one']);
  assert.deepEqual(ids([]), []);
});

test('a widget can be meaningless in a personal tenant, and then it is absent', () => {
  const registry = [
    widget({ id: 'mgmt.money', kinds: ['business'] }),
    widget({ id: 'me.pool', kinds: ['personal'] }),
    // No `kinds` means every kind — the same reading `app-sidebar.tsx` gives it.
    widget({ id: 'mgmt.subscription' }),
  ];

  const ids = (kind: 'business' | 'personal'): string[] =>
    widgetsFor({ roles: ['owner'], kind }, registry).map((one) => one.id);

  assert.deepEqual(ids('business').sort(), ['mgmt.money', 'mgmt.subscription']);
  assert.deepEqual(ids('personal').sort(), ['me.pool', 'mgmt.subscription']);
});

test('a flagged widget exists only when its variable says true', () => {
  const registry = [widget({ id: 'me.fees', featureFlag: 'DASHBOARD_PERSONAL_BAND' })];
  const ids = (env: NodeJS.ProcessEnv): string[] =>
    widgetsFor({ roles: ['owner'], kind: 'business' }, registry, env).map((one) => one.id);

  assert.deepEqual(ids({}), [], 'unset is off');
  assert.deepEqual(ids({ DASHBOARD_PERSONAL_BAND: '' }), []);
  assert.deepEqual(ids({ DASHBOARD_PERSONAL_BAND: 'false' }), []);
  assert.deepEqual(ids({ DASHBOARD_PERSONAL_BAND: '1' }), [], 'only the word true');
  assert.deepEqual(ids({ DASHBOARD_PERSONAL_BAND: ' true ' }), ['me.fees']);
});

test('the four ways a registry entry is wrong are refused', () => {
  const cases: [string, WidgetDefinition[]][] = [
    ['a duplicate id', [widget({ id: 'mgmt.one' }), widget({ id: 'mgmt.one' })]],
    [
      'an unknown band',
      [widget({ id: 'mgmt.one', band: 'financial' as unknown as (typeof BANDS)[number] })],
    ],
    ['no roles at all', [widget({ id: 'mgmt.one', roles: [] })]],
    ['an unknown role', [widget({ id: 'mgmt.one', roles: ['manager' as 'owner'] })]],
    ['four columns', [widget({ id: 'mgmt.one', size: 4 as 3 })]],
    /*
     * The one that would fail silently in production: an instructor's
     * `facilityIds` is empty until slice 3 derives it, so a facility-scoped
     * widget offered to them would resolve against nothing and report "no
     * classes" to somebody who teaches four.
     */
    [
      'facility scope for a role whose sites are not derived yet',
      [widget({ id: 'inst.one', band: 'operational', roles: ['instructor'], scope: 'facility' })],
    ],
  ];

  for (const [what, registry] of cases) {
    assert.throws(() => assertRegistryIsSound(registry), new RegExp(''), `${what} should refuse`);
  }

  // And the same widget for a role whose sites *are* derived is fine.
  assert.doesNotThrow(() =>
    assertRegistryIsSound([widget({ id: 'mgmt.one', scope: 'facility', roles: ['owner'] })]),
  );
});
