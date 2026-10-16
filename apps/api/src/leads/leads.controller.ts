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
  Put,
  Query,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireRole } from '../tenant/roles.js';
import { AlreadyEnrolledError, FullError } from '../classes/classes.repository.js';
import { DuplicateTaxNumberError, ageOfMajority } from '../students/students.repository.js';
import { parseStudent, taxNumberConflict } from '../students/students.controller.js';
import {
  LeadNotOpenError,
  SlugTakenError,
  TrialFullError,
  TrialUnavailableError,
  bookTrial,
  dismissLead,
  lastCeilingReached,
  listLeads,
  placeLead,
  readLead,
  readRegistrationSettings,
  studentBodyFor,
  trialOptions,
  updateRegistrationSettings,
  type Lead,
  type RegistrationSettings,
  type TrialOption,
} from './leads.repository.js';

/** Who works the queue: the people who already enrol students. */
const CAN_WORK_LEADS = ['owner', 'admin'] as const;

/** `lead_retention()` in months, for the sentence that says how long a lead is kept. */
export const LEAD_RETENTION_MONTHS = 12;

function notOpen(error: LeadNotOpenError): ConflictException {
  return new ConflictException({
    code: 'lead_not_open',
    message: `This request is already ${error.status}`,
    values: { status: error.status },
  });
}

function requiredId(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new BadRequestException({
      code: 'invalid',
      message: `${key} is required`,
      fields: { [key]: 'leads.pickRequired' },
    });
  }
  return value;
}

/**
 * The staff half of POOLSE-69 — Owner and Admin.
 *
 * Each action is one call and one transaction. Waitlisting and converting
 * build the student body from the lead and run it through `parseStudent`, so a
 * lead the student form would refuse (a minor with no reachable guardian, a NIF
 * shared with the parent) is refused here with the same fields.
 */
@Controller('leads')
export class LeadsController {
  @Get()
  async list(
    @Query('view') view?: string,
  ): Promise<{ leads: Lead[]; retentionMonths: number; ceilingReachedAt: string | null }> {
    requireRole(...CAN_WORK_LEADS);
    const { organizationId } = currentTenant();
    const leads = await listLeads(organizationId, view === 'done' ? 'done' : 'open');
    return {
      leads,
      retentionMonths: LEAD_RETENTION_MONTHS,
      ceilingReachedAt: await lastCeilingReached(organizationId),
    };
  }

  @Get('trial-options')
  async options(
    @Query('classGroupId', new ParseUUIDPipe()) classGroupId: string,
  ): Promise<{ options: TrialOption[] }> {
    requireRole(...CAN_WORK_LEADS);
    return { options: await trialOptions(currentTenant().organizationId, classGroupId) };
  }

  @Get(':id')
  async one(@Param('id', new ParseUUIDPipe()) id: string): Promise<Lead> {
    requireRole(...CAN_WORK_LEADS);
    const lead = await readLead(currentTenant().organizationId, id);
    if (lead === null) throw new NotFoundException();
    return lead;
  }

  @Post(':id/waitlist')
  async waitlist(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ studentId: string; attached: boolean }> {
    requireRole(...CAN_WORK_LEADS);
    return this.place(id, requiredId(body, 'classGroupId'), true);
  }

  @Post(':id/convert')
  async convert(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ studentId: string; attached: boolean }> {
    requireRole(...CAN_WORK_LEADS);
    return this.place(id, requiredId(body, 'classGroupId'), false);
  }

  @Post(':id/trial')
  async trial(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ booked: true }> {
    requireRole(...CAN_WORK_LEADS);
    const { organizationId, membershipId } = currentTenant();
    const sessionId = requiredId(body, 'sessionId');
    try {
      const outcome = await bookTrial(organizationId, id, sessionId, membershipId);
      if (outcome === 'not_found') throw new NotFoundException();
      return { booked: true };
    } catch (error) {
      if (error instanceof LeadNotOpenError) throw notOpen(error);
      if (error instanceof TrialFullError) {
        throw new ConflictException({
          code: 'trial_full',
          message: 'That class has no place left',
          fields: { sessionId: 'leads.trialFull' },
          values: { capacity: error.capacity, taken: error.taken },
        });
      }
      if (error instanceof TrialUnavailableError) {
        throw new ConflictException({
          code: 'trial_unavailable',
          message: 'That class cannot take a trial lesson',
          fields: { sessionId: 'leads.trialUnavailable' },
        });
      }
      throw error;
    }
  }

