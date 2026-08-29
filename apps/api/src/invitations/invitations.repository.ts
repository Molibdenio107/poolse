import { withOrg, withoutTenantScope } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import type { MemberRole } from '../tenant/roles.js';
import { personName, personOrder, personShortName } from '../people/names.js';
import { searchPredicate } from '../common/search.js';
import {
  windowed,
  TOTAL_COUNT,
  type PageQuery,
  type Paginated,
} from '../common/pagination.js';

export interface OrganizationMember {
  membershipId: string;
  appUserId: string | null;
  status: 'invited' | 'active' | 'suspended';
  firstName: string | null;
  lastName: string | null;
  /**
   * The two composed forms — POOLSE-32.
   *
   * **They disagree about nobody, and that is deliberate.** `person_name`
   * composes with `coalesce(..., '')` and returns an empty string for somebody
   * invited who has no name anywhere yet; `short_name` wraps the same thing in
   * `nullif` and returns null. So `displayName` is `''` where `shortName` is
   * null, and a `?? email` fallback fires on one and not the other.
   *
   * Documented rather than papered over: the two functions have different
   * callers — one fills a document, the other fills a row — and making them
   * agree would mean picking a behaviour that is wrong for one of them.
   * Callers that need a fallback should test for emptiness, not for null.
   */
  displayName: string | null;
  shortName: string | null;
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

/**
 * Which people a members list is asking for.
 *
 * **These are filters, not a post-processing step, and that is the point** —
 * POOLSE-29. The staff page used to fetch every membership and narrow it in the
 * browser, which was fine while the list was whole and is a bug the moment it is
 * a page: filtering after a window gives page 2 fewer rows than page 1 and a
 * total that counts people the reader cannot see. Scope and role are part of the
 * same statement as LIMIT now.
 */
/**
 * The admins the organization could be handed to — POOLSE-29 fallout.
 *
 * Its own query rather than a filter over the members page, because a picker
 * must offer *every* candidate: the transfer dialog used to read
 * `members.filter(isAdmin)`, which was correct while the list was whole and
 * silently became "the admins who happen to be on page 1" the moment it was a
 * page. Somebody would have opened the dialog, not found their colleague, and
 * concluded the colleague was not an admin.
 *
 * Unpaginated on purpose and safely so: it is bounded by how many admins one
 * club has, which is a number the club chooses and keeps small.
 */
export async function transferCandidates(
  organizationId: string,
): Promise<OrganizationMember[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      membership_id: string;
      app_user_id: string | null;
      status: OrganizationMember['status'];
      first_name: string | null;
      last_name: string | null;
      display_name: string | null;
      short_name: string | null;
      email: string | null;
      avatar_url: string | null;
      birth_date: string | null;
    }>(`
      SELECT m.id AS membership_id,
             m.app_user_id,
             m.status,
             coalesce(u.cached_first_name, m.first_name) AS first_name,
             coalesce(u.cached_last_name,  m.last_name)  AS last_name,
             ${personName('m.id')} AS display_name,
             ${personShortName('m.id')} AS short_name,
             coalesce(u.cached_email::text, m.email::text) AS email,
             u.cached_avatar_url AS avatar_url,
             u.birth_date AS birth_date
        FROM membership m
        LEFT JOIN app_user u ON u.id = m.app_user_id
       WHERE m.archived_at IS NULL
         AND m.status = 'active'
         AND EXISTS (
           SELECT 1 FROM membership_role r
            WHERE r.membership_id = m.id AND r.archived_at IS NULL AND r.role = 'admin'
         )
         -- The owner is not a candidate to be handed what they already hold.
         AND NOT EXISTS (
           SELECT 1 FROM membership_role r
            WHERE r.membership_id = m.id AND r.archived_at IS NULL AND r.role = 'owner'
         )
       ORDER BY ${personOrder('m.id')}
    `);

    return rows.map((row) => ({
      membershipId: row.membership_id,
      appUserId: row.app_user_id,
      status: row.status,
      firstName: row.first_name,
      lastName: row.last_name,
      displayName: row.display_name,
      shortName: row.short_name,
      email: row.email,
      roles: ['admin'],
      avatarUrl: row.avatar_url,
      birthDate: row.birth_date,
    }));
  });
}

