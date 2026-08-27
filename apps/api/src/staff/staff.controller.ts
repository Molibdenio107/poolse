import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireRole } from '../tenant/roles.js';
import { updateClerkName } from '../identity/identity.service.js';
import { invitationExpiry, issueToken, normaliseEmail } from '../invitations/invitations.service.js';
import { deliver } from '../invitations/invitations.controller.js';
import {
  cancelReinvite,
  findStaff,
  reinvite,
  updateStaff,
  type StaffRecord,
} from './staff.repository.js';

const MAX_NAME = 120;
const MAX_PHONE = 40;
const MAX_NOTES = 2000;

/**
 * The staff record — POOLSE-39.
 *
 * **Who may edit what**, per the decision recorded in the ticket:
 *
 * - Owner and Admin edit anybody's name, phone and notes.
 * - An Instructor edits **their own name and phone**, and nothing else. A
 *   misspelled name needing an admin is the complaint that produced this ticket,
 *   and notes are frequently what an admin writes *about* somebody rather than
 *   what they write about themselves.
 * - Nobody edits an email, ever. It is the login identity; it moves by
 *   re-invitation and by nothing else.
 *
 * Role changes are not here at all — they go through `PeopleDedupController`,
 * which applies the POOLSE-01 matrix. AC5 asks for one guard rather than a
 * second endpoint with its own rules, and two endpoints is how the second one
 * ends up more permissive.
 */
@Controller('staff')
export class StaffController {
  @Get(':membershipId')
  async one(@Param('membershipId') membershipId: string): Promise<StaffRecord> {
    requireRole('owner', 'admin', 'instructor');
    const { organizationId } = currentTenant();

    const staff = await findStaff(organizationId, membershipId);
    // Also the answer for another tenant's id: RLS hid it, and the caller learns
    // nothing either way.
    if (staff === null) throw new NotFoundException('No such staff member');

    return staff;
  }

  @Patch(':membershipId')
  async update(
    @Param('membershipId') membershipId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<StaffRecord> {
    const { organizationId, membershipId: actor } = currentTenant();

    const privileged = hasRole('owner', 'admin');
    const own = actor === membershipId;

    if (!privileged && !own) {
      throw new ForbiddenException({
        code: 'forbidden_role',
        message: 'You may only edit your own record',
      });
    }

    /*
     * Refused rather than ignored — 39.3.
     *
     * A request that silently drops the field it was sent looks like a save that
     * worked, and the caller goes on believing the address changed. Saying no is
     * the only answer that leaves them knowing where they stand.
     */
    if (body['email'] !== undefined) {
      throw new BadRequestException({
        code: 'email_immutable',
        message: 'Email is the login identity and changes only by re-invitation',
      });
    }

    const staff = await findStaff(organizationId, membershipId);
    if (staff === null) throw new NotFoundException('No such staff member');

    const edit = {
      firstName: text(body['firstName'], 'firstName', MAX_NAME),
      lastName: text(body['lastName'], 'lastName', MAX_NAME),
      phone: text(body['phone'], 'phone', MAX_PHONE),
      // Somebody editing their own record keeps whatever notes were already
      // there rather than being able to clear them by omission.
      notes: privileged ? text(body['notes'], 'notes', MAX_NOTES) : staff.notes,
    };

    if (!privileged && body['notes'] !== undefined) {
      throw new ForbiddenException({
        code: 'forbidden_role',
        message: 'Notes are written by an owner or an administrator',
      });
    }

    /*
     * Clerk owns the name where there is a login, and the write goes there
     * first — CLAUDE.md's rule, and the reason `updateClerkName` re-reads rather
     * than trusting what it sent. A failure at Clerk must leave nothing changed
     * anywhere, which is why this happens before the row is touched.
     */
    const clerkHandled = staff.clerkUserId !== null;
    if (clerkHandled) {
      await updateClerkName(staff.clerkUserId as string, edit.firstName, edit.lastName);
    }

    if (!(await updateStaff(organizationId, membershipId, edit, clerkHandled))) {
      throw new NotFoundException('No such staff member');
    }

    const saved = await findStaff(organizationId, membershipId);
    if (saved === null) throw new NotFoundException('No such staff member');
    return saved;
  }

  /**
   * Moves somebody to a new address — AC3.
   *
   * Owner only, as the ticket states. It is the one operation that changes who
   * can sign in as an existing person, which is a different thing from inviting
   * somebody new.
   */
  @Post(':membershipId/reinvite')
  async move(
    @Param('membershipId') membershipId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ reinvited: true; delivered: boolean }> {
    requireRole('owner');
    const { organizationId, membershipId: actor } = currentTenant();

    const email = normaliseEmail(String(body['email'] ?? ''));
    if (email === null) throw new BadRequestException('A valid email address is required');

    const staff = await findStaff(organizationId, membershipId);
    if (staff === null) throw new NotFoundException('No such staff member');

    if (staff.email !== null && staff.email.toLowerCase() === email.toLowerCase()) {
      throw new BadRequestException({
        code: 'same_address',
        message: 'That is already their address',
      });
    }

    const { token, tokenHash } = issueToken();
    const expiresAt = invitationExpiry();

    const id = await reinvite(organizationId, membershipId, email, tokenHash, expiresAt, actor);
    if (id === null) {
      throw new BadRequestException('That person has no login to move');
    }

    /*
     * The same delivery path as an ordinary invitation, not a second one.
     *
     * It writes the outcome to `invitation.delivery` as well as returning it, so
     * a re-invite that failed to send is visible on the record afterwards rather
     * than only to the request that made it. With `EMAIL_PROVIDER=console` the
     * link goes to the API log, which is `not_configured` rather than a failure.
     */
    const delivered = await deliver(organizationId, id, email, staff.roles, token, expiresAt);

    return { reinvited: true, delivered };
  }

  @Post(':membershipId/reinvite/cancel')
  async cancel(@Param('membershipId') membershipId: string): Promise<{ cancelled: true }> {
    requireRole('owner');
    const { organizationId } = currentTenant();

    if (!(await cancelReinvite(organizationId, membershipId))) {
      throw new NotFoundException('There is no pending re-invitation');
    }
    return { cancelled: true };
  }
}

/** Trimmed, bounded, and empty means null rather than an empty string. */
function text(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;

  const trimmed = String(value).trim();
  if (trimmed === '') return null;
  if (trimmed.length > max) {
    throw new BadRequestException(`${field} may be at most ${max} characters`);
  }
  return trimmed;
}
