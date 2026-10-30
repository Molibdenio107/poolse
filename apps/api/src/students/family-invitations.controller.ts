import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { withOrg } from '@poolse/db';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireRole } from '../tenant/roles.js';
import { CoreRoute } from '../tenant/modules.js';
import { readSearch } from '../common/search.js';
import { deliver, joinLink } from '../invitations/invitations.controller.js';
import { reissueInvitation, revokeInvitation } from '../invitations/invitations.repository.js';
import { invitationExpiry, issueToken, normaliseEmail } from '../invitations/invitations.service.js';
import {
  createFamilyInvitationIn,
  invitationOnRecord,
  listInvitees,
  previewBulk,
  previewBulkIn,
  teachesStudent,
  type BulkPreview,
  type Invitee,
} from './family-invitations.repository.js';

/**
 * Inviting a family into the app — POOLSE-129 (Rui, 30-10-2026).
 *
 * From the student's record, never from Pessoas. Owner and admin for any
 * student; an instructor for a student actively enrolled in a turma they teach,
 * decided per row here and echoed as `canInvite`, so the button and the guard
 * cannot disagree. Everybody else is refused in the first line; a support
 * session invites nobody, as everywhere (`grantableRoles()` is empty).
 */

interface InviteesResponse {
  studentName: string;
  organizationName: string;
  canInvite: boolean;
  invitees: Invitee[];
}

interface InvitationIssued {
  invitationId: string;
  /** The link, returned once — only its hash is stored. */
  link: string;
  email: string | null;
  emailed: boolean;
  expiresAt: string;
}

async function mayInviteFor(studentId: string): Promise<boolean> {
  const { organizationId, membershipId, support } = currentTenant();
  if (support === true) return false;
  if (hasRole('owner', 'admin')) return true;
  if (!hasRole('instructor')) return false;
  return teachesStudent(organizationId, membershipId, studentId);
}

async function requireMayInviteFor(studentId: string): Promise<void> {
  if (!(await mayInviteFor(studentId))) {
    throw new ForbiddenException({
      code: 'not_your_student',
      message: 'You may invite the families of your own turmas only',
    });
  }
}

@CoreRoute()
@Controller('students/:studentId/invitations')
export class StudentInvitationsController {
  @Get()
  async list(@Param('studentId', ParseUUIDPipe) studentId: string): Promise<InviteesResponse> {
    requireRole('owner', 'admin', 'instructor');
    const { organizationId } = currentTenant();
    const found = await listInvitees(organizationId, studentId);
    if (found === null) throw new NotFoundException('No such student');
    return { ...found, canInvite: await mayInviteFor(studentId) };
  }

