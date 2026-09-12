import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveHealth, HEALTH_ORDER, RED_5XX_RATE } from './tenant-health.js';

/**
 * The four verdicts, and the boundary between the two that matter.
 *
 * A pure function with a database behind it in production, so these are the
 * cheapest tests in the module and the ones that would catch a threshold edited
 * to `>` instead of `>=` — which is invisible on every tenant except the one
 * sitting exactly on 2%.
 */

const none = { requestCount: 0, count4xx: 0, count5xx: 0, lastWasError: false };

test('no requests in the window is unknown, never green', () => {
  assert.equal(deriveHealth(none), 'unknown');

  /*
   * A tenant nobody used is a different fact from a tenant that worked
   * perfectly, and often a more interesting one. Collapsing them would make a
   * club that stopped logging in look healthy.
   */
  assert.notEqual(deriveHealth(none), 'green');
});

test('no 5xx is green, whatever the 4xx count', () => {
  assert.equal(
    deriveHealth({ requestCount: 500, count4xx: 0, count5xx: 0, lastWasError: false }),
    'green',
  );

  // A client sending a bad page number or meeting a 403 is the API working.
  // Counting that as ill-health would make the strictest tenant look the sickest.
  assert.equal(
    deriveHealth({ requestCount: 500, count4xx: 120, count5xx: 0, lastWasError: false }),
    'green',
  );
});

test('a few 5xx under the threshold is amber', () => {
  // 1 in 500 = 0.2%, well under 2%.
  assert.equal(
    deriveHealth({ requestCount: 500, count4xx: 0, count5xx: 1, lastWasError: false }),
    'amber',
  );
});

test('at or above the threshold is red, and the boundary is inclusive', () => {
  // Exactly 2% of 500 is 10. `>=`, so ten is red and nine is amber — the one
  // assertion that catches a `>` typed for a `>=`.
  assert.equal(
    deriveHealth({ requestCount: 500, count4xx: 0, count5xx: 10, lastWasError: false }),
    'red',
  );
  assert.equal(
    deriveHealth({ requestCount: 500, count4xx: 0, count5xx: 9, lastWasError: false }),
    'amber',
  );

  // And the constant is what the test is measured against, so tuning it moves
  // both together rather than making this fail for the wrong reason.
  const atThreshold = Math.ceil(500 * RED_5XX_RATE);
  assert.equal(
    deriveHealth({ requestCount: 500, count4xx: 0, count5xx: atThreshold, lastWasError: false }),
    'red',
  );
});

test('the newest request failing is red on its own', () => {
  /*
   * The case the rate alone cannot catch, and the reason this rule exists. A
   * tenant whose API started failing a minute ago has one 5xx against a thousand
   * good requests — 0.1%, comfortably green — and is on fire.
   */
  assert.equal(
    deriveHealth({ requestCount: 1000, count4xx: 0, count5xx: 1, lastWasError: true }),
    'red',
  );

  // Even with no 5xx counted yet in the window: the flush that recorded the
  // error and the flush that incremented the counter are the same write, but a
  // 4xx-only tenant whose newest request failed is still worth a red.
  assert.equal(
    deriveHealth({ requestCount: 10, count4xx: 1, count5xx: 0, lastWasError: true }),
    'red',
  );
});

test('severity order puts red first and green last', () => {
  const sorted = (['green', 'unknown', 'red', 'amber'] as const)
    .slice()
    .sort((a, b) => HEALTH_ORDER[a] - HEALTH_ORDER[b]);

  // Worst first, and `unknown` between amber and green: a tenant nobody used is
  // not a problem, but it is more worth a glance than one that worked.
  assert.deepEqual(sorted, ['red', 'amber', 'unknown', 'green']);
});
