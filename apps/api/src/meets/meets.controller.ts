import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { canArchive, requireCanArchive, requireRole } from '../tenant/roles.js';
import { readPageQuery, type Paginated } from '../common/pagination.js';
import {
  archiveMeet,
  findMeet,
  importMeet,
  listMeets,
  rememberedClubCode,
  type ImportInput,
  type ImportPreview,
  type MeetDetail,
  type MeetSummary,
} from './meets.repository.js';
import type { Course, IncomingAthlete, IncomingResult, Stroke } from './meet-import.js';
import { PoolseModule } from '../tenant/modules.js';

/**
 * Provas — POOLSE-81, slice 2.
 *
 * Owner, admin and instructor — the people who may type a time (Rui,
 * 19-10-2026: every instructor imports). A family reads its own child's results
 * through the Progress tab and nothing here. Archiving is owner and admin, as
 * every remove is.
 */

const TEACHING = ['owner', 'admin', 'instructor'] as const;
const MAX_ATHLETES = 3000;
const MAX_RESULTS = 60;
const STROKES: readonly Stroke[] = ['freestyle', 'backstroke', 'breaststroke', 'butterfly', 'medley'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

interface MeetsResponse extends Paginated<MeetSummary> {
  organizationId: string;
  canImport: boolean;
  canArchive: boolean;
  rememberedClubCode: string | null;
}

@PoolseModule('competition')
@Controller('meets')
export class MeetsController {
  @Get()
  async list(@Query('page') page?: string, @Query('limit') limit?: string): Promise<MeetsResponse> {
    requireRole(...TEACHING);
    const { organizationId } = currentTenant();
    const meets = await listMeets(organizationId, readPageQuery(page, limit));
    return {
      ...meets,
      organizationId,
      canImport: true,
      canArchive: canArchive(),
      rememberedClubCode: await rememberedClubCode(organizationId),
    };
  }

  @Get(':id')
  async one(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<MeetDetail & { canArchive: boolean; organizationId: string }> {
    requireRole(...TEACHING);
    const { organizationId } = currentTenant();
    const meet = await findMeet(organizationId, id);
    if (meet === null) throw new NotFoundException('No such meet');
    return { ...meet, organizationId, canArchive: canArchive() };
  }

  /**
   * Preview and commit, one path — `commit: true` writes what the preview
   * showed, in one transaction. The body is the web's reading of the file: the
   * file itself never reaches the API.
   */
  @Post('import')
  async import(@Body() body: Record<string, unknown>): Promise<ImportPreview> {
    requireRole(...TEACHING);
    const { organizationId, membershipId } = currentTenant();
    if (!membershipId) throw new BadRequestException('No membership');
    return importMeet(organizationId, membershipId, parseImport(body), body['commit'] === true);
  }

  @Post(':id/archive')
  async archive(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ archived: true; archiveEntryId: string }> {
    requireCanArchive();
    const { organizationId } = currentTenant();
    const archived = await archiveMeet(organizationId, id);
    if (archived === null) throw new NotFoundException('No such meet');
    return { archived: true, archiveEntryId: archived.archiveEntryId };
  }
}

function text(value: unknown, field: string, max: number, required = true): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (raw === '' && required) throw new BadRequestException(`${field} is required`);
  if (raw.length > max) throw new BadRequestException(`${field} is too long`);
  return raw;
}

function day(value: unknown, field: string): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!DAY.test(raw)) throw new BadRequestException(`${field} must be a date`);
  return raw;
}

function course(value: unknown): Course | null {
  return value === 'scm' || value === 'lcm' ? value : null;
}

function int(value: unknown, field: string, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new BadRequestException(`${field} is out of range`);
  }
  return parsed;
}

function parseResult(raw: unknown): IncomingResult {
  const value = (raw ?? {}) as Record<string, unknown>;
  const stroke = STROKES.includes(value['stroke'] as Stroke) ? (value['stroke'] as Stroke) : null;
  const timeMs = value['timeMs'] === null || value['timeMs'] === undefined
    ? null
    : int(value['timeMs'], 'timeMs', 1, 86_400_000 - 1);
  return {
    eventNumber: int(value['eventNumber'] ?? 0, 'eventNumber', 0, 100000),
    round: text(value['round'] ?? 'TIM', 'round', 20, false) || 'TIM',
    stroke,
    distanceM: int(value['distanceM'] ?? 0, 'distanceM', 0, 100000),
    relayCount: int(value['relayCount'] ?? 1, 'relayCount', 1, 20),
    course: course(value['course']),
    rawCourse: text(value['rawCourse'] ?? '', 'rawCourse', 10, false).toUpperCase(),
    swumOn: typeof value['swumOn'] === 'string' && DAY.test(value['swumOn']) ? value['swumOn'] : null,
    timeMs,
    status: text(value['status'] ?? '', 'status', 10, false).toUpperCase(),
  };
}

function parseAthlete(raw: unknown): IncomingAthlete {
  const value = (raw ?? {}) as Record<string, unknown>;
  const results = Array.isArray(value['results']) ? value['results'] : [];
  if (results.length > MAX_RESULTS) throw new BadRequestException('Too many results for one athlete');
  return {
    key: text(value['key'], 'key', 120),
    clubCode: text(value['clubCode'] ?? '', 'clubCode', 60, false),
    firstName: text(value['firstName'] ?? '', 'firstName', 100, false),
    lastName: text(value['lastName'] ?? '', 'lastName', 100, false),
    birthDate:
      typeof value['birthDate'] === 'string' && DAY.test(value['birthDate']) ? value['birthDate'] : null,
    licence: text(value['licence'] ?? '', 'licence', 40, false) || null,
    results: results.map(parseResult),
  };
}

function parseImport(body: Record<string, unknown>): ImportInput {
  const meet = (body['meet'] ?? {}) as Record<string, unknown>;
  const athletes = Array.isArray(body['athletes']) ? body['athletes'] : [];
  if (athletes.length > MAX_ATHLETES) throw new BadRequestException('Too many athletes');
  const startsOn = day(meet['startsOn'], 'meet.startsOn');
  const endsOn = typeof meet['endsOn'] === 'string' && DAY.test(meet['endsOn']) ? meet['endsOn'] : startsOn;

  const record = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const confirmed = Object.fromEntries(
    Object.entries(record(body['confirmed'])).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  const writeLicence = Object.fromEntries(
    Object.entries(record(body['writeLicence'])).map(([key, value]) => [key, value !== false]),
  );

  return {
    fileName: text(body['fileName'], 'fileName', 200),
    clubCode: text(body['clubCode'], 'clubCode', 60),
    official: body['official'] !== false,
    meet: {
      name: text(meet['name'], 'meet.name', 200),
      city: text(meet['city'] ?? '', 'meet.city', 120, false) || null,
      course: course(meet['course']),
      startsOn,
      endsOn: endsOn < startsOn ? startsOn : endsOn,
    },
    athletes: athletes.map(parseAthlete),
    confirmed,
    writeLicence,
  };
}
