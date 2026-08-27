import { withOrg, withoutTenantScope } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import type { MemberRole } from '../tenant/roles.js';

export interface OrganizationMember {
  membershipId: string;
  appUserId: string | null;
  status: 'invited' | 'active' | 'suspended';
  firstName: string | null;
  lastName: string | null;
  /** The account email once they have one, the invited address before that. */
  email: string | null;
  roles: string[];
  /**
   * Clerk's cached avatar. Staff only, and it needs no consent record: an
   * instructor uploaded it themselves. Student photographs are a different
   * matter entirely — see PersonAvatar on the web side.
   */
  avatarUrl: string | null;
}

export type InvitationDelivery = 'pending' | 'sent' | 'failed' | 'not_configured';

export interface PendingInvitation {
  id: string;
  email: string;
  roles: string[];
  expiresAt: string;
  createdAt: string;
  invitedByFirstName: string | null;
  invitedByLastName: string | null;
  /**
   * Whether the email actually went — backlog round 4, ticket 5.
   *
   * `not_configured` is not a failure. It means no provider is set up, the link
   * is meant to be copied by hand, and nobody should be waiting for an email
   * that was never going to arrive.
   */
  delivery: InvitationDelivery;
  deliveredAt: string | null;
}

/**
 * Records what happened to the message.
 *
 * Separate from creating the invitation, and after it: an invitation that exists
 * but was not delivered is recoverable in one click, while an invitation rolled
 * back because a mail server had a bad minute is just confusing. The send can
 * never undo the record it is announcing.
 */
export async function recordDelivery(
  organizationId: string,
  invitationId: string,
  delivery: InvitationDelivery,
): Promise<void> {
  await withOrg(organizationId, async (tx) => {
    await tx.query(
      `UPDATE invitation
          SET delivery = $2::invitation_delivery,
              delivered_at = CASE WHEN $2 = 'sent' THEN now() ELSE NULL END
        WHERE id = $1`,
      [invitationId, delivery],
    );
  });
}

/**
 * Everything in this file except the two functions at the bottom is ordinary,
 * tenant-scoped SQL inside `withOrg`. None of the queries carry a
 * `WHERE organization_id = …`, and that is not an oversight: RLS adds it, and the
 * isolation suite proves that deleting it changes nothing. Joins still carry
 * `organization_id` because composite foreign keys are the other half of the
 * design — a join that matches on id alone can match a row RLS then hides, which
 * turns a leak into a mystery rather than preventing it.
 */

export async function listMembers(organizationId: string): Promise<OrganizationMember[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      membership_id: string;
      app_user_id: string | null;
      status: OrganizationMember['status'];
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      roles: string[];
      avatar_url: string | null;
    }>(`
      SELECT m.id                AS membership_id,
             m.app_user_id       AS app_user_id,
             m.status            AS status,
             u.cached_first_name AS first_name,
             u.cached_last_name  AS last_name,
             u.cached_avatar_url AS avatar_url,
             -- Before acceptance there is no account, so the address the invite
             -- went to is the only name this person has here.
             coalesce(u.cached_email::text, i.email::text) AS email,
             coalesce(
               array_agg(mr.role::text ORDER BY mr.role::text)
                 FILTER (WHERE mr.archived_at IS NULL),
               '{}'::text[]
             ) AS roles
        FROM membership m
        LEFT JOIN app_user u
               ON u.id = m.app_user_id
        LEFT JOIN membership_role mr
               ON mr.membership_id = m.id
              AND mr.organization_id = m.organization_id
        LEFT JOIN invitation i
               ON i.membership_id = m.id
              AND i.organization_id = m.organization_id
       WHERE m.archived_at IS NULL
       GROUP BY m.id, m.app_user_id, m.status, m.created_at,
                u.cached_first_name, u.cached_last_name, u.cached_avatar_url,
                u.cached_email, i.email
       ORDER BY m.created_at
    `);

    return rows.map((row) => ({
      membershipId: row.membership_id,
      appUserId: row.app_user_id,
      status: row.status,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      roles: row.roles,
      avatarUrl: row.avatar_url,
    }));
  });
}

