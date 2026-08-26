import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { grantableRoles, hasRole, requireRole } from '../tenant/roles.js';
import {
  listMembers,
  listPendingInvitations,
  transferOwnership,
  type OrganizationMember,
  type PendingInvitation,
} from './invitations.repository.js';

interface PeopleResponse {
  organizationId: string;
  members: OrganizationMember[];
  invitations: PendingInvitation[];
  /** So the UI can hide a form the API would refuse anyway. */
  canInvite: boolean;
  /** Roles this caller is allowed to hand out. Never includes `owner`. */
  grantableRoles: string[];
  /** Only the owner may hand the organization to somebody else. */
  canTransferOwnership: boolean;
}

/**
 * Who is in this organization, and who has been asked to be.
 *
 * Readable by any member: an instructor seeing their colleagues is not a
 * privilege worth gating, and the list carries nothing an instructor cannot
 * already see standing in the building. Acting on it is gated — see
 * InvitationsController.
 */
@Controller('people')
export class PeopleController {
  @Get()
  async list(): Promise<PeopleResponse> {
    const { organizationId } = currentTenant();

    // Both are tenant-scoped reads on the same organization; running them
    // together costs one round trip instead of two.
    const [members, invitations] = await Promise.all([
      listMembers(organizationId),
      listPendingInvitations(organizationId),
    ]);

    // Inviting is the owner's alone, per backlog story 9: control of the licence
    // stays with the person who pays for it. Admins keep everything else,
    // including seeing exactly who is in the organization.
    const isOwner = hasRole('owner');

    return {
      organizationId,
      members,
      invitations,
      canInvite: isOwner,
      grantableRoles: isOwner ? grantableRoles() : [],
      canTransferOwnership: isOwner,
    };
  }

  /**
   * Hands the organization to an admin.
   *
   * The reason this exists at all: one uncreatable owner would mean that the day
   * that person leaves the club or loses their account, the tenant becomes
   * unadministrable and only the vendor can unblock it. A transfer the owner can
   * perform themselves is the difference between a rule and a trap.
   */
  @Post('transfer-ownership')
  async transfer(@Body() body: Record<string, unknown>): Promise<{ transferred: true }> {
    requireRole('owner');
    const { organizationId, membershipId } = currentTenant();

    const target = typeof body['membershipId'] === 'string' ? body['membershipId'].trim() : '';
    if (!target) throw new BadRequestException('membershipId is required');

    const outcome = await transferOwnership(organizationId, membershipId, target);

    if (outcome === 'not_found') throw new NotFoundException('No such member');
    if (outcome === 'already_owner') {
      throw new BadRequestException('That membership already holds ownership');
    }
    if (outcome === 'not_admin') {
      throw new BadRequestException(
        'Ownership can only be transferred to an administrator. Promote them first.',
      );
    }

    return { transferred: true };
  }
}
