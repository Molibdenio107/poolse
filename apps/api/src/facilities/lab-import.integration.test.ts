import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { LabResultsController } from './lab-results.controller.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * A laboratory report imported as lab results — POOLSE-101, QA 2 through the
 * API: a preview writes nothing, a commit files graded results through the
 * form's own path (audit and alert included), only the ticked rows go in, and
 * only owner and admin may do it.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

interface Tenant {
  organizationId: string;
  facilityId: string;
  sql: <T extends object>(text: string, values?: unknown[]) => Promise<T[]>;
}

async function aTank(tenant: Tenant): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind)
     VALUES ($1, $2, 'Tanque', 'indoor'::pool_kind) RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );
  return row!.id;
}

/** Two of a lab's reports as the parser hands them over: one clean, one with E. coli. */
const REPORT = [
  {
    takenOn: '01/10/2026',
    takenTime: '09:00',
    laboratory: 'Lab Aveiro',
    reportReference: 'B-118',
    colonies_37c: '12',
    total_coliforms: '<1',
    e_coli: 'Ausência',
    ph: '7,3',
    free_chlorine: '1,1',
  },
  { takenOn: '02/10/2026', laboratory: 'Lab Aveiro', e_coli: '4' },
];

test('a preview writes nothing; a commit files graded results with their lab and reference', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);
    const api = new LabResultsController();

    await actingAs(tenant, { roles: ['admin'] }, async () => {
      const preview = await api.importReport(poolId, { rows: REPORT, commit: false });
      assert.equal(preview.summary.importable, 2);
      assert.equal(preview.created, undefined);
      assert.equal((await api.list(poolId)).results.length, 0, 'a preview writes nothing');

      const done = await api.importReport(poolId, { rows: REPORT, commit: true });
      assert.equal(done.created, 2);

      const { results } = await api.list(poolId);
      const clean = results.find((r) => r.reportReference === 'B-118');
      assert.equal(clean?.laboratory, 'Lab Aveiro');
      assert.equal(clean?.grading.grade, 'conforme');
      const coli = results.find((r) => r.reportReference === null);
      assert.equal(coli?.grading.grade, 'nao_conforme');

      // The same report again is flagged, not refused.
      const again = await api.importReport(poolId, { rows: REPORT, commit: false });
      assert.deepEqual(
        again.rows.map((row) => row.warnings),
        [['alreadyRecorded'], ['alreadyRecorded']],
      );
    });

    const audit = await tenant.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'lab_result.recorded' AND entity_id = $1`,
      [poolId],
    );
    assert.equal(audit[0]?.n, 2, 'each result is audited as a typed one is');
  });
});

test('only the ticked rows are filed; the rest are counted as left out', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const api = new LabResultsController();
      const done = await api.importReport(poolId, { rows: REPORT, commit: true, include: [1] });
      assert.equal(done.created, 1);
      assert.equal(done.skipped, 1);
      const { results } = await api.list(poolId);
      assert.deepEqual(results.map((r) => r.grading.grade), ['nao_conforme']);
    });
  });
});

test('maintenance and instructors may not import; another club\'s tank is not found', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);
    for (const role of ['maintenance', 'instructor'] as const) {
      await actingAs(tenant, { roles: [role] }, () =>
        expectStatus(() => new LabResultsController().importReport(poolId, { rows: REPORT, commit: false }), 403),
      );
    }
    await withScratchTenant(async (other) => {
      await actingAs(other, { roles: ['owner'] }, () =>
        expectStatus(() => new LabResultsController().importReport(poolId, { rows: REPORT, commit: true }), 404),
      );
    });
    const rows = await tenant.sql<{ n: number }>('SELECT count(*)::int AS n FROM lab_result WHERE pool_id = $1', [
      poolId,
    ]);
    assert.equal(rows[0]?.n, 0);
  });
});
