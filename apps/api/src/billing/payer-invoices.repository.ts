import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import {
  INVOICE_COLUMNS,
  JOINS_SQL,
  readLines,
  TOTALS_SQL,
  toInvoice,
  type Invoice,
  type InvoiceDocumentKind,
  type InvoiceRow,
  type InvoiceStatus,
} from './invoices.repository.js';

/**
 * *Extratos* — POOLSE-201. The documents a reader **pays**, for the app.
 *
 * **Through the payer, never through the child.** A document is addressed to
 * one person (the `invoice` migration's rule), and that person is who reads it
 * here: the reader's membership as `payer_membership_id`, or the reader's own
 * student record as `payer_student_id` while it is on the adult path. Being a
 * live guardian of a child on line 3 opens nothing: a second guardian who is
 * not the payer sees none of it (Rui, 08-11-2026), because the paper carries the
 * payer's NIF and address.
 *
 * The adult-path test is `student_is_adult_path`, called rather than restated.
 * A minor with no guardian yet has documents addressed to them, and still does
 * not read them on a phone.
 *
 * These are internal records, as `invoices.repository.ts` says. The screen
 * says so first; this layer only decides whose they are.
 */

/** The reader's predicate. `$1` is the reader's membership. */
const MINE_SQL = `(
  i.payer_membership_id = $1::uuid
  OR (i.payer_student_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM student_person s
         WHERE s.id = i.payer_student_id
           AND s.organization_id = i.organization_id
           AND s.membership_id = $1::uuid
           AND s.archived_at IS NULL)
      AND student_is_adult_path(i.organization_id, i.payer_student_id))
)`;

/** One row on the list: no NIF, no address, no e-mail, no chase history. */
export interface PayerInvoiceItem {
  id: string;
  kind: InvoiceDocumentKind;
  documentNo: string;
  issuedOn: string;
  dueOn: string;
  totalCents: number;
  outstandingCents: number;
  status: InvoiceStatus;
  daysOverdue: number | null;
  correctsDocumentNo: string | null;
  /** The swimmers on the lines, as the document snapshotted them. */
  students: string[];
}

/** One document for its payer: the office's read, less what is the office's own. */
export type PayerInvoice = Omit<
  Invoice,
  'payments' | 'chases' | 'lastChasedOn' | 'chaseCount' | 'payerMembershipId' | 'payerStudentId'
>;

export const PAYER_PAGE = 20;

/**
 * Whether the reader pays for anything, and their documents, newest first.
 *
 * `payer` is true for a guardian who is the payer of any of their children
 * (`invoice_payer_membership_id`, the rule issuing uses), for an adult student
 * who is their own payer, and for anybody who already has a document — so the
 * row on *Perfil* is there before the first document, and stays after the
 * children leave.
 */
export async function listPayerInvoices(
  organizationId: string,
  membershipId: string,
  offset: number,
): Promise<{ payer: boolean; documents: PayerInvoiceItem[]; next: number | null }> {
  return withOrg(organizationId, async (tx) => {
    const { rows: who } = await tx.query<{ payer: boolean }>(
      `SELECT EXISTS (
                -- Every live link, granting or not: a parent keeps paying after 18 (POOLSE-206).
                SELECT 1 FROM guardian_link g
                 WHERE g.guardian_membership_id = $1::uuid
                   AND g.archived_at IS NULL
                   AND invoice_payer_membership_id(g.organization_id, g.student_id) = $1::uuid)
           OR EXISTS (
                SELECT 1 FROM student_person s
                 WHERE s.membership_id = $1::uuid
                   AND s.archived_at IS NULL
                   AND student_is_adult_path(s.organization_id, s.id))
           OR EXISTS (SELECT 1 FROM invoice i WHERE ${MINE_SQL}) AS payer`,
      [membershipId],
    );
    const payer = who[0]?.payer === true;
    if (!payer) return { payer, documents: [], next: null };

    const { rows } = await tx.query<InvoiceRow & { students: string[] | null }>(
      `SELECT ${INVOICE_COLUMNS},
              (SELECT array_agg(DISTINCT l.student_name ORDER BY l.student_name)
                 FROM invoice_line l
                WHERE l.invoice_id = i.id AND l.organization_id = i.organization_id
                  AND l.student_name IS NOT NULL) AS students
         ${JOINS_SQL}
         ${TOTALS_SQL}
        WHERE ${MINE_SQL}
        ORDER BY i.issued_on DESC, i.system_entry_at DESC, i.id
        LIMIT $2 OFFSET $3`,
      [membershipId, PAYER_PAGE + 1, offset],
    );

    const documents = rows.slice(0, PAYER_PAGE).map((row) => {
      const one = toInvoice(row);
      return {
        id: one.id,
        kind: one.kind,
        documentNo: one.documentNo,
        issuedOn: one.issuedOn,
        dueOn: one.dueOn,
        totalCents: one.totalCents,
        outstandingCents: one.outstandingCents,
        status: one.status,
        daysOverdue: one.daysOverdue,
        correctsDocumentNo: one.correctsDocumentNo,
        students: row.students ?? [],
      };
    });
    return { payer, documents, next: rows.length > PAYER_PAGE ? offset + PAYER_PAGE : null };
  });
}

/**
 * One document, for its payer only — null for anybody else, which the
 * controller says as a 404 so a number's existence is not an answer.
 *
 * The read is audited in the same transaction: a fiscal document opened from
 * a phone is worth a line, as a medical note is. The number, never the money.
 */
export async function readPayerInvoice(
  organizationId: string,
  membershipId: string,
  invoiceId: string,
): Promise<PayerInvoice | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<InvoiceRow>(
      `SELECT ${INVOICE_COLUMNS} ${JOINS_SQL} ${TOTALS_SQL}
        WHERE i.id = $2::uuid AND ${MINE_SQL}`,
      [membershipId, invoiceId],
    );
    const row = rows[0];
    if (row === undefined) return null;

    // Field by field rather than a rest-spread: what reaches a family is a list
    // somebody can read, not whatever `Invoice` grows next.
    const one = toInvoice(row);
    const answer: PayerInvoice = {
      id: one.id,
      kind: one.kind,
      documentNo: one.documentNo,
      number: one.number,
      seriesId: one.seriesId,
      facilityId: one.facilityId,
      facilityName: one.facilityName,
      issuedOn: one.issuedOn,
      dueOn: one.dueOn,
      systemEntryAt: one.systemEntryAt,
      payerName: one.payerName,
      payerTaxNumber: one.payerTaxNumber,
      payerAddress: one.payerAddress,
      payerEmail: one.payerEmail,
      correctsInvoiceId: one.correctsInvoiceId,
      correctsDocumentNo: one.correctsDocumentNo,
      creditedByInvoiceId: one.creditedByInvoiceId,
      creditedByDocumentNo: one.creditedByDocumentNo,
      notes: one.notes,
      totalCents: one.totalCents,
      vatCents: one.vatCents,
      netCents: one.netCents,
      lineCount: one.lineCount,
      status: one.status,
      paidCents: one.paidCents,
      outstandingCents: one.outstandingCents,
      daysOverdue: one.daysOverdue,
      lines: await readLines(tx, invoiceId),
    };

    await recordAudit(tx, {
      action: 'invoice.read_by_payer',
      entityType: 'invoice',
      entityId: invoiceId,
      data: { documentNo: row.document_no },
    });
    return answer;
  });
}
