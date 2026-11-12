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

test('a second trip through the dialog drops the row that was pointed at', async () => {
  /*
   * The bug this exists to keep fixed.
   *
   * `previewTimetable` numbers rows by their position in the array it is given,
   * so previewing the array with the first drop already removed renumbers
   * everything after it. The dialog sends back the numbers it was shown, and
   * the second drop would land on a different row — quietly, behind a preview
   * that looks entirely reasonable.
   */
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await sixLanes(tenant);
      const bookings = new BookingsController();

      const rows = [
        row({ name: 'Fica', laneNames: ['Pista 2'], line: 2 }),
        row({ name: 'Colide', laneNames: ['Pista 2'], line: 3 }),
        row({ name: 'Sai Depois', laneNames: ['Pista 3'], line: 4 }),
      ];

      // Round one: the operator drops the collision.
      const first = await bookings.importTimetable(tenant.facilityId, { rows, drop: [1] });
      assert.deepEqual(
        first.rows.map((one) => one.index),
        [0, 2],
        'the survivors keep the numbers the file gave them',
      );

      // Round two: they change their mind about the third row and drop it too,
      // using the number this screen just showed them.
      const second = await bookings.importTimetable(tenant.facilityId, {
        rows,
        drop: [1, 2],
        commit: true,
      });
      assert.equal(second.created, 1);

      const grid = await new GridController().read(tenant.facilityId);
      assert.deepEqual(grid.bookings.map((one) => one.name), ['Fica']);
    });
  });
});

