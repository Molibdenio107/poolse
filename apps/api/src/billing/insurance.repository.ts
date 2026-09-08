import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';

/**
 * The apólice a club holds — the facility's side of the seguro.
 *
 * Two halves, and this is the first of them. A club buys one policy a season and
 * insures every swimmer under it; a student's own cover is a `student_fee` of
 * kind `seguro` pointing here, which is what gives that student a period they
 * are covered for.
 *
 * **`costPerPersonCents` is what the club pays its insurer, not what the family
 * pays.** The family's price is the seguro `fee_plan`. They are usually the same
 * number and they are not the same fact — a club adding a euro of admin to it
 * would have nowhere to put the difference if this table were also the price.
 *
 * **Archived, never deleted.** Last season's policy is what covered last
 * season's swimmers and their fee lines still point at it, so "who insured my
 * daughter in March" survives this year's renewal.
 */
export interface InsurancePolicy {
  id: string;
  insurer: string;
  policyNumber: string;
  validFrom: string;
  validTo: string;
  costPerPersonCents: number;
  notes: string | null;
  /**
   * Whether this policy has run out, and whether it is close to it — derived in
   * SQL and rendered by the client, never recomputed there.
   *
   * The same reasoning as every other derived answer in this codebase: two
   * implementations of one rule agree until the day they do not, and a browser's
   * clock is not the club's. `daysToExpiry` is negative once it has lapsed, so
   * the screen can say how long ago rather than only that it happened.
   */
  daysToExpiry: number;
  expired: boolean;
  renewalDue: boolean;
  /** How many students hold cover under it. Read-only, and the reason to renew. */
  coveredCount: number;
}

/**
 * How long before a policy runs out the club is told about it.
 *
 * Sixty days is a renewal conversation with an insurer, not a scramble. A
 * constant rather than a setting: a club that wants longer has not asked for it
 * yet, and a number nobody has tuned is better than a settings row nobody fills.
 */
export const RENEWAL_WARNING_DAYS = 60;

export interface InsurancePolicyInput {
  insurer: string;
  policyNumber: string;
  validFrom: string;
  validTo: string;
  costPerPersonCents: number;
  notes: string | null;
}

/** Raised when the club already has a policy under that number. */
export class DuplicatePolicyNumberError extends Error {
  constructor(readonly policyNumber: string) {
    super(`Policy ${policyNumber} is already recorded`);
  }
}

function duplicateFrom(error: unknown, policyNumber: string): unknown {
  const { code, constraint } = error as { code?: string; constraint?: string };
  if (code === '23505' && constraint === 'insurance_policy_number_uq') {
    return new DuplicatePolicyNumberError(policyNumber);
  }
  return error;
}

export async function listPolicies(
  organizationId: string,
  facilityId: string,
): Promise<InsurancePolicy[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      insurer: string;
      policy_number: string;
      valid_from: string;
      valid_to: string;
      cost_per_person_cents: number;
      notes: string | null;
      days_to_expiry: number;
      covered_count: number;
    }>(
      /*
       * The dates are cast to text on the way out, like every other date in this
       * codebase: a `date` parsed by pg becomes a `Date` at midnight UTC, which
       * is the day before in every timezone west of Greenwich.
       *
       * `days_to_expiry` is the derived answer, computed once here. The two
       * booleans the client reads are built from it in one place below rather
       * than in SQL as well, so there is a single definition of "close to
       * expiry" and the constant that decides it is next to the comment
       * explaining it.
       */
      `SELECT p.id, p.insurer, p.policy_number,
              p.valid_from::text AS valid_from,
              p.valid_to::text   AS valid_to,
              p.cost_per_person_cents, p.notes,
              (p.valid_to - current_date) AS days_to_expiry,
              (SELECT count(*)::int FROM student_fee sf
                WHERE sf.insurance_policy_id = p.id
                  AND sf.organization_id = p.organization_id
                  AND sf.archived_at IS NULL) AS covered_count
         FROM insurance_policy p
        WHERE p.facility_id = $1 AND p.archived_at IS NULL
        -- The one that matters first: whatever expires soonest is what the club
        -- has to do something about.
        ORDER BY p.valid_to DESC`,
      [facilityId],
    );

    return rows.map((row) => ({
      id: row.id,
      insurer: row.insurer,
      policyNumber: row.policy_number,
      validFrom: row.valid_from,
      validTo: row.valid_to,
      costPerPersonCents: row.cost_per_person_cents,
      notes: row.notes,
      daysToExpiry: row.days_to_expiry,
      expired: row.days_to_expiry < 0,
      renewalDue: row.days_to_expiry >= 0 && row.days_to_expiry <= RENEWAL_WARNING_DAYS,
      coveredCount: row.covered_count,
    }));
  });
}

