import { withPlatform } from '@poolse/db';
import { deliverAlert, recordAlert, type RecordedAlert } from './platform-alert.js';

/**
 * Support access, the operator's side — POOLSE-79.
 *
 * The platform login reads `support_grant` (one SELECT, for this list) and
 * calls `support_session`, which re-checks everything in SQL: a live platform
 * admin, a live grant, not already a member. It writes nothing else. The
 * membership it creates is then used through the ordinary tenant path, so the
 * club's RLS, role checks and `audit_log` apply to support exactly as to
 * anybody else.
 */

export interface OpenSupportGrant {
  grantId: string;
  organizationId: string;
  organizationName: string;
  source: 'owner' | 'request' | 'override';
  expiresAt: string;
}

/** Every club with a live window, soonest to close first. */
export async function listOpenGrants(): Promise<OpenSupportGrant[]> {
  return withPlatform(async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      organization_id: string;
      name: string;
      source: OpenSupportGrant['source'];
      expires_at: Date;
    }>(
      `SELECT sg.id, sg.organization_id, o.name, sg.source, sg.expires_at
         FROM support_grant sg
         JOIN organization o ON o.id = sg.organization_id AND o.archived_at IS NULL
        WHERE sg.ended_at IS NULL AND sg.starts_at <= now() AND sg.expires_at > now()
        ORDER BY sg.expires_at`,
    );
    return rows.map((row) => ({
      grantId: row.id,
      organizationId: row.organization_id,
      organizationName: row.name,
      source: row.source,
      expiresAt: row.expires_at.toISOString(),
    }));
  });
}

export type SupportRefusal = 'not_platform_admin' | 'grant_not_live' | 'already_member' | 'not_entered';

export class SupportSessionRefused extends Error {
  constructor(readonly reason: SupportRefusal) {
    super(reason);
  }
}

/**
 * Enters or leaves through one grant. Returns the support membership and the
 * club it belongs to, so the screen can switch to it.
 */
export async function supportSession(
  clerkUserId: string,
  grantId: string,
  action: 'enter' | 'leave',
): Promise<{ membershipId: string; organizationId: string }> {
  /*
   * Every platform write and every refusal raises an alert (POOLSE-64).
   * Entering a club opens its data, so it is the write that most needs one.
   * The alert is written in the same transaction as the entry, a refusal's in a
   * transaction of its own (the refused one rolled back), and both are emailed
   * after commit.
   */
  let alert: RecordedAlert;
  let result: { membershipId: string; organizationId: string };
  try {
    [result, alert] = await withPlatform(async (tx) => {
      // The function first and on its own: it is what refuses an unknown grant,
      // and a join to the grant would skip calling it at all.
      const { rows: entered } = await tx.query<{ membership_id: string }>(
        `SELECT support_session($1, $2, $3) AS membership_id`,
        [clerkUserId, grantId, action],
      );
      const { rows } = await tx.query<{ organization_id: string; organization_name: string }>(
        `SELECT sg.organization_id, o.name AS organization_name
           FROM support_grant sg JOIN organization o ON o.id = sg.organization_id
          WHERE sg.id = $1`,
        [grantId],
      );
      const row = { membership_id: entered[0]!.membership_id, ...rows[0]! };
      const recorded = await recordAlert(tx, {
        kind: 'write',
        action: `support.${action === 'enter' ? 'entered' : 'ended'}`,
        clerkUserId,
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        detail: { grantId },
      });
      return [{ membershipId: row.membership_id, organizationId: row.organization_id }, recorded];
    });
  } catch (error) {
    const reason = refusalOf(error);
    if (reason === null) throw error;
    const denied = await withPlatform((tx) =>
      recordAlert(tx, {
        kind: 'denied',
        action: `support.${action}`,
        clerkUserId,
        organizationId: null,
        organizationName: null,
        detail: { grantId, reason },
      }),
    );
    await deliverAlert(denied);
    throw new SupportSessionRefused(reason);
  }

  await deliverAlert(alert);
  return result;
}

function refusalOf(error: unknown): SupportRefusal | null {
  const message = error instanceof Error ? error.message : '';
  if (message.startsWith('support_not_platform_admin')) return 'not_platform_admin';
  if (message.startsWith('support_grant_not_live')) return 'grant_not_live';
  if (message.startsWith('support_already_member')) return 'already_member';
  if (message.startsWith('support_not_entered')) return 'not_entered';
  return null;
}
