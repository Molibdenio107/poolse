import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { withOrg } from '@poolse/db';
import { isExclusionViolation } from './sessions.repository.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireCanArchive, requireRole } from '../tenant/roles.js';
import { canSeeBothViews, teachesOnly } from '../tenant/assignment.js';
import { nameOrder, shortName } from '../people/names.js';
import {
  facilityHours,
  listFacilities,
  type FacilityDay,
} from '../facilities/facilities.repository.js';
import {
  addSchedule,
  AlreadyEnrolledError,
  archiveClassGroup,
  createClassGroup,
  DuplicateNameError,
  NoSuchLaneError,
  endEnrollment,
  enrol,
  findClassGroup,
  FullError,
  listClassGroups,
  moveSchedule,
  removeSchedule,
  timetableFor,
  updateClassGroup,
  type ClassGroup,
  type ClassGroupInput,
  type TimetableEntry,
} from './classes.repository.js';

interface Choice {
  id: string;
  name: string;
}

interface ClassesResponse {
  organizationId: string;
  /** Not paginated: a week grid is a calendar — see listClassGroups. */
  groups: ClassGroup[];
  canManage: boolean;
  /** Which view the list is showing — slice 1.12. */
  scope: 'mine' | 'all';
  /** Whether this person has a second view worth offering a switch to. */
  canSwitchScope: boolean;
  /** What the create and edit forms may choose from, in one payload. */
  options: {
    /** With their age bounds, so the enrol picker can filter by them. */
    levels: (Choice & { minAgeMonths: number | null; maxAgeMonths: number | null })[];
    pools: Choice[];
    instructors: Choice[];
    /** With birth dates, for the same reason. */
    students: (Choice & { birthDate: string | null })[];
  };
  /**
   * Every site and its weekly opening hours — round 5.
   *
   * The schedule board picks one and draws its rows between that day's opening
   * and closing time. Sent with the turmas rather than fetched separately
   * because the board is useless without both, and two requests would let it
   * render against constants for a beat before correcting itself.
   */
  facilities: { id: string; name: string; hours: FacilityDay[] }[];
}

const MAX_NAME = 120;

/**
 * Slice 1.4 with 1.7 folded in — turmas, their weekly pattern, and who is in
 * them.
 *
 * Reading is open to any member: an instructor needs to know which turma is in
 * their lane on Tuesday. Writing is owner and admin, the line every other slice
 * draws.
 *
 * **Slice 1.12 gives the list a point of view.** An instructor who is only an
 * instructor sees their own turmas — a list of forty when four are yours is a
 * list you stop reading. An **owner who also teaches gets both**, because both
 * are real questions for the same person on the same evening: "what am I
 * teaching" and "what is the club running". `?scope=all` or `?scope=mine`
 * chooses; the default is whichever the caller's roles make useful.
 *
 * The switch is offered rather than imposed, and `scope=all` is honoured for an
 * instructor too — the turma list is not secret, and POOLSE-49's grid already
 * shows every booking in the building to everybody. What 1.12 narrows is the
 * *acting*: marking a register, confirming an advancement, approving a
 * reposição. Those live in `tenant/assignment.ts` and are refused, not hidden.
 */
@Controller('class-groups')
export class ClassesController {
  @Get()
  async list(@Query('scope') scope?: string): Promise<ClassesResponse> {
    const { organizationId, membershipId } = currentTenant();

    /*
     * Which view, and who is entitled to a choice about it.
     *
     * `teachesOnly` — an instructor holding no office role — defaults to their
     * own and may still ask for everything. Everybody else defaults to the club.
     */
    const wants = scope === 'mine' ? 'mine' : scope === 'all' ? 'all' : null;
    const mineByDefault = teachesOnly();
    const showingMine = wants === null ? mineByDefault : wants === 'mine';

    /*
     * Neither half is paginated — POOLSE-29, and both for stated reasons.
     *
     * `groups` feeds a week grid, which is a calendar bounded by a fixed window;
     * see the note on listClassGroups. `options` fills the form that creates a
     * turma, and a half-filled dropdown is a form that silently cannot express
     * what somebody wants.
     */
    const [groups, options, facilities] = await Promise.all([
      listClassGroups(organizationId, showingMine ? membershipId : null),
      formOptions(organizationId),
      // One query per site rather than one join: a club has two or three sites,
      // and seven rows each is a rounding error next to the turmas above.
      listFacilities(organizationId).then((sites) =>
        Promise.all(
          sites.map(async (site) => ({
            id: site.id,
            name: site.name,
            hours: await facilityHours(organizationId, site.id),
          })),
        ),
      ),
    ]);

    return {
      organizationId,
      groups,
      canManage: hasRole('owner', 'admin'),
      // What the list is showing, and whether this person has a second view to
      // switch to. The screen renders the toggle from these two rather than
      // re-deriving the rule from roles it would have to know about.
      scope: showingMine ? ('mine' as const) : ('all' as const),
      canSwitchScope: canSeeBothViews(),
      options,
      // The sites and their weekly opening hours — round 5. The schedule board
      // draws its rows between a day's opening and closing time rather than
      // between two constants, so a class at 06:30 at a site open from 06:00 is
      // on the grid instead of above it.
      facilities,
    };
  }