/**
 * How many staff there are, in total and by role.
 *
 * The list already reports a total, but it is the total of whatever filter is
 * applied — "3" under the Instrutor chip and "12" with no chip, and nothing on
 * the screen says which of those is the size of the team. This answers the
 * question the page was being asked to answer by arithmetic.
 *
 * **`total` counts people; `byRole` counts roles.** They do not add up, and that
 * is correct rather than a rounding problem: an admin who also instructs is one
 * member of staff and appears under both chips. Counting `byRole` into a total
 * would report thirteen people in a room of twelve.
 *
 * Scoped exactly as the staff list is — active, unarchived, and staff by
 * `STAFF_ROLES` or by holding no role yet (an invitation not accepted). A count
 * that disagreed with the list beneath it would be worse than no count.
 */
export interface StaffCounts {
  total: number;
  byRole: Record<string, number>;
}

export async function countStaff(organizationId: string): Promise<StaffCounts> {
  return withOrg(organizationId, async (tx) => {
    const [totals, byRole] = await Promise.all([
      tx.query<{ total: number }>(`
        SELECT count(*)::int AS total
          FROM membership m
         WHERE m.archived_at IS NULL
           AND m.status = 'active'
           AND (
             NOT EXISTS (
               SELECT 1 FROM membership_role r
                WHERE r.membership_id = m.id AND r.archived_at IS NULL
             )
             OR EXISTS (
               SELECT 1 FROM membership_role r
                WHERE r.membership_id = m.id
                  AND r.archived_at IS NULL
                  AND r.role IN ('owner', 'admin', 'instructor', 'maintenance')
             )
           )
      `),
      tx.query<{ role: string; total: number }>(`
        SELECT r.role::text AS role, count(*)::int AS total
          FROM membership_role r
          JOIN membership m
            ON m.id = r.membership_id
           AND m.organization_id = r.organization_id
         WHERE r.archived_at IS NULL
           AND m.archived_at IS NULL
           AND m.status = 'active'
           AND r.role IN ('owner', 'admin', 'instructor', 'maintenance')
         GROUP BY r.role
      `),
    ]);

    /*
     * Seeded at zero for every staff role, because a role nobody holds returns
     * no row at all — and a chip that is simply absent reads as "this screen
     * failed to load" rather than as "there are none".
     */
    const counts: Record<string, number> = {
      owner: 0,
      admin: 0,
      instructor: 0,
      maintenance: 0,
    };

    for (const row of byRole.rows) counts[row.role] = row.total;

    return { total: totals.rows[0]?.total ?? 0, byRole: counts };
  });
}

export interface MemberQuery {
  /**
   * `staff` is the staff section's own boundary — POOLSE-35 criterion 7.
   *
   * Somebody with no role yet counts as staff: they were invited by a colleague
   * and have not accepted, and hiding them would hide the invitation somebody
   * came here to chase.
   */
  scope: 'staff' | 'learners' | null;
  /** One role chip. Narrows within the scope; never widens past it. */
  role: string | null;
  /**
   * A search term, or null — POOLSE-30.
   *
   * Narrows within the scope like the role chip does, and for the same reason:
   * an Instructor must not be able to search their way to a student's record
   * that the unfiltered list would never have shown them (QA 30.9).
   */
  search: string | null;
}

