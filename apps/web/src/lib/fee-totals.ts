import type { StudentFees } from './api';

/**
 * A student's lines split into running and ended, with the API's totals.
 *
 * The office's fee block and the family's view both read this. The figures are
 * not added up here: `balance` comes from the API (`billing/fee-balance.ts`),
 * which the family dashboard card reads too, so no two screens can show a
 * family two balances (15 October 2026).
 */
export interface FeeTotals {
  live: StudentFees['lines'];
  ended: StudentFees['lines'];
  grandTotal: number;
  paidTotal: number;
  outstanding: number;
}

export function feeTotals(fees: StudentFees): FeeTotals {
  return {
    live: fees.lines.filter((line) => line.endsOn === null),
    ended: fees.lines.filter((line) => line.endsOn !== null),
    grandTotal: fees.balance.totalCents,
    paidTotal: fees.balance.paidCents,
    outstanding: fees.balance.outstandingCents,
  };
}
