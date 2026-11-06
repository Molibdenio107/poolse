import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  ForbiddenException,
} from '@nestjs/common';
import { WHATSAPP_MAX_TEXT } from '@poolse/rules';
import { clubToday } from '../common/club-day.js';
import { withOrg } from '@poolse/db';
import { deliverMessage } from '../messages/delivery.js';
import { readWords } from '../messages/messages.controller.js';
import { NoRecipientsError, quotaRefusal } from '../messages/messages.repository.js';
import {
  recordStudentWhatsApp,
  sendStudentEmail,
  studentIsLive,
  studentMessageRecipients,
  type StudentMessageRecipient,
} from '../messages/student-messages.repository.js';
import { emailIsConfigured } from '../notifications/notifier.js';
import { requireRole } from '../tenant/roles.js';
import { CoreRoute, moduleIsOn } from '../tenant/modules.js';
import { currentTenant } from '../tenant/tenant.context.js';
import {
  cancelSchedule,
  createSchedule,
  linkAvisoIn,
  readOpenSchedule,
  SCHEDULE_KINDS,
  type ExamSchedule,
  type ScheduleInput,
  type ScheduleKind,
} from './medical-exam-schedule.repository.js';

/**
 * Scheduling a medical exam — POOLSE-192. Owner and admin alone: it is health
 * data, and an instructor reads nothing of it, not even that it exists. The
 * reminder is POOLSE-191's send, marked `health`, and it needs the messages module.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

interface Tab {
  schedule: ExamSchedule | null;
  recipients: StudentMessageRecipient[];
  messagesOn: boolean;
  emailConfigured: boolean;
  /** The club's language: a reminder is written in it, whatever the reader's. */
  locale: string;
}

function optionalText(value: unknown, max: number, field: string): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length > max) {
    throw new BadRequestException({ message: `${field} is too long`, fields: { [field]: 'examSchedule.error.tooLong' } });
  }
  return text === '' ? null : text;
}

function readInput(body: Record<string, unknown>): ScheduleInput {
  const kind = body['kind'];
  if (!(SCHEDULE_KINDS as readonly unknown[]).includes(kind)) {
    throw new BadRequestException({ message: 'kind is required', fields: { kind: 'examSchedule.error.kind' } });
  }
  const dueOn = body['dueOn'];
  if (typeof dueOn !== 'string' || !DAY.test(dueOn) || Number.isNaN(Date.parse(dueOn))) {
    throw new BadRequestException({ message: 'dueOn is a day', fields: { dueOn: 'examSchedule.error.date' } });
  }
  const rawTime = typeof body['dueTime'] === 'string' ? body['dueTime'].trim() : '';
  if (rawTime !== '' && !TIME.test(rawTime)) {
    throw new BadRequestException({ message: 'dueTime is HH:MM', fields: { dueTime: 'examSchedule.error.time' } });
  }
  return {
    kind: kind as ScheduleKind,
    dueOn,
    // A deadline has a day and no hour to attend at.
    dueTime: kind === 'appointment' && rawTime !== '' ? rawTime : null,
    place: optionalText(body['place'], 200, 'place'),
    note: optionalText(body['note'], 500, 'note'),
  };
}

@CoreRoute()
@Controller('students/:studentId/medical-exam-schedule')
export class MedicalExamScheduleController {
  @Get()
  async read(@Param('studentId', ParseUUIDPipe) studentId: string): Promise<Tab> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();
    if (!(await studentIsLive(organizationId, studentId))) throw new NotFoundException('No such student');
    const locale = await withOrg(organizationId, async (tx) => {
      const { rows } = await tx.query<{ locale: string }>('SELECT locale FROM organization WHERE id = $1', [organizationId]);
      return rows[0]?.locale ?? 'pt-PT';
    });
    return {
      schedule: await readOpenSchedule(organizationId, studentId),
      recipients: await studentMessageRecipients(organizationId, studentId),
      messagesOn: moduleIsOn('messages'),
      emailConfigured: emailIsConfigured(),
      locale,
    };
  }

  @Post()
  async create(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const { organizationId, membershipId } = currentTenant();
    const made = await createSchedule(organizationId, membershipId ?? null, studentId, readInput(body));
    if (made === 'not_found') throw new NotFoundException('No such student');
    if (made === 'taken') throw new ConflictException({ code: 'schedule_open', message: 'One is already scheduled' });
    if (made === 'past') {
      throw new BadRequestException({ message: 'The date has passed', fields: { dueOn: 'examSchedule.error.past' } });
    }
    return made;
  }

  @Post(':scheduleId/cancel')
  async cancel(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
  ): Promise<{ cancelled: true }> {
    requireRole('owner', 'admin');
    if (!(await cancelSchedule(currentTenant().organizationId, studentId, scheduleId))) {
      throw new NotFoundException('Nothing open with that id');
    }
    return { cancelled: true };
  }

  /**
   * The reminder, pressed by a person. The first raises the aviso, through to the
   * day after the date; a resend writes again and raises no second one.
   */
  @Post(':scheduleId/remind')
  async remind(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string; links?: { name: string; url: string }[] }> {
    requireRole('owner', 'admin');
    const { organizationId, membershipId } = currentTenant();
    if (!membershipId) throw new ForbiddenException();
    if (!moduleIsOn('messages')) throw new ConflictException({ code: 'messages_off', message: 'The messages module is off' });

    const schedule = await readOpenSchedule(organizationId, studentId);
    if (schedule === null || schedule.id !== scheduleId) throw new NotFoundException('Nothing open with that id');

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
    const options = {
      health: true,
      // Once, and only while a window is left to show it in.
      shownUntil: schedule.reminded || schedule.avisoLastDay < today ? null : schedule.avisoLastDay,
      onAviso: (tx: Parameters<typeof linkAvisoIn>[0], avisoId: string) => linkAvisoIn(tx, scheduleId, avisoId),
    };
    const words = { subject, body: text };
    try {
      if (channel === 'whatsapp') {
        const { id, links } = await recordStudentWhatsApp(organizationId, membershipId, studentId, words, today, options);
        return { id, links };
      }
      const { id } = await sendStudentEmail(organizationId, membershipId, studentId, words, today, options);
      void deliverMessage(organizationId, id);
      return { id };
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
