import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beginBusy, currentBlocking, currentBusy, endBusy, trackBusy } from './busy.ts';

/**
 * The busy store — POOLSE-98. When the corner shows is the indicator's rule
 * (400 ms, then at least 300 ms); what is running is decided here, and two
 * things at once must count as two.
 *
 * Run: pnpm web:test
 */

test('two things at once stay busy until both have ended, and the latest names the corner', () => {
  assert.equal(currentBusy(), null);

  const page = beginBusy('load');
  assert.equal(currentBusy(), 'load');
  const save = beginBusy('save');
  assert.equal(currentBusy(), 'save', 'the most recent thing names the corner');

  endBusy(save);
  assert.equal(currentBusy(), 'load', 'ending one leaves the other');
  // An end that is not running — twice, or never begun — changes nothing.
  endBusy(save);
  endBusy(9_999_999);
  assert.equal(currentBusy(), 'load');

  endBusy(page);
  assert.equal(currentBusy(), null);
});

test('a tracked task ends however it ends', async () => {
  await assert.rejects(trackBusy('export', async () => Promise.reject(new Error('refused'))));
  assert.equal(currentBusy(), null, 'a refusal still ends it');

  let during: string | null = null;
  const value = await trackBusy('export', async () => {
    during = currentBusy();
    return 42;
  });
  assert.equal(during, 'export');
  assert.equal(value, 42);
  assert.equal(currentBusy(), null);
});

test('only a save or a navigation washes the page; a read never does — POOLSE-159', async () => {
  const list = beginBusy('load');
  assert.equal(currentBlocking(), false, 'a fetch is a read');
  await trackBusy('export', async () => assert.equal(currentBlocking(), false, 'an export is a read'));

  const save = beginBusy('save');
  assert.equal(currentBlocking(), true, 'a save writes by default');
  endBusy(save);
  assert.equal(currentBlocking(), false, 'gone the moment it ends');

  const link = beginBusy('load', 'navigate');
  assert.equal(currentBusy(), 'load', 'the corner still says loading');
  assert.equal(currentBlocking(), true, 'a page on its way washes');
  endBusy(link);
  endBusy(list);
  assert.equal(currentBlocking(), false);
  assert.equal(currentBusy(), null);
});
