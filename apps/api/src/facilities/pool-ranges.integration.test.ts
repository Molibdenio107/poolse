import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { FacilitiesController } from './facilities.controller.js';
import { listPoolAlerts, listPoolRanges } from './analyses.repository.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
} from '../test/harness.js';

/**
 * A pool's own safe ranges — slice 4.2, second half.
 *
 * The point of the slice is that an override changes **what gets emailed**, not
 * only what a chart shades. So the assertions that matter are the two
 * directions: a band a club widened stops raising an alert the published one
 * would have raised, and a band it tightened starts raising one the published
 * band would have let through. A test that only checked the rows in the table
 * would pass with the resolver wired to nothing.
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

function recently(): string {
  return new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
}

test('4.2 — a widened band stops the alert the published one would have raised', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);
    await addMember(tenant, 'Sandra', 'Maia', ['maintenance']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new FacilitiesController();

      // The hotel tank. 30 °C is outside the published 25–29 every day of its
      // life, which before this slice meant an email every day.
      await controller.savePoolRanges(poolId, {
        ranges: [{ metric: 'temperature', from: 28, to: 31 }],
      });

      await controller.recordAnalysis(poolId, {
        takenAt: recently(),
        values: { temperature: 30 },
      });
    });

    assert.deepEqual(
      await listPoolAlerts(tenant.organizationId, poolId),
      [],
      'the pool that chose the band is not warned about it',
    );
  });
});

test('4.2 — a tightened band raises the alert the published one would have let through', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);
    await addMember(tenant, 'Sandra', 'Maia', ['maintenance']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new FacilitiesController();

      await controller.savePoolRanges(poolId, {
        ranges: [{ metric: 'ph', from: 7.3, to: 7.4 }],
      });

      // 7.5 is inside the published 7.2–7.6 and outside this club's own band.
      await controller.recordAnalysis(poolId, {
        takenAt: recently(),
        values: { ph: 7.5 },
      });
    });

    const alerts = await listPoolAlerts(tenant.organizationId, poolId);
    assert.equal(alerts.length, 1, 'the club that tightened the band is warned');
    assert.deepEqual(alerts[0]?.metrics, ['ph']);
  });
});

test('4.2 — a metric switched off never raises anything', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new FacilitiesController();

      // Both bounds null: not judged here. Distinct from having no row at all,
      // which would fall back to the published band.
      await controller.savePoolRanges(poolId, {
        ranges: [{ metric: 'temperature', from: null, to: null }],
      });

      await controller.recordAnalysis(poolId, {
        takenAt: recently(),
        values: { temperature: 45 },
      });
    });

    assert.deepEqual(await listPoolAlerts(tenant.organizationId, poolId), []);
  });
});

test('4.2 — a band given to a metric that never had one starts raising alerts', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new FacilitiesController();

      await controller.savePoolRanges(poolId, {
        ranges: [{ metric: 'cyanuric_acid', from: 30, to: 50 }],
      });

      await controller.recordAnalysis(poolId, {
        takenAt: recently(),
        values: { cyanuric_acid: 80 },
      });
    });

    const alerts = await listPoolAlerts(tenant.organizationId, poolId);
    assert.deepEqual(alerts[0]?.metrics, ['cyanuric_acid']);
  });
});

test('4.2 — the one-sided band is judged on that side alone, and the email says so', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);
    await addMember(tenant, 'Sandra', 'Maia', ['maintenance']);

    const detail = await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new FacilitiesController();

      // A floor and no ceiling: an outdoor tank nobody minds being warm.
      await controller.savePoolRanges(poolId, {
        ranges: [{ metric: 'temperature', from: 24, to: null }],
      });

      await controller.recordAnalysis(poolId, {
        takenAt: recently(),
        values: { temperature: 34 },
      });

      return controller.pool(poolId);
    });

    assert.deepEqual(
      await listPoolAlerts(tenant.organizationId, poolId),
      [],
      'nothing is judged above a ceiling that does not exist',
    );

    // The resolved map travels with the pool, nulls intact, so the chart can
    // decline to shade a region with only one edge.
    assert.deepEqual(detail.bands.temperature, { from: 24, to: null });
  });
});

test('4.2 — a metric left out of the save reverts to the published band', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new FacilitiesController();

      await controller.savePoolRanges(poolId, {
        ranges: [
          { metric: 'temperature', from: 28, to: 31 },
          { metric: 'ph', from: 7, to: 8 },
        ],
      });

      // The second save names only the pH, which is how the form says "put the
      // temperature back to the reference" without a second verb.
      await controller.savePoolRanges(poolId, {
        ranges: [{ metric: 'ph', from: 7, to: 8 }],
      });

      const detail = await controller.pool(poolId);
      assert.deepEqual(detail.bands.temperature, { from: 25, to: 29 }, 'back to published');
      assert.deepEqual(detail.bands.ph, { from: 7, to: 8 }, 'and the other one stands');
      assert.equal(detail.bandOverrides.length, 1, 'one live override');
    });

    // Reverting archives rather than deletes: the threshold that decided whether
    // anybody was warned is worth a record.
    const [rows] = await tenant.sql<{ n: string }>(
      `SELECT count(*)::text AS n FROM pool_metric_range
        WHERE pool_id = $1 AND metric = 'temperature' AND archived_at IS NOT NULL`,
      [poolId],
    );
    assert.equal(rows?.n, '1', 'the reverted override is archived, not gone');
  });
});

test('4.2 — overriding, reverting and overriding again is allowed', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new FacilitiesController();

      // The partial unique index is what makes the third call legal: a plain
      // unique constraint would collide with the archived row from the second.
      await controller.savePoolRanges(poolId, { ranges: [{ metric: 'ph', from: 7, to: 8 }] });
      await controller.savePoolRanges(poolId, { ranges: [] });
      await controller.savePoolRanges(poolId, { ranges: [{ metric: 'ph', from: 7.1, to: 7.9 }] });
    });

    const live = await listPoolRanges(tenant.organizationId, poolId);
    assert.deepEqual(live, [{ metric: 'ph', from: 7.1, to: 7.9 }]);
  });
});

test('4.2 — an editing save updates the row in place rather than stacking rows', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new FacilitiesController();
      await controller.savePoolRanges(poolId, { ranges: [{ metric: 'ph', from: 7, to: 8 }] });
      await controller.savePoolRanges(poolId, { ranges: [{ metric: 'ph', from: 7.2, to: 7.8 }] });
    });

    const [rows] = await tenant.sql<{ n: string }>(
      `SELECT count(*)::text AS n FROM pool_metric_range WHERE pool_id = $1`,
      [poolId],
    );
    assert.equal(rows?.n, '1', 'one row, edited — not a new row per save');
    assert.deepEqual(await listPoolRanges(tenant.organizationId, poolId), [
      { metric: 'ph', from: 7.2, to: 7.8 },
    ]);
  });
});

test('4.2 — the refusals name their field, and the metric list is checked', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new FacilitiesController();

      // A maximum below the minimum, refused with a sentence rather than as a
      // Postgres 23514 nobody can act on.
      await expectStatus(
        () => controller.savePoolRanges(poolId, { ranges: [{ metric: 'ph', from: 7.6, to: 7.2 }] }),
        400,
      );

      await expectStatus(
        () => controller.savePoolRanges(poolId, { ranges: [{ metric: 'ph', from: 1, to: 15 }] }),
        400,
      );

      await expectStatus(
        () =>
          controller.savePoolRanges(poolId, {
            ranges: [{ metric: 'chlorine_dioxide', from: 1, to: 2 }],
          }),
        400,
      );

      // Twice in one submit is two answers about one band: a client bug, and
      // last-wins would hide it.
      await expectStatus(
        () =>
          controller.savePoolRanges(poolId, {
            ranges: [
              { metric: 'ph', from: 7, to: 8 },
              { metric: 'ph', from: 7.1, to: 7.9 },
            ],
          }),
        400,
      );

      await expectStatus(
        () => controller.savePoolRanges(poolId, { ranges: [{ metric: 'ph', from: -1, to: 8 }] }),
        400,
      );
    });

    assert.deepEqual(
      await listPoolRanges(tenant.organizationId, poolId),
      [],
      'and none of them wrote anything',
    );
  });
});

test('4.2 — only owner and admin may set a band', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);

    const instructor = await addMember(tenant, 'Inês', 'Costa', ['instructor']);
    const maintenance = await addMember(tenant, 'Sandra', 'Maia', ['maintenance']);

    // Maintenance is deliberately refused: this decides whether anybody is
    // warned at all, which is a different kind of decision from recording a
    // reading. Widening it is a call to take out loud.
    for (const membershipId of [instructor, maintenance]) {
      await actingAs(
        tenant,
        { membershipId, roles: membershipId === instructor ? ['instructor'] : ['maintenance'] },
        async () => {
          await expectStatus(
            () =>
              new FacilitiesController().savePoolRanges(poolId, {
                ranges: [{ metric: 'ph', from: 1, to: 2 }],
              }),
            403,
          );
        },
      );
    }

    assert.deepEqual(await listPoolRanges(tenant.organizationId, poolId), []);

    await actingAs(tenant, { roles: ['admin'] }, async () => {
      await new FacilitiesController().savePoolRanges(poolId, {
        ranges: [{ metric: 'ph', from: 7, to: 8 }],
      });
    });

    assert.equal((await listPoolRanges(tenant.organizationId, poolId)).length, 1, 'admin may');
  });
});
