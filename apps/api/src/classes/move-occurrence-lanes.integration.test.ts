import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import { SessionsCalendarController } from './sessions.controller.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * One week's class in a different pista, without moving every week's.
 *
 * ---------------------------------------------------------------------------
 * The bug this is the fix for
 * ---------------------------------------------------------------------------
 *
 * The one-week move carried a date and a start time and nothing else. The
 * calendar offered "só esta semana" for a sideways drag anyway, so the pista the
 * operator had dropped the block on was thrown away and the move was then
 * checked against the pista the class was **already** in. If something was in
 * that old lane at the new hour it came back as "essa pista já está ocupada" —
 * naming a lane nobody had touched, while the lane they *had* touched sat
 * visibly empty. Reported as "it says the lane is taken and the lanes are free",
 * which is precisely what it was.
 *
 * A session has its own rows in `class_session_lane`, so one week genuinely can
 * differ from the pattern. These tests hold both halves of that: the week moves,
 * and no other week does.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

interface Fixture {
  groupId: string;
  /** This week's session — the one the tests move. */
  sessionId: string;
  /** Next week's, which must not move with it. */
  nextWeekId: string;
  lanes: string[];
}

/** Monday of the ISO week `weeks` from the Monday on or before today. */
function monday(weeks: number): string {
  const now = new Date();
  const day = (now.getUTCDay() + 6) % 7;
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day);
  return new Date(start + weeks * 7 * 86_400_000).toISOString().slice(0, 10);
}

/** The Tuesday of that week. */
function tuesday(weeks: number): string {
  const day = new Date(`${monday(weeks)}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

/**
 * A tank of four pistas, one turma on Tuesdays at 18:00 in pista 1, and two
 * weeks of it.
 *
 * Four lanes rather than two, so "move it two lanes across" is a real gesture
 * and the assertions are about a lane that was chosen rather than the only one
 * left.
 */
async function oneTurma(tenant: ScratchTenant): Promise<Fixture> {
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name) VALUES ($1, $2, 'Tanque')
     RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );

  /*
   * Position 1 is already there.
   *
   * `pool_create_default_lanes` gives a new tank one lane named after itself —
   * "a pool that never gets edited is a laneless tank, which is exactly one
   * lane". Inserting a position 1 of our own is refused by `lane_position_uq`,
   * correctly, so this renames the one that exists and adds the other three.
   */
  await tenant.sql(`UPDATE lane SET name = 'Pista 1' WHERE pool_id = $1 AND position = 1`, [
    pool!.id,
  ]);
  for (let position = 2; position <= 4; position += 1) {
    await tenant.sql(
      `INSERT INTO lane (organization_id, pool_id, name, position) VALUES ($1, $2, $3, $4)`,
      [tenant.organizationId, pool!.id, `Pista ${position}`, position],
    );
  }

  const lanes = (
    await tenant.sql<{ id: string }>(
      `SELECT id FROM lane WHERE pool_id = $1 AND archived_at IS NULL ORDER BY position`,
      [pool!.id],
    )
  ).map((row) => row.id);

  const [group] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group (organization_id, season_id, facility_id, name, pool_id)
     VALUES ($1, $2, $3, 'Iniciação', $4) RETURNING id`,
    [tenant.organizationId, tenant.seasonId, tenant.facilityId, pool!.id],
  );

  const [schedule] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_schedule
       (organization_id, class_group_id, facility_id, weekday, start_time, duration_minutes)
     VALUES ($1, $2, $3, 2, TIME '18:00', 45) RETURNING id`,
    [tenant.organizationId, group!.id, tenant.facilityId],
  );

  await tenant.sql(
    `INSERT INTO booking_lane (organization_id, schedule_id, lane_id) VALUES ($1, $2, $3)`,
    [tenant.organizationId, schedule!.id, lanes[0]],
  );

  const ids: string[] = [];
  for (const week of [0, 1]) {
    const [session] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_session
         (organization_id, class_group_id, schedule_id, pool_id, occurs_on,
          starts_at, duration_minutes)
       VALUES ($1, $2, $3, $4, $5::date,
               ($5::date + TIME '18:00') AT TIME ZONE 'Europe/Lisbon', 45)
       RETURNING id`,
      [tenant.organizationId, group!.id, schedule!.id, pool!.id, tuesday(week)],
    );

    await tenant.sql(
      `INSERT INTO class_session_lane
         (organization_id, session_id, lane_id, starts_at, ends_at)
       SELECT cs.organization_id, cs.id, $2, cs.starts_at, cs.ends_at
         FROM class_session cs WHERE cs.id = $1`,
      [session!.id, lanes[0]],
    );

    ids.push(session!.id);
  }

  return { groupId: group!.id, sessionId: ids[0]!, nextWeekId: ids[1]!, lanes };
}

