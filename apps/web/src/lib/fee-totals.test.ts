import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feeTotals } from './fee-totals.ts';
import type { StudentFees } from './api.ts';

test('lines split into running and ended, and the totals come from the API', () => {
  const fees = {
    lines: [{ endsOn: null }, { endsOn: '2026-06-30' }],
    balance: { totalCents: 5500, paidCents: 3500, outstandingCents: 2500, overdueCount: 1, nextDueOn: null },
  } as unknown as StudentFees;
  const totals = feeTotals(fees);
  assert.equal(totals.live.length, 1);
  assert.equal(totals.ended.length, 1);
  assert.deepEqual([totals.grandTotal, totals.paidTotal, totals.outstanding], [5500, 3500, 2500]);
});
