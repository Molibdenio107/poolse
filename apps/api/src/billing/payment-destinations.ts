import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { moduleIsOn } from '../tenant/modules.js';
import { JOINS_SQL, TOTALS_SQL } from './invoices.repository.js';

/**
 * Where families pay the club — POOLSE-94.
 *
 * Three ways, each optional: a bank transfer to the club's IBAN, MB WAY to its
 * number, and the club's own words for everything else (office hours, cash at
 * reception). One account per club, not per site (Rui, 22-10-2026).
 *
 * **A changed IBAN is the classic fraud vector.** Every change to it or to the
 * MB WAY number is in `audit_log` with the values before and after, and an IBAN
 * change also writes a `payment_change_notice` that emails every Owner after the
 * commit — the last four digits only, enough to recognise an account and not
 * enough to use one.
 *
 * Online payments (POOLSE-83 / 3.5) will settle into this account through the
 * club's own provider contract; Poolse confirms the match, never sets the
 * payout. That half is built with 3.5 (BA rule 5), not here.
 */

export interface PaymentDetails {
  iban: string | null;
  accountHolder: string | null;
  mbwayPhone: string | null;
  instructions: string | null;
}

/** What a family is shown: only what is filled in, the holder defaulting to the club. */
export interface PaymentDestinations {
  iban: string | null;
  /** The name on the account; the club's own when it set none. Null without an IBAN. */
  accountHolder: string | null;
  mbwayPhone: string | null;
  instructions: string | null;
}

export async function readPaymentDetails(tx: Tx, organizationId: string): Promise<PaymentDetails & { clubName: string }> {
  const { rows } = await tx.query<{
    name: string;
    payment_iban: string | null;
    payment_account_holder: string | null;
    payment_mbway_phone: string | null;
    payment_instructions: string | null;
  }>(
    `SELECT name, payment_iban, payment_account_holder, payment_mbway_phone, payment_instructions
       FROM organization WHERE id = $1`,
    [organizationId],
  );
  const row = rows[0]!;
  return {
    clubName: row.name,
    iban: row.payment_iban,
    accountHolder: row.payment_account_holder,
    mbwayPhone: row.payment_mbway_phone,
    instructions: row.payment_instructions,
  };
}

/**
 * The destinations a family sees, or null when there are none to show — none
 * filled in, or the club's invoicing switched off (POOLSE-87: a core read
 * drops a module's data rather than refusing).
 */
export async function readPaymentDestinations(tx: Tx, organizationId: string): Promise<PaymentDestinations | null> {
  if (!moduleIsOn('invoicing')) return null;
  const details = await readPaymentDetails(tx, organizationId);
  if (details.iban === null && details.mbwayPhone === null && details.instructions === null) return null;
  return {
    iban: details.iban,
    accountHolder: details.iban === null ? null : (details.accountHolder ?? details.clubName),
    mbwayPhone: details.mbwayPhone,
    instructions: details.instructions,
  };
}

/**
 * The numbers of a student's documents still owed, oldest first — what a family
 * gives as the transfer's reference so the club can match it (BA rule 4). The
 * same `invoice_status` the chase list reads, so "still owed" has one meaning.
 */
export async function openDocumentNumbers(tx: Tx, studentId: string): Promise<string[]> {
  const { rows } = await tx.query<{ document_no: string }>(
    `SELECT i.document_no
       ${JOINS_SQL}
       ${TOTALS_SQL}
      WHERE i.kind = 'invoice'
        AND EXISTS (SELECT 1 FROM invoice_line l
                     WHERE l.invoice_id = i.id AND l.organization_id = i.organization_id
                       AND l.student_id = $1::uuid)
        AND invoice_status(i.kind, note.id IS NOT NULL, t.total_cents, pay.paid_cents, i.due_on)
            IN ('open', 'partly_paid', 'overdue')
      ORDER BY i.due_on, i.issued_on, i.number`,
    [studentId],
  );
  return rows.map((row) => row.document_no);
}

