import { withPlatform } from '@poolse/db';

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
  return withPlatform(async (tx) => {
    try {
      const { rows } = await tx.query<{ membership_id: string; organization_id: string }>(
        `SELECT support_session($1, $2, $3) AS membership_id,
                (SELECT organization_id FROM support_grant WHERE id = $2) AS organization_id`,
        [clerkUserId, grantId, action],
      );
      return { membershipId: rows[0]!.membership_id, organizationId: rows[0]!.organization_id };
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.startsWith('support_not_platform_admin')) {
        throw new SupportSessionRefused('not_platform_admin');
      }
      if (message.startsWith('support_grant_not_live')) throw new SupportSessionRefused('grant_not_live');
      if (message.startsWith('support_already_member')) throw new SupportSessionRefused('already_member');
      if (message.startsWith('support_not_entered')) throw new SupportSessionRefused('not_entered');
      throw error;
    }
  });
}
