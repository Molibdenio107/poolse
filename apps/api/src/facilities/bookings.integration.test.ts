import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import { BookingsController } from './bookings.controller.js';
import { GridController } from './grid.controller.js';
import { PartnersController } from './partners.controller.js';
import { SessionsCalendarController } from '../classes/sessions.controller.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';
import type { ScratchTenant } from '../test/harness.js';

/**
 * What a drag on the lane grid writes — POOLSE-50.
 *
 * The gestures live in the browser; these are the rules underneath them, which
 * is where they have to hold whether the drop came from a pointer, a keyboard or
 * somebody reconstructing the request by hand.
 *
 * **A lane span is contiguous or it is refused.** Lanes 2 and 4 with 3 free
 * between them is not a booking a pool can honour. The gesture refuses it too;
 * this is the rule the gesture is a convenience for.
 *
 * **A collision names the lane and who is in it.** "There is a conflict" sends
 * an operator hunting across six lanes; "Pista 3, Infantis" does not.
 *
 * **A duplicate is one transaction.** A copy that existed with no lanes would
 * look, on the grid, exactly like a booking somebody forgot to place.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

async function sixLanePool(tenant: ScratchTenant): Promise<string[]> {
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind)
     VALUES ($1, $2, 'Tanque Grande', 'indoor') RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );
  await tenant.sql(`UPDATE lane SET name = 'Pista 1' WHERE pool_id = $1 AND position = 1`, [
    pool!.id,
  ]);
  await tenant.sql(
    `INSERT INTO lane (organization_id, pool_id, name, position)
     SELECT $1, $2, 'Pista ' || n, n FROM generate_series(2, 6) AS n`,
    [tenant.organizationId, pool!.id],
  );
  const lanes = await tenant.sql<{ id: string }>(
    `SELECT id FROM lane WHERE pool_id = $1 ORDER BY position`,
    [pool!.id],
  );
  return lanes.map((lane) => lane.id);
}

async function slot(tenant: ScratchTenant, from: string, to: string): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO facility_time_slot
       (organization_id, facility_id, season_id, day_group, start_time, end_time)
     VALUES ($1, $2, $3, 'weekday', $4::time, $5::time) RETURNING id`,
    [tenant.organizationId, tenant.facilityId, tenant.seasonId, from, to],
  );
  return row!.id;
}

/** A parceria booking, which is the subject the grid was built for. */
async function parceria(
  tenant: ScratchTenant,
  partnerName: string,
  groupName: string,
  slotId: string,
  weekday: number,
  startTime: string,
  laneIds: string[],
): Promise<string> {
  const partners = new PartnersController();
  const partner = await partners.create(tenant.facilityId, {
    name: partnerName,
    type: 'escola',
  });
  const group = await partners.createGroup(partner.id, { name: groupName });

  const [booking] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_schedule
       (organization_id, facility_id, subject_type, partner_group_id, season_id,
        slot_id, weekday, start_time, duration_minutes)
     VALUES ($1, $2, 'parceria', $3, $4, $5, $6, $7::time, 45) RETURNING id`,
    [
      tenant.organizationId,
      tenant.facilityId,
      group.id,
      tenant.seasonId,
      slotId,
      weekday,
      startTime,
    ],
  );

  if (laneIds.length > 0) {
    await tenant.sql(
      `INSERT INTO booking_lane (organization_id, schedule_id, lane_id)
       SELECT $1, $2, unnest($3::uuid[])`,
      [tenant.organizationId, booking!.id, laneIds],
    );
  }

  return booking!.id;
}

test('a booking moves to another day, slot and lane', async () => {
  await withScratchTenant(async (tenant) => {
    const bookings = new BookingsController();
    const grid = new GridController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const lanes = await sixLanePool(tenant);
      const early = await slot(tenant, '18:30', '19:15');
      const late = await slot(tenant, '19:15', '20:00');

      const id = await parceria(tenant, 'EPA', '6A', early, 3, '18:30', [lanes[1]!]);

      // QA 50.1 — 3ª 18:30 lane 2 becomes 5ª 19:15 lane 4.
      await bookings.move(id, { weekday: 5, slotId: late, laneIds: [lanes[3]] });

      const after = await grid.read(tenant.facilityId);
      const moved = after.bookings.find((booking) => booking.id === id);
      assert.equal(moved?.weekday, 5);
      assert.equal(moved?.startTime, '19:15');
      assert.equal(moved?.slotId, late);
      assert.deepEqual(moved?.laneIds, [lanes[3]]);
    });
  });
});

test('a block takes the length of the row it lands in', async () => {
  await withScratchTenant(async (tenant) => {
    const bookings = new BookingsController();
    const grid = new GridController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const lanes = await sixLanePool(tenant);
      const short = await slot(tenant, '18:30', '19:15');
      const long = await slot(tenant, '20:00', '21:30');

      const id = await parceria(tenant, 'EPA', '6A', short, 3, '18:30', [lanes[0]!]);

      await bookings.move(id, { weekday: 3, slotId: long, laneIds: [lanes[0]] });

      // 90 minutes, because that is what the row is. A block that kept its 45
      // would draw half a row and lie about what the pool is doing.
      const after = await grid.read(tenant.facilityId);
      assert.equal(after.bookings.find((b) => b.id === id)?.durationMinutes, 90);
    });
  });
});

test('an explicit duration outlives the slot it sits in', async () => {
  await withScratchTenant(async (tenant) => {
    const bookings = new BookingsController();
    const grid = new GridController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const lanes = await sixLanePool(tenant);
      const first = await slot(tenant, '09:30', '10:15');
      await slot(tenant, '10:15', '11:00');

      const id = await parceria(tenant, 'EPA', 'Masters', first, 3, '09:30', [lanes[0]!]);

      /*
       * The bottom edge dragged onto the row below: 09:30 for 90 minutes, which
       * is two rows of a 45-minute grid. Without this the class drew one row
       * tall and the 10:15 row looked free while the pool was busy.
       */
      await bookings.move(id, {
        weekday: 3,
        slotId: first,
        laneIds: [lanes[0]],
        durationMinutes: 90,
      });

      const after = await grid.read(tenant.facilityId);
      const masters = after.bookings.find((booking) => booking.id === id);
      assert.equal(masters?.durationMinutes, 90, 'the explicit length beats the slot');
      // Still filed under the row it starts in — the grid draws the rest from
      // the duration rather than from a second slot reference.
      assert.equal(masters?.slotId, first);
      assert.equal(masters?.startTime, '09:30');

      // And a plain move with no duration goes back to taking the row's length.
      await bookings.move(id, { weekday: 3, slotId: first, laneIds: [lanes[0]] });
      const reset = await grid.read(tenant.facilityId);
      assert.equal(reset.bookings.find((b) => b.id === id)?.durationMinutes, 45);
    });
  });
});

test('a length longer than the class runs still collides on its own lane', async () => {
  await withScratchTenant(async (tenant) => {
    const bookings = new BookingsController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const lanes = await sixLanePool(tenant);
      const first = await slot(tenant, '09:30', '10:15');
      const second = await slot(tenant, '10:15', '11:00');

      const masters = await parceria(tenant, 'EPA', 'Masters', first, 3, '09:30', [lanes[0]!]);
      await parceria(tenant, 'Teresianas', 'Infantis', second, 3, '10:15', [lanes[0]!]);

      // Stretching Masters over 10:15 runs it into Infantis on the same lane —
      // the case the whole time-span feature exists to make visible.
      await assert.rejects(
        bookings.move(masters, {
          weekday: 3,
          slotId: first,
          laneIds: [lanes[0]],
          durationMinutes: 90,
        }),
        (error: unknown) => {
          assert.ok(error instanceof ConflictException);
          const body = error.getResponse() as {
            message: string;
            lane: string;
            holder: string;
            weekday: number;
            startTime: string;
          };
          assert.equal(body.message, 'laneTaken');
          assert.equal(body.holder, 'Infantis');

          /*
           * Where the blocker sits, not only what it is called — round 8.
           *
           * This check defends the recurring booking, which is right, because a
           * series move rewrites the recurring booking. But the calendar draws
           * each week's *session*, and a class every one of whose sessions has
           * been moved elsewhere is drawn nowhere near the slot its pattern
           * still holds. Rui met exactly that: a refusal naming a class he
           * could see on Saturday while being stopped on Wednesday, with
           * nothing on screen to explain it.
           *
           * So the day and the hour travel with the refusal. Asserted here
           * because they are consumed by a string in the web app and `tsc` has
           * no opinion about a field that quietly stops being sent.
           */
          assert.equal(body.lane, 'Pista 1');
          assert.equal(body.weekday, 3);
          assert.equal(body.startTime, '10:15');
          return true;
        },
      );
    });
  });
});

test('a lane span must be one unbroken run', async () => {
  await withScratchTenant(async (tenant) => {
    const bookings = new BookingsController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const lanes = await sixLanePool(tenant);
      const only = await slot(tenant, '18:30', '19:15');
      const id = await parceria(tenant, 'EPA', '6A', only, 3, '18:30', [lanes[1]!]);

      // Lanes 2–4 is a real competition squad and is accepted.
      await bookings.move(id, {
        weekday: 3,
        slotId: only,
        laneIds: [lanes[1], lanes[2], lanes[3]],
      });

      // QA 50.7 — lanes 2 and 4, skipping 3, is not.
      await assert.rejects(
        bookings.move(id, { weekday: 3, slotId: only, laneIds: [lanes[1], lanes[3]] }),
        (error: unknown) => {
          assert.ok(error instanceof ConflictException);
          const body = error.getResponse() as { message: string };
          assert.equal(body.message, 'lanesNotContiguous');
          return true;
        },
      );
    });
  });
});

test('a span across an occupied lane is refused, naming the lane and who holds it', async () => {
  await withScratchTenant(async (tenant) => {
    const bookings = new BookingsController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const lanes = await sixLanePool(tenant);
      const only = await slot(tenant, '18:30', '19:15');

      const mine = await parceria(tenant, 'EPA', '6A', only, 3, '18:30', [lanes[1]!]);
      await parceria(tenant, 'Teresianas', 'Infantis', only, 3, '18:30', [lanes[2]!]);

      // QA 50.6 — growing 2 into 2–4 runs into Infantis on lane 3.
      await assert.rejects(
        bookings.move(mine, {
          weekday: 3,
          slotId: only,
          laneIds: [lanes[1], lanes[2], lanes[3]],
        }),
        (error: unknown) => {
          assert.ok(error instanceof ConflictException);
          const body = error.getResponse() as { message: string; lane: string; holder: string };
          assert.equal(body.message, 'laneTaken');
          // Both named: which lane, and what is in it.
          assert.equal(body.lane, 'Pista 3');
          assert.equal(body.holder, 'Infantis');
          return true;
        },
      );
    });
  });
});

test('an overlapping booking clashes even when the start times differ', async () => {
  await withScratchTenant(async (tenant) => {
    const bookings = new BookingsController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const lanes = await sixLanePool(tenant);
      /*
       * One slot, because two overlapping ones cannot exist — the facility grid
       * has its own exclusion constraint and that is the schema being right. The
       * overlap being tested here is between two *bookings*, which is a
       * different question: the second one is fora da grelha, at a time the grid
       * does not offer, which is exactly how a club improvises mid-season.
       */
      const nine = await slot(tenant, '09:00', '10:00');

      await parceria(tenant, 'Teresianas', 'Infantis', nine, 2, '09:00', [lanes[0]!]);
      const mine = await parceria(tenant, 'EPA', '6A', nine, 2, '09:00', [lanes[1]!]);

      // Infantis holds lane 1 from 09:00 for an hour. 09:30 + 45 minutes shares
      // half of it while agreeing on no column at all — an equality check would
      // let this through and the pool would be sold twice.
      await tenant.sql(
        `UPDATE class_schedule SET duration_minutes = 60
          WHERE partner_group_id IN (SELECT id FROM partner_group WHERE name = 'Infantis')`,
      );

      await assert.rejects(
        bookings.move(mine, {
          weekday: 2,
          slotId: null,
          startTime: '09:30',
          laneIds: [lanes[0]],
        }),
        (error: unknown) => {
          assert.ok(error instanceof ConflictException);
          const body = error.getResponse() as { message: string; lane: string };
          assert.equal(body.message, 'laneTaken');
          assert.equal(body.lane, 'Pista 1');
          return true;
        },
      );

      // And the same move onto a free lane is fine, and lands fora da grelha
      // with the time it was given rather than a slot's.
      await bookings.move(mine, {
        weekday: 2,
        slotId: null,
        startTime: '09:30',
        laneIds: [lanes[4]],
      });

      const [row] = await tenant.sql<{ start_time: string; slot_id: string | null }>(
        `SELECT start_time::text, slot_id FROM class_schedule WHERE id = $1`,
        [mine],
      );
      assert.equal(row?.start_time.slice(0, 5), '09:30');
      assert.equal(row?.slot_id, null);
    });
  });
});

test('a duplicate lands on another day, carries the lanes, and leaves the original', async () => {
  await withScratchTenant(async (tenant) => {
    const bookings = new BookingsController();
    const grid = new GridController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const lanes = await sixLanePool(tenant);
      const only = await slot(tenant, '18:30', '19:15');

      const id = await parceria(tenant, 'EPA', '6A', only, 2, '18:30', [lanes[1]!, lanes[2]!]);

      // Notes are deliberately not carried — they usually name a date or reason.
      await tenant.sql(`UPDATE class_schedule SET notes = 'sala ocupada' WHERE id = $1`, [id]);

      // QA 50.8 — the reference schedule's 2ª/4ª/6ª repeat, in one gesture.
      const copy = await bookings.duplicate(id, {
        weekday: 4,
        slotId: only,
        laneIds: [lanes[1], lanes[2]],
      });

      const after = await grid.read(tenant.facilityId);
      assert.equal(after.bookings.length, 2);

      const original = after.bookings.find((booking) => booking.id === id);
      const made = after.bookings.find((booking) => booking.id === copy.id);

      assert.equal(original?.weekday, 2, 'the original stays where it was');
      assert.equal(made?.weekday, 4);
      assert.equal(made?.name, '6A');
      // The lanes came with it, in one transaction — never a booking with none.
      assert.deepEqual(made?.laneIds, [lanes[1], lanes[2]]);

      const [row] = await tenant.sql<{ notes: string | null }>(
        `SELECT notes FROM class_schedule WHERE id = $1`,
        [copy.id],
      );
      assert.equal(row?.notes, null, 'a note names a date or a reason and does not travel');
    });
  });
});

test('duplicating a turma onto a slot it already runs in is refused in words', async () => {
  await withScratchTenant(async (tenant) => {
    const bookings = new BookingsController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const lanes = await sixLanePool(tenant);
      const only = await slot(tenant, '18:30', '19:15');

      const [level] = await tenant.sql<{ id: string }>(
        `INSERT INTO student_level (organization_id, name, sort_order)
         VALUES ($1, 'Iniciação', 1) RETURNING id`,
        [tenant.organizationId],
      );
      const [turma] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_group (organization_id, season_id, facility_id, name, level_id)
         VALUES ($1, $2, $3, 'Cadetes', $4) RETURNING id`,
        [tenant.organizationId, tenant.seasonId, tenant.facilityId, level!.id],
      );
      const [booking] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_schedule
           (organization_id, facility_id, subject_type, class_group_id,
            slot_id, weekday, start_time, duration_minutes)
         VALUES ($1, $2, 'turma', $3, $4, 2, '18:30', 45) RETURNING id`,
        [tenant.organizationId, tenant.facilityId, turma!.id, only],
      );

      // QA 50.10 — the same turma twice at the same moment. `class_schedule_slot_uq`
      // catches it; the operator must hear about the turma, not the index.
      await assert.rejects(
        bookings.duplicate(booking!.id, { weekday: 2, slotId: only, laneIds: [lanes[3]] }),
        (error: unknown) => {
          assert.ok(error instanceof ConflictException);
          assert.equal((error.getResponse() as { message: string }).message, 'alreadyThere');
          return true;
        },
      );
    });
  });
});

test('an instructor cannot move or duplicate, whatever the interface shows them', async () => {
  await withScratchTenant(async (tenant) => {
    const bookings = new BookingsController();

    let id = '';
    let lanes: string[] = [];
    let only = '';

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      lanes = await sixLanePool(tenant);
      only = await slot(tenant, '18:30', '19:15');
      id = await parceria(tenant, 'EPA', '6A', only, 3, '18:30', [lanes[1]!]);
    });

    // QA 50.15. Hiding the grip is a courtesy; this is the control.
    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      await expectStatus(
        () => bookings.move(id, { weekday: 4, slotId: only, laneIds: [lanes[1]] }),
        403,
      );
      await expectStatus(
        () => bookings.duplicate(id, { weekday: 4, slotId: only, laneIds: [lanes[2]] }),
        403,
      );
    });
  });
});

test('another tenant cannot move this booking', async () => {
  await withScratchTenant(async (outsider) => {
    await withScratchTenant(async (owner) => {
      const bookings = new BookingsController();

      let id = '';
      let lanes: string[] = [];
      let only = '';

      await actingAs(owner, { roles: ['owner'] }, async () => {
        lanes = await sixLanePool(owner);
        only = await slot(owner, '18:30', '19:15');
        id = await parceria(owner, 'EPA', '6A', only, 3, '18:30', [lanes[1]!]);
      });

      await actingAs(outsider, { roles: ['owner'] }, async () => {
        // Row-level security means the booking is simply not there to move.
        await expectStatus(
          () => bookings.move(id, { weekday: 4, slotId: only, laneIds: [] }),
          404,
        );
      });
    });
  });
});

/**
 * A series move takes its weeks with it — round 8.
 *
 * Without this the move was written and then invisible: the calendar draws each
 * booking where its `class_session` for that week actually is (round 7's
 * overlay, which is what made one-week moves visible), and a series move
 * rewrote only `class_schedule`. The block sprang straight back to the session's
 * old slot on the next render, with no error, because nothing had failed.
 *
 * The same drift is what produced refusals citing classes nobody could see: a
 * booking whose pattern says Wednesday 14:15 while every session sits at 10:15
 * still defends 14:15 against everyone else.
 *
 * `moveOccurrence` is the other side of this and stays as it is — a session
 * moved by hand is an exception the timetable must not overwrite.
 */
async function sessionsOf(
  tenant: ScratchTenant,
  scheduleId: string,
): Promise<{ occurs_on: string; at: string; lanes: string | null }[]> {
  return tenant.sql<{ occurs_on: string; at: string; lanes: string | null }>(
    `SELECT s.occurs_on::text AS occurs_on,
            to_char(s.starts_at AT TIME ZONE 'Europe/Lisbon', 'HH24:MI') AS at,
            (SELECT string_agg(l.name, ',' ORDER BY l.position)
               FROM class_session_lane csl JOIN lane l ON l.id = csl.lane_id
              WHERE csl.session_id = s.id) AS lanes
       FROM class_session s
      WHERE s.schedule_id = $1
      ORDER BY s.occurs_on`,
    [scheduleId],
  );
}

/** A generated week, as the season builder would leave it. */
async function session(
  tenant: ScratchTenant,
  scheduleId: string,
  occursOn: string,
  startTime: string,
  laneIds: string[],
  moved = false,
): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_session
       (organization_id, schedule_id, occurs_on, starts_at, ends_at, duration_minutes, moved_at)
     VALUES ($1, $2, $3::date,
             ($3::date + $4::time) AT TIME ZONE 'Europe/Lisbon',
             ($3::date + $4::time) AT TIME ZONE 'Europe/Lisbon' + interval '45 minutes',
             45, $5)
     RETURNING id`,
    [tenant.organizationId, scheduleId, occursOn, startTime, moved ? new Date() : null],
  );

  await tenant.sql(
    `INSERT INTO class_session_lane
       (organization_id, session_id, lane_id, starts_at, ends_at)
     SELECT $1, s.id, unnest($3::uuid[]), s.starts_at, s.ends_at
       FROM class_session s WHERE s.id = $2`,
    [tenant.organizationId, row!.id, laneIds],
  );
  return row!.id;
}

