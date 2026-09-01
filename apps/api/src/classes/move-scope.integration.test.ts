import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ClassesController } from './classes.controller.js';
import { SessionsCalendarController } from './sessions.controller.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * Moving one week, and moving every week.
 *
 * A drag on the calendar used to mean one thing: the weekly pattern changes, so
 * the class has a new time from now until the season ends. Half the time that is
 * what somebody means. The other half is "the pool is booked this Tuesday, put
 * *this week's* class on Wednesday", and it had no expression at all.
 *
 * Both now exist, and what they must not do is bleed into each other:
 *
 * - one week moved leaves every other week where it was, and survives a
 *   regeneration rather than being quietly duplicated back onto its old day;
 * - the pattern moved drags the weeks that have not happened yet along with it,
 *   leaves the weeks already taught alone, and does not overwrite a week
 *   somebody had already moved by hand.
 *
 * The last of those is the one worth having a test for. It is the difference
 * between "every week" meaning "from here on" and meaning "including the answer
 * you already gave me", and nothing about the code makes it obvious which.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

interface Fixture {
  groupId: string;
  scheduleId: string;
  poolId: string;
}

/** Monday of the ISO week `weeks` from the Monday on or before today. */
function monday(weeks: number): string {
  const now = new Date();
  const day = (now.getUTCDay() + 6) % 7;
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day);
  return new Date(start + weeks * 7 * 86_400_000).toISOString().slice(0, 10);
}

/**
 * A turma that meets on Tuesdays, with sessions for four weeks around today.
 *
 * The weeks are built by hand rather than by generating a season, because the
 * point of the test is which of them move — and a fixture that says "last week,
 * this week, next week" in three obvious rows is one somebody can check against
 * the assertions without also holding the generator in their head.
 */
