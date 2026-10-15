/**
 * What a student's fee lines come to — one definition, on the server.
 *
 * 15 October 2026: the office's fee block, the family's Mensalidades tab and
 * the family dashboard card all say how much is still to pay, and three screens
 * computing it is three chances to disagree. So the API computes it once, beside
 * the lines, and every screen reads `balance`.
 *
 * A line still running (`endsOn` null) counts; an ended one is history. **The
 * penalty sits on what is still to pay, never on what is paid** — one per kind
 * of charge however many lines are late, added here rather than written as a
 * charge (round 5).
 */
export interface FeeBalance {
  /** Every running line's payable amount this period. */
  totalCents: number;
  paidCents: number;
  /** Unpaid running lines plus the penalty; never below zero. */
  outstandingCents: number;
  /** Running lines past their due date and unpaid. */
  overdueCount: number;
  /** The earliest due date among unpaid running lines, or null. */
  nextDueOn: string | null;
}

export interface BalanceLine {
  payableCents: number;
  isPaid: boolean;
  isOverdue: boolean;
  endsOn: string | null;
  dueOn: string | null;
}

export function feeBalance(lines: readonly BalanceLine[], penaltyCents: number): FeeBalance {
  const live = lines.filter((line) => line.endsOn === null);
  const unpaid = live.filter((line) => !line.isPaid);
  const sum = (some: readonly BalanceLine[]): number =>
    some.reduce((total, line) => total + line.payableCents, 0);

  const dues = unpaid
    .map((line) => line.dueOn)
    .filter((due): due is string => due !== null)
    .sort();

  return {
    totalCents: sum(live),
    paidCents: sum(live.filter((line) => line.isPaid)),
    outstandingCents: Math.max(0, sum(unpaid) + penaltyCents),
    overdueCount: unpaid.filter((line) => line.isOverdue).length,
    nextDueOn: dues[0] ?? null,
  };
}
