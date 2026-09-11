import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { EnergyController } from './energy.controller.js';
import { EnergyInvoicesController } from './invoices.controller.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * Faturas — slice 5.3, first half.
 *
 * The bill under test is the first EDP sample, in cents. The paper says
 * "41,12 sem IVA" and then a 5,11 block that is taxes *and* VAT together
 * (0,07 + 0,17 + 1,64 + 3,23); the honest split is every line s/IVA — 41,36
 * including the two taxes — plus 4,87 of VAT = 46,23. 66,64 in the envelope
 * once the TV licence, the services pack and a late fee are added. Three registers on the dial summed into one
 * Simples line split by VAT rate. If this file's fixture ever looks unlike a
 * real bill, that is the bug.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/** The first EDP sample as the API body. Registers 65 + 33 + 72 = 170 kWh billed. */
function sampleBill(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    supplier: 'EDP Comercial',
    invoiceNumber: 'FT2025 K3425/340041459032',
    atcud: 'JJB9YGZ2-340041459032',
    documentReference: 'C801178006477834',
    issuedOn: '2025-11-28',
    periodStart: '2025-10-26',
    periodEnd: '2025-11-25',
    dueOn: '2025-12-23',
    contractedPowerKva: 4.6,
    tariff: 'Simples',
    cycle: 'Sem ciclo',
    readingQuality: 'real',
    cpe: 'PT 0002 000 042 466 003 BW',
    meterSerial: '28202100272356',
    subtotalCents: 4136,
    vatCents: 487,
    totalCents: 4623,
    otherChargesCents: 2041,
    documentTotalCents: 6664,
    networkAccessCents: 1676,
    regulatedDifferenceCents: -572,
    source: 'import',
    sourceFileName: 'fatura.pdf',
    registers: [
      { register: 'vazio', previousIndex: 968, currentIndex: 1033, kwh: 65 },
      { register: 'ponta', previousIndex: 439, currentIndex: 472, kwh: 33 },
      { register: 'cheias', previousIndex: 1113, currentIndex: 1185, kwh: 72 },
    ],
    lines: [
      { kind: 'energy', description: 'Consumo real Simples', period: 'simples', fromOn: '2025-10-26', toOn: '2025-11-11', quantity: 92, unit: 'kWh', unitPrice: 0.1675, amountCents: 1541, discountCents: 62, totalCents: 1479, vatRate: 6 },
      { kind: 'energy', description: 'Consumo real Simples', period: 'simples', fromOn: '2025-11-12', toOn: '2025-11-25', quantity: 78, unit: 'kWh', unitPrice: 0.1675, amountCents: 1307, discountCents: 52, totalCents: 1255, vatRate: 6 },
      { kind: 'power', description: 'Potência (4,6 kVA)', fromOn: '2025-10-26', toOn: '2025-11-25', quantity: 31, unit: 'dias', unitPrice: 0.4631, amountCents: 1435, discountCents: 57, totalCents: 1378, vatRate: 23 },
      { kind: 'tax', description: 'DGEG', quantity: 1, unit: 'mês', unitPrice: 0.07, amountCents: 7, totalCents: 7, vatRate: 23 },
      { kind: 'tax', description: 'IEC', quantity: 170, unit: 'kWh', unitPrice: 0.001, amountCents: 17, totalCents: 17, vatRate: 23 },
    ],
    ...overrides,
  };
}

test('5.3 — preview says what the bill is, then commit files it and stamps the meter', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { id: meterId } = await new EnergyController().create(tenant.facilityId, {
        name: 'Geral',
        kind: 'total',
      });
      const controller = new EnergyInvoicesController();

      const preview = await controller.file(meterId, sampleBill());
      assert.ok('fields' in preview);
      assert.deepEqual(preview.fields, {}, 'a real bill has nothing to refuse');
      assert.equal(preview.billedKwh, 170);
      assert.equal(preview.registerKwh, 170);
      assert.equal(preview.willSetCpe, true, 'the meter has no CPE yet; the bill will supply it');
      assert.equal(preview.input.cpe, 'PT0002000042466003BW', 'compacted');
      // 1479 + 1255 + 1378 + 7 + 17 = 4136, which is the subtotal: nothing to warn about.
      assert.ok(!preview.warnings.some((w) => w.key === 'energy.invoice.linesDisagree'));
      // And a subtotal the lines do not reach is said, as a warning a person decides on.
      const off = await controller.file(meterId, sampleBill({ subtotalCents: 4112, vatCents: 511 }));
      assert.ok('fields' in off);
      const disagree = off.warnings.find((w) => w.key === 'energy.invoice.linesDisagree');
      assert.deepEqual(disagree?.values, { lines: 41.36, subtotal: 41.12 });

      const nothingFiled = await controller.list(meterId);
      assert.equal(nothingFiled.invoices.length, 0, 'a preview writes nothing');

      const committed = await controller.file(meterId, sampleBill({ commit: true }));
      assert.ok('id' in committed);

      const { invoices } = await controller.list(meterId);
      assert.equal(invoices.length, 1);
      assert.equal(invoices[0]?.kwh, 170, 'the billed energy, summed from the lines');
      assert.equal(invoices[0]?.days, 31);
      assert.equal(invoices[0]?.totalCents, 4623);
      assert.equal(invoices[0]?.documentTotalCents, 6664);

      const { invoice } = await controller.one(committed.id);
      assert.equal(invoice.registers.length, 3);
      assert.equal(invoice.lines.length, 5);
      assert.equal(invoice.lines[2]?.unitPrice, 0.4631, 'a unit price survives to six decimals');
      assert.equal(invoice.regulatedDifferenceCents, -572);

      const { meter } = await new EnergyController().one(meterId);
      assert.equal(meter.cpe, 'PT0002000042466003BW', 'stamped from the bill');
      assert.equal(meter.serial, '28202100272356');
    });
  });
});

