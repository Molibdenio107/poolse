import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actingAs,
  addMember,
  closeHarness,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';
import { DashboardController } from './dashboard.controller.js';
import type { Dashboard } from './compose.js';
import type { NextClass } from './instructor.repository.js';
import type { MyTurmasWidget, TrainingPlanWidget, WeekWidget } from './resolvers.js';
import { assignInstructor } from '../facilities/bookings.repository.js';

/**
 * The instructor band — POOLSE-66 slice 3, against a real club.
 *
 * What this file owns: that "my class" is the session's resolved instructor
 * (a stand-in sees the class, the regular instructor does not); that the next
 * class skips a cancelled one (QA 5), follows a moved week (QA 7) and holds on
 * to a class whose register is still owed; that a parceria is in it; that the
 * band carries no money (AC 8) and nothing of another club's (QA 4); and that
 * staffing a booking re-stamps the weeks already generated.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

const dashboard = new DashboardController();

after(async () => {
  await closeHarness();
});

const TZ = `'Europe/Lisbon'`;

/** An instant `days` from today on the site's clock, at `time`. */
function at(days: number, time: string): string {
  return `(((now() AT TIME ZONE ${TZ})::date + ${days}) + TIME '${time}') AT TIME ZONE ${TZ}`;
}

function card<T>(page: Dashboard, id: string): { state: string; data: T } | undefined {
  return page.bands
    .flatMap((band) => band.widgets)
    .find((one) => one.id === id) as { state: string; data: T } | undefined;
}

interface Turma {
  poolId: string;
  groupId: string;
  studentId: string;
}

/** A pool, and a turma taught by `instructor` with one student enrolled. */
async function turma(
  tenant: ScratchTenant,
  instructor: string,
  name = 'Golfinhos',
  capacity: number | null = 8,
): Promise<Turma> {
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.organizationId, tenant.facilityId, `Tanque ${name}`],
  );
  const [group] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group
       (organization_id, season_id, facility_id, name, pool_id, instructor_membership_id, capacity)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [tenant.organizationId, tenant.seasonId, tenant.facilityId, name, pool!.id, instructor, capacity],
  );
  const [student] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name) VALUES ($1, 'Rita', $2) RETURNING id`,
    [tenant.organizationId, name],
  );
  await tenant.sql(
    `INSERT INTO enrollment (organization_id, class_group_id, student_id, status)
     VALUES ($1, $2, $3, 'active')`,
    [tenant.organizationId, group!.id, student!.id],
  );
  return { poolId: pool!.id, groupId: group!.id, studentId: student!.id };
}

/** One session of `group`, starting at the SQL instant `when`. */
async function session(
  tenant: ScratchTenant,
  t: Turma,
  instructor: string,
  when: string,
  extra: { status?: 'cancelled'; substitute?: string; occursOn?: string } = {},
): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_session
       (organization_id, class_group_id, pool_id, instructor_membership_id,
        substitute_instructor_membership_id, starts_at, duration_minutes, occurs_on,
        status, cancellation_reason)
     VALUES ($1, $2, $3, $4, $5, (${when}), 45,
             coalesce($6::date, ((${when}) AT TIME ZONE ${TZ})::date),
             coalesce($7::class_session_status, 'scheduled'),
             CASE WHEN $7 = 'cancelled' THEN 'Avaria' END)
     RETURNING id`,
    [
      tenant.organizationId,
      t.groupId,
      t.poolId,
      instructor,
      extra.substitute ?? null,
      extra.occursOn ?? null,
      extra.status ?? null,
    ],
  );
  return row!.id;
}

async function takeRegister(tenant: ScratchTenant, t: Turma, sessionId: string, by: string) {
  await tenant.sql(
    `INSERT INTO attendance
       (organization_id, class_session_id, student_id, status, recorded_by_membership_id)
     VALUES ($1, $2, $3, 'present', $4)`,
    [tenant.organizationId, sessionId, t.studentId, by],
  );
}

