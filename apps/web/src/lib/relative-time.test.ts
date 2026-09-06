import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeAgo } from './relative-time.ts';

/**
 * The unit choice is the only real logic here, and it is the part that reads
 * wrongly when it is off by one step: "há 47 horas" is technically true and
 * nobody says it.
 */

const NOW = Date.parse('2026-09-06T18:00:00Z');
const ago = (ms: number): string => new Date(NOW - ms).toISOString();

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

test('picks the largest unit that fits', () => {
  assert.equal(timeAgo(ago(2 * DAY), 'pt-PT', NOW), 'há 2 dias');
  assert.equal(timeAgo(ago(5 * HOUR), 'pt-PT', NOW), 'há 5 horas');
  assert.equal(timeAgo(ago(90 * 1000), 'pt-PT', NOW), 'há 2 minutos');
});

test('rounds to the nearer unit, so 47 hours is two days', () => {
  assert.equal(timeAgo(ago(47 * HOUR), 'pt-PT', NOW), 'há 2 dias');
});

test('English is the same call with a different locale', () => {
  assert.equal(timeAgo(ago(2 * DAY), 'en', NOW), '2 days ago');
});

test('something that just happened reads in seconds, never "0 minutes"', () => {
  assert.equal(timeAgo(ago(4 * 1000), 'pt-PT', NOW), 'há 4 segundos');
});

/**
 * Clock skew is real: the server stamps `now()` and a browser a minute slow
 * renders the reply. "Cleaned in 1 minute" on a record of something that already
 * happened is worse than saying "just now".
 */
test('a future timestamp clamps to now rather than reading as the future', () => {
  const result = timeAgo(ago(-5 * 60 * 1000), 'pt-PT', NOW);
  assert.ok(result !== null && !result.includes('em '), `future leaked through: ${result}`);
});

test('nothing to show is null, not "Invalid Date"', () => {
  assert.equal(timeAgo(null, 'pt-PT', NOW), null);
  assert.equal(timeAgo('', 'pt-PT', NOW), null);
  assert.equal(timeAgo('not a date', 'pt-PT', NOW), null);
});