  @Get(':id')
  async one(@Param('id') id: string): Promise<ClassGroup & { canManage: boolean }> {
    const { organizationId } = currentTenant();

    const group = await findClassGroup(organizationId, id);
    if (!group) throw new NotFoundException('No such class group');

    return { ...group, canManage: hasRole('owner', 'admin') };
  }

  @Post()
  async create(@Body() body: Record<string, unknown>): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    try {
      const created = await createClassGroup(organizationId, parseGroup(body));

      // A club that has never opened an época has nowhere to put a turma. Said
      // in words; before this the NOT NULL said it as a 500.
      if (created === 'no_season') {
        throw new BadRequestException('Open an época before creating a turma');
      }

      return { id: created.id };
    } catch (error) {
      throw asHttp(error);
    }
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ updated: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    let updated: boolean;
    try {
      updated = await updateClassGroup(organizationId, id, parseGroup(body));
    } catch (error) {
      /*
       * Changing a turma's instructor rewrites its future sessions, and that
       * rewrite can walk into somebody already teaching then — backlog round 4,
       * ticket 1.
       *
       * Refused as a 409 rather than a 500, because nothing is broken: the
       * person is busy. The whole update is rolled back, so the turma is not
       * left with a new instructor and old sessions.
       */
      if (isExclusionViolation(error)) {
        throw new ConflictException({
          code: 'instructor_busy',
          message: 'That instructor already has a class at one of these times',
        });
      }
      throw asHttp(error);
    }
    if (!updated) throw new NotFoundException('No such class group');
    return { updated: true };
  }

  @Post(':id/archive')
  async archive(@Param('id') id: string): Promise<{ archived: true; ended: number }> {
    requireCanArchive();
    const { organizationId } = currentTenant();

    const result = await archiveClassGroup(organizationId, id);
    if (!result.archived) throw new NotFoundException('No such class group');
    return { archived: true, ended: result.ended };
  }

  @Post(':id/schedules')
  async schedule(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ added: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const outcome = await addSchedule(
      organizationId,
      id,
      parseWeekday(body['weekday']),
      parseTime(body['startTime']),
      parseDuration(body['durationMinutes']),
    );

    if (outcome === 'not_found') throw new NotFoundException('No such class group');
    if (outcome === 'duplicate') {
      throw new ConflictException('That class group already runs at that time on that day');
    }
    refuseIfClosed(outcome);
    return { added: true };
  }

  /**
   * Drag a slot to a new day or time — round 5.
   *
   * The duration is deliberately not accepted here. A drag says "this class
   * happens then instead"; changing how long it runs for is a different
   * decision, made in the form, and letting a drop carry it would mean a
   * mis-aimed pointer could quietly shorten a lesson.
   */
  @Post(':id/schedules/:scheduleId/move')
  async moveSlot(
    @Param('id') id: string,
    @Param('scheduleId') scheduleId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ moved: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const outcome = await moveSchedule(
      organizationId,
      id,
      scheduleId,
      parseWeekday(body['weekday']),
      parseTime(body['startTime']),
    );

    if (outcome === 'not_found') throw new NotFoundException('No such slot');
    if (outcome === 'duplicate') {
      throw new ConflictException('That class group already runs at that time on that day');
    }
    refuseIfClosed(outcome);
    return { moved: true };
  }

  @Post(':id/schedules/:scheduleId/remove')
  async unschedule(
    @Param('id') id: string,
    @Param('scheduleId') scheduleId: string,
  ): Promise<{ removed: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    if (!(await removeSchedule(organizationId, id, scheduleId))) {
      throw new NotFoundException('No such slot');
    }
    return { removed: true };
  }

  @Post(':id/enrollments')
  async addStudent(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ status: 'enrolled' | 'waiting' }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const studentId = typeof body['studentId'] === 'string' ? body['studentId'].trim() : '';
    if (!studentId) throw new BadRequestException('studentId is required');

    let outcome: 'enrolled' | 'waiting' | 'not_found';
    try {
      outcome = await enrol(organizationId, id, studentId, body['waiting'] === true);
    } catch (error) {
      if (error instanceof FullError) {
        // A real answer, not a failure: the operator's next move is the waiting
        // list, and the message says so.
        throw new ConflictException('This class group is full. Add them to the waiting list.');
      }
      if (error instanceof AlreadyEnrolledError) {
        throw new ConflictException('That student is already in this class group');
      }
      throw error;
    }

    if (outcome === 'not_found') throw new NotFoundException('No such class group or student');
    return { status: outcome };
  }

  @Post(':id/enrollments/:enrollmentId/end')
  async removeStudent(
    @Param('id') id: string,
    @Param('enrollmentId') enrollmentId: string,
  ): Promise<{ ended: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    if (!(await endEnrollment(organizationId, id, enrollmentId))) {
      throw new NotFoundException('No such enrollment');
    }
    return { ended: true };
  }
}

