import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enabledModules, moduleDependencyBreaches, POOLSE_MODULES } from './modules.js';

/** POOLSE-87 — which parts of Poolse a club has switched on. */

test('nothing switched off is the full product', () => {
  assert.deepEqual(enabledModules([]), [...POOLSE_MODULES]);
  assert.deepEqual(moduleDependencyBreaches([]), []);
});

test('the enabled list keeps list order and drops what is off', () => {
  assert.deepEqual(
    enabledModules(['energy', 'messages']),
    POOLSE_MODULES.filter((m) => m !== 'energy' && m !== 'messages'),
  );
});

test('invoicing off while reception is on is a breach, naming both', () => {
  assert.deepEqual(moduleDependencyBreaches(['invoicing']), [
    { module: 'reception', requires: 'invoicing' },
  ]);
});

test('both off, or only reception off, is consistent', () => {
  assert.deepEqual(moduleDependencyBreaches(['invoicing', 'reception']), []);
  assert.deepEqual(moduleDependencyBreaches(['reception']), []);
});
