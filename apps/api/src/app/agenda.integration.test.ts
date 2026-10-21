import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { AppController } from './app.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * The family agenda — POOLSE-90 slice 1, QA 3–6, against the database.
 *
 * One guardian, one child, one turma, and five lessons chosen for what they
 * prove: an ordinary one tomorrow; one moved for its week (*Mudou*, shown where
 * it lands); one a closure took down (*Encerrado*, read from the session's own
 * `closure_id`, never re-derived by pool); one earlier today that has already
 * ended (coming lessons only — Open 1); and one three weeks out (outside the
 * two-week window). The water is the tank's latest temperature, with its time.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

/** The owner login — only the platform writes `disabled_modules`, so a test sets it directly. */
const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 1 });

after(async () => {
  await owner.end();
  await closeHarness();
});

test('the agenda shows coming lessons where they land, with their states, and the water', async () => {
  await withScratchTenant(async (tenant) => {
    const org = tenant.organizationId;
    const [pool] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool (organization_id, facility_id, name, kind) VALUES ($1, $2, 'Tanque Grande', 'indoor') RETURNING id`,
      [org, tenant.facilityId],
    );
    const instructor = await addMember(tenant, 'Ana', 'Ribeiro', ['instructor']);
    const guardian = await addMember(tenant, 'Marta', 'Silva', ['guardian']);

    const [group] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, season_id, facility_id, name, pool_id, instructor_membership_id)
       VALUES ($1, $2, $3, 'Golfinhos', $4, $5) RETURNING id`,
      [org, tenant.seasonId, tenant.facilityId, pool!.id, instructor],
    );
    const [child] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name) VALUES ($1, 'Alice', 'Silva') RETURNING id`,
      [org],
    );
    await tenant.sql(
      `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
       VALUES ($1, $2, $3, 'Mãe', true)`,
      [org, child!.id, guardian],
    );
    await tenant.sql(
      `INSERT INTO enrollment (organization_id, class_group_id, student_id, status, joined_on)
       VALUES ($1, $2, $3, 'active', club_today() - 30)`,
      [org, group!.id, child!.id],
    );

    /** A lesson `days` from the club's today at `hour`, Lisbon. */
    async function lesson(days: number, hour: string, extra = ''): Promise<string> {
      const [row] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_session (organization_id, class_group_id, pool_id, instructor_membership_id, occurs_on, starts_at, duration_minutes)
         SELECT $1, $2, $3, $4, d, (d + $5::time) AT TIME ZONE 'Europe/Lisbon', 45
           FROM (SELECT club_today() + $6::int AS d) day
         RETURNING id`,
        [org, group!.id, pool!.id, instructor, hour, days],
      );
      if (extra !== '') await tenant.sql(`UPDATE class_session SET ${extra} WHERE id = $1`, [row!.id]);
      return row!.id;
    }

    const ordinary = await lesson(1, '18:00');
    const moved = await lesson(2, '19:30', 'moved_at = now()');
    const [closure] = await tenant.sql<{ id: string }>(
      `INSERT INTO closure (organization_id, facility_id, starts_on, ends_on, reason, source)
       VALUES ($1, $2, club_today() + 3, club_today() + 3, 'Obras no tanque', 'manual') RETURNING id`,
      [org, tenant.facilityId],
    );
    const closed = await lesson(3, '18:00', `status = 'cancelled', cancellation_reason = 'Obras no tanque', closure_id = '${closure!.id}'`);
    // Already over: started three hours ago today.
    const [past] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_session (organization_id, class_group_id, pool_id, occurs_on, starts_at, duration_minutes)
       VALUES ($1, $2, $3, club_today(), now() - interval '3 hours', 45) RETURNING id`,
      [org, group!.id, pool!.id],
    );
    const far = await lesson(20, '18:00');

    const [analysis] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool_analysis (organization_id, pool_id, taken_at) VALUES ($1, $2, now() - interval '4 days') RETURNING id`,
      [org, pool!.id],
    );
    await tenant.sql(
      `INSERT INTO pool_analysis_value (organization_id, analysis_id, metric, value, unit) VALUES ($1, $2, 'temperature', 29.5, '°C')`,
      [org, analysis!.id],
    );

    await actingAs(tenant, { membershipId: guardian, roles: ['guardian'] }, async () => {
      const agenda = await new AppController().agenda();
      const ids = agenda.entries.map((entry) => entry.sessionId);

      assert.deepEqual(ids, [ordinary, moved, closed], 'coming lessons in the window, in time order');
      assert.ok(!ids.includes(past!.id), 'a lesson already over is not on it (Open 1)');
      assert.ok(!ids.includes(far), 'nor one past the two weeks');

      const byId = new Map(agenda.entries.map((entry) => [entry.sessionId, entry]));
      assert.equal(byId.get(moved)?.moved, true, 'QA 4: the moved week says so');
      assert.equal(byId.get(moved)?.localTime, '19:30', 'QA 4: at the hour it moved to');
      assert.equal(byId.get(closed)?.status, 'cancelled');
      assert.equal(byId.get(closed)?.byClosure, true, 'QA 5: closed by a closure, from the session itself');
      assert.equal(byId.get(ordinary)?.instructorFirstName, 'Ana');

      // QA 6: the temperature, with when it was taken — the screen says "há 4 dias".
      assert.equal(agenda.water.length, 1);
      assert.equal(Number(agenda.water[0]!.celsius), 29.5);
      const ageDays = (Date.now() - Date.parse(agenda.water[0]!.takenAt)) / 86_400_000;
      assert.ok(ageDays > 3.9 && ageDays < 4.1, 'the instant, so its age can be said');

      assert.deepEqual(agenda.children.map((one) => one.id), [child!.id]);

      // The lesson's own read answers for this family, and only for a coming lesson.
      const one = await new AppController().lesson(moved);
      assert.equal(one.entries[0]?.sessionId, moved);
      await expectStatus(() => new AppController().lesson(past!.id), 404);
    });

    // QA 6: with water quality switched off for the club, no temperature at all.
    await owner.query(`UPDATE organization SET disabled_modules = '{water_quality}' WHERE id = $1`, [org]);
    await actingAs(tenant, { membershipId: guardian, roles: ['guardian'] }, async () => {
      const agenda = await new AppController().agenda();
      assert.equal(agenda.entries.length, 3);
      assert.deepEqual(agenda.water, [], 'the API carries none, not merely the screen');
    });
  });
});