/**
 * One student's week.
 *
 * Lives on the student rather than under class-groups because that is the
 * question being asked — "when does João swim?" — and the answer spans every
 * turma he is in.
 */
@Controller('students/:studentId/timetable')
export class TimetableController {
  @Get()
  async read(@Param('studentId') studentId: string): Promise<{ entries: TimetableEntry[] }> {
    const { organizationId } = currentTenant();
    return { entries: await timetableFor(organizationId, studentId) };
  }
}

/**
 * Everything the forms need to choose from.
 *
 * Gathered here rather than by four separate requests from the browser: the
 * class screen cannot render a create form without all of them, so making the
 * page wait on four round trips instead of one buys nothing.
 */
async function formOptions(organizationId: string): Promise<ClassesResponse['options']> {
  return withOrg(organizationId, async (tx) => {
    const levels = await tx.query<
      Choice & { minAgeMonths: number | null; maxAgeMonths: number | null }
    >(
      // The bounds travel with the level — round 5. The enrol picker filters
      // by the age range of the turma's level, and a level with no ages
      // filters nothing, which is why both columns come through as nulls
      // rather than being defaulted here.
      `SELECT id, name, min_age_months AS "minAgeMonths", max_age_months AS "maxAgeMonths"
         FROM student_level WHERE archived_at IS NULL ORDER BY sort_order, name`,
    );
    const pools = await tx.query<Choice>(
      `SELECT id, name FROM pool WHERE archived_at IS NULL ORDER BY name`,
    );
    // Anyone who can teach. An owner who also takes a turma appears here, which
    // is the case membership_role exists for.
    const instructors = await tx.query<Choice>(
      `SELECT m.id,
              coalesce(short_name(u.cached_first_name, u.cached_last_name),
                       u.cached_email::text, m.id::text) AS name
         FROM membership m
         JOIN membership_role mr
           ON mr.membership_id = m.id AND mr.organization_id = m.organization_id
          AND mr.role IN ('instructor', 'owner', 'admin') AND mr.archived_at IS NULL
         LEFT JOIN app_user u ON u.id = m.app_user_id
        WHERE m.archived_at IS NULL AND m.status = 'active'
        GROUP BY m.id, u.cached_first_name, u.cached_last_name, u.cached_email
        ORDER BY name`,
    );
    const students = await tx.query<Choice & { birthDate: string | null }>(
      // `birth_date`, so the picker can tell who fits the level. Sent as the
      // date rather than an age because `fitsLevel` works in months and the
      // browser is the only place that knows what day it is for the reader.
      `SELECT id, ${shortName('student')} AS name, birth_date AS "birthDate"
         FROM student WHERE archived_at IS NULL ORDER BY ${nameOrder('student')}`,
    );

    return {
      levels: levels.rows,
      pools: pools.rows,
      instructors: instructors.rows,
      students: students.rows,
    };
  });
}

