import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { FacilitiesController } from './facilities.controller.js';
import { LabResultsController } from './lab-results.controller.js';
import { actingAs, closeHarness, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * Where an analysis came from — POOLSE-153, against the real database.
 *
 * Typed on the form, a water-log sheet, or a laboratory document: each way in
 * records its origin, a reading made from a lab result carries the lab result's,
 * and Laboratório lists the chemistry-only reports filed as readings. Rows from
 * before the column existed stay NULL — that half is the migration's.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/** The UTC day of a moment, whether the controller handed back a Date or a string. */
const dayOf = (at: unknown): string => new Date(at as string).toISOString().slice(0, 10);

async function aTank(tenant: ScratchTenant): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind)
     VALUES ($1, $2, 'Tanque', 'indoor'::pool_kind) RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );
  return row!.id;
}

test('a lab report imported is "report", its reading too; one typed on the form is "typed"', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const lab = new LabResultsController();
      await lab.importReport(poolId, {
        rows: [{ takenOn: '01/10/2026', takenTime: '09:00', laboratory: 'Lab', e_coli: '0', ph: '7,3' }],
        commit: true,
      });
      await lab.record(poolId, {
        sampledAt: '2026-10-02T10:00',
        values: [
          { parameter: 'e_coli', value: 0 },
          { parameter: 'ph', value: 7.4 },
        ],
      });

      const { results } = await lab.list(poolId);
      const byDay = new Map(results.map((result) => [result.sampledAt.slice(0, 10), result.origin]));
      assert.equal(byDay.get('2026-10-01'), 'report', 'the import says report');
      assert.equal(byDay.get('2026-10-02'), 'typed', 'the form says typed');

      const { analyses } = await new FacilitiesController().pool(poolId);
      const fromImport = analyses.find((analysis) => dayOf(analysis.takenAt) === '2026-10-01');
      assert.equal(fromImport?.fromLab, true);
      assert.equal(fromImport?.origin, 'report', "the reading carries its lab result's origin");
    });
  });
});

test('the readings import records log or report, and Laboratório lists only the reports', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const facilities = new FacilitiesController();
      await facilities.importAnalyses(poolId, {
        rows: [{ takenOn: '01/09/2026', takenTime: '08:30', ph: '7,4', free_chlorine: '1,2' }],
        commit: true,
        source: 'log',
      });
      await facilities.importAnalyses(poolId, {
        rows: [{ takenOn: '05/09/2026', takenTime: '11:00', ph: '7,2', free_chlorine: '0,9' }],
        commit: true,
        source: 'report',
      });
      // A client that sends nothing is the water log, as every import was before.
      await facilities.importAnalyses(poolId, {
        rows: [{ takenOn: '06/09/2026', takenTime: '08:00', ph: '7,5' }],
        commit: true,
      });

      const { analyses } = await facilities.pool(poolId);
      const origin = (day: string): string | null | undefined =>
        analyses.find((analysis) => dayOf(analysis.takenAt) === day)?.origin;
      assert.equal(origin('2026-09-01'), 'log');
      assert.equal(origin('2026-09-05'), 'report');
      assert.equal(origin('2026-09-06'), 'log');

      const { chemistryReports } = await new LabResultsController().list(poolId);
      assert.deepEqual(
        chemistryReports.map((report) => report.takenAt.slice(0, 10)),
        ['2026-09-05'],
        'only the laboratory document is listed under Laboratório',
      );
      assert.deepEqual(
        chemistryReports[0]?.values.map((value) => value.metric).sort(),
        ['free_chlorine', 'ph'],
      );
    });
  });
});
