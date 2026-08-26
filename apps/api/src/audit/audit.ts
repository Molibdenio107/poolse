import { Logger } from '@nestjs/common';
import { withOrg, type Tx } from '@poolse/db';
import { currentTenant } from '../tenant/tenant.context.js';

const logger = new Logger('Audit');

export interface AuditEntry {
  /** Machine key, dotted: 'invitation.created'. The UI translates it. */
  action: string;
  entityType: string;
  entityId?: string | null;
  /** Whatever makes the entry intelligible in a year. */
  data?: Record<string, unknown>;
}

/**
 * Record who did what, in the same transaction as the thing they did.
 *
 * Taking the `tx` is the whole design, and the reason this is not a service with
 * its own connection. An audit entry written on a separate connection can commit
 * while the mutation rolls back — leaving a log that says an invitation was
 * created when none was — or the reverse, which is worse. Passed the caller's
 * transaction, the entry and the change are one atomic fact.
 *
 * The actor comes from the request context rather than from arguments, because
 * "who" is never something a caller should get to decide. There is no parameter
 * to pass the wrong value to.
 *
 * Deliberately returns void and is deliberately awaited. An audit write that
 * fails should fail the mutation: a change nobody can account for is worse than
 * a change that did not happen.
 */
export async function recordAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  const { organizationId, membershipId, appUserId } = currentTenant();

  await tx.query(
    `INSERT INTO audit_log (
       organization_id, actor_membership_id, actor_app_user_id,
       action, entity_type, entity_id, data
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      organizationId,
      membershipId,
      appUserId,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      JSON.stringify(entry.data ?? {}),
    ],
  );
}

/**
 * Records something that did NOT happen.
 *
 * Everything else in this file insists on being handed the caller's transaction,
 * because an audit entry and the change it describes have to commit together.
 * This is the exception that proves it: a refused request has no transaction to
 * join, and the whole point of the entry is that nothing was written.
 *
 * Used for attempts the API turns away and wants a record of — someone trying to
 * grant themselves `owner`, for instance. Deliberately swallows its own failures:
 * an audit write must never turn a clean 400 into a 500.
 */
export async function recordRefusedAttempt(
  organizationId: string,
  entry: AuditEntry,
): Promise<void> {
  const { membershipId, appUserId } = currentTenant();

  try {
    await withOrg(organizationId, async (tx) => {
      await tx.query(
        `INSERT INTO audit_log (
           organization_id, actor_membership_id, actor_app_user_id,
           action, entity_type, entity_id, data
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          organizationId,
          membershipId,
          appUserId,
          entry.action,
          entry.entityType,
          entry.entityId ?? null,
          JSON.stringify(entry.data ?? {}),
        ],
      );
    });
  } catch (error) {
    logger.error(
      `Could not record refused attempt "${entry.action}": ` +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}
