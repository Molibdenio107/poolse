import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  UnprocessableEntityException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { withOrg } from '@poolse/db';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireActsForStudent } from '../students/student-access.js';
import { moveOccurrence } from './classes.repository.js';
import { hasRole, requireCanArchive, requireRole } from '../tenant/roles.js';
import { candidatesFor, setStandIn, type Candidate } from './stand-in.repository.js';
import {
  archiveClosure,
  ClosureOverlapError,
  closureImpact,
  ClosureScopeError,
  createClosures,
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
  NotAnInstructorError,
  PartnershipSeriesError,
  sessionsForStudent,
  updateClosure,
  cancelSession,
  restoreSession,
  setSubstitute,
  type Closure,
  type ClosureImpact,
  type ClosureInput,
  type PartOfDay,
  type GenerationResult,
  type Session,
} from './sessions.repository.js';
import { requireMySession } from '../tenant/assignment.js';
import {
  readLessonPlan,
  familyMayReadPlan,
  saveLessonPlan,
  type LessonPlan,
} from './lesson-plans.repository.js';
import { clubToday } from '../common/club-day.js';

/**
 * Slices 1.5 and 1.6 — the closure calendar, and the dated sessions around it.
 *
 * Reading is open to any member, for the same reason turmas are: an instructor
 * needs to know whether Tuesday is on. Writing is owner and admin.
 */

const MAX_REASON = 200;

/**
 * The ceiling on one lesson plan.
 *
 * Generous past any real session's worth of drills, and present so the field
 * cannot be used to put a novel in the database. A plan longer than this is a
 * document, and documents wait on file storage like everything else.
 */
const MAX_PLAN = 8000;
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
  /** Every tank, with its site — what a water warning arrives naming. */
  pools: { id: string; name: string; facilityId: string }[];
  /** The sites and their tanks, for the form's scope — POOLSE-84. */
  sites: { id: string; name: string; pools: { id: string; name: string }[] }[];
  /** Where a morning ends — `closure_half_day_cut()`, HH:MM, so no screen writes it. */
  halfDayCut: string;
}

@Controller('closures')
export class ClosuresController {
  @Get()
  async list(@Query('year') year?: string): Promise<ClosuresResponse> {
    const { organizationId } = currentTenant();

    /*
     * Year-scoped rather than paginated — POOLSE-29. The page is a twelve-month
     * grid, which is exempt from the page control, but it was still fetching
     * every closure the club had ever declared and discarding all but one year
     * in the browser.
     *
     * A missing or unparseable year means every year, which is what an older
     * client and any script calling this directly will send.
     */
    /*
     * A sane year, not merely a finite one.
     *
     * `?year=0` is finite and reached `make_date(0, 12, 31)`, which Postgres
     * refuses — a 500 for a hand-typed URL. The vacations endpoint already
     * bounds its year; this one only checked for a number. Out of range means
     * "no filter" rather than an error: a bad year in a query string is somebody
     * fiddling, and the whole list is a harmless answer.
     */
    const requested = Number.parseInt(year ?? '', 10);
    const scopedYear =
      Number.isInteger(requested) && requested >= 2000 && requested <= 2100 ? requested : null;

    const [closures, sites, halfDayCut] = await Promise.all([
      listClosures(organizationId, scopedYear),
      siteChoices(organizationId),
      withOrg(organizationId, async (tx) => {
        const { rows } = await tx.query<{ cut: string }>(
          `SELECT to_char(closure_half_day_cut(), 'HH24:MI') AS cut`,
        );
        return rows[0]!.cut;
      }),
    ]);
    const pools = sites.flatMap((site) =>
      site.pools.map((pool) => ({ ...pool, facilityId: site.id })),
    );

    return {
      organizationId,
      closures,
      canManage: hasRole('owner', 'admin'),
      pools,
      sites,
      halfDayCut,
    };
  }

