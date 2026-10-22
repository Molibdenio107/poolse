import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { emailIsConfigured } from '../notifications/notifier.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { JOINS_SQL, TOTALS_SQL } from './invoices.repository.js';
import { readPaymentDestinations, type PaymentDestinations } from './payment-destinations.js';

/**
 * Invoice reminders by email — POOLSE-86, slice 3.0b.
 *
 * Chosen on Em dívida by the documents a person ticks; what is sent is decided
 * by their **payers**. Each payer gets one email listing every one of their
 * documents at this site that is **overdue** (Rui, 19-10-2026: a family is not
 * chased for what is not late yet). A payer reminded in the last 7 days is
 * flagged, never blocked (Rui, same day). Preview and send are one path.
 *
 * Who is owed what is `invoice_status()` through the same joins the chase list
 * reads, so the preview, the email and Em dívida cannot disagree about which
 * documents are late.
 */

export const RECENT_DAYS = 7;

export interface ReminderDocument {
  invoiceId: string;
  documentNo: string;
  issuedOn: string;
  dueOn: string;
  outstandingCents: number;
}

export interface ReminderPayer {
  /** `m:<membership>` or `s:<student>` — the payer as the invoice names them. */
  key: string;
  payerName: string;
  /** Where it would go; null is named on the confirmation and sent nothing. */
  email: string | null;
  documents: ReminderDocument[];
  /** The last time Poolse emailed this payer a reminder from this site. */
  lastRemindedOn: string | null;
  recentlyReminded: boolean;
}

export interface ReminderPreview {
  payers: ReminderPayer[];
  /** Ticked payers who owe nothing overdue here — said, not silently dropped. */
  nothingOverdue: string[];
  /** *Como pagar* as the email will say it — POOLSE-94; null is "contact the club". */
  payment: PaymentDestinations | null;
  emailConfigured: boolean;
}

export interface ReminderSent {
  reminderIds: string[];
  /** Payers asked for with no address, by name. */
  noAddress: string[];
}

interface PayerRow {
  key: string;
  payer_membership_id: string | null;
  payer_student_id: string | null;
  payer_name: string;
  email: string | null;
  locale: string;
  last_reminded: string | null;
  recent: boolean;
  documents: ReminderDocument[];
}

/**
 * The payers of the chosen documents, each with their overdue documents at this
 * site. The address is the payer's own today — the guardian's, or the adult
 * student's — falling back to the one the latest document was addressed to.
 */
async function payersOf(tx: Tx, facilityId: string, invoiceIds: string[]): Promise<{
  rows: PayerRow[];
  nothingOverdue: string[];
}> {
  const { rows } = await tx.query<PayerRow & { has_overdue: boolean }>(
    `WITH chosen AS (
       SELECT DISTINCT i.payer_membership_id, i.payer_student_id
         FROM invoice i
        WHERE i.facility_id = $1 AND i.id = ANY($2::uuid[]) AND i.kind = 'invoice'
     ),
     owed AS (
       SELECT i.id, i.document_no, i.payer_membership_id, i.payer_student_id, i.payer_name,
              i.payer_email::text AS snapshot_email, i.issued_on, i.due_on, i.number,
              (t.total_cents - pay.paid_cents) AS outstanding_cents
         ${JOINS_SQL}
         ${TOTALS_SQL}
        WHERE i.facility_id = $1 AND i.kind = 'invoice'
          AND invoice_status(i.kind, note.id IS NOT NULL, t.total_cents, pay.paid_cents, i.due_on) = 'overdue'
     )
     SELECT CASE WHEN c.payer_membership_id IS NOT NULL THEN 'm:' || c.payer_membership_id
                 ELSE 's:' || c.payer_student_id END AS key,
            c.payer_membership_id, c.payer_student_id,
            coalesce((SELECT o.payer_name FROM owed o
                       WHERE o.payer_membership_id IS NOT DISTINCT FROM c.payer_membership_id
                         AND o.payer_student_id IS NOT DISTINCT FROM c.payer_student_id
                       ORDER BY o.issued_on DESC LIMIT 1),
                     (SELECT i.payer_name FROM invoice i
                       WHERE i.facility_id = $1 AND i.id = ANY($2::uuid[])
                         AND i.payer_membership_id IS NOT DISTINCT FROM c.payer_membership_id
                         AND i.payer_student_id IS NOT DISTINCT FROM c.payer_student_id
                       LIMIT 1)) AS payer_name,
            coalesce(
              CASE WHEN c.payer_membership_id IS NOT NULL THEN person_email(c.payer_membership_id)::text
                   ELSE (SELECT st.contact_email::text FROM student st WHERE st.id = c.payer_student_id) END,
              (SELECT o.snapshot_email FROM owed o
                WHERE o.payer_membership_id IS NOT DISTINCT FROM c.payer_membership_id
                  AND o.payer_student_id IS NOT DISTINCT FROM c.payer_student_id
                  AND o.snapshot_email IS NOT NULL
                ORDER BY o.issued_on DESC LIMIT 1)) AS email,
            coalesce((SELECT u.locale FROM membership m JOIN app_user u ON u.id = m.app_user_id
                       WHERE m.id = c.payer_membership_id),
                     (SELECT locale FROM organization WHERE id = current_organization_id())) AS locale,
            (SELECT to_char(max(r.created_at) AT TIME ZONE 'Europe/Lisbon', 'YYYY-MM-DD')
               FROM invoice_reminder r
              WHERE r.facility_id = $1
                AND r.payer_membership_id IS NOT DISTINCT FROM c.payer_membership_id
                AND r.payer_student_id IS NOT DISTINCT FROM c.payer_student_id) AS last_reminded,
            EXISTS (SELECT 1 FROM invoice_reminder r
                     WHERE r.facility_id = $1
                       AND r.payer_membership_id IS NOT DISTINCT FROM c.payer_membership_id
                       AND r.payer_student_id IS NOT DISTINCT FROM c.payer_student_id
                       AND r.created_at > now() - make_interval(days => $3)) AS recent,
            coalesce((SELECT jsonb_agg(jsonb_build_object(
                         'invoiceId', o.id, 'documentNo', o.document_no,
                         'issuedOn', to_char(o.issued_on, 'YYYY-MM-DD'),
                         'dueOn', to_char(o.due_on, 'YYYY-MM-DD'),
                         'outstandingCents', o.outstanding_cents)
                       ORDER BY o.due_on, o.number)
                        FROM owed o
                       WHERE o.payer_membership_id IS NOT DISTINCT FROM c.payer_membership_id
                         AND o.payer_student_id IS NOT DISTINCT FROM c.payer_student_id), '[]'::jsonb)
              AS documents,
            EXISTS (SELECT 1 FROM owed o
                     WHERE o.payer_membership_id IS NOT DISTINCT FROM c.payer_membership_id
                       AND o.payer_student_id IS NOT DISTINCT FROM c.payer_student_id) AS has_overdue
       FROM chosen c
      ORDER BY 4`,
    [facilityId, invoiceIds, RECENT_DAYS],
  );
  return {
    rows: rows.filter((row) => row.has_overdue),
    nothingOverdue: rows.filter((row) => !row.has_overdue).map((row) => row.payer_name),
  };
}