export async function listPendingInvitations(
  organizationId: string,
): Promise<PendingInvitation[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      email: string;
      roles: string[];
      expires_at: Date;
      created_at: Date;
      delivery: InvitationDelivery;
      delivered_at: Date | null;
      invited_by_first_name: string | null;
      invited_by_last_name: string | null;
    }>(`
      SELECT i.id,
             i.email::text AS email,
             (SELECT array_agg(r::text ORDER BY r::text) FROM unnest(i.roles) AS r) AS roles,
             i.expires_at,
             i.created_at,
             i.delivery,
             i.delivered_at,
             inviter.cached_first_name AS invited_by_first_name,
             inviter.cached_last_name  AS invited_by_last_name
        FROM invitation i
        LEFT JOIN membership inviter_m
               ON inviter_m.id = i.invited_by_membership_id
              AND inviter_m.organization_id = i.organization_id
        LEFT JOIN app_user inviter
               ON inviter.id = inviter_m.app_user_id
       WHERE i.accepted_at IS NULL
         AND i.revoked_at IS NULL
       ORDER BY i.created_at DESC
    `);

    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      roles: row.roles,
      expiresAt: row.expires_at.toISOString(),
      createdAt: row.created_at.toISOString(),
      delivery: row.delivery,
      deliveredAt: row.delivered_at?.toISOString() ?? null,
      invitedByFirstName: row.invited_by_first_name,
      invitedByLastName: row.invited_by_last_name,
    }));
  });
}

export interface OrganizationVoice {
  name: string;
  locale: string;
}

/**
 * The name and language to write the invitation email in.
 *
 * The organization decides, because the recipient has no account yet and
 * therefore no preference of their own — see the note in invitation-email.ts.
 */
export async function organizationVoice(organizationId: string): Promise<OrganizationVoice> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ name: string; locale: string }>(
      'SELECT name, locale FROM organization',
    );
    const row = rows[0];
    if (!row) throw new Error('The current organization could not be read');
    return row;
  });
}

export type TransferOutcome = 'transferred' | 'not_found' | 'not_admin' | 'already_owner';

/**
 * Hands the organization to somebody else, atomically.
 *
 * The target must already hold `admin`, deliberately: ownership is the licence,
 * and handing it to a student or a maintenance technician is far more likely to
 * be a misclick than an intention. Promote them to admin first, then transfer —
 * two deliberate steps for something that cannot be undone by anyone except the
 * new owner.
 *
 * Ordinary tenant-scoped SQL. The database function it calls does the revoke
 * before the grant, because the single-owner unique index refuses the other
 * order, and does both inside this transaction so a failure halfway cannot leave
 * the organization with no owner at all.
 */
export async function transferOwnership(
  organizationId: string,
  fromMembershipId: string,
  toMembershipId: string,
): Promise<TransferOutcome> {
  return withOrg(organizationId, async (tx) => {
    if (fromMembershipId === toMembershipId) return 'already_owner';

    const target = await tx.query<{ id: string; is_admin: boolean }>(
      `SELECT m.id,
              EXISTS (
                SELECT 1 FROM membership_role mr
                 WHERE mr.membership_id = m.id
                   AND mr.role = 'admin'
                   AND mr.archived_at IS NULL
              ) AS is_admin
         FROM membership m
        WHERE m.id = $1
          AND m.archived_at IS NULL
          AND m.status = 'active'
          AND m.app_user_id IS NOT NULL`,
      [toMembershipId],
    );

    const row = target.rows[0];
    // Also the answer for another tenant's membership id: RLS hid it, and the
    // caller learns nothing either way.
    if (!row) return 'not_found';
    if (!row.is_admin) return 'not_admin';

    await tx.query('SELECT transfer_ownership($1, $2, $3)', [
      organizationId,
      fromMembershipId,
      toMembershipId,
    ]);

    await recordAudit(tx, {
      action: 'organization.ownership_transferred',
      entityType: 'organization',
      entityId: organizationId,
      data: { from: fromMembershipId, to: toMembershipId },
    });

    return 'transferred';
  });
}

export interface CreateInvitationInput {
  organizationId: string;
  invitedByMembershipId: string;
  email: string;
  roles: readonly MemberRole[];
  tokenHash: string;
  expiresAt: Date;
}

/** Raised when a live invitation for that address already exists. */
export class DuplicateInvitationError extends Error {}