  /**
   * One site, or some of its tanks — POOLSE-84. Several tanks are several
   * closures made in one transaction; `id` is the first, which is all the
   * warning needs (it reaches the whole batch).
   */
  @Post()
  async create(@Body() body: Record<string, unknown>): Promise<{ id: string; ids: string[] }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    try {
      const { ids } = await createClosures(organizationId, parseClosure(body));
      return { id: ids[0]!, ids };
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
    @Query('facilityId') facilityId?: string,
    @Query('poolIds') poolIds?: string,
    @Query('partOfDay') partOfDay?: string,
  ): Promise<ClosureImpact> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    // The same parser as a save, so the count is of the closure that would be made.
    const scope = parseClosure({
      startsOn,
      endsOn: endsOn ?? startsOn,
      reason: '-',
      facilityId,
      poolIds: (poolIds ?? '').split(',').map((id) => id.trim()).filter((id) => id !== ''),
      partOfDay,
    });
    return closureImpact(organizationId, scope);
  }

  /** Extend, shorten or rename — criterion 6. */
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ updated: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const input = parseClosure(body);
    // One row is one tank or the whole site; two tanks are two closures.
    if (input.poolIds.length > 1) {
      throw new UnprocessableEntityException({
        code: 'closure_one_tank',
        message: 'A closure is edited one tank at a time',
      });
    }

    let outcome: 'updated' | 'not_found';
    try {
      outcome = await updateClosure(organizationId, id, input);
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
  /** Absent on a student's own calendar, which offers no register. */
  canTakeRegister?: boolean;
}

