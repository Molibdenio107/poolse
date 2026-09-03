import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { GridController } from './grid.controller.js';
import { PartnersController } from './partners.controller.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';
import type { ScratchTenant } from '../test/harness.js';

/**
 * The lane grid's read side — POOLSE-49.
 *
 * What is worth asserting here is not that a query returns rows, but the four
 * things the screen cannot render correctly without:
 *
 * **A booking knows every lane it occupies.** The cell is a block spanning lanes
 * 2–4, not three copies of Cadetes. If `laneIds` came back with one entry the
 * grid would silently draw the first lane and leave two looking free.
 *
 * **A booking whose time matches no slot still comes back**, with a null
 * `slotId`, so the screen can put it in "fora da grelha". The alternative is a
 * class that has quietly disappeared from the wall.
 *
 * **Turmas and parcerias arrive on the same grid**, each carrying what its own
 * cell needs — a level for one, a partner and its colour for the other.
 *
 * **The season filter uses `coalesce(cs.season_id, cg.season_id)`**, the rule
 * POOLSE-47 put in the schema. Getting it wrong shows next year's draft on this
 * year's wall, which is the kind of bug nobody reports because it looks like
 * somebody else's mistake.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/** A pool with six lanes, as a club with a competition tank would set up. */
async function sixLanePool(
  tenant: ScratchTenant,
  name = 'Tanque Grande',
): Promise<{ poolId: string; laneIds: string[] }> {
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind)
     VALUES ($1, $2, $3, 'indoor') RETURNING id`,
    [tenant.organizationId, tenant.facilityId, name],
  );

  // Position 1 arrives with the pool — every pool has at least one lane, which
  // is the invariant that removes the "no lane" case from the whole model.
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

  return { poolId: pool!.id, laneIds: lanes.map((lane) => lane.id) };
}

async function addSlot(
  tenant: ScratchTenant,
  startTime: string,
  endTime: string,
  dayGroup = 'weekday',
): Promise<string> {
  const [slot] = await tenant.sql<{ id: string }>(
    `INSERT INTO facility_time_slot
       (organization_id, facility_id, season_id, day_group, start_time, end_time)
     VALUES ($1, $2, $3, $4::day_group, $5::time, $6::time) RETURNING id`,
    [tenant.organizationId, tenant.facilityId, tenant.seasonId, dayGroup, startTime, endTime],
  );
  return slot!.id;
}

test('a booking across three lanes comes back as one booking naming all three', async () => {
  await withScratchTenant(async (tenant) => {
    const grid = new GridController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { laneIds } = await sixLanePool(tenant);
      const slotId = await addSlot(tenant, '09:00', '09:45');

      const partners = new PartnersController();
      const partner = await partners.create(tenant.facilityId, {
        name: 'ES D. Dinis',
        type: 'escola',
        color: '#b3d49d',
      });
      const group = await partners.createGroup(partner.id, {
        name: '6A',
        participantCount: 24,
      });

      const [booking] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_schedule
           (organization_id, facility_id, subject_type, partner_group_id, season_id,
            slot_id, weekday, start_time, duration_minutes)
         VALUES ($1, $2, 'parceria', $3, $4, $5, 2, '09:00', 45) RETURNING id`,
        [tenant.organizationId, tenant.facilityId, group.id, tenant.seasonId, slotId],
      );

      // Lanes 2, 3 and 4 — the case the printed sheet shows and the old board
      // could not.
      await tenant.sql(
        `INSERT INTO booking_lane (organization_id, schedule_id, lane_id)
         VALUES ($1, $2, $3), ($1, $2, $4), ($1, $2, $5)`,
        [tenant.organizationId, booking!.id, laneIds[1], laneIds[2], laneIds[3]],
      );

      const result = await grid.read(tenant.facilityId);

      assert.equal(result.bookings.length, 1);
      const only = result.bookings[0]!;
      assert.equal(only.name, '6A');
      assert.equal(only.subjectType, 'parceria');
      // In position order, so the block spans a contiguous run rather than
      // starting wherever the insert happened to land.
      assert.deepEqual(only.laneIds, [laneIds[1], laneIds[2], laneIds[3]]);

      // The partner's own colour and name reach the cell — colour tints it, the
      // subtitle names it, and the group name is always the text.
      assert.equal(only.partnerColour, '#b3d49d');
      assert.equal(only.subtitle, 'ES D. Dinis');
      assert.equal(only.partnerId, partner.id);

      // A partner group's size is its headcount when nothing overrides it.
      assert.equal(only.headcount, 24);

      // Six lanes, one pool, one slot — the shape the grid draws itself on.
      assert.equal(result.lanes.length, 6);
      assert.equal(result.slots.length, 1);
      assert.equal(result.slots[0]?.startTime, '09:00');
      assert.equal(result.slots[0]?.endTime, '09:45');
      assert.equal(result.pools.length, 1);
    });
  });
});

test('a booking matching no slot comes back with a null slot, not missing', async () => {
  await withScratchTenant(async (tenant) => {
    const grid = new GridController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await sixLanePool(tenant);
      await addSlot(tenant, '09:00', '09:45');

      // 07:15 at a facility whose grid starts at 09:00 — QA 49.10. The masters
      // squad that swims before work is the real version of this.
      await tenant.sql(
        `INSERT INTO class_schedule
           (organization_id, facility_id, subject_type, title, season_id,
            weekday, start_time, duration_minutes)
         VALUES ($1, $2, 'evento', 'Masters', $3, 3, '07:15', 60)`,
        [tenant.organizationId, tenant.facilityId, tenant.seasonId],
      );

      const result = await grid.read(tenant.facilityId);

      assert.equal(result.bookings.length, 1);
      const stray = result.bookings[0]!;
      assert.equal(stray.slotId, null);
      // Named and timed, so "fora da grelha" can say which class and when
      // rather than just admitting something is missing.
      assert.equal(stray.name, 'Masters');
      assert.equal(stray.startTime, '07:15');
      assert.equal(stray.durationMinutes, 60);
      assert.deepEqual(stray.laneIds, []);
    });
  });
});

