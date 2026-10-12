import { withPlatform } from '@poolse/db';
import { deliverAlert, recordAlert, type RecordedAlert } from './platform-alert.js';
import { nameMatches } from './platform.repository.js';

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

// ---------------------------------------------------------------------------
// Requests and overrides — slice 2
// ---------------------------------------------------------------------------

/** An override lasts exactly this long, by CHECK. Renewing it is another override. */
export const OVERRIDE_HOURS = 4;
const REQUEST_LAPSES_AFTER_DAYS = 7;

type PlatformTx = Parameters<Parameters<typeof withPlatform>[0]>[0];

export interface TenantSupport {
  live: { grantId: string; source: OpenSupportGrant['source']; expiresAt: string } | null;
  pendingRequest: { id: string; reason: string; requestedAt: string } | null;
}

/** What `/admin/tenants/[id]` shows about support for one club. */
export async function tenantSupport(organizationId: string): Promise<TenantSupport> {
  return withPlatform(async (tx) => {
    const { rows: live } = await tx.query<{
      id: string;
      source: OpenSupportGrant['source'];
      expires_at: Date;
    }>(
      `SELECT id, source, expires_at FROM support_grant
        WHERE organization_id = $1 AND ended_at IS NULL
          AND starts_at <= now() AND expires_at > now()
        ORDER BY expires_at DESC LIMIT 1`,
      [organizationId],
    );
    const { rows: pending } = await tx.query<{ id: string; reason: string; created_at: Date }>(
      `SELECT id, reason, created_at FROM support_request
        WHERE organization_id = $1 AND answered_at IS NULL
          AND created_at > now() - make_interval(days => $2)
        ORDER BY created_at DESC LIMIT 1`,
      [organizationId, REQUEST_LAPSES_AFTER_DAYS],
    );
    const open = live[0];
    const asked = pending[0];
    return {
      live:
        open === undefined
          ? null
          : { grantId: open.id, source: open.source, expiresAt: open.expires_at.toISOString() },
      pendingRequest:
        asked === undefined
          ? null
          : { id: asked.id, reason: asked.reason, requestedAt: asked.created_at.toISOString() },
    };
  });
}

export type SupportAskRefusal =
  | 'not_platform_admin'
  | 'no_such_tenant'
  | 'reason_required'
  | 'name_mismatch'
  | 'request_pending'
  | 'grant_live';

export class SupportAskRefused extends Error {
  constructor(readonly reason: SupportAskRefusal) {
    super(reason);
  }
}

async function operatorId(tx: PlatformTx, clerkUserId: string): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM platform_admin WHERE clerk_user_id = $1 AND archived_at IS NULL`,
    [clerkUserId],
  );
  if (rows[0] === undefined) throw new SupportAskRefused('not_platform_admin');
  return rows[0].id;
}

async function clubName(tx: PlatformTx, organizationId: string): Promise<string> {
  const { rows } = await tx.query<{ name: string }>(
    `SELECT name FROM organization WHERE id = $1 AND archived_at IS NULL`,
    [organizationId],
  );
  if (rows[0] === undefined) throw new SupportAskRefused('no_such_tenant');
  return rows[0].name;
}

async function liveGrantExists(tx: PlatformTx, organizationId: string): Promise<boolean> {
  const { rows } = await tx.query(
    `SELECT 1 FROM support_grant
      WHERE organization_id = $1 AND ended_at IS NULL AND starts_at <= now() AND expires_at > now()`,
    [organizationId],
  );
  return rows.length > 0;
}

function readReason(reason: unknown): string {
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (text === '' || text.length > 500) throw new SupportAskRefused('reason_required');
  return text;
}

/**
 * Runs one platform write, raising its alert in the same transaction, and a
 * `denied` alert of its own when it is refused: every platform write and
 * refusal raises one (POOLSE-64). Both are emailed after commit.
 */
async function alerted<T>(
  clerkUserId: string,
  organizationId: string,
  action: string,
  write: (tx: PlatformTx) => Promise<{ value: T; detail: Record<string, unknown>; name: string }>,
): Promise<T> {
  let recorded: RecordedAlert;
  let value: T;
  try {
    [value, recorded] = await withPlatform(async (tx) => {
      const done = await write(tx);
      const alert = await recordAlert(tx, {
        kind: 'write',
        action,
        clerkUserId,
        organizationId,
        organizationName: done.name,
        detail: done.detail,
      });
      return [done.value, alert] as const;
    });
  } catch (error) {
    if (!(error instanceof SupportAskRefused)) throw error;
    const denied = await withPlatform((tx) =>
      recordAlert(tx, {
        kind: 'denied',
        action,
        clerkUserId,
        organizationId: error.reason === 'no_such_tenant' ? null : organizationId,
        organizationName: null,
        detail: { reason: error.reason },
      }),
    );
    await deliverAlert(denied);
    throw error;
  }
  await deliverAlert(recorded);
  return value;
}

/**
 * *Pedir acesso*: asks the club's Owner to open a window. It opens nothing by
 * itself. One pending request at a time, and none while a window is open.
 */
export async function requestAccess(
  clerkUserId: string,
  organizationId: string,
  reasonInput: unknown,
): Promise<{ requestId: string }> {
  return alerted(clerkUserId, organizationId, 'support.requested', async (tx) => {
    const admin = await operatorId(tx, clerkUserId);
    const name = await clubName(tx, organizationId);
    const reason = readReason(reasonInput);

    if (await liveGrantExists(tx, organizationId)) throw new SupportAskRefused('grant_live');
    const { rows: pending } = await tx.query(
      `SELECT 1 FROM support_request
        WHERE organization_id = $1 AND answered_at IS NULL
          AND created_at > now() - make_interval(days => $2)`,
      [organizationId, REQUEST_LAPSES_AFTER_DAYS],
    );
    if (pending.length > 0) throw new SupportAskRefused('request_pending');

    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO support_request (organization_id, requested_by_platform_admin_id, reason)
       VALUES ($1, $2, $3) RETURNING id`,
      [organizationId, admin, reason],
    );
    const requestId = rows[0]!.id;
    await tx.query(
      `INSERT INTO platform_audit_log (clerk_user_id, action, organization_id, detail)
       VALUES ($1, 'support.requested', $2, $3::jsonb)`,
      [clerkUserId, organizationId, JSON.stringify({ requestId, reason })],
    );
    return { value: { requestId }, detail: { requestId, reason }, name };
  });
}

