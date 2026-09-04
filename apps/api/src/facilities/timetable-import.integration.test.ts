import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { BookingsController } from './bookings.controller.js';
import { GridController } from './grid.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';
import type { ScratchTenant } from '../test/harness.js';

/**
 * Importing a timetable, against a real database — POOLSE-57.
 *
 * `timetable-import.test.ts` proves what a row *means* with no database in
 * sight. This proves the half that can only be wrong against real tables: that
 * **nothing is written while a conflict is unresolved** (decision 1), that
 * dropping a row in the dialog is what clears one (decision 2), that a commit
 * writes exactly what the preview promised, and that neither a role nor a
 * tenant boundary can be walked through.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

async function sixLanes(tenant: ScratchTenant): Promise<void> {
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
}

/** One row of a wall sheet, as the reader hands it over. */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    weekday: 2,
    startTime: '19:15',
    durationMinutes: 45,
    name: 'Absolutos',
    laneNames: ['Pista 2'],
    line: 2,
    ...over,
  };
}

async function bookingCount(tenant: ScratchTenant): Promise<number> {
  const [count] = await tenant.sql<{ n: string }>(
    'SELECT count(*) AS n FROM class_schedule WHERE archived_at IS NULL',
  );
  return Number(count!.n);
}

test('a clean file previews without writing, then commits what it promised', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await sixLanes(tenant);
      const bookings = new BookingsController();

      const rows = [
        row({ name: 'Infantis A', laneNames: ['Pista 2'], line: 2 }),
        row({ name: 'Infantis B', laneNames: ['Pista 3'], line: 3 }),
        row({ name: 'Masters', weekday: 1, startTime: '06:30', laneNames: ['1-3'], line: 4 }),
      ];

      const preview = await bookings.importTimetable(tenant.facilityId, { rows });
      assert.equal(preview.committable, true);
      assert.equal(preview.summary.importable, 3);
      assert.equal(await bookingCount(tenant), 0, 'a preview writes nothing');

      const done = await bookings.importTimetable(tenant.facilityId, { rows, commit: true });
      assert.equal(done.created, 3);
      assert.equal(await bookingCount(tenant), 3);

      // And they are on the grid, on the lanes the sheet said.
      const grid = await new GridController().read(tenant.facilityId);
      const masters = grid.bookings.find((one) => one.name === 'Masters');
      assert.equal(masters?.laneIds.length, 3, '1-3 expanded against the real pool');
      assert.equal(masters?.weekday, 1);
      assert.equal(masters?.startTime, '06:30');
    });
  });
});

test('one unresolved conflict refuses the whole file and writes nothing', async () => {
  // Decision 1, against real tables. Two good rows do not buy their way past
  // the third.
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await sixLanes(tenant);
      const bookings = new BookingsController();

      const rows = [
        row({ name: 'Infantis A', laneNames: ['Pista 2'], line: 2 }),
        row({ name: 'Infantis B', laneNames: ['Pista 3'], line: 3 }),
        row({ name: 'Colide', laneNames: ['Pista 2'], line: 4 }),
      ];

      const preview = await bookings.importTimetable(tenant.facilityId, { rows });
      assert.equal(preview.committable, false);
      assert.equal(preview.summary.blocked, 1);

      const refused = await bookings.importTimetable(tenant.facilityId, { rows, commit: true });
      assert.equal(refused.created, 0);
      assert.equal(await bookingCount(tenant), 0, 'not one row was written');
    });
  });
});

test('dropping the colliding row in the dialog clears the file', async () => {
  /*
   * Decision 2's only verb, and the reason it is the only one: the incoming
   * class yields, and what is already there is never overwritten.
   */
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await sixLanes(tenant);
      const bookings = new BookingsController();

      const rows = [
        row({ name: 'Infantis A', laneNames: ['Pista 2'], line: 2 }),
        row({ name: 'Colide', laneNames: ['Pista 2'], line: 3 }),
      ];

      const cleared = await bookings.importTimetable(tenant.facilityId, { rows, drop: [1] });
      assert.equal(cleared.committable, true);
      assert.equal(cleared.summary.total, 1, 'the dropped row is gone, not flagged');

      const done = await bookings.importTimetable(tenant.facilityId, {
        rows,
        drop: [1],
        commit: true,
      });
      assert.equal(done.created, 1);

      const grid = await new GridController().read(tenant.facilityId);
      assert.deepEqual(grid.bookings.map((one) => one.name), ['Infantis A']);
    });
  });
});

