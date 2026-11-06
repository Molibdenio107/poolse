import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { monthDays, shiftMonth } from '@poolse/rules';
import { AppController } from './app.controller.js';
import type { CalendarClosure, CalendarEntry } from './agenda.repository.js';
import { clubToday } from '../common/club-day.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * POOLSE-175 — *Aulas* is the family's calendar. `GET /app/agenda` with a window:
 * lessons with this child's own mark, closures as days, the weekly pattern past
 * the generated lessons, and a refusal outside six months ahead and three back.
 * With no window it answers exactly what it did.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

type Calendar = { entries: CalendarEntry[]; closures: CalendarClosure[] };

interface Club {
  org: string;
  poolId: string;
  groupId: string;
  instructor: string;
  guardian: string;
  child: string;
  classmate: string;
}

async function seed(tenant: ScratchTenant): Promise<Club> {
  const org = tenant.organizationId;
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind) VALUES ($1, $2, 'Tanque', 'indoor') RETURNING id`,
    [org, tenant.facilityId],
  );
  const instructor = await addMember(tenant, 'Ana', 'Ribeiro', ['instructor']);
  const guardian = await addMember(tenant, 'Marta', 'Silva', ['guardian']);
  const [group] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group (organization_id, season_id, facility_id, name, pool_id, instructor_membership_id)
     VALUES ($1, $2, $3, 'Golfinhos', $4, $5) RETURNING id`,
    [org, tenant.seasonId, tenant.facilityId, pool!.id, instructor],
  );
  const student = async (first: string, last: string): Promise<string> => {
    const [row] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name) VALUES ($1, $2, $3) RETURNING id`,
      [org, first, last],
    );
    await tenant.sql(
      `INSERT INTO enrollment (organization_id, class_group_id, student_id, status, joined_on)
       VALUES ($1, $2, $3, 'active', club_today() - 120)`,
      [org, group!.id, row!.id],
    );
    return row!.id;
  };
  const child = await student('Alice', 'Silva');
  const classmate = await student('Bruna', 'Colega');
  await tenant.sql(
    `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
     VALUES ($1, $2, $3, 'Mãe', true)`,
    [org, child, guardian],
  );
  return { org, poolId: pool!.id, groupId: group!.id, instructor, guardian, child, classmate };
}

async function lesson(tenant: ScratchTenant, club: Club, days: number): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_session (organization_id, class_group_id, pool_id, instructor_membership_id, occurs_on, starts_at, duration_minutes)
     SELECT $1, $2, $3, $4, d, (d + TIME '18:00') AT TIME ZONE 'Europe/Lisbon', 45
       FROM (SELECT club_today() + $5::int AS d) day
     RETURNING id`,
    [club.org, club.groupId, club.poolId, club.instructor, days],
  );
  return row!.id;
}

