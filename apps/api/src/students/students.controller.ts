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
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireRole } from '../tenant/roles.js';

interface StudentDetail extends Student {
  /**
   * Whether this caller may open the medical record.
   *
   * Kept in step with `SensitiveController.read`, which is where the rule
   * actually lives. Two places knowing one rule is a cost paid knowingly: the
   * alternative is a screen that renders a button leading to a 403.
   */
  canViewSensitive: boolean;
  canViewProgress: boolean;
}
import {
  archiveLevel,
  archiveStudent,
  createLevel,
  createStudent,
  DuplicateNameError,
  findStudent,
  listLevels,
  listStudents,
  moveLevel,
  renameLevel,
  updateStudent,
  type Student,
  type StudentInput,
  type StudentLevel,
} from './students.repository.js';

const MAX_NAME = 120;
const MAX_NOTES = 2000;

interface StudentsResponse {
  organizationId: string;
  students: Student[];
  levels: StudentLevel[];
  canManage: boolean;
}

/**
 * Slice 1.2 — the student register.
 *
 * Reading is open to any member, because an instructor needs to know who is in
 * their lane. Writing is owner and admin, the same line facilities and
 * invitations draw. Slice 1.12 revisits the whole role surface; until then the
 * rule is uniform and easy to reason about rather than clever.
 *
 * Nothing here touches medical information or consent. Those live in separate
 * tables with their own access rules (slice 1.3) precisely so that this
 * controller — the ordinary, widely-readable one — cannot reach them.
 */
@Controller('students')
export class StudentsController {
  @Get()
  async list(
    @Query('search') search?: string,
    @Query('levelId') levelId?: string,
  ): Promise<StudentsResponse> {
    const { organizationId } = currentTenant();

    const [students, levels] = await Promise.all([
      listStudents(organizationId, {
        search: search?.trim() ? search.trim() : null,
        levelId: levelId?.trim() ? levelId.trim() : null,
      }),
      listLevels(organizationId),
    ]);

    return { organizationId, students, levels, canManage: hasRole('owner', 'admin') };
  }

  @Get(':id')
  async one(@Param('id') id: string): Promise<StudentDetail> {
    const { organizationId } = currentTenant();
    const student = await findStudent(organizationId, id);
    // Also the answer when the id belongs to another tenant: RLS makes the two
    // indistinguishable from here, which is the point.
    if (!student) throw new NotFoundException('No such student');

    // So the record can hide a control its owner may not use. Not access
    // control — SensitiveController and RecordsController each enforce their own
    // and would refuse the request anyway. This only stops the screen offering a
    // door that opens onto a refusal.
    return {
      ...student,
      canViewSensitive: hasRole('owner', 'admin', 'instructor'),
      canViewProgress: hasRole('owner', 'admin', 'instructor'),
    };
  }

  @Post()
  async create(@Body() body: Record<string, unknown>): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const id = await createStudent(organizationId, parseStudent(body));
    if (id === null) throw new BadRequestException('No such level');
    return { id };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ updated: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const outcome = await updateStudent(organizationId, id, parseStudent(body));
    if (outcome === 'bad_level') throw new BadRequestException('No such level');
    if (outcome === 'not_found') throw new NotFoundException('No such student');
    return { updated: true };
  }

  @Post(':id/archive')
  async archive(@Param('id') id: string): Promise<{ archived: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    if (!(await archiveStudent(organizationId, id))) {
      throw new NotFoundException('No such student');
    }
    return { archived: true };
  }
}

/**
 * Levels get their own controller rather than living under `/students`.
 *
 * `/students/levels` would sit in the same space as `/students/:id`, and which
 * one wins depends on declaration order — a footgun that only fires the day
 * somebody reorders the methods.
 */
@Controller('levels')
export class LevelsController {
  @Post()
  async create(@Body() body: Record<string, unknown>): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const name = requiredText(body['name'], 'name');
    try {
      return { id: await createLevel(organizationId, name) };
    } catch (error) {
      throw asHttp(error);
    }
  }

  @Patch(':id')
  async rename(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ renamed: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const name = requiredText(body['name'], 'name');
    let renamed: boolean;
    try {
      renamed = await renameLevel(organizationId, id, name);
    } catch (error) {
      throw asHttp(error);
    }
    if (!renamed) throw new NotFoundException('No such level');
    return { renamed: true };
  }

  @Post(':id/move')
  async move(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ moved: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const direction = body['direction'];
    if (direction !== 'up' && direction !== 'down') {
      throw new BadRequestException('direction must be "up" or "down"');
    }

    if (!(await moveLevel(organizationId, id, direction))) {
      throw new NotFoundException('No such level');
    }
    return { moved: true };
  }

  @Post(':id/archive')
  async archive(@Param('id') id: string): Promise<{ archived: true; unlevelled: number }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const result = await archiveLevel(organizationId, id);
    if (!result.archived) throw new NotFoundException('No such level');
    return { archived: true, unlevelled: result.unlevelled };
  }
}

function asHttp(error: unknown): unknown {
  if (error instanceof DuplicateNameError) {
    return new ConflictException(`"${error.message}" already exists`);
  }
  return error;
}

function parseStudent(body: Record<string, unknown>): StudentInput {
  return {
    firstName: requiredText(body['firstName'], 'firstName'),
    lastName: requiredText(body['lastName'], 'lastName'),
    birthDate: parseBirthDate(body['birthDate']),
    levelId: optionalText(body['levelId'], 'levelId', 64),
    contactEmail: optionalText(body['contactEmail'], 'contactEmail', 254),
    contactPhone: optionalText(body['contactPhone'], 'contactPhone', 40),
    notes: optionalText(body['notes'], 'notes', MAX_NOTES),
  };
}

function requiredText(value: unknown, field: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length === 0) throw new BadRequestException(`${field} is required`);
  if (trimmed.length > MAX_NAME) {
    throw new BadRequestException(`${field} may be at most ${MAX_NAME} characters`);
  }
  return trimmed;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) {
    throw new BadRequestException(`${field} may be at most ${max} characters`);
  }
  return trimmed;
}

/**
 * A plain calendar date, and refused if it is in the future.
 *
 * The lower bound is a CHECK on the table; the upper bound cannot be, because
 * `current_date` is not IMMUTABLE and Postgres will not have it in a constraint.
 * So it is enforced here — and a student born tomorrow is a typo every time.
 */
function parseBirthDate(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (raw.length === 0) return null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new BadRequestException('birthDate must be a date, as YYYY-MM-DD');
  }

  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException('birthDate is not a real date');
  }
  if (parsed.getTime() > Date.now()) {
    throw new BadRequestException('birthDate cannot be in the future');
  }
  return raw;
}
