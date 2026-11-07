import { withOrg, withPlatform } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { searchPredicate } from '../common/search.js';
import { TOTAL_COUNT, totalOf, paginated, type PageQuery, type Paginated } from '../common/pagination.js';
import { personShortName } from '../people/names.js';
import { currentTenant } from '../tenant/tenant.context.js';

/**
 * Seeing the app as a real person — POOLSE-188.
 *
 * `app_view` is the view: `resolve_memberships` reads it on every request, and
 * nothing here tells the request anything. What this file does is open a row,
 * close it, and answer the Owner's *Vistas da app*.
 */

export const APP_VIEW_HATS = ['family', 'teaching', 'maintenance'] as const;
export type AppViewHat = (typeof APP_VIEW_HATS)[number];

const PEOPLE_SHOWN = 20;

export interface ViewablePerson {
  membershipId: string;
  name: string;
}

export type StartRefusal = 'not_found' | 'owner' | 'self' | 'reader';

export class AppViewRefused extends Error {
  constructor(readonly refusal: StartRefusal) {
    super(refusal);
  }
}

/**
 * The people a reader may pick for a home: live, with a login, never a support
 * session, never themselves, and the Owner only for the Owner. The same
 * conditions `resolve_memberships` re-reads on every request.
 */
export async function viewablePeople(
  organizationId: string,
  hat: AppViewHat,
  search: string | null,
): Promise<{ people: ViewablePerson[]; more: boolean }> {
  const { membershipId, roles } = currentTenant();
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string; name: string }>(
      `SELECT m.id, ${personShortName('m.id')} AS name
         FROM membership m
         JOIN app_user u ON u.id = m.app_user_id AND u.deleted_at IS NULL
        WHERE m.archived_at IS NULL AND m.status = 'active'
          AND m.support_grant_id IS NULL
          AND m.id <> $2
          AND EXISTS (SELECT 1 FROM membership_role r
                       WHERE r.organization_id = m.organization_id AND r.membership_id = m.id
                         AND r.archived_at IS NULL
                         AND r.role = ANY (app_view_hat_roles($1::app_view_hat)))
          AND ($3 OR NOT EXISTS (SELECT 1 FROM membership_role r
                                  WHERE r.organization_id = m.organization_id AND r.membership_id = m.id
                                    AND r.archived_at IS NULL AND r.role = 'owner'))
          AND ($4::text IS NULL OR ${searchPredicate(personShortName('m.id'), '$4')})
        ORDER BY 2
        LIMIT $5`,
      [hat, membershipId, roles.includes('owner') && currentTenant().support !== true, search, PEOPLE_SHOWN + 1],
    );
    return {
      people: rows.slice(0, PEOPLE_SHOWN).map((row) => ({ membershipId: row.id, name: row.name })),
      more: rows.length > PEOPLE_SHOWN,
    };
  });
}

/**
 * Opens a view. Any open row of this reader is closed first, in the same
 * transaction: one that ran out, or whose person left, would otherwise hold the
 * one-open-view index against the new one.
 */
export async function startView(
  organizationId: string,
  input: { hat: AppViewHat; viewedMembershipId: string; reason: string | null },
): Promise<{ id: string; expiresAt: string }> {
  const { membershipId, roles, support } = currentTenant();
  if (input.viewedMembershipId === membershipId) throw new AppViewRefused('self');

  return withOrg(organizationId, async (tx) => {
    const { rows: found } = await tx.query<{
      roles: string[];
      own_student: string | null;
      has_login: boolean;
      support: boolean;
      grant_id: string | null;
    }>(
      `SELECT array_agg(r.role::text) FILTER (WHERE r.archived_at IS NULL) AS roles,
              (SELECT s.id FROM student s
                WHERE s.organization_id = m.organization_id AND s.membership_id = m.id
                  AND s.archived_at IS NULL LIMIT 1) AS own_student,
              EXISTS (SELECT 1 FROM app_user u
                       WHERE u.id = m.app_user_id AND u.deleted_at IS NULL) AS has_login,
              m.support_grant_id IS NOT NULL AS support,
              (SELECT me.support_grant_id FROM membership me WHERE me.id = $2) AS grant_id
         FROM membership m
         LEFT JOIN membership_role r
           ON r.organization_id = m.organization_id AND r.membership_id = m.id
        WHERE m.id = $1 AND m.archived_at IS NULL AND m.status = 'active'
        GROUP BY m.id`,
      [input.viewedMembershipId, membershipId],
    );
    const target = found[0];
    if (target === undefined || !target.has_login || target.support) throw new AppViewRefused('not_found');

    const { rows: holds } = await tx.query(
      `SELECT 1 FROM unnest($1::member_role[]) role
        WHERE role = ANY (app_view_hat_roles($2::app_view_hat))`,
      [target.roles ?? [], input.hat],
    );
    if (holds.length === 0) throw new AppViewRefused('not_found');

    const readerIsOwner = roles.includes('owner') && support !== true;
    if ((target.roles ?? []).includes('owner') && !readerIsOwner) throw new AppViewRefused('owner');

    await tx.query(
      `UPDATE app_view SET ended_at = now() WHERE viewer_membership_id = $1 AND ended_at IS NULL`,
      [membershipId],
    );
    const { rows } = await tx.query<{ id: string; expires_at: Date }>(
      `INSERT INTO app_view (organization_id, viewer_membership_id, viewed_membership_id, hat,
                             viewer_support_grant_id, reason)
       VALUES ($1, $2, $3, $4::app_view_hat, $5, $6)
       RETURNING id, expires_at`,
      [organizationId, membershipId, input.viewedMembershipId, input.hat, target.grant_id, input.reason],
    );
    const view = rows[0]!;

    // On the student when the person is one, so it reaches that student's
    // Atividade. Ids and a home, plus support's own reason: never a value read.
    await recordAudit(tx, {
      action: 'app_view.started',
      entityType: target.own_student === null ? 'membership' : 'student',
      entityId: target.own_student ?? input.viewedMembershipId,
      data: {
        viewId: view.id,
        hat: input.hat,
        viewedMembershipId: input.viewedMembershipId,
        support: support === true,
        ...(input.reason === null ? {} : { reason: input.reason }),
      },
    });
    return { id: view.id, expiresAt: view.expires_at.toISOString() };
  });
}

