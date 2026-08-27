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
} from '@nestjs/common';
import { withOrg } from '@poolse/db';
import { isExclusionViolation } from './sessions.repository.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireRole } from '../tenant/roles.js';
import {
  addSchedule,
  AlreadyEnrolledError,
  archiveClassGroup,
  createClassGroup,
  DuplicateNameError,
  endEnrollment,
  enrol,
  findClassGroup,
  FullError,
  listClassGroups,
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
  groups: ClassGroup[];
  canManage: boolean;
  /** What the create and edit forms may choose from, in one payload. */
  options: {
    levels: Choice[];
    pools: Choice[];
    instructors: Choice[];
    students: Choice[];
  };
}

const MAX_NAME = 120;

/**
 * Slice 1.4 with 1.7 folded in — turmas, their weekly pattern, and who is in
 * them.
 *
 * Reading is open to any member: an instructor needs to know which turma is in
 * their lane on Tuesday. Writing is owner and admin, the line every other slice
 * draws. Slice 1.12 revisits that properly — an instructor managing their own
 * turmas is exactly the case it exists for.
 */
@Controller('class-groups')
export class ClassesController {
  @Get()
  async list(): Promise<ClassesResponse> {
    const { organizationId } = currentTenant();

    const [groups, options] = await Promise.all([
      listClassGroups(organizationId),
      formOptions(organizationId),
    ]);

    return { organizationId, groups, canManage: hasRole('owner', 'admin'), options };
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
      return { id: await createClassGroup(organizationId, parseGroup(body)) };
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
    requireRole('owner', 'admin');
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
    return { added: true };
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
    const levels = await tx.query<Choice>(
      `SELECT id, name FROM student_level WHERE archived_at IS NULL ORDER BY sort_order, name`,
    );
    const pools = await tx.query<Choice>(
      `SELECT id, name FROM pool WHERE archived_at IS NULL ORDER BY name`,
    );
    // Anyone who can teach. An owner who also takes a turma appears here, which
    // is the case membership_role exists for.
    const instructors = await tx.query<Choice>(
      `SELECT m.id,
              coalesce(nullif(btrim(coalesce(u.cached_first_name, '') || ' ' ||
                                    coalesce(u.cached_last_name, '')), ''),
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
    const students = await tx.query<Choice>(
      `SELECT id, last_name || ', ' || first_name AS name
         FROM student WHERE archived_at IS NULL ORDER BY last_name, first_name`,
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
  return error;
}

function parseGroup(body: Record<string, unknown>): ClassGroupInput {
  const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
  if (name.length === 0) throw new BadRequestException('name is required');
  if (name.length > MAX_NAME) {
    throw new BadRequestException(`name may be at most ${MAX_NAME} characters`);
  }

  return {
    name,
    levelId: optionalId(body['levelId']),
    poolId: optionalId(body['poolId']),
    instructorMembershipId: optionalId(body['instructorMembershipId']),
    capacity: optionalCount(body['capacity'], 'capacity', 200),
    lane: optionalCount(body['lane'], 'lane', 50),
  };
}

function optionalId(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length === 0 ? null : trimmed;
}

/** Empty means "not decided" — for capacity, that means no limit. */
function optionalCount(value: unknown, field: string, max: number): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new BadRequestException(`${field} must be a whole number between 1 and ${max}`);
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
