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
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireCanArchive, requireRole } from '../tenant/roles.js';
import {
  archiveSkill,
  createSkill,
  listSkills,
  markSkills,
  reorderSkills,
  SKILL_STATES,
  turmaSkills,
  type MarkInput,
  type MarkOutcome,
  type Skill,
  type SkillState,
  type TurmaSkills,
} from './skills.repository.js';

const MAX_NAME = 120;
const MAX_REASON = 300;

/**
 * How many cells one request may carry.
 *
 * A turma of thirty with twenty skills is six hundred, which is the "mark the
 * whole grid" gesture and has to fit. Beyond that it is not a gesture.
 */
const MAX_MARKS = 1000;

function isState(value: unknown): value is SkillState {
  return typeof value === 'string' && SKILL_STATES.includes(value as SkillState);
}

/**
 * Skills — POOLSE-20.
 *
 * Reading is open to any member: an instructor needs the grid, and a student's
 * own progress is the thing the mobile app will show them. Defining what a level
 * consists of is owner and admin, because it is a decision about the programme
 * rather than about a child.
 */
@Controller('skills')
export class SkillsController {
  /** The grid for one turma: students down, skills across. */
  @Get('turma/:classGroupId')
  async grid(@Param('classGroupId') classGroupId: string): Promise<TurmaSkills> {
    const { organizationId } = currentTenant();

    const grid = await turmaSkills(organizationId, classGroupId);
    // Also the answer when the turma belongs to another tenant: RLS hid it, and
    // the caller learns nothing either way.
    if (grid === null) throw new NotFoundException('No such turma');

    return grid;
  }

  @Get()
  async list(
    @Query('levelId') levelId?: string,
  ): Promise<{ organizationId: string; skills: Skill[]; canManage: boolean }> {
    const { organizationId } = currentTenant();
    if (levelId === undefined || levelId.trim() === '') {
      throw new BadRequestException('levelId is required');
    }

    return {
      organizationId,
      skills: await listSkills(organizationId, levelId.trim()),
      canManage: hasRole('owner', 'admin'),
    };
  }

  /**
   * Marks cells — one, a column, a row, or the whole grid.
   *
   * A list rather than a single cell, because that is what the gestures produce:
   * tapping a column header marks a skill across the turma in one pass. One
   * request per gesture keeps it one transaction, so a dropped connection cannot
   * leave half a column marked.
   */
  @Post('mark')
  async mark(@Body() body: Record<string, unknown>): Promise<MarkOutcome> {
    const { organizationId, membershipId } = currentTenant();

    const raw = body['marks'];
    if (!Array.isArray(raw)) throw new BadRequestException('marks must be an array');
    if (raw.length === 0) throw new BadRequestException('marks is empty');
    if (raw.length > MAX_MARKS) {
      throw new BadRequestException(`at most ${MAX_MARKS} marks in one request`);
    }

    const marks: MarkInput[] = raw.map((entry, index) => {
      const cell = entry as Record<string, unknown>;

      const studentId = typeof cell['studentId'] === 'string' ? cell['studentId'].trim() : '';
      const skillId = typeof cell['skillId'] === 'string' ? cell['skillId'].trim() : '';
      if (studentId === '' || skillId === '') {
        throw new BadRequestException(`marks[${index}] needs a studentId and a skillId`);
      }

      if (!isState(cell['state'])) {
        throw new BadRequestException(
          `marks[${index}].state must be one of ${SKILL_STATES.join(', ')}`,
        );
      }

      const reason =
        typeof cell['overrideReason'] === 'string' ? cell['overrideReason'].trim() : '';
      if (reason.length > MAX_REASON) {
        throw new BadRequestException(`overrideReason may be at most ${MAX_REASON} characters`);
      }

      return {
        studentId,
        skillId,
        state: cell['state'],
        overrideReason: reason === '' ? null : reason,
      };
    });

    return markSkills(organizationId, membershipId, marks);
  }

  @Post()
  async create(@Body() body: Record<string, unknown>): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const levelId = typeof body['levelId'] === 'string' ? body['levelId'].trim() : '';
    if (levelId === '') throw new BadRequestException('levelId is required');

    const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
    if (name === '') throw new BadRequestException('name is required');
    if (name.length > MAX_NAME) {
      throw new BadRequestException(`name may be at most ${MAX_NAME} characters`);
    }

    const id = await createSkill(organizationId, {
      levelId,
      name,
      minDays: threshold(body['minDays'], 'minDays', 3650),
      minLessons: threshold(body['minLessons'], 'minLessons', 500),
      videoUrl: url(body['videoUrl']),
    });

    if (id === null) throw new NotFoundException('No such level');
    return { id };
  }

  /** Reordering the skills of one level — POOLSE-40 AC7. */
  @Post('reorder')
  async reorder(@Body() body: Record<string, unknown>): Promise<{ reordered: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const levelId = typeof body['levelId'] === 'string' ? body['levelId'].trim() : '';
    if (levelId === '') throw new BadRequestException('levelId is required');

    const raw = body['ids'];
    if (!Array.isArray(raw) || raw.some((id) => typeof id !== 'string')) {
      throw new BadRequestException('ids must be an array of skill ids');
    }

    if (!(await reorderSkills(organizationId, levelId, raw as string[]))) {
      throw new NotFoundException('No such level, or none of those skills');
    }
    return { reordered: true };
  }

  @Post(':id/archive')
  async remove(@Param('id') id: string): Promise<{ archived: true }> {
    requireCanArchive();
    const { organizationId } = currentTenant();

    if (!(await archiveSkill(organizationId, id))) {
      throw new NotFoundException('No such skill');
    }
    return { archived: true };
  }
}

/**
 * A threshold, or none.
 *
 * Absent, empty and null all mean "no threshold", because a club that does not
 * work this way should not have to enter a zero to say so.
 */
function threshold(value: unknown, field: string, max: number): number | null {
  if (value === undefined || value === null || value === '') return null;

  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    throw new BadRequestException(`${field} must be a whole number between 0 and ${max}`);
  }
  return parsed;
}

/** Loose: a link that works beats a link that passed a regex. */
function url(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;

  const trimmed = value.trim();
  if (!/^https?:\/\/\S+$/.test(trimmed)) {
    throw new BadRequestException('videoUrl must be an http or https link');
  }
  return trimmed;
}