/** A Wednesday comfortably in the future, so "from today on" is unambiguous. */
function wednesdayIn(weeks: number): string {
  const day = new Date();
  day.setUTCHours(12, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() + ((3 - day.getUTCDay() + 7) % 7) + weeks * 7);
  return day.toISOString().slice(0, 10);
}

test('a series move takes its weeks with it', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const lanes = await sixLanePool(tenant);
      const early = await slot(tenant, '10:00', '10:45');
      const late = await slot(tenant, '16:00', '16:45');

      const id = await parceria(tenant, 'EPA', '6A', early, 3, '10:00', [lanes[1]!]);
      const next = wednesdayIn(1);
      const after = wednesdayIn(2);
      await session(tenant, id, next, '10:00', [lanes[1]!]);
      await session(tenant, id, after, '10:00', [lanes[1]!]);

      const moved = await new BookingsController().move(id, {
        weekday: 3,
        slotId: late,
        laneIds: [lanes[3]],
      });

      assert.equal(moved.weeksFollowed, 2);
      assert.equal(moved.weeksBlocked, 0);

      const rows = await sessionsOf(tenant, id);
      assert.deepEqual(
        rows.map((row) => `${row.occurs_on} ${row.at} ${row.lanes}`),
        [`${next} 16:00 Pista 4`, `${after} 16:00 Pista 4`],
      );
    });
  });
});