async function mark(tenant: ScratchTenant, club: Club, session: string, student: string, status: string): Promise<void> {
  await tenant.sql(
    `INSERT INTO attendance (organization_id, class_session_id, student_id, status, recorded_by_membership_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [club.org, session, student, status, club.instructor],
  );
}

const asGuardian = <T>(tenant: ScratchTenant, club: Club, fn: () => Promise<T>): Promise<T> =>
  actingAs(tenant, { membershipId: club.guardian, roles: ['guardian'] }, fn);

/** The whole month a day `days` from today falls in. */
function monthAround(days: number): { from: string; to: string } {
  const at = new Date(`${clubToday()}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return monthDays(at.toISOString().slice(0, 7));
}

test('with no window it answers exactly what it did', async () => {
  await withScratchTenant(async (tenant) => {
    const club = await seed(tenant);
    await lesson(tenant, club, 2);
    const answer = await asGuardian(tenant, club, () => new AppController().agenda());
    assert.equal('closures' in answer, false);
    for (const key of ['attendance', 'opens', 'generated']) {
      assert.equal(key in answer.entries[0]!, false, `${key} leaked into the two-week read`);
    }
  });
});

test('a past lesson says this child’s mark, and no other child’s reaches the payload (QA 3, 6)', async () => {
  await withScratchTenant(async (tenant) => {
    const club = await seed(tenant);
    const session = await lesson(tenant, club, -2);
    await mark(tenant, club, session, club.child, 'excused');
    await mark(tenant, club, session, club.classmate, 'present');
    const { from, to } = monthAround(-2);

    const answer = (await asGuardian(tenant, club, () => new AppController().agenda(undefined, from, to))) as Calendar;
    assert.equal(answer.entries.length, 1);
    assert.equal(answer.entries[0]!.attendance, 'excused');
    assert.equal(answer.entries[0]!.generated, true);
    assert.equal(answer.entries[0]!.opens, true, 'inside the feedback window');
    const raw = JSON.stringify(answer);
    assert.doesNotMatch(raw, new RegExp(club.classmate));
    assert.doesNotMatch(raw, /Bruna|Colega/);
  });
});

test('a lesson the page cannot open says so, and a closure shows as days with its lesson Encerrado (QA 1)', async () => {
  await withScratchTenant(async (tenant) => {
    const club = await seed(tenant);
    const far = await lesson(tenant, club, 40);
    const [closure] = await tenant.sql<{ id: string }>(
      `INSERT INTO closure (organization_id, facility_id, starts_on, ends_on, reason, source)
       VALUES ($1, $2, club_today() + 40, club_today() + 40, 'Obras', 'manual') RETURNING id`,
      [club.org, tenant.facilityId],
    );
    await tenant.sql(`UPDATE class_session SET status = 'cancelled', closure_id = $2 WHERE id = $1`, [far, closure!.id]);

    const { from, to } = monthAround(40);
    const answer = (await asGuardian(tenant, club, () => new AppController().agenda(undefined, from, to))) as Calendar;
    const entry = answer.entries.find((one) => one.sessionId === far)!;
    assert.equal(entry.byClosure, true);
    assert.equal(entry.opens, false, '`/app/lessons/:id` answers two weeks ahead');
    assert.equal(answer.closures.length, 1);
    assert.equal(answer.closures[0]!.reason, 'Obras');
    assert.equal(answer.closures[0]!.scope, 'site');
  });
});

test('another club’s closure is not this family’s', async () => {
  await withScratchTenant(async (theirs) => {
    await theirs.sql(
      `INSERT INTO closure (organization_id, facility_id, starts_on, ends_on, reason, source)
       VALUES ($1, $2, club_today() + 40, club_today() + 40, 'Deles', 'manual')`,
      [theirs.organizationId, theirs.facilityId],
    );
    await withScratchTenant(async (tenant) => {
      const club = await seed(tenant);
      const { from, to } = monthAround(40);
      const answer = (await asGuardian(tenant, club, () => new AppController().agenda(undefined, from, to))) as Calendar;
      assert.deepEqual(answer.closures, []);
    });
  });
});

test('past the generated lessons the pattern shows as planned, opens nothing, and stops at the turma’s end (QA 2)', async () => {
  await withScratchTenant(async (tenant) => {
    const club = await seed(tenant);
    await lesson(tenant, club, 2);
    await tenant.sql(
      `INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes)
       VALUES ($1, $2, 3, TIME '18:00', 45)`,
      [club.org, club.groupId],
    );
    const { from, to } = monthDays(shiftMonth(clubToday().slice(0, 7), 2));
    const lastDay = `${from.slice(0, 8)}20`;
    await tenant.sql(`UPDATE class_group SET ends_on = $2::date WHERE id = $1`, [club.groupId, lastDay]);

    const answer = (await asGuardian(tenant, club, () => new AppController().agenda(undefined, from, to))) as Calendar;
    assert.ok(answer.entries.length > 0, 'the pattern is there');
    for (const entry of answer.entries) {
      assert.equal(entry.generated, false);
      assert.equal(entry.sessionId, null);
      assert.equal(entry.opens, false);
      assert.ok(entry.localDate <= lastDay, `${entry.localDate} is past the turma's end`);
      assert.equal(new Date(`${entry.localDate}T12:00:00Z`).getUTCDay(), 3, 'a Wednesday');
    }
  });
});

test('a window outside the calendar, half a window, and another family’s child are refused (QA 5)', async () => {
  await withScratchTenant(async (tenant) => {
    const club = await seed(tenant);
    const routes = new AppController();
    const far = monthDays(shiftMonth(clubToday().slice(0, 7), 7));
    const here = monthDays(clubToday().slice(0, 7));
    await asGuardian(tenant, club, async () => {
      await expectStatus(() => routes.agenda(undefined, far.from, far.to), 400);
      await expectStatus(() => routes.agenda(undefined, here.from), 400);
      await expectStatus(() => routes.agenda(club.classmate, here.from, here.to), 404);
    });
  });
});

test('an instructor may not read the family’s calendar (permission denial)', async () => {
  await withScratchTenant(async (tenant) => {
    const { from, to } = monthDays(clubToday().slice(0, 7));
    await expectStatus(
      () => actingAs(tenant, { roles: ['instructor'] }, () => new AppController().agenda(undefined, from, to)),
      403,
    );
  });
});