export async function createPolicy(
  organizationId: string,
  facilityId: string,
  input: InsurancePolicyInput,
): Promise<string> {
  return withOrg(organizationId, async (tx) => {
    let rows: { id: string }[];
    try {
      ({ rows } = await tx.query<{ id: string }>(
        `INSERT INTO insurance_policy
           (organization_id, facility_id, insurer, policy_number, valid_from, valid_to,
            cost_per_person_cents, notes)
         VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8) RETURNING id`,
        [
          organizationId,
          facilityId,
          input.insurer,
          input.policyNumber,
          input.validFrom,
          input.validTo,
          input.costPerPersonCents,
          input.notes,
        ],
      ));
    } catch (error) {
      throw duplicateFrom(error, input.policyNumber);
    }

    const id = rows[0]?.id;
    if (id === undefined) throw new Error('Could not record the policy');

    await recordAudit(tx, {
      action: 'insurance_policy.created',
      entityType: 'insurance_policy',
      entityId: id,
      data: {
        insurer: input.insurer,
        policyNumber: input.policyNumber,
        validFrom: input.validFrom,
        validTo: input.validTo,
      },
    });
    return id;
  });
}

export async function updatePolicy(
  organizationId: string,
  facilityId: string,
  policyId: string,
  input: InsurancePolicyInput,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    let rows: { id: string }[];
    try {
      ({ rows } = await tx.query<{ id: string }>(
        /*
         * Nothing here touches the cover a student already holds.
         *
         * A `student_fee` snapshots its own `covers_from` and `covers_to`, for
         * the reason it snapshots its amount: correcting a typo in the policy
         * dates must not silently rewrite what a family was told they had. A
         * club that genuinely re-dates a policy re-issues the cover from the
         * student page, one line at a time and by a person.
         */
        `UPDATE insurance_policy
            SET insurer = $3, policy_number = $4, valid_from = $5::date,
                valid_to = $6::date, cost_per_person_cents = $7, notes = $8
          WHERE id = $2 AND facility_id = $1 AND archived_at IS NULL
        RETURNING id`,
        [
          facilityId,
          policyId,
          input.insurer,
          input.policyNumber,
          input.validFrom,
          input.validTo,
          input.costPerPersonCents,
          input.notes,
        ],
      ));
    } catch (error) {
      throw duplicateFrom(error, input.policyNumber);
    }
    if (rows[0] === undefined) return false;

    await recordAudit(tx, {
      action: 'insurance_policy.updated',
      entityType: 'insurance_policy',
      entityId: policyId,
      data: { policyNumber: input.policyNumber, validTo: input.validTo },
    });
    return true;
  });
}

/** Raised when the policy still covers somebody. */
export class PolicyInUseError extends Error {
  constructor(readonly coveredCount: number) {
    super(`${coveredCount} students are covered by this policy`);
  }
}

export async function archivePolicy(
  organizationId: string,
  facilityId: string,
  policyId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    /*
     * A policy somebody is covered by is not filed away by accident.
     *
     * Archiving it would leave the cover lines pointing at a policy no screen
     * lists, which reads on the student page as insurance that came from
     * nowhere. Refused with the number, so the operator knows the size of what
     * they are about to do rather than only that they may not.
     */
    const { rows: used } = await tx.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM student_fee
        WHERE insurance_policy_id = $1 AND archived_at IS NULL`,
      [policyId],
    );
    const covered = used[0]?.count ?? 0;
    if (covered > 0) throw new PolicyInUseError(covered);

    const { rows } = await tx.query<{ id: string }>(
      `UPDATE insurance_policy SET archived_at = now()
        WHERE id = $2 AND facility_id = $1 AND archived_at IS NULL
      RETURNING id`,
      [facilityId, policyId],
    );
    if (rows[0] === undefined) return false;

    await recordAudit(tx, {
      action: 'insurance_policy.archived',
      entityType: 'insurance_policy',
      entityId: policyId,
    });
    return true;
  });
}