  @Post()
  async create(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<InvitationIssued> {
    requireRole('owner', 'admin', 'instructor');
    const { organizationId, membershipId } = currentTenant();

    const target = body['membershipId'];
    if (target !== null && typeof target !== 'string') {
      throw new BadRequestException('membershipId is a guardian’s id, or null for the student');
    }
    const channel = body['channel'];
    if (channel !== 'email' && channel !== 'link') {
      throw new BadRequestException('channel is email or link');
    }
    let email: string | null = null;
    if (typeof body['email'] === 'string' && body['email'].trim() !== '') {
      email = normaliseEmail(body['email']);
      if (email === null) throw new BadRequestException({ code: 'invalid_email', message: 'Not an email address' });
    }

    await requireMayInviteFor(studentId);

    const { token, tokenHash } = issueToken();
    const expiresAt = invitationExpiry();
    const outcome = await withOrg(organizationId, (tx) =>
      createFamilyInvitationIn(tx, {
        organizationId,
        invitedByMembershipId: membershipId,
        studentId,
        membershipId: target,
        channel,
        email,
        tokenHash,
        expiresAt,
      }),
    );

    switch (outcome.kind) {
      case 'not_found':
        throw new NotFoundException('Nobody on this record by that id');
      case 'has_login':
        throw new ConflictException({ code: 'already_in_app', message: 'They already use the app' });
      case 'already_invited':
        throw new ConflictException({ code: 'already_invited', message: 'A live invitation exists; use a new link' });
      case 'email_taken':
        throw new ConflictException({ code: 'email_taken', message: 'Another person in the club has that address' });
      case 'no_email':
        throw new BadRequestException({ code: 'no_email', message: 'An email address is needed to send it' });
    }

    const emailed = outcome.email === null
      ? false
      : await deliver(organizationId, outcome.invitationId, outcome.email, outcome.roles, token, expiresAt);

    return {
      invitationId: outcome.invitationId,
      link: joinLink(token),
      email: outcome.email,
      emailed,
      expiresAt: outcome.expiresAt,
    };
  }

  /** *Novo link*: the old token dies in the same transaction, to the same person. */
  @Post(':invitationId/reissue')
  async reissue(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ): Promise<InvitationIssued> {
    requireRole('owner', 'admin', 'instructor');
    const { organizationId, membershipId } = currentTenant();
    await requireMayInviteFor(studentId);
    if (!(await invitationOnRecord(organizationId, studentId, invitationId))) {
      throw new NotFoundException('No pending invitation on this record');
    }

    const { token, tokenHash } = issueToken();
    const expiresAt = invitationExpiry();
    const replacement = await reissueInvitation(organizationId, invitationId, membershipId, tokenHash, expiresAt);
    if (!replacement) throw new NotFoundException('No pending invitation on this record');

    const emailed = replacement.email === null
      ? false
      : await deliver(organizationId, replacement.id, replacement.email, replacement.roles, token, expiresAt);

    return {
      invitationId: replacement.id,
      link: joinLink(token),
      email: replacement.email,
      emailed,
      expiresAt: replacement.expiresAt,
    };
  }

  @Post(':invitationId/revoke')
  async revoke(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ): Promise<{ revoked: true }> {
    requireRole('owner', 'admin', 'instructor');
    const { organizationId } = currentTenant();
    await requireMayInviteFor(studentId);
    if (!(await invitationOnRecord(organizationId, studentId, invitationId))) {
      throw new NotFoundException('No pending invitation on this record');
    }
    if (!(await revokeInvitation(organizationId, invitationId))) {
      throw new NotFoundException('No pending invitation on this record');
    }
    return { revoked: true };
  }
}

/**
 * *Convidar famílias* — the Alunos list's filters, previewed and then sent, on
 * one path with a `commit` flag like every importer. Only the families with an
 * address are sent to; the rest stay on *Por convidar*, to be shared by hand.
 */
@CoreRoute()
@Controller('family-invitations')
export class FamilyInvitationsBulkController {
  @Post('bulk')
  async bulk(@Body() body: Record<string, unknown>): Promise<Omit<BulkPreview, 'candidates'> & { sent: number }> {
    requireRole('owner', 'admin', 'instructor');
    const { organizationId, membershipId, support } = currentTenant();
    if (support === true) {
      throw new ForbiddenException({ code: 'not_your_student', message: 'Support invites nobody' });
    }

    const filters = {
      search: readSearch(typeof body['search'] === 'string' ? body['search'] : undefined),
      levelId: typeof body['levelId'] === 'string' && body['levelId'] !== '' ? body['levelId'] : null,
      teacherMembershipId: hasRole('owner', 'admin') ? null : membershipId,
    };
    if (filters.levelId !== null && !/^[0-9a-f-]{36}$/i.test(filters.levelId)) {
      throw new BadRequestException('levelId is a uuid');
    }

    if (body['commit'] !== true) {
      const { candidates: _omit, ...preview } = await previewBulk(organizationId, filters);
      return { ...preview, sent: 0 };
    }

    // One transaction: the figures checked against the ceiling are the rows
    // written, and the ceiling is read under the same advisory lock every
    // bulk run of this club takes.
    const issued: { invitationId: string; email: string; roles: string[]; token: string; expiresAt: Date }[] = [];
    const preview = await withOrg(organizationId, async (tx) => {
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext('family-invitations:' || $1))`, [organizationId]);
      const found = await previewBulkIn(tx, filters);
      if (found.sentToday + found.byEmail > found.ceiling) {
        throw new ConflictException({
          code: 'invitation_ceiling',
          message: 'That would pass today’s ceiling',
          ceiling: found.ceiling,
          sentToday: found.sentToday,
          asked: found.byEmail,
        });
      }
      for (const candidate of found.candidates) {
        const { token, tokenHash } = issueToken();
        const expiresAt = invitationExpiry();
        const outcome = await createFamilyInvitationIn(tx, {
          organizationId,
          invitedByMembershipId: membershipId,
          studentId: candidate.studentId,
          membershipId: candidate.membershipId,
          channel: 'email',
          email: null,
          tokenHash,
          expiresAt,
        });
        if (outcome.kind === 'created' && outcome.email !== null) {
          issued.push({ invitationId: outcome.invitationId, email: outcome.email, roles: outcome.roles, token, expiresAt });
        }
      }
      return found;
    });

    // After the commit, never inside it: an email cannot be taken back.
    for (const one of issued) {
      await deliver(organizationId, one.invitationId, one.email, one.roles, one.token, one.expiresAt);
    }

    const { candidates: _omit, ...figures } = preview;
    return { ...figures, sent: issued.length };
  }
}