function asHttp(error: unknown): unknown {
  if (error instanceof DuplicateNameError) {
    return new ConflictException(`"${error.message}" already exists`);
  }

  /*
   * A lane the pool does not have — POOLSE-43.
   *
   * The old `lane smallint` accepted 7 in a six-lane pool and nothing objected;
   * now the number has to name a lane that exists. A 400 rather than a 409:
   * this is a value the form sent that is not a value, not two people competing
   * for the same thing.
   */
  if (error instanceof NoSuchLaneError) {
    return new BadRequestException({ message: 'noSuchLane', lane: error.lane });
  }

  return error;
}

function parseGroup(body: Record<string, unknown>): ClassGroupInput {
  const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
  /*
   * Refusals name the field — POOLSE-QA-06.
   *
   * `fields` maps a field to a translation key the web app owns, so the message
   * lands beside the box that caused it instead of as one sentence at the top of
   * a six-field form. The prose in `message` is for the log, never for a user.
   */
  if (name.length === 0) {
    throw new BadRequestException({
      message: 'name is required',
      fields: { name: 'classes.nameRequired' },
    });
  }
  if (name.length > MAX_NAME) {
    throw new BadRequestException({
      message: `name may be at most ${MAX_NAME} characters`,
      fields: { name: 'classes.nameTooLong' },
    });
  }

  return {
    name,
    levelId: optionalId(body['levelId']),
    poolId: optionalId(body['poolId']),
    instructorMembershipId: optionalId(body['instructorMembershipId']),
    capacity: optionalCount(body['capacity'], 'capacity', 200, 'classes.capacityInvalid'),
    lane: optionalCount(body['lane'], 'lane', 50, 'classes.laneInvalid'),
  };
}

function optionalId(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length === 0 ? null : trimmed;
}

/** Empty means "not decided" — for capacity, that means no limit. */
function optionalCount(
  value: unknown,
  field: string,
  max: number,
  errorKey?: string,
): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
    /*
     * A negative lotação used to be stopped only by `min="1"` on the input, and
     * the browser's own bubble did not show — so the button did nothing at all
     * and looked broken (POOLSE-QA-07). The rule belongs here, where a crafted
     * request meets it too, and it names the field so the form can point at it.
     */
    throw new BadRequestException({
      message: `${field} must be a whole number between 1 and ${max}`,
      ...(errorKey === undefined ? {} : { fields: { [field]: errorKey } }),
    });
  }
  return parsed;
}

function parseWeekday(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 7) {
    throw new BadRequestException('weekday must be 1 (Monday) to 7 (Sunday)');
  }
  return parsed;
}

/** Wall-clock at the facility, "HH:MM". Not an instant — see the migration. */
function parseTime(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) {
    throw new BadRequestException('startTime must be a time of day, as HH:MM');
  }
  return raw;
}

function parseDuration(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isInteger(parsed) || parsed < 5 || parsed > 480) {
    throw new BadRequestException('durationMinutes must be between 5 and 480');
  }
  return parsed;
}

/**
 * The pool is shut then — round 5.
 *
 * A rule, not a crash. The facility-hours triggers were raising `check_violation`
 * and nothing read it, so adding a Tuesday to a turma at a pool that does not
 * open on Tuesdays reached the operator as "500". Each refusal names the field it
 * is about, so the sentence lands beside the control that caused it.
 */
function refuseIfClosed(outcome: string): void {
  const said: Record<string, { field: string; key: string; message: string }> = {
    closed_that_day: {
      field: 'weekday',
      key: 'classes.slotClosedDay',
      message: 'The pool does not open on that day',
    },
    outside_hours: {
      field: 'startTime',
      key: 'classes.slotOutsideHours',
      message: 'The pool is not open at that time',
    },
    ends_after_closing: {
      field: 'durationMinutes',
      key: 'classes.slotEndsAfterClosing',
      message: 'The class would run past closing time',
    },
  };

  const refusal = said[outcome];
  if (refusal === undefined) return;

  throw new ConflictException({
    code: outcome,
    message: refusal.message,
    fields: { [refusal.field]: refusal.key },
  });
}
