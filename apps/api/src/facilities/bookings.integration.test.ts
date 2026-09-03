import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import { BookingsController } from './bookings.controller.js';
import { GridController } from './grid.controller.js';
import { PartnersController } from './partners.controller.js';
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