@Controller('calendar')
export class CalendarController {
  @Get()
  async read(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<CalendarResponse> {
    // Security review, 12 October 2026: this answered any member, a guardian included.
    requireRole('owner', 'admin', 'instructor', 'maintenance');
    const { organizationId } = currentTenant();
    const window = parseWindow(from, to);

    return {
      organizationId,
      ...window,
      sessions: await listSessions(organizationId, window.from, window.to),
      canManage: hasRole('owner', 'admin'),
      // Who may open a register — the attendance read's own roles, so a
      // maintenance reader is not offered Marcar presenças (15-10-2026).
      canTakeRegister: hasRole('owner', 'admin', 'instructor'),
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
      // An instructor clash the weekly check could not see (a one-week move,
      // a substitute). A sentence, never a 500 — 13-10-2026 sweep.
      if ((error as { code?: string }).code === '23P01') {
        throw new ConflictException({
          code: 'schedule_clash',
          message: 'An instructor would teach two classes at once',
          clashes: [],
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
 *
 * **`attempted` matters, and its absence made this function useless.** The write
 * has already rolled back by the time we get here, so reading the session back
 * gives the instructor it had *before* — not the substitute whose double-booking
 * raised the constraint. `findClash` then looked for a conflict with the wrong
 * person, found none, and every 409 shipped `clash: null`: the exact opposite of
 * what the whole function exists to produce.
 *
 * So the caller passes what it tried to set, and the stored row supplies only
 * the slot — the pool, the lane and the times, which the rollback did not touch.
 */
async function asClash(
  organizationId: string,
  sessionId: string,
  attempted?: { instructorMembershipId?: string | null },
): Promise<ConflictException> {
  const session = await findSessionSlot(organizationId, sessionId);

  const clash =
    session === null
      ? null
      : await findClash(organizationId, {
          ...session,
          instructorMembershipId:
            attempted?.instructorMembershipId !== undefined
              ? attempted.instructorMembershipId
              : session.instructorMembershipId,
        });

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
  /**
   * Moves this one occurrence, and no other — the other half of a drag.
   *
   * A drag on the grid edits the weekly pattern, which changes the class for the
   * rest of the season. That is right about half the time; the other half is
   * "the pool is booked this Tuesday, put this week's class on Wednesday". The
   * grid asks which, and this is the answer for one week.
   *
   * `owner` and `admin`, like every other change to a timetable — an instructor
   * may take a register, not rearrange the season.
   */
  /**
   * Who could teach this lesson, and what stands in the way — round 6.
   *
   * Readable by anybody who can see the calendar. It names instructors and says
   * who is away; that is roster information, not a confidence, and an instructor
   * choosing a colleague to cover for them needs it as much as an admin does.
   */
  @Get(':id/stand-in')
  async standInOptions(@Param('id') id: string): Promise<{
    currentId: string | null;
    candidates: Candidate[];
  }> {
    // Security review, 12 October 2026: this answered any member, a guardian
    // included, and it names a colleague's medical leave.
    requireRole('owner', 'admin', 'instructor');
    const { organizationId } = currentTenant();
    const found = await candidatesFor(organizationId, id);
    if (found === null) throw new NotFoundException({ message: 'sessionNotFound' });
    return found;
  }

  /**
   * Puts somebody else on this lesson.
   *
   * Owner, admin and maintenance may not — this is a teaching decision — so it is
   * owner, admin, and the instructor whose lesson it is. That last part is a
   * permission about a *row*, so it is resolved against the booking rather than
   * written as a role: an instructor who cannot come arranges their own cover,
   * and having to find an admin to record it is how a club goes back to WhatsApp.
   */
  @Post(':id/stand-in')
  async standIn(
    @Param('id') id: string,
    @Body() body: { membershipId?: unknown },
  ): Promise<{ ok: true }> {
    requireRole('owner', 'admin', 'instructor');
    // The row half of the rule the comment above states — 13-10-2026 sweep:
    // an instructor arranges cover for *their own* lesson, not a colleague's.
    await requireMySession(id);
    const { organizationId } = currentTenant();

    const raw = body?.membershipId;
    const membershipId = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;

    const result = await setStandIn(organizationId, id, membershipId);
    if (result === 'missing') throw new NotFoundException({ message: 'sessionNotFound' });
    if (result === 'away') {
      throw new ConflictException({ message: 'calendar.standIn.away' });
    }
    if (result === 'clash') {
      throw new ConflictException({ message: 'calendar.standIn.clash' });
    }
    if (result === 'not_instructor') {
      throw new BadRequestException({ code: 'not_an_instructor', message: 'calendar.standIn.notInstructor' });
    }
    return { ok: true };
  }

  @Post(':id/move')
  async move(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ moved: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const date = body['date'];
    const startTime = body['startTime'];
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('date must be a calendar date');
    }
    if (typeof startTime !== 'string' || !/^\d{2}:\d{2}$/.test(startTime)) {
      throw new BadRequestException('startTime must be HH:MM');
    }

    /*
     * Lanes are optional, and absent is not the same as empty.
     *
     * Absent means "I did not ask about pistas" — the class keeps the ones it
     * has and they follow the clock. An empty array means "this week, in no
     * pista", which is a real state a booking can be in and one the grid draws.
     * Collapsing the two would make a plain time change quietly unassign the
     * lanes, which is the shape of bug that is only noticed a week later.
     */
    const raw = body['laneIds'];
    if (raw !== undefined && !Array.isArray(raw)) {
      throw new BadRequestException('laneIds must be an array of lane ids');
    }
    const laneIds =
      raw === undefined ? null : (raw as unknown[]).map((one) => String(one));

    /*
     * A new length, when the block's bottom edge was dragged — round 8.
     *
     * Optional, and absent is not the same as zero: absent means "I did not ask
     * about the length" and the week keeps the one it has. The same bounds
     * `class_schedule` carries, because a session is not a different kind of
     * thing from the booking it came from.
     */
    const rawDuration = body['durationMinutes'];
    let durationMinutes: number | null = null;
    if (rawDuration !== null && rawDuration !== undefined && rawDuration !== '') {
      const minutes = Number(rawDuration);
      if (!Number.isInteger(minutes) || minutes < 5 || minutes > 480) {
        throw new BadRequestException('durationMinutes must be between 5 and 480');
      }
      durationMinutes = minutes;
    }

    const result = await moveOccurrence(
      organizationId,
      id,
      date,
      startTime,
      laneIds,
      durationMinutes,
    );

    if (result.outcome === 'not_found') throw new NotFoundException('No such class');
    if (result.outcome === 'taught') {
      // The register is taken, so the class happened. Where it happened is a
      // record rather than a plan, and a record is not dragged about.
      throw new ConflictException({ message: 'occurrenceTaught' });
    }
    if (result.outcome === 'instructor_busy') {
      // The instructor is teaching elsewhere then — not a lane problem, and
      // not to be reported as one (13-10-2026 sweep).
      throw new ConflictException({ message: 'occurrenceInstructorBusy' });
    }
    if (result.outcome === 'occupied') {
      /*
       * The lane is genuinely busy, or the class is already there.
       *
       * The figures travel as structure, never as a built sentence: the lane and
       * the class holding it come back as fields and the screen composes the
       * words where the locale is. "Essa pista já está ocupada" on its own sends
       * an operator hunting across six lanes for which one.
       */
      throw new ConflictException({
        message: 'occurrenceOccupied',
        ...(result.clash === null
          ? {}
          : { lane: result.clash.lane, holder: result.clash.holder }),
      });
    }

    return { moved: true };
  }

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
      // Ending every later week ends the turma — a management act, not the
      // one-lesson call a stand-in or the turma's instructor makes for today.
      if (!hasRole('owner', 'admin')) {
        throw new ForbiddenException({
          code: 'future_needs_management',
          message: 'Only an owner or an admin may remove every future week',
        });
      }
      let outcome;
      try {
        outcome = await removeFutureSessions(organizationId, id, reason || null);
      } catch (error) {
        if (error instanceof PartnershipSeriesError) {
          throw new ConflictException({
            code: 'partnership_series',
            message: 'A partnership series is ended from the parceria, not from one of its weeks',
          });
        }
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

  /**
   * Put a cancelled occurrence back — round 5, ticket 9.6.
   *
   * **The decision changed, and this is the revert.** Backlog round 3, story 5
   * removed the operator-facing restore and took the endpoint with it, on the
   * argument that dead code implementing a withdrawn feature is how the feature
   * comes back by accident. That comment said reinstating it would be a revert
   * of one commit if the decision changed. Rui asked for the Undo on the cancel
   * toast, which needs exactly this — so it is back on purpose, with a caller,
   * and `docs/decisions.md` carries the date and the reversal.
   *
   * **Owner and admin only**, which is narrower than cancelling: an instructor
   * may cancel their own class, and putting one back is an undo of somebody
   * else's decision as often as of your own.
   *
   * A class cancelled by a *closure* is refused rather than restored. Those come
   * back on their own when the closure is lifted — `generate_sessions` does it
   * in SQL, covered by `sessions.sql` test 5 — and the pool being shut is not a
   * fact for one operator to overrule from a toast.
   */
  @Post(':id/restore')
  async restore(@Param('id') id: string): Promise<{ restored: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const outcome = await restoreSession(organizationId, id);

    if (outcome === 'not_cancelled') {
      throw new NotFoundException('No such class, or it is not cancelled');
    }
    if (outcome === 'closure') {
      throw new ConflictException({
        code: 'cancelled_by_closure',
        message: 'This class is cancelled by a closure — remove the closure instead',
      });
    }
    return { restored: true };
  }

  /**
   * The plan for this lesson — round 6, ticket 4.3.
   *
   * Staff read every plan: an instructor covering for a colleague needs to
   * know what the group was doing. **A family reads only its own classes** —
   * 15 October 2026 (Rui): a guardian asking what Tuesday holds is asking about
   * a class their child is in (`familyMayReadPlan`), and any other session is a
   * 404. A family is not told who wrote it, nor the lesson before.
   *
   * The response carries `canEdit`, which is the same answer the write guard
   * gives — so the screen and the API cannot disagree about who may type.
   */
  @Get(':id/plan')
  async plan(@Param('id') id: string): Promise<LessonPlan> {
    const { organizationId, roles, membershipId } = currentTenant();
    const staff = hasRole('owner', 'admin', 'instructor', 'maintenance');
    if (!staff && !(await familyMayReadPlan(organizationId, membershipId, id))) {
      throw new NotFoundException('No such class');
    }

    const plan = await readLessonPlan(organizationId, id, roles, membershipId);
    if (plan === null) throw new NotFoundException('No such class');
    return staff ? plan : { ...plan, updatedBy: null, previous: null, canEdit: false };
  }

  /**
   * Writes it — the turma's instructor, a substitute, an owner or an admin.
   *
   * **The guard is here, not only in the UI.** `requireRole` cannot express
   * this one: "the instructor responsible for *this* turma" is a fact about a
   * row, not about a role, so the repository resolves the occurrence and
   * answers, and a refusal is a 403 rather than a silently ignored save.
   *
   * `PUT`, because a plan is one thing per lesson that is replaced rather than
   * appended to. An empty body removes it: clearing the box means there is no
   * plan, and a stored row of whitespace would read as a plan that says nothing.
   */
  @Put(':id/plan')
  async savePlan(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ saved: boolean }> {
    const { organizationId, roles, membershipId } = currentTenant();

    const text = body['body'];
    if (typeof text !== 'string') {
      throw new BadRequestException('body must be text');
    }
    if (text.length > MAX_PLAN) {
      throw new BadRequestException(`body must be at most ${MAX_PLAN} characters`);
    }

    const outcome = await saveLessonPlan(organizationId, id, text, roles, membershipId);

    if (outcome === 'notFound') throw new NotFoundException('No such class');
    if (outcome === 'refused') {
      throw new ForbiddenException('Only this class instructor, an owner or an admin may plan it');
    }
    return { saved: outcome === 'saved' };
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

    try {
      if (!(await setSubstitute(organizationId, id, membershipId))) {
        throw new NotFoundException('No such class');
      }
    } catch (error) {
      if (error instanceof NotAnInstructorError) {
        throw new BadRequestException({ code: 'not_an_instructor', message: 'calendar.standIn.notInstructor' });
      }
      // Somebody covering a class cannot also be teaching their own at that
      // moment. The constraint says so; this says which class — which needs the
      // substitute we tried to set, since the failed write left no trace of them.
      if (isExclusionViolation(error)) {
        throw await asClash(organizationId, id, { instructorMembershipId: membershipId });
      }
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
    // Security review, 12 October 2026: this answered any member, a guardian included. A family reads its own child only.
    await requireActsForStudent(studentId);
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

/** Each live site with its live tanks, by name — the closure form's scope. */
async function siteChoices(
  organizationId: string,
): Promise<{ id: string; name: string; pools: { id: string; name: string }[] }[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      name: string;
      pools: { id: string; name: string }[];
    }>(
      `SELECT f.id, f.name,
              coalesce((SELECT json_agg(json_build_object('id', p.id, 'name', p.name)
                                        ORDER BY p.name)
                          FROM pool p
                         WHERE p.facility_id = f.id AND p.organization_id = f.organization_id
                           AND p.archived_at IS NULL), '[]'::json) AS pools
         FROM facility f
        WHERE f.archived_at IS NULL
        ORDER BY f.name`,
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
  // The club's today, not the server's: on a Monday between midnight and one in
  // a Lisbon summer the server's date is still Sunday. 16-10-2026 sweep.
  const today = clubToday();
  // getUTCDay is Sunday-0; the rest of Poolse is ISO, Monday-1.
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const isoDay = weekday === 0 ? 7 : weekday;
  return addDays(today, 1 - isoDay);
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
const CLOSURE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  /*
   * The site, always — POOLSE-84. A manual closure that names no site used to
   * mean every site of the club, which is the bug this ticket fixed; the
   * database refuses one too, and this is the sentence.
   */
  const facilityId = typeof body['facilityId'] === 'string' ? body['facilityId'].trim() : '';
  if (!CLOSURE_UUID.test(facilityId)) {
    throw new UnprocessableEntityException({
      code: 'closure_site_required',
      message: 'A closure names the site it shuts',
    });
  }

  // `poolIds` (several tanks) or the older `poolId` (one); none is the whole site.
  const rawPools: unknown[] = Array.isArray(body['poolIds'])
    ? body['poolIds']
    : typeof body['poolId'] === 'string' && body['poolId'].trim() !== ''
      ? [body['poolId']]
      : [];
  const poolIds = [
    ...new Set(rawPools.map((id) => (typeof id === 'string' ? id.trim() : ''))),
  ];
  if (poolIds.some((id) => !CLOSURE_UUID.test(id)) || poolIds.length > 50) {
    throw new BadRequestException('poolIds must be a list of tank ids');
  }

  const rawPart = typeof body['partOfDay'] === 'string' ? body['partOfDay'].trim() : '';
  if (rawPart !== '' && rawPart !== 'morning' && rawPart !== 'afternoon') {
    throw new BadRequestException('partOfDay must be morning or afternoon');
  }
  const partOfDay: PartOfDay | null = rawPart === '' ? null : rawPart;
  // Half a day is one day — POOLSE-84 (a CHECK says so too).
  if (partOfDay !== null && startsOn !== endsOn) {
    throw new UnprocessableEntityException({
      code: 'closure_half_day_one_day',
      message: 'A half-day closure is a single day',
    });
  }

  return {
    startsOn,
    endsOn,
    reason,
    facilityId,
    poolIds,
    partOfDay,
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
      // The tank it is on, when it is one — POOLSE-84.
      pool: error.poolName,
    });
  }

  if (error instanceof ClosureScopeError) {
    return new UnprocessableEntityException({
      code: error.code,
      message:
        error.code === 'closure_site_unknown'
          ? 'No such site'
          : "A tank closed here must be one of this site's tanks",
    });
  }

  /*
   * A closure covering a class somebody already marked.
   *
   * `apply_closure` runs inside create and update, and `class_session_keep_marked`
   * refuses to cancel a marked class — correctly: the alternative is silently
   * erasing classes people attended. But nothing here translated the 23001, so
   * saving such a closure returned a 500 while the *generation* path a few
   * hundred lines up already turned the identical error into a 409 with a
   * sentence. Same failure, two answers, depending on which screen you were on.
   */
  if (isMarkedSessionViolation(error)) {
    return new ConflictException({
      code: 'attendance_recorded',
      message: 'That closure covers a class that has already been marked',
    });
  }

  return error;
}
