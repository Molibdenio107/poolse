import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { withOrg } from '@poolse/db';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireCanArchive, requireRole } from '../tenant/roles.js';
import {
  archiveClosure,
  ClosureOverlapError,
  closureImpact,
  createClosure,
  findClash,
  findScheduleClashes,
  findSessionSlot,
  generateSeason,
  isExclusionViolation,
  isMarkedSessionViolation,
  isOwnClass,
  listClosures,
  listSessions,
  removeFutureSessions,
  sessionsForStudent,
  updateClosure,
  cancelSession,
  setSubstitute,
  type Closure,
  type ClosureImpact,
  type ClosureInput,
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

    try {
      return { id: await createClosure(organizationId, parseClosure(body)) };
    } catch (error) {
      throw asOverlap(error);
    }
  }

  /**
   * What a range would take down — POOLSE-31, criterion 10.
   *
   * Asked while somebody is still choosing dates, so it takes a range rather
   * than a closure id. Read-only, and readable by anyone who may create one.
   */
  @Get('impact')
  async impact(
    @Query('startsOn') startsOn?: string,
    @Query('endsOn') endsOn?: string,
    @Query('poolId') poolId?: string,
  ): Promise<ClosureImpact> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const from = parseDate(startsOn, 'startsOn');
    const to = parseDate(endsOn ?? startsOn, 'endsOn');
    if (to < from) throw new BadRequestException('The closure ends before it starts');

    return closureImpact(
      organizationId,
      from,
      to,
      poolId !== undefined && poolId.trim() !== '' ? poolId.trim() : null,
    );
  }

  /** Extend, shorten or rename — criterion 6. */
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ updated: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    let outcome: 'updated' | 'not_found';
    try {
      outcome = await updateClosure(organizationId, id, parseClosure(body));
    } catch (error) {
      throw asOverlap(error);
    }

    // Also the answer for a national holiday, which is not editable: its dates
    // are computed and renaming one would be a lie that survives regeneration.
    if (outcome === 'not_found') throw new NotFoundException('No such closure');
    return { updated: true };
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
    requireCanArchive();
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

    /*
     * Checked before generating, not caught afterwards — backlog round 4,
     * ticket 1.
     *
     * Generation writes a year of sessions in one statement, so a single
     * instructor booked twice would abort the whole run and leave the operator
     * holding a constraint name for a turma they set up weeks ago. Asking the
     * question of the weekly patterns first means the answer names the two
     * turmas to fix.
     */
    const clashes = await findScheduleClashes(organizationId);
    if (clashes.length > 0) {
      throw new ConflictException({
        code: 'schedule_clash',
        message: 'Two turmas share an instructor at the same time',
        clashes,
      });
    }

    try {
      return await generateSeason(organizationId, window.from, window.to);
    } catch (error) {
      /*
       * A closure added after a term was taught. The trigger refuses to cancel a
       * class somebody marked, which aborts the whole generation — and that is
       * the right outcome: the alternative is silently erasing classes people
       * attended. The operator is told which closure to reconsider rather than
       * shown a database error.
       */
      if (isMarkedSessionViolation(error)) {
        throw new ConflictException({
          code: 'attendance_recorded',
          message: 'A closure covers a class that has already been marked',
        });
      }
      throw error;
    }
  }
}

/**
 * Turns an exclusion violation into a sentence naming the clash.
 *
 * The session is read back so the clash can be described in the operator's own
 * terms — the turma's name, the time on the pool's clock, the lane. A 409 rather
 * than a 500: nothing is broken, the slot is taken.
 */
async function asClash(organizationId: string, sessionId: string): Promise<ConflictException> {
  const session = await findSessionSlot(organizationId, sessionId);
  const clash = session === null ? null : await findClash(organizationId, session);

  return new ConflictException({
    code: 'session_clash',
    message: 'That slot is already taken',
    clash,
  });
}