export async function listMembers(
  organizationId: string,
  query: MemberQuery,
  page: PageQuery,
): Promise<Paginated<OrganizationMember>> {
  return withOrg(organizationId, async (tx) => {
    const run = (limit: number, offset: number) => tx.query<{
      total_count: number;
      membership_id: string;
      app_user_id: string | null;
      status: OrganizationMember['status'];
      first_name: string | null;
      last_name: string | null;
      display_name: string | null;
      short_name: string | null;
      email: string | null;
      roles: string[];
      avatar_url: string | null;
      birth_date: string | null;
    }>(`
      SELECT ${TOTAL_COUNT},
             m.id                AS membership_id,
             m.app_user_id       AS app_user_id,
             m.status            AS status,
             -- Clerk where there is a login, the club's own record where there
             -- is not — POOLSE-17. An encarregado de educação created from a
             -- student form has no account and never will, and reading only the
             -- cache left them in this list as a nameless row.
             coalesce(u.cached_first_name, m.first_name) AS first_name,
             coalesce(u.cached_last_name,  m.last_name)  AS last_name,
             -- Composed once, in SQL, so no screen assembles a name for itself
             -- — POOLSE-32.
             ${personName('m.id')} AS display_name,
             ${personShortName('m.id')} AS short_name,
             u.cached_avatar_url AS avatar_url,
             -- Poolse's own column, not a Clerk cache: birth date is ours and is
             -- written directly. Needed here so the staff list can flag a
             -- birthday without a second round trip per row — round 4.
             u.birth_date        AS birth_date,
             -- Before acceptance there is no account, so the address the invite
             -- went to is the only name this person has here.
             coalesce(u.cached_email::text, m.email::text, i.email::text) AS email,
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
        /*
         * **One invitation row at most**, and the LATERAL is what guarantees it.
         *
         * A plain LEFT JOIN fans the membership out once per invitation. That is
         * invisible while everybody has one — and POOLSE-39's re-invite inserts a
         * second against the *same* membership, so a colleague whose address was
         * corrected appeared on the staff list twice. With POOLSE-29 it got
         * worse: the window count counted the duplicates, so "de N" was wrong
         * and a page could hold fourteen people.
         *
         * The most recent one, because the only thing this join is for is the
         * address an unaccepted invite went to — the one name such a person has.
         */
        LEFT JOIN LATERAL (
          SELECT i2.email
            FROM invitation i2
           WHERE i2.membership_id = m.id
             AND i2.organization_id = m.organization_id
           ORDER BY i2.created_at DESC
           LIMIT 1
        ) i ON true
       WHERE m.archived_at IS NULL
         /*
          * Staff, learners, or everybody. Written as EXISTS rather than as a
          * HAVING on the aggregated array so the role index can serve it, and so
          * "holds no role at all" stays expressible — which array_agg makes
          * awkward and which the staff scope depends on.
          */
         AND (
           $1::text IS NULL
           OR ($1 = 'staff' AND (
                NOT EXISTS (
                  SELECT 1 FROM membership_role r
                   WHERE r.membership_id = m.id AND r.archived_at IS NULL
                )
                OR EXISTS (
                  SELECT 1 FROM membership_role r
                   WHERE r.membership_id = m.id AND r.archived_at IS NULL
                     AND r.role IN ('owner', 'admin', 'instructor', 'maintenance')
                )
              ))
           OR ($1 = 'learners' AND EXISTS (
                SELECT 1 FROM membership_role r
                 WHERE r.membership_id = m.id AND r.archived_at IS NULL
                   AND r.role IN ('student', 'guardian')
              ))
         )
         AND (
           $2::text IS NULL
           OR EXISTS (
             SELECT 1 FROM membership_role r
              WHERE r.membership_id = m.id AND r.archived_at IS NULL
                AND r.role::text = $2::text
           )
         )
         /*
          * Name and email — what a staff row shows. No phone: the list does not
          * print one, and searching by a field somebody cannot see returns rows
          * that look like they do not match.
          */
         AND ${searchPredicate(
           `coalesce(person_name(m.id), '') || ' ' ||
            coalesce(u.cached_email::text, m.email::text, i.email::text, '')`,
           '$3',
         )}
       GROUP BY m.id, m.app_user_id, m.status, m.created_at,
                m.first_name, m.last_name, m.email,
                u.cached_first_name, u.cached_last_name, u.cached_avatar_url,
                u.cached_email, u.birth_date, i.email
       /*
        * By name, not by when the row was made. A staff list is something you
        * scan for somebody, and creation order is meaningless to the person
        * doing the scanning.
        *
        * By *surname*, in Portuguese — POOLSE-32 criterion 5. It used to order
        * on the given name, which put every Ana together and filed "Álvares"
        * after "Zé".
        */
       ORDER BY ${personOrder('m.id')}, m.created_at
       LIMIT $4 OFFSET $5
    `, [query.scope, query.role, query.search, limit, offset]);

    return windowed(page, run, (row) => ({
      membershipId: row.membership_id,
      appUserId: row.app_user_id,
      status: row.status,
      firstName: row.first_name,
      lastName: row.last_name,
      displayName: row.display_name,
      shortName: row.short_name,
      email: row.email,
      roles: row.roles,
      avatarUrl: row.avatar_url,
      birthDate: row.birth_date,
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
/**
 * The roles a pending invitation is offering — POOLSE-01.
 *
 * Read before reissuing or revoking, so the matrix governs those too. Without
 * it an instructor could create an invitation and then be unable to fix their
 * own typo, and — the other way round — could withdraw an invitation to an admin
 * that somebody senior had sent.
 */
export async function pendingInvitationRoles(
  organizationId: string,
  invitationId: string,
): Promise<string[] | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ roles: string[] }>(
      `SELECT (SELECT array_agg(r::text) FROM unnest(roles) AS r) AS roles
         FROM invitation
        WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL`,
      [invitationId],
    );
    return rows[0]?.roles ?? null;
  });
}

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
