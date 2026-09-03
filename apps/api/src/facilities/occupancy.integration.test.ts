import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import { OccupancyController } from './occupancy.controller.js';
import { PartnersController } from './partners.controller.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';
import type { ScratchTenant } from '../test/harness.js';

/**
 * How much of the water is sold — POOLSE-52.
 *
 * Two arithmetic traps carry this suite, and both are named in the ticket.
 *
 * **A multi-lane booking multiplies lane-hours and never multiplies headcount.**
 * Thirty swimmers on a three-lane hidroginástica booking is thirty people and
 * 2.25 lane-hours, not ninety people. Getting that backwards would make the
 * fullest hour of the week look like the emptiest.
 *
 * **The denominator comes from the same dated calendar as the numerator.**
 * Closures and disabled weekdays reduce both halves. `slots × lanes × 7` makes
 * every club look under-booked, which is the version of this number that gets
 * quoted at a manager and then disbelieved.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/** A pool whose lanes have a known capacity, plus one that deliberately has none. */
async function pool(tenant: ScratchTenant): Promise<string[]> {
  const [made] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind)
     VALUES ($1, $2, 'Tanque Grande', 'indoor') RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );
  await tenant.sql(
    `UPDATE lane SET name = 'Pista 1', default_capacity = 10
      WHERE pool_id = $1 AND position = 1`,
    [made!.id],
  );
  await tenant.sql(
    `INSERT INTO lane (organization_id, pool_id, name, position, default_capacity)
     SELECT $1, $2, 'Pista ' || n, n, 10 FROM generate_series(2, 3) AS n`,
    [tenant.organizationId, made!.id],
  );
  // The fourth has no capacity, which is an ordinary state and the one the
  // percentage has to admit it cannot account for.
  await tenant.sql(
    `INSERT INTO lane (organization_id, pool_id, name, position)
     VALUES ($1, $2, 'Pista 4', 4)`,
    [tenant.organizationId, made!.id],
  );

  const lanes = await tenant.sql<{ id: string }>(
    `SELECT id FROM lane WHERE pool_id = $1 ORDER BY position`,
    [made!.id],
  );
  return lanes.map((lane) => lane.id);
}

/** One weekday slot, and the season narrowed to a single week so sums stay legible. */
async function oneWeek(tenant: ScratchTenant): Promise<string> {
  await tenant.sql(
    `UPDATE season SET starts_on = '2026-09-07', ends_on = '2026-09-13' WHERE id = $1`,
    [tenant.seasonId],
  );
  const [slot] = await tenant.sql<{ id: string }>(
    `INSERT INTO facility_time_slot
       (organization_id, facility_id, season_id, day_group, start_time, end_time)
     VALUES ($1, $2, $3, 'weekday', '09:00', '09:45') RETURNING id`,
    [tenant.organizationId, tenant.facilityId, tenant.seasonId],
  );
  return slot!.id;
}

