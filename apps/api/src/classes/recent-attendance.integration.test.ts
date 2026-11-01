import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { RecentAttendanceController } from './classes.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * Slice 5 — a student's recent lessons per turma, for the attendance strip:
 * taught, not cancelled, on or after the day they joined, oldest first, with
 * their mark or none; the child's own family may read it, nobody else's.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

test('recent attendance: taught lessons since joining, marked or not, oldest first', async () => {
  await withScratchTenant(async (tenant) => {
    const org = tenant.organizationId;
    const [pool] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool (organization_id, facility_id, name, kind) VALUES ($1, $2, 'Tanque', 'indoor') RETURNING id`,
      [org, tenant.facilityId],
    );
    const instructor = await addMember(tenant, 'Ana', 'Ribeiro', ['instructor']);
    const guardian = await addMember(tenant, 'Marta', 'Silva', ['guardian']);
    const stranger = await addMember(tenant, 'Rui', 'Outro', ['guardian']);
    const [group] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, season_id, facility_id, name, pool_id)
       VALUES ($1, $2, $3, 'Golfinhos', $4) RETURNING id`,
      [org, tenant.seasonId, tenant.facilityId, pool!.id],
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
       VALUES ($1, $2, $3, 'active', club_today() - 14)`,
      [org, group!.id, child!.id],
    );

    const lesson = async (days: number, extra = ''): Promise<string> => {
      const [row] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_session (organization_id, class_group_id, pool_id, occurs_on, starts_at, duration_minutes)
         SELECT $1, $2, $3, d, (d + time '18:00') AT TIME ZONE 'Europe/Lisbon', 45
           FROM (SELECT club_today() + $4::int AS d) day
         RETURNING id`,
        [org, group!.id, pool!.id, days],
      );
      if (extra !== '') await tenant.sql(`UPDATE class_session SET ${extra} WHERE id = $1`, [row!.id]);
      return row!.id;
    };
    const mark = (session: string, status: string): Promise<unknown> =>
      tenant.sql(
        `INSERT INTO attendance (organization_id, class_session_id, student_id, status, recorded_by_membership_id)
         VALUES ($1, $2, $3, $4::attendance_status, $5)`,
        [org, session, child!.id, status, instructor],
      );

    await lesson(-20); // before she joined: not hers to have missed
    const present = await lesson(-10);
    const absent = await lesson(-7);
    await lesson(-5, `status = 'cancelled', cancellation_reason = 'Obras'`); // cancelled: never taught
    const unmarked = await lesson(-2);
    await lesson(3); // still to come
    await mark(present, 'present');
    await mark(absent, 'absent');

    const routes = new RecentAttendanceController();
    const read = await actingAs(tenant, { membershipId: instructor, roles: ['instructor'] }, () => routes.read(child!.id));
    assert.equal(read.turmas.length, 1);
    assert.deepEqual(
      read.turmas[0]!.lessons.map((l) => [l.sessionId, l.status]),
      [
        [present, 'present'],
        [absent, 'absent'],
        [unmarked, null],
      ],
    );

    // The child's own family reads it; another family is told it does not exist.
    const own = await actingAs(tenant, { membershipId: guardian, roles: ['guardian'] }, () => routes.read(child!.id));
    assert.equal(own.turmas[0]!.lessons.length, 3);
    await actingAs(tenant, { membershipId: stranger, roles: ['guardian'] }, () =>
      expectStatus(() => routes.read(child!.id), 404),
    );
  });
});
