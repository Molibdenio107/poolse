import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicInvitationTracker } from './throttle.js';

/**
 * The invitation preview's bucket — 29-10-2026. `GET /join/preview` is public,
 * so it is throttled per token rather than per user (there is none) or per IP
 * (the Next server is one address for every visitor), the shape of the water
 * page and the opt-out link.
 */

const at = (path: string, query: Record<string, unknown> = {}) =>
  publicInvitationTracker({ path, query } as never);

test('the preview is bucketed by its token', () => {
  assert.equal(at('/join/preview', { token: 'abc' }), 'invitation:abc');
  assert.equal(at('/join/preview/', { token: 'abc' }), 'invitation:abc');
});

test('no token, or a token sent twice, is one shared bucket', () => {
  assert.equal(at('/join/preview'), 'invitation:none');
  assert.equal(at('/join/preview', { token: ['a', 'b'] }), 'invitation:none');
});

test('every other path, accepting included, is left to the other trackers', () => {
  assert.equal(at('/join', { token: 'abc' }), null);
  assert.equal(at('/join/preview/extra', { token: 'abc' }), null);
  assert.equal(at('/public/water/abc'), null);
});
