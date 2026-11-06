import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { clubToday } from '../common/club-day.js';
import { CoreRoute, moduleIsOn } from '../tenant/modules.js';
import { requireRole } from '../tenant/roles.js';
import { requireCompetition } from '../tenant/sport-scope.js';
import { currentTenant } from '../tenant/tenant.context.js';
import {
  archiveOwnTime,
  courseOfLength,
  listProgressPools,
  mayEnterProgress,
  type ProgressPool,
} from './family-progress.repository.js';
import { addRecord, STROKES, type Stroke } from './records.repository.js';
import { familyStudents } from './students.repository.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A day that is real and not in the future. */
function pastDay(value: unknown): string {
  if (typeof value !== 'string' || !DAY.test(value) || Number.isNaN(Date.parse(value)) || value > clubToday()) {
    throw new BadRequestException({ code: 'date', message: 'A date, not in the future' });
  }
  return value;
}

/** Hours, minutes, seconds and hundredths, each typed in its own box. An empty box is 0. */
function timeOf(body: Record<string, unknown>): number {
  const part = (name: string, max: number): number => {
    const raw = String(body[name] ?? '').trim();
    const value = raw === '' ? 0 : Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > max) {
      throw new BadRequestException({ code: 'time', message: `${name} is a whole number up to ${max}` });
    }
    return value;
  };
  const ms = part('hours', 23) * 3_600_000 + part('minutes', 59) * 60_000 + part('seconds', 59) * 1000 + part('hundredths', 99) * 10;
  if (ms <= 100) throw new BadRequestException({ code: 'time', message: 'A swim time' });
  return ms;
}

/** Another family's child is a 404, before anything about it is read. */
async function requireMine(studentId: string): Promise<{ organizationId: string; membershipId: string }> {
  requireRole('guardian', 'student');
  const { organizationId, membershipId } = currentTenant();
  const mine = await familyStudents(organizationId, membershipId);
  if (!mine.some((one) => one.id === studentId)) throw new NotFoundException('No such student');
  return { organizationId, membershipId };
}

/** On top of `requireMine`: the login that answers for this child (`family_may_answer()`). */
async function requireMayEnter(studentId: string): Promise<{ organizationId: string; membershipId: string }> {
  const who = await requireMine(studentId);
  if (!(await mayEnterProgress(who.organizationId, studentId, who.membershipId))) {
    throw new ForbiddenException({ code: 'guardian_answers', message: 'A guardian records this' });
  }
  return who;
}

/** *Progressos* in the app. The server decides every write. */
@CoreRoute()
@Controller('app/progress/:studentId')
export class FamilyProgressController {
  @Get()
  async read(
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ): Promise<{ canEnterTimes: boolean; pools: ProgressPool[] }> {
    const { organizationId, membershipId } = await requireMine(studentId);
    const canEnter = await mayEnterProgress(organizationId, studentId, membershipId);
    return {
      canEnterTimes: canEnter && moduleIsOn('competition'),
      pools: await listProgressPools(organizationId),
    };
  }

  /** A time the family typed: marked, never official, and it names no meet. */
  @Post('times')
  async addTime(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    const { organizationId } = await requireMayEnter(studentId);
    requireCompetition();
    const stroke = body['stroke'];
    if (typeof stroke !== 'string' || !STROKES.includes(stroke as Stroke)) {
      throw new BadRequestException({ code: 'stroke', message: 'No such stroke' });
    }
    const distanceM = Number(body['distanceM']);
    if (!Number.isInteger(distanceM) || distanceM <= 0 || distanceM > 10_000) {
      throw new BadRequestException({ code: 'distance', message: 'Whole metres, up to 10000' });
    }
    // The pool is read from this club's own list, so a course cannot be claimed.
    const poolId = typeof body['poolId'] === 'string' ? body['poolId'] : '';
    const pool = poolId === '' ? null : (await listProgressPools(organizationId)).find((one) => one.id === poolId);
    if (pool === undefined) throw new BadRequestException({ code: 'pool', message: 'No such pool' });

    const id = await addRecord(organizationId, studentId, {
      stroke: stroke as Stroke,
      distanceM,
      course: courseOfLength(pool?.lengthM ?? null),
      timeMs: timeOf(body),
      swumOn: pastDay(body['swumOn']),
      note: null,
      meet: null,
      selfReported: true,
    });
    if (id === null) throw new NotFoundException('No such student');
    return { id };
  }

  @Post('times/:recordId/archive')
  async archiveTime(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Param('recordId', ParseUUIDPipe) recordId: string,
  ): Promise<{ archived: true }> {
    const { organizationId, membershipId } = await requireMayEnter(studentId);
    if (!(await archiveOwnTime(organizationId, studentId, recordId, membershipId))) {
      throw new NotFoundException('No such time of yours');
    }
    return { archived: true };
  }
}
