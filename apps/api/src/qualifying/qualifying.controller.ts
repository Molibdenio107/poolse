import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import { parseSwimTime } from '@poolse/rules';
import { currentTenant } from '../tenant/tenant.context.js';
import { canArchive, requireCanArchive, requireRole } from '../tenant/roles.js';
import { COURSES, STROKES, type Course, type Stroke } from '../students/records.repository.js';
import {
  archiveAgeGroup,
  archiveStandard,
  board,
  createAgeGroup,
  createStandard,
  findStandard,
  NameTakenError,
  NoSuchSeasonError,
  overview,
  setEntryTimes,
  updateAgeGroup,
  updateStandard,
  type AgeGroupInput,
  type Board,
  type QualifyingOverview,
  type StandardDetail,
  type StandardInput,
} from './qualifying.repository.js';

/**
 * Mínimos — POOLSE-85.
 *
 * Owner, admin and instructor, the people who record a time (POOLSE-81). A
 * family reads its own child's gap on Progressão, through the progression read,
 * and nothing here. Archiving is owner and admin, as every remove is.
 */

const TEACHING = ['owner', 'admin', 'instructor'] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TIMES = 200;
const DEFAULT_MARGIN_MS = 2000;

interface Flags {
  organizationId: string;
  canEdit: true;
  canArchive: boolean;
}

@Controller('qualifying')
export class QualifyingController {
  @Get()
  async read(@Query('season') season?: string): Promise<QualifyingOverview & Flags> {
    requireRole(...TEACHING);
    const { organizationId } = currentTenant();
    const seasonId = season !== undefined && /^[0-9a-f-]{36}$/i.test(season) ? season : null;
    return { ...(await overview(organizationId, seasonId)), ...flags(organizationId) };
  }

  @Post('age-groups')
  async addAgeGroup(@Body() body: Record<string, unknown>): Promise<{ id: string }> {
    requireRole(...TEACHING);
    const { organizationId } = currentTenant();
    const seasonId = uuid(body['seasonId'], 'seasonId');
    try {
      return { id: await createAgeGroup(organizationId, seasonId, parseAgeGroup(body)) };
    } catch (error) {
      throw refusal(error, 'qualifying.ageGroupTaken');
    }
  }

  @Put('age-groups/:id')
  async editAgeGroup(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ saved: true }> {
    requireRole(...TEACHING);
    const { organizationId } = currentTenant();
    let found: boolean;
    try {
      found = await updateAgeGroup(organizationId, id, parseAgeGroup(body));
    } catch (error) {
      throw refusal(error, 'qualifying.ageGroupTaken');
    }
    if (!found) throw new NotFoundException('No such age group');
    return { saved: true };
  }

  @Post('age-groups/:id/archive')
  async removeAgeGroup(@Param('id', new ParseUUIDPipe()) id: string): Promise<{ archived: true }> {
    requireCanArchive();
    const { organizationId } = currentTenant();
    if (!(await archiveAgeGroup(organizationId, id))) throw new NotFoundException('No such age group');
    return { archived: true };
  }

  @Post('standards')
  async addStandard(@Body() body: Record<string, unknown>): Promise<{ id: string }> {
    requireRole(...TEACHING);
    const { organizationId } = currentTenant();
    const seasonId = uuid(body['seasonId'], 'seasonId');
    try {
      return { id: await createStandard(organizationId, seasonId, parseStandard(body)) };
    } catch (error) {
      throw refusal(error, 'qualifying.standardTaken');
    }
  }

  @Get('standards/:id')
  async standard(@Param('id', new ParseUUIDPipe()) id: string): Promise<StandardDetail & Flags> {
    requireRole(...TEACHING);
    const { organizationId } = currentTenant();
    const found = await findStandard(organizationId, id);
    if (found === null) throw new NotFoundException('No such standard');
    return { ...found, ...flags(organizationId) };
  }

  @Put('standards/:id')
  async editStandard(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ saved: true }> {
    requireRole(...TEACHING);
    const { organizationId } = currentTenant();
    let found: boolean;
    try {
      found = await updateStandard(organizationId, id, parseStandard(body));
    } catch (error) {
      throw refusal(error, 'qualifying.standardTaken');
    }
    if (!found) throw new NotFoundException('No such standard');
    return { saved: true };
  }

  @Post('standards/:id/archive')
  async removeStandard(@Param('id', new ParseUUIDPipe()) id: string): Promise<{ archived: true }> {
    requireCanArchive();
    const { organizationId } = currentTenant();
    if (!(await archiveStandard(organizationId, id))) throw new NotFoundException('No such standard');
    return { archived: true };
  }

