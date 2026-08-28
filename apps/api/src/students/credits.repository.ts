import { withOrg } from '@poolse/db';

/**
 * Reposição credits, as the office and the family see them — POOLSE-21.
 *
 * This slice reads and expires. Booking a credit into an occurrence — the
 * eligibility filter, the backfill-only rule and the two approval modes — is the
 * next slice; nothing here assumes its shape beyond the `booked` status the
 * schema already carries.
 */

export interface ReposicaoCredit {
  id: string;
  studentId: string;
  /** What the family is owed a class *for* — the date they missed. */
  issuedOn: string;
  expiresOn: string;
  status: 'available' | 'booked' | 'used' | 'expired';
  /** The turma the absence was in, so a credit reads as "a class you missed". */
  className: string | null;
  /**
   * Days left, in the club's own calendar, or null once it is spent or gone.
   *
   * Computed in SQL rather than in the browser: a credit expiring "today" is a
   * question about the club's date, and a browser in another timezone would
   * answer it differently — which is the same trap the expiry job avoids.
   */
  daysLeft: number | null;
}

/**
 * One student's credits, oldest-expiry-first — criterion 5.
 *
 * The perishable ones first, so a family offered a choice spends the credit that
 * would otherwise be lost. Ties break on the oldest issue date, which makes the
 * order total and therefore stable between two reads.
 *
 * Live credits only: revoked ones are archived, and showing a family a credit
 * that was taken back because a mark was corrected would invite a conversation
 * nobody can win. The office can still find them in the audit trail.
 */
export async function creditsFor(
  organizationId: string,
  studentId: string,
): Promise<ReposicaoCredit[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      student_id: string;
      issued_on: Date;
      expires_on: Date;
      status: ReposicaoCredit['status'];
      class_name: string | null;
      days_left: number | null;
    }>(
      `SELECT c.id,
              c.student_id,
              c.issued_on,
              c.expires_on,
              c.status::text AS status,
              cg.name AS class_name,
              CASE WHEN c.status = 'available'
                   THEN (c.expires_on - current_date)::int
                   ELSE NULL
              END AS days_left
         FROM reposicao_credit c
         JOIN class_session cs
           ON cs.id = c.class_session_id AND cs.organization_id = c.organization_id
         JOIN class_group cg
           ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
        WHERE c.student_id = $1
          AND c.archived_at IS NULL
        ORDER BY c.expires_on, c.issued_on`,
      [studentId],
    );

    return rows.map((row) => ({
      id: row.id,
      studentId: row.student_id,
      issuedOn: row.issued_on.toISOString().slice(0, 10),
      expiresOn: row.expires_on.toISOString().slice(0, 10),
      status: row.status,
      className: row.class_name,
      daysLeft: row.days_left,
    }));
  });
}

/**
 * Expires whatever has run out, and says how many — criterion 7.
 *
 * A thin wrapper over the SQL function, which is where the logic lives so that a
 * scheduled job, a manual run and a test all do the same thing. The date is
 * passed in rather than read from a clock: expiry is a question about the club's
 * calendar day, and `now()` in UTC kills a credit an hour early for half the
 * year in Lisbon.
 *
 * Idempotent — a second run in the same day finds nothing and notifies nobody.
 */
export async function expireCredits(organizationId: string, today: string): Promise<number> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ expired: number }>(
      'SELECT expire_reposicao_credits($1, $2::date) AS expired',
      [organizationId, today],
    );
    return rows[0]?.expired ?? 0;
  });
}