/** The lanes a session is in, as ids. */
async function lanesOf(tenant: ScratchTenant, sessionId: string): Promise<string[]> {
  const rows = await tenant.sql<{ lane_id: string }>(
    `SELECT csl.lane_id
       FROM class_session_lane csl
       JOIN lane l ON l.id = csl.lane_id
      WHERE csl.session_id = $1
      ORDER BY l.position`,
    [sessionId],
  );
  return rows.map((row) => row.lane_id);
}

test('one week changes pista, and next week does not', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const fixture = await oneTurma(tenant);

      await new SessionsCalendarController().move(fixture.sessionId, {
        date: tuesday(0),
        startTime: '18:00',
        laneIds: [fixture.lanes[2]!],
      });

      // This week is in pista 3.
      assert.deepEqual(await lanesOf(tenant, fixture.sessionId), [fixture.lanes[2]]);
      // Next week is still in pista 1 — the whole point of "só esta semana".
      assert.deepEqual(await lanesOf(tenant, fixture.nextWeekId), [fixture.lanes[0]]);

      // And the pattern itself is untouched: the booking still says pista 1, so
      // the week after next is generated back where it belongs.
      const pattern = await tenant.sql<{ lane_id: string }>(
        `SELECT bl.lane_id FROM booking_lane bl
           JOIN class_schedule cs ON cs.id = bl.schedule_id
          WHERE cs.class_group_id = $1`,
        [fixture.groupId],
      );
      assert.deepEqual(
        pattern.map((row) => row.lane_id),
        [fixture.lanes[0]],
      );
    });
  });
});

test('a move that changes only the hour leaves the pistas alone', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const fixture = await oneTurma(tenant);

      // No `laneIds` at all — absent means "I did not ask about pistas", which
      // is not the same as asking for none.
      await new SessionsCalendarController().move(fixture.sessionId, {
        date: tuesday(0),
        startTime: '19:30',
      });

      assert.deepEqual(await lanesOf(tenant, fixture.sessionId), [fixture.lanes[0]]);

      // And the lane rows followed the clock, or the exclusion constraint would
      // be guarding a window nobody is swimming in.
      const [row] = await tenant.sql<{ agrees: boolean }>(
        `SELECT csl.starts_at = cs.starts_at AND csl.ends_at = cs.ends_at AS agrees
           FROM class_session_lane csl
           JOIN class_session cs ON cs.id = csl.session_id
          WHERE csl.session_id = $1`,
        [fixture.sessionId],
      );
      assert.equal(row!.agrees, true);
    });
  });
});

test('a lane genuinely taken is refused, and says which lane and by whom', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const fixture = await oneTurma(tenant);

      // Somebody else already has pista 3 at that hour on that day.
      const [other] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_group (organization_id, season_id, facility_id, name, pool_id)
         SELECT $1, $2, $3, 'Masters', cs.pool_id
           FROM class_session cs WHERE cs.id = $4
         RETURNING id`,
        [tenant.organizationId, tenant.seasonId, tenant.facilityId, fixture.sessionId],
      );

      const [rival] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_session
           (organization_id, class_group_id, pool_id, occurs_on, starts_at, duration_minutes)
         SELECT $1, $2, cs.pool_id, cs.occurs_on, cs.starts_at, 45
           FROM class_session cs WHERE cs.id = $3
         RETURNING id`,
        [tenant.organizationId, other!.id, fixture.sessionId],
      );

      await tenant.sql(
        `INSERT INTO class_session_lane
           (organization_id, session_id, lane_id, starts_at, ends_at)
         SELECT cs.organization_id, cs.id, $2, cs.starts_at, cs.ends_at
           FROM class_session cs WHERE cs.id = $1`,
        [rival!.id, fixture.lanes[2]],
      );

      await assert.rejects(
        new SessionsCalendarController().move(fixture.sessionId, {
          date: tuesday(0),
          startTime: '18:00',
          laneIds: [fixture.lanes[2]!],
        }),
        (error: unknown) => {
          assert.ok(error instanceof ConflictException);
          // The figures as structure, so the screen can say "Pista 3 · Masters"
          // rather than sending somebody hunting across four lanes.
          const body = error.getResponse() as { message: string; lane: string; holder: string };
          assert.equal(body.message, 'occurrenceOccupied');
          assert.equal(body.lane, 'Pista 3');
          assert.equal(body.holder, 'Masters');
          return true;
        },
      );

      // And the refusal changed nothing: the class is still in pista 1.
      assert.deepEqual(await lanesOf(tenant, fixture.sessionId), [fixture.lanes[0]]);
    });
  });
});

