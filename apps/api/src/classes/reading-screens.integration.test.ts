import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ClassesController, TimetableController } from './classes.controller.js';
import { CalendarController } from './sessions.controller.js';
import { AttendanceController } from './attendance.controller.js';
import { StudentsController } from '../students/students.controller.js';
import { actingAs, closeHarness, withScratchTenant } from '../test/harness.js';

/**
 * The screens simply loading — and why this file exists.
 *
 * POOLSE-43 turned `class_group.lane` and `class_session.lane` into references
 * and dropped the old smallint columns. The migration, the generator and the SQL
 * suite were all updated; six repository queries in `classes/`, `sessions/` and
 * `attendance/` were not. Turmas and Calendário answered 500 to every request,
 * and **nothing caught it**: typecheck cannot see inside a SQL string, and no
 * test had ever asked those endpoints for a list.
 *
 * So this is the cheap, boring net underneath every read screen: call it, prove
 * it answers. It asserts almost nothing about the *contents* — the suites next
 * to it do that — because the failure it exists to catch is a query that no
 * longer matches the schema, and that shows up as an exception rather than as a
 * wrong number.
 *
 * Add an endpoint that a page loads, add a line here.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/** A club with enough in it that every query has a row to trip over. */
async function seeded(tenant: {
  organizationId: string;
  facilityId: string;
  seasonId: string;
  sql: <T extends object = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<T[]>;
}): Promise<void> {
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name) VALUES ($1, $2, 'Tanque Grande')
     RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );

  // A second lane, so the turma sits on one that is not the trigger's default.
  const [lane] = await tenant.sql<{ id: string }>(
    `INSERT INTO lane (organization_id, pool_id, name, position)
     VALUES ($1, $2, 'Pista 2', 2) RETURNING id`,
    [tenant.organizationId, pool?.id],
  );

  const [group] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group
       (organization_id, season_id, facility_id, name, pool_id, lane_id, capacity)
     VALUES ($1, $2, $3, 'Iniciação', $4, $5, 8) RETURNING id`,
    [tenant.organizationId, tenant.seasonId, tenant.facilityId, pool?.id, lane?.id],
  );

  await tenant.sql(
    `INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes)
     VALUES ($1, $2, 2, TIME '18:00', 45)`,
    [tenant.organizationId, group?.id],
  );

  const [student] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name)
     VALUES ($1, 'Ana', 'Martins') RETURNING id`,
    [tenant.organizationId],
  );

  await tenant.sql(
    `INSERT INTO enrollment (organization_id, class_group_id, student_id, status)
     VALUES ($1, $2, $3, 'active')`,
    [tenant.organizationId, group?.id, student?.id],
  );

  const [session] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_session
       (organization_id, class_group_id, pool_id, starts_at, duration_minutes)
     VALUES ($1, $2, $3, now() + interval '1 day', 45) RETURNING id`,
    [tenant.organizationId, group?.id, pool?.id],
  );

  /*
   * The lanes a session occupies live one table down — POOLSE-46, because a
   * booking may hold several. The times are copied from the session, which is
   * what the exclusion constraint compares.
   */
  await tenant.sql(
    `INSERT INTO class_session_lane
       (organization_id, session_id, lane_id, starts_at, ends_at)
     SELECT $1, cs.id, $3, cs.starts_at, cs.ends_at
       FROM class_session cs WHERE cs.id = $2`,
    [tenant.organizationId, session?.id, lane?.id],
  );
}

test('Turmas loads, and the lane comes back as the number it shows', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await seeded(tenant);

      const { groups } = await new ClassesController().list();
      assert.equal(groups.length, 1);
      // The column is a reference now; the surface is still the position.
      assert.equal(groups[0]?.lane, 2);
      assert.equal(groups[0]?.schedules.length, 1);
      assert.equal(groups[0]?.students.length, 1);
    });
  });
});

test('Calendário loads', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await seeded(tenant);

      const today = new Date().toISOString().slice(0, 10);
      const week = new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10);

      const calendar = await new CalendarController().read(today, week);
      assert.equal(calendar.sessions.length, 1);
      assert.deepEqual(calendar.sessions[0]?.lanes, [2]);
    });
  });
});

test("a student's timetable loads", async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await seeded(tenant);

      const [student] = await tenant.sql<{ id: string }>(
        `SELECT id FROM student WHERE organization_id = $1 LIMIT 1`,
        [tenant.organizationId],
      );

      const { entries } = await new TimetableController().read(student!.id);
      assert.equal(entries.length, 1);
      assert.equal(entries[0]?.lane, 2);
    });
  });
});

test('a register loads', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await seeded(tenant);

      const [session] = await tenant.sql<{ id: string }>(
        `SELECT id FROM class_session WHERE organization_id = $1 LIMIT 1`,
        [tenant.organizationId],
      );

      const register = await new AttendanceController().register(session!.id);
      assert.deepEqual(register.lanes, [2]);
      assert.equal(register.entries.length, 1);
    });
  });
});

test('the register list loads', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await seeded(tenant);

      const students = await new StudentsController().list();
      assert.equal(students.students.total, 1);
    });
  });
});

test('an instructor can read all of it too', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await seeded(tenant);
    });

    // The 500 was not about permissions, and neither is the fix — but a screen
    // that works for an owner and throws for an instructor is the same class of
    // bug, and it costs one call to rule out.
    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      const today = new Date().toISOString().slice(0, 10);
      const week = new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10);

      /*
       * `scope=all` since slice 1.12, and the explicit argument is the point of
       * the change rather than a workaround for it. This test asks whether the
       * screens *load* for an instructor; the club's list is the one that used
       * to be the only list, so it is the one that keeps this assertion meaning
       * what it has always meant.
       */
      assert.equal((await new ClassesController().list('all')).groups.length, 1);
      assert.equal((await new CalendarController().read(today, week)).sessions.length, 1);

      // And the new default, asserted here because this is where somebody
      // looking for "why does an instructor see nothing" would land: the seeded
      // turma is assigned to nobody, so none of it is theirs.
      const mine = await new ClassesController().list();
      assert.equal(mine.scope, 'mine');
      assert.equal(mine.groups.length, 0);
    });
  });
});