async function tuesdays(tenant: {
  organizationId: string;
  facilityId: string;
  seasonId: string;
  sql: <T extends object = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<T[]>;
}): Promise<Fixture> {
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name) VALUES ($1, $2, 'Tanque')
     RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );

  const [group] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group (organization_id, season_id, facility_id, name, pool_id)
     VALUES ($1, $2, $3, 'Iniciação', $4) RETURNING id`,
    [tenant.organizationId, tenant.seasonId, tenant.facilityId, pool!.id],
  );

  const [schedule] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_schedule
       (organization_id, class_group_id, weekday, start_time, duration_minutes)
     VALUES ($1, $2, 2, TIME '18:00', 45) RETURNING id`,
    [tenant.organizationId, group!.id],
  );

  // Last week, this week, and the two after — the Tuesday of each.
  for (const week of [-1, 0, 1, 2]) {
    const day = new Date(`${monday(week)}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + 1);
    const date = day.toISOString().slice(0, 10);

    await tenant.sql(
      `INSERT INTO class_session
         (organization_id, class_group_id, schedule_id, pool_id, occurs_on,
          starts_at, duration_minutes)
       VALUES ($1, $2, $3, $4, $5::date,
               ($5::date + TIME '18:00') AT TIME ZONE 'Europe/Lisbon', 45)`,
      [tenant.organizationId, group!.id, schedule!.id, pool!.id, date],
    );
  }

  return { groupId: group!.id, scheduleId: schedule!.id, poolId: pool!.id };
}

/** Every session of the turma, as "the day it belongs to → the clock it starts at". */
async function weeks(
  tenant: { organizationId: string; sql: (t: string, v?: unknown[]) => Promise<object[]> },
  groupId: string,
): Promise<Record<string, string>> {
  const rows = (await tenant.sql(
    `SELECT occurs_on::text AS occurs_on,
            to_char(starts_at AT TIME ZONE 'Europe/Lisbon', 'YYYY-MM-DD HH24:MI') AS local,
            moved_at IS NOT NULL AS moved
       FROM class_session
      WHERE class_group_id = $1
      ORDER BY occurs_on`,
    [groupId],
  )) as { occurs_on: string; local: string; moved: boolean }[];

  return Object.fromEntries(rows.map((row) => [row.occurs_on, row.local]));
}

test('one week moves, and the others stay where they were', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { groupId } = await tuesdays(tenant);

      const thisTuesday = Object.keys(await weeks(tenant, groupId))[1]!;
      const [session] = (await tenant.sql(
        'SELECT id FROM class_session WHERE class_group_id = $1 AND occurs_on = $2::date',
        [groupId, thisTuesday],
      )) as { id: string }[];

      // The pool is booked that Tuesday: the class goes to Wednesday, 19:00.
      const wednesday = new Date(`${thisTuesday}T00:00:00Z`);
      wednesday.setUTCDate(wednesday.getUTCDate() + 1);

      await new SessionsCalendarController().move(session!.id, {
        date: wednesday.toISOString().slice(0, 10),
        startTime: '19:00',
      });

      const after = await weeks(tenant, groupId);

      // The week that moved reads at its new day and time — and is still filed
      // under the Tuesday the pattern implied, which is what stops the next
      // regeneration putting a second class back there.
      assert.equal(after[thisTuesday], `${wednesday.toISOString().slice(0, 10)} 19:00`);

      // Every other week untouched, at 18:00 on its own Tuesday.
      for (const [day, local] of Object.entries(after)) {
        if (day === thisTuesday) continue;
        assert.equal(local, `${day} 18:00`);
      }
    });
  });
});

test('regenerating does not put the moved class back on its old day', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { groupId } = await tuesdays(tenant);

      const thisTuesday = Object.keys(await weeks(tenant, groupId))[1]!;
      const [session] = (await tenant.sql(
        'SELECT id FROM class_session WHERE class_group_id = $1 AND occurs_on = $2::date',
        [groupId, thisTuesday],
      )) as { id: string }[];

      const wednesday = new Date(`${thisTuesday}T00:00:00Z`);
      wednesday.setUTCDate(wednesday.getUTCDate() + 1);

      await new SessionsCalendarController().move(session!.id, {
        date: wednesday.toISOString().slice(0, 10),
        startTime: '19:00',
      });

      await tenant.sql('SELECT * FROM generate_sessions($1, $2::date, $3::date)', [
        tenant.organizationId,
        monday(-1),
        monday(3),
      ]);

      const counted = (await tenant.sql(
        'SELECT count(*)::int AS count FROM class_session WHERE class_group_id = $1 AND occurs_on = $2::date',
        [groupId, thisTuesday],
      )) as { count: number }[];

      // One class that week, not two. The generator dedupes on the day the
      // pattern implied, and a move deliberately does not change it.
      assert.equal(counted[0]?.count, 1);
    });
  });
});

test('moving the pattern carries the future weeks and leaves the past alone', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { groupId, scheduleId } = await tuesdays(tenant);

      const days = Object.keys(await weeks(tenant, groupId));
      const lastTuesday = days[0]!;

      // Thursdays at 17:30, from now on.
      await new ClassesController().moveSlot(groupId, scheduleId, {
        weekday: '4',
        startTime: '17:30',
      });

      const after = await weeks(tenant, groupId);

      // The week already taught keeps the time it was taught at. A register is a
      // record of what happened, and rewriting it would make the record wrong.
      assert.equal(after[lastTuesday], `${lastTuesday} 18:00`);

      // Every week from this one forward is on the Thursday of its own week.
      for (const tuesday of days.slice(1)) {
        const thursday = new Date(`${tuesday}T00:00:00Z`);
        thursday.setUTCDate(thursday.getUTCDate() + 2);
        const day = thursday.toISOString().slice(0, 10);
        assert.equal(after[day], `${day} 17:30`);
      }
    });
  });
});

test('"every week" does not undo a week somebody had already moved by hand', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { groupId, scheduleId } = await tuesdays(tenant);

      const days = Object.keys(await weeks(tenant, groupId));
      const nextTuesday = days[2]!;
      const [session] = (await tenant.sql(
        'SELECT id FROM class_session WHERE class_group_id = $1 AND occurs_on = $2::date',
        [groupId, nextTuesday],
      )) as { id: string }[];

      // That one week: Saturday morning, because of a gala.
      const saturday = new Date(`${nextTuesday}T00:00:00Z`);
      saturday.setUTCDate(saturday.getUTCDate() + 4);
      const galaDay = saturday.toISOString().slice(0, 10);

      await new SessionsCalendarController().move(session!.id, {
        date: galaDay,
        startTime: '10:00',
      });

      // And only afterwards, the pattern itself moves to Thursdays.
      await new ClassesController().moveSlot(groupId, scheduleId, {
        weekday: '4',
        startTime: '17:30',
      });

      const after = await weeks(tenant, groupId);

      // The answer already given stands. `moved_at` is what says so, and this is
      // the whole reason the column exists.
      assert.equal(after[nextTuesday], `${galaDay} 10:00`);
    });
  });
});

test('an instructor cannot move one week', async () => {
  await withScratchTenant(async (tenant) => {
    let sessionId = '';

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { groupId } = await tuesdays(tenant);
      const [session] = (await tenant.sql(
        'SELECT id FROM class_session WHERE class_group_id = $1 ORDER BY occurs_on LIMIT 1',
        [groupId],
      )) as { id: string }[];
      sessionId = session!.id;
    });

    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      // Taking a register is theirs; rearranging the timetable is not.
      await expectStatus(
        () =>
          new SessionsCalendarController().move(sessionId, {
            date: monday(0),
            startTime: '19:00',
          }),
        403,
      );
    });
  });
});
