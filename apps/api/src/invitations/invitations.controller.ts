import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  NotFoundException,
  Param,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import {
  canInvite,
  grantableRoles,
  isMemberRole,
  requireGrantable,
  requireRole,
  type MemberRole,
} from '../tenant/roles.js';
import { recordRefusedAttempt } from '../audit/audit.js';
import {
  createInvitation,
  createInvitationFor,
  findPersonByContact,
  phoneKey,
  DuplicateInvitationError,
  organizationVoice,
  pendingInvitationRoles,
  recordDelivery,
  reissueInvitation,
  revokeInvitation,
} from './invitations.repository.js';
import { invitationEmail } from '../notifications/invitation-email.js';
import { emailIsConfigured, sendEmail } from '../notifications/notifier.js';
import { invitationExpiry, issueToken, normaliseEmail } from './invitations.service.js';
import { CoreRoute } from '../tenant/modules.js';

interface CreateInvitationBody {
  email?: unknown;
  /** Rui, 30-10-2026: a staff member may be invited by mobile, the link shared by hand. */
  phone?: unknown;
  roles?: unknown;
}

interface CreateInvitationResponse {
  id: string;
  /** Null for a link to share from the club's phone. */
  email: string | null;
  roles: string[];
  expiresAt: string;
  /**
   * The raw token, returned exactly once — this response is the only place it
   * ever exists outside the inviter's clipboard. There is no endpoint to read it
   * back, because the database only has its hash.
   */
  token: string;
  /**
   * Whether the invitation actually left the building. False when no provider is
   * configured, and false when one is but the send failed — either way the link
   * above is the fallback, and the UI says which happened.
   */
  emailed: boolean;
}

/**
 * Where the invitee will land. The API composes it rather than the web app,
 * because the email is sent from here and the link inside it has to be absolute.
 */
export function joinLink(token: string): string {
  const origin = (process.env['WEB_ORIGIN'] ?? 'http://localhost:3000').split(',')[0]!.trim();
  return `${origin.replace(/\/$/, '')}/join?token=${encodeURIComponent(token)}`;
}

/**
 * Best-effort delivery, deliberately after the invitation is committed.
 *
 * Never throws: a mail server having a bad minute must not roll back an
 * invitation that is otherwise perfectly good, and "New link" re-sends it in one
 * click. The inverse — an email announcing an invitation that was rolled back —
 * would be worse and is impossible from here.
 */
export async function deliver(
  organizationId: string,
  invitationId: string,
  email: string,
  roles: string[],
  token: string,
  expiresAt: Date,
): Promise<boolean> {
  /*
   * The outcome is written to the invitation as well as returned — backlog
   * round 4, ticket 5.
   *
   * The return value tells the request that created it; the column tells
   * everybody who looks at the pending list afterwards. Without the column, an
   * invitation that failed to send looks exactly like one that succeeded the
   * moment you navigate away, and the operator waits for an instructor who was
   * never written to.
   *
   * `not_configured` is deliberately not `failed`. No provider is set up, the
   * link is meant to be copied by hand, and calling that a failure would have
   * every invitation in local development shouting about a problem that is a
   * setting.
   */
  const record = async (outcome: 'sent' | 'failed' | 'not_configured'): Promise<boolean> => {
    // Never allowed to break the invitation it is describing.
    await recordDelivery(organizationId, invitationId, outcome).catch(() => undefined);
    return outcome === 'sent';
  };

  if (!emailIsConfigured()) return record('not_configured');

  try {
    const voice = await organizationVoice(organizationId);
    const sent = await sendEmail(
      invitationEmail({
        to: email,
        organizationName: voice.name,
        roles,
        link: joinLink(token),
        expiresAt,
        locale: voice.locale,
      }),
    );
    return record(sent ? 'sent' : 'failed');
  } catch {
    return record('failed');
  }
}