test('a week moved by hand is not overwritten by a later series move', async () => {
  // The whole point of `moved_at`: "pista 3 is shut that Tuesday" has to
  // survive a later change to the timetable, or one-week moves are a lie.
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const lanes = await sixLanePool(tenant);
      const early = await slot(tenant, '10:00', '10:45');
      const late = await slot(tenant, '16:00', '16:45');

      const id = await parceria(tenant, 'EPA', '6A', early, 3, '10:00', [lanes[1]!]);
      const exception = wednesdayIn(1);
      const ordinary = wednesdayIn(2);
      await session(tenant, id, exception, '08:30', [lanes[5]!], true);
      await session(tenant, id, ordinary, '10:00', [lanes[1]!]);

      const moved = await new BookingsController().move(id, {
        weekday: 3,
        slotId: late,
        laneIds: [lanes[3]],
      });

      assert.equal(moved.weeksFollowed, 1);

      const rows = await sessionsOf(tenant, id);
      assert.deepEqual(
        rows.map((row) => `${row.occurs_on} ${row.at} ${row.lanes}`),
        // The exception keeps its own hour and its own pista; the ordinary week
        // follows the pattern.
        [`${exception} 08:30 Pista 6`, `${ordinary} 16:00 Pista 4`],
      );
    });
  });
});

