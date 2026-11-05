import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { AppController } from './app.controller.js';
import { InvoicesController } from '../billing/invoices.controller.js';
import { clubToday } from '../common/club-day.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * POOLSE-178 — *Pagamentos*: what is due, what is coming and what is settled,
 * from the fee read the office's page uses, for the reader's own children only.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

interface Family {
  guardian: string;
  child: string;
  other: string;
  planId: string;
  periodId: string;
}

async function seed(tenant: ScratchTenant): Promise<Family> {
  const org = tenant.organizationId;
  const guardian = await addMember(tenant, 'Marta', 'Silva', ['guardian']);
  await tenant.sql(`UPDATE membership SET tax_number = '123456789' WHERE id = $1`, [guardian]);
  const student = async (first: string): Promise<string> => {
    const [row] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name) VALUES ($1, $2, 'Silva') RETURNING id`,
      [org, first],
    );
    return row!.id;
  };
  const child = await student('Alice');
  const other = await student('Bruna');
  await tenant.sql(
    `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
     VALUES ($1, $2, $3, 'Mãe', true)`,
    [org, child, guardian],
  );
  const [level] = await tenant.sql<{ id: string }>(
    `INSERT INTO student_level (organization_id, name, sort_order) VALUES ($1, 'Iniciação', 1) RETURNING id`,
    [org],
  );
  const [period] = await tenant.sql<{ id: string }>(
    `INSERT INTO fee_period (organization_id, facility_id, name, months, is_default, sort_order)
     VALUES ($1, $2, 'Mensal', 1, true, 1) RETURNING id`,
    [org, tenant.facilityId],
  );
  const [plan] = await tenant.sql<{ id: string }>(
    `INSERT INTO fee_plan (organization_id, facility_id, kind, level_id, lessons_per_week, amount_cents, vat_exempt)
     VALUES ($1, $2, 'mensalidade', $3, 2, 4500, true) RETURNING id`,
    [org, tenant.facilityId, level!.id],
  );
  return { guardian, child, other, planId: plan!.id, periodId: period!.id };
}

/** A monthly line for a student, starting `monthsAgo` months back on the first. */
async function monthlyLine(tenant: ScratchTenant, family: Family, student: string, monthsAgo: number): Promise<string> {
  const [line] = await tenant.sql<{ id: string }>(
    `INSERT INTO student_fee (organization_id, student_id, fee_plan_id, fee_period_id, amount_cents, starts_on)
     VALUES ($1, $2, $3, $4, 4500, date_trunc('month', club_today() - make_interval(months => $5))::date)
     RETURNING id`,
    [tenant.organizationId, student, family.planId, family.periodId, monthsAgo],
  );
  return line!.id;
}

const asGuardian = <T>(tenant: ScratchTenant, family: Family, fn: () => Promise<T>): Promise<T> =>
  actingAs(tenant, { membershipId: family.guardian, roles: ['guardian'] }, fn);

test('what is coming is the next occurrences by due date, at the agreed amount (QA 1)', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    await monthlyLine(tenant, family, family.child, 0);

    const { children } = await asGuardian(tenant, family, () => new AppController().fees());
    assert.equal(children.length, 1);
    const fees = children[0]!;
    assert.equal(fees.upcoming.length + fees.overdue.length >= 3, true);
    assert.equal(fees.upcoming.length, 3);
    for (const row of fees.upcoming) assert.equal(row.amountCents, 4500);
    const dues = fees.upcoming.map((row) => row.dueOn ?? '');
    assert.deepEqual(dues, [...dues].sort(), 'soonest first');
    assert.equal(new Set(fees.upcoming.map((row) => row.periodStart)).size, 3, 'three different months');
  });
});

test('a settled period leaves what is coming and shows under Pagos, with no amount', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    const line = await monthlyLine(tenant, family, family.child, 0);
    await tenant.sql(
      `INSERT INTO student_fee_payment (organization_id, student_fee_id, period_start, paid_on)
       VALUES ($1, $2, date_trunc('month', club_today())::date, club_today())`,
      [tenant.organizationId, line],
    );
    const fees = (await asGuardian(tenant, family, () => new AppController().fees())).children[0]!;
    const month = `${clubToday().slice(0, 7)}-01`;
    assert.equal(fees.upcoming.some((row) => row.periodStart === month), false);
    assert.equal(fees.paid[0]!.periodStart, month);
    assert.equal('amountCents' in fees.paid[0]!, false, 'a payment records no amount');
  });
});

test('nothing owed still answers every section, empty', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    const fees = (await asGuardian(tenant, family, () => new AppController().fees())).children[0]!;
    assert.deepEqual([fees.overdue, fees.upcoming, fees.paid], [[], [], []]);
    assert.equal(fees.payTo, null);
  });
});

test('nothing the office decided with reaches a family', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    const line = await monthlyLine(tenant, family, family.child, 0);
    await tenant.sql(
      `UPDATE student_fee SET line_discount_percent = 10, discount_reason = 'Motivo interno do clube' WHERE id = $1`,
      [line],
    );
    const answer = await asGuardian(tenant, family, () => new AppController().fees());
    assert.doesNotMatch(JSON.stringify(answer), /Motivo interno/);
  });
});

test('siblings on one invoice say so, and it names only the reader’s own children (QA 4)', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    await tenant.sql(
      `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
       VALUES ($1, $2, $3, 'Mãe', true)`,
      [tenant.organizationId, family.other, family.guardian],
    );
    await monthlyLine(tenant, family, family.child, 0);
    await monthlyLine(tenant, family, family.other, 0);

    const month = `${clubToday().slice(0, 7)}-01`;
    const due = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const run = await actingAs(tenant, { roles: ['owner'] }, () =>
      new InvoicesController().issue(tenant.facilityId, { periodStart: month, dueOn: due }),
    );
    assert.equal(run.drafts.length, 1, 'one document for one payer');

    const { children } = await asGuardian(tenant, family, () => new AppController().fees());
    const alice = children.find((one) => one.id === family.child)!;
    const row = [...alice.overdue, ...alice.upcoming].find((one) => one.periodStart === month)!;
    assert.equal(row.sharedWith.length, 1);
    assert.match(row.sharedWith[0]!, /Bruna/);
  });
});

test('another family’s child is a 404, and staff are refused (QA 5)', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    await expectStatus(() => asGuardian(tenant, family, () => new AppController().fees(family.other)), 404);
    await expectStatus(() => actingAs(tenant, { roles: ['instructor'] }, () => new AppController().fees()), 403);
  });
});