  /**
   * One age group's column of entry times, whole. Each cell is the text the
   * coach typed, read by `parseSwimTime` — the same function the grid uses, so
   * a figure the form accepts is a figure this accepts. An empty cell clears it.
   * Any unreadable cell refuses the lot and names every one.
   */
  @Put('standards/:id/times/:ageGroupId')
  async setTimes(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('ageGroupId', new ParseUUIDPipe()) ageGroupId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ added: number; changed: number; cleared: number }> {
    requireRole(...TEACHING);
    const { organizationId } = currentTenant();
    const raw = Array.isArray(body['times']) ? body['times'] : [];
    if (raw.length > MAX_TIMES) throw new BadRequestException('Too many times');

    const times: { stroke: Stroke; distanceM: number; course: Course; timeMs: number }[] = [];
    const fields: Record<string, string> = {};
    for (const entry of raw) {
      const cell = (entry ?? {}) as Record<string, unknown>;
      const stroke = cell['stroke'];
      const course = cell['course'];
      const distanceM = Number(cell['distanceM']);
      if (
        !STROKES.includes(stroke as Stroke) ||
        !COURSES.includes(course as Course) ||
        !Number.isInteger(distanceM) ||
        distanceM <= 0 ||
        distanceM > 10000
      ) {
        throw new BadRequestException('Each time needs a stroke, a distance and a course');
      }
      const parsed = parseSwimTime(typeof cell['time'] === 'string' ? cell['time'] : '');
      if (parsed === '') continue;
      if (parsed === null) {
        fields[`${stroke as string}-${distanceM}-${course as string}`] = 'qualifying.badTime';
        continue;
      }
      times.push({ stroke: stroke as Stroke, distanceM, course: course as Course, timeMs: parsed });
    }
    if (Object.keys(fields).length > 0) {
      throw new UnprocessableEntityException({
        code: 'bad_times',
        message: 'Some times could not be read',
        fields,
      });
    }

    const result = await setEntryTimes(organizationId, id, ageGroupId, times);
    if (result === null) throw new NotFoundException('No such standard or age group');
    return result;
  }

  @Get('standards/:id/board')
  async board(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('margin') margin?: string,
  ): Promise<Board & { organizationId: string }> {
    requireRole(...TEACHING);
    const { organizationId } = currentTenant();
    const parsed = Number(margin);
    const marginMs =
      Number.isInteger(parsed) && parsed >= 0 && parsed <= 60_000 ? parsed : DEFAULT_MARGIN_MS;
    const found = await board(organizationId, id, marginMs);
    if (found === null) throw new NotFoundException('No such standard');
    return { ...found, organizationId };
  }
}

function flags(organizationId: string): Flags {
  return { organizationId, canEdit: true, canArchive: canArchive() };
}

function refusal(error: unknown, fieldKey: string): unknown {
  if (error instanceof NameTakenError) {
    return new ConflictException({ code: 'name_taken', message: 'That name is taken', fields: { name: fieldKey } });
  }
  if (error instanceof NoSuchSeasonError) return new NotFoundException('No such season');
  return error;
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new BadRequestException(`${field} is required`);
  }
  return value;
}

function name(value: unknown, max: number, key: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '' || text.length > max) {
    throw new UnprocessableEntityException({ code: 'name_required', message: 'A name is required', fields: { name: key } });
  }
  return text;
}

function year(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1900 || parsed > 2200) {
    throw new UnprocessableEntityException({
      code: 'bad_year',
      message: `${field} is not a year`,
      fields: { [field]: 'qualifying.badYear' },
    });
  }
  return parsed;
}

function parseAgeGroup(body: Record<string, unknown>): AgeGroupInput {
  const gender = body['gender'] === 'male' || body['gender'] === 'female' ? body['gender'] : null;
  const bornFrom = year(body['bornFrom'], 'bornFrom');
  const bornTo = year(body['bornTo'], 'bornTo');
  if (bornFrom !== null && bornTo !== null && bornFrom > bornTo) {
    throw new UnprocessableEntityException({
      code: 'years_reversed',
      message: 'The first year is after the last',
      fields: { bornTo: 'qualifying.yearsReversed' },
    });
  }
  return { name: name(body['name'], 80, 'qualifying.nameRequired'), gender, bornFrom, bornTo };
}

function optionalDay(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !DAY.test(value)) throw new BadRequestException(`${field} must be a date`);
  return value;
}

function parseStandard(body: Record<string, unknown>): StandardInput {
  const windowFrom = optionalDay(body['windowFrom'], 'windowFrom');
  const windowTo = optionalDay(body['windowTo'], 'windowTo');
  if (windowFrom !== null && windowTo !== null && windowFrom > windowTo) {
    throw new UnprocessableEntityException({
      code: 'window_reversed',
      message: 'The window ends before it starts',
      fields: { windowTo: 'qualifying.windowReversed' },
    });
  }
  return { name: name(body['name'], 200, 'qualifying.nameRequired'), windowFrom, windowTo };
}
