import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { FeePlansController } from './fees.controller.js';
import { InsurancePoliciesController } from './insurance.controller.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * The apólice a club holds — the facility's half of the seguro.
 *
 * The two worth more than the rest:
 *
 * **The renewal warning is derived on the server.** `daysToExpiry` comes out of
 * SQL against the database's own `current_date`, and the two booleans are built
 * from it in one place. A browser recomputing it would be a second
 * implementation of one rule against a clock that is not the club's, and the two
 * agree until the day they do not.
 *
 * **A policy somebody is covered by is not filed away by accident.** Archiving
 * it would leave cover lines pointing at a policy no screen lists, which reads
 * on the student page as insurance that came from nowhere. Refused with the
 * count, so the operator knows the size of what they were about to do.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/** `days` from today, as an ISO date. Noon, so no zone can shift the day. */
function inDays(days: number): string {
  const day = new Date();
  day.setUTCHours(12, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

function policy(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    insurer: 'Fidelidade',
    policyNumber: 'AP-2026-001',
    validFrom: inDays(-30),
    validTo: inDays(300),
    costPerPersonCents: 850,
    ...overrides,
  };
}

test('a club records an apólice, and it comes back with its own expiry', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const policies = new InsurancePoliciesController();
      await policies.create(tenant.facilityId, policy({ notes: 'Inclui deslocações' }));

      const { policies: list } = await policies.list(tenant.facilityId);
      const held = list[0];

      assert.equal(held?.insurer, 'Fidelidade');
      assert.equal(held?.policyNumber, 'AP-2026-001');
      assert.equal(held?.costPerPersonCents, 850);
      assert.equal(held?.notes, 'Inclui deslocações');
      // The dates survive as days rather than as instants: a `date` parsed into
      // a Date is midnight UTC, which is the day before west of Greenwich.
      assert.equal(held?.validTo, inDays(300));
      assert.equal(held?.expired, false);
      assert.equal(held?.renewalDue, false);
      assert.equal(held?.coveredCount, 0);
    });
  });
});

test('a policy close to its end says so, and one that has passed says that instead', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const policies = new InsurancePoliciesController();

      // Inside the sixty-day window, which is a renewal conversation rather
      // than a scramble.
      await policies.create(
        tenant.facilityId,
        policy({ policyNumber: 'AP-SOON', validFrom: inDays(-300), validTo: inDays(20) }),
      );
      await policies.create(
        tenant.facilityId,
        policy({ policyNumber: 'AP-GONE', validFrom: inDays(-400), validTo: inDays(-5) }),
      );

      const { policies: list } = await policies.list(tenant.facilityId);
      const byNumber = new Map(list.map((row) => [row.policyNumber, row]));

      assert.equal(byNumber.get('AP-SOON')?.renewalDue, true);
      assert.equal(byNumber.get('AP-SOON')?.expired, false);
      assert.equal(byNumber.get('AP-SOON')?.daysToExpiry, 20);

      // Lapsed is not "due for renewal": one is a reminder and the other is a
      // club whose swimmers are uninsured today.
      assert.equal(byNumber.get('AP-GONE')?.expired, true);
      assert.equal(byNumber.get('AP-GONE')?.renewalDue, false);
      assert.equal(byNumber.get('AP-GONE')?.daysToExpiry, -5);
    });
  });
});

test('a policy that ends before it starts is refused by name', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      // The table refuses it too. Said here as well so the message can point at
      // the field rather than at "insurance_policy_dates_ordered".
      await expectStatus(
        () =>
          new InsurancePoliciesController().create(
            tenant.facilityId,
            policy({ validFrom: inDays(100), validTo: inDays(10) }),
          ),
        400,
      );
    });
  });
});

test('the same policy number twice is a 409, not a 500', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const policies = new InsurancePoliciesController();
      await policies.create(tenant.facilityId, policy());

      await expectStatus(
        () => policies.create(tenant.facilityId, policy({ insurer: 'Outra' })),
        409,
      );
    });
  });
});

/** A student covered by the policy, which is what makes archiving it a decision. */
async function coverOneStudent(tenant: ScratchTenant, policyId: string): Promise<void> {
  const planId = (
    await new FeePlansController().create(tenant.facilityId, {
      kind: 'seguro',
      amountCents: 1200,
      seasonId: tenant.seasonId,
      vatExempt: true,
    })
  ).id;

  const [student] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name)
     VALUES ($1, 'Ana', 'Costa') RETURNING id`,
    [tenant.organizationId],
  );
  const [period] = await tenant.sql<{ id: string }>(
    `INSERT INTO fee_period (organization_id, facility_id, name, months)
     VALUES ($1, $2, 'Anual', 12) RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );

  await tenant.sql(
    `INSERT INTO student_fee
       (organization_id, student_id, fee_plan_id, fee_period_id, season_id,
        insurance_policy_id, covers_from, covers_to, amount_cents)
     VALUES ($1, $2, $3, $4, $5, $6, current_date, current_date + 300, 1200)`,
    [
      tenant.organizationId,
      student!.id,
      planId,
      period!.id,
      tenant.seasonId,
      policyId,
    ],
  );
}

test('a policy somebody is covered by is not archived, and the refusal counts them', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const policies = new InsurancePoliciesController();
      const id = (await policies.create(tenant.facilityId, policy())).id;

      await coverOneStudent(tenant, id);

      const { policies: covering } = await policies.list(tenant.facilityId);
      assert.equal(covering[0]?.coveredCount, 1);

      await expectStatus(() => policies.archive(tenant.facilityId, id), 409);

      // And it is still there, because a refused archive leaves the club exactly
      // as it was rather than half-filed.
      const { policies: after } = await policies.list(tenant.facilityId);
      assert.equal(after.length, 1);
    });
  });
});

test('an instructor cannot read or write the club apólices', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await new InsurancePoliciesController().create(tenant.facilityId, policy());
    });

    const instructor = await addMember(tenant, 'Rita', 'Instrutora', ['instructor']);

    await actingAs(tenant, { membershipId: instructor, roles: ['instructor'] }, async () => {
      // What the club pays its insurer is a commercial fact, like the price
      // list beside it. Enforced on the endpoint, not by the panel not drawing.
      await expectStatus(
        () => new InsurancePoliciesController().list(tenant.facilityId),
        403,
      );
      await expectStatus(
        () => new InsurancePoliciesController().create(tenant.facilityId, policy()),
        403,
      );
    });
  });
});