/** A dated session, written straight in — the generator is not what is under test. */
async function session(
  tenant: ScratchTenant,
  scheduleId: string,
  onDate: string,
  startsAt: string,
  durationMinutes: number,
  laneIds: string[],
): Promise<void> {
  const [made] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_session
       (organization_id, schedule_id, class_group_id, pool_id, occurs_on,
        starts_at, duration_minutes)
     SELECT $1, $2, cs.class_group_id, NULL, $3::date, $4::timestamptz, $5
       FROM class_schedule cs WHERE cs.id = $2
     RETURNING id`,
    [tenant.organizationId, scheduleId, onDate, startsAt, durationMinutes],
  );

  if (laneIds.length > 0) {
    await tenant.sql(
      `INSERT INTO class_session_lane
         (organization_id, session_id, lane_id, starts_at, ends_at, cancelled)
       SELECT $1, $2, unnest($3::uuid[]), s.starts_at, s.ends_at, false
         FROM class_session s WHERE s.id = $2`,
      [tenant.organizationId, made!.id, laneIds],
    );
  }
}

async function parceriaBooking(
  tenant: ScratchTenant,
  slotId: string,
  participants: number,
  weekday: number,
  startTime: string,
): Promise<string> {
  const partners = new PartnersController();
  const partner = await partners.create(tenant.facilityId, {
    name: `Escola ${startTime}`,
    type: 'escola',
  });
  const group = await partners.createGroup(partner.id, {
    name: `Turma ${startTime}`,
    participantCount: participants,
  });

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
  return booking!.id;
}

test('three lanes multiply lane-hours and leave the headcount alone', async () => {
  await withScratchTenant(async (tenant) => {
    const occupancy = new OccupancyController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const lanes = await pool(tenant);
      const slot = await oneWeek(tenant);

      // 30 swimmers, 45 minutes, three lanes — QA 52.5 and 52.6 together.
      const booking = await parceriaBooking(tenant, slot, 30, 1, '09:00');
      await session(
        tenant,
        booking,
        '2026-09-07',
        '2026-09-07 09:00:00+01',
        45,
        [lanes[0]!, lanes[1]!, lanes[2]!],
      );

      const result = await occupancy.read(tenant.facilityId);

      // 45/60 × 3 = 2.25 lane-hours.
      assert.equal(Number(result.total.soldLaneHours), 2.25);
      // Thirty people, not ninety. The trap the ticket names.
      assert.equal(result.total.headcount, 30);
      assert.equal(result.total.parceriaHeadcount, 30);
      assert.equal(result.total.turmaHeadcount, 0);
    });
  });
});

test('a turma takes its headcount from active enrolments, and an override beats them', async () => {
  await withScratchTenant(async (tenant) => {
    const occupancy = new OccupancyController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const lanes = await pool(tenant);
      const slot = await oneWeek(tenant);

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

      // Fourteen active, one waiting and one ended — only the active ones count,
      // because a register that included the waiting list would be wrong on the day.
      await tenant.sql(
        `INSERT INTO student (organization_id, first_name, last_name)
         SELECT $1, 'Aluno', n::text FROM generate_series(1, 16) AS n`,
        [tenant.organizationId],
      );
      // `enrollment_check` demands an end date on an ended row, which is the
      // schema refusing to record that somebody left without saying when.
      await tenant.sql(
        `INSERT INTO enrollment
           (organization_id, class_group_id, student_id, status,
            waiting_position, joined_on, ended_on)
         SELECT $1, $2, s.id,
                (CASE WHEN rank <= 14 THEN 'active'
                      WHEN rank = 15 THEN 'waiting'
                      ELSE 'ended' END)::enrollment_status,
                (CASE WHEN rank = 15 THEN 1 END),
                '2026-09-01'::date,
                -- enrollment_check1 wants ended_on >= joined_on, so both are
                -- given rather than leaving joined_on to default to today.
                (CASE WHEN rank = 16 THEN '2026-09-30'::date END)
           FROM (
             SELECT s.id, s.last_name,
                    row_number() OVER (ORDER BY s.last_name::int) AS rank
               FROM student s WHERE s.organization_id = $1
           ) s`,
        [tenant.organizationId, turma!.id],
      );

      const [booking] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_schedule
           (organization_id, facility_id, subject_type, class_group_id,
            slot_id, weekday, start_time, duration_minutes)
         VALUES ($1, $2, 'turma', $3, $4, 1, '09:00', 45) RETURNING id`,
        [tenant.organizationId, tenant.facilityId, turma!.id, slot],
      );
      await session(tenant, booking!.id, '2026-09-07', '2026-09-07 09:00:00+01', 45, [lanes[0]!]);

      // QA 52.1
      let result = await occupancy.read(tenant.facilityId);
      assert.equal(result.total.headcount, 14);
      assert.equal(result.total.turmaHeadcount, 14);

      // QA 52.2 — the override wins outright.
      await tenant.sql(`UPDATE class_schedule SET headcount_override = 10 WHERE id = $1`, [
        booking!.id,
      ]);
      result = await occupancy.read(tenant.facilityId);
      assert.equal(result.total.headcount, 10);
    });
  });
});

