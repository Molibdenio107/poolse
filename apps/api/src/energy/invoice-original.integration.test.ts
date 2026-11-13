import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { EnergyInvoicesController } from './invoices.controller.js';
import { RULES } from '../files/files.repository.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * A bill keeps its original — Rui, 12-11-2026.
 *
 * The file is a `stored_file` of purpose `energy_invoice`; a bill points at it.
 * Whoever reads bills (owner, admin, maintenance) may open and attach it, and a
 * file of any other purpose is refused, so a club's insurance policy can never be passed
 * off as a bill.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

async function file(tenant: ScratchTenant, purpose: string): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO stored_file (organization_id, purpose, storage_key, content_type, byte_size, original_name, uploaded_by)
     VALUES ($1::uuid, $2::file_purpose, $1::text || '/' || gen_random_uuid()::text, 'application/pdf', 1234, 'fatura.pdf', $3) RETURNING id`,
    [tenant.organizationId, purpose, tenant.ownerMembershipId],
  );
  return row!.id;
}

async function bill(tenant: ScratchTenant): Promise<string> {
  const [meter] = await tenant.sql<{ id: string }>(
    `INSERT INTO energy_meter (organization_id, facility_id, name) VALUES ($1, $2, 'Geral') RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO energy_invoice (organization_id, meter_id, supplier, invoice_number, issued_on, period_start,
                                 period_end, subtotal_cents, vat_cents, total_cents, document_total_cents)
     VALUES ($1, $2, 'EDP', 'FT 9', '2026-10-31', '2026-10-01', '2026-10-31', 1000, 230, 1230, 1230) RETURNING id`,
    [tenant.organizationId, meter!.id],
  );
  return row!.id;
}

test('the original is read and filed by the energy roles', () => {
  assert.deepEqual([...RULES.energy_invoice.read].sort(), ['admin', 'maintenance', 'owner']);
  assert.deepEqual([...(RULES.energy_invoice.write ?? [])].sort(), ['admin', 'maintenance', 'owner']);
});

test('maintenance attaches an original to a bill on record, and the bill shows it', async () => {
  await withScratchTenant(async (tenant) => {
    const invoiceId = await bill(tenant);
    const original = await file(tenant, 'energy_invoice');
    await actingAs(tenant, { roles: ['maintenance'] }, async () => {
      const bills = new EnergyInvoicesController();
      assert.deepEqual(await bills.attachOriginal(invoiceId, { fileId: original }), { saved: true });
      assert.equal((await bills.one(invoiceId)).invoice.originalFileId, original);
    });
  });
});

test('a file of another purpose is refused, and an instructor attaches nothing', async () => {
  await withScratchTenant(async (tenant) => {
    const invoiceId = await bill(tenant);
    const idScan = await file(tenant, 'policy_document');
    const original = await file(tenant, 'energy_invoice');
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await expectStatus(() => new EnergyInvoicesController().attachOriginal(invoiceId, { fileId: idScan }), 400);
    });
    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      await expectStatus(() => new EnergyInvoicesController().attachOriginal(invoiceId, { fileId: original }), 403);
    });
    const [row] = await tenant.sql<{ original_file_id: string | null }>(
      `SELECT original_file_id FROM energy_invoice WHERE id = $1`,
      [invoiceId],
    );
    assert.equal(row!.original_file_id, null);
  });
});

test('a bill that has its original keeps it: maintenance may not replace it, the office may (13-11-2026)', async () => {
  await withScratchTenant(async (tenant) => {
    const invoiceId = await bill(tenant);
    const first = await file(tenant, 'energy_invoice');
    const second = await file(tenant, 'energy_invoice');
    await actingAs(tenant, { roles: ['maintenance'] }, async () => {
      const bills = new EnergyInvoicesController();
      assert.deepEqual(await bills.attachOriginal(invoiceId, { fileId: first }), { saved: true });
      await expectStatus(() => bills.attachOriginal(invoiceId, { fileId: second }), 403);
      assert.equal((await bills.one(invoiceId)).invoice.originalFileId, first, 'the first stays');
    });
    await actingAs(tenant, { roles: ['admin'] }, async () => {
      const bills = new EnergyInvoicesController();
      assert.deepEqual(await bills.attachOriginal(invoiceId, { fileId: second }), { saved: true });
      assert.equal((await bills.one(invoiceId)).invoice.originalFileId, second);
    });
  });
});
