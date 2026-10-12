import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { readPageQuery, type Paginated } from '../common/pagination.js';
import { emailIsConfigured } from '../notifications/notifier.js';
import { myTurmaIds } from '../tenant/assignment.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireCanArchive, requireRole } from '../tenant/roles.js';
import { deliverMessage } from './delivery.js';
import {
  archiveMessage,
  getMessage,
  listAudienceOptions,
  listMessages,
  MESSAGE_AUDIENCES,
  NoRecipientsError,
  previewMessage,
  quotaRefusal,
  sendMessage,
  targetExists,
  type AudienceOptions,
  type MessageAudience,
  type MessageDetail,
  type MessagePreview,
  type MessageSummary,
  type MessageTarget,
} from './messages.repository.js';

/**
 * Messages to families — POOLSE-67.
 *
 * **Owner and admin write to anybody; an instructor writes to their own turmas.**
 * "Their own" is a question about a row — the turma's instructor or a booking's
 * override, `myTurmaIds` — so it is answered here and refused as a 403, never a
 * role list. The composer's dropdown narrows the same way, from the same list,
 * but hiding an option is not the control: the POST asks again.
 *
 * **Preview and send are one route with a flag**, as every importer here is:
 * what the dialog counted and what gets written come from one code path.
 */

const SENDERS = ['owner', 'admin', 'instructor'] as const;

const MAX_SUBJECT = 200;
const MAX_BODY = 10_000;

interface SendResponse extends MessagePreview {
  /** Present when `commit` was true and the message was written. */
  id?: string;
  /**
   * Whether mail will actually leave. False on a laptop or a deploy with no
   * provider — the record is still written, and the dialog says so before the
   * operator presses Enviar rather than after.
   */
  emailConfigured: boolean;
}

interface ListResponse extends Paginated<MessageSummary> {
  /** So the screen hides the composer for a reader the API would refuse. */
  canSend: boolean;
}

/** Null for owner and admin (every turma); the instructor's own turmas otherwise. */
async function turmaScope(): Promise<string[] | null> {
  if (hasRole('owner', 'admin')) return null;
  const { organizationId, membershipId } = currentTenant();
  if (!membershipId) return [];
  return myTurmaIds(organizationId, membershipId);
}

@Controller('messages')
export class MessagesController {
  @Get()
  async list(@Query('page') page?: string, @Query('limit') limit?: string): Promise<ListResponse> {
    requireRole(...SENDERS);
    const { organizationId } = currentTenant();
    const scope = await turmaScope();

    return {
      ...(await listMessages(organizationId, readPageQuery(page, limit), scope)),
      canSend: true,
    };
  }

  /** What the composer can address, for this reader. */
  @Get('audiences')
  async audiences(): Promise<AudienceOptions> {
    requireRole(...SENDERS);
    return listAudienceOptions(currentTenant().organizationId, await turmaScope());
  }

  @Get(':id')
  async one(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<MessageDetail & { canArchive: boolean }> {
    requireRole(...SENDERS);
    const message = await getMessage(currentTenant().organizationId, id, await turmaScope());
    if (message === null) throw new NotFoundException();
    return { ...message, canArchive: hasRole('owner', 'admin') };
  }

  @Post()
  async send(@Body() body: Record<string, unknown>): Promise<SendResponse> {
    requireRole(...SENDERS);
    const { organizationId, membershipId } = currentTenant();
    const target = readTarget(body);

    // The row question. Owner and admin pass at once; an instructor must name a
    // turma that is theirs, and a level, a site or the whole club never is.
    const scope = await turmaScope();
    if (
      scope !== null &&
      (target.audience !== 'class_group' || !scope.includes(target.targetId as string))
    ) {
      throw new ForbiddenException({
        code: 'not_your_turma',
        message: 'An instructor may write only to their own turmas',
      });
    }

    if (!(await targetExists(organizationId, target))) throw new NotFoundException();

    if (body['commit'] !== true) {
      return { ...(await previewMessage(organizationId, target)), emailConfigured: emailIsConfigured() };
    }

    const { subject, text } = readWords(body);
    if (!membershipId) throw new ForbiddenException();
    // Counted again for the response; the send resolves the audience itself,
    // in its own statement, and the record says what was actually written.
    const preview = await previewMessage(organizationId, target);

    try {
      const { id } = await sendMessage(organizationId, membershipId, target, subject, text);
      // After the commit, and not awaited: a club of four hundred families is
      // minutes of sending, and the record is already true. The page reads the
      // delivery state as it lands.
      void deliverMessage(organizationId, id);
      return { ...preview, id, emailConfigured: emailIsConfigured() };
    } catch (error) {
      if (error instanceof NoRecipientsError) {
        throw new ConflictException({
          code: 'no_recipients',
          message: 'Nobody in this audience has an address to write to',
        });
      }
      const quota = quotaRefusal(error);
      if (quota !== null) {
        throw new ConflictException({
          code: 'message_quota',
          message: `Daily ${quota.kind} limit: ${quota.used} of ${quota.limit} used, ${quota.requested} asked`,
          messageQuota: quota,
        });
      }
      throw error;
    }
  }

  @Delete(':id')
  async archive(@Param('id', new ParseUUIDPipe()) id: string): Promise<{ ok: true }> {
    requireCanArchive();
    if (!(await archiveMessage(currentTenant().organizationId, id))) {
      throw new NotFoundException();
    }
    return { ok: true };
  }
}

function readTarget(body: Record<string, unknown>): MessageTarget {
  const audience = body['audience'];
  if (typeof audience !== 'string' || !MESSAGE_AUDIENCES.includes(audience as MessageAudience)) {
    throw new BadRequestException({
      message: 'audience must be one of class_group, level, facility, organization, closure',
      fields: { audience: 'messages.error.audienceRequired' },
    });
  }
  if (audience === 'organization') return { audience, targetId: null };

  const targetId = body['targetId'];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof targetId !== 'string' || !UUID.test(targetId)) {
    throw new BadRequestException({
      message: 'targetId is required for this audience',
      fields: { targetId: 'messages.error.targetRequired' },
    });
  }
  return { audience: audience as MessageAudience, targetId };
}

function readWords(body: Record<string, unknown>): { subject: string; text: string } {
  const subject = typeof body['subject'] === 'string' ? body['subject'].trim() : '';
  const text = typeof body['body'] === 'string' ? body['body'].trim() : '';
  const fields: Record<string, string> = {};

  if (subject.length === 0) fields['subject'] = 'messages.error.subjectRequired';
  else if (subject.length > MAX_SUBJECT) fields['subject'] = 'messages.error.subjectTooLong';
  if (text.length === 0) fields['body'] = 'messages.error.bodyRequired';
  else if (text.length > MAX_BODY) fields['body'] = 'messages.error.bodyTooLong';

  if (Object.keys(fields).length > 0) {
    throw new BadRequestException({ message: 'subject and body are required', fields });
  }
  return { subject, text };
}
