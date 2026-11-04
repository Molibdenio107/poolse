import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { InvoicesController } from './invoices.controller.js';
import { StudentFeesController } from './fees.controller.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * An occurrence invoiced outside Poolse — POOLSE-163, against the real database.
 *
 * Marked with the external document's number, it is charged for
 * `invoice_charged_on()` (so the monthly run leaves it out and counts it apart)
 * and settled for the fee read; archived, the run offers it again. An occurrence
 * already on a Poolse document refuses the mark.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

function inDays(days: number): string {
  const day = new Date();
  day.setUTCHours(12, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** One student, one monthly mensalidade from September. */
async function aFee(tenant: ScratchTenant): Promise<{ studentId: string; feeId: string }> {
  const [level] = await tenant.sql<{ id: string }>(
    `INSERT INTO student_level (organization_id, name, sort_order) VALUES ($1, 'Iniciação', 1) RETURNING id`,
    [tenant.organizationId],
  );
  const [period] = await tenant.sql<{ id: string }>(
    `INSERT INTO fee_period (organization_id, facility_id, name, months, is_default, sort_order)
     VALUES ($1, $2, 'Mensal', 1, true, 1) RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );
  const [plan] = await tenant.sql<{ id: string }>(
    `INSERT INTO fee_plan (organization_id, facility_id, kind, level_id, lessons_per_week, amount_cents, vat_exempt)
     VALUES ($1, $2, 'mensalidade', $3, 2, 4500, true) RETURNING id`,
    [tenant.organizationId, tenant.facilityId, level!.id],
  );
  const [student] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, birth_date)
     VALUES ($1, 'Carlos', 'Nunes', DATE '1968-01-20') RETURNING id`,
    [tenant.organizationId],
  );
  const [fee] = await tenant.sql<{ id: string }>(
    `INSERT INTO student_fee (organization_id, student_id, fee_plan_id, fee_period_id, amount_cents, starts_on)
     VALUES ($1, $2, $3, $4, 4500, DATE '2026-09-01') RETURNING id`,
    [tenant.organizationId, student!.id, plan!.id, period!.id],
  );
  return { studentId: student!.id, feeId: fee!.id };
}

const OCTOBER = '2026-10-01';

test('marked as invoiced elsewhere, the run leaves the occurrence out and counts it; archived, it is offered again', async () => {
  await withScratchTenant(async (tenant) => {
    const { studentId, feeId } = await aFee(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const invoices = new InvoicesController();
      const fees = new StudentFeesController();
      const preview = () => invoices.preview(tenant.facilityId, { periodStart: OCTOBER, dueOn: inDays(30) });

      assert.equal((await preview()).drafts.length, 1, 'October is billable before the mark');

      const { id } = await fees.externalCharge(studentId, feeId, { reference: 'FT 2026/12', occurrenceOn: OCTOBER });
      const marked = await preview();
      assert.equal(marked.drafts.length, 0, 'the run leaves it out');
      assert.equal(marked.externalCount, 1, 'and counts it as invoiced outside Poolse');
      assert.equal(marked.alreadyChargedCount, 0);

      // The same occurrence twice is refused.
      await expectStatus(() => fees.externalCharge(studentId, feeId, { reference: 'FT 2', occurrenceOn: OCTOBER }), 409);

      await fees.archiveExternal(studentId, id);
      const again = await preview();
      assert.equal(again.drafts.length, 1, 'archived, the occurrence is offered again');
      assert.equal(again.externalCount, 0);
    });
  });
});

test('the fee read counts the marked occurrence settled and names the number', async () => {
  await withScratchTenant(async (tenant) => {
    const { studentId, feeId } = await aFee(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const fees = new StudentFeesController();
      const before = await fees.list(studentId);
      const owed = before.balance.outstandingCents;
      assert.ok(owed > 0, 'the current occurrence is owed');

      // No occurrence named: the line's current one.
      await fees.externalCharge(studentId, feeId, { reference: 'FT 2026/30' });
      const after = await fees.list(studentId);
      const line = after.lines.find((one) => one.id === feeId)!;
      assert.equal(line.isPaid, true);
      assert.equal(line.isOverdue, false);
      assert.equal(line.externalCharges[0]?.reference, 'FT 2026/30');
      assert.ok(after.balance.outstandingCents < owed, 'the balance no longer counts it');
    });
  });
});

test('an occurrence already on a Poolse document refuses the mark (409 with its number)', async () => {
  await withScratchTenant(async (tenant) => {
    const { studentId, feeId } = await aFee(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const issued = await new InvoicesController().issue(tenant.facilityId, { periodStart: OCTOBER, dueOn: inDays(30) });
      assert.equal(issued.drafts.length, 1);
      await expectStatus(
        () => new StudentFeesController().externalCharge(studentId, feeId, { reference: 'FT 9', occurrenceOn: OCTOBER }),
        409,
      );
    });
    const [row] = await tenant.sql<{ n: number }>('SELECT count(*)::int AS n FROM student_fee_external_charge');
    assert.equal(row!.n, 0);
  });
});

test("no number is a 400; an instructor is refused; another club's line is not found", async () => {
  await withScratchTenant(async (other) => {
    const theirs = await aFee(other);
    await withScratchTenant(async (tenant) => {
      const mine = await aFee(tenant);
      const teacher = await addMember(tenant, 'Ana', 'Professora', ['instructor']);
      await actingAs(tenant, { roles: ['owner'] }, async () => {
        await expectStatus(() => new StudentFeesController().externalCharge(mine.studentId, mine.feeId, {}), 400);
        await expectStatus(
          () => new StudentFeesController().externalCharge(theirs.studentId, theirs.feeId, { reference: 'FT 1' }),
          404,
        );
      });
      await actingAs(tenant, { membershipId: teacher, roles: ['instructor'] }, async () => {
        await expectStatus(
          () => new StudentFeesController().externalCharge(mine.studentId, mine.feeId, { reference: 'FT 1' }),
          403,
        );
      });
    });
  });
});
