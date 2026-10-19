import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feeBalance } from './fee-balance.js';

const line = (
  payableCents: number,
  isPaid: boolean,
  extra: Partial<{
    isOverdue: boolean;
    endsOn: string | null;
    dueOn: string | null;
    currentPeriodStart: string | null;
  }> = {},
) => ({
  payableCents,
  isPaid,
  isOverdue: false,
  endsOn: null,
  dueOn: null,
  currentPeriodStart: '2026-10-01',
  ...extra,
});

test('paid and outstanding are split over running lines; an ended line counts for neither', () => {
  const balance = feeBalance(
    [line(3500, true), line(2000, false, { dueOn: '2026-10-08' }), line(9999, false, { endsOn: '2026-06-30', currentPeriodStart: null })],
    0,
  );
  assert.deepEqual(balance, {
    totalCents: 5500,
    paidCents: 3500,
    outstandingCents: 2000,
    overdueCount: 0,
    nextDueOn: '2026-10-08',
  });
});

test('the penalty sits on what is still to pay, and overdue lines are counted', () => {
  const balance = feeBalance(
    [line(3500, true), line(2000, false, { isOverdue: true, dueOn: '2026-09-08' }), line(1500, false, { dueOn: '2026-11-08' })],
    500,
  );
  assert.equal(balance.paidCents, 3500);
  assert.equal(balance.outstandingCents, 4000);
  assert.equal(balance.overdueCount, 1);
  assert.equal(balance.nextDueOn, '2026-09-08', 'the earliest unpaid due date');
});

test('an ended line still owing the period it ended in counts until it is paid — 19-10-2026', () => {
  // Enrolment ended on the 20th; October is unpaid and overdue.
  const owing = line(3500, false, { endsOn: '2026-10-20', isOverdue: true, dueOn: '2026-10-08' });
  const balance = feeBalance([owing], 350);
  assert.equal(balance.outstandingCents, 3850, 'the fee and its penalty, not the penalty alone');
  assert.equal(balance.overdueCount, 1);

  const paid = feeBalance([{ ...owing, isPaid: true, isOverdue: false }], 0);
  assert.equal(paid.totalCents, 0, 'once paid, an ended line is history');
});