  @Post(':id/dismiss')
  async dismiss(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ dismissed: true }> {
    requireRole(...CAN_WORK_LEADS);
    const { organizationId, membershipId } = currentTenant();
    const reason = typeof body['reason'] === 'string' ? body['reason'].trim() : '';
    if (reason === '' || reason.length > 500) {
      throw new BadRequestException({
        code: 'invalid',
        message: 'A reason is required',
        fields: { reason: 'leads.reasonRequired' },
      });
    }
    try {
      const outcome = await dismissLead(organizationId, id, reason, membershipId);
      if (outcome === 'not_found') throw new NotFoundException();
      return { dismissed: true };
    } catch (error) {
      if (error instanceof LeadNotOpenError) throw notOpen(error);
      throw error;
    }
  }

  private async place(
    id: string,
    classGroupId: string,
    waiting: boolean,
  ): Promise<{ studentId: string; attached: boolean }> {
    const { organizationId, membershipId } = currentTenant();
    const lead = await readLead(organizationId, id);
    if (lead === null) throw new NotFoundException();

    const input = parseStudent(studentBodyFor(lead), await ageOfMajority(organizationId));

    try {
      const outcome = await placeLead(organizationId, id, classGroupId, input, waiting, membershipId);
      if (!outcome.ok) {
        if (outcome.reason === 'group_not_found') {
          throw new BadRequestException({
            code: 'invalid',
            message: 'No such turma',
            fields: { classGroupId: 'leads.pickRequired' },
          });
        }
        throw new NotFoundException();
      }
      return { studentId: outcome.studentId, attached: outcome.attached };
    } catch (error) {
      if (error instanceof LeadNotOpenError) throw notOpen(error);
      if (error instanceof DuplicateTaxNumberError) throw taxNumberConflict();
      if (error instanceof FullError) {
        throw new ConflictException({
          code: 'full',
          message: 'This turma is full — add to its waiting list instead',
          fields: { classGroupId: 'leads.groupFull' },
        });
      }
      if (error instanceof AlreadyEnrolledError) {
        throw new ConflictException({
          code: 'already_enrolled',
          message: 'This student is already in that turma',
          fields: { classGroupId: 'leads.alreadyEnrolled' },
        });
      }
      throw error;
    }
  }
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The club's public sign-up switch and the address it lives at.
 *
 * Reading is Owner and Admin, who share the link; changing it is the Owner's,
 * because the slug is the club's public address and the switch decides whether
 * strangers may send it children's details (decisions, 13-10-2026).
 */
@Controller('settings/registration')
export class RegistrationSettingsController {
  @Get()
  async read(): Promise<RegistrationSettings> {
    requireRole(...CAN_WORK_LEADS);
    return readRegistrationSettings(currentTenant().organizationId);
  }

  @Put()
  async update(@Body() body: Record<string, unknown>): Promise<RegistrationSettings> {
    requireRole('owner');
    const slug = typeof body['slug'] === 'string' ? body['slug'].trim().toLowerCase() : '';
    if (!SLUG.test(slug) || slug.length < 3 || slug.length > 60) {
      throw new BadRequestException({
        code: 'invalid',
        message: 'Use lowercase letters, digits and single hyphens (3–60)',
        fields: { slug: 'leads.settings.slugInvalid' },
      });
    }
    try {
      return await updateRegistrationSettings(currentTenant().organizationId, {
        slug,
        open: body['open'] === true,
      });
    } catch (error) {
      if (error instanceof SlugTakenError) {
        throw new ConflictException({
          code: 'slug_taken',
          message: 'Another club already uses that address',
          fields: { slug: 'leads.settings.slugTaken' },
        });
      }
      throw error;
    }
  }
}

