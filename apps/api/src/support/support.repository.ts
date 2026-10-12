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
  /** An override only: how many Owners the notice was owed to, and whether it left. */
  notice: { recipients: number; delivered: boolean } | null;
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
  notice_recipients?: string[] | null;
  notice_delivered_at?: Date | null;
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
    notice:
      row.notice_recipients === null || row.notice_recipients === undefined
        ? null
        : { recipients: row.notice_recipients.length, delivered: row.notice_delivered_at != null },
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
              ${STATE} AS state, sg.notice_recipients, sg.notice_delivered_at,
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

// ---------------------------------------------------------------------------
// Requests — slice 2
// ---------------------------------------------------------------------------

/** A request lapses after this many days unanswered. Derived, never written. */
export const REQUEST_LAPSES_AFTER_DAYS = 7;

export interface SupportRequest {
  id: string;
  reason: string;
  requestedAt: string;
}

/** What Poolse support has asked for and nobody has answered yet. */
export async function pendingRequests(organizationId: string): Promise<SupportRequest[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string; reason: string; created_at: Date }>(
      `SELECT id, reason, created_at FROM support_request
        WHERE answered_at IS NULL
          AND created_at > now() - make_interval(days => $1)
        ORDER BY created_at`,
      [REQUEST_LAPSES_AFTER_DAYS],
    );
    return rows.map((row) => ({
      id: row.id,
      reason: row.reason,
      requestedAt: row.created_at.toISOString(),
    }));
  });
}

export class RequestNotPendingError extends Error {
  constructor() {
    super('request_not_pending');
  }
}

/**
 * Approves a request with the Owner's choice of window. The window is an
 * ordinary grant, `source = 'request'`, carrying the request's reason and who
 * asked, so the history reads "Poolse asked, because …; the Owner said yes".
 */
export async function approveRequest(
  organizationId: string,
  membershipId: string,
  requestId: string,
  hours: GrantHours,
): Promise<SupportGrant> {
  return withOrg(organizationId, async (tx) => {
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext('support_grant:' || $1))`, [
      organizationId,
    ]);

    const { rows: requests } = await tx.query<{
      reason: string;
      requested_by_platform_admin_id: string;
    }>(
      `SELECT reason, requested_by_platform_admin_id FROM support_request
        WHERE id = $1 AND answered_at IS NULL
          AND created_at > now() - make_interval(days => $2)
        FOR UPDATE`,
      [requestId, REQUEST_LAPSES_AFTER_DAYS],
    );
    const request = requests[0];
    if (request === undefined) throw new RequestNotPendingError();

    const { rows: live } = await tx.query<{ expires_at: Date }>(
      `SELECT expires_at FROM support_grant
        WHERE ended_at IS NULL AND starts_at <= now() AND expires_at > now()
        LIMIT 1`,
    );
    if (live[0] !== undefined) throw new GrantAlreadyLiveError(live[0].expires_at.toISOString());

    const { rows } = await tx.query<GrantRow>(
      `INSERT INTO support_grant (organization_id, source, requested_by_platform_admin_id,
                                  granted_by_membership_id, reason, expires_at)
       VALUES ($1, 'request', $2, $3, $4, now() + make_interval(hours => $5))
       RETURNING id, source, reason, starts_at, expires_at, ended_at, 'live' AS state,
                 NULL::text AS granted_by_name`,
      [organizationId, request.requested_by_platform_admin_id, membershipId, request.reason, hours],
    );
    const grant = toGrant(rows[0]!);

    await tx.query(
      `UPDATE support_request
          SET answered_at = now(), answer = 'approved', answered_by_membership_id = $2, grant_id = $3
        WHERE id = $1`,
      [requestId, membershipId, grant.id],
    );

    await recordAudit(tx, {
      action: 'support.request.approved',
      entityType: 'support_request',
      entityId: requestId,
      data: { grantId: grant.id, hours, expiresAt: grant.expiresAt },
    });
    return grant;
  });
}

export async function declineRequest(
  organizationId: string,
  membershipId: string,
  requestId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE support_request
          SET answered_at = now(), answer = 'declined', answered_by_membership_id = $2
        WHERE id = $1 AND answered_at IS NULL
          AND created_at > now() - make_interval(days => $3)
      RETURNING id`,
      [requestId, membershipId, REQUEST_LAPSES_AFTER_DAYS],
    );
    if (rows[0] === undefined) return false;
    await recordAudit(tx, {
      action: 'support.request.declined',
      entityType: 'support_request',
      entityId: requestId,
    });
    return true;
  });
}

/**
 * What the club's own strip says: whether support may be in right now, and
 * whether it has asked. Read by the Owner and the Admins, so the window's end
 * and its source, and nothing else.
 */
export async function supportStatus(
  organizationId: string,
): Promise<{
  live: { id: string; expiresAt: string; source: SupportGrant['source'] } | null;
  pendingRequests: number;
}> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string; expires_at: Date; source: SupportGrant['source'] }>(
      `SELECT id, expires_at, source FROM support_grant
        WHERE ended_at IS NULL AND starts_at <= now() AND expires_at > now()
        ORDER BY expires_at DESC LIMIT 1`,
    );
    const { rows: pending } = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM support_request
        WHERE answered_at IS NULL AND created_at > now() - make_interval(days => $1)`,
      [REQUEST_LAPSES_AFTER_DAYS],
    );
    const live = rows[0];
    return {
      live:
        live === undefined
          ? null
          : { id: live.id, expiresAt: live.expires_at.toISOString(), source: live.source },
      pendingRequests: pending[0]?.n ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// What support did — slice 3
// ---------------------------------------------------------------------------

export interface SupportActivity {
  id: string;
  /** The audit action's machine key — `student.archived`. */
  action: string;
  entityType: string;
  at: string;
  byName: string;
}

/**
 * Every entry in the club's own log written by a support membership, newest
 * first. The trail needed nothing new: `recordAudit` names the support
 * membership as actor, so this is a filter on who, not a second log.
 */
export async function supportActivity(organizationId: string): Promise<SupportActivity[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      action: string;
      entity_type: string;
      created_at: Date;
      by_name: string;
    }>(
      `SELECT a.id, a.action, a.entity_type, a.created_at,
              ${personShortName('a.actor_membership_id')} AS by_name
         FROM audit_log a
         JOIN membership m ON m.id = a.actor_membership_id AND m.organization_id = a.organization_id
        WHERE m.support_grant_id IS NOT NULL
        ORDER BY a.created_at DESC
        LIMIT 100`,
    );
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entity_type,
      at: row.created_at.toISOString(),
      byName: row.by_name,
    }));
  });
}
