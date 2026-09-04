import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { GridController } from './grid.controller.js';
import { BookingsController } from './bookings.controller.js';
import { PartnersController } from './partners.controller.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
} from '../test/harness.js';
import type { ScratchTenant } from '../test/harness.js';

/**
 * "Sem professor" — the counter and the escalation — POOLSE-53.
 *
 * The state machine itself is proved against the database in
 * `packages/db/test/instructor-status.sql`; what is asserted here is everything
 * the *screen* depends on and the schema cannot promise on its own:
 *
 * **The count comes back with the grid, in the same request.** Criterion 9. A
 * second endpoint would be a second definition of "the season's bookings" —
 * remembering that a turma's season lives on its turma — and the day the two
 * drift is the day the header says 7 and the operator can find 6.
 *
 * **`external` is in neither total.** Criterion 7, and the difference between a
 * counter a club trusts and one that reports the four school bookings it was
 * never responsible for staffing.
 *
 * **Escalating is owner/admin, and the route is the control.** An instructor
 * seeing the counter is the point of the screen; an instructor declaring a slot
 * uncovered is a management act, and hiding the button is never the control.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/** One pool, four lanes. Enough to put four bookings side by side in one slot. */
async function pool(tenant: ScratchTenant): Promise<string[]> {
  const [created] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind)
     VALUES ($1, $2, 'Tanque Grande', 'indoor') RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );
  await tenant.sql(
    `INSERT INTO lane (organization_id, pool_id, name, position)
     SELECT $1, $2, 'Pista ' || n, n FROM generate_series(2, 4) AS n`,
    [tenant.organizationId, created!.id],
  );
  const lanes = await tenant.sql<{ id: string }>(
    `SELECT id FROM lane WHERE pool_id = $1 ORDER BY position`,
    [created!.id],
  );
  return lanes.map((lane) => lane.id);
}

async function addSlot(tenant: ScratchTenant, startTime: string, endTime: string): Promise<string> {
  const [slot] = await tenant.sql<{ id: string }>(
    `INSERT INTO facility_time_slot
       (organization_id, facility_id, season_id, day_group, start_time, end_time)
     VALUES ($1, $2, $3, 'weekday', $4::time, $5::time) RETURNING id`,
    [tenant.organizationId, tenant.facilityId, tenant.seasonId, startTime, endTime],
  );
  return slot!.id;
}

