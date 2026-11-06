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
import { parseSwimTime } from '@poolse/rules';
import { clubToday } from '../common/club-day.js';
import { CoreRoute, moduleIsOn } from '../tenant/modules.js';
import { requireRole } from '../tenant/roles.js';
import { requireCompetition } from '../tenant/sport-scope.js';
import { currentTenant } from '../tenant/tenant.context.js';
import {
  addMeasure,
  archiveMeasure,
  archiveOwnTime,
  listMeasures,
  mayEnterProgress,
  MEASURE_UNITS,
  type MeasureKind,
  type StudentMeasure,
} from './family-progress.repository.js';
import { addRecord, COURSES, STROKES, type Course, type Stroke } from './records.repository.js';
import { familyStudents } from './students.repository.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A day that is real and not in the future. */
function pastDay(value: unknown): string {
  if (typeof value !== 'string' || !DAY.test(value) || Number.isNaN(Date.parse(value)) || value > clubToday()) {
    throw new BadRequestException({ code: 'date', message: 'A date, not in the future' });
  }
  return value;
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

/** *Progressos* in the app — the family's half. The server decides every write. */
@CoreRoute()
@Controller('app/progress/:studentId')
export class FamilyProgressController {
  @Get()
  async read(
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ): Promise<{ measures: StudentMeasure[]; canEnter: boolean; canEnterTimes: boolean }> {
    const { organizationId, membershipId } = await requireMine(studentId);
    const canEnter = await mayEnterProgress(organizationId, studentId, membershipId);
    return {
      measures: await listMeasures(organizationId, studentId, membershipId),
      canEnter,
      canEnterTimes: canEnter && moduleIsOn('competition'),
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
    const rawCourse = typeof body['course'] === 'string' ? body['course'] : '';
    if (rawCourse !== '' && !COURSES.includes(rawCourse as Course)) {
      throw new BadRequestException({ code: 'course', message: 'No such pool length' });
    }
    const timeMs = typeof body['time'] === 'string' ? parseSwimTime(body['time']) : null;
    if (typeof timeMs !== 'number' || timeMs <= 0) {
      throw new BadRequestException({ code: 'time', message: 'A swim time' });
    }
    const id = await addRecord(organizationId, studentId, {
      stroke: stroke as Stroke,
      distanceM,
      course: rawCourse === '' ? null : (rawCourse as Course),
      timeMs,
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

  @Post('measures')
  async addMeasure(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    const { organizationId, membershipId } = await requireMayEnter(studentId);
    const kind = body['kind'];
    if (typeof kind !== 'string' || !(kind in MEASURE_UNITS)) {
      throw new BadRequestException({ code: 'kind', message: 'No such measure' });
    }
    const value = Number(String(body['value'] ?? '').replace(',', '.'));
    const ceiling = kind === 'weight' ? 400 : kind === 'height' ? 260 : 1_000_000;
    if (!Number.isFinite(value) || value <= 0 || value > ceiling) {
      throw new BadRequestException({ code: 'value', message: 'A value in range' });
    }
    const id = await addMeasure(organizationId, studentId, membershipId, {
      kind: kind as MeasureKind,
      value,
      measuredOn: pastDay(body['measuredOn']),
    });
    return { id };
  }

  @Post('measures/:measureId/archive')
  async archiveMeasure(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Param('measureId', ParseUUIDPipe) measureId: string,
  ): Promise<{ archived: true }> {
    const { organizationId, membershipId } = await requireMayEnter(studentId);
    if (!(await archiveMeasure(organizationId, studentId, measureId, membershipId))) {
      throw new NotFoundException('No such measure of yours');
    }
    return { archived: true };
  }
}

/** The office's half: weight and height are the office's to read, never an instructor's. */
@CoreRoute()
@Controller('students/:studentId/measures')
export class StudentMeasuresController {
  @Get()
  async list(@Param('studentId', ParseUUIDPipe) studentId: string): Promise<{ measures: StudentMeasure[] }> {
    requireRole('owner', 'admin');
    const { organizationId, membershipId } = currentTenant();
    return { measures: await listMeasures(organizationId, studentId, membershipId) };
  }

  @Post(':measureId/archive')
  async archive(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Param('measureId', ParseUUIDPipe) measureId: string,
  ): Promise<{ archived: true }> {
    requireRole('owner', 'admin');
    if (!(await archiveMeasure(currentTenant().organizationId, studentId, measureId, null))) {
      throw new NotFoundException('No such measure');
    }
    return { archived: true };
  }
}