export async function createInvitation(input: CreateInvitationInput): Promise<string> {
  try {
    return await withOrg(input.organizationId, async (tx) => {
      // The membership comes first and carries status = 'invited': an invited
      // person exists in the organization before they have an account, which is
      // what makes them appear in the people list and what the roles hang off.
      const membership = await tx.query<{ id: string }>(
        `INSERT INTO membership (organization_id, status) VALUES ($1, 'invited') RETURNING id`,
        [input.organizationId],
      );
      const membershipId = membership.rows[0]?.id;
      if (!membershipId) throw new Error('Could not create the pending membership');

      await tx.query(
        `INSERT INTO membership_role (organization_id, membership_id, role)
         SELECT $1, $2, offered FROM unnest($3::member_role[]) AS offered`,
        [input.organizationId, membershipId, input.roles],
      );

      const invitation = await tx.query<{ id: string }>(
        `INSERT INTO invitation (
           organization_id, email, roles, token_hash, expires_at,
           membership_id, invited_by_membership_id
         )
         VALUES ($1, $2::citext, $3::member_role[], $4, $5, $6, $7)
         RETURNING id`,
        [
          input.organizationId,
          input.email,
          input.roles,
          input.tokenHash,
          input.expiresAt,
          membershipId,
          input.invitedByMembershipId,
        ],
      );

      const id = invitation.rows[0]?.id;
      if (!id) throw new Error('Could not create the invitation');

      // Same transaction as the insert above: the entry and the invitation are
      // one fact. The token is not recorded — an audit log readable by every
      // admin is not a place to keep a working credential.
      await recordAudit(tx, {
        action: 'invitation.created',
        entityType: 'invitation',
        entityId: id,
        data: { email: input.email, roles: input.roles, membershipId },
      });

      return id;
    });
  } catch (error) {
    // 23505 here is invitation_pending_uq: one live invite per address per
    // organization. The whole transaction rolled back, so no orphan membership
    // is left behind.
    if (error instanceof Error && (error as { code?: string }).code === '23505') {
      throw new DuplicateInvitationError(input.email);
    }
    throw error;
  }
}

export interface ReissuedInvitation {
  id: string;
  email: string;
  roles: string[];
  expiresAt: string;
}

/**
 * Withdraws a pending invitation and issues a replacement to the same address
 * with the same roles, in one transaction.
 *
 * This exists because the link is shown exactly once. The database holds only a
 * hash of the token, so nothing — not an admin, not a support query, not the
 * person who sent it — can recover the link after the page it appeared on is
 * gone. That is the right way to store a credential and the wrong way to leave a
 * product: closing the tab was a dead end with no way out but working out for
 * yourself that revoking and re-inviting was the same thing.
 *
 * One transaction, so a failure halfway cannot leave the address with no live
 * invitation at all. Returns null when there was nothing pending to replace.
 */