/** *Sair*. Idempotent: a view that already ran out has nothing to close. */
export async function leaveView(organizationId: string): Promise<void> {
  const { membershipId, actor, viewing } = currentTenant();
  const reader = actor?.membershipId ?? membershipId;
  await withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE app_view SET ended_at = now() WHERE viewer_membership_id = $1 AND ended_at IS NULL`,
      [reader],
    );
    if ((rowCount ?? 0) > 0 && viewing != null) {
      await recordAudit(tx, {
        action: 'app_view.ended',
        entityType: 'membership',
        entityId: membershipId,
        data: { viewId: viewing.id },
      });
    }
  });
}

/** One read through somebody's eyes, on the record before it is answered. */
export async function recordViewRead(route: string): Promise<void> {
  const { organizationId, membershipId, viewing } = currentTenant();
  await withOrg(organizationId, (tx) =>
    recordAudit(tx, {
      action: 'app_view.read',
      entityType: 'membership',
      entityId: membershipId,
      data: { viewId: viewing?.id ?? null, route },
    }),
  );
}

export async function viewedName(organizationId: string, membershipId: string): Promise<string> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ name: string }>(
      `SELECT ${personShortName('$1::uuid')} AS name`,
      [membershipId],
    );
    return rows[0]?.name ?? '';
  });
}

export interface AppViewEntry {
  id: string;
  viewerName: string;
  viewedName: string;
  hat: AppViewHat;
  support: boolean;
  reason: string | null;
  startedAt: string;
  endedAt: string;
}

/**
 * *Vistas da app*, the Owner's. A view that simply ran out has no `ended_at` and
 * reads as ended when it expired: nothing has to run for the record to be true.
 */
export async function listViews(organizationId: string, page: PageQuery): Promise<Paginated<AppViewEntry>> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      viewer: string;
      viewed: string;
      hat: AppViewHat;
      support: boolean;
      reason: string | null;
      started_at: Date;
      ended: Date;
      total_count: number;
    }>(
      `SELECT v.id, ${personShortName('v.viewer_membership_id')} AS viewer,
              ${personShortName('v.viewed_membership_id')} AS viewed,
              v.hat, v.viewer_support_grant_id IS NOT NULL AS support, v.reason, v.started_at,
              least(coalesce(v.ended_at, v.expires_at), v.expires_at) AS ended,
              ${TOTAL_COUNT}
         FROM app_view v
        ORDER BY v.started_at DESC, v.id DESC
        LIMIT $1 OFFSET $2`,
      [page.limit, page.offset],
    );
    return paginated(
      rows.map((row) => ({
        id: row.id,
        viewerName: row.viewer,
        viewedName: row.viewed,
        hat: row.hat,
        support: row.support,
        reason: row.reason,
        startedAt: row.started_at.toISOString(),
        endedAt: row.ended.toISOString(),
      })),
      totalOf(rows),
      page,
    );
  });
}

export interface SupportViewEntry {
  id: string;
  organizationName: string;
  hat: string | null;
  reason: string | null;
  startedAt: string;
}

/**
 * The views made as support, every club — Rui's, on `/admin`. Read from
 * `audit_log`, which the platform login already reads, so `poolse_platform` does
 * not widen and gets no `app_view` of its own. No person's name: which club, why
 * and when is what an operator needs to account for themselves.
 */
export async function listSupportViews(): Promise<SupportViewEntry[]> {
  return withPlatform(async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      name: string;
      hat: string | null;
      reason: string | null;
      created_at: Date;
    }>(
      `SELECT a.id, o.name, a.data->>'hat' AS hat, a.data->>'reason' AS reason, a.created_at
         FROM audit_log a
         JOIN organization o ON o.id = a.organization_id
        WHERE a.action = 'app_view.started' AND (a.data->>'support')::boolean
        ORDER BY a.created_at DESC
        LIMIT 100`,
    );
    return rows.map((row) => ({
      id: row.id,
      organizationName: row.name,
      hat: row.hat,
      reason: row.reason,
      startedAt: row.created_at.toISOString(),
    }));
  });
}
