import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { FeePeriodsController, FeePlansController, StudentFeesController } from './fees.controller.js';
import { familyFees } from './family-fees.repository.js';
import { actingAs, closeHarness, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * POOLSE-187 — an older unpaid period stays owed, and a line owes only from the
 * month it was entered.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

const AMOUNT = 3500;

/** The first day of the month `back` months ago, in the club's calendar. */
function monthsAgo(back: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(new Date());
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return new Date(Date.UTC(year, month - 1 - back, 1)).toISOString().slice(0, 10);
}

interface Line {
  student: string;
  line: string;
}

/** A monthly line of 35,00 € begun three months ago. `enteredBack` is when somebody typed it in. */
async function monthlyLine(tenant: ScratchTenant, enteredBack: number): Promise<Line> {
  const [level] = await tenant.sql<{ id: string }>(
    `INSERT INTO student_level (organization_id, name, sort_order) VALUES ($1, 'Iniciação', 1) RETURNING id`,
    [tenant.organizationId],
  );
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name) VALUES ($1, 'Duarte', 'Melo') RETURNING id`,
    [tenant.organizationId],
  );
  const student = row!.id;
  await tenant.sql(`UPDATE facility SET payment_due_day = 1 WHERE organization_id = $1`, [tenant.organizationId]);
  await actingAs(tenant, { roles: ['owner'] }, async () => {
    const period = await new FeePeriodsController().create(tenant.facilityId, { name: 'Mensal', months: 1, isDefault: true });
    const plan = await new FeePlansController().create(tenant.facilityId, {
      kind: 'mensalidade',
      levelId: level!.id,
      lessonsPerWeek: 2,
      amountCents: AMOUNT,
    });
    await new StudentFeesController().create(student, {
      feePlanId: plan.id,
      feePeriodId: period.id,
      startsOn: monthsAgo(3),
    });
  });
  const [line] = await tenant.sql<{ id: string }>(
    `UPDATE student_fee SET created_at = $2::date WHERE student_id = $1 RETURNING id`,
    [student, monthsAgo(enteredBack)],
  );
  return { student, line: line!.id };
}

const read = (tenant: ScratchTenant, student: string) =>
  actingAs(tenant, { roles: ['owner'] }, () => new StudentFeesController().list(student));

test('187 QA 1 — every unpaid period up to the current one is owed, on every reader', async () => {
  await withScratchTenant(async (tenant) => {
    const { student, line } = await monthlyLine(tenant, 3);
    await actingAs(tenant, { roles: ['owner'] }, () =>
      new StudentFeesController().paid(student, line, { isPaid: true, periodStart: monthsAgo(3) }),
    );
    const fees = await read(tenant, student);
    assert.deepEqual(fees.lines[0]!.olderUnpaid.map((one) => one.periodStart), [monthsAgo(2), monthsAgo(1)]);
    assert.equal(fees.balance.outstandingCents, 3 * AMOUNT, 'two older months and the current one');

    const family = await familyFees(tenant.organizationId, { id: student, name: 'Duarte' }, []);
    assert.ok(
      [monthsAgo(2), monthsAgo(1)].every((month) => family.overdue.some((one) => one.periodStart === month)),
      'Pagamentos lists each older month',
    );
  });
});

test('187 QA 2 — paying an older period takes it out, and the figure falls', async () => {
  await withScratchTenant(async (tenant) => {
    const { student, line } = await monthlyLine(tenant, 3);
    const before = (await read(tenant, student)).balance.outstandingCents;
    await actingAs(tenant, { roles: ['owner'] }, () =>
      new StudentFeesController().paid(student, line, { isPaid: true, periodStart: monthsAgo(2) }),
    );
    const after = await read(tenant, student);
    assert.equal(after.balance.outstandingCents, before - AMOUNT);
    assert.ok(!after.lines[0]!.olderUnpaid.some((one) => one.periodStart === monthsAgo(2)));
  });
});

test('187 QA 3 — an ended line still owes every unpaid period up to its end', async () => {
  await withScratchTenant(async (tenant) => {
    const { student, line } = await monthlyLine(tenant, 3);
    await tenant.sql(`UPDATE student_fee SET ends_on = $2::date - 1 WHERE id = $1`, [line, monthsAgo(0)]);
    const { lines, balance } = await read(tenant, student);
    assert.equal(lines[0]!.currentPeriodStart, null);
    assert.equal(lines[0]!.olderUnpaid.length, 3);
    assert.equal(balance.outstandingCents, 3 * AMOUNT);
  });
});

test('187 QA 5 — a line owes only from the month it was entered', async () => {
  await withScratchTenant(async (tenant) => {
    const { student } = await monthlyLine(tenant, 0);
    const { lines, balance } = await read(tenant, student);
    assert.deepEqual(lines[0]!.olderUnpaid, []);
    assert.equal(balance.outstandingCents, AMOUNT);
  });
});

test('187 — a line entered mid-way owes from that month, not from its start', async () => {
  await withScratchTenant(async (tenant) => {
    const { student } = await monthlyLine(tenant, 1);
    const { lines } = await read(tenant, student);
    assert.deepEqual(lines[0]!.olderUnpaid.map((one) => one.periodStart), [monthsAgo(1)]);
  });
});
