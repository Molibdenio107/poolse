import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { CostsController } from './costs.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * POOLSE-182 — the cost ledger through its routes: who reads, who records, and
 * what a window and a month say.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

const asOwner = <T>(tenant: ScratchTenant, fn: () => Promise<T>): Promise<T> => actingAs(tenant, { roles: ['owner'] }, fn);

async function item(tenant: ScratchTenant): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO inventory_item (organization_id, facility_id, name, quantity, unit) VALUES ($1, $2, 'Cloro', 5, 'kg') RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );
  return row!.id;
}

async function avaria(tenant: ScratchTenant): Promise<string> {
  const reporter = await addMember(tenant, 'Manuel', 'Manutenção', ['maintenance']);
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO maintenance_request (organization_id, facility_id, type, description, reported_by, severity)
     VALUES ($1, $2, 'fault', 'Bomba avariada', $3, 'high') RETURNING id`,
    [tenant.organizationId, tenant.facilityId, reporter],
  );
  return row!.id;
}

test('QA 5 — a purchase raises the stock in the same step, and its unit cost is the last purchase’s', async () => {
  await withScratchTenant(async (tenant) => {
    const cloro = await item(tenant);
    await asOwner(tenant, () =>
      new CostsController().purchase({ inventoryItemId: cloro, quantity: 10, amountCents: 18000, vatCents: 4140, boughtOn: '2026-10-05' }),
    );
    const [row] = await tenant.sql<{ quantity: number; unit_cost_cents: number }>(
      'SELECT quantity, unit_cost_cents FROM inventory_item WHERE id = $1',
      [cloro],
    );
    assert.equal(row!.quantity, 15);
    assert.equal(row!.unit_cost_cents, 1800);
    const { months } = await asOwner(tenant, () => new CostsController().months('2026-10-01', '2026-10-31'));
    assert.deepEqual(
      months.filter((one) => one.kind === 'materials').map((one) => [one.month, one.netCents, one.vatCents]),
      [['2026-10', 18000, 4140]],
    );
  });
});

test('QA 6 — maintenance records a service and a purchase, and is refused every total; an instructor gets nothing', async () => {
  await withScratchTenant(async (tenant) => {
    const cloro = await item(tenant);
    const request = await avaria(tenant);
    const maintenance = await addMember(tenant, 'Rui', 'Técnico', ['maintenance']);
    await actingAs(tenant, { membershipId: maintenance, roles: ['maintenance'] }, async () => {
      const service = await new CostsController().service({
        maintenanceRequestId: request,
        facilityId: tenant.facilityId,
        amountCents: 25000,
        vatCents: 5750,
        performedOn: '2026-11-02',
        supplier: 'Bombas Lda',
      });
      assert.match(service.id, /^[0-9a-f-]{36}$/);
      assert.deepEqual(Object.keys(service), ['id'], 'an id, never a total');
      await new CostsController().purchase({ inventoryItemId: cloro, quantity: 2, amountCents: 3600, boughtOn: '2026-11-02' });
      await expectStatus(() => new CostsController().months('2026-01-01', '2026-12-31'), 403);
      await expectStatus(() => new CostsController().window('2026-01-01', '2026-12-31'), 403);
      await expectStatus(() => new CostsController().record({ kind: 'water', amountCents: 1, periodFrom: '2026-01-01', periodTo: '2026-01-01' }), 403);
    });
    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      await expectStatus(() => new CostsController().months('2026-01-01', '2026-12-31'), 403);
      await expectStatus(() => new CostsController().service({ maintenanceRequestId: request, amountCents: 1, performedOn: '2026-11-02' }), 403);
      await expectStatus(() => new CostsController().purchase({ inventoryItemId: cloro, quantity: 1, amountCents: 1, boughtOn: '2026-11-02' }), 403);
    });
    const { months } = await asOwner(tenant, () => new CostsController().months('2026-11-01', '2026-11-30'));
    const service = months.find((one) => one.kind === 'maintenance_service');
    assert.equal(service?.netCents, 25000);
    assert.equal(service?.basis, 'invoice');
  });
});

test('a civil year and an época read the same rows, and a fixed cost recurs (QA 2)', async () => {
  await withScratchTenant(async (tenant) => {
    await asOwner(tenant, async () => {
      await new CostsController().record({
        kind: 'water', facilityId: tenant.facilityId, amountCents: 300000, vatCents: 18000,
        periodFrom: '2026-09-01', periodTo: '2026-09-30',
      });
      await new CostsController().record({
        // A finished year, so the test does not depend on today: occurrences are
        // generated up to today, and a month not yet reached is not yet spent.
        kind: 'fixed', amountCents: 4900, recurrence: 'monthly', effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31',
        supplier: 'Poolse',
      });
    });
    const year = await asOwner(tenant, () => new CostsController().window('2026-01-01', '2026-12-31'));
    const epoca = await asOwner(tenant, () => new CostsController().window('2026-09-15', '2027-07-31'));
    const water = (totals: typeof year.totals): number => totals.find((one) => one.kind === 'water')!.netCents;
    assert.equal(water(year.totals), 300000);
    assert.equal(water(epoca.totals), 160000, 'September split 16/30 into the época');
    const fixed = await asOwner(tenant, () => new CostsController().window('2025-01-01', '2025-12-31'));
    assert.equal(fixed.totals.find((one) => one.kind === 'fixed')!.netCents, 12 * 4900);
  });
});

test('salaries are an estimate, and an Admin’s total leaves the Owner’s pay out', async () => {
  await withScratchTenant(async (tenant) => {
    const coach = await addMember(tenant, 'Ana', 'Treinadora', ['instructor']);
    await tenant.sql(
      `INSERT INTO staff_compensation (organization_id, staff_membership_id, kind, amount_cents, effective_from, created_by_membership_id)
       VALUES ($1, $2, 'monthly', 120000, '2026-01-01', $3), ($1, $3, 'monthly', 300000, '2026-01-01', $3)`,
      [tenant.organizationId, coach, tenant.ownerMembershipId],
    );
    const salary = (ledger: { months: { kind: string; basis: string; netCents: number }[] }) =>
      ledger.months.find((one) => one.kind === 'salary');
    const owner = await asOwner(tenant, () => new CostsController().months('2026-03-01', '2026-03-31'));
    const admin = await actingAs(tenant, { roles: ['admin'] }, () => new CostsController().months('2026-03-01', '2026-03-31'));
    assert.equal(salary(owner)!.basis, 'estimate');
    assert.equal(salary(owner)!.netCents, 140000 + 350000);
    assert.equal(salary(admin)!.netCents, 140000);
  });
});

test('refusals: another club’s site, a bad window, a recurring cost with a period', async () => {
  await withScratchTenant(async (tenant) => {
    await withScratchTenant(async (other) => {
      await asOwner(tenant, async () => {
        await expectStatus(
          () => new CostsController().record({ kind: 'water', facilityId: other.facilityId, amountCents: 100, periodFrom: '2026-01-01', periodTo: '2026-01-01' }),
          400,
        );
        await expectStatus(() => new CostsController().months('2026-12-31', '2026-01-01'), 400);
        await expectStatus(() => new CostsController().months('1990-01-01', '2026-01-01'), 400);
        await expectStatus(
          () => new CostsController().record({ kind: 'electricity', amountCents: 100, periodFrom: '2026-01-01', periodTo: '2026-01-01' }),
          400,
        );
        await expectStatus(
          () => new CostsController().record({ kind: 'water', amountCents: -5, periodFrom: '2026-01-01', periodTo: '2026-01-01' }),
          400,
        );
      });
    });
  });
});

test('a supply’s unbilled month is estimated from its tariff; a billed month is not, and a sub-meter never is', async () => {
  await withScratchTenant(async (tenant) => {
    const org = tenant.organizationId;
    const meter = async (name: string, cpe: string | null): Promise<string> => {
      const [row] = await tenant.sql<{ id: string }>(
        `INSERT INTO energy_meter (organization_id, facility_id, name, kind, unit, reads, carrier, cpe)
         VALUES ($1, $2, $3, 'total', 'kWh', 'interval_consumption', 'electricity', $4) RETURNING id`,
        [org, tenant.facilityId, name, cpe],
      );
      return row!.id;
    };
    const supply = await meter('Geral', 'PT0002000000000000AB');
    const sub = await meter('Bomba de calor', null);
    for (const id of [supply, sub]) {
      // 1 000 kWh in each of March and April, at 0,15 €/kWh.
      await tenant.sql(
        `INSERT INTO energy_reading (organization_id, meter_id, taken_at, value)
         VALUES ($1, $2, '2026-03-20T12:00:00Z', 1000), ($1, $2, '2026-04-20T12:00:00Z', 1000)`,
        [org, id],
      );
      await tenant.sql(
        `INSERT INTO energy_tariff (organization_id, meter_id, unit_price, effective_from, created_by_membership_id)
         VALUES ($1, $2, 0.15, '2026-01-01', $3)`,
        [org, id, tenant.ownerMembershipId],
      );
    }
    // March is billed; April's bill has not come.
    await tenant.sql(
      `INSERT INTO energy_invoice (organization_id, meter_id, supplier, invoice_number, issued_on, period_start, period_end,
                                   subtotal_cents, vat_cents, total_cents, document_total_cents)
       VALUES ($1, $2, 'EDP', 'FT 1', '2026-04-05', '2026-03-01', '2026-03-31', 16000, 3680, 19680, 19680)`,
      [org, supply],
    );
    const { months } = await asOwner(tenant, () => new CostsController().months('2026-03-01', '2026-04-30'));
    const electricity = months.filter((one) => one.kind === 'electricity').map((one) => [one.month, one.basis, one.netCents]);
    assert.deepEqual(electricity.sort(), [
      ['2026-03', 'invoice', 16000],
      ['2026-04', 'estimate', 15000],
    ]);
  });
});

const recordWater = (tenant: ScratchTenant, month: string, amountCents: number, vatCents = 0): Promise<{ id: string }> =>
  asOwner(tenant, () =>
    new CostsController().record({ kind: 'water', amountCents, vatCents, periodFrom: `${month}-01`, periodTo: `${month}-28` }),
  );

test('183 QA 1 — one set of rows, two rulers: an época cuts where its dates do, a year where it ends', async () => {
  await withScratchTenant(async (tenant) => {
    await recordWater(tenant, '2025-02', 28_000);
    await recordWater(tenant, '2025-08', 9_000);
    const [season] = await tenant.sql<{ id: string }>(
      `INSERT INTO season (organization_id, name, starts_on, ends_on, status)
       VALUES ($1, 'Época 24/25', '2024-09-15', '2025-07-31', 'archived') RETURNING id`,
      [tenant.organizationId],
    );
    const controller = new CostsController();
    const year = await asOwner(tenant, () => controller.overview('civil', '2025'));
    assert.equal(year.ruler, 'civil');
    assert.equal(year.window.from, '2025-01-01');
    assert.equal(year.window.to, '2025-12-31');
    assert.equal(year.invoicedCents, 37_000);

    const epoca = await asOwner(tenant, () => controller.overview('season', season!.id));
    assert.equal(epoca.window.from, '2024-09-15');
    assert.equal(epoca.window.to, '2025-07-31');
    assert.equal(epoca.invoicedCents, 28_000, 'August falls outside the época');
    assert.deepEqual(epoca.seasons.map((one) => one.name).slice(0, 1), year.seasons.map((one) => one.name).slice(0, 1));
    assert.ok(epoca.table.some((month) => month.month === '2024-09' && month.partial));
  });
});

test('183 QA 3 and rule 7 — a missing denominator is null, not zero, and com IVA adds the VAT', async () => {
  await withScratchTenant(async (tenant) => {
    await recordWater(tenant, '2025-08', 10_000, 2_300);
    const controller = new CostsController();
    const plain = await asOwner(tenant, () => controller.overview('civil', '2025'));
    assert.equal(plain.averages.taughtHours, 0);
    assert.equal(plain.averages.perHourCents, null);
    assert.equal(plain.averages.perStudentMonthCents, null);
    assert.equal(plain.averages.perMonthCents, Math.round(10_000 / 12));
    assert.equal(plain.withVat, false);
    const gross = await asOwner(tenant, () => controller.overview('civil', '2025', '1'));
    assert.equal(gross.invoicedCents, 12_300);
  });
});

test('183 — a running year stops at today, so it counts no pay not yet earned', async () => {
  await withScratchTenant(async (tenant) => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(new Date());
    const overview = await asOwner(tenant, () => new CostsController().overview());
    assert.equal(overview.window.to, today);
    assert.equal(overview.chart.length, 24);
    assert.equal(overview.chart.at(-1)!.month, today.slice(0, 7));
  });
});

test('183 QA 4 — an admin opens it without the Owner, an instructor and maintenance are refused', async () => {
  await withScratchTenant(async (tenant) => {
    const asAdmin = await actingAs(tenant, { roles: ['admin'] }, () => new CostsController().overview());
    assert.equal(asAdmin.ownerPayLeftOut, true);
    const mine = await asOwner(tenant, () => new CostsController().overview());
    assert.equal(mine.ownerPayLeftOut, false);
    for (const role of ['instructor', 'maintenance', 'guardian', 'student'] as const) {
      await actingAs(tenant, { roles: [role] }, () => expectStatus(() => new CostsController().overview(), 403));
    }
    await actingAs(tenant, { roles: ['owner'] }, () => expectStatus(() => new CostsController().overview('moon'), 400));
  });
});

test('183 — another club reads none of it', async () => {
  await withScratchTenant(async (mine) => {
    await recordWater(mine, '2025-08', 10_000);
    await withScratchTenant(async (theirs) => {
      const seen = await asOwner(theirs, () => new CostsController().overview('civil', '2025'));
      assert.equal(seen.invoicedCents, 0);
      assert.deepEqual(seen.totals, []);
    });
  });
});

test('189 QA 2 — a monthly cost shows every month, and stopping it keeps the past and ends the rest', async () => {
  await withScratchTenant(async (tenant) => {
    const controller = new CostsController();
    const { id } = await asOwner(tenant, () =>
      controller.record({ kind: 'fixed', amountCents: 10_000, recurrence: 'monthly', effectiveFrom: '2026-01-01' }),
    );
    const listed = await asOwner(tenant, () => controller.entries());
    assert.deepEqual(listed.entries.map((one) => [one.id, one.recurrence, one.startsOn]), [[id, 'monthly', '2026-01-01']]);

    const before = await asOwner(tenant, () => controller.overview('civil', '2026'));
    assert.ok(before.table.filter((month) => month.groups.fixed !== undefined).length >= 2);
    await asOwner(tenant, () => controller.archive(id));
    assert.deepEqual((await asOwner(tenant, () => controller.entries())).entries, []);
    const after = await asOwner(tenant, () => controller.overview('civil', '2026'));
    assert.equal(after.invoicedCents, before.invoicedCents, 'the months already generated stay');
  });
});

test('189 QA 5 and 6 — an instructor reads no entries, and another club sees none', async () => {
  await withScratchTenant(async (mine) => {
    await recordWater(mine, '2025-08', 10_000);
    await actingAs(mine, { roles: ['instructor'] }, () => expectStatus(() => new CostsController().entries(), 403));
    await withScratchTenant(async (theirs) => {
      assert.deepEqual((await asOwner(theirs, () => new CostsController().entries())).entries, []);
      await asOwner(theirs, () =>
        expectStatus(() => new CostsController().premium('00000000-0000-4000-8000-000000000000', { premiumCents: 1 }), 404),
      );
    });
  });
});
