import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { PoolPublicLinkController, PublicWaterController } from './public-link.controller.js';
import { readPublicWaterPage } from './public-link.repository.js';
import { publicWaterTracker } from '../common/throttle.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * A tank's public water page — POOLSE-71.
 *
 * The first read of tenant data with no tenant context, so most of this file is
 * about the boundary: exactly these keys leave, a revoked or replaced link is
 * indistinguishable from one that never existed, and another club's tank is out
 * of reach from the tenant side. The rest is the judging, which must give the
 * answer the pool's own page gives.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

const HOUR = 60 * 60 * 1000;

async function pool(tenant: ScratchTenant, name = 'Piscina Grande'): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.organizationId, tenant.facilityId, name],
  );
  return row!.id;
}

async function analysis(
  tenant: ScratchTenant,
  poolId: string,
  hoursAgo: number,
  values: { metric: string; value: number; unit: string }[],
): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool_analysis (organization_id, pool_id, taken_at, notes)
     VALUES ($1, $2, $3, 'nota interna') RETURNING id`,
    [tenant.organizationId, poolId, new Date(Date.now() - hoursAgo * HOUR).toISOString()],
  );
  for (const v of values) {
    await tenant.sql(
      `INSERT INTO pool_analysis_value (organization_id, analysis_id, metric, value, unit)
       VALUES ($1, $2, $3::pool_metric, $4, $5)`,
      [tenant.organizationId, row!.id, v.metric, v.value, v.unit],
    );
  }
  return row!.id;
}

async function publish(tenant: ScratchTenant, poolId: string, replace = false): Promise<string> {
  return actingAs(tenant, { roles: ['owner'] }, async () => {
    const link = await new PoolPublicLinkController().issue(poolId, { replace });
    assert.ok(link.token);
    return link.token;
  });
}

test('71 — the payload carries exactly the allowed keys and the latest reading of each metric', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await pool(tenant);
    await analysis(tenant, poolId, 30, [{ metric: 'ph', value: 7.0, unit: 'pH' }]);
    await analysis(tenant, poolId, 2, [
      { metric: 'ph', value: 7.4, unit: 'pH' },
      { metric: 'free_chlorine', value: 1.2, unit: 'mg/L' },
    ]);
    const token = await publish(tenant, poolId);

    const page = await new PublicWaterController().page(token);
    assert.deepEqual(Object.keys(page).sort(), ['complaints', 'facilityName', 'lab', 'poolName', 'readings', 'regulation', 'timezone']);
    assert.equal(page.poolName, 'Piscina Grande');
    for (const reading of page.readings) {
      assert.deepEqual(Object.keys(reading).sort(), [
        'band',
        'metric',
        'stale',
        'state',
        'takenAt',
        'unit',
        'value',
      ]);
    }
    const ph = page.readings.find((r) => r.metric === 'ph');
    assert.equal(ph?.value, 7.4, 'the latest, not the first');
    assert.equal(ph?.stale, false);

    // Nothing internal leaks anywhere in the body.
    const body = JSON.stringify(page);
    assert.ok(!body.includes('nota interna'));
    assert.ok(!body.includes(tenant.organizationId));
    assert.ok(!body.includes(poolId));
  });
});

test('71 — a reading is judged against the pool’s resolved band', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await pool(tenant);
    await analysis(tenant, poolId, 1, [
      { metric: 'ph', value: 8.4, unit: 'pH' },
      { metric: 'temperature', value: 30, unit: '°C' },
    ]);
    // A hotel tank kept warm: temperature is switched off for this pool.
    await tenant.sql(
      `INSERT INTO pool_metric_range (organization_id, pool_id, metric, min_value, max_value)
       VALUES ($1, $2, 'temperature', NULL, NULL)`,
      [tenant.organizationId, poolId],
    );
    const token = await publish(tenant, poolId);

    const page = await readPublicWaterPage(token);
    const ph = page?.readings.find((r) => r.metric === 'ph');
    assert.equal(ph?.state, 'high');
    assert.ok(ph?.band !== null && ph?.band.to !== null);
    const temperature = page?.readings.find((r) => r.metric === 'temperature');
    assert.equal(temperature?.state, 'unjudged');
    assert.equal(temperature?.band, null);
  });
});

test('71 — a reading older than a day says so, and an archived one is not the latest', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await pool(tenant);
    await analysis(tenant, poolId, 30, [{ metric: 'ph', value: 7.2, unit: 'pH' }]);
    const newer = await analysis(tenant, poolId, 1, [{ metric: 'ph', value: 9.9, unit: 'pH' }]);
    await tenant.sql('UPDATE pool_analysis SET archived_at = now() WHERE id = $1', [newer]);
    const token = await publish(tenant, poolId);

    const page = await readPublicWaterPage(token);
    assert.equal(page?.readings.length, 1);
    assert.equal(page?.readings[0]?.value, 7.2);
    assert.equal(page?.readings[0]?.stale, true);
  });
});

test('71 — a tank with no readings is an empty list, not a miss', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await pool(tenant);
    const token = await publish(tenant, poolId);
    const page = await readPublicWaterPage(token);
    assert.deepEqual(page?.readings, []);
  });
});

test('71 — turning it on twice keeps the link; replacing it kills the old one at once', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await pool(tenant);
    const first = await publish(tenant, poolId);
    assert.equal(await publish(tenant, poolId), first, 'pressing the switch again is not a new QR');
    assert.ok(first.length >= 43, '256 bits, base64url');

    const second = await publish(tenant, poolId, true);
    assert.notEqual(second, first);
    assert.equal(await readPublicWaterPage(first), null);
    assert.ok(await readPublicWaterPage(second));
  });
});

test('71 — switched off, a token answers exactly like one that never existed', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await pool(tenant);
    const token = await publish(tenant, poolId);
    await actingAs(tenant, { roles: ['owner'] }, () =>
      new PoolPublicLinkController().revoke(poolId),
    );

    const controller = new PublicWaterController();
    await expectStatus(() => controller.page(token), 404);
    await expectStatus(() => controller.page('A'.repeat(43)), 404);
    await expectStatus(() => controller.page('not a token'), 404);

    const link = await actingAs(tenant, { roles: ['owner'] }, () =>
      new PoolPublicLinkController().get(poolId),
    );
    assert.equal(link.token, null);

    // Turning it on again is a new link, never the old one back.
    const again = await publish(tenant, poolId);
    assert.notEqual(again, token);
  });
});

test('71 — an archived tank has no public page', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await pool(tenant);
    const token = await publish(tenant, poolId);
    await tenant.sql('UPDATE pool SET archived_at = now() WHERE id = $1', [poolId]);
    assert.equal(await readPublicWaterPage(token), null);
  });
});

test('71 — maintenance may publish; an instructor may not', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await pool(tenant);
    const teacher = await addMember(tenant, 'Prof', 'Água', ['instructor']);
    const keeper = await addMember(tenant, 'Manu', 'Tenção', ['maintenance']);

    await actingAs(tenant, { membershipId: teacher, roles: ['instructor'] }, async () => {
      const controller = new PoolPublicLinkController();
      await expectStatus(() => controller.issue(poolId, {}), 403);
      await expectStatus(() => controller.get(poolId), 403);
      await expectStatus(() => controller.revoke(poolId), 403);
    });
    await actingAs(tenant, { membershipId: keeper, roles: ['maintenance'] }, async () => {
      const link = await new PoolPublicLinkController().issue(poolId, {});
      assert.ok(link.token);
    });
  });
});

test("71 — another club's tank is out of reach from the tenant side", async () => {
  await withScratchTenant(async (a) => {
    await withScratchTenant(async (b) => {
      const bPool = await pool(b, 'Piscina B');
      const bToken = await publish(b, bPool);

      await actingAs(a, { roles: ['owner'] }, async () => {
        const controller = new PoolPublicLinkController();
        await expectStatus(() => controller.get(bPool), 404);
        await expectStatus(() => controller.issue(bPool, { replace: true }), 404);
        await expectStatus(() => controller.revoke(bPool), 404);
      });

      // B's link was not touched by any of that.
      const page = await readPublicWaterPage(bToken);
      assert.equal(page?.poolName, 'Piscina B');
    });
  });
});

test('71 — a link is never edited in place', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await pool(tenant);
    await publish(tenant, poolId);
    await assert.rejects(
      () => tenant.sql(`UPDATE pool_public_link SET token = $1`, ['B'.repeat(43)]),
      /permission denied/,
    );
    await assert.rejects(() => tenant.sql('DELETE FROM pool_public_link'), /permission denied/);
  });
});

test('71 — the public page is throttled per token, not per address', () => {
  assert.equal(publicWaterTracker('/public/water/abc_DEF-123'), 'water:abc_DEF-123');
  assert.equal(publicWaterTracker('/public/water/abc/'), 'water:abc');
  assert.equal(publicWaterTracker('/pools/x/public-link'), null);
});
