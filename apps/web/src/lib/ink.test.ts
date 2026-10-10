import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inkFor } from './ink.ts';

test('a pale partner colour gets dark text, a deep one white', () => {
  assert.equal(inkFor('#f5e663'), 'rgb(12 18 21)');
  assert.equal(inkFor('#fff'), 'rgb(12 18 21)');
  assert.equal(inkFor('#1d3557'), 'rgb(255 255 255)');
  assert.equal(inkFor('#000000'), 'rgb(255 255 255)');
});

test('something that is not a hex colour has no answer', () => {
  assert.equal(inkFor('blue'), null);
  assert.equal(inkFor('#12345'), null);
});