const asInstructor = (tenant: ScratchTenant, membershipId: string) =>
  actingAs(tenant, { membershipId, roles: ['instructor'] }, () => dashboard.read());

test('66.3 next class — the earliest one ahead, with its turma, level and headcount', async () => {
  await withScratchTenant(async (tenant) => {
    const ana = await addMember(tenant, 'Ana', 'Lopes', ['instructor']);
    const t = await turma(tenant, ana);
    await session(tenant, t, ana, at(3, '18:00'));
    const tomorrow = await session(tenant, t, ana, at(1, '18:00'));

    const page = await asInstructor(tenant, ana);
    const next = card<NextClass>(page, 'inst.nextclass');

    assert.equal(next?.state, 'ok');
    assert.equal(next!.data.sessionId, tomorrow);
    assert.equal(next!.data.dayOffset, 1);
    assert.equal(next!.data.localTime, '18:00');
    assert.equal(next!.data.className, 'Golfinhos');
    assert.equal(next!.data.enrolled, 1);
    assert.equal(next!.data.capacity, 8);
    assert.equal(next!.data.registerOpen, false);
    assert.equal(next!.data.coveringFor, null);
    assert.equal(next!.data.partner, false);
  });
});

test('66.3 QA 5 — a cancelled next class gives way to the one after it', async () => {
  await withScratchTenant(async (tenant) => {
    const ana = await addMember(tenant, 'Ana', 'Lopes', ['instructor']);
    const t = await turma(tenant, ana);
    await session(tenant, t, ana, at(1, '18:00'), { status: 'cancelled' });
    const following = await session(tenant, t, ana, at(2, '18:00'));

    const next = card<NextClass>(await asInstructor(tenant, ana), 'inst.nextclass');
    assert.equal(next!.data.sessionId, following);
  });
});

test('66.3 QA 6 — an instructor with no classes is empty, not an error', async () => {
  await withScratchTenant(async (tenant) => {
    const ana = await addMember(tenant, 'Ana', 'Lopes', ['instructor']);

    const page = await asInstructor(tenant, ana);
    const cards = page.bands.flatMap((band) => band.widgets);
    // Five candidates for four places, all empty: the cap cuts the turmas,
    // and every card that is shown says "nothing here" rather than failing.
    assert.equal(cards.length, 4);
    for (const one of cards) assert.equal(one.state, 'empty', one.id);
    assert.equal(card(page, 'inst.myturmas'), undefined);
  });
});

test('66.3 QA 7 — a week moved by hand is read where it was moved to', async () => {
  await withScratchTenant(async (tenant) => {
    const ana = await addMember(tenant, 'Ana', 'Lopes', ['instructor']);
    const t = await turma(tenant, ana);
    // Filed under the pattern's day four days out, taught tomorrow instead.
    const [filed] = await tenant.sql<{ d: string }>(
      `SELECT ((now() AT TIME ZONE ${TZ})::date + 4)::text AS d`,
    );
    const moved = await session(tenant, t, ana, at(1, '09:30'), { occursOn: filed!.d });

    const next = card<NextClass>(await asInstructor(tenant, ana), 'inst.nextclass');
    assert.equal(next!.data.sessionId, moved);
    assert.equal(next!.data.dayOffset, 1, 'the day it is taught, not the day it is filed under');
    assert.equal(next!.data.localTime, '09:30');
  });
});

test('66.3 the register window — open just after the start, held until the register is taken', async () => {
  await withScratchTenant(async (tenant) => {
    const ana = await addMember(tenant, 'Ana', 'Lopes', ['instructor']);
    const t = await turma(tenant, ana);
    // Ended a quarter of an hour ago, 60 minutes after it began; nobody marked it.
    const owed = await session(tenant, t, ana, `now() - interval '60 minutes'`);
    const later = await session(tenant, t, ana, at(2, '18:00'));

    let page = await asInstructor(tenant, ana);
    let next = card<NextClass>(page, 'inst.nextclass');
    assert.equal(next!.data.sessionId, owed, 'the register is still owed');
    assert.equal(next!.data.registerOpen, true);
    const operational = page.bands.find((band) => band.id === 'operational')!;
    assert.equal(operational.widgets[0]!.id, 'inst.nextclass', 'an owed register goes first');

    await takeRegister(tenant, t, owed, ana);
    page = await asInstructor(tenant, ana);
    next = card<NextClass>(page, 'inst.nextclass');
    assert.equal(next!.data.sessionId, later, 'taken, so it moves on');
  });
});

