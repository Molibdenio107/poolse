import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { PassProductsController, ReceptionController } from './passes.controller.js';
import { FeeCategoriesController } from '../billing/categories.controller.js';
import { PersonCategoriesController } from '../billing/person-categories.controller.js';
import { clubToday } from '../common/club-day.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * POOLSE-203 — a pass price per category, and per combination where the club
 * types one. The precedence itself is `pass_price_for()`, proven in
 * `packages/db/test/pass-price.sql` (QA 1–4); this file proves the sale uses it,
 * snapshots it, and refuses a typed amount.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

function day(offset: number): string {
  const at = new Date(`${clubToday()}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + offset);
  return at.toISOString().slice(0, 10);
}

interface Setup {
  pack: string;
  senior: string;
  socio: string;
  ana: string;
}

/** Base 40 €, Sénior 30 €; Ana holds Sénior and Sócio. */
async function setup(tenant: ScratchTenant): Promise<Setup> {
  return actingAs(tenant, { roles: ['owner'] }, async () => {
    const fees = new FeeCategoriesController();
    const senior = (await fees.create({ name: 'Sénior' })).id;
    const socio = (await fees.create({ name: 'Sócio' })).id;
    const ana = await addMember(tenant, 'Ana', 'Livre', []);
    const people = new PersonCategoriesController();
    await people.add({ membershipId: ana, categoryId: senior, proofSeenOn: day(0) });
    await people.add({ membershipId: ana, categoryId: socio, proofSeenOn: day(0) });
    const products = new PassProductsController();
    const { id: pack } = await products.create(tenant.facilityId, {
      kind: 'pack',
      name: 'Pack 10',
      entries: 10,
      amountCents: 4000,
      vatRate: 0,
      vatExempt: true,
    });
    await products.setPrice(tenant.facilityId, pack, { categoryIds: [senior], amountCents: 3000 });
    return { pack, senior, socio, ana };
  });
}

async function line(tenant: ScratchTenant, invoiceId: string): Promise<{ amount: number; names: string | null }> {
  const [row] = await tenant.sql<{ amount_cents: number; fee_category_name: string | null }>(
    `SELECT amount_cents, fee_category_name FROM invoice_line WHERE invoice_id = $1`,
    [invoiceId],
  );
  return { amount: row!.amount_cents, names: row!.fee_category_name };
}

test('Sénior and Sócio pay Sénior\'s price, then the typed combination, snapshotted (QA 1, 2, 5)', async () => {
  await withScratchTenant(async (tenant) => {
    const { pack, senior, socio, ana } = await setup(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const reception = new ReceptionController();
      const products = new PassProductsController();

      // QA 1.
      const { prices } = await reception.prices(tenant.facilityId, ana);
      assert.deepEqual(prices.find((one) => one.productId === pack), {
        productId: pack,
        amountCents: 3000,
        baseCents: 4000,
        categoryNames: 'Sénior',
      });
      const first = await reception.sell(tenant.facilityId, { productId: pack, membershipId: ana });
      assert.deepEqual(await line(tenant, first.invoiceId), { amount: 3000, names: 'Sénior' });

      // QA 2.
      await products.setPrice(tenant.facilityId, pack, { categoryIds: [socio, senior], amountCents: 2700 });
      const second = await reception.sell(tenant.facilityId, { productId: pack, membershipId: ana });
      assert.deepEqual(await line(tenant, second.invoiceId), { amount: 2700, names: 'Sénior + Sócio' });

      // QA 5: the table changes; sold lines do not. The same set again changes its amount.
      await products.setPrice(tenant.facilityId, pack, { categoryIds: [senior, socio], amountCents: 2500 });
      await products.setPrice(tenant.facilityId, pack, { categoryIds: [senior], amountCents: 1000 });
      assert.deepEqual(await line(tenant, first.invoiceId), { amount: 3000, names: 'Sénior' });
      assert.deepEqual(await line(tenant, second.invoiceId), { amount: 2700, names: 'Sénior + Sócio' });
      const [{ n }] = (await tenant.sql<{ n: number }>(
        `SELECT count(*)::int AS n FROM pass_product_price WHERE product_id = $1 AND archived_at IS NULL`,
        [pack],
      )) as [{ n: number }];
      assert.equal(n, 2, 'one live price per exact set');

      // The payment matches the line: the document is settled at the counter.
      const [paid] = await tenant.sql<{ amount_cents: number }>(
        `SELECT amount_cents FROM invoice_payment WHERE invoice_id = $1`,
        [second.invoiceId],
      );
      assert.equal(paid!.amount_cents, 2700);
    });
  });
});

test('an expired Sénior pays the base, and the list shows the price table (QA 4)', async () => {
  await withScratchTenant(async (tenant) => {
    const { pack, ana } = await setup(tenant);
    await tenant.sql(
      `UPDATE person_category SET proof_seen_on = club_today() - 400, valid_until = club_today() - 1
        WHERE membership_id = $1`,
      [ana],
    );
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const sale = await new ReceptionController().sell(tenant.facilityId, { productId: pack, membershipId: ana });
      assert.deepEqual(await line(tenant, sale.invoiceId), { amount: 4000, names: null });
      const { products } = await new PassProductsController().list(tenant.facilityId);
      const listed = products.find((one) => one.id === pack)!;
      assert.deepEqual(listed.prices.map((one) => [one.categoryNames, one.amountCents]), [[['Sénior'], 3000]]);
    });
  });
});

test('a typed amount is a 422; the base-price override is audited (QA 6)', async () => {
  await withScratchTenant(async (tenant) => {
    const { pack, ana } = await setup(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const reception = new ReceptionController();
      await expectStatus(
        () => reception.sell(tenant.facilityId, { productId: pack, membershipId: ana, amountCents: 100 }),
        422,
      );
      const sale = await reception.sell(tenant.facilityId, { productId: pack, membershipId: ana, basePrice: true });
      assert.deepEqual(await line(tenant, sale.invoiceId), { amount: 4000, names: null });
    });
    const [audit] = await tenant.sql<{ data: { basePriceOverride?: { resolvedCents: number } } }>(
      `SELECT data FROM audit_log
        WHERE organization_id = $1 AND action = 'pass.sold'
        ORDER BY created_at DESC LIMIT 1`,
      [tenant.organizationId],
    );
    assert.equal(audit!.data.basePriceOverride?.resolvedCents, 3000);
  });
});

test('prices are the office\'s; another club\'s category or product is refused', async () => {
  await withScratchTenant(async (tenant) => {
    const { pack, senior, ana } = await setup(tenant);
    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      await expectStatus(
        () => new PassProductsController().setPrice(tenant.facilityId, pack, { categoryIds: [senior], amountCents: 1 }),
        403,
      );
      await expectStatus(() => new ReceptionController().prices(tenant.facilityId, ana), 403);
    });
    await withScratchTenant(async (other) => {
      await actingAs(other, { roles: ['owner'] }, async () => {
        const products = new PassProductsController();
        const { id: theirs } = await products.create(other.facilityId, {
          kind: 'single',
          name: 'Entrada',
          amountCents: 500,
          vatRate: 0,
          vatExempt: true,
        });
        await expectStatus(() => products.setPrice(other.facilityId, theirs, { categoryIds: [senior], amountCents: 1 }), 400);
        await expectStatus(() => products.setPrice(tenant.facilityId, pack, { categoryIds: [senior], amountCents: 1 }), 404);
        await expectStatus(() => new ReceptionController().prices(other.facilityId, ana), 404);
      });
    });
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const products = new PassProductsController();
      await expectStatus(() => products.setPrice(tenant.facilityId, pack, { categoryIds: [], amountCents: 1 }), 400);
      await expectStatus(
        () => products.setPrice(tenant.facilityId, pack, { categoryIds: [senior, senior], amountCents: 1 }),
        400,
      );
      const price = (await products.list(tenant.facilityId)).products.find((one) => one.id === pack)!.prices[0]!;
      await products.archivePrice(tenant.facilityId, pack, price.id);
      const { prices } = await new ReceptionController().prices(tenant.facilityId, ana);
      assert.equal(prices.find((one) => one.productId === pack)!.amountCents, 4000);
    });
  });
});