test('a week already taught is left exactly where it happened', async () => {
  // A taught class is a record, not a plan — the same rule `moveOccurrence`
  // enforces for a single occurrence, applied to the series.
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const lanes = await sixLanePool(tenant);
      const early = await slot(tenant, '10:00', '10:45');
      const late = await slot(tenant, '16:00', '16:45');

      const id = await parceria(tenant, 'EPA', '6A', early, 3, '10:00', [lanes[1]!]);
      const taught = wednesdayIn(1);
      const sessionId = await session(tenant, id, taught, '10:00', [lanes[1]!]);

      const [student] = await tenant.sql<{ id: string }>(
        `INSERT INTO student (organization_id, first_name, last_name)
         VALUES ($1, 'Ana', 'Matos') RETURNING id`,
        [tenant.organizationId],
      );
      await tenant.sql(
        `INSERT INTO attendance
           (organization_id, class_session_id, student_id, status, recorded_by_membership_id)
         VALUES ($1, $2, $3, 'present', $4)`,
        [tenant.organizationId, sessionId, student!.id, tenant.ownerMembershipId],
      );

      const moved = await new BookingsController().move(id, {
        weekday: 3,
        slotId: late,
        laneIds: [lanes[3]],
      });

      assert.equal(moved.weeksFollowed, 0);

      const rows = await sessionsOf(tenant, id);
      assert.equal(rows[0]?.at, '10:00');
      assert.equal(rows[0]?.lanes, 'Pista 2');
    });
  });
});

