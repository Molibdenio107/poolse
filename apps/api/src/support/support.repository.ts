import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { personShortName } from '../people/names.js';

/**
 * Acesso de suporte — POOLSE-79, the club's side.
 *
 * The Owner opens a window during which Poolse support may enter the club, sees
 * every window there has been, and closes one early. Entering is the platform's
 * side (`support_session`, in SQL). Nothing here creates a membership.
 *
 * A grant's state is derived, never stored. Expiry is the clock passing
 * `expires_at`, and nothing writes it — the same reading `resolve_memberships`
 * makes on every request, which is what ends a session on time.
 */

/** The three windows an Owner can choose. Anything else is refused. */
export const GRANT_HOURS = [24, 72, 168] as const;
export type GrantHours = (typeof GRANT_HOURS)[number];

export type GrantState = 'live' | 'expired' | 'revoked' | 'ended';

export interface SupportGrant {
  id: string;
  source: 'owner' | 'request' | 'override';
  reason: string | null;
  startsAt: string;
  expiresAt: string;
  endedAt: string | null;
  state: GrantState;
  grantedByName: string | null;
}

/** The one definition of a grant's state, in SQL, beside `resolve_memberships`'s. */
const STATE = `CASE
  WHEN sg.ended_by = 'owner'   THEN 'revoked'
  WHEN sg.ended_by = 'support' THEN 'ended'
  WHEN sg.expires_at <= now()  THEN 'expired'
  ELSE 'live'
END`;

interface GrantRow {
  id: string;
  source: SupportGrant['source'];
  reason: string | null;
  starts_at: Date;
  expires_at: Date;
  ended_at: Date | null;
  state: GrantState;
  granted_by_name: string | null;
}

function toGrant(row: GrantRow): SupportGrant {
  return {
    id: row.id,
    source: row.source,
    reason: row.reason,
    startsAt: row.starts_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    endedAt: row.ended_at?.toISOString() ?? null,
    state: row.state,
    grantedByName: row.granted_by_name,
  };
}

/**
 * Every window this club has opened, newest first. Exempt from pagination
 * under CONVENTIONS' rule: it grows by a handful a year, not with the club's
 * people. Capped all the same.
 */
export async function listGrants(organizationId: string): Promise<SupportGrant[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<GrantRow>(
      `SELECT sg.id, sg.source, sg.reason, sg.starts_at, sg.expires_at, sg.ended_at,
              ${STATE} AS state,
              CASE WHEN sg.granted_by_membership_id IS NULL THEN NULL
                   ELSE ${personShortName('sg.granted_by_membership_id')} END AS granted_by_name
         FROM support_grant sg
        ORDER BY sg.created_at DESC
        LIMIT 50`,
    );
    return rows.map(toGrant);
  });
}

export class GrantAlreadyLiveError extends Error {
  constructor(readonly expiresAt: string) {
    super('grant_live');
  }
}

/**
 * Opens a window, starting now. One live window at a time: a second would be two
 * answers to "until when is support in", so it is refused and names the first.
 */
export async function openGrant(
  organizationId: string,
  grantedByMembershipId: string,
  hours: GrantHours,
): Promise<SupportGrant> {
  return withOrg(organizationId, async (tx) => {
    // Two Owners' clicks at once cannot both find "none live".
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext('support_grant:' || $1))`, [
      organizationId,
    ]);

    const { rows: live } = await tx.query<{ expires_at: Date }>(
      `SELECT expires_at FROM support_grant sg
        WHERE sg.ended_at IS NULL AND sg.starts_at <= now() AND sg.expires_at > now()
        LIMIT 1`,
    );
    if (live[0] !== undefined) throw new GrantAlreadyLiveError(live[0].expires_at.toISOString());

    const { rows } = await tx.query<GrantRow>(
      `INSERT INTO support_grant (organization_id, source, granted_by_membership_id, expires_at)
       VALUES ($1, 'owner', $2, now() + make_interval(hours => $3))
       RETURNING id, source, reason, starts_at, expires_at, ended_at, 'live' AS state,
                 NULL::text AS granted_by_name`,
      [organizationId, grantedByMembershipId, hours],
    );
    const grant = toGrant(rows[0]!);

    await recordAudit(tx, {
      action: 'support.granted',
      entityType: 'support_grant',
      entityId: grant.id,
      data: { hours, expiresAt: grant.expiresAt },
    });
    return grant;
  });
}

/**
 * Closes a live window now. Effective on support's next request, because that
 * request asks `resolve_memberships` again. `false` when there was no live
 * window by that id — already over, or another club's.
 */
export async function revokeGrant(organizationId: string, grantId: string): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE support_grant SET ended_at = now(), ended_by = 'owner'
        WHERE id = $1 AND ended_at IS NULL AND expires_at > now()
      RETURNING id`,
      [grantId],
    );
    if (rows[0] === undefined) return false;

    await recordAudit(tx, {
      action: 'support.revoked',
      entityType: 'support_grant',
      entityId: grantId,
    });
    return true;
  });
}