test('the refused move leaves the hour alone too', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const fixture = await oneTurma(tenant);

      const [rivalGroup] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_group (organization_id, season_id, facility_id, name, pool_id)
         SELECT $1, $2, $3, 'Hidro', cs.pool_id
           FROM class_session cs WHERE cs.id = $4
         RETURNING id`,
        [tenant.organizationId, tenant.seasonId, tenant.facilityId, fixture.sessionId],
      );

      const [rival] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_session
           (organization_id, class_group_id, pool_id, occurs_on, starts_at, duration_minutes)
         SELECT $1, $2, cs.pool_id, cs.occurs_on,
                cs.starts_at + interval '2 hours', 45
           FROM class_session cs WHERE cs.id = $3
         RETURNING id`,
        [tenant.organizationId, rivalGroup!.id, fixture.sessionId],
      );

      await tenant.sql(
        `INSERT INTO class_session_lane
           (organization_id, session_id, lane_id, starts_at, ends_at)
         SELECT cs.organization_id, cs.id, $2, cs.starts_at, cs.ends_at
           FROM class_session cs WHERE cs.id = $1`,
        [rival!.id, fixture.lanes[1]],
      );

      const before = await tenant.sql<{ local: string }>(
        `SELECT to_char(starts_at AT TIME ZONE 'Europe/Lisbon', 'YYYY-MM-DD HH24:MI') AS local
           FROM class_session WHERE id = $1`,
        [fixture.sessionId],
      );

      // 20:00 in pista 2, where Hidro already is.
      await expectStatus(
        () =>
          new SessionsCalendarController().move(fixture.sessionId, {
            date: tuesday(0),
            startTime: '20:00',
            laneIds: [fixture.lanes[1]!],
          }),
        409,
      );

      // The savepoint did its job: neither the clock nor the lanes moved.
      const after = await tenant.sql<{ local: string }>(
        `SELECT to_char(starts_at AT TIME ZONE 'Europe/Lisbon', 'YYYY-MM-DD HH24:MI') AS local
           FROM class_session WHERE id = $1`,
        [fixture.sessionId],
      );
      assert.equal(after[0]!.local, before[0]!.local);
      assert.deepEqual(await lanesOf(tenant, fixture.sessionId), [fixture.lanes[0]]);
    });
  });
});

test('a week can be put in no pista at all', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const fixture = await oneTurma(tenant);

      // An empty array is a real answer — a booking with no lane is an ordinary
      // state the grid draws — and it is not the same as omitting the field.
      await new SessionsCalendarController().move(fixture.sessionId, {
        date: tuesday(0),
        startTime: '18:00',
        laneIds: [],
      });

      assert.deepEqual(await lanesOf(tenant, fixture.sessionId), []);
      assert.deepEqual(await lanesOf(tenant, fixture.nextWeekId), [fixture.lanes[0]]);
    });
  });
});

/*
 * -----------------------------------------------------------------------------
 * A class that already happened
 * -----------------------------------------------------------------------------
 *
 * One mark on the register means somebody stood at the poolside with a list. The
 * day, the hour and the pista stop being a plan at that moment and become a
 * record of what happened, and a record is not dragged about.
 */