test('the week that was dragged follows, even if it had been moved by hand', async () => {
  /*
   * The exception to the exception — round 8, and the whole of Rui's third
   * report: "the every week set seems to not work, nothing happens, no feedback
   * whatsoever".
   *
   * He had spent the afternoon moving blocks one week at a time, so the session
   * in the week on screen was almost always `moved_at IS NOT NULL`. A series
   * move then re-timed three later weeks correctly and left the one block he was
   * looking at exactly where he had picked it up — with `weeksBlocked` at zero,
   * so nothing was said either. Indistinguishable from a feature that does
   * nothing at all.
   *
   * Naming the dragged week fixes it: the operator moved that very block a
   * second ago and answered "todas as semanas", so its old exception is spent.
   * Every *other* hand-moved week still stays, which the test below this one
   * holds still.
   */
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const lanes = await sixLanePool(tenant);
      const early = await slot(tenant, '10:00', '10:45');
      const late = await slot(tenant, '16:00', '16:45');

      const id = await parceria(tenant, 'EPA', '6A', early, 3, '10:00', [lanes[1]!]);
      const onScreen = wednesdayIn(1);
      const other = wednesdayIn(2);
      // The one being dragged, previously moved by hand to another hour.
      await session(tenant, id, onScreen, '08:30', [lanes[5]!], true);
      await session(tenant, id, other, '10:00', [lanes[1]!]);

      const moved = await new BookingsController().move(id, {
        weekday: 3,
        slotId: late,
        laneIds: [lanes[3]],
        fromDate: onScreen,
      });

      assert.equal(moved.weeksFollowed, 2);
      assert.equal(moved.weeksKept, 0);

      const rows = await sessionsOf(tenant, id);
      assert.deepEqual(
        rows.map((row) => `${row.occurs_on} ${row.at} ${row.lanes}`),
        [`${onScreen} 16:00 Pista 4`, `${other} 16:00 Pista 4`],
      );

      // And it is no longer an exception, so the next series move carries it too
      // without having to be told which week is on screen.
      const [after] = await tenant.sql<{ hand: boolean }>(
        `SELECT moved_at IS NOT NULL AS hand FROM class_session
          WHERE schedule_id = $1 AND occurs_on = $2::date`,
        [id, onScreen],
      );
      assert.equal(after?.hand, false);
    });
  });
});

