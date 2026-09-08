import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { FeePeriodsController, FeePlansController } from './fees.controller.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * Four kinds on one price list — the fee-kinds slice, against a real database.
 *
 * The kinds land before invoicing (2.2) does, because an invoice line will carry
 * one and adding a kind afterwards means rewriting lines that have already been
 * sent. What these hold still is the shape of each kind: the API is where the
 * *defaults* live and the database is where the *rules* do, and the two have to
 * agree about which is which.
 *
 * Three are worth more than the rest:
 *
 * **The renovação pair.** One season holds a joining price and a cheaper price
 * for a family coming back, and refuses a third of either. `is_renewal` is in
 * the unique key rather than excluded from it, which is exactly what makes both
 * halves true.
 *
 * **A one-off does not carry a periodicity.** An annual price with a three-month
 * period beside it is a contradiction that something eventually reads; the API
 * drops the pair rather than saving it and letting the CHECK refuse the row.
 *
 * **Isento is not 23 % that nobody charged.** Two different statements, and an
 * invoice has to make one of them.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/** A second season, so "per season" can be told from "per facility". */
async function nextSeason(tenant: ScratchTenant): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO season (organization_id, name, starts_on, ends_on, status)
     VALUES ($1, 'Época seguinte', DATE '2027-09-01', DATE '2028-07-31', 'draft')
     RETURNING id`,
    [tenant.organizationId],
  );
  return row!.id;
}

test('an inscrição is one-off, belongs to a season, and has a renovação beside it', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const plans = new FeePlansController();

      await plans.create(tenant.facilityId, {
        kind: 'inscricao',
        amountCents: 3000,
        seasonId: tenant.seasonId,
        vatExempt: true,
      });
      await plans.create(tenant.facilityId, {
        kind: 'inscricao',
        amountCents: 1500,
        seasonId: tenant.seasonId,
        isRenewal: true,
        vatExempt: true,
      });

      const { plans: list } = await plans.list(tenant.facilityId);
      const inscricoes = list.filter((plan) => plan.kind === 'inscricao');

      assert.deepEqual(
        inscricoes.map((plan) => `${plan.amountCents}:${plan.isRenewal}:${plan.recurrence}`),
        // One-off is the default for the kind: nobody had to say it.
        ['3000:false:one_off', '1500:true:one_off'],
      );

      // And the season it belongs to comes back named, so the list can say it
      // without a second round trip.
      assert.equal(inscricoes[0]?.seasonId, tenant.seasonId);
      assert.ok((inscricoes[0]?.seasonName ?? '').length > 0);
    });
  });
});

test('a season takes one joining price and one renovação, and refuses a third', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const plans = new FeePlansController();

      await plans.create(tenant.facilityId, {
        kind: 'inscricao',
        amountCents: 3000,
        seasonId: tenant.seasonId,
        vatExempt: true,
      });

      // A 409 naming the season, not a 500: nothing about the request is
      // malformed, and the same body would have been accepted a moment before.
      await expectStatus(
        () =>
          plans.create(tenant.facilityId, {
            kind: 'inscricao',
            amountCents: 3200,
            seasonId: tenant.seasonId,
            vatExempt: true,
          }),
        409,
      );

      // The next season's is a different row and perfectly ordinary.
      const other = await nextSeason(tenant);
      await plans.create(tenant.facilityId, {
        kind: 'inscricao',
        amountCents: 3200,
        seasonId: other,
        vatExempt: true,
      });

      const { plans: list } = await plans.list(tenant.facilityId);
      assert.equal(list.filter((plan) => plan.kind === 'inscricao').length, 2);
    });
  });
});

test('an inscrição with no season is refused by name, not by constraint', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      // The table refuses this too. It is refused here as well so the operator
      // gets a sentence naming the box to fill rather than a constraint name.
      await expectStatus(
        () =>
          new FeePlansController().create(tenant.facilityId, {
            kind: 'inscricao',
            amountCents: 3000,
            vatExempt: true,
          }),
        400,
      );
    });
  });
});

test('a seguro defaults to annual and to isento, and drops a periodicity it cannot use', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const period = (
        await new FeePeriodsController().create(tenant.facilityId, {
          name: 'Trimestral',
          months: 3,
        })
      ).id;

      const plans = new FeePlansController();
      await plans.create(tenant.facilityId, {
        kind: 'seguro',
        amountCents: 1200,
        seasonId: tenant.seasonId,
        vatExempt: true,
        // Sent, and meaningless on an annual price. Dropped rather than saved:
        // the pair would be read by something eventually.
        defaultFeePeriodId: period,
      });

      const { plans: list } = await plans.list(tenant.facilityId);
      const seguro = list.find((plan) => plan.kind === 'seguro');

      assert.equal(seguro?.recurrence, 'annual');
      assert.equal(seguro?.defaultFeePeriodId, null);
      assert.equal(seguro?.vatExempt, true);
      assert.equal(seguro?.vatRate, 0);
    });
  });
});

test('isento is not a rate of 23 % that nobody charged', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const plans = new FeePlansController();

      // Both sent. Isento wins and the rate goes to zero, because a rate kept
      // beside an exemption is a number nobody charged sitting exactly where
      // invoicing will look for one.
      await plans.create(tenant.facilityId, {
        kind: 'seguro',
        amountCents: 1200,
        seasonId: tenant.seasonId,
        vatExempt: true,
        vatRate: 23,
      });

      const other = await nextSeason(tenant);
      await plans.create(tenant.facilityId, {
        kind: 'seguro',
        amountCents: 1300,
        seasonId: other,
        vatExempt: false,
        vatRate: 23,
      });

      const { plans: list } = await plans.list(tenant.facilityId);
      const seguros = list.filter((plan) => plan.kind === 'seguro');

      assert.deepEqual(
        seguros.map((plan) => `${plan.vatExempt}:${plan.vatRate}`).sort(),
        ['false:23', 'true:0'],
      );
    });
  });
});

test('the mensalidade and the quota are untouched by the wider list', async () => {
  // The compatibility half of the slice: every existing plan keeps its kind, its
  // amount and its periodicity, and the student page goes on behaving as it did.
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const [level] = await tenant.sql<{ id: string }>(
        `INSERT INTO student_level (organization_id, name, sort_order)
         VALUES ($1, 'Iniciação', 1) RETURNING id`,
        [tenant.organizationId],
      );
      const mensal = (
        await new FeePeriodsController().create(tenant.facilityId, {
          name: 'Mensal',
          months: 1,
          isDefault: true,
        })
      ).id;

      const plans = new FeePlansController();
      await plans.create(tenant.facilityId, {
        kind: 'mensalidade',
        levelId: level!.id,
        lessonsPerWeek: 2,
        amountCents: 3500,
        defaultFeePeriodId: mensal,
      });
      await plans.create(tenant.facilityId, {
        kind: 'quota',
        amountCents: 2000,
        ageBand: 'under_18',
        defaultFeePeriodId: mensal,
      });

      const { plans: list } = await plans.list(tenant.facilityId);

      assert.deepEqual(
        list.map((plan) => `${plan.kind}:${plan.recurrence}:${plan.amountCents}`),
        // Both charged by the periodicity list, which is what they always were.
        ['mensalidade:periodicity:3500', 'quota:periodicity:2000'],
      );
      assert.equal(list.every((plan) => plan.seasonId === null), true);
    });
  });
});

test('an instructor cannot read or price the new kinds either', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await new FeePlansController().create(tenant.facilityId, {
        kind: 'inscricao',
        amountCents: 3000,
        seasonId: tenant.seasonId,
        vatExempt: true,
      });
    });

    const instructor = await addMember(tenant, 'Rita', 'Instrutora', ['instructor']);

    await actingAs(tenant, { membershipId: instructor, roles: ['instructor'] }, async () => {
      // Reading as well as writing. What the club charges to join is a
      // commercial fact, and hiding the panel is never the control.
      await expectStatus(() => new FeePlansController().list(tenant.facilityId), 403);
      await expectStatus(
        () =>
          new FeePlansController().create(tenant.facilityId, {
            kind: 'seguro',
            amountCents: 1200,
            seasonId: tenant.seasonId,
            vatExempt: true,
          }),
        403,
      );
    });
  });
});