test('5.3 — the same bill twice is refused, and a bill that does not add up is refused', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['maintenance'] }, async () => {
      const meterId = await actingAs(tenant, { roles: ['owner'] }, async () =>
        (await new EnergyController().create(tenant.facilityId, { name: 'Geral', kind: 'total' })).id,
      );
      const controller = new EnergyInvoicesController();

      await controller.file(meterId, sampleBill({ commit: true }));

      // Again, with the number in another case.
      const again = await controller.file(meterId, sampleBill({ invoiceNumber: 'ft2025 k3425/340041459032' }));
      assert.ok('fields' in again);
      assert.equal(again.fields['invoiceNumber'], 'energy.invoice.duplicate');
      await expectStatus(
        () => controller.file(meterId, sampleBill({ invoiceNumber: 'ft2025 k3425/340041459032', commit: true })),
        422,
      );

      // A total that is not subtotal + VAT: refused with the field named, on
      // preview and on commit alike.
      const wrong = await controller.file(meterId, sampleBill({ invoiceNumber: 'FT-2', totalCents: 4600 }));
      assert.ok('fields' in wrong);
      assert.equal(wrong.fields['totalCents'], 'energy.invoice.totalMismatch');
      await expectStatus(() => controller.file(meterId, sampleBill({ invoiceNumber: 'FT-2', totalCents: 4600, commit: true })), 422);
    });
  });
});

test('5.3 — a bill for another delivery point warns, and an instructor is refused', async () => {
  await withScratchTenant(async (tenant) => {
    const meterId = await actingAs(tenant, { roles: ['owner'] }, async () =>
      (await new EnergyController().create(tenant.facilityId, {
        name: 'Geral',
        kind: 'total',
        cpe: 'PT0002000000000009ZZ',
      })).id,
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const preview = await new EnergyInvoicesController().file(meterId, sampleBill());
      assert.ok('fields' in preview);
      const mismatch = preview.warnings.find((w) => w.key === 'energy.invoice.cpeMismatch');
      assert.ok(mismatch, 'the bill names a different CPE from the meter');
      assert.equal(mismatch.values['bill'], 'PT0002000042466003BW');
      assert.equal(mismatch.values['meter'], 'PT0002000000000009ZZ');
      assert.equal(preview.willSetCpe, false, 'never overwrites a CPE the meter already has');
    });

    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      await expectStatus(() => new EnergyInvoicesController().list(meterId), 403);
      await expectStatus(() => new EnergyInvoicesController().file(meterId, sampleBill()), 403);
    });
  });
});

test('5.3 — a second bill on the same period warns of the overlap; archiving frees the number', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { id: meterId } = await new EnergyController().create(tenant.facilityId, { name: 'Geral', kind: 'total' });
      const controller = new EnergyInvoicesController();

      const first = await controller.file(meterId, sampleBill({ commit: true }));
      assert.ok('id' in first);

      const overlapping = await controller.file(meterId, sampleBill({ invoiceNumber: 'FT-next', periodStart: '2025-11-20', periodEnd: '2025-12-20' }));
      assert.ok('fields' in overlapping);
      assert.ok(overlapping.warnings.some((w) => w.key === 'energy.invoice.periodOverlap'));

      await controller.remove(first.id);
      const { invoices } = await controller.list(meterId);
      assert.equal(invoices.length, 0);

      const refiled = await controller.file(meterId, sampleBill({ commit: true }));
      assert.ok('id' in refiled, 'an archived number is free again');
    });
  });
});

test('5.3 — the dashboard sees what energy cost, by the month a period ended in', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { id: meterId } = await new EnergyController().create(tenant.facilityId, { name: 'Geral', kind: 'total' });
      const controller = new EnergyInvoicesController();

      const empty = await controller.costs();
      assert.equal(empty.billCount, 0);
      assert.equal(empty.months.length, 12, 'twelve months whatever was filed');
      assert.equal(empty.latest, null);

      // A period ending this month, so it lands in the window whatever today is.
      const now = new Date();
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 2)).toISOString().slice(0, 10);
      await controller.file(meterId, sampleBill({ commit: true, periodStart: start, periodEnd: end, issuedOn: end, dueOn: null }));

      const costs = await controller.costs();
      assert.equal(costs.billCount, 1);
      const thisMonth = costs.months[costs.months.length - 1];
      assert.equal(thisMonth?.month, end.slice(0, 7));
      assert.equal(thisMonth?.totalCents, 4623, 'the electricity total, VAT included — not the envelope');
      assert.equal(thisMonth?.kwh, 170);
      assert.equal(thisMonth?.bills, 1);
      assert.equal(costs.months[0]?.totalCents, null, 'an empty month is null, not zero');
      assert.equal(costs.latest?.meterName, 'Geral');
      assert.equal(costs.latest?.facilityName, 'Piscina de Teste');
    });

    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      await expectStatus(() => new EnergyInvoicesController().costs(), 403);
    });
  });
});
