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
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireRole } from '../tenant/roles.js';
import { PoolseModule } from '../tenant/modules.js';
import { clubToday } from '../common/club-day.js';
import { readTarget, readWords, turmaScope } from './messages.controller.js';
import { NoRecipientsError, targetExists } from './messages.repository.js';
import {
  archiveAviso,
  AVISO_AUDIENCES,
  avisosForReader,
  listAvisos,
  postAviso,
  type AppAviso,
  type AvisoSummary,
} from './avisos.repository.js';

/**
 * Avisos — POOLSE-166 (Rui, 04-11-2026).
 *
 * **Owner and admin post to anybody; an instructor to their own turmas**, the
 * messages rule and the same `turmaScope()`. Ending one early is the office's,
 * or the instructor who posted it. No approval step for an instructor's aviso
 * (the ticket's open point, default taken).
 */

const POSTERS = ['owner', 'admin', 'instructor'] as const;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

@PoolseModule('messages')
@Controller('avisos')
export class AvisosController {
  @Get()
  async list(): Promise<{ avisos: AvisoSummary[]; today: string }> {
    requireRole(...POSTERS);
    const { organizationId, membershipId } = currentTenant();
    return {
      avisos: await listAvisos(organizationId, await turmaScope(), membershipId ?? null),
      today: clubToday(),
    };
  }

  @Post()
  async post(@Body() body: Record<string, unknown>): Promise<{ id: string; studentCount: number }> {
    requireRole(...POSTERS);
    const { organizationId, membershipId } = currentTenant();
    if (!membershipId) throw new ForbiddenException();

    const target = readTarget(body);
    if (!(AVISO_AUDIENCES as readonly string[]).includes(target.audience)) {
      throw new BadRequestException({
        message: 'An aviso goes to a turma, a level, a site, a sport or the club',
        fields: { audience: 'messages.error.audienceRequired' },
      });
    }
    const scope = await turmaScope();
    if (scope !== null && (target.audience !== 'class_group' || !scope.includes(target.targetId as string))) {
      throw new ForbiddenException({
        code: 'not_your_turma',
        message: 'An instructor may post only to their own turmas',
      });
    }
    if (!(await targetExists(organizationId, target))) throw new NotFoundException();

    const { subject, text } = readWords(body);
    const { from, until } = readWindow(body);

    try {
      return await postAviso(organizationId, membershipId, target, subject, text, from, until);
    } catch (error) {
      if (error instanceof NoRecipientsError) {
        throw new ConflictException({
          code: 'no_recipients',
          message: 'Nobody is in this audience today',
          fields: { targetId: 'avisos.error.nobody' },
        });
      }
      throw error;
    }
  }

  /** Ends an aviso early: the office any, an instructor their own (rule 4). */
  @Delete(':id')
  async archive(@Param('id', new ParseUUIDPipe()) id: string): Promise<{ archived: true; archiveEntryId: string }> {
    requireRole(...POSTERS);
    const { organizationId, membershipId } = currentTenant();
    const onlyBy = hasRole('owner', 'admin') ? null : (membershipId ?? '');
    const outcome = await archiveAviso(organizationId, id, onlyBy);
    if (outcome === 'not_found') throw new NotFoundException();
    if (outcome === 'forbidden') {
      throw new ForbiddenException({ code: 'not_your_aviso', message: 'Only the office ends another person’s aviso' });
    }
    return { archived: true, archiveEntryId: outcome.archiveEntryId };
  }
}

/** What the app shows a family or a student on opening it — rule 3. */
@PoolseModule('messages')
@Controller('app/avisos')
export class AppAvisosController {
  @Get()
  async mine(): Promise<{ avisos: AppAviso[] }> {
    requireRole('guardian', 'student');
    const { organizationId, membershipId } = currentTenant();
    if (!membershipId) return { avisos: [] };
    return { avisos: await avisosForReader(organizationId, membershipId) };
  }
}

/** Two club days, the second not before the first, the last not already past. */
function readWindow(body: Record<string, unknown>): { from: string; until: string } {
  const from = typeof body['shownFrom'] === 'string' ? body['shownFrom'].trim() : '';
  const until = typeof body['shownUntil'] === 'string' ? body['shownUntil'].trim() : '';
  const fields: Record<string, string> = {};
  if (!ISO_DAY.test(from) || Number.isNaN(Date.parse(from))) fields['shownFrom'] = 'avisos.error.fromRequired';
  if (!ISO_DAY.test(until) || Number.isNaN(Date.parse(until))) fields['shownUntil'] = 'avisos.error.untilRequired';
  else if (from !== '' && until < from) fields['shownUntil'] = 'avisos.error.untilBeforeFrom';
  else if (until < clubToday()) fields['shownUntil'] = 'avisos.error.untilPast';
  if (Object.keys(fields).length > 0) {
    throw new BadRequestException({ message: 'shownFrom and shownUntil are club days', fields });
  }
  return { from, until };
}