test('a booking with nothing to count is zero, and is reported rather than dropped', async () => {
  await withScratchTenant(async (tenant) => {
    const occupancy = new OccupancyController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const lanes = await pool(tenant);
      const slot = await oneWeek(tenant);

      // QA 52.4 — an evento with no group and no override.
      const [booking] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_schedule
           (organization_id, facility_id, subject_type, title, season_id,
            slot_id, weekday, start_time, duration_minutes)
         VALUES ($1, $2, 'evento', 'Gala', $3, $4, 1, '09:00', 45) RETURNING id`,
        [tenant.organizationId, tenant.facilityId, tenant.seasonId, slot],
      );
      await session(tenant, booking!.id, '2026-09-07', '2026-09-07 09:00:00+01', 45, [lanes[0]!]);

      const result = await occupancy.read(tenant.facilityId);
      // Its lane-hours count; its headcount is a real zero rather than a null
      // that would have been silently excluded from the percentage.
      assert.equal(Number(result.total.soldLaneHours), 0.75);
      assert.equal(result.total.headcount, 0);
    });
  });
});

test('a lane with no capacity contributes lane-hours and is reported as uncovered', async () => {
  await withScratchTenant(async (tenant) => {
    const occupancy = new OccupancyController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const lanes = await pool(tenant);
      const slot = await oneWeek(tenant);

      // Pista 4 has no capacity; Pista 1 has ten places.
      const booking = await parceriaBooking(tenant, slot, 8, 1, '09:00');
      await session(
        tenant,
        booking,
        '2026-09-07',
        '2026-09-07 09:00:00+01',
        45,
        [lanes[0]!, lanes[3]!],
      );

      const result = await occupancy.read(tenant.facilityId);

      // QA 52.7 — two lanes of lane-hours, one lane of places, and the gap named.
      assert.equal(Number(result.total.soldLaneHours), 1.5);
      assert.equal(result.lanesWithoutCapacity, 1);
      // 8 swimmers against the 10 places the one covered lane offers.
      assert.equal(result.seatOccupancy, 80);
    });
  });
});

test('time bands split at 12:00 and 18:00', async () => {
  await withScratchTenant(async (tenant) => {
    const occupancy = new OccupancyController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const lanes = await pool(tenant);
      const slot = await oneWeek(tenant);

      // QA 52.11 — 11:45 is manhã, 12:00 is tarde, 18:00 is noite.
      /*
       * A lane each. 11:45+45 runs to 12:30 and 12:00+45 to 12:45, so the first
       * two overlap — `class_session_lane`'s exclusion constraint refuses them on
       * one lane, correctly, and the fixture has to respect that rather than
       * work around it.
       */
      const banded = [
        ['11:45', 5, lanes[0]!],
        ['12:00', 7, lanes[1]!],
        ['18:00', 9, lanes[2]!],
      ] as const;

      for (const [time, participants, lane] of banded) {
        const booking = await parceriaBooking(tenant, slot, participants, 1, time);
        await session(tenant, booking, '2026-09-07', `2026-09-07 ${time}:00+01`, 45, [lane]);
      }

      const result = await occupancy.read(tenant.facilityId);
      const band = (name: string): number =>
        result.byBand.find((entry) => entry.band === name)?.headcount ?? -1;

      assert.equal(band('manha'), 5);
      assert.equal(band('tarde'), 7);
      assert.equal(band('noite'), 9);
    });
  });
});

test('a disabled weekday and a closure both shrink the available hours', async () => {
  await withScratchTenant(async (tenant) => {
    const occupancy = new OccupancyController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await pool(tenant);
      await oneWeek(tenant);

      // Seven days, five weekday slots of 45 minutes over four lanes.
      const open = await occupancy.read(tenant.facilityId);
      const before = Number(open.total.availableLaneHours);
      assert.ok(before > 0, 'a site with a grid has available hours');

      // QA 52.9 — Wednesday off.
      await tenant.sql(
        `UPDATE facility_hours SET available = false WHERE facility_id = $1 AND weekday = 3`,
        [tenant.facilityId],
      );
      const withoutWednesday = Number(
        (await occupancy.read(tenant.facilityId)).total.availableLaneHours,
      );
      assert.ok(
        withoutWednesday < before,
        `a disabled weekday must remove hours: ${withoutWednesday} vs ${before}`,
      );

      // QA 52.8 — and a closure takes another day with it.
      await tenant.sql(
        `INSERT INTO closure (organization_id, starts_on, ends_on, reason, blocks_generation)
         VALUES ($1, '2026-09-08', '2026-09-08', 'Obras', true)`,
        [tenant.organizationId],
      );
      const withClosure = Number(
        (await occupancy.read(tenant.facilityId)).total.availableLaneHours,
      );
      assert.ok(
        withClosure < withoutWednesday,
        `a closure must remove hours: ${withClosure} vs ${withoutWednesday}`,
      );
    });
  });
});

test('the turma and parceria halves sum to the whole', async () => {
  await withScratchTenant(async (tenant) => {
    const occupancy = new OccupancyController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const lanes = await pool(tenant);
      const slot = await oneWeek(tenant);

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
      const [turmaBooking] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_schedule
           (organization_id, facility_id, subject_type, class_group_id, slot_id,
            weekday, start_time, duration_minutes, headcount_override)
         VALUES ($1, $2, 'turma', $3, $4, 1, '09:00', 45, 12) RETURNING id`,
        [tenant.organizationId, tenant.facilityId, turma!.id, slot],
      );
      await session(
        tenant,
        turmaBooking!.id,
        '2026-09-07',
        '2026-09-07 09:00:00+01',
        45,
        [lanes[0]!],
      );

      const parceria = await parceriaBooking(tenant, slot, 24, 1, '10:00');
      await session(
        tenant,
        parceria,
        '2026-09-07',
        '2026-09-07 10:00:00+01',
        45,
        [lanes[1]!, lanes[2]!],
      );

      const result = await occupancy.read(tenant.facilityId);

      // QA 52.10 — both units, and both halves add up.
      assert.equal(
        Number(result.total.turmaLaneHours) + Number(result.total.parceriaLaneHours),
        Number(result.total.soldLaneHours),
      );
      assert.equal(
        result.total.turmaHeadcount + result.total.parceriaHeadcount,
        result.total.headcount,
      );
      assert.equal(Number(result.total.turmaLaneHours), 0.75);
      assert.equal(Number(result.total.parceriaLaneHours), 1.5);
      assert.equal(result.total.turmaHeadcount, 12);
      assert.equal(result.total.parceriaHeadcount, 24);
    });
  });
});

