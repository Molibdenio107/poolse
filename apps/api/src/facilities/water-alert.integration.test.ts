import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ALERT_WINDOW_HOURS } from '@poolse/rules';
import { FacilitiesController } from './facilities.controller.js';
import { findWaterAlertNotice, listPoolAlerts } from './analyses.repository.js';
import { actingAs, addMember, closeHarness, withScratchTenant } from '../test/harness.js';

/**
 * An out-of-range reading reaches someone — slice 4.2.
 *
 * The whole slice is four repository functions and a send, and CLAUDE.md names
 * the failure mode outright: a repository function with no integration test is
 * untested SQL. `typecheck` does not read a query, and `sql:check` only looks
 * for backticks — the stand-in feature shipped entirely dead that way.
 *
 * What is asserted here, in the order it matters:
 *
 * 1. A recent bad reading raises an alert, and the alert names the metric.
 * 2. A recent *good* reading raises nothing — the channel stays quiet.
 * 3. A **backdated** bad reading raises nothing, which is what lets a club
 *    import a year of lab sheets without emailing itself forty times.
 * 4. The recipients are the people who can act: owner, admin and maintenance,
 *    deduplicated, and never the instructor.
 * 5. The alert reaches the pool's own page with its delivery state intact.
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

/** An instant a couple of hours ago, so it is comfortably inside the window. */
function recently(): string {
  return new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
}

/** Older than the alert window, by a day, whatever the window is set to. */
function longAgo(): string {
  return new Date(Date.now() - (ALERT_WINDOW_HOURS + 24) * 60 * 60 * 1000).toISOString();
}

test('4.2 — a recent reading outside its band raises an alert naming the metric', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      // 8.4 against a band of 7.2–7.6, and a free chlorine that is fine. Only
      // the pH should be named: an alert that listed every metric measured would
      // be an alert nobody could act on.
      await new FacilitiesController().recordAnalysis(poolId, {
        takenAt: recently(),
        values: { ph: 8.4, free_chlorine: 1.2 },
      });
    });

    const alerts = await listPoolAlerts(tenant.organizationId, poolId);
    assert.equal(alerts.length, 1, 'one bad reading, one alert');
    assert.deepEqual(alerts[0]?.metrics, ['ph']);
  });
});

test('4.2 — water inside its band says nothing at all', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await new FacilitiesController().recordAnalysis(poolId, {
        takenAt: recently(),
        values: { ph: 7.4, temperature: 27, free_chlorine: 1.2 },
      });
    });

    assert.deepEqual(await listPoolAlerts(tenant.organizationId, poolId), []);
  });
});

test('4.2 — a metric with no published band is never alerted on', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      // Cyanuric acid at a figure that would worry anybody. Nothing in
      // `@poolse/rules` knows what a bad one is, and a threshold nobody chose is
      // a threshold that pages somebody at midnight for no reason.
      await new FacilitiesController().recordAnalysis(poolId, {
        takenAt: recently(),
        values: { cyanuric_acid: 180 },
      });
    });

    assert.deepEqual(await listPoolAlerts(tenant.organizationId, poolId), []);
  });
});

test('4.2 — a backdated bad reading is recorded and raises nothing', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await new FacilitiesController().recordAnalysis(poolId, {
        takenAt: longAgo(),
        values: { ph: 8.4 },
      });
    });

    // The reading is kept — this is the half that must not change. A club typing
    // in last month's sheet is doing data entry, and the pool's page still
    // flags the crossed band.
    const [written] = await tenant.sql<{ n: string }>(
      `SELECT count(*)::text AS n FROM pool_analysis WHERE pool_id = $1`,
      [poolId],
    );
    assert.equal(written?.n, '1', 'the analysis itself is still recorded');

    assert.deepEqual(
      await listPoolAlerts(tenant.organizationId, poolId),
      [],
      'nothing is sent about water that was dosed weeks ago',
    );
  });
});