@CoreRoute()
@Controller('invitations')
export class InvitationsController {
  @Post()
  async create(@Body() body: CreateInvitationBody): Promise<CreateInvitationResponse> {
    // POOLSE-01: who may invite is the matrix's decision, not a role check here.
    // An instructor may invite the families they teach; maintenance may invite
    // nobody, for now.
    requireCanInvite();
    const { organizationId, membershipId } = currentTenant();

    const rawEmail = typeof body.email === 'string' ? body.email.trim() : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    const email = rawEmail === '' ? null : normaliseEmail(rawEmail);
    if (rawEmail !== '' && email === null) {
      throw new BadRequestException({
        code: 'invalid_email',
        message: 'Not an email address',
        fields: { email: 'invite.emailInvalid' },
      });
    }
    if (email === null && phoneKey(phone).length < 9) {
      throw new BadRequestException({
        code: 'contact_required',
        message: 'An email or a mobile number is required',
        fields: { email: 'invite.contactRequired' },
      });
    }

    const roles = parseRoles(body.roles);
    if (roles.length === 0) throw new BadRequestException('At least one role is required');

    /*
     * Pessoas invites staff only — POOLSE-129 (Rui, 30-10-2026). A family is
     * invited from the student's record, where the invitation names the guardian
     * the club already has; from here it made a second, unlinked person.
     */
    if (roles.some((role) => role === 'guardian' || role === 'student')) {
      throw new UnprocessableEntityException({
        code: 'family_role_from_student',
        message: 'Invite a family from the student’s record',
      });
    }

    // Checked here rather than trusted from the form: the client decides what to
    // show, the server decides what is allowed. `owner` is refused for everyone,
    // including the owner — it moves only through transfer.
    const allowed = new Set(grantableRoles());
    const refused = roles.filter((role) => !allowed.has(role));
    if (refused.length > 0) {
      // Somebody asking for `owner` got past a UI that never offered it, which
      // means either a stale page or a hand-made request. Either way it is worth
      // a line in the log — this is the one privilege the whole story is about.
      await recordRefusedAttempt(organizationId, {
        action: 'invitation.role_refused',
        entityType: 'organization',
        entityId: organizationId,
        data: { email, refused },
      });
      throw new BadRequestException(`Not allowed to grant: ${refused.join(', ')}`);
    }

    /*
     * An email or a mobile identifies a person (Rui, 30-10-2026). Somebody the
     * club already has is invited as themself — a guardian who will teach stays
     * one person — and somebody who already signs in needs no invitation: their
     * roles are changed on their own record.
     */
    const known = await findPersonByContact(organizationId, email, phone);
    if (known?.hasLogin === true) {
      throw new ConflictException({
        code: 'person_in_app',
        message: 'This person already uses Poolse in this club',
        membershipId: known.membershipId,
        name: known.name,
        fields: { email: 'invite.personInApp' },
      });
    }

    if (known?.pending === true) {
      throw new ConflictException({
        code: 'already_invited',
        message: 'This person already has a pending invitation',
        fields: { email: 'invite.duplicate' },
      });
    }

    const { token, tokenHash } = issueToken();
    const expiresAt = invitationExpiry();

    let id: string;
    try {
      id = known === null
        ? await createInvitation({
            organizationId,
            invitedByMembershipId: membershipId,
            email,
            phone: phone === '' ? null : phone,
            roles,
            tokenHash,
            expiresAt,
          })
        : await createInvitationFor({
            organizationId,
            invitedByMembershipId: membershipId,
            membershipId: known.membershipId,
            email,
            roles,
            tokenHash,
            expiresAt,
          });
    } catch (error) {
      if (error instanceof DuplicateInvitationError) {
        throw new ConflictException({
          code: 'already_invited',
          message: 'This person already has a pending invitation',
          fields: { email: 'invite.duplicate' },
        });
      }
      throw error;
    }

    const emailed = email === null ? false : await deliver(organizationId, id, email, roles, token, expiresAt);

    return { id, email, roles, expiresAt: expiresAt.toISOString(), token, emailed };
  }

  /**
   * Replace a pending invitation with a fresh link to the same address.
   *
   * The link is shown once and only its hash is stored, so closing the tab used
   * to be a dead end. This is the way out, and it withdraws the old token in the
   * same transaction — a link someone lost should stop working, not linger.
   */
  @Post(':id/reissue')
  async reissue(@Param('id') id: string): Promise<CreateInvitationResponse> {
    requireCanInvite();
    const { organizationId, membershipId } = currentTenant();

    // Only an invitation this caller could have sent themselves. An instructor
    // fixes their own typo; they do not reissue an invitation to an admin.
    await requireOwnKind(organizationId, id);

    const { token, tokenHash } = issueToken();
    const expiresAt = invitationExpiry();

    const replacement = await reissueInvitation(
      organizationId,
      id,
      membershipId,
      tokenHash,
      expiresAt,
    );
    if (!replacement) throw new NotFoundException('No pending invitation with that id');

    const emailed = replacement.email === null
      ? false
      : await deliver(organizationId, replacement.id, replacement.email, replacement.roles, token, expiresAt);

    return { ...replacement, email: replacement.email ?? '', token, emailed };
  }

  /**
   * POST rather than DELETE: revoking is a state change on an invitation that
   * stays in the table as a record of what was offered and withdrawn, not a
   * deletion of it.
   */
  @Post(':id/revoke')
  async revoke(@Param('id') id: string): Promise<{ revoked: true }> {
    requireCanInvite();
    const { organizationId } = currentTenant();

    await requireOwnKind(organizationId, id);

    const revoked = await revokeInvitation(organizationId, id);
    // Also the answer when the id belongs to another tenant — RLS makes those
    // two cases indistinguishable from here, which is the point.
    if (!revoked) throw new NotFoundException('No pending invitation with that id');

    return { revoked: true };
  }
}

/**
 * Refuses everyone the matrix gives nothing to — POOLSE-01, criterion 3.
 *
 * A student, a guardian, or (for now) maintenance. The UI hides the entry point
 * too, but that is a courtesy: this is the control, and it answers a
 * hand-crafted request exactly as it answers a stale page.
 */
function requireCanInvite(): void {
  if (!canInvite()) {
    throw new ForbiddenException({
      code: 'cannot_invite',
      message: 'Your role cannot invite people',
    });
  }
}

/**
 * Only an invitation this caller could have sent in the first place.
 *
 * A missing invitation and somebody else's are the same answer, so a person
 * cannot discover that an admin invitation exists by trying to revoke it.
 */
async function requireOwnKind(organizationId: string, invitationId: string): Promise<void> {
  const roles = await pendingInvitationRoles(organizationId, invitationId);
  if (roles === null) throw new NotFoundException('No pending invitation with that id');
  requireGrantable(roles);
}

function parseRoles(value: unknown): MemberRole[] {
  if (!Array.isArray(value)) return [];

  const roles = value.filter((role): role is string => typeof role === 'string');
  const unknown = roles.filter((role) => !isMemberRole(role));
  if (unknown.length > 0) {
    throw new BadRequestException(`Unknown role(s): ${unknown.join(', ')}`);
  }

  return [...new Set(roles.filter(isMemberRole))];
}