test('66.3 a stand-in sees the class they cover, and the regular instructor does not', async () => {
  await withScratchTenant(async (tenant) => {
    const ana = await addMember(tenant, 'Ana', 'Lopes', ['instructor']);
    const rui = await addMember(tenant, 'Rui', 'Costa', ['instructor']);
    const t = await turma(tenant, ana);
    const covered = await session(tenant, t, ana, at(1, '18:00'), { substitute: rui });
    const own = await session(tenant, t, ana, at(8, '18:00'));

    const forRui = card<NextClass>(await asInstructor(tenant, rui), 'inst.nextclass');
    assert.equal(forRui!.data.sessionId, covered);
    assert.equal(forRui!.data.coveringFor, 'Ana Lopes');

    const forAna = card<NextClass>(await asInstructor(tenant, ana), 'inst.nextclass');
    assert.equal(forAna!.data.sessionId, own, 'the covered week is not hers that week');
  });
});

test('66.3 a parceria is on the card, with no register to take', async () => {
  await withScratchTenant(async (tenant) => {
    const ana = await addMember(tenant, 'Ana', 'Lopes', ['instructor']);
    const [pool] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool (organization_id, facility_id, name) VALUES ($1, $2, 'Tanque') RETURNING id`,
      [tenant.organizationId, tenant.facilityId],
    );
    const [partner] = await tenant.sql<{ id: string }>(
      `INSERT INTO partner (organization_id, facility_id, name, type, managed_lessons)
       VALUES ($1, $2, 'Escola do Juncal', 'escola', false) RETURNING id`,
      [tenant.organizationId, tenant.facilityId],
    );
    const [group] = await tenant.sql<{ id: string }>(
      `INSERT INTO partner_group (organization_id, partner_id, name, participant_count)
       VALUES ($1, $2, '3.o ano', 22) RETURNING id`,
      [tenant.organizationId, partner!.id],
    );
    const [schedule] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_schedule
         (organization_id, facility_id, subject_type, partner_group_id, season_id, weekday,
          start_time, duration_minutes, instructor_membership_id)
       VALUES ($1, $2, 'parceria', $3, $4, 2, TIME '10:00', 45, $5) RETURNING id`,
      [tenant.organizationId, tenant.facilityId, group!.id, tenant.seasonId, ana],
    );
    // Starting now: inside the window a turma's register would open in.
    await tenant.sql(
      `INSERT INTO class_session
         (organization_id, schedule_id, pool_id, instructor_membership_id, starts_at,
          duration_minutes, occurs_on)
       VALUES ($1, $2, $3, $4, now() + interval '10 minutes', 45, (now() AT TIME ZONE ${TZ})::date)`,
      [tenant.organizationId, schedule!.id, pool!.id, ana],
    );

    const page = await asInstructor(tenant, ana);
    const next = card<NextClass>(page, 'inst.nextclass');
    assert.equal(next!.data.className, '3.o ano');
    assert.equal(next!.data.partner, true);
    assert.equal(next!.data.enrolled, 22, "the school's headcount");
    assert.equal(next!.data.registerOpen, false, 'a parceria takes no register, ever');

    // Not one the club runs, so there is nothing to plan.
    assert.equal(card(page, 'inst.trainingplan.next')?.state, 'empty');
    assert.equal(card<WeekWidget>(page, 'inst.week')!.data.classes.length >= 1, true);
  });
});

