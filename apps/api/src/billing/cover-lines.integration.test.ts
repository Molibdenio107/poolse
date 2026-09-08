import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { FeePeriodsController, FeePlansController, StudentFeesController } from './fees.controller.js';
import { InsurancePoliciesController } from './insurance.controller.js';
import {
  actingAs,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * What a student is charged to join, and what insures them — the student half of
 * the fee-kinds slice.
 *
 * Four things earn their place here:
 *
 * **A line charged once is charged once.** An inscrição names no periodicity, so
 * `amount_cents` is the whole amount and `periodTotalCents` has to equal it. The
 * failure this catches is a €30,00 joining fee filed against an "Anual" period
 * and read back as €360,00 — which is what happens the moment somebody restores
 * the NOT NULL on `fee_period_id` to make a query simpler.
 *
 * **The pro-rata is the database's arithmetic, not the browser's.** A student
 * joining halfway through a policy pays for the half they will use, and the
 * result is snapshotted like every other agreed amount.
 *
 * **Cover is a warning, never a gate.** Nothing here refuses anything for a
 * student with no seguro; what changes is that the page and the register say so.
 *
 * **The renovação default is a server answer.** A student with a fee line in an
 * earlier season is offered the cheaper price, and both prices come back so an
 * admin can choose the other.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/** A day offset from today, as an ISO date. Noon, so no zone can shift it. */
function inDays(days: number): string {
  const day = new Date();
  day.setUTCHours(12, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

interface Club {
  policyId: string;
  seguroPlanId: string;
  inscricaoPlanId: string;
  renovacaoPlanId: string;
  studentId: string;
}

/**
 * A club with an apólice running for a year around today, and the three season
 * prices: joining, renewing, and being insured.
 */
async function club(tenant: ScratchTenant): Promise<Club> {
  const plans = new FeePlansController();

  const policyId = (
    await new InsurancePoliciesController().create(tenant.facilityId, {
      insurer: 'Fidelidade',
      policyNumber: 'AP-2026-001',
      // 365 days, starting 100 days ago — so "join today" is genuinely mid-term.
      validFrom: inDays(-100),
      validTo: inDays(264),
      costPerPersonCents: 850,
    })
  ).id;

  const seguroPlanId = (
    await plans.create(tenant.facilityId, {
      kind: 'seguro',
      amountCents: 1200,
      seasonId: tenant.seasonId,
      vatExempt: true,
    })
  ).id;

  const inscricaoPlanId = (
    await plans.create(tenant.facilityId, {
      kind: 'inscricao',
      amountCents: 3000,
      seasonId: tenant.seasonId,
      vatExempt: true,
    })
  ).id;

  const renovacaoPlanId = (
    await plans.create(tenant.facilityId, {
      kind: 'inscricao',
      amountCents: 1500,
      seasonId: tenant.seasonId,
      isRenewal: true,
      vatExempt: true,
    })
  ).id;

  const [student] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name)
     VALUES ($1, 'Ana', 'Costa') RETURNING id`,
    [tenant.organizationId],
  );

  return {
    policyId,
    seguroPlanId,
    inscricaoPlanId,
    renovacaoPlanId,
    studentId: student!.id,
  };
}

test('an inscrição is charged once, for its whole amount, with no periodicity', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { inscricaoPlanId, studentId } = await club(tenant);
      const fees = new StudentFeesController();

      // No period at all — which is what a fee paid once means.
      await fees.create(studentId, { feePlanId: inscricaoPlanId });

      const { lines } = await fees.list(studentId);
      const line = lines.find((one) => one.kind === 'inscricao');

      assert.equal(line?.periodId, null, 'a fee paid once names no frequency');
      assert.equal(line?.amountCents, 3000);
      // The failure this exists for: filed against an "Anual" period it would
      // read as 360,00 EUR.
      assert.equal(line?.periodTotalCents, 3000);
      assert.equal(line?.payableCents, 3000);
      assert.equal(line?.seasonId, tenant.seasonId, 'the season comes from the plan');
      // One occurrence, on the day it starts, rather than one a month forever.
      assert.equal(line?.currentPeriodStart, line?.startsOn);
    });
  });
});

test('a student is charged one inscrição a season, and the second is refused', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { inscricaoPlanId, renovacaoPlanId, studentId } = await club(tenant);
      const fees = new StudentFeesController();

      await fees.create(studentId, { feePlanId: inscricaoPlanId });

      // Charged twice is quiet, reaches a family as a bill, and is exactly the
      // kind of thing a double-click produces. A 409 naming the plan, not a 500 quoting an index: nothing about the
      // request is malformed and the same body would have worked a moment ago.
      await expectStatus(
        () => fees.create(studentId, { feePlanId: renovacaoPlanId }),
        409,
      );
    });
  });
});

test('a seguro line covers the policy period, and says who insures it', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { seguroPlanId, policyId, studentId } = await club(tenant);
      const fees = new StudentFeesController();

      // No dates given: the whole of the apólice's own period, which is what a
      // student joining at the start of the season gets.
      await fees.create(studentId, {
        feePlanId: seguroPlanId,
        insurancePolicyId: policyId,
      });

      const seen = await fees.list(studentId);
      const line = seen.lines.find((one) => one.kind === 'seguro');

      assert.equal(line?.coversFrom, inDays(-100));
      assert.equal(line?.coversTo, inDays(264));
      assert.equal(line?.insurerName, 'Fidelidade');
      assert.equal(line?.amountCents, 1200, 'the whole premium, nothing pro-rata about it');

      assert.equal(seen.cover.covered, true);
      assert.equal(seen.cover.lapsed, false);
      assert.equal(seen.cover.insurerName, 'Fidelidade');
    });
  });
});

test('a mid-season joiner pays for the part of the policy they will use', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { seguroPlanId, policyId, studentId } = await club(tenant);
      const fees = new StudentFeesController();

      // The policy runs 365 days; this student joins today, with 265 left.
      await fees.create(studentId, {
        feePlanId: seguroPlanId,
        insurancePolicyId: policyId,
        coversFrom: inDays(0),
        proRata: true,
      });

      const { lines } = await fees.list(studentId);
      const line = lines.find((one) => one.kind === 'seguro');

      // 1200 x 265/365, rounded once — in SQL, where the definition lives.
      assert.equal(line?.amountCents, Math.round((1200 * 265) / 365));
      assert.equal(line?.coversFrom, inDays(0));
      assert.equal(line?.coversTo, inDays(264), 'cover still ends with the policy');
    });
  });
});

test('a student with no cover is warned about and refused nothing', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { studentId, inscricaoPlanId } = await club(tenant);
      const fees = new StudentFeesController();

      const before = await fees.list(studentId);
      assert.equal(before.cover.covered, false);
      assert.equal(before.cover.lapsed, false, 'never insured is not the same as lapsed');
      assert.equal(before.cover.coversTo, null);

      // And nothing is blocked by it: the joining fee goes on as normal, which
      // is the whole point of the rule being a warning.
      await fees.create(studentId, { feePlanId: inscricaoPlanId });
      const after = await fees.list(studentId);
      assert.equal(after.lines.length, 1);
    });
  });
});

test('cover that has run out reads differently from cover that never existed', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { seguroPlanId, policyId, studentId } = await club(tenant);
      const fees = new StudentFeesController();

      // Cover that ended a fortnight ago: a renewal, not an uninsured stranger.
      await fees.create(studentId, {
        feePlanId: seguroPlanId,
        insurancePolicyId: policyId,
        coversFrom: inDays(-100),
        coversTo: inDays(-14),
      });

      const seen = await fees.list(studentId);
      assert.equal(seen.cover.covered, false);
      assert.equal(seen.cover.lapsed, true);
      assert.equal(seen.cover.coversTo, inDays(-14));
    });
  });
});

test('a returning student is offered the renovação price, and both are offered', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { inscricaoPlanId, renovacaoPlanId, studentId } = await club(tenant);
      const fees = new StudentFeesController();

      const fresh = await fees.list(studentId);
      assert.equal(fresh.inscricao.returning, false);
      assert.equal(fresh.inscricao.suggestedPlanId, inscricaoPlanId, 'the ordinary price');

      /*
       * A fee line in an *earlier* season is what "returning" means — any line,
       * not an earlier inscrição, because a club that only started charging one
       * this year would otherwise treat every long-standing family as new.
       */
      const [past] = await tenant.sql<{ id: string }>(
        `INSERT INTO season (organization_id, name, starts_on, ends_on, status)
         VALUES ($1, 'Época passada', DATE '2025-09-01', DATE '2026-07-31', 'archived')
         RETURNING id`,
        [tenant.organizationId],
      );
      const [oldPlan] = await tenant.sql<{ id: string }>(
        `INSERT INTO fee_plan
           (organization_id, facility_id, kind, amount_cents, season_id, recurrence, vat_exempt)
         VALUES ($1, $2, 'inscricao', 2800, $3, 'one_off', true) RETURNING id`,
        [tenant.organizationId, tenant.facilityId, past!.id],
      );
      await tenant.sql(
        `INSERT INTO student_fee
           (organization_id, student_id, fee_plan_id, season_id, amount_cents, starts_on)
         VALUES ($1, $2, $3, $4, 2800, DATE '2025-09-15')`,
        [tenant.organizationId, studentId, oldPlan!.id, past!.id],
      );

      const seen = await fees.list(studentId);
      assert.equal(seen.inscricao.returning, true);
      assert.equal(seen.inscricao.suggestedPlanId, renovacaoPlanId, 'the cheaper one');

      // Both are still offered, and the suggestion is a flag rather than the
      // only row: the default is a judgement an admin may overrule.
      const offered = seen.seasonCharges.filter((one) => one.kind === 'inscricao');
      assert.equal(offered.length, 2);
      assert.deepEqual(
        offered.map((one) => `${one.isRenewal}:${one.suggested}`).sort(),
        ['false:false', 'true:true'],
      );
    });
  });
});

test('a charge already made is offered as made rather than offered again', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { inscricaoPlanId, seguroPlanId, policyId, studentId } = await club(tenant);
      const fees = new StudentFeesController();

      await fees.create(studentId, { feePlanId: inscricaoPlanId });
      await fees.create(studentId, {
        feePlanId: seguroPlanId,
        insurancePolicyId: policyId,
      });

      const seen = await fees.list(studentId);
      // Both kinds are marked charged, and the renovação row is too — one
      // inscrição per student per season is the rule, whichever price it was.
      assert.equal(seen.seasonCharges.every((one) => one.hasLine), true);

      // The seguro row carries the site's apólices, so the form needs nothing
      // else to offer the choice.
      const seguro = seen.seasonCharges.find((one) => one.kind === 'seguro');
      assert.equal(seguro?.policies.length, 1);
      assert.equal(seguro?.policies[0]?.insurer, 'Fidelidade');
    });
  });
});

test('a seguro without an apólice is refused, and an apólice on a quota is too', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { seguroPlanId, policyId, studentId } = await club(tenant);
      const fees = new StudentFeesController();

      const period = (
        await new FeePeriodsController().create(tenant.facilityId, {
          name: 'Mensal',
          months: 1,
          isDefault: true,
        })
      ).id;
      const quota = (
        await new FeePlansController().create(tenant.facilityId, {
          kind: 'quota',
          amountCents: 2000,
          defaultFeePeriodId: period,
        })
      ).id;

      // Cover with nothing behind it is cover nobody can claim on.
      await expectStatus(() => fees.create(studentId, { feePlanId: seguroPlanId }), 400);

      // And an apólice on a line that is not a seguro is a column filled on the
      // wrong row — refused rather than quietly ignored.
      await expectStatus(
        () =>
          fees.create(studentId, {
            feePlanId: quota,
            feePeriodId: period,
            insurancePolicyId: policyId,
          }),
        400,
      );
    });
  });
});
