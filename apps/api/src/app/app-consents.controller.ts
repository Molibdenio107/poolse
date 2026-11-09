import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { withOrg, type Tx } from '@poolse/db';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireRole } from '../tenant/roles.js';
import { CoreRoute } from '../tenant/modules.js';
import { recordAudit } from '../audit/audit.js';

export interface ConsentToConfirm {
  id: string;
  kind: string;
  grantedAt: string;
  grantedByName: string | null;
}

/**
 * The consents a parent signed, for the young adult to confirm or withdraw —
 * POOLSE-208 rule 1. Only the student's own login, only on the adult path, only
 * a consent `consent_awaits_self()` names: a parent, an instructor or another
 * student is refused (403 by role, 404 for anything not theirs).
 *
 * A consent is a record, never a boolean: *Confirmar* withdraws the parent's
 * and writes a new one granted by the student, in one transaction; *Retirar*
 * withdraws it, and a withdrawn photo consent stops the photo at once.
 */
@CoreRoute()
@Controller('app/consents')
export class AppConsentsController {
  @Get()
  async list(): Promise<{ consents: ConsentToConfirm[] }> {
    requireRole('student');
    const { organizationId, membershipId } = currentTenant();
    return withOrg(organizationId, async (tx) => {
      const { rows } = await tx.query<ConsentToConfirm>(
        `SELECT c.id, c.kind::text AS kind, c.granted_at AS "grantedAt",
                person_name(c.granted_by_membership_id) AS "grantedByName"
           FROM consent c
           JOIN student s ON s.id = c.student_id AND s.organization_id = c.organization_id
          WHERE s.membership_id = $1 AND s.archived_at IS NULL
            AND consent_awaits_self(c.organization_id, c.id)
          ORDER BY c.kind`,
        [membershipId],
      );
      return { consents: rows };
    });
  }

  @Post(':consentId/confirm')
  async confirm(@Param('consentId', ParseUUIDPipe) consentId: string): Promise<{ confirmed: true }> {
    requireRole('student');
    const { organizationId, membershipId } = currentTenant();
    await withOrg(organizationId, async (tx) => {
      const found = await mine(tx, membershipId, consentId);
      await tx.query(
        `UPDATE consent SET withdrawn_at = now(), withdrawn_by_membership_id = $2 WHERE id = $1`,
        [consentId, membershipId],
      );
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO consent (organization_id, student_id, kind, granted, granted_by_membership_id, evidence_note)
         VALUES ($1, $2, $3::consent_kind, true, $4, 'Confirmado pelo próprio na app, aos 18 anos.')
         RETURNING id`,
        [organizationId, found.studentId, found.kind, membershipId],
      );
      await recordAudit(tx, {
        action: 'consent.confirmed_at_majority',
        entityType: 'student',
        entityId: found.studentId,
        data: { kind: found.kind, replaced: consentId, consentId: rows[0]!.id },
      });
    });
    return { confirmed: true };
  }

  @Post(':consentId/withdraw')
  async withdraw(@Param('consentId', ParseUUIDPipe) consentId: string): Promise<{ withdrawn: true }> {
    requireRole('student');
    const { organizationId, membershipId } = currentTenant();
    await withOrg(organizationId, async (tx) => {
      const found = await mine(tx, membershipId, consentId);
      await tx.query(
        `UPDATE consent SET withdrawn_at = now(), withdrawn_by_membership_id = $2 WHERE id = $1`,
        [consentId, membershipId],
      );
      await recordAudit(tx, {
        action: 'consent.withdrawn_at_majority',
        entityType: 'student',
        entityId: found.studentId,
        data: { kind: found.kind, consentId },
      });
    });
    return { withdrawn: true };
  }
}

/** The consent, if it is this login's own and awaits them; a 404 otherwise. Locks it. */
async function mine(
  tx: Tx,
  membershipId: string,
  consentId: string,
): Promise<{ studentId: string; kind: string }> {
  const { rows } = await tx.query<{ studentId: string; kind: string }>(
    `SELECT c.student_id AS "studentId", c.kind::text AS kind
       FROM consent c
       JOIN student s ON s.id = c.student_id AND s.organization_id = c.organization_id
      WHERE c.id = $1 AND s.membership_id = $2 AND s.archived_at IS NULL
        AND consent_awaits_self(c.organization_id, c.id)
      FOR UPDATE OF c`,
    [consentId, membershipId],
  );
  if (rows[0] === undefined) throw new NotFoundException('No such consent to confirm');
  return rows[0];
}
