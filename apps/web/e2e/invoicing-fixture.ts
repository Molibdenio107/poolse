import { Client } from 'pg';

/**
 * Em dívida's own documents — POOLSE-104, QA 4: three overdue and two open.
 *
 * Five adults who pay for themselves, one mensalidade each and one document
 * each, in the E2E user's club. Made once and found again by the note they
 * carry, so a second run reuses them; on every run the due dates are put back
 * relative to today (three 15 days late, two due in 20 days), because a fixed
 * date would turn the two open documents overdue three weeks from now and the
 * scenario would silently stop testing the difference.
 *
 * Written through `DATABASE_URL`, the owner login, like the poolside fixture:
 * there is no API for "make me five debtors" and there should not be one.
 * Development database only. Nothing here is ever paid or reminded, so the
 * fixture never has to undo a payment.
 */

export const OWED_NOTE = 'E2E · Em dívida';

/** One family per document — the payer is the student, an adult. */
export const OWED_PAYERS = [
  'Rita Dívida', 'Sérgio Dívida', 'Teresa Dívida', 'Vasco Dívida', 'Xavier Dívida',
] as const;
const OVERDUE = 3;

export interface OwedDocument {
  id: string;
  documentNo: string;
  payer: string;
}

export interface OwedDocuments {
  facilityId: string;
  overdue: OwedDocument[];
  open: OwedDocument[];
}

async function connect(): Promise<Client> {
  const url = process.env['DATABASE_URL'];
  if (url === undefined) throw new Error('DATABASE_URL is not set — run with --env-file=../../.env');
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

export async function owedDocuments(email: string): Promise<OwedDocuments> {
  const db = await connect();
  try {
    await db.query('BEGIN');

    const org = (
      await db.query<{ organization_id: string }>(
        `SELECT m.organization_id
           FROM app_user u
           JOIN membership m ON m.app_user_id = u.id AND m.archived_at IS NULL
           JOIN membership_role r ON r.membership_id = m.id AND r.role = 'owner' AND r.archived_at IS NULL
          WHERE u.cached_email = $1
          LIMIT 1`,
        [email],
      )
    ).rows[0]?.organization_id;
    if (org === undefined) throw new Error(`No owner membership for ${email}`);
    await db.query(`SELECT set_config('app.organization_id', $1, true)`, [org]);

    const site = (
      await db.query<{ facility_id: string; series_id: string; period_id: string }>(
        `SELECT f.id AS facility_id, s.id AS series_id, p.id AS period_id
           FROM facility f
           JOIN invoice_series s ON s.organization_id = f.organization_id AND s.facility_id = f.id AND s.kind = 'invoice'
           JOIN fee_period p ON p.organization_id = f.organization_id AND p.facility_id = f.id AND p.months = 1
          WHERE f.organization_id = $1 AND f.archived_at IS NULL
          ORDER BY f.created_at, p.sort_order
          LIMIT 1`,
        [org],
      )
    ).rows[0];
    if (site === undefined) throw new Error('The E2E club has no site with an invoice series and a monthly period');

    const existing = await db.query<{ id: string; document_no: string; payer_name: string }>(
      `SELECT id, document_no, payer_name FROM invoice
        WHERE organization_id = $1 AND facility_id = $2 AND notes = $3
        ORDER BY payer_name`,
      [org, site.facility_id, OWED_NOTE],
    );
    const made = new Map(existing.rows.map((row) => [row.payer_name, row]));

    let levelId = (
      await db.query<{ id: string }>(
        `SELECT id FROM student_level WHERE organization_id = $1 AND name = $2 AND archived_at IS NULL`,
        [org, OWED_NOTE],
      )
    ).rows[0]?.id;
    if (levelId === undefined && made.size < OWED_PAYERS.length) {
      levelId = (
        await db.query<{ id: string }>(
          `INSERT INTO student_level (organization_id, name, sort_order) VALUES ($1, $2, 99) RETURNING id`,
          [org, OWED_NOTE],
        )
      ).rows[0]!.id;
    }

    for (const [i, payer] of OWED_PAYERS.entries()) {
      if (made.has(payer)) continue;
      const [first, last] = payer.split(' ') as [string, string];
      const plan = (
        await db.query<{ id: string }>(
          `INSERT INTO fee_plan (organization_id, facility_id, kind, level_id, lessons_per_week, amount_cents, vat_exempt)
           VALUES ($1, $2, 'mensalidade', $3, $4, 3000, true) RETURNING id`,
          [org, site.facility_id, levelId, i + 1],
        )
      ).rows[0]!.id;
      const student = (
        await db.query<{ id: string }>(
          `INSERT INTO student (organization_id, first_name, last_name, birth_date, contact_email)
           VALUES ($1, $2, $3, DATE '1980-01-01', $4) RETURNING id`,
          [org, first, last, `e2e.divida.${i + 1}@example.test`],
        )
      ).rows[0]!.id;
      const fee = (
        await db.query<{ id: string }>(
          `INSERT INTO student_fee (organization_id, student_id, fee_plan_id, fee_period_id, amount_cents, starts_on)
           VALUES ($1, $2, $3, $4, 3000, DATE '2026-09-01') RETURNING id`,
          [org, student, plan, site.period_id],
        )
      ).rows[0]!.id;
      const invoice = (
        await db.query<{ id: string; document_no: string }>(
          `INSERT INTO invoice (organization_id, facility_id, series_id, issued_on, due_on,
                                payer_student_id, payer_name, payer_email, notes)
           VALUES ($1, $2, $3, DATE '2026-09-01', DATE '2026-09-15', $4, $5, $6, $7)
           RETURNING id, document_no`,
          [org, site.facility_id, site.series_id, student, payer, `e2e.divida.${i + 1}@example.test`, OWED_NOTE],
        )
      ).rows[0]!;
      await db.query(
        `INSERT INTO invoice_line (organization_id, invoice_id, student_id, student_fee_id, student_name,
                                   description, lessons_per_week, kind, period_start, months,
                                   amount_cents, vat_rate, vat_exempt)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'mensalidade', DATE '2026-09-01', 1, 3000, 0, true)`,
        [org, invoice.id, student, fee, payer, OWED_NOTE, i + 1],
      );
      made.set(payer, { id: invoice.id, document_no: invoice.document_no, payer_name: payer });
    }

    // Due dates relative to the club's today, every run.
    const documents = OWED_PAYERS.map((payer) => made.get(payer)!);
    for (const [i, doc] of documents.entries()) {
      await db.query(
        `UPDATE invoice SET due_on = (now() AT TIME ZONE 'Europe/Lisbon')::date + $3::int
          WHERE organization_id = $1 AND id = $2`,
        [org, doc.id, i < OVERDUE ? -15 : 20],
      );
    }

    await db.query('COMMIT');
    const shape = (doc: { id: string; document_no: string; payer_name: string }): OwedDocument => ({
      id: doc.id,
      documentNo: doc.document_no,
      payer: doc.payer_name,
    });
    return {
      facilityId: site.facility_id,
      overdue: documents.slice(0, OVERDUE).map(shape),
      open: documents.slice(OVERDUE).map(shape),
    };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    await db.end();
  }
}