/** A turma and its one booking, optionally staffed. */
async function turmaBooking(
  tenant: ScratchTenant,
  name: string,
  startTime: string,
  instructorId: string | null,
): Promise<string> {
  const [turma] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group
       (organization_id, season_id, facility_id, name, instructor_membership_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenant.organizationId, tenant.seasonId, tenant.facilityId, name, instructorId],
  );

  const slotId = await addSlot(tenant, startTime, startTime === '17:30' ? '18:15' : '19:00');

  const [booking] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_schedule
       (organization_id, facility_id, subject_type, class_group_id,
        slot_id, weekday, start_time, duration_minutes)
     VALUES ($1, $2, 'turma', $3, $4, 2, $5::time, 45) RETURNING id`,
    [tenant.organizationId, tenant.facilityId, turma!.id, slotId, startTime],
  );
  return booking!.id;
}

test('the grid counts the two staffing gaps separately and names the season', async () => {
  await withScratchTenant(async (tenant) => {
    const grid = new GridController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await pool(tenant);
      const sandra = await addMember(tenant, 'Sandra', 'Lopes', ['instructor']);

      // One staffed, one not — the ordinary September state.
      await turmaBooking(tenant, 'Absolutos', '17:30', sandra);
      const cadetes = await turmaBooking(tenant, 'Cadetes', '18:15', null);

      const before = await grid.read(tenant.facilityId);

      /*
       * Both unstaffed bookings start `to_define`, and the uncovered count is
       * zero — nobody has said any of this is a problem yet. That is criterion
       * 2 seen from the endpoint: a blank is not evidence of which state it is.
       */
      assert.equal(before.staffing.uncovered, 0);
      assert.equal(before.staffing.toDefine, 1);

      // And it says which season the numbers are about — criterion 4.
      assert.equal(before.seasonId, tenant.seasonId);
      assert.ok(before.seasonName !== null && before.seasonName !== '');
      assert.equal(before.seasonStatus, 'published');

      const bookings = new BookingsController();
      await bookings.instructorStatus(cadetes, { status: 'uncovered' });

      const after = await grid.read(tenant.facilityId);
      assert.equal(after.staffing.uncovered, 1);
      assert.equal(after.staffing.toDefine, 0);

      // The cell agrees with the header. A counter the grid contradicts is worse
      // than no counter — the operator clicks it and finds nothing.
      const cell = after.bookings.find((booking) => booking.name === 'Cadetes');
      assert.equal(cell?.instructorStatus, 'uncovered');
      assert.equal(
        after.bookings.find((booking) => booking.name === 'Absolutos')?.instructorStatus,
        'assigned',
      );
    });
  });
});

test('a partner bringing its own teacher counts toward neither total', async () => {
  await withScratchTenant(async (tenant) => {
    const grid = new GridController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await pool(tenant);
      const slotId = await addSlot(tenant, '09:30', '10:15');

      const partners = new PartnersController();
      const partner = await partners.create(tenant.facilityId, {
        name: 'ES D. Dinis',
        type: 'escola',
      });

      // 6A brings Prof. Silva; 6B does not and is the club's slot to staff.
      const withTeacher = await partners.createGroup(partner.id, {
        name: '6A',
        participantCount: 24,
        bringsOwnInstructor: true,
        ownInstructorName: 'Prof. Silva',
      });
      const without = await partners.createGroup(partner.id, {
        name: '6B',
        participantCount: 22,
      });

      for (const group of [withTeacher, without]) {
        await tenant.sql(
          `INSERT INTO class_schedule
             (organization_id, facility_id, subject_type, partner_group_id, season_id,
              slot_id, weekday, start_time, duration_minutes)
           VALUES ($1, $2, 'parceria', $3, $4, $5, 1, '09:30', 45)`,
          [tenant.organizationId, tenant.facilityId, group.id, tenant.seasonId, slotId],
        );
      }

      const result = await grid.read(tenant.facilityId);

      // Criterion 7: the school's own teacher is not the club's gap.
      assert.equal(result.staffing.uncovered, 0);
      assert.equal(result.staffing.toDefine, 1);

      assert.equal(
        result.bookings.find((booking) => booking.name === '6A')?.instructorStatus,
        'external',
      );
      assert.equal(
        result.bookings.find((booking) => booking.name === '6B')?.instructorStatus,
        'to_define',
      );
    });
  });
});

test('escalating never turns a staffed booking into an alert', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await pool(tenant);
      const sandra = await addMember(tenant, 'Sandra', 'Lopes', ['instructor']);
      const staffed = await turmaBooking(tenant, 'Absolutos', '17:30', sandra);

      const bookings = new BookingsController();

      /*
       * The interesting outcome. The request asks for `uncovered`; the trigger
       * sees Sandra teaching it and answers `assigned`, so the endpoint returns
       * what the row actually holds rather than what was asked for. A screen
       * that assumed its own request had won would draw a red chip on a class
       * with a name on it.
       */
      const result = await bookings.instructorStatus(staffed, { status: 'uncovered' });
      assert.equal(result.status, 'assigned');

      const grid = await new GridController().read(tenant.facilityId);
      assert.equal(grid.staffing.uncovered, 0);
    });
  });
});

test('only owner and admin may declare a slot uncovered', async () => {
  await withScratchTenant(async (tenant) => {
    let bookingId = '';

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await pool(tenant);
      bookingId = await turmaBooking(tenant, 'Cadetes', '17:30', null);
    });

    const bookings = new BookingsController();

    // An instructor reading the grid is the point of the screen; an instructor
    // declaring the club has a staffing problem is not — QA 50.15's rule,
    // applied to this route.
    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      await expectStatus(
        () => bookings.instructorStatus(bookingId, { status: 'uncovered' }),
        403,
      );
    });

    await actingAs(tenant, { roles: ['admin'] }, async () => {
      const result = await bookings.instructorStatus(bookingId, { status: 'uncovered' });
      assert.equal(result.status, 'uncovered');
    });
  });
});

test('assigned and external cannot be claimed by a request', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await pool(tenant);
      const bookingId = await turmaBooking(tenant, 'Cadetes', '17:30', null);
      const bookings = new BookingsController();

      // Refused rather than silently corrected. The trigger would overrule them
      // anyway; a 400 is the difference between finding out and watching a save
      // appear to work and read back as something else.
      for (const status of ['assigned', 'external', 'nonsense', '']) {
        await expectStatus(() => bookings.instructorStatus(bookingId, { status }), 400);
      }
    });
  });
});

test('one club cannot read or escalate another club\'s staffing', async () => {
  await withScratchTenant(async (mine) => {
    await withScratchTenant(async (theirs) => {
      let theirBooking = '';

      await actingAs(theirs, { roles: ['owner'] }, async () => {
        await pool(theirs);
        theirBooking = await turmaBooking(theirs, 'Cadetes', '17:30', null);
        await new BookingsController().instructorStatus(theirBooking, { status: 'uncovered' });
        assert.equal((await new GridController().read(theirs.facilityId)).staffing.uncovered, 1);
      });

      await actingAs(mine, { roles: ['owner'] }, async () => {
        await pool(mine);

        // Their site is not ours to read, and their booking is not ours to
        // escalate — the second is the one RLS alone would not catch if the
        // update were written without its tenant scope.
        await expectStatus(() => new GridController().read(theirs.facilityId), 404);
        await expectStatus(
          () => new BookingsController().instructorStatus(theirBooking, { status: 'to_define' }),
          404,
        );

        assert.equal((await new GridController().read(mine.facilityId)).staffing.uncovered, 0);
      });
    });
  });
});
