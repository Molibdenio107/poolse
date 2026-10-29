import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addonSports, enabledSports, mayCreateRecinto, POOLSE_SPORTS } from './sports.js';

/** POOLSE-124 — which sports a club has switched on. */

test('a pool club has the pool and nothing else', () => {
  assert.deepEqual(enabledSports({ enabledSports: ['pool'] }), ['pool']);
  assert.deepEqual(addonSports({ enabledSports: ['pool'] }), []);
});

test('the pool is always on, even from a list that forgot it', () => {
  assert.deepEqual(enabledSports({ enabledSports: [] }), ['pool']);
});

test('catalogue order, unknown keys dropped', () => {
  assert.deepEqual(enabledSports({ enabledSports: ['gym', 'curling', 'tennis', 'pool'] }), [
    'pool',
    'tennis',
    'gym',
  ]);
  assert.deepEqual(addonSports({ enabledSports: ['gym', 'pool', 'tennis'] }), ['tennis', 'gym']);
});

test('a recinto only for a sport that is on', () => {
  const club = { enabledSports: ['pool', 'padel'] };
  assert.equal(mayCreateRecinto('padel', club), true);
  assert.equal(mayCreateRecinto('pool', club), true);
  assert.equal(mayCreateRecinto('tennis', club), false);
  assert.equal(mayCreateRecinto('curling', { enabledSports: ['curling', ...POOLSE_SPORTS] }), false);
});
