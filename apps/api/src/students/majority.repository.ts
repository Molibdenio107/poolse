import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';

/**
 * *Fez 18 anos* — POOLSE-207 (Rui, 09-11-2026).
 *
 * Who is pending is `majority_pending()` in SQL, and nothing here restates it:
 * the list, the circle and the review all ask the database. A review names the
 * majority it answers, so a corrected birth date asks again and the same one
 * never asks twice.
 */

export type MajorityAction = 'confirmed' | 'accompanying' | 'invited';
export const MAJORITY_ACTIONS: readonly MajorityAction[] = ['confirmed', 'accompanying', 'invited'];

export interface TurnedOfAge {
  studentId: string;
  name: string;
  /** The birthday at the club's age of majority, `yyyy-MM-dd`. */
  majorityOn: string;
  /** The parents whose links stopped granting on that day. */
  parents: { linkId: string; membershipId: string; name: string; relationship: string | null }[];
  /** Whether *Convidar para a app* applies: an email on the record, no login, no live invitation. */
  invitable: boolean;
}

/** Every student pending review, oldest majority first. */
export async function listTurnedOfAge(organizationId: string): Promise<TurnedOfAge[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<TurnedOfAge>(
      `SELECT s.id AS "studentId",
              btrim(s.first_name || ' ' || s.last_name) AS name,
              p.majority_on::text AS "majorityOn",
              coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                         'linkId', g.id, 'membershipId', g.guardian_membership_id,
                         'name', person_name(g.guardian_membership_id), 'relationship', g.relationship)
                         ORDER BY g.is_primary DESC, g.created_at)
                  FROM guardian_link g
                 WHERE g.organization_id = s.organization_id AND g.student_id = s.id
                   AND g.archived_at IS NULL AND g.kind = 'parental'), '[]'::jsonb) AS parents,
              (nullif(btrim(coalesce(person_email(s.membership_id), s.contact_email)::text), '') IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM membership m
                                WHERE m.id = s.membership_id AND m.organization_id = s.organization_id
                                  AND m.app_user_id IS NOT NULL)
               AND NOT EXISTS (SELECT 1 FROM invitation i
                                WHERE i.organization_id = s.organization_id
                                  AND i.membership_id = s.membership_id
                                  AND i.accepted_at IS NULL AND i.revoked_at IS NULL
                                  AND i.expires_at > now())) AS invitable
         FROM majority_pending($1) p
         JOIN student s ON s.id = p.student_id AND s.organization_id = $1
        ORDER BY p.majority_on, s.last_name, s.first_name`,
      [organizationId],
    );
    return rows;
  });
}

/** Whether a student is pending, inside a transaction: the majority it would answer, or null. */
async function pendingMajority(tx: Tx, organizationId: string, studentId: string): Promise<string | null> {
  const { rows } = await tx.query<{ majority_on: string }>(
    `SELECT majority_on::text FROM majority_pending($1) WHERE student_id = $2`,
    [organizationId, studentId],
  );
  return rows[0]?.majority_on ?? null;
}

/**
 * The office acts on one row. *É acompanhante* turns the parental links
 * accompanying in the same transaction; every action is on the record, each
 * kind change as its own entry so Atividade can put it back.
 */
export async function reviewMajority(
  organizationId: string,
  reviewer: string,
  studentId: string,
  action: MajorityAction,
): Promise<'done' | 'not_pending'> {
  return withOrg(organizationId, async (tx) => {
    const majorityOn = await pendingMajority(tx, organizationId, studentId);
    if (majorityOn === null) return 'not_pending';

    if (action === 'accompanying') {
      const { rows: links } = await tx.query<{ id: string }>(
        `UPDATE guardian_link SET kind = 'accompanying'
          WHERE organization_id = $1 AND student_id = $2 AND archived_at IS NULL AND kind = 'parental'
          RETURNING id`,
        [organizationId, studentId],
      );
      for (const link of links) {
        await recordAudit(tx, {
          action: 'guardian.kind_changed',
          entityType: 'student',
          entityId: studentId,
          data: { linkId: link.id, before: { kind: 'parental' }, after: { kind: 'accompanying' } },
        });
      }
    }

    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO majority_review (organization_id, student_id, majority_on, action, reviewed_by)
       VALUES ($1, $2, $3::date, $4::majority_review_action, $5)
       RETURNING id`,
      [organizationId, studentId, majorityOn, action, reviewer],
    );
    await recordAudit(tx, {
      action: 'student.majority_reviewed',
      entityType: 'student',
      entityId: studentId,
      data: { reviewId: rows[0]!.id, majorityOn, before: { majorityReview: null }, after: { majorityReview: action } },
    });
    return 'done';
  });
}

/**
 * *Retirar acompanhante* — POOLSE-207 rule 3. Archives one accompanying link of
 * an adult, on the record. Never a gate: the warning that offers it blocks
 * nothing.
 */
export async function removeAcompanhante(
  organizationId: string,
  studentId: string,
  linkId: string,
): Promise<'done' | 'not_found'> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ guardian_membership_id: string }>(
      `UPDATE guardian_link SET archived_at = now()
        WHERE id = $1 AND student_id = $2 AND organization_id = $3
          AND archived_at IS NULL AND kind = 'accompanying'
        RETURNING guardian_membership_id`,
      [linkId, studentId, organizationId],
    );
    if (rows[0] === undefined) return 'not_found';
    await recordAudit(tx, {
      action: 'guardian.removed',
      entityType: 'student',
      entityId: studentId,
      data: { linkId, kind: 'accompanying', guardianMembershipId: rows[0].guardian_membership_id },
    });
    return 'done';
  });
}
