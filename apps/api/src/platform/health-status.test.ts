import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DependencyCheck, Health } from '../health/health.controller.js';

/**
 * `/health`'s overall verdict, as a rule rather than as a trip to a database.
 *
 * The controller composes it from three checks it runs in parallel; what is
 * worth asserting is the composition, because that is where the load-bearing
 * asymmetry lives — **only Postgres can make this `down`**. A product whose
 * deploy rolls back because its sign-in provider had a bad minute is a product
 * that rolls back during every one of its provider's bad minutes.
 *
 * Mirrored from the controller rather than imported, deliberately: importing it
 * would pull in `@poolse/db` and open a pool for a test about three strings. The
 * cost is that the two can drift, which is why the shapes are typed against the
 * controller's own exported interfaces — a renamed status breaks this file at
 * `tsc` rather than at runtime.
 */
function verdict(checks: DependencyCheck[]): Health['status'] {
  const postgres = checks.find((check) => check.name === 'postgres');
  const down = postgres?.status === 'failing';
  const degraded = checks.some((c) => c.status === 'failing' || c.status === 'slow');
  return down ? 'down' : degraded ? 'degraded' : 'ok';
}

const ok = (name: string): DependencyCheck => ({ name, status: 'ok', latencyMs: 4 });

test('everything answering is ok', () => {
  assert.equal(verdict([ok('postgres'), ok('timescale'), ok('clerk')]), 'ok');
});

test('Postgres failing is down', () => {
  assert.equal(
    verdict([
      { name: 'postgres', status: 'failing', latencyMs: 3000 },
      ok('timescale'),
      ok('clerk'),
    ]),
    'down',
  );
});

test('one other dependency failing is degraded, never down', () => {
  /*
   * Clerk is the case this is about. Sign-in stops working and that is serious —
   * but the deploy pipeline reads the status code, and answering 503 here would
   * roll a good release back for somebody else's outage.
   */
  assert.equal(
    verdict([ok('postgres'), ok('timescale'), { name: 'clerk', status: 'failing', latencyMs: 3000 }]),
    'degraded',
  );
});

test('slow is degraded, so a database going sour is visible before it stops', () => {
  assert.equal(
    verdict([{ name: 'postgres', status: 'slow', latencyMs: 900 }, ok('timescale'), ok('clerk')]),
    'degraded',
  );
});

test('not_installed is neither degraded nor down', () => {
  /*
   * TimescaleDB is deliberately absent until the hosting question in
   * docs/decisions.md (2026-09-11) is settled. A considered absence drawn as a
   * fault is how an operator learns to stop reading the strip — and it would
   * mean `/admin` reported "degraded" for every minute of the product's life so
   * far.
   */
  assert.equal(
    verdict([
      ok('postgres'),
      { name: 'timescale', status: 'not_installed', latencyMs: 2 },
      { name: 'clerk', status: 'not_installed', latencyMs: 0 },
    ]),
    'ok',
  );
});
