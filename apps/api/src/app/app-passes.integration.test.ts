import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AppController } from './app.controller.js';
import { PassProductsController, ReceptionController } from '../reception/passes.controller.js';
import { InvoicesController } from '../billing/invoices.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * POOLSE-204 — a family pack, who swam, and buying a pack on the phone.
 * The family rules themselves are SQL's (`packages/db/test/family-packs.sql`);
 * this file proves the desk and the phone use them.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

interface Family {
  marta: string;
  tomas: string;
  tank: string;
  familyPack: string;
  personal: string;
}

async function setup(tenant: ScratchTenant): Promise<Family> {
  const org = tenant.organizationId;
  const marta = await addMember(tenant, 'Marta', 'Mãe', ['guardian']);
  const [child] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, birth_date)
     VALUES ($1, 'Tomás', 'Filho', current_date - interval '9 years') RETURNING id`,
    [org],
  );
  await tenant.sql(
    `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
     VALUES ($1, $2, $3, 'Mãe', true)`,
    [org, child!.id, marta],
  );
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name) VALUES ($1, $2, 'Tanque') RETURNING id`,
    [org, tenant.facilityId],
  );
  return actingAs(tenant, { roles: ['owner'] }, async () => {
    const products = new PassProductsController();
    const base = { kind: 'pack', entries: 10, vatRate: 0, vatExempt: true, soldInApp: true };
    const { id: familyPack } = await products.create(tenant.facilityId, {
      ...base,
      name: 'Pack família',
      amountCents: 6000,
      shareable: true,
    });
    const { id: personal } = await products.create(tenant.facilityId, { ...base, name: 'Pack 10', amountCents: 4000 });
    return { marta, tomas: child!.id, tank: pool!.id, familyPack, personal };
  });
}

const asGuardian = <T>(tenant: ScratchTenant, who: string, fn: () => Promise<T>): Promise<T> =>
  actingAs(tenant, { membershipId: who, roles: ['guardian'] }, fn);

test('a family pack sold at the desk: parent and child each check in, named, 8 left (QA 1)', async () => {
  await withScratchTenant(async (tenant) => {
    const f = await setup(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const reception = new ReceptionController();
      const sale = await reception.sell(tenant.facilityId, { productId: f.familyPack, membershipId: f.marta });
      const [pass] = (await reception.passes(tenant.facilityId, f.marta)).passes;
      assert.equal(pass!.shared, true);
      assert.deepEqual(pass!.family.map((one) => one.name).sort(), ['Marta Mãe', 'Tomás Filho']);

      await expectStatus(() => reception.checkIn(tenant.facilityId, { passId: sale.passId, poolId: f.tank }), 409);
      await reception.checkIn(tenant.facilityId, { passId: sale.passId, poolId: f.tank, membershipId: f.marta });
      await reception.checkIn(tenant.facilityId, { passId: sale.passId, poolId: f.tank, studentId: f.tomas });
      const after = (await reception.passes(tenant.facilityId, f.marta)).passes[0]!;
      assert.equal(after.entriesLeft, 8);
      const inWater = (await reception.read(tenant.facilityId)).inWater.map((one) => one.personName).sort();
      assert.deepEqual(inWater, ['Marta Mãe', 'Tomás Filho'], 'the water lists who swam');
    });
  });
});

