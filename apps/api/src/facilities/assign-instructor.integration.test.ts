import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { BookingsController } from './bookings.controller.js';
import { GridController } from './grid.controller.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
} from '../test/harness.js';
import type { ScratchTenant } from '../test/harness.js';

/**
 * Staffing a class from the grid — closing POOLSE-53's dead end.
 *
 * The alert said "2 por definir", clicking it filtered the grid to those two,
 * and there was then nothing to do to them:
 * `class_schedule.instructor_membership_id` had no interface at all. A turma
 * could be staffed by leaving the grid and editing the turma; **a parceria
 * could not be staffed by one of the club's own instructors by any route**,
 * because it has no turma to edit.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

async function site(tenant: ScratchTenant): Promise<{ poolId: string }> {
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind)
     VALUES ($1, $2, 'Tanque', 'indoor') RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );
  return { poolId: pool!.id };
}

/** A parceria booking — the case that had no route at all. */
async function parceria(tenant: ScratchTenant): Promise<string> {
  const [partner] = await tenant.sql<{ id: string }>(
    `INSERT INTO partner (organization_id, facility_id, name, type)
     VALUES ($1, $2, 'ES D. Dinis', 'escola') RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );
  const [group] = await tenant.sql<{ id: string }>(
    `INSERT INTO partner_group (organization_id, partner_id, name, participant_count)
     VALUES ($1, $2, '6A', 24) RETURNING id`,
    [tenant.organizationId, partner!.id],
  );
  const [booking] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_schedule
       (organization_id, facility_id, subject_type, partner_group_id, season_id,
        weekday, start_time, duration_minutes)
     VALUES ($1, $2, 'parceria', $3, $4, 1, '09:30', 45) RETURNING id`,
    [tenant.organizationId, tenant.facilityId, group!.id, tenant.seasonId],
  );
  return booking!.id;
}

test('a parceria can be staffed by one of the club own instructors', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await site(tenant);
      const sandra = await addMember(tenant, 'Sandra', 'Moreira', ['instructor']);
      const booking = await parceria(tenant);

      // It arrives as the club's gap to fill — no turma, so nothing to edit.
      const before = await new GridController().read(tenant.facilityId);
      assert.equal(before.bookings[0]?.instructorStatus, 'to_define');

      const result = await new BookingsController().assign(booking, { membershipId: sandra });

      // The status follows the write; it is never sent and never assumed.
      assert.equal(result.status, 'assigned');
      assert.equal(result.instructorName, 'Sandra Moreira');

      const after = await new GridController().read(tenant.facilityId);
      assert.equal(after.bookings[0]?.instructorStatus, 'assigned');
      assert.equal(after.staffing.toDefine, 0);
    });
  });
});

test('clearing hands the booking back, and the counter notices', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await site(tenant);
      const sandra = await addMember(tenant, 'Sandra', 'Moreira', ['instructor']);
      const booking = await parceria(tenant);

      const bookings = new BookingsController();
      await bookings.assign(booking, { membershipId: sandra });

      const cleared = await bookings.assign(booking, { membershipId: null });
      assert.equal(cleared.status, 'to_define');
      assert.equal(cleared.instructorName, null);

      const grid = await new GridController().read(tenant.facilityId);
      assert.equal(grid.staffing.toDefine, 1);
    });
  });
});

test('an override does not touch the turma it belongs to', async () => {
  /*
   * The distinction the whole column exists for. "Sandra runs Cadetes" is said
   * on the Turmas screen; "Nuno is covering Cadetes this Tuesday" is said on the
   * grid. Collapsing them would silently reassign a whole turma from a cell.
   */
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { poolId } = await site(tenant);
      const sandra = await addMember(tenant, 'Sandra', 'Moreira', ['instructor']);
      const nuno = await addMember(tenant, 'Nuno', 'Teixeira', ['instructor']);

      const [group] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_group
           (organization_id, season_id, facility_id, pool_id, name, instructor_membership_id)
         VALUES ($1, $2, $3, $4, 'Cadetes', $5) RETURNING id`,
        [tenant.organizationId, tenant.seasonId, tenant.facilityId, poolId, sandra],
      );
      const [booking] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_schedule
           (organization_id, facility_id, subject_type, class_group_id, weekday,
            start_time, duration_minutes)
         VALUES ($1, $2, 'turma', $3, 2, '19:15', 45) RETURNING id`,
        [tenant.organizationId, tenant.facilityId, group!.id],
      );

      const result = await new BookingsController().assign(booking!.id, { membershipId: nuno });
      assert.equal(result.instructorName, 'Nuno Teixeira');

      // The turma still belongs to Sandra.
      const [turma] = await tenant.sql<{ instructor_membership_id: string }>(
        'SELECT instructor_membership_id FROM class_group WHERE id = $1',
        [group!.id],
      );
      assert.equal(turma!.instructor_membership_id, sandra);

      // And clearing the override returns the booking to her, not to nobody.
      const cleared = await new BookingsController().assign(booking!.id, { membershipId: null });
      assert.equal(cleared.status, 'assigned');
      assert.equal(cleared.instructorName, 'Sandra Moreira');
    });
  });
});

test('somebody who does not teach cannot be put on a class', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await site(tenant);
      const booking = await parceria(tenant);

      // A student in the register is a membership like any other. Trusting the
      // id would put a twelve-year-old on the timetable as staff.
      const child = await addMember(tenant, 'Rita', 'Nunes', ['student']);
      await expectStatus(
        () => new BookingsController().assign(booking, { membershipId: child }),
        404,
      );

      // And an archived instructor is no longer one.
      const gone = await addMember(tenant, 'Hugo', 'Ferreira', ['instructor']);
      await tenant.sql('UPDATE membership SET archived_at = now() WHERE id = $1', [gone]);
      await expectStatus(
        () => new BookingsController().assign(booking, { membershipId: gone }),
        404,
      );
    });
  });
});

test('assigning is owner and admin, and hiding the picker is not the control', async () => {
  await withScratchTenant(async (tenant) => {
    let booking = '';
    let sandra = '';

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await site(tenant);
      sandra = await addMember(tenant, 'Sandra', 'Moreira', ['instructor']);
      booking = await parceria(tenant);
    });

    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      await expectStatus(
        () => new BookingsController().assign(booking, { membershipId: sandra }),
        403,
      );
    });
  });
});

test('one club cannot staff another club class', async () => {
  await withScratchTenant(async (mine) => {
    await withScratchTenant(async (theirs) => {
      let theirBooking = '';
      await actingAs(theirs, { roles: ['owner'] }, async () => {
        await site(theirs);
        theirBooking = await parceria(theirs);
      });

      await actingAs(mine, { roles: ['owner'] }, async () => {
        const ours = await addMember(mine, 'Sandra', 'Moreira', ['instructor']);
        await expectStatus(
          () => new BookingsController().assign(theirBooking, { membershipId: ours }),
          404,
        );
      });
    });
  });
});
