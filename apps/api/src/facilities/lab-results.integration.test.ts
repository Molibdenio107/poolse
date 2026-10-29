import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ALERT_WINDOW_HOURS } from '@poolse/rules';
import { FacilitiesController } from './facilities.controller.js';
import { LabResultsController } from './lab-results.controller.js';
import { findLabAlertNotice } from './lab-results.repository.js';
import { readPublicWaterPage } from './public-link.repository.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * The national reference and lab grading — POOLSE-72, the ticket's QA through
 * the API: the bands a pool's page ships, the grade a stored report reads back
 * with, the alert a não conforme report raises, who may do what, and what the
 * public page carries.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

interface Tenant {
  organizationId: string;
  facilityId: string;
  sql: <T extends object>(text: string, values?: unknown[]) => Promise<T[]>;
}

async function aTank(
  tenant: Tenant,
  kind: 'indoor' | 'outdoor' = 'indoor',
  use: string | null = null,
): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind, use)
     VALUES ($1, $2, 'Tanque', $3::pool_kind, $4::pool_use) RETURNING id`,
    [tenant.organizationId, tenant.facilityId, kind, use],
  );
  return row!.id;
}

const recently = (): string => new Date(Date.now() - 2 * 3600_000).toISOString();
const longAgo = (): string => new Date(Date.now() - (ALERT_WINDOW_HOURS + 24) * 3600_000).toISOString();

const CLEAN = [
  { parameter: 'colonies_37c', value: 10 },
  { parameter: 'total_coliforms', value: 0 },
  { parameter: 'e_coli', value: 0 },
  { parameter: 'enterococci', value: 0 },
  { parameter: 'pseudomonas_aeruginosa', value: 0 },
  { parameter: 'staphylococcus_coagulase_positive', value: 0 },
  { parameter: 'staphylococcus_total', value: 2 },
];

function withValue(parameter: string, value: number): { parameter: string; value: number }[] {
  return CLEAN.map((entry) => (entry.parameter === parameter ? { parameter, value } : entry));
}

test('QA 1, 4, 5: the pool page ships the national bands for this tank, and an override still wins', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant, 'indoor', 'children');
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const page = await new FacilitiesController().pool(poolId);
      assert.deepEqual(page.bands.ph, { from: 6.5, to: 8 });
      assert.deepEqual(page.bands.temperature, { from: 28, to: 32 });
      assert.equal(page.bands.free_chlorine?.byPh?.atOrBelow.to, 1.2);
      assert.deepEqual(page.reference.ph, { from: 6.5, to: 8 });
    });

    await tenant.sql(
      `INSERT INTO pool_metric_range (organization_id, pool_id, metric, min_value, max_value)
       VALUES ($1, $2, 'ph', 7.2, 7.6)`,
      [tenant.organizationId, poolId],
    );
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const page = await new FacilitiesController().pool(poolId);
      assert.deepEqual(page.bands.ph, { from: 7.2, to: 7.6 }, "the club's own band wins");
      assert.deepEqual(page.reference.ph, { from: 6.5, to: 8 }, 'and the reference beside it is national');
    });
  });
});

test('QA 4: a pool with no use judges no temperature; setting one through the API picks the band', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const api = new FacilitiesController();
      assert.equal((await api.pool(poolId)).bands.temperature, undefined);
      await api.editPool(poolId, { name: 'Tanque', kind: 'indoor', use: 'sport' });
      assert.deepEqual((await api.pool(poolId)).bands.temperature, { from: 24, to: 26 });
      await expectStatus(() => api.editPool(poolId, { name: 'Tanque', kind: 'indoor', use: 'sauna' }), 400);
    });
  });
});

test('QA 1: a recent analysis with pH 7.2 and chlorine 1.5 raises a water alert for the chlorine', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);
    await actingAs(tenant, { roles: ['owner'] }, () =>
      new FacilitiesController().recordAnalysis(poolId, {
        takenAt: recently(),
        values: { ph: 7.2, free_chlorine: 1.5 },
      }),
    );
    const [alert] = await tenant.sql<{ metrics: string[] }>(
      'SELECT metrics::text[] AS metrics FROM pool_analysis_alert WHERE pool_id = $1',
      [poolId],
    );
    assert.deepEqual(alert?.metrics, ['free_chlorine']);
  });
});

test('QA 6, 9: E. coli is não conforme and raises one alert to the people who can act', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);
    await addMember(tenant, 'Maria', 'Manutenção', ['maintenance']);
    await addMember(tenant, 'Inês', 'Instrutora', ['instructor']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const api = new LabResultsController();
      await api.record(poolId, {
        sampledAt: recently(),
        laboratory: 'Laboratório Teste',
        samplePoint: 'Rebordo, ponto mais afastado da entrada',
        sampleDepth: 'surface',
        values: withValue('e_coli', 1),
      });
      const { results } = await api.list(poolId);
      assert.equal(results[0]?.grading.grade, 'nao_conforme');
      assert.deepEqual(
        results[0]?.grading.failures.map((f) => [f.parameter, f.limit, f.kind]),
        [['e_coli', 0, 'limit']],
      );
      assert.ok(results[0]?.alert, 'the alert is on the report');
    });

    const [alert] = await tenant.sql<{ id: string; parameters: string[] }>(
      'SELECT id, parameters::text[] AS parameters FROM lab_result_alert WHERE pool_id = $1',
      [poolId],
    );
    assert.deepEqual(alert?.parameters, ['e_coli']);
    const notice = await findLabAlertNotice(tenant.organizationId, alert!.id);
    assert.ok(notice!.recipients.some((to) => to.startsWith('maria.')), 'maintenance is told');
    assert.ok(!notice!.recipients.some((to) => to.startsWith('ines.')), 'the instructor is not');
  });
});

test('QA 9: an old não conforme report, imported later, records no alert', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);
    await actingAs(tenant, { roles: ['owner'] }, () =>
      new LabResultsController().record(poolId, { sampledAt: longAgo(), values: withValue('e_coli', 3) }),
    );
    const alerts = await tenant.sql('SELECT 1 FROM lab_result_alert WHERE pool_id = $1', [poolId]);
    assert.equal(alerts.length, 0);
  });
});

test('QA 7, 8: coliforms of 5 grade condicionada; chemistry alone says microbiology was absent', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);
    await actingAs(tenant, { roles: ['maintenance'] }, async () => {
      const api = new LabResultsController();
      await api.record(poolId, { sampledAt: longAgo(), values: withValue('total_coliforms', 5) });
      await api.record(poolId, {
        sampledAt: recently(),
        values: [{ parameter: 'turbidity', value: 0.8 }, { parameter: 'ph', value: 7.3 }],
      });
      const { results } = await api.list(poolId);
      const [chemistry, coliforms] = results;
      assert.equal(coliforms?.grading.grade, 'conforme_condicionada');
      assert.equal(chemistry?.grading.grade, 'conforme');
      assert.equal(chemistry?.grading.microbiologyReported, false);
    });
  });
});

test('a lab result refuses a negative count, an unknown parameter, and an empty report', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const api = new LabResultsController();
      await expectStatus(() => api.record(poolId, { sampledAt: recently(), values: withValue('e_coli', -1) }), 400);
      await expectStatus(
        () => api.record(poolId, { sampledAt: recently(), values: [{ parameter: 'legionella', value: 0 }] }),
        400,
      );
      await expectStatus(() => api.record(poolId, { sampledAt: recently(), values: [] }), 400);
    });
  });
});

test('QA 10: an instructor or a guardian is refused; another club\'s pool is not found', async () => {
  await withScratchTenant(async (clubB) => {
    const poolOfB = await aTank(clubB);
    await withScratchTenant(async (clubA) => {
      const instructor = await addMember(clubA, 'Rui', 'Instrutor', ['instructor']);
      const guardian = await addMember(clubA, 'Ana', 'Mãe', ['guardian']);
      for (const [membershipId, role] of [
        [instructor, 'instructor'],
        [guardian, 'guardian'],
      ] as const) {
        await actingAs(clubA, { membershipId, roles: [role] }, async () => {
          const api = new LabResultsController();
          await expectStatus(() => api.list(poolOfB), 403);
          await expectStatus(() => api.record(poolOfB, { sampledAt: recently(), values: CLEAN }), 403);
        });
      }
      await actingAs(clubA, { roles: ['owner'] }, async () => {
        const api = new LabResultsController();
        await expectStatus(() => api.record(poolOfB, { sampledAt: recently(), values: CLEAN }), 404);
        assert.deepEqual((await api.list(poolOfB)).results, [], 'RLS hides club B entirely');
      });
      // Maintenance records but does not archive.
      const maintenance = await addMember(clubA, 'Zé', 'Manutenção', ['maintenance']);
      const poolOfA = await aTank(clubA);
      await actingAs(clubA, { membershipId: maintenance, roles: ['maintenance'] }, async () => {
        const api = new LabResultsController();
        const { id } = await api.record(poolOfA, { sampledAt: recently(), values: CLEAN });
        await expectStatus(() => api.archive(poolOfA, id), 403);
      });
    });
  });
});

test('QA 11: the public page carries the latest grade and its date, and nothing else from the report', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);
    const token = 'tok_' + 'x'.repeat(40);
    await tenant.sql(
      `INSERT INTO pool_public_link (organization_id, pool_id, token) VALUES ($1, $2, $3)`,
      [tenant.organizationId, poolId, token],
    );
    assert.equal((await readPublicWaterPage(token))!.lab, null);

    await actingAs(tenant, { roles: ['owner'] }, () =>
      new LabResultsController().record(poolId, {
        sampledAt: recently(),
        laboratory: 'Segredo do laboratório',
        reportReference: 'REF-1',
        values: withValue('total_coliforms', 4),
      }),
    );
    const page = await readPublicWaterPage(token);
    assert.equal(page!.lab?.grade, 'conforme_condicionada');
    assert.deepEqual(Object.keys(page!.lab!).sort(), ['grade', 'sampledAt']);
    assert.ok(!JSON.stringify(page).includes('Segredo'), 'no laboratory detail leaves');
  });
});

test('a report with chemistry is also a reading: it clears the warning, and archives and restores with the report', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);
    // A bad typed reading this morning, which raised the warning.
    const [bad] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool_analysis (organization_id, pool_id, taken_at) VALUES ($1, $2, now() - interval '5 hours') RETURNING id`,
      [tenant.organizationId, poolId],
    );
    await tenant.sql(
      `INSERT INTO pool_analysis_value (organization_id, analysis_id, metric, value, unit) VALUES ($1, $2, 'ph', 8.9, 'pH')`,
      [tenant.organizationId, bad!.id],
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { id } = await new LabResultsController().record(poolId, {
        sampledAt: recently(),
        values: [...CLEAN, { parameter: 'ph', value: 7.4 }, { parameter: 'free_chlorine', value: 1.1 }],
      });

      const page = await new FacilitiesController().pool(poolId);
      const latest = page.analyses[page.analyses.length - 1]!;
      assert.equal(latest.fromLab, true, 'the report is now the latest reading');
      assert.deepEqual(
        latest.values.map((v) => [v.metric, v.value]),
        [['ph', 7.4], ['free_chlorine', 1.1]],
        'its chemistry only — no organism is a reading',
      );

      await new LabResultsController().archive(poolId, id);
      const archived = await new FacilitiesController().pool(poolId);
      assert.equal(archived.analyses.some((a) => a.fromLab), false, 'archived with its report');

      await tenant.sql('UPDATE lab_result SET archived_at = NULL WHERE id = $1', [id]);
      const restored = await new FacilitiesController().pool(poolId);
      assert.equal(restored.analyses.filter((a) => a.fromLab).length, 1, 'and back with it');

      // A report with no chemistry is no reading.
      await new LabResultsController().record(poolId, { sampledAt: longAgo(), values: CLEAN });
      const after = await new FacilitiesController().pool(poolId);
      assert.equal(after.analyses.filter((a) => a.fromLab).length, 1);
    });
  });
});

test("a reading the club already has at the report's moment stands, and none is added", async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);
    const at = recently();
    await tenant.sql(
      `INSERT INTO pool_analysis (organization_id, pool_id, taken_at) VALUES ($1, $2, $3)`,
      [tenant.organizationId, poolId, at],
    );
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await new LabResultsController().record(poolId, { sampledAt: at, values: [...CLEAN, { parameter: 'ph', value: 7.4 }] });
      const page = await new FacilitiesController().pool(poolId);
      assert.equal(page.analyses.length, 1);
      assert.equal(page.analyses[0]!.fromLab, false);
    });
  });
});