/**
 * *Acesso de emergência*: the window the platform opens itself, for when the
 * club is broken and the Owner is not answering. It needs a reason and the
 * club's name typed back, lasts exactly 4 hours, and records a notice to
 * every Owner with the reason verbatim. Entering is then the ordinary
 * `support_session`, as with any other window.
 */
export async function overrideAccess(
  clerkUserId: string,
  organizationId: string,
  reasonInput: unknown,
  confirmName: string | undefined,
): Promise<{ grantId: string; expiresAt: string }> {
  return alerted(clerkUserId, organizationId, 'support.override', async (tx) => {
    const admin = await operatorId(tx, clerkUserId);
    const name = await clubName(tx, organizationId);
    const reason = readReason(reasonInput);
    if (!nameMatches(confirmName, name)) throw new SupportAskRefused('name_mismatch');
    if (await liveGrantExists(tx, organizationId)) throw new SupportAskRefused('grant_live');

    // Who the notice is owed to, snapshotted now: "who was told" is not
    // recoverable once that person has left.
    const { rows: owners } = await tx.query<{ email: string }>(
      `SELECT DISTINCT coalesce(u.cached_email::text, m.email::text) AS email
         FROM membership m
         JOIN membership_role r ON r.membership_id = m.id AND r.organization_id = m.organization_id
                               AND r.role = 'owner' AND r.archived_at IS NULL
         LEFT JOIN app_user u ON u.id = m.app_user_id
        WHERE m.organization_id = $1 AND m.archived_at IS NULL
          AND coalesce(u.cached_email::text, m.email::text) IS NOT NULL`,
      [organizationId],
    );

    const { rows } = await tx.query<{ id: string; expires_at: Date }>(
      `INSERT INTO support_grant (organization_id, source, requested_by_platform_admin_id, reason,
                                  starts_at, expires_at, notice_recipients)
       VALUES ($1, 'override', $2, $3, now(), now() + make_interval(hours => $4), $5::text[])
       RETURNING id, expires_at`,
      [organizationId, admin, reason, OVERRIDE_HOURS, owners.map((row) => row.email)],
    );
    const grant = rows[0]!;
    await tx.query(
      `INSERT INTO platform_audit_log (clerk_user_id, action, organization_id, detail)
       VALUES ($1, 'support.override', $2, $3::jsonb)`,
      [clerkUserId, organizationId, JSON.stringify({ grantId: grant.id, reason })],
    );
    return {
      value: { grantId: grant.id, expiresAt: grant.expires_at.toISOString() },
      detail: { grantId: grant.id, reason, noticeRecipients: owners.length },
      name,
    };
  });
}
