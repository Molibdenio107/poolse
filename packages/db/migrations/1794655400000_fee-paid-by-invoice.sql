-- Up Migration

/*
 * A fee period paid through its invoice is paid (go-live review, 10-11-2026).
 *
 * Two records said "this month is settled" and neither read the other: the desk
 * tick (`student_fee_payment`) and a payment on the invoice that charged the
 * month (`invoice_payment`). A family whose invoice was paid in full still saw
 * the month "em atraso" in the app, with the late penalty, and the club's
 * dashboard counted it as owed.
 *
 * This is the one answer to "did an invoice settle this period": a live
 * (uncredited) Poolse invoice carries the period, and what has arrived on that
 * invoice covers its whole total. A partly paid invoice settles none of its
 * periods — which month a partial payment was for is not something Poolse can
 * know. The other direction (a tick on a month already invoiced) is refused by
 * the API, which points the office at the invoice instead (Rui, 10-11-2026).
 *
 * Invoker, so RLS scopes it like the queries that call it; the organization is
 * an argument only so `invoice_line_occurrence_idx` answers it.
 */

CREATE FUNCTION fee_paid_by_invoice(p_organization_id uuid, p_student_fee_id uuid, p_period_start date)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM invoice_line l
      JOIN invoice i ON i.id = l.invoice_id AND i.organization_id = l.organization_id
     WHERE l.organization_id = p_organization_id
       AND l.student_fee_id = p_student_fee_id
       AND l.period_start = p_period_start
       AND l.document_kind = 'invoice'
       AND NOT EXISTS (
         SELECT 1 FROM invoice c
          WHERE c.corrects_invoice_id = i.id
            AND c.organization_id = i.organization_id
            AND c.kind = 'credit_note')
       AND (SELECT coalesce(sum(p.amount_cents), 0)
              FROM invoice_payment p
             WHERE p.invoice_id = i.id AND p.organization_id = i.organization_id
               AND p.archived_at IS NULL)
           >= (SELECT coalesce(sum(t.amount_cents), 0)
                 FROM invoice_line t
                WHERE t.invoice_id = i.id AND t.organization_id = i.organization_id)
  );
$$;

COMMENT ON FUNCTION fee_paid_by_invoice(uuid, uuid, date) IS
  'Whether a live Poolse invoice carrying this fee period has been paid in full.';

-- Down Migration

DROP FUNCTION IF EXISTS fee_paid_by_invoice(uuid, uuid, date);