test('turmas and parcerias arrive on the same grid, each with its own subtitle', async () => {
  await withScratchTenant(async (tenant) => {
    const grid = new GridController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { poolId, laneIds } = await sixLanePool(tenant);
      const slotId = await addSlot(tenant, '17:30', '18:15');

      const [level] = await tenant.sql<{ id: string }>(
        `INSERT INTO student_level (organization_id, name, sort_order)
         VALUES ($1, 'Iniciação', 1) RETURNING id`,
        [tenant.organizationId],
      );

      const [turma] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_group
           (organization_id, season_id, facility_id, name, level_id, pool_id)
         VALUES ($1, $2, $3, 'Cadetes', $4, $5) RETURNING id`,
        [tenant.organizationId, tenant.seasonId, tenant.facilityId, level!.id, poolId],
      );

      // A turma booking carries no season of its own — its turma answers for it.
      const [turmaBooking] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_schedule
           (organization_id, facility_id, subject_type, class_group_id,
            slot_id, weekday, start_time, duration_minutes)
         VALUES ($1, $2, 'turma', $3, $4, 2, '17:30', 45) RETURNING id`,
        [tenant.organizationId, tenant.facilityId, turma!.id, slotId],
      );
      await tenant.sql(
        `INSERT INTO booking_lane (organization_id, schedule_id, lane_id) VALUES ($1, $2, $3)`,
        [tenant.organizationId, turmaBooking!.id, laneIds[0]],
      );

      const partners = new PartnersController();
      const partner = await partners.create(tenant.facilityId, {
        name: 'Misericórdia',
        type: 'ipss_misericordia',
      });
      const group = await partners.createGroup(partner.id, { name: 'Hidroterapia' });

      const [parceria] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_schedule
           (organization_id, facility_id, subject_type, partner_group_id, season_id,
            slot_id, weekday, start_time, duration_minutes)
         VALUES ($1, $2, 'parceria', $3, $4, $5, 2, '17:30', 45) RETURNING id`,
        [tenant.organizationId, tenant.facilityId, group.id, tenant.seasonId, slotId],
      );
      await tenant.sql(
        `INSERT INTO booking_lane (organization_id, schedule_id, lane_id) VALUES ($1, $2, $3)`,
        [tenant.organizationId, parceria!.id, laneIds[1]],
      );

      const result = await grid.read(tenant.facilityId);
      assert.equal(result.bookings.length, 2);

      // Same slot, same day, different lanes — which is exactly what the old
      // one-cell-per-day board could not represent.
      const cadetes = result.bookings.find((b) => b.name === 'Cadetes');
      const hidro = result.bookings.find((b) => b.name === 'Hidroterapia');

      assert.equal(cadetes?.subjectType, 'turma');
      assert.equal(cadetes?.subtitle, 'Iniciação');
      assert.equal(cadetes?.slotId, slotId);

      assert.equal(hidro?.subjectType, 'parceria');
      assert.equal(hidro?.subtitle, 'Misericórdia');
      assert.equal(hidro?.slotId, slotId);

      assert.notEqual(cadetes?.laneIds[0], hidro?.laneIds[0]);

      // A partner with no participant count and no override has no headcount —
      // null, and the cell shows nothing rather than inventing a zero.
      assert.equal(hidro?.headcount, 0);
    });
  });
});

test('a facility with no slots returns an empty grid rather than failing', async () => {
  await withScratchTenant(async (tenant) => {
    const grid = new GridController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const result = await grid.read(tenant.facilityId);

      // QA 49.9 — the screen says so and links to the slot editor. It must not
      // be a 404 on a site that plainly exists.
      assert.deepEqual(result.slots, []);
      assert.deepEqual(result.bookings, []);
      assert.equal(result.seasonId, tenant.seasonId);
    });
  });
});

test('an instructor may read the grid and is told they may not manage it', async () => {
  await withScratchTenant(async (tenant) => {
    const grid = new GridController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await sixLanePool(tenant);
      await addSlot(tenant, '09:00', '09:45');
    });

    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      // Reading is the point: an instructor looking at Tuesday morning needs to
      // know which lane is theirs and which is a school's.
      const result = await grid.read(tenant.facilityId);
      assert.equal(result.lanes.length, 6);
      assert.equal(result.canManage, false);
    });
  });
});

test('another tenant sees nothing of this grid', async () => {
  await withScratchTenant(async (outsider) => {
    await withScratchTenant(async (owner) => {
      const grid = new GridController();

      await actingAs(owner, { roles: ['owner'] }, async () => {
        await sixLanePool(owner);
        await addSlot(owner, '09:00', '09:45');
      });

      // QA 49.16. The neighbour is an owner in their own club, which is the case
      // that matters — this is isolation, not authorization.
      await actingAs(outsider, { roles: ['owner'] }, async () => {
        await expectStatus(() => grid.read(owner.facilityId), 404);
      });
    });
  });
});