test('66.3 the plan card — missing, with the previous lesson to copy; then written', async () => {
  await withScratchTenant(async (tenant) => {
    const ana = await addMember(tenant, 'Ana', 'Lopes', ['instructor']);
    const t = await turma(tenant, ana);
    const next = await session(tenant, t, ana, at(1, '18:00'));
    const [occurs] = await tenant.sql<{ d: string }>(
      `SELECT occurs_on::text AS d FROM class_session WHERE id = $1`,
      [next],
    );
    await tenant.sql(
      `INSERT INTO lesson_plan (organization_id, class_group_id, on_date, body, updated_by)
       VALUES ($1, $2, $3::date - 7, 'Crol 4x25, pernas com prancha', $4)`,
      [tenant.organizationId, t.groupId, occurs!.d, ana],
    );

    let plan = card<TrainingPlanWidget>(await asInstructor(tenant, ana), 'inst.trainingplan.next');
    assert.equal(plan!.data.written, false);
    assert.equal(plan!.data.canEdit, true);
    assert.equal(plan!.data.next.sessionId, next);
    assert.notEqual(plan!.data.previousOn, null);
    assert.equal(JSON.stringify(plan).includes('Crol'), false, "the previous body is not sent");

    await tenant.sql(
      `INSERT INTO lesson_plan (organization_id, class_group_id, on_date, body, updated_by)
       VALUES ($1, $2, $3::date, E'Costas 6x25\\nMergulho', $4)`,
      [tenant.organizationId, t.groupId, occurs!.d, ana],
    );
    plan = card<TrainingPlanWidget>(await asInstructor(tenant, ana), 'inst.trainingplan.next');
    assert.equal(plan!.data.written, true);
    assert.equal(plan!.data.excerpt, 'Costas 6x25');
  });
});

test('66.3 the week — this week only, a cancelled class kept and said', async () => {
  await withScratchTenant(async (tenant) => {
    const ana = await addMember(tenant, 'Ana', 'Lopes', ['instructor']);
    const t = await turma(tenant, ana);
    await session(tenant, t, ana, at(0, '23:30'));
    const [isoDow] = await tenant.sql<{ n: number }>(
      `SELECT extract(ISODOW FROM now() AT TIME ZONE ${TZ})::int AS n`,
    );
    // Somewhere else in this same Monday-to-Sunday, and one in the next week.
    const sameWeek = isoDow!.n === 1 ? 1 : -1;
    await session(tenant, t, ana, at(sameWeek, '12:00'), { status: 'cancelled' });
    await session(tenant, t, ana, at(8 - isoDow!.n + 1, '12:00'));

    const week = card<WeekWidget>(await asInstructor(tenant, ana), 'inst.week');
    assert.equal(week!.data.classes.length, 2, 'next week is not this week');
    assert.equal(week!.data.classes.filter((one) => one.cancelled).length, 1);
  });
});

test('66.3 my turmas — the ones I am responsible for, counted in one statement', async () => {
  await withScratchTenant(async (tenant) => {
    const ana = await addMember(tenant, 'Ana', 'Lopes', ['instructor']);
    const rui = await addMember(tenant, 'Rui', 'Costa', ['instructor']);
    await turma(tenant, ana, 'Golfinhos');
    await turma(tenant, ana, 'Tubarões', null);
    await turma(tenant, rui, 'Cadetes');

    const mine = card<MyTurmasWidget>(await asInstructor(tenant, ana), 'inst.myturmas');
    assert.deepEqual(
      mine!.data.turmas.map((one) => [one.name, one.students, one.capacity]),
      [
        ['Golfinhos', 1, 8],
        ['Tubarões', 1, null],
      ],
    );
  });
});

test('66.3 AC 8 — the band carries no money and no management card', async () => {
  await withScratchTenant(async (tenant) => {
    const ana = await addMember(tenant, 'Ana', 'Lopes', ['instructor']);
    const t = await turma(tenant, ana);
    await session(tenant, t, ana, at(1, '18:00'));

    const raw = JSON.stringify(await asInstructor(tenant, ana));
    assert.equal(raw.includes('"mgmt.'), false);
    assert.equal(/cents/i.test(raw), false, 'no amount of any kind');

    // And the other way: a student is offered none of it.
    const student = await actingAs(tenant, { membershipId: ana, roles: ['student'] }, () =>
      dashboard.read(),
    );
    assert.equal(JSON.stringify(student).includes('"inst.'), false);
  });
});