export async function reissueInvitation(
  organizationId: string,
  invitationId: string,
  invitedByMembershipId: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<ReissuedInvitation | null> {
  return withOrg(organizationId, async (tx) => {
    const existing = await tx.query<{ email: string; roles: string[]; membership_id: string }>(
      `UPDATE invitation
          SET revoked_at = now()
        WHERE id = $1
          AND accepted_at IS NULL
          AND revoked_at IS NULL
      RETURNING email::text AS email, roles::text[] AS roles, membership_id`,
      [invitationId],
    );

    const previous = existing.rows[0];
    if (!previous) return null;

    // Retire the placeholder membership the old invitation created, exactly as
    // revoking does — the replacement makes its own.
    await tx.query(
      `UPDATE membership_role SET archived_at = now()
        WHERE membership_id = $1 AND archived_at IS NULL`,
      [previous.membership_id],
    );
    await tx.query(
      `UPDATE membership SET archived_at = now()
        WHERE id = $1 AND archived_at IS NULL AND status = 'invited'`,
      [previous.membership_id],
    );

    const membership = await tx.query<{ id: string }>(
      `INSERT INTO membership (organization_id, status) VALUES ($1, 'invited') RETURNING id`,
      [organizationId],
    );
    const membershipId = membership.rows[0]?.id;
    if (!membershipId) throw new Error('Could not create the replacement membership');

    await tx.query(
      `INSERT INTO membership_role (organization_id, membership_id, role)
       SELECT $1, $2, offered FROM unnest($3::member_role[]) AS offered`,
      [organizationId, membershipId, previous.roles],
    );

    const created = await tx.query<{ id: string; expires_at: Date }>(
      `INSERT INTO invitation (
         organization_id, email, roles, token_hash, expires_at,
         membership_id, invited_by_membership_id
       )
       VALUES ($1, $2::citext, $3::member_role[], $4, $5, $6, $7)
       RETURNING id, expires_at`,
      [
        organizationId,
        previous.email,
        previous.roles,
        tokenHash,
        expiresAt,
        membershipId,
        invitedByMembershipId,
      ],
    );

    const row = created.rows[0];
    if (!row) throw new Error('Could not create the replacement invitation');

    await recordAudit(tx, {
      action: 'invitation.reissued',
      entityType: 'invitation',
      entityId: row.id,
      data: { email: previous.email, roles: previous.roles, replaced: invitationId },
    });

    return {
      id: row.id,
      email: previous.email,
      roles: previous.roles,
      expiresAt: row.expires_at.toISOString(),
    };
  });
}

/**
 * Revokes a pending invitation and retires the membership it created.
 *
 * Both halves matter: leaving the membership behind would keep a ghost entry in
 * the people list forever, and leaving the invitation live would keep the address
 * blocked. Returns false when there was nothing pending to revoke.
 */
export async function revokeInvitation(
  organizationId: string,
  invitationId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ membership_id: string }>(
      `UPDATE invitation
          SET revoked_at = now()
        WHERE id = $1
          AND accepted_at IS NULL
          AND revoked_at IS NULL
      RETURNING membership_id`,
      [invitationId],
    );

    const membershipId = rows[0]?.membership_id;
    if (!membershipId) return false;

    await tx.query(
      `UPDATE membership_role SET archived_at = now()
        WHERE membership_id = $1 AND archived_at IS NULL`,
      [membershipId],
    );
    await tx.query(
      `UPDATE membership SET archived_at = now()
        WHERE id = $1 AND archived_at IS NULL AND status = 'invited'`,
      [membershipId],
    );

    await recordAudit(tx, {
      action: 'invitation.revoked',
      entityType: 'invitation',
      entityId: invitationId,
      data: { membershipId },
    });

    return true;
  });
}

// ---------------------------------------------------------------------------
// The two cross-tenant calls: redemption happens before an organization is known.
// ---------------------------------------------------------------------------

export type InvitationStatus =
  | 'pending'
  | 'expired'
  | 'revoked'
  | 'already_accepted'
  | 'not_found';

export interface InvitationPreview {
  status: InvitationStatus;
  organizationName: string | null;
  email: string | null;
  roles: string[];
  expiresAt: string | null;
}

export async function findInvitationByTokenHash(
  tokenHash: string,
): Promise<InvitationPreview> {
  return withoutTenantScope(async (tx) => {
    const { rows } = await tx.query<{
      o_status: Exclude<InvitationStatus, 'not_found'>;
      o_organization_name: string;
      o_email: string;
      o_roles: string[] | null;
      o_expires_at: Date;
    }>('SELECT * FROM find_invitation_by_token($1, now())', [tokenHash]);

    const row = rows[0];
    if (!row) {
      return {
        status: 'not_found',
        organizationName: null,
        email: null,
        roles: [],
        expiresAt: null,
      };
    }

    return {
      status: row.o_status,
      organizationName: row.o_organization_name,
      email: row.o_email,
      roles: row.o_roles ?? [],
      expiresAt: row.o_expires_at.toISOString(),
    };
  });
}

export type AcceptStatus =
  | 'accepted'
  | 'expired'
  | 'revoked'
  | 'already_accepted'
  | 'not_found'
  | 'unknown_account';

export interface AcceptResult {
  status: AcceptStatus;
  organizationId: string | null;
  organizationName: string | null;
  membershipId: string | null;
}

export async function acceptInvitation(
  tokenHash: string,
  clerkUserId: string,
): Promise<AcceptResult> {
  return withoutTenantScope(async (tx) => {
    const { rows } = await tx.query<{
      o_status: AcceptStatus;
      o_organization_id: string | null;
      o_organization_name: string | null;
      o_membership_id: string | null;
    }>('SELECT * FROM accept_invitation($1, $2, now())', [tokenHash, clerkUserId]);

    const row = rows[0];
    if (!row) throw new Error('accept_invitation returned no row');

    return {
      status: row.o_status,
      organizationId: row.o_organization_id,
      organizationName: row.o_organization_name,
      membershipId: row.o_membership_id,
    };
  });
}
