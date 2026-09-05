import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { FacilitiesController } from './facilities.controller.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * Writing a club's water log — round 5, ticket 5.
 *
 * `analysis-import.test.ts` proves the rules without a database. This proves the
 * half that needs one: that a preview writes nothing, that a commit turns one
 * wide row into an analysis and its several values, that the unit comes from
 * the server rather than the file, and that an instructor cannot do it.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

interface Tenant {
  organizationId: string;
  facilityId: string;
  sql: <T extends object>(text: string, values?: unknown[]) => Promise<T[]>;
}

async function aTank(tenant: Tenant, name = 'Tanque Grande'): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind)
     VALUES ($1, $2, $3, 'indoor') RETURNING id`,
    [tenant.organizationId, tenant.facilityId, name],
  );
  return row!.id;
}

/** Two days of a Portuguese club's log, commas and all. */
const LOG = [
  { takenOn: '01/09/2026', takenTime: '08:30', ph: '7,4', free_chlorine: '1,2', notes: 'Tudo normal' },
  { takenOn: '02/09/2026', takenTime: '08:15', ph: '7,3', free_chlorine: '0,1' },
];

test('5 — a preview writes nothing, and says what it would write', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const result = await new FacilitiesController().importAnalyses(poolId, {
        rows: LOG,
        commit: false,
      });

      assert.equal(result.summary.total, 2);
      assert.equal(result.summary.importable, 2);
      assert.equal(result.created, undefined, 'a preview creates nothing');

      // dd/mm/yyyy is read the way a Portuguese club writes it.
      assert.equal(result.rows[0]?.takenOn, '2026-09-01');
      assert.equal(result.rows[0]?.takenTime, '08:30');
    });

    const written = await tenant.sql<{ n: string }>(
      `SELECT count(*)::text AS n FROM pool_analysis WHERE pool_id = $1`,
      [poolId],
    );
    assert.equal(written[0]?.n, '0', 'nothing reached the table');
  });
});

test('5 — a commit turns one row into an analysis and its readings', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const result = await new FacilitiesController().importAnalyses(poolId, {
        rows: LOG,
        commit: true,
      });

      assert.equal(result.created, 2);
      assert.equal(result.skipped, 0);
    });

    const analyses = await tenant.sql<{ id: string; notes: string | null; taken: string }>(
      `SELECT id, notes, to_char(taken_at, 'YYYY-MM-DD HH24:MI') AS taken
         FROM pool_analysis WHERE pool_id = $1 ORDER BY taken_at`,
      [poolId],
    );
    assert.equal(analyses.length, 2);
    assert.equal(analyses[0]?.taken, '2026-09-01 08:30');
    assert.equal(analyses[0]?.notes, 'Tudo normal');

    const values = await tenant.sql<{ metric: string; value: string; unit: string }>(
      `SELECT metric, value::text, unit FROM pool_analysis_value
        WHERE analysis_id = $1 ORDER BY metric::text`,
      [analyses[0]!.id],
    );

    // The wide row became two values, and the comma decimal survived as a number.
    assert.equal(values.length, 2);
    const ph = values.find((value) => value.metric === 'ph');
    assert.equal(Number(ph?.value), 7.4);

    // The unit is the server's, never the file's — a sheet cannot talk a club
    // into recording pH in ppm. Both come from METRIC_UNITS.
    assert.equal(ph?.unit, 'pH');
    assert.equal(Number(values.find((value) => value.metric === 'free_chlorine')?.value), 1.2);

    /*
     * The second day is the one that matters: free chlorine at 0,1 against a
     * safe band of 0,5–2. An importer that refused an out-of-range value would
     * lose exactly the day the log exists to record.
     */
    const unsafe = await tenant.sql<{ value: string; unit: string }>(
      `SELECT value::text, unit FROM pool_analysis_value
        WHERE analysis_id = $1 AND metric = 'free_chlorine'`,
      [analyses[1]!.id],
    );
    assert.equal(Number(unsafe[0]?.value), 0.1, 'an unsafe reading is recorded, not dropped');
    assert.equal(unsafe[0]?.unit, 'ppm');
  });
});

test('5 — only the ticked rows are written', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const result = await new FacilitiesController().importAnalyses(poolId, {
        rows: LOG,
        commit: true,
        include: [1],
      });

      assert.equal(result.created, 1);
      assert.equal(result.skipped, 1, 'the unticked row is reported, not silently dropped');
    });

    const analyses = await tenant.sql<{ taken: string }>(
      `SELECT to_char(taken_at, 'YYYY-MM-DD') AS taken FROM pool_analysis WHERE pool_id = $1`,
      [poolId],
    );
    assert.deepEqual(
      analyses.map((row) => row.taken),
      ['2026-09-02'],
    );
  });
});

test('5 — a row naming another tank is refused, and the rest still import', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant, 'Tanque Grande');
    await aTank(tenant, 'Tanque de Aprendizagem');

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const result = await new FacilitiesController().importAnalyses(poolId, {
        rows: [
          { takenOn: '2026-09-01', ph: '7,4', pool: 'Tanque Grande' },
          { takenOn: '2026-09-01', ph: '7,1', pool: 'Tanque de Aprendizagem' },
        ],
        commit: true,
      });

      // A club exporting every tank into one sheet is ordinary; importing all of
      // it into whichever tank was open would be silent and wrong.
      assert.equal(result.created, 1);
      assert.equal(result.summary.refused, 1);
      assert.deepEqual(result.rows[1]?.problems, ['otherPool']);
    });
  });
});

test('5 — an instructor cannot import a water log', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);

    // Recording one analysis is owner/admin, so doing it in bulk is too. An
    // import that took a role the single form refuses would be the permission
    // model worked around by uploading a file.
    for (const role of ['instructor', 'maintenance', 'student', 'guardian'] as const) {
      await actingAs(tenant, { roles: [role] }, async () => {
        await expectStatus(
          () =>
            new FacilitiesController().importAnalyses(poolId, {
              rows: LOG,
              commit: true,
            }),
          403,
        );
      });
    }

    const written = await tenant.sql<{ n: string }>(
      `SELECT count(*)::text AS n FROM pool_analysis WHERE pool_id = $1`,
      [poolId],
    );
    assert.equal(written[0]?.n, '0');
  });
});