test('weeks kept back are counted, so a block that does not move says why', async () => {
  // The silence was the defect. A hand-moved week staying put is correct and
  // invisible, and invisible is what made this read as broken.
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const lanes = await sixLanePool(tenant);
      const early = await slot(tenant, '10:00', '10:45');
      const late = await slot(tenant, '16:00', '16:45');

      const id = await parceria(tenant, 'EPA', '6A', early, 3, '10:00', [lanes[1]!]);
      await session(tenant, id, wednesdayIn(1), '08:30', [lanes[5]!], true);
      await session(tenant, id, wednesdayIn(2), '08:30', [lanes[5]!], true);
      await session(tenant, id, wednesdayIn(3), '10:00', [lanes[1]!]);

      // No `fromDate`: nothing was dragged, so every hand-moved week is kept.
      const moved = await new BookingsController().move(id, {
        weekday: 3,
        slotId: late,
        laneIds: [lanes[3]],
      });

      assert.equal(moved.weeksFollowed, 1);
      assert.equal(moved.weeksKept, 2);
      assert.equal(moved.weeksBlocked, 0);
    });
  });
});

/** `days` after an ISO date, as an ISO date. Noon, so no zone can shift the day. */
function plusDays(date: string, days: number): string {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/*
 * A session that has left its own week, and the two questions that then differ.
 *
 * `occurs_on` is the day the *pattern* implied and a one-week move deliberately
 * does not change it — that is what stops the next regeneration putting a second
 * class back on the old day. So a class moved from Sunday to Monday, or from a
 * Wednesday onto the Monday after it, sits in one ISO week while being filed
 * under another. Logged on 2026-09-07 as known and not fixed.
 *
 * `retimeSessions` asks two different things and used to ask both of `occurs_on`:
 *
 * - **which pattern week does this session belong to** — the answer that decides
 *   where it lands and whether that week is already behind us. `occurs_on` is
 *   the right source, and it keeps the one-session-per-pattern-week invariant
 *   the unique index is built on.
 * - **is this the block the operator just dragged** — an on-screen question. The
 *   calendar draws each session at `starts_at`, and the grid sends the day the
 *   block was sitting on. Answered from `occurs_on`, a block that had slipped
 *   into another week was not recognised as the dragged one, so the one thing
 *   the operator was looking at stayed exactly where they picked it up: round
 *   8's silent "every week does nothing", still there for a slipped week.
 */
test('the dragged week follows even when it had slipped into the next week', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const lanes = await sixLanePool(tenant);
      const early = await slot(tenant, '10:00', '10:45');
      const late = await slot(tenant, '16:00', '16:45');

      const id = await parceria(tenant, 'EPA', '6A', early, 3, '10:00', [lanes[1]!]);

      // The week it belongs to, and the Monday it was moved to — the next ISO week.
      const belongsTo = wednesdayIn(1);
      const onScreen = plusDays(belongsTo, 5);
      const ordinary = wednesdayIn(2);

      const slipped = await session(tenant, id, belongsTo, '10:00', [lanes[1]!]);
      // Moved by the real gesture, so the drift is the one the calendar makes.
      await new SessionsCalendarController().move(slipped, {
        date: onScreen,
        startTime: '08:30',
      });
      await session(tenant, id, ordinary, '10:00', [lanes[1]!]);

      const moved = await new BookingsController().move(id, {
        weekday: 3,
        slotId: late,
        laneIds: [lanes[3]],
        // The day the block was drawn on, which is the week the operator is in.
        fromDate: onScreen,
      });

      assert.equal(moved.weeksFollowed, 2);
      assert.equal(moved.weeksKept, 0);

      const rows = await sessionsOf(tenant, id);
      assert.deepEqual(
        rows.map((row) => `${row.occurs_on} ${row.at} ${row.lanes}`),
        // Back on its own pattern week, at the new hour and pista: the operator
        // said "todas as semanas", and this week's exception is spent.
        [`${belongsTo} 16:00 Pista 4`, `${ordinary} 16:00 Pista 4`],
      );
    });
  });
});

