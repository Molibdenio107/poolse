import { withOrg } from '@poolse/db';
import { studentFees, type StudentFeeLine } from './fees.repository.js';
import { payToFor, type PayTo } from './payment-destinations.js';

/** How many coming and settled occurrences *Pagamentos* lists — POOLSE-178. */
const UPCOMING_SHOWN = 3;
const PAID_SHOWN = 6;

export interface FamilyFeeItem {
  lineId: string;
  kind: StudentFeeLine['kind'];
  /** The occurrence's first day; a fee paid once has its start date here. */
  periodStart: string;
  /** Only a fee that recurs names a period; a one-off names its season. */
  recurring: boolean;
  seasonName: string | null;
  className: string | null;
}

export interface FamilyFeeCharge extends FamilyFeeItem {
  /** What was agreed for one occurrence. Never recomputed for this screen. */
  amountCents: number;
  dueOn: string | null;
  /** The reader's other children on the same document, so it is not read twice. */
  sharedWith: string[];
}

export interface FamilyChildFees {
  id: string;
  name: string;
  overdue: FamilyFeeCharge[];
  upcoming: FamilyFeeCharge[];
  /** No amount: a payment records the period it settled, not what was paid. */
  paid: FamilyFeeItem[];
  /** The late charge, which sits on what is still to pay and on no one line. */
  penaltyCents: number;
  payTo: PayTo | null;
}

function item(line: StudentFeeLine, periodStart: string): FamilyFeeItem {
  return {
    lineId: line.id,
    kind: line.kind,
    periodStart,
    recurring: line.periodId !== null,
    seasonName: line.seasonName,
    className: line.classGroupName,
  };
}

function charge(line: StudentFeeLine, periodStart: string, dueOn: string | null): FamilyFeeCharge {
  return { ...item(line, periodStart), amountCents: line.payableCents, dueOn, sharedWith: [] };
}

/**
 * The occurrences after the current one, walked in SQL with the same
 * `current_period_start` and `fee_due_on` the fee read uses, so a date here is
 * the date the line will show when it arrives. Up to its end, and leaving out
 * what is already settled in advance or invoiced outside Poolse.
 */
async function nextOccurrences(
  organizationId: string,
  studentId: string,
): Promise<{ line_id: string; period_start: string; due_on: string }[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ line_id: string; period_start: string; due_on: string }>(
      `SELECT sf.id AS line_id,
              to_char(occ.period_start, 'YYYY-MM-DD') AS period_start,
              to_char(fee_due_on(occ.period_start, f.payment_due_day), 'YYYY-MM-DD') AS due_on
         FROM student_fee sf
         JOIN fee_period fp ON fp.id = sf.fee_period_id
         JOIN fee_plan p ON p.id = sf.fee_plan_id
         JOIN facility f ON f.id = p.facility_id
        CROSS JOIN LATERAL (
              SELECT (current_period_start(sf.starts_on, sf.ends_on, fp.months)
                      + (n * fp.months) * interval '1 month')::date AS period_start
                FROM generate_series(1, ${UPCOMING_SHOWN}) n
             ) occ
        WHERE sf.student_id = $1
          AND sf.archived_at IS NULL
          AND occ.period_start IS NOT NULL
          AND (sf.ends_on IS NULL OR occ.period_start <= sf.ends_on)
          AND NOT EXISTS (
            SELECT 1 FROM student_fee_payment pay
             WHERE pay.student_fee_id = sf.id AND pay.period_start = occ.period_start
          )
          AND NOT EXISTS (
            SELECT 1 FROM student_fee_external_charge x
             WHERE x.student_fee_id = sf.id AND x.organization_id = sf.organization_id
               AND x.occurrence_on = occ.period_start AND x.archived_at IS NULL
          )
          AND NOT fee_paid_by_invoice(sf.organization_id, sf.id, occ.period_start)`,
      [studentId],
    );
    return rows;
  });
}

