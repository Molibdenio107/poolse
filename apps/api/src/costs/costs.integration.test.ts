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
