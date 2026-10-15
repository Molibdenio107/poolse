import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feeBalance } from './fee-balance.js';

const line = (payableCents: number, isPaid: boolean, extra: Partial<{ isOverdue: boolean; endsOn: string | null; dueOn: string | null }> = {}) => ({
  payableCents,
  isPaid,
  isOverdue: false,
  endsOn: null,
  dueOn: null,
  ...extra,
});

test('paid and outstanding are split over running lines; an ended line counts for neither', () => {
  const balance = feeBalance(
    [line(3500, true), line(2000, false, { dueOn: '2026-10-08' }), line(9999, false, { endsOn: '2026-06-30' })],
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
