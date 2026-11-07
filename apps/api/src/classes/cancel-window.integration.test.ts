import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ClassesController } from './classes.controller.js';
import { SessionsCalendarController } from './sessions.controller.js';
import { AttendanceController } from './attendance.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';
import type { ScratchTenant } from '../test/harness.js';

/**
 * When a lesson may be called off — Rui, 02-11-2026.
 *
 * Until it ends, by whoever may cancel it at all, even with marks (which are
 * kept). Once it has ended, only an owner or an admin, and only a lesson nobody
 * marked. The register read's `canCancel` gives the same answer as the POST.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

interface Fixture {
  instructor: string;
  /** A lesson at `offset` from now, taught by the instructor, optionally marked. */
  lesson: (offset: string, marked: boolean) => Promise<string>;
}

async function fixture(tenant: ScratchTenant): Promise<Fixture> {
  const instructor = await addMember(tenant, 'Sandra', 'Moreira', ['instructor']);
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind)
     VALUES ($1, $2, 'Tanque Grande', 'indoor') RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );
  const { id: turma } = await actingAs(tenant, { roles: ['owner'] }, async () =>
    new ClassesController().create({ name: 'Cadetes', poolId: pool!.id, lane: 1 }),
  );
  const [student] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name)
     VALUES ($1, 'Ana', 'Martins') RETURNING id`,
    [tenant.organizationId],
  );

  return {
    instructor,
    lesson: async (offset, marked) => {
      const [session] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_session
           (organization_id, class_group_id, pool_id, starts_at, duration_minutes,
            occurs_on, instructor_membership_id)
         VALUES ($1, $2, $3, date_trunc('minute', now()) + $4::interval, 45,
                 (now() + $4::interval)::date, $5)
         RETURNING id`,
        [tenant.organizationId, turma, pool!.id, offset, instructor],
      );
      if (marked) {
        await tenant.sql(
          `INSERT INTO attendance (organization_id, class_session_id, student_id, status, recorded_by_membership_id)
           VALUES ($1, $2, $3, 'present', $4)`,
          [tenant.organizationId, session!.id, student!.id, instructor],
        );
      }
      return session!.id;
    },
  };
}

const statusOf = async (tenant: ScratchTenant, id: string): Promise<string | undefined> =>
  (await tenant.sql<{ status: string }>(`SELECT status FROM class_session WHERE id = $1`, [id]))[0]?.status;

test('a lesson still running cancels, marks and all, for its instructor', async () => {
  await withScratchTenant(async (tenant) => {
    const f = await fixture(tenant);
    const running = await f.lesson('-10 minutes', true);

    await actingAs(tenant, { membershipId: f.instructor, roles: ['instructor'] }, async () => {
      assert.equal((await new AttendanceController().register(running)).canCancel, true);
      await new SessionsCalendarController().cancel(running, { reason: 'Avaria' });
    });
    assert.equal(await statusOf(tenant, running), 'cancelled');
    const [marks] = await tenant.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM attendance WHERE class_session_id = $1`,
      [running],
    );
    assert.equal(marks?.n, 1, 'the marks stay: the swimmers were there');
  });
});

test('an ended lesson is not the instructor’s to cancel, marked or not', async () => {
  await withScratchTenant(async (tenant) => {
    const f = await fixture(tenant);
    const ended = await f.lesson('-2 hours', false);

    await actingAs(tenant, { membershipId: f.instructor, roles: ['instructor'] }, async () => {
      assert.equal((await new AttendanceController().register(ended)).canCancel, false);
      await expectStatus(() => new SessionsCalendarController().cancel(ended, { reason: 'Avaria' }), 403);
    });
    assert.equal(await statusOf(tenant, ended), 'scheduled');
  });
});

test('an ended lesson nobody marked is still the office’s to cancel; a marked one is nobody’s', async () => {
  await withScratchTenant(async (tenant) => {
    const f = await fixture(tenant);
    const unmarked = await f.lesson('-2 hours', false);
    const marked = await f.lesson('-1 day', true);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const sessions = new SessionsCalendarController();
      const register = new AttendanceController();

      assert.equal((await register.register(unmarked)).canCancel, true);
      await sessions.cancel(unmarked, {});

      assert.equal((await register.register(marked)).canCancel, false);
      await expectStatus(() => sessions.cancel(marked, {}), 409);
    });
    assert.equal(await statusOf(tenant, unmarked), 'cancelled');
    assert.equal(await statusOf(tenant, marked), 'scheduled');
  });
});

test('a future lesson cancels as before, for its instructor and for the office', async () => {
  await withScratchTenant(async (tenant) => {
    const f = await fixture(tenant);
    const mine = await f.lesson('3 days', false);
    const theirs = await f.lesson('4 days', false);

    await actingAs(tenant, { membershipId: f.instructor, roles: ['instructor'] }, () =>
      new SessionsCalendarController().cancel(mine, { reason: 'Avaria' }),
    );
    await actingAs(tenant, { roles: ['admin'] }, () => new SessionsCalendarController().cancel(theirs, {}));
    assert.equal(await statusOf(tenant, mine), 'cancelled');
    assert.equal(await statusOf(tenant, theirs), 'cancelled');
  });
});
