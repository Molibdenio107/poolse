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
import { WHATSAPP_MAX_TEXT } from '@poolse/rules';
import { clubToday } from '../common/club-day.js';
import { emailIsConfigured } from '../notifications/notifier.js';
import { hasRole, requireRole } from '../tenant/roles.js';
import { PoolseModule } from '../tenant/modules.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { deliverMessage } from './delivery.js';
import { readWords, turmaScope } from './messages.controller.js';
import { NoRecipientsError, quotaRefusal } from './messages.repository.js';
import {
  isInTurmas,
  listStudentMessages,
  recordStudentWhatsApp,
  sendStudentEmail,
  studentIsLive,
  studentMessageRecipients,
  type StudentMessage,
  type StudentMessageRecipient,
} from './student-messages.repository.js';

/**
 * A student's *Mensagens* tab — POOLSE-191. Owner and admin write to anybody and
 * read everything; an instructor writes to a student actively in one of their
 * turmas, a question about a row and not a role, and reads only what they sent.
 */

const SENDERS = ['owner', 'admin', 'instructor'] as const;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

interface Tab {
  recipients: StudentMessageRecipient[];
  messages: StudentMessage[];
  emailConfigured: boolean;
}

interface Sent {
  id: string;
  emailConfigured: boolean;
  /** WhatsApp only: one link per person, to open now. */
  links?: { name: string; url: string }[];
}

@PoolseModule('messages')
@Controller('students/:studentId/messages')
export class StudentMessagesController {
  @Get()
  async list(@Param('studentId', ParseUUIDPipe) studentId: string): Promise<Tab> {
    requireRole(...SENDERS);
    const { organizationId, membershipId } = currentTenant();
    await requireReach(studentId);
    const own = hasRole('owner', 'admin') ? null : (membershipId ?? null);
    return {
      recipients: await studentMessageRecipients(organizationId, studentId),
      messages: await listStudentMessages(organizationId, studentId, own),
      emailConfigured: emailIsConfigured(),
    };
  }

  @Post()
  async send(@Param('studentId', ParseUUIDPipe) studentId: string, @Body() body: Record<string, unknown>): Promise<Sent> {
    requireRole(...SENDERS);
    const { organizationId, membershipId } = currentTenant();
    if (!membershipId) throw new ForbiddenException();
    await requireReach(studentId);

    const channel = body['channel'];
    if (channel !== 'email' && channel !== 'whatsapp') {
      throw new BadRequestException({ code: 'invalid_channel', message: 'channel is email or whatsapp' });
    }
    const { subject, text } = readWords(body);
    if (channel === 'whatsapp' && subject.length + text.length + 2 > WHATSAPP_MAX_TEXT) {
      throw new BadRequestException({
        message: 'Too long for a WhatsApp link',
        fields: { body: 'studentMessages.error.tooLongForWhatsapp' },
      });
    }
    const today = clubToday();
    const shownUntil = readShownUntil(body, today);
    const words = { subject, body: text };

    try {
      if (channel === 'whatsapp') {
        const { id, links } = await recordStudentWhatsApp(organizationId, membershipId, studentId, words, shownUntil, today);
        return { id, links, emailConfigured: emailIsConfigured() };
      }
      const { id } = await sendStudentEmail(organizationId, membershipId, studentId, words, shownUntil, today);
      void deliverMessage(organizationId, id);
      return { id, emailConfigured: emailIsConfigured() };
    } catch (error) {
      if (error instanceof NoRecipientsError) {
        throw new ConflictException({
          code: channel === 'whatsapp' ? 'no_phone' : 'no_recipients',
          message: 'Nobody for this student can be reached this way',
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
}

/** A 404 for a student who is not this club's; a 403 for one who is not the instructor's. */
async function requireReach(studentId: string): Promise<void> {
  const { organizationId } = currentTenant();
  if (!(await studentIsLive(organizationId, studentId))) throw new NotFoundException();
  const turmas = await turmaScope();
  if (turmas !== null && !(await isInTurmas(organizationId, studentId, turmas))) {
    throw new ForbiddenException({ code: 'not_your_student', message: 'An instructor writes only to their own students' });
  }
}

/** The tick's last day, or null when the tick is off. */
function readShownUntil(body: Record<string, unknown>, today: string): string | null {
  const until = body['shownUntil'];
  if (until === undefined || until === null || until === '') return null;
  if (typeof until !== 'string' || !ISO_DAY.test(until) || Number.isNaN(Date.parse(until))) {
    throw new BadRequestException({ message: 'shownUntil is a club day', fields: { shownUntil: 'avisos.error.untilRequired' } });
  }
  if (until < today) {
    throw new BadRequestException({ message: 'shownUntil has passed', fields: { shownUntil: 'avisos.error.untilPast' } });
  }
  return until;
}