test('66.3 QA 15 — the band goes with the role', async () => {
  await withScratchTenant(async (tenant) => {
    const ana = await addMember(tenant, 'Ana', 'Lopes', ['instructor']);
    const t = await turma(tenant, ana);
    await session(tenant, t, ana, at(1, '18:00'));

    const without = await actingAs(tenant, { membershipId: ana, roles: [] }, () => dashboard.read());
    assert.deepEqual(without.bands, []);
  });
});

test("66.3 QA 4 — another club's earlier class is not my next one", async () => {
  await withScratchTenant(async (mine) => {
    const ana = await addMember(mine, 'Ana', 'Lopes', ['instructor']);
    const t = await turma(mine, ana);
    const ours = await session(mine, t, ana, at(3, '18:00'));

    await withScratchTenant(async (theirs) => {
      const other = await addMember(theirs, 'Ana', 'Lopes', ['instructor']);
      const u = await turma(theirs, other);
      await session(theirs, u, other, at(1, '18:00'));

      const next = card<NextClass>(await asInstructor(mine, ana), 'inst.nextclass');
      assert.equal(next!.data.sessionId, ours);
    });
  });
});

test('66.3 staffing a booking re-stamps its future weeks, and a clash is counted, not fatal', async () => {
  await withScratchTenant(async (tenant) => {
    const ana = await addMember(tenant, 'Ana', 'Lopes', ['instructor']);
    const rui = await addMember(tenant, 'Rui', 'Costa', ['instructor']);
    const t = await turma(tenant, ana);
    await tenant.sql(`UPDATE class_group SET instructor_membership_id = NULL WHERE id = $1`, [
      t.groupId,
    ]);
    const [schedule] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_schedule
         (organization_id, facility_id, subject_type, class_group_id, weekday,
          start_time, duration_minutes)
       VALUES ($1, $2, 'turma', $3, 2, TIME '18:00', 45) RETURNING id`,
      [tenant.organizationId, tenant.facilityId, t.groupId],
    );
    const stamp = async (days: number): Promise<string> => {
      const [row] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_session
           (organization_id, class_group_id, schedule_id, pool_id, starts_at, duration_minutes,
            occurs_on)
         VALUES ($1, $2, $3, $4, ${at(days, '18:00')}, 45, ((now() AT TIME ZONE ${TZ})::date + ${days}))
         RETURNING id`,
        [tenant.organizationId, t.groupId, schedule!.id, t.poolId],
      );
      return row!.id;
    };
    const free = await stamp(1);
    const clash = await stamp(2);
    const marked = await stamp(-7);

    // Rui is already teaching in another building at the second one's hour.
    const elsewhere = await turma(tenant, rui, 'Noutro Tanque');
    await session(tenant, elsewhere, rui, at(2, '18:00'));

    const result = await actingAs(tenant, { roles: ['owner'] }, () =>
      assignInstructor(tenant.organizationId, schedule!.id, rui),
    );
    assert.equal(result!.weeksUpdated, 1);
    assert.equal(result!.weeksBlocked, 1);

    const rows = await tenant.sql<{ id: string; who: string | null }>(
      `SELECT id, resolved_instructor_id AS who FROM class_session WHERE id = ANY($1::uuid[])`,
      [[free, clash, marked]],
    );
    const who = new Map(rows.map((row) => [row.id, row.who]));
    assert.equal(who.get(free), rui);
    assert.equal(who.get(clash), null, 'left as it was');
    assert.equal(who.get(marked), null, 'the past is not rewritten');

    const next = card<NextClass>(await asInstructor(tenant, rui), 'inst.nextclass');
    assert.equal(next!.data.sessionId, free);
  });
});