function toPayer(row: PayerRow): ReminderPayer {
  return {
    key: row.key,
    payerName: row.payer_name,
    email: row.email,
    documents: row.documents,
    lastRemindedOn: row.last_reminded,
    recentlyReminded: row.recent,
  };
}

export async function previewReminders(
  organizationId: string,
  facilityId: string,
  invoiceIds: string[],
): Promise<ReminderPreview> {
  return withOrg(organizationId, async (tx) => {
    const { rows, nothingOverdue } = await payersOf(tx, facilityId, invoiceIds);
    return {
      payers: rows.map(toPayer),
      nothingOverdue,
      payment: await readPaymentDestinations(tx, organizationId),
      emailConfigured: emailIsConfigured(),
    };
  });
}

/**
 * Write one reminder per chosen payer with an address, and a chase per document
 * it lists — in one transaction, with what is owed read afresh rather than
 * trusted from the preview. The emails go after the commit (`deliverReminders`).
 * Over the club's daily address ceiling, the whole send is refused (the
 * trigger's figures travel up as `QuotaRefusal`).
 */
export async function sendReminders(
  organizationId: string,
  facilityId: string,
  invoiceIds: string[],
  payerKeys: string[],
): Promise<ReminderSent> {
  const { membershipId } = currentTenant();
  return withOrg(organizationId, async (tx) => {
    const { rows } = await payersOf(tx, facilityId, invoiceIds);
    const wanted = new Set(payerKeys);
    const reminderIds: string[] = [];
    const noAddress: string[] = [];

    for (const payer of rows.filter((row) => wanted.has(row.key))) {
      if (payer.email === null || payer.email.trim() === '') {
        noAddress.push(payer.payer_name);
        continue;
      }
      const { rows: inserted } = await tx.query<{ id: string }>(
        `INSERT INTO invoice_reminder (organization_id, facility_id, payer_membership_id, payer_student_id,
                                       payer_name, email, locale, lines, sent_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9) RETURNING id`,
        [
          organizationId,
          facilityId,
          payer.payer_membership_id,
          payer.payer_student_id,
          payer.payer_name,
          payer.email,
          payer.locale === 'en' ? 'en' : 'pt-PT',
          JSON.stringify(payer.documents),
          membershipId,
        ],
      );
      const reminderId = inserted[0]!.id;
      reminderIds.push(reminderId);

      await tx.query(
        `INSERT INTO invoice_chase (organization_id, invoice_id, chased_on, channel, reminder_id, recorded_by)
         SELECT $1, (d ->> 'invoiceId')::uuid, club_today(), 'poolse_email', $2, $3
           FROM jsonb_array_elements($4::jsonb) d`,
        [organizationId, reminderId, membershipId, JSON.stringify(payer.documents)],
      );
      await recordAudit(tx, {
        action: 'invoice.reminded',
        entityType: 'invoice_reminder',
        entityId: reminderId,
        // Who and which documents; the address is the payer's and stays on the row.
        data: {
          payerName: payer.payer_name,
          documents: payer.documents.map((document) => document.documentNo),
        },
      });
    }

    return { reminderIds, noAddress };
  });
}

/** Raised when a send would pass the club's daily address ceiling. */
export class QuotaRefusal extends Error {
  constructor(
    readonly limit: number,
    readonly used: number,
  ) {
    super('Daily address limit reached');
  }
}

/** The trigger's DETAIL, `message_quota|addresses|limit|used|asked`, as a refusal. */
export function quotaRefusal(error: unknown): QuotaRefusal | null {
  const detail = (error as { detail?: string }).detail ?? '';
  const parts = detail.split('|');
  if (parts[0] !== 'message_quota') return null;
  return new QuotaRefusal(Number(parts[2]), Number(parts[3]));
}