/** Marks one student present, which is all it takes for the class to have happened. */
async function takeRegister(tenant: ScratchTenant, sessionId: string): Promise<void> {
  const [student] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name)
     VALUES ($1, 'Matilde', 'Sousa') RETURNING id`,
    [tenant.organizationId],
  );

  await tenant.sql(
    `INSERT INTO attendance
       (organization_id, class_session_id, student_id, status, recorded_by_membership_id)
     VALUES ($1, $2, $3, 'present', $4)`,
    [tenant.organizationId, sessionId, student!.id, tenant.ownerMembershipId],
  );
}

test('a class whose register was taken does not move', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const fixture = await oneTurma(tenant);
      await takeRegister(tenant, fixture.sessionId);

      const before = await tenant.sql<{ local: string }>(
        `SELECT to_char(starts_at AT TIME ZONE 'Europe/Lisbon', 'YYYY-MM-DD HH24:MI') AS local
           FROM class_session WHERE id = $1`,
        [fixture.sessionId],
      );

      await assert.rejects(
        new SessionsCalendarController().move(fixture.sessionId, {
          date: tuesday(0),
          startTime: '19:30',
          laneIds: [fixture.lanes[2]!],
        }),
        (error: unknown) => {
          assert.ok(error instanceof ConflictException);
          const body = error.getResponse() as { message: string };
          // Its own refusal, not "that lane is busy" -- there is nothing the
          // operator could go and clear.
          assert.equal(body.message, 'occurrenceTaught');
          return true;
        },
      );

      // Neither the hour nor the pista moved.
      const after = await tenant.sql<{ local: string }>(
        `SELECT to_char(starts_at AT TIME ZONE 'Europe/Lisbon', 'YYYY-MM-DD HH24:MI') AS local
           FROM class_session WHERE id = $1`,
        [fixture.sessionId],
      );
      assert.equal(after[0]!.local, before[0]!.local);
      assert.deepEqual(await lanesOf(tenant, fixture.sessionId), [fixture.lanes[0]]);
    });
  });
});

test('the untaught weeks of the same turma still move', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const fixture = await oneTurma(tenant);
      // This week was taught; next week has not happened.
      await takeRegister(tenant, fixture.sessionId);

      await new SessionsCalendarController().move(fixture.nextWeekId, {
        date: tuesday(1),
        startTime: '18:00',
        laneIds: [fixture.lanes[2]!],
      });

      assert.deepEqual(await lanesOf(tenant, fixture.nextWeekId), [fixture.lanes[2]]);
      // And the taught one is exactly where it was.
      assert.deepEqual(await lanesOf(tenant, fixture.sessionId), [fixture.lanes[0]]);
    });
  });
});

/**
 * A length is one more thing a single week can differ in — round 8.
 *
 * The one-week move carried a date, a time and (since the tests above) a set of
 * pistas. It never carried a **length**, so dragging a block's bottom edge and
 * answering "só esta semana" wrote the hour and silently dropped the resize: the
 * block sprang back to its old height and the gesture looked like it had done
 * nothing — while the same drag answered "todas as semanas" worked, because the
 * series path has taken a duration since POOLSE-50.
 *
 * Reported as "resizing works for every week but not for this week".
 */
async function lengthOf(
  tenant: ScratchTenant,
  sessionId: string,
): Promise<{ mins: number; agrees: boolean }> {
  const [row] = await tenant.sql<{ mins: number; agrees: boolean }>(
    `SELECT cs.duration_minutes AS mins,
            cs.ends_at = cs.starts_at + make_interval(mins => cs.duration_minutes) AS agrees
       FROM class_session cs WHERE cs.id = $1`,
    [sessionId],
  );
  return { mins: row!.mins, agrees: row!.agrees };
}

test('one week can run longer, and next week does not', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const fixture = await oneTurma(tenant);
      const was = await lengthOf(tenant, fixture.sessionId);

      await new SessionsCalendarController().move(fixture.sessionId, {
        date: tuesday(0),
        startTime: '19:30',
        durationMinutes: 90,
      });

      const now = await lengthOf(tenant, fixture.sessionId);
      assert.equal(now.mins, 90);
      // `ends_at` is derived by a BEFORE trigger rather than written here, so a
      // duration that changed without it would leave the two disagreeing — and
      // the lane exclusion is on a window built from them.
      assert.equal(now.agrees, true);

      // The point of "só esta semana": next week keeps the length it had.
      assert.equal((await lengthOf(tenant, fixture.nextWeekId)).mins, was.mins);
    });
  });
});

test('a move that does not mention a length leaves this week’s alone', async () => {
  // Absent means "I did not ask about the length", exactly as it does for
  // pistas. A plain time change must not quietly reset a week that was
  // deliberately made longer.
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const fixture = await oneTurma(tenant);
      const sessions = new SessionsCalendarController();

      await sessions.move(fixture.sessionId, {
        date: tuesday(0),
        startTime: '19:30',
        durationMinutes: 90,
      });
      await sessions.move(fixture.sessionId, { date: tuesday(0), startTime: '20:00' });

      const now = await lengthOf(tenant, fixture.sessionId);
      assert.equal(now.mins, 90);
      assert.equal(now.agrees, true);
    });
  });
});

test('a length outside the sane range is refused rather than written', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const fixture = await oneTurma(tenant);
      await expectStatus(
        () =>
          new SessionsCalendarController().move(fixture.sessionId, {
            date: tuesday(0),
            startTime: '19:30',
            durationMinutes: 900,
          }),
        400,
      );
    });
  });
});