test('a phone pack is owed, refused at the door until paid, and one at a time (QA 3, 4, 6)', async () => {
  await withScratchTenant(async (tenant) => {
    const f = await setup(tenant);
    const key = randomUUID();
    const first = await asGuardian(tenant, f.marta, () =>
      new AppController().buyPass({ productId: f.familyPack, purchaseKey: key }),
    );
    // QA 6: the same key again is the same sale.
    const again = await asGuardian(tenant, f.marta, () =>
      new AppController().buyPass({ productId: f.familyPack, purchaseKey: key }),
    );
    assert.equal(again.invoiceId, first.invoiceId);
    assert.equal(again.repeated, true);
    const [{ n }] = (await tenant.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM invoice WHERE organization_id = $1`,
      [tenant.organizationId],
    )) as [{ n: number }];
    assert.equal(n, 1, 'one document');

    // QA 4.
    await expectStatus(
      () => asGuardian(tenant, f.marta, () => new AppController().buyPass({ productId: f.personal, purchaseKey: randomUUID() })),
      409,
    );

    const mine = await asGuardian(tenant, f.marta, () => new AppController().passes());
    assert.equal(mine.owed.length, 1);
    assert.equal(mine.owed[0]!.amountCents, 6000);
    assert.equal(mine.passes[0]!.unpaid, true);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const reception = new ReceptionController();
      // QA 3: unpaid → refused.
      await expectStatus(
        () => reception.checkIn(tenant.facilityId, { passId: first.passId, poolId: f.tank, membershipId: f.marta }),
        409,
      );
      await new InvoicesController().pay(tenant.facilityId, first.invoiceId, { amountCents: 6000 });
      await reception.checkIn(tenant.facilityId, { passId: first.passId, poolId: f.tank, studentId: f.tomas });
    });

    const paid = await asGuardian(tenant, f.marta, () => new AppController().passes());
    assert.equal(paid.owed.length, 0);
    assert.equal(paid.passes[0]!.unpaid, false);
    assert.equal(paid.passes[0]!.entriesLeft, 9);
    // Paid: the next purchase is allowed.
    await asGuardian(tenant, f.marta, () =>
      new AppController().buyPass({ productId: f.personal, purchaseKey: randomUUID() }),
    );
  });
});

test('a guardian buys a child their own pack; a family pack is never one child\'s; a stranger\'s child is a 404', async () => {
  await withScratchTenant(async (tenant) => {
    const f = await setup(tenant);
    const stranger = await addMember(tenant, 'Rui', 'Outro', ['guardian']);
    await expectStatus(
      () =>
        asGuardian(tenant, f.marta, () =>
          new AppController().buyPass({ productId: f.familyPack, studentId: f.tomas, purchaseKey: randomUUID() }),
        ),
      400,
    );
    await expectStatus(
      () =>
        asGuardian(tenant, stranger, () =>
          new AppController().buyPass({ productId: f.personal, studentId: f.tomas, purchaseKey: randomUUID() }),
        ),
      404,
    );
    await expectStatus(
      () => asGuardian(tenant, f.marta, () => new AppController().buyPass({ productId: f.personal, purchaseKey: randomUUID(), amountCents: 1 })),
      400,
    );
    const sale = await asGuardian(tenant, f.marta, () =>
      new AppController().buyPass({ productId: f.personal, studentId: f.tomas, purchaseKey: randomUUID() }),
    );
    const [row] = await tenant.sql<{ student_id: string; membership_id: string | null; payer: string }>(
      `SELECT p.student_id, p.membership_id, i.payer_membership_id AS payer
         FROM pass p JOIN invoice i ON i.id = $2 WHERE p.id = $1`,
      [sale.passId, sale.invoiceId],
    );
    assert.equal(row!.student_id, f.tomas, 'the child holds it');
    assert.equal(row!.membership_id, null);
    assert.equal(row!.payer, f.marta, 'the guardian pays');

    // The desk sees the child's pack in the guardian's panel.
    const passes = await actingAs(tenant, { roles: ['owner'] }, () => new ReceptionController().passes(tenant.facilityId, f.marta));
    assert.equal(passes.passes[0]!.holderName, 'Tomás Filho');
  });
});

test('a minor on their own login sees passes and cannot buy (QA 7); staff are refused; another club reads nothing', async () => {
  await withScratchTenant(async (tenant) => {
    const f = await setup(tenant);
    const login = await addMember(tenant, 'Tomás', 'Filho', ['student']);
    await tenant.sql(`UPDATE student SET membership_id = $1 WHERE id = $2`, [login, f.tomas]);
    await actingAs(tenant, { roles: ['owner'] }, () =>
      new ReceptionController().sell(tenant.facilityId, { productId: f.familyPack, membershipId: f.marta }),
    );

    await actingAs(tenant, { membershipId: login, roles: ['student'] }, async () => {
      const app = new AppController();
      const seen = await app.passes();
      assert.equal(seen.canBuy, false);
      assert.equal(seen.forSale.length, 0);
      assert.equal(seen.passes.length, 1, 'the family pack the child may use');
      await expectStatus(() => app.buyPass({ productId: f.personal, purchaseKey: randomUUID() }), 403);
    });

    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      await expectStatus(() => new AppController().passes(), 403);
      await expectStatus(() => new AppController().buyPass({ productId: f.personal, purchaseKey: randomUUID() }), 403);
    });

    await withScratchTenant(async (other) => {
      const theirs = await addMember(other, 'Ana', 'Fora', ['guardian']);
      await asGuardian(other, theirs, async () => {
        const seen = await new AppController().passes();
        assert.deepEqual(seen.passes, []);
        await expectStatus(
          () => new AppController().buyPass({ productId: f.personal, purchaseKey: randomUUID() }),
          404,
        );
      });
    });
  });
});

test('security: another buyer replaying a key learns nothing; an archived link cannot buy for that child', async () => {
  await withScratchTenant(async (tenant) => {
    const f = await setup(tenant);
    const other = await addMember(tenant, 'Rui', 'Outro', ['guardian']);
    const key = randomUUID();
    await asGuardian(tenant, f.marta, () => new AppController().buyPass({ productId: f.personal, purchaseKey: key }));
    await expectStatus(
      () => asGuardian(tenant, other, () => new AppController().buyPass({ productId: f.personal, purchaseKey: key })),
      409,
    );

    await tenant.sql(`UPDATE guardian_link SET archived_at = now() WHERE student_id = $1`, [f.tomas]);
    await tenant.sql(
      `INSERT INTO invoice_payment (organization_id, invoice_id, amount_cents, paid_on, source)
       SELECT organization_id, id, 4000, current_date, 'manual' FROM invoice WHERE payer_membership_id = $1`,
      [f.marta],
    );
    await expectStatus(
      () =>
        asGuardian(tenant, f.marta, () =>
          new AppController().buyPass({ productId: f.personal, studentId: f.tomas, purchaseKey: randomUUID() }),
        ),
      404,
    );
    const seen = await asGuardian(tenant, f.marta, () => new AppController().passes());
    assert.deepEqual(seen.people.map((one) => one.key), ['self'], 'the child is no longer someone to buy for');
  });
});