test('4.2 — an imported log of old sheets emails nobody', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const result = await new FacilitiesController().importAnalyses(poolId, {
        commit: true,
        rows: [
          { takenOn: '01/03/2026', takenTime: '08:30', ph: '8,4' },
          { takenOn: '02/03/2026', takenTime: '08:15', free_chlorine: '0,1' },
          { takenOn: '03/03/2026', takenTime: '08:20', ph: '6,1' },
        ],
      });

      assert.equal(result.created, 3, 'every row is imported');
      assert.deepEqual(result.alertIds, [], 'and none of them alerts');
    });

    assert.deepEqual(await listPoolAlerts(tenant.organizationId, poolId), []);
  });
});

test('4.2 — the recipients are the people who can act, and only them', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);

    // Two who should hear about it, one who should not. `addMember` gives each
    // an email and no login, which is the ordinary case for club staff and the
    // one an inner join to `app_user` would have skipped.
    await addMember(tenant, 'Sandra', 'Maia', ['maintenance']);
    await addMember(tenant, 'Paulo', 'Reis', ['admin']);
    await addMember(tenant, 'Inês', 'Costa', ['instructor']);

    // And one who holds both tiers, to prove they are written to once.
    await addMember(tenant, 'Dupla', 'Função', ['admin', 'maintenance']);

    // Suspended after the fact: not staff this week, and not written to.
    const suspended = await addMember(tenant, 'Antigo', 'Colega', ['maintenance']);
    await tenant.sql(`UPDATE membership SET status = 'suspended' WHERE id = $1`, [suspended]);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await new FacilitiesController().recordAnalysis(poolId, {
        takenAt: recently(),
        values: { ph: 8.4 },
      });
    });

    const [alert] = await listPoolAlerts(tenant.organizationId, poolId);
    assert.ok(alert, 'the alert was raised');

    const notice = await findWaterAlertNotice(tenant.organizationId, alert.id);
    assert.ok(notice, 'the notice reads back');

    const addressed = notice.recipients.join(' ');
    assert.match(addressed, /sandra\.maia/, 'maintenance is told');
    assert.match(addressed, /paulo\.reis/, 'admin is told');
    assert.doesNotMatch(addressed, /ines\.costa|in%C3%AAs/, 'the instructor is not');
    assert.doesNotMatch(addressed, /antigo\.colega/, 'nor is a suspended member');

    // One person, one address, however many roles they hold.
    assert.equal(
      new Set(notice.recipients).size,
      notice.recipients.length,
      'nobody is written to twice',
    );

    // The body has the numbers in it, not a "log in to see" line.
    assert.equal(notice.excursions.length, 1);
    assert.equal(notice.excursions[0]?.metric, 'ph');
    assert.equal(notice.excursions[0]?.direction, 'high');
    assert.equal(notice.excursions[0]?.unit, 'pH');
    assert.equal(notice.facilityTimezone.length > 0, true, 'the sample instant has a clock');
  });
});

test('4.2 — the pool page says who was written to, and whether anything was sent', async () => {
  await withScratchTenant(async (tenant) => {
    const poolId = await aTank(tenant);
    await addMember(tenant, 'Sandra', 'Maia', ['maintenance']);

    const detail = await actingAs(tenant, { roles: ['owner'] }, async () => {
      await new FacilitiesController().recordAnalysis(poolId, {
        takenAt: recently(),
        values: { combined_chlorine: 0.9 },
      });

      return new FacilitiesController().pool(poolId);
    });

    assert.equal(detail.alerts.length, 1);
    const alert = detail.alerts[0]!;
    assert.deepEqual(alert.metrics, ['combined_chlorine']);

    // A count and not the addresses: this panel is readable by any member.
    assert.ok(alert.recipients >= 1, 'somebody was written to');

    /*
     * And nothing was actually sent, because the test environment has no
     * provider — `sendEmail` returns false under `EMAIL_PROVIDER=console` and
     * writes the message to the log instead. That is the state the panel has to
     * be able to say out loud: "registado, sem envio". A row that looked
     * identical either way would let somebody believe a club had been contacted.
     */
    assert.equal(alert.deliveredAt, null, 'recorded, and honest about not sending');
    assert.equal(detail.emailConfigured, false);

    // Both instants travel, and both parse — the F-04 lesson. A hand-written
    // format string is what put "Invalid Date" on the invoice page.
    assert.ok(Number.isFinite(new Date(alert.raisedAt).getTime()));
    assert.ok(Number.isFinite(new Date(alert.takenAt).getTime()));
  });
});