/** What a family pays to, and the reference to give — or null when there is nowhere to show. */
export interface PayTo {
  destinations: PaymentDestinations;
  /** The open document numbers, or the student's name when nothing has been invoiced yet. */
  reference: string;
}

export async function payToFor(organizationId: string, studentId: string): Promise<PayTo | null> {
  return withOrg(organizationId, async (tx) => {
    const destinations = await readPaymentDestinations(tx, organizationId);
    if (destinations === null) return null;
    const documents = await openDocumentNumbers(tx, studentId);
    if (documents.length > 0) return { destinations, reference: documents.join(', ') };
    // Nothing invoiced yet: the student's name is what the office can match.
    const { rows } = await tx.query<{ name: string }>(
      `SELECT btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) AS name
         FROM student WHERE id = $1`,
      [studentId],
    );
    return { destinations, reference: rows[0]?.name ?? '' };
  });
}

export interface PaymentDetailsInput {
  iban: string | null;
  accountHolder: string | null;
  mbwayPhone: string | null;
}

/** The last four digits, as the notice and its email say them. */
const end = (iban: string | null): string | null => (iban === null ? null : iban.slice(-4));

/**
 * Save the three fields. One transaction: the row is locked and read first, so
 * the audit's "before" is the value this write replaced; the notice to the
 * owners is written beside it and emailed after the commit by the caller.
 * Returns the notice's id when the IBAN moved.
 */
export async function savePaymentDetails(
  organizationId: string,
  actorMembershipId: string,
  input: PaymentDetailsInput,
): Promise<{ noticeId: string | null }> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      payment_iban: string | null;
      payment_account_holder: string | null;
      payment_mbway_phone: string | null;
    }>(
      `SELECT payment_iban, payment_account_holder, payment_mbway_phone
         FROM organization WHERE id = $1 FOR UPDATE`,
      [organizationId],
    );
    const before = {
      iban: rows[0]!.payment_iban,
      accountHolder: rows[0]!.payment_account_holder,
      mbwayPhone: rows[0]!.payment_mbway_phone,
    };

    await tx.query(
      `UPDATE organization
          SET payment_iban = $2, payment_account_holder = $3, payment_mbway_phone = $4
        WHERE id = $1`,
      [organizationId, input.iban, input.accountHolder, input.mbwayPhone],
    );

    // Only what moved, before and after. The club's own account details, not a
    // person's: "what did it change from, and to" is the question an audit of a
    // payment destination exists to answer.
    const changed = (Object.keys(before) as (keyof typeof before)[]).filter((key) => before[key] !== input[key]);
    if (changed.length > 0) {
      await recordAudit(tx, {
        action: 'organization.payment_details_changed',
        entityType: 'organization',
        entityId: organizationId,
        data: {
          before: Object.fromEntries(changed.map((key) => [key, before[key]])),
          after: Object.fromEntries(changed.map((key) => [key, input[key]])),
        },
      });
    }

    if (before.iban === input.iban) return { noticeId: null };

    const { rows: notice } = await tx.query<{ id: string }>(
      `INSERT INTO payment_change_notice (organization_id, changed_by, old_iban_end, new_iban_end, recipients)
       SELECT $1, $2, $3, $4,
              coalesce(array_agg(DISTINCT coalesce(u.cached_email::text, m.email::text))
                         FILTER (WHERE btrim(coalesce(u.cached_email::text, m.email::text, '')) <> ''),
                       '{}')
         FROM membership m
         JOIN membership_role r ON r.membership_id = m.id AND r.organization_id = m.organization_id
         LEFT JOIN app_user u ON u.id = m.app_user_id
        WHERE m.organization_id = $1
          AND m.archived_at IS NULL AND m.status = 'active'
          AND r.archived_at IS NULL AND r.role = 'owner'
       RETURNING id`,
      [organizationId, actorMembershipId, end(before.iban), end(input.iban)],
    );
    return { noticeId: notice[0]!.id };
  });
}
