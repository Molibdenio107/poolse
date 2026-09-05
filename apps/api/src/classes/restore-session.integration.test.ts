import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ClassesController } from './classes.controller.js';
import { SessionsCalendarController } from './sessions.controller.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';
import type { ScratchTenant } from '../test/harness.js';

/**
 * Putting a cancelled occurrence back — round 5, ticket 9.6.
 *
 * This endpoint was removed on purpose in backlog round 3, story 5, and is back
 * on Rui's explicit call so the cancel toast can offer an Undo. These tests are
 * the other half of "on purpose": the reversal is recorded in
 * `docs/decisions.md`, and the two rules that make it safe are pinned here.
 *
 * **The closure test is the one that matters.** A class cancelled because the
 * pool is shut must not be restorable from a toast — the pool is still shut, and
 * `generate_sessions` is what brings those back when the closure is lifted.
 * Getting this wrong would let one operator quietly put children in the water on
 * a day the building is closed.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/** A turma with one session on the grid, and that session's id. */
async function oneSession(tenant: ScratchTenant): Promise<{ sessionId: string; poolId: string }> {
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind)
     VALUES ($1, $2, 'Tanque Grande', 'indoor') RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );

  const { id } = await actingAs(tenant, { roles: ['owner'] }, async () =>
    new ClassesController().create({ name: 'Cadetes', poolId: pool!.id, lane: 1 }),
  );

  const [session] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_session
       (organization_id, class_group_id, pool_id, starts_at, duration_minutes, occurs_on)
     VALUES ($1, $2, $3, now() + interval '7 days', 45,
             (now() + interval '7 days')::date)
     RETURNING id`,
    [tenant.organizationId, id, pool!.id],
  );

  return { sessionId: session!.id, poolId: pool!.id };
}

test('9.6 — a cancelled class can be put back, once', async () => {
  await withScratchTenant(async (tenant) => {
    const { sessionId } = await oneSession(tenant);
    const sessions = new SessionsCalendarController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await sessions.cancel(sessionId, {});

      const [cancelled] = await tenant.sql<{ status: string }>(
        `SELECT status FROM class_session WHERE id = $1`,
        [sessionId],
      );
      assert.equal(cancelled?.status, 'cancelled');

      assert.deepEqual(await sessions.restore(sessionId), { restored: true });

      const [back] = await tenant.sql<{ status: string; reason: string | null }>(
        `SELECT status, cancellation_reason AS reason FROM class_session WHERE id = $1`,
        [sessionId],
      );
      assert.equal(back?.status, 'scheduled');
      assert.equal(back?.reason, null, 'the reason goes with the cancellation');

      // The Undo can only be pressed once. A second press is a 404 rather than
      // an error worth showing anybody twice.
      await expectStatus(() => sessions.restore(sessionId), 404);
    });
  });
});

test('9.6 — a class cancelled by a closure is not restored from a toast', async () => {
  await withScratchTenant(async (tenant) => {
    const { sessionId } = await oneSession(tenant);

    /*
     * Cancelled *by a closure*: the pool is shut. These come back on their own
     * when the closure is lifted, in SQL, and one operator pressing Undo must
     * not be able to overrule the building being closed.
     */
    const [closure] = await tenant.sql<{ id: string }>(
      `INSERT INTO closure (organization_id, facility_id, starts_on, ends_on, reason, source)
       VALUES ($1, $2, CURRENT_DATE, CURRENT_DATE, 'Obras', 'manual') RETURNING id`,
      [tenant.organizationId, tenant.facilityId],
    );

    await tenant.sql(
      `UPDATE class_session SET status = 'cancelled', closure_id = $2 WHERE id = $1`,
      [sessionId, closure!.id],
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await expectStatus(() => new SessionsCalendarController().restore(sessionId), 409);
    });

    const [still] = await tenant.sql<{ status: string }>(
      `SELECT status FROM class_session WHERE id = $1`,
      [sessionId],
    );
    assert.equal(still?.status, 'cancelled', 'the pool is still shut');
  });
});

test('9.6 — restoring is owner and admin, narrower than cancelling', async () => {
  await withScratchTenant(async (tenant) => {
    const { sessionId } = await oneSession(tenant);
    const sessions = new SessionsCalendarController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await sessions.cancel(sessionId, {});
    });

    /*
     * Deliberately narrower than cancel. An instructor may call off their own
     * class; putting one back undoes somebody else's decision as often as your
     * own, so it belongs with the roles that own the timetable.
     */
    for (const role of ['instructor', 'maintenance', 'student', 'guardian'] as const) {
      await actingAs(tenant, { roles: [role] }, async () => {
        await expectStatus(() => sessions.restore(sessionId), 403);
      });
    }

    const [still] = await tenant.sql<{ status: string }>(
      `SELECT status FROM class_session WHERE id = $1`,
      [sessionId],
    );
    assert.equal(still?.status, 'cancelled');
  });
});
