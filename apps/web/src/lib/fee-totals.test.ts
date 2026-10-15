import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feeTotals } from './fee-totals.ts';
import type { StudentFees } from './api.ts';

/** Only the fields `feeTotals` reads; the rest of a line is the office's. */
function fees(
  lines: { payableCents: number; isPaid: boolean; endsOn: string | null }[],
  penaltyCents = 0,
): StudentFees {
  return { lines, penaltyCents } as unknown as StudentFees;
}

test('paid and outstanding are split over running lines, and an ended line counts for neither', () => {
  const totals = feeTotals(
    fees([
      { payableCents: 3500, isPaid: true, endsOn: null },
      { payableCents: 2000, isPaid: false, endsOn: null },
      { payableCents: 9999, isPaid: false, endsOn: '2026-06-30' },
    ]),
  );
  assert.equal(totals.grandTotal, 5500);
  assert.equal(totals.paidTotal, 3500);
  assert.equal(totals.outstanding, 2000);
  assert.equal(totals.ended.length, 1);
});

test('the penalty sits on what is still to pay, never on what is paid', () => {
  const totals = feeTotals(fees([{ payableCents: 3500, isPaid: true, endsOn: null }], 500));
  assert.equal(totals.paidTotal, 3500);
  assert.equal(totals.outstanding, 500);
});