test('the week that follows is the one dragged, not the one that shares its week', async () => {
  // The other half of the same line. Matching by ISO week made every hand-moved
  // session in the week on screen look dragged — so with a slipped block the
  // wrong one lost its exception, and the block being held stayed put.
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const lanes = await sixLanePool(tenant);
      const early = await slot(tenant, '10:00', '10:45');
      const late = await slot(tenant, '16:00', '16:45');

      const id = await parceria(tenant, 'EPA', '6A', early, 3, '10:00', [lanes[1]!]);

      const belongsTo = wednesdayIn(1);
      const onScreen = plusDays(belongsTo, 5);
      const neighbour = wednesdayIn(2);

      const slipped = await session(tenant, id, belongsTo, '10:00', [lanes[1]!]);
      await new SessionsCalendarController().move(slipped, {
        date: onScreen,
        startTime: '08:30',
      });
      // Its neighbour owns the week on screen, and was itself moved by hand.
      await session(tenant, id, neighbour, '08:00', [lanes[5]!], true);

      const moved = await new BookingsController().move(id, {
        weekday: 3,
        slotId: late,
        laneIds: [lanes[3]],
        fromDate: onScreen,
      });

      assert.equal(moved.weeksFollowed, 1);
      assert.equal(moved.weeksKept, 1);

      const rows = await sessionsOf(tenant, id);
      assert.deepEqual(
        rows.map((row) => `${row.occurs_on} ${row.at} ${row.lanes}`),
        // The dragged one follows; the neighbour keeps the answer already given.
        [`${belongsTo} 16:00 Pista 4`, `${neighbour} 08:00 Pista 6`],
      );
    });
  });
});
