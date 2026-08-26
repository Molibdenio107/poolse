import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { withOrg } from '@poolse/db';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireRole } from '../tenant/roles.js';
import {
  archiveClosure,
  createClosure,
  generateSeason,
  listClosures,
  listSessions,
  sessionsForStudent,
  setSessionCancelled,
  setSubstitute,
  type Closure,
  type GenerationResult,
  type Session,
} from './sessions.repository.js';

/**
 * Slices 1.5 and 1.6 — the closure calendar, and the dated sessions around it.
 *
 * Reading is open to any member, for the same reason turmas are: an instructor
 * needs to know whether Tuesday is on. Writing is owner and admin.
 */

const MAX_REASON = 200;
/**
 * The widest window anyone may ask for in one request.
 *
 * A season is a year, so a year has to fit — and a little more, so that "this
 * September to next August" does not fall a day short. Beyond that it is a
 * runaway query rather than a calendar.
 */
const MAX_WINDOW_DAYS = 400;

interface ClosuresResponse {
  organizationId: string;
  closures: Closure[];
  canManage: boolean;
  pools: { id: string; name: string }[];
}

@Controller('closures')
export class ClosuresController {
  @Get()
  async list(): Promise<ClosuresResponse> {
    const { organizationId } = currentTenant();

    const [closures, pools] = await Promise.all([
      listClosures(organizationId),
      poolChoices(organizationId),
    ]);

    return { organizationId, closures, canManage: hasRole('owner', 'admin'), pools };
  }

  @Post()
  async create(@Body() body: Record<string, unknown>): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const startsOn = parseDate(body['startsOn'], 'startsOn');
    const endsOn = parseDate(body['endsOn'] ?? body['startsOn'], 'endsOn');
    if (endsOn < startsOn) {
      throw new BadRequestException('The closure ends before it starts');
    }

    const reason = typeof body['reason'] === 'string' ? body['reason'].trim() : '';
    if (reason.length === 0) throw new BadRequestException('reason is required');
    if (reason.length > MAX_REASON) {
      throw new BadRequestException(`reason may be at most ${MAX_REASON} characters`);
    }

    const poolId = typeof body['poolId'] === 'string' && body['poolId'].trim().length > 0
      ? body['poolId'].trim()
      : null;

    return {
      id: await createClosure(organizationId, {
        startsOn,
        endsOn,
        reason,
        poolId,
        // Default true: somebody entering a closure almost always means "we are
        // shut". The note-in-the-calendar case is the one that has to be asked for.
        blocksGeneration: body['blocksGeneration'] !== false,
        repeatsAnnually: body['repeatsAnnually'] === true,
      }),
    };
  }

  /**
   * Removes a closure — including a national holiday.
   *
   * Deleting a holiday is a supported move, not an accident to guard against:
   * plenty of municipal pools open on the 5th of October. Regenerating
   * afterwards brings the classes back, because the sessions the closure
   * cancelled still carry its id.
   */
  @Post(':id/archive')
  async remove(@Param('id') id: string): Promise<{ archived: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    if (!(await archiveClosure(organizationId, id))) {
      throw new NotFoundException('No such closure');
    }
    return { archived: true };
  }
}

interface CalendarResponse {
  organizationId: string;
  from: string;
  to: string;
  sessions: Session[];
  canManage: boolean;
}

@Controller('calendar')
export class CalendarController {
  @Get()
  async read(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<CalendarResponse> {
    const { organizationId } = currentTenant();
    const window = parseWindow(from, to);

    return {
      organizationId,
      ...window,
      sessions: await listSessions(organizationId, window.from, window.to),
      canManage: hasRole('owner', 'admin'),
    };
  }

  /**
   * Builds the season: national holidays, then the classes around them.
   *
   * A single button rather than a nightly job, because a solo operator needs to
   * be able to point at the moment the calendar changed. It is idempotent, so
   * pressing it again after editing a turma is the intended way to catch up.
   */
  @Post('generate')
  async generate(@Body() body: Record<string, unknown>): Promise<GenerationResult> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const window = parseWindow(
      typeof body['from'] === 'string' ? body['from'] : undefined,
      typeof body['to'] === 'string' ? body['to'] : undefined,
    );

    return generateSeason(organizationId, window.from, window.to);
  }
}

@Controller('sessions')
export class SessionsCalendarController {
  @Post(':id/cancel')
  async cancel(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ cancelled: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const reason = typeof body['reason'] === 'string' ? body['reason'].trim() : '';
    if (reason.length > MAX_REASON) {
      throw new BadRequestException(`reason may be at most ${MAX_REASON} characters`);
    }

    if (!(await setSessionCancelled(organizationId, id, true, reason || null))) {
      throw new NotFoundException('No such class, or it is already cancelled');
    }
    return { cancelled: true };
  }

  @Post(':id/restore')
  async restore(@Param('id') id: string): Promise<{ restored: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    if (!(await setSessionCancelled(organizationId, id, false, null))) {
      throw new NotFoundException('No such class, or it is not cancelled');
    }
    return { restored: true };
  }

  /**
   * Who is taking it instead. Null clears the substitution and hands the class
   * back to the turma's own instructor.
   */
  @Post(':id/substitute')
  async substitute(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ updated: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const membershipId =
      typeof body['membershipId'] === 'string' && body['membershipId'].trim().length > 0
        ? body['membershipId'].trim()
        : null;

    if (!(await setSubstitute(organizationId, id, membershipId))) {
      throw new NotFoundException('No such class');
    }
    return { updated: true };
  }
}

@Controller('students/:studentId/calendar')
export class StudentCalendarController {
  @Get()
  async read(
    @Param('studentId') studentId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<CalendarResponse> {
    const { organizationId } = currentTenant();
    const window = parseWindow(from, to);

    return {
      organizationId,
      ...window,
      sessions: await sessionsForStudent(organizationId, studentId, window.from, window.to),
      canManage: hasRole('owner', 'admin'),
    };
  }
}

async function poolChoices(organizationId: string): Promise<{ id: string; name: string }[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string; name: string }>(
      `SELECT id, name FROM pool WHERE archived_at IS NULL ORDER BY name`,
    );
    return rows;
  });
}

function parseDate(value: unknown, field: string): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new BadRequestException(`${field} must be a date, as YYYY-MM-DD`);
  }
  // The shape is right; this catches 2026-02-31, which the regex happily allows.
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw new BadRequestException(`${field} is not a real date`);
  }
  return raw;
}

/** Defaults to the current week when nothing is asked for. */
function parseWindow(from?: string, to?: string): { from: string; to: string } {
  const start = from ? parseDate(from, 'from') : mondayOfThisWeek();
  const end = to ? parseDate(to, 'to') : addDays(start, 6);

  if (end < start) throw new BadRequestException('The window ends before it starts');

  const days = Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
  );
  if (days > MAX_WINDOW_DAYS) {
    throw new BadRequestException(`Ask for at most ${MAX_WINDOW_DAYS} days at a time`);
  }

  return { from: start, to: end };
}

function mondayOfThisWeek(): string {
  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  // getUTCDay is Sunday-0; the rest of Poolse is ISO, Monday-1.
  const isoDay = today.getUTCDay() === 0 ? 7 : today.getUTCDay();
  return addDays(today.toISOString().slice(0, 10), 1 - isoDay);
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
