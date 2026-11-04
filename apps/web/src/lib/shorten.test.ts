import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shorten } from './shorten.ts';

test('a text that fits is left alone', () => {
  assert.equal(shorten('Golfinhos', 22), 'Golfinhos');
  assert.equal(shorten('', 22), '');
});

test('a long text keeps its start and ends in one ellipsis', () => {
  const out = shorten('Hidroginástica Sénior', 12);
  assert.equal(out, 'Hidroginást…');
  assert.ok(Array.from(out).length <= 12);
});

test('no space is left before the ellipsis', () => {
  assert.equal(shorten('Ref · Aperfeiçoamento 2', 6), 'Ref ·…');
});