test('a file is one pool’s: its lanes resolve in the pool chosen, never another at the site (02-11-2026)', async () => {
  await withScratchTenant(async (tenant) => {
    await sixLanes(tenant);
    // A second tank at the same site, with its own Pista 1 and Pista 2.
    const [small] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool (organization_id, facility_id, name, kind)
       VALUES ($1, $2, 'Tanque Pequeno', 'indoor') RETURNING id`,
      [tenant.organizationId, tenant.facilityId],
    );
    await tenant.sql(`UPDATE lane SET name = 'Pista 1' WHERE pool_id = $1 AND position = 1`, [small!.id]);
    await tenant.sql(
      `INSERT INTO lane (organization_id, pool_id, name, position) VALUES ($1, $2, 'Pista 2', 2)`,
      [tenant.organizationId, small!.id],
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const bookings = new BookingsController();
      const rows = [row({ name: 'Bebés', laneNames: ['Pista 2'] })];
      const done = await bookings.importTimetable(tenant.facilityId, { rows, commit: true, poolId: small!.id });
      assert.equal(done.created, 1);

      const [placed] = await tenant.sql<{ pool_id: string }>(
        // The only booking in this club: the one just imported.
        `SELECT l.pool_id FROM booking_lane bl JOIN lane l ON l.id = bl.lane_id LIMIT 1`,
      );
      assert.equal(placed!.pool_id, small!.id, 'Pista 2 is the small pool’s lane 2');

      // A pool that is not this site's is not found.
      await expectStatus(
        () => bookings.importTimetable(tenant.facilityId, { rows, poolId: '00000000-0000-4000-8000-000000000000' }),
        404,
      );
    });
  });
});

/* ---- POOLSE-223: rows mapped to pools and kinds by the dialog ---- */

/** A second tank at the site with four lanes, as a learner pool. */
async function learnerPool(tenant: ScratchTenant): Promise<string> {
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind)
     VALUES ($1, $2, 'Piscina de Aprendizagem', 'indoor') RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );
  await tenant.sql(`UPDATE lane SET name = 'Pista 1' WHERE pool_id = $1 AND position = 1`, [pool!.id]);
  await tenant.sql(
    `INSERT INTO lane (organization_id, pool_id, name, position)
     SELECT $1, $2, 'Pista ' || n, n FROM generate_series(2, 4) AS n`,
    [tenant.organizationId, pool!.id],
  );
  return pool!.id;
}

test('one file, two pools: each row is written in its mapped pool, free swim as free_swim (QA 3, 5)', async () => {
  await withScratchTenant(async (tenant) => {
    await sixLanes(tenant);
    const learner = await learnerPool(tenant);
    const [main] = await tenant.sql<{ id: string }>(`SELECT id FROM pool WHERE name = 'Tanque Grande'`);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const bookings = new BookingsController();
      const rows = [
        row({ name: 'Hidroginástica', weekday: 1, startTime: '07:00', durationMinutes: 60, laneNames: [], laneCount: 3, poolId: main!.id, line: 1 }),
        row({ name: 'Natação Livre', weekday: 1, startTime: '07:00', durationMinutes: 60, laneNames: [], laneCount: 3, poolId: main!.id, kind: 'free_swim', line: 1 }),
        row({ name: 'Bebés', weekday: 1, startTime: '09:00', durationMinutes: 60, laneNames: [], laneCount: null, poolId: learner, line: 2 }),
      ];

      const preview = await bookings.importTimetable(tenant.facilityId, { rows });
      assert.equal(preview.committable, true, 'the split cell does not clash with itself');
      assert.equal(await bookingCount(tenant), 0);

      const done = await bookings.importTimetable(tenant.facilityId, { rows, commit: true });
      assert.equal(done.created, 3);

      const written = await tenant.sql<{ title: string; subject_type: string; pools: string[]; lanes: number }>(
        `SELECT cs.title, cs.subject_type::text AS subject_type,
                coalesce(array_agg(DISTINCT l.pool_id::text) FILTER (WHERE l.id IS NOT NULL), '{}') AS pools,
                count(l.id)::int AS lanes
           FROM class_schedule cs
           LEFT JOIN booking_lane bl ON bl.schedule_id = cs.id
           LEFT JOIN lane l ON l.id = bl.lane_id
          GROUP BY cs.id ORDER BY cs.title`,
      );
      assert.deepEqual(written, [
        { title: 'Bebés', subject_type: 'evento', pools: [], lanes: 0 },
        { title: 'Hidroginástica', subject_type: 'evento', pools: [main!.id], lanes: 3 },
        { title: 'Natação Livre', subject_type: 'free_swim', pools: [main!.id], lanes: 3 },
      ]);
    });
  });
});

test('a row mapped to another club’s pool is not found, and nothing is written (QA 12)', async () => {
  await withScratchTenant(async (mine) => {
    await withScratchTenant(async (theirs) => {
      const foreign = await learnerPool(theirs);
      await actingAs(mine, { roles: ['owner'] }, async () => {
        await sixLanes(mine);
        await expectStatus(
          () =>
            new BookingsController().importTimetable(mine.facilityId, {
              rows: [row({ name: 'Bebés' }), row({ name: 'Intrusa', poolId: foreign, line: 3 })],
              commit: true,
            }),
          404,
        );
        assert.equal(await bookingCount(mine), 0);
      });
    });
  });
});

test('a malformed kind, pool or lane count is refused before anything is read', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await sixLanes(tenant);
      const bookings = new BookingsController();
      for (const bad of [{ kind: 'turma' }, { poolId: 'x' }, { laneCount: 0 }, { laneCount: 2.5 }]) {
        await expectStatus(() => bookings.importTimetable(tenant.facilityId, { rows: [row(bad)] }), 400);
      }
    });
  });
});

test('a row with no lanes keeps its mapped pool, and a lane added later moves it (12-11-2026)', async () => {
  await withScratchTenant(async (tenant) => {
    await sixLanes(tenant);
    const learner = await learnerPool(tenant);
    const [main] = await tenant.sql<{ id: string }>(`SELECT id FROM pool WHERE name = 'Tanque Grande'`);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const done = await new BookingsController().importTimetable(tenant.facilityId, {
        rows: [row({ name: 'Bebés', laneNames: [], poolId: learner })],
        commit: true,
      });
      assert.equal(done.created, 1);

      const grid = await new GridController().read(tenant.facilityId);
      const bebes = grid.bookings.find((one) => one.name === 'Bebés');
      assert.deepEqual(bebes?.laneIds, []);
      assert.equal(bebes?.poolId, learner, 'the calendar draws it in the learner pool’s Sem pista');

      // A lane of the main pool, written by any path, makes it the main pool's.
      const [lane] = await tenant.sql<{ id: string }>(
        `SELECT id FROM lane WHERE pool_id = $1 AND position = 2`,
        [main!.id],
      );
      await tenant.sql(
        `INSERT INTO booking_lane (organization_id, schedule_id, lane_id) VALUES ($1, $2, $3)`,
        [tenant.organizationId, bebes!.id, lane!.id],
      );
      const [after] = await tenant.sql<{ pool_id: string }>(`SELECT pool_id FROM class_schedule WHERE id = $1`, [bebes!.id]);
      assert.equal(after!.pool_id, main!.id);
    });
  });
});

test('a booking cannot name a pool of another site', async () => {
  await withScratchTenant(async (tenant) => {
    await sixLanes(tenant);
    const [other] = await tenant.sql<{ id: string }>(
      `INSERT INTO facility (organization_id, name) VALUES ($1, 'Outra Sede') RETURNING id`,
      [tenant.organizationId],
    );
    const [elsewhere] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool (organization_id, facility_id, name, kind) VALUES ($1, $2, 'Lá Longe', 'indoor') RETURNING id`,
      [tenant.organizationId, other!.id],
    );
    await assert.rejects(
      tenant.sql(
        `INSERT INTO class_schedule (organization_id, facility_id, subject_type, season_id, weekday, start_time, duration_minutes, title, pool_id)
         VALUES ($1, $2, 'evento', $3, 1, '10:00', 45, 'Fora', $4)`,
        [tenant.organizationId, tenant.facilityId, tenant.seasonId, elsewhere!.id],
      ),
      /class_schedule_pool_fk/,
    );
  });
});
