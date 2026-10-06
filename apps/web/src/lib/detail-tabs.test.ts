import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTab, tabHref, visibleTabs } from './detail-tabs.ts';

/**
 * Which tab a detail page shows.
 *
 * The case worth a test is the hidden one: a restricted tab must be unreachable
 * by URL as well as absent from the strip, or "hidden, not disabled" is a
 * promise only the strip keeps.
 *
 * Run: pnpm web:test
 */

const TABS = [
  { slug: 'general', labelKey: 'a' },
  { slug: 'prices', labelKey: 'b', visible: false },
  { slug: 'pools', labelKey: 'c', visible: true },
];

test('a known, visible slug is honoured', () => {
  assert.equal(resolveTab(TABS, 'pools')?.slug, 'pools');
});

test('missing, unknown and repeated slugs fall back to the first tab', () => {
  assert.equal(resolveTab(TABS, undefined)?.slug, 'general');
  assert.equal(resolveTab(TABS, 'nope')?.slug, 'general');
  assert.equal(resolveTab(TABS, ['pools', 'general'])?.slug, 'pools');
});

test('a hidden tab cannot be reached by typing its slug', () => {
  assert.equal(resolveTab(TABS, 'prices')?.slug, 'general');
  assert.deepEqual(
    visibleTabs(TABS).map((tab) => tab.slug),
    ['general', 'pools'],
  );
});

test('the first visible tab is the fallback even when the first tab is hidden', () => {
  assert.equal(resolveTab(TABS.slice(1), undefined)?.slug, 'pools');
  assert.equal(resolveTab([{ slug: 'x', labelKey: 'x', visible: false }], 'x'), null);
});

test('switching tab keeps from and drops the previous list page', () => {
  assert.equal(
    tabHref('/dashboard/facilities/spaces/1', 'from=%2Fdashboard&page=3&tab=history', 'issues'),
    '/dashboard/facilities/spaces/1?from=%2Fdashboard&tab=issues',
  );
  assert.equal(tabHref('/x', '', 'general'), '/x?tab=general');
});