/**
 * The reader's other children on the live document that bills an occurrence.
 * `invoice_charged_on` is the one definition of "on a document not since
 * credited", and `siblings` is the reader's own children, so this can name
 * nobody else whatever a document holds.
 */
async function sharedDocuments(
  organizationId: string,
  studentId: string,
  siblings: string[],
): Promise<Map<string, string[]>> {
  const shared = new Map<string, string[]>();
  if (siblings.length === 0) return shared;
  const rows = await withOrg(organizationId, async (tx) => {
    const { rows: found } = await tx.query<{ line_id: string; period_start: string; sibling: string }>(
      `SELECT DISTINCT l.student_fee_id AS line_id,
              to_char(l.period_start, 'YYYY-MM-DD') AS period_start,
              other.student_id AS sibling
         FROM invoice_line l
         JOIN invoice i ON i.id = l.invoice_id AND i.organization_id = l.organization_id
         JOIN invoice_line other
           ON other.invoice_id = l.invoice_id AND other.organization_id = l.organization_id
          AND other.document_kind = 'invoice'
        WHERE l.student_id = $1
          AND l.document_kind = 'invoice'
          AND other.student_id = ANY ($2::uuid[])
          AND invoice_charged_on(l.organization_id, l.student_fee_id, l.period_start) = i.document_no`,
      [studentId, siblings],
    );
    return found;
  });
  for (const row of rows) {
    const key = `${row.line_id}|${row.period_start}`;
    shared.set(key, [...(shared.get(key) ?? []), row.sibling]);
  }
  return shared;
}

/**
 * One child's *Pagamentos* — POOLSE-178.
 *
 * **Overdue is what `balance` calls overdue**: each line's current occurrence
 * and every older one still unpaid (POOLSE-187), oldest first.
 */
export async function familyFees(
  organizationId: string,
  child: { id: string; name: string },
  family: { id: string; name: string }[],
): Promise<FamilyChildFees> {
  const fees = await studentFees(organizationId, child.id);
  const lineOf = new Map(fees.lines.map((line) => [line.id, line]));
  const named = new Map(family.map((one) => [one.id, one.name]));

  const overdue = fees.lines
    .flatMap((line) => [
      ...line.olderUnpaid.map((one) => charge(line, one.periodStart, one.dueOn)),
      ...(line.isOverdue && line.currentPeriodStart !== null
        ? [charge(line, line.currentPeriodStart, line.dueOn)]
        : []),
    ])
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  const dueNext = fees.lines
    .filter((line) => !line.isPaid && !line.isOverdue && line.currentPeriodStart !== null)
    .map((line) => charge(line, line.currentPeriodStart!, line.dueOn));
  const later = (await nextOccurrences(organizationId, child.id)).flatMap((row) => {
    const line = lineOf.get(row.line_id);
    return line === undefined ? [] : [charge(line, row.period_start, row.due_on)];
  });
  const upcoming = [...dueNext, ...later]
    .sort((a, b) => (a.dueOn ?? a.periodStart).localeCompare(b.dueOn ?? b.periodStart))
    .slice(0, UPCOMING_SHOWN);

  const paid = fees.lines
    .flatMap((line) => [
      ...line.paidPeriods.map((period) => item(line, period)),
      ...line.externalCharges.map((mark) => item(line, mark.occurrenceOn)),
    ])
    .sort((a, b) => b.periodStart.localeCompare(a.periodStart))
    .slice(0, PAID_SHOWN);

  const siblings = family.filter((one) => one.id !== child.id).map((one) => one.id);
  const shared = await sharedDocuments(organizationId, child.id, siblings);
  const withSiblings = (one: FamilyFeeCharge): FamilyFeeCharge => ({
    ...one,
    sharedWith: (shared.get(`${one.lineId}|${one.periodStart}`) ?? []).flatMap((id) => named.get(id) ?? []),
  });

  return {
    id: child.id,
    name: child.name,
    overdue: overdue.map(withSiblings),
    upcoming: upcoming.map(withSiblings),
    paid,
    penaltyCents: fees.penaltyCents,
    payTo: await payToFor(organizationId, child.id),
  };
}
