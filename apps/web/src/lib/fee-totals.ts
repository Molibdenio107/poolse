import type { StudentFees } from './api';

/**
 * What a student's lines come to — one definition for the office's fee block
 * and the family's view of it (15 October 2026), so the two can never show a
 * family two different balances.
 *
 * A line still running is `live`; an ended one is history. **The penalty sits
 * on the remainder, never on what is paid** — one per kind of charge however
 * many lines are late, added here rather than written as a charge (round 5).
 */
export interface FeeTotals {
  live: StudentFees['lines'];
  ended: StudentFees['lines'];
  grandTotal: number;
  paidTotal: number;
  outstanding: number;
}

export function feeTotals(fees: StudentFees): FeeTotals {
  const live = fees.lines.filter((line) => line.endsOn === null);
  const ended = fees.lines.filter((line) => line.endsOn !== null);
  const sum = (lines: StudentFees['lines']): number =>
    lines.reduce((total, line) => total + line.payableCents, 0);

  return {
    live,
    ended,
    grandTotal: sum(live),
    paidTotal: sum(live.filter((line) => line.isPaid)),
    outstanding: sum(live.filter((line) => !line.isPaid)) + fees.penaltyCents,
  };
}