@Controller('sessions')
export class SessionsCalendarController {
  /**
   * Removes a class — POOLSE-14.
   *
   * Two scopes: this occurrence, or this and every later one. Never the past —
   * "and all future" starts here and runs forward, and last March keeps whatever
   * happened.
   *
   * Nothing is deleted either way. `status = 'cancelled'` is what attendance
   * history, invoicing and any later "was there a class that Tuesday?" all rest
   * on; the row survives and the calendar simply stops offering it.
   */
  @Post(':id/cancel')
  async cancel(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ cancelled: true; removed?: number; keptMarked?: number }> {
    const { organizationId, membershipId } = currentTenant();

    /*
     * Owner, admin, or the instructor teaching this class — criterion 7.
     *
     * The instructor case is scoped to their own classes and includes one they
     * are covering as a substitute: if they are the person standing at the
     * poolside, they are the person who knows it is off.
     */
    if (!hasRole('owner', 'admin') && !(await isOwnClass(organizationId, id, membershipId))) {
      throw new ForbiddenException({
        code: 'not_your_class',
        message: 'You can only remove classes you teach',
      });
    }

    const reason = typeof body['reason'] === 'string' ? body['reason'].trim() : '';
    if (reason.length > MAX_REASON) {
      throw new BadRequestException(`reason may be at most ${MAX_REASON} characters`);
    }

    if (body['scope'] === 'future') {
      let outcome;
      try {
        outcome = await removeFutureSessions(organizationId, id, reason || null);
      } catch (error) {
        if (isMarkedSessionViolation(error)) {
          throw new ConflictException({
            code: 'attendance_recorded',
            message: 'Attendance has been recorded for this class',
          });
        }
        throw error;
      }

      if (outcome === null) throw new NotFoundException('No such class');
      return { cancelled: true, removed: outcome.removed, keptMarked: outcome.keptMarked };
    }

    try {
      if (!(await cancelSession(organizationId, id, reason || null))) {
        throw new NotFoundException('No such class, or it is already cancelled');
      }
    } catch (error) {
      // Backlog round 3, story 5's last rule, now that attendance exists: a
      // class somebody marked cannot be called off, and the interface explains
      // why rather than showing a database error.
      if (isMarkedSessionViolation(error)) {
        throw new ConflictException({
          code: 'attendance_recorded',
          message: 'Attendance has been recorded for this class',
        });
      }
      throw error;
    }

    return { cancelled: true };
  }

  /*
   * There is no `POST :id/restore`. Backlog round 3, story 5 removed the
   * operator-facing restore, and the endpoint went with the control rather than
   * staying behind as the one caller-less route in the API — dead code that
   * implements a withdrawn feature is how the feature comes back by accident.
   *
   * A class cancelled by a *closure* still returns on its own: `generate_sessions`
   * restores those in SQL when the closure is removed, which is a different
   * mechanism, still covered by `sessions.sql` test 5, and untouched by any of
   * this.
   *
   * Reinstating the operator-facing restore is a revert of one commit if the
   * decision changes.
   */

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

    try {
      if (!(await setSubstitute(organizationId, id, membershipId))) {
        throw new NotFoundException('No such class');
      }
    } catch (error) {
      // Somebody covering a class cannot also be teaching their own at that
      // moment. The constraint says so; this says which class.
      if (isExclusionViolation(error)) throw await asClash(organizationId, id);
      throw error;
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

/**
 * The fields of a closure, read once for both create and edit — POOLSE-31.
 *
 * Shared deliberately: two parsers drift, and the first symptom is a closure you
 * can save but not edit because one of them trims and the other does not.
 */
function parseClosure(body: Record<string, unknown>): ClosureInput {
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

  const poolId =
    typeof body['poolId'] === 'string' && body['poolId'].trim().length > 0
      ? body['poolId'].trim()
      : null;

  return {
    startsOn,
    endsOn,
    reason,
    poolId,
    // Default true: somebody entering a closure almost always means "we are
    // shut". The note-in-the-calendar case is the one that has to be asked for.
    blocksGeneration: body['blocksGeneration'] !== false,
    repeatsAnnually: body['repeatsAnnually'] === true,
  };
}

/**
 * Turns an overlap into a 409 that names the closure already there.
 *
 * A conflict, not a bad request: nothing about what was sent is malformed, and
 * the same range would be perfectly valid tomorrow if the other closure were
 * removed. Anything else is rethrown untouched.
 */
function asOverlap(error: unknown): unknown {
  if (error instanceof ClosureOverlapError) {
    return new ConflictException({
      code: 'closure_overlap',
      message: error.message,
      existing: error.existing,
    });
  }
  return error;
}