test('a row colliding with the grid is refused and names what is in the way', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await sixLanes(tenant);
      const bookings = new BookingsController();

      await bookings.importTimetable(tenant.facilityId, {
        rows: [row({ name: 'Infantis A', laneNames: ['Pista 2'] })],
        commit: true,
      });

      // The same file again — now every row collides with what it created.
      const second = await bookings.importTimetable(tenant.facilityId, {
        rows: [row({ name: 'Cadetes', laneNames: ['Pista 2'] })],
      });

      assert.equal(second.committable, false);
      const clash = second.rows[0]!.clashes.find((one) => one.code === 'laneTaken');
      assert.equal(clash?.with, 'Infantis A');
      assert.equal(clash?.lane, 'Pista 2');
      // On the grid, not in this file — a different sentence for the operator.
      assert.equal(clash?.withLine, null);
    });
  });
});

test('an instructor named in the sheet is put on the booking', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await sixLanes(tenant);
      await addMember(tenant, 'Sandra', 'Moreira', ['instructor']);

      const done = await new BookingsController().importTimetable(tenant.facilityId, {
        rows: [row({ instructorName: 'sandra moreira' })],
        commit: true,
      });
      assert.equal(done.created, 1);

      // Matched accent- and case-insensitively, and the status follows by
      // POOLSE-53's trigger rather than being written.
      const grid = await new GridController().read(tenant.facilityId);
      assert.equal(grid.bookings[0]?.instructorName, 'Sandra Moreira');
      assert.equal(grid.bookings[0]?.instructorStatus, 'assigned');
    });
  });
});

test('an unknown instructor costs the name, never the class', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await sixLanes(tenant);

      const done = await new BookingsController().importTimetable(tenant.facilityId, {
        rows: [row({ instructorName: 'Quem Quer Que Seja' })],
        commit: true,
      });

      assert.equal(done.created, 1);
      const grid = await new GridController().read(tenant.facilityId);
      assert.equal(grid.bookings[0]?.instructorStatus, 'to_define');
      assert.equal(grid.staffing.toDefine, 1);
    });
  });
});

test('a lane the site does not have refuses its row, and so the file', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await sixLanes(tenant);

      const preview = await new BookingsController().importTimetable(tenant.facilityId, {
        rows: [row({ laneNames: ['Pista 9'] })],
      });

      assert.equal(preview.committable, false);
      assert.deepEqual(preview.rows[0]!.problems.map((p) => p.code), ['laneNotFound']);
      assert.equal(await bookingCount(tenant), 0);
    });
  });
});

test('an import is owner and admin, however the request is made', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await sixLanes(tenant);
    });

    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      await expectStatus(
        () => new BookingsController().importTimetable(tenant.facilityId, { rows: [row()] }),
        403,
      );
    });
  });
});

test('a file committed under one tenant never reaches another', async () => {
  await withScratchTenant(async (mine) => {
    await withScratchTenant(async (theirs) => {
      await actingAs(mine, { roles: ['owner'] }, async () => {
        await sixLanes(mine);
        await new BookingsController().importTimetable(mine.facilityId, {
          rows: [row()],
          commit: true,
        });
      });

      await actingAs(theirs, { roles: ['owner'] }, async () => {
        assert.equal(await bookingCount(theirs), 0);
        await expectStatus(
          () => new BookingsController().importTimetable(mine.facilityId, { rows: [row()] }),
          404,
        );
      });
    });
  });
});

test('an empty file and an oversized one are refused before anything is read', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await sixLanes(tenant);
      const bookings = new BookingsController();

      await expectStatus(() => bookings.importTimetable(tenant.facilityId, { rows: [] }), 400);
      await expectStatus(
        () =>
          bookings.importTimetable(tenant.facilityId, {
            rows: Array.from({ length: 2_001 }, () => row()),
          }),
        400,
      );
      await expectStatus(
        () => bookings.importTimetable(tenant.facilityId, { rows: [row({ weekday: 9 })] }),
        400,
      );
    });
  });
});