test('a draft season is refused by name rather than answered with zero', async () => {
  await withScratchTenant(async (tenant) => {
    const occupancy = new OccupancyController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await pool(tenant);
      await oneWeek(tenant);

      const [draft] = await tenant.sql<{ id: string }>(
        `INSERT INTO season (organization_id, name, starts_on, ends_on, status)
         VALUES ($1, '2027/2028', '2027-09-01', '2028-07-31', 'draft') RETURNING id`,
        [tenant.organizationId],
      );

      // QA 52.12, decided: a draft has no dated sessions, so 0% would be a lie
      // and the pattern would be a second definition of every figure.
      await assert.rejects(
        occupancy.read(tenant.facilityId, draft!.id),
        (error: unknown) => {
          assert.ok(error instanceof ConflictException);
          const body = error.getResponse() as { message: string; season: string };
          assert.equal(body.message, 'draftSeason');
          assert.equal(body.season, '2027/2028');
          return true;
        },
      );
    });
  });
});

test('an instructor sees occupancy and not what a school pays', async () => {
  await withScratchTenant(async (tenant) => {
    const occupancy = new OccupancyController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const lanes = await pool(tenant);
      const slot = await oneWeek(tenant);
      const booking = await parceriaBooking(tenant, slot, 24, 1, '09:00');
      await session(tenant, booking, '2026-09-07', '2026-09-07 09:00:00+01', 45, [lanes[0]!]);

      await new PartnersController().recordAgreement(
        (
          await tenant.sql<{ id: string }>(
            `SELECT id FROM partner WHERE organization_id = $1 LIMIT 1`,
            [tenant.organizationId],
          )
        )[0]!.id,
        {
          startDate: '2026-09-01',
          billingModel: 'por_hora_pista',
          unitPrice: '14.375',
        },
      );

      const asOwner = await occupancy.read(tenant.facilityId);
      assert.equal(asOwner.contractedCents, 1438, 'rounded once, at the end');
    });

    // QA 52.14 — the figures are theirs; the money is not.
    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      const result = await occupancy.read(tenant.facilityId);
      assert.equal(Number(result.total.soldLaneHours), 0.75);
      assert.equal(result.contractedCents, null);
    });
  });
});

test('another tenant reads nothing', async () => {
  await withScratchTenant(async (outsider) => {
    await withScratchTenant(async (owner) => {
      const occupancy = new OccupancyController();

      await actingAs(owner, { roles: ['owner'] }, async () => {
        await pool(owner);
        await oneWeek(owner);
      });

      // QA 52.15
      await actingAs(outsider, { roles: ['owner'] }, async () => {
        await expectStatus(() => occupancy.read(owner.facilityId), 404);
      });
    });
  });
});
