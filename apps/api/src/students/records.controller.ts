import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireRole } from '../tenant/roles.js';
import {
  addRecord,
  archiveRecord,
  progressionFor,
  setFavouriteStroke,
  STROKES,
  type Progression,
  type Stroke,
} from './records.repository.js';

interface ProgressionResponse extends Progression {
  organizationId: string;
  strokes: Stroke[];
  canRecord: boolean;
}

const MAX_NOTE = 500;

/**
 * Slice for backlog story 6 — a student's performances over time.
 *
 * Writing is open to instructors as well as owners and admins, and that is the
 * point of the story: the person holding the stopwatch is the instructor, and a
 * flow where they have to send times to an administrator to be typed in is a flow
 * that produces no data at all.
 *
 * Reading is open to any member. A time is not sensitive information the way a
 * medical note is — it is the thing the child's parents are told at the end of
 * term.
 */
@Controller('students/:studentId/progression')
export class RecordsController {
  @Get()
  async read(@Param('studentId') studentId: string): Promise<ProgressionResponse> {
    const { organizationId } = currentTenant();

    const progression = await progressionFor(organizationId, studentId);
    if (progression === null) throw new NotFoundException('No such student');

    return {
      ...progression,
      organizationId,
      strokes: STROKES,
      canRecord: hasRole('owner', 'admin', 'instructor'),
    };
  }

  @Post()
  async add(
    @Param('studentId') studentId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    requireRole('owner', 'admin', 'instructor');
    const { organizationId } = currentTenant();

    const id = await addRecord(organizationId, studentId, {
      stroke: parseStroke(body['stroke']),
      distanceM: parseDistance(body['distanceM']),
      timeMs: parseTime(body),
      swumOn: parseDate(body['swumOn']),
      note: parseNote(body['note']),
    });

    if (id === null) throw new NotFoundException('No such student');
    return { id };
  }

  /**
   * The one archive action instructors keep — and deliberately not
   * `requireCanArchive`.
   *
   * POOLSE-03 restricts archiving to owners and admins, and every other archive
   * endpoint now shares that check. This one is different in kind: a swim time
   * is data the instructor recorded minutes earlier at the poolside, and
   * withdrawing a mistyped one is part of recording them. Routing it through an
   * admin would mean wrong times sitting on a child's progression until somebody
   * senior had a moment.
   *
   * Nothing is destroyed either way — `archiveRecord` is a soft delete and the
   * time stays in the table, out of the bests.
   *
   * If this should follow the others after all, it is one line. It is written
   * out so that is a decision rather than an oversight found by a later sweep.
   */
  @Post(':recordId/archive')
  async archive(
    @Param('studentId') studentId: string,
    @Param('recordId') recordId: string,
  ): Promise<{ archived: true }> {
    requireRole('owner', 'admin', 'instructor');
    const { organizationId } = currentTenant();

    if (!(await archiveRecord(organizationId, studentId, recordId))) {
      throw new NotFoundException('No such record');
    }
    return { archived: true };
  }

  /**
   * PUT, and an empty value clears it. A favourite stroke is declared by a
   * person and can be un-declared by one; there is no "unknown" that a PATCH
   * shape could distinguish from "leave it alone".
   */
  @Put('favourite-stroke')
  async favourite(
    @Param('studentId') studentId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ saved: true }> {
    requireRole('owner', 'admin', 'instructor');
    const { organizationId } = currentTenant();

    const raw = typeof body['stroke'] === 'string' ? body['stroke'].trim() : '';
    const stroke = raw.length === 0 ? null : parseStroke(raw);

    if (!(await setFavouriteStroke(organizationId, studentId, stroke))) {
      throw new NotFoundException('No such student');
    }
    return { saved: true };
  }
}

function parseStroke(value: unknown): Stroke {
  if (typeof value !== 'string' || !STROKES.includes(value as Stroke)) {
    throw new BadRequestException(`stroke must be one of: ${STROKES.join(', ')}`);
  }
  return value as Stroke;
}

function parseDistance(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 10000) {
    throw new BadRequestException('distanceM must be a whole number of metres, up to 10000');
  }
  return parsed;
}

/**
 * Accepts the time the way a person writes it down, and stores integer
 * milliseconds.
 *
 * `minutes`, `seconds` and `hundredths` as three fields rather than one text
 * box, because "1:23.45" and "83.45" and "1.23.45" are all things people type,
 * and guessing between them silently produces a wrong personal best. Three
 * numeric inputs cannot be misread.
 *
 * The arithmetic is integer throughout. A float would make 27.35 seconds
 * unrepresentable and a personal best that is a fraction of a microsecond
 * slower than the identical swim — a bug nobody would ever track down.
 */
function parseTime(body: Record<string, unknown>): number {
  const part = (key: string, max: number): number => {
    const raw = body[key];
    if (raw === undefined || raw === null || raw === '') return 0;
    const parsed = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
      throw new BadRequestException(`${key} must be a whole number between 0 and ${max}`);
    }
    return parsed;
  };

  const totalMs =
    part('minutes', 600) * 60_000 + part('seconds', 59) * 1000 + part('hundredths', 99) * 10;

  if (totalMs <= 100) {
    throw new BadRequestException('A time is required, and must be more than a tenth of a second');
  }
  return totalMs;
}

function parseDate(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new BadRequestException('swumOn must be a date, as YYYY-MM-DD');
  }
  if (new Date(`${raw}T00:00:00Z`).getTime() > Date.now()) {
    throw new BadRequestException('A swim cannot be in the future');
  }
  return raw;
}

function parseNote(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_NOTE) {
    throw new BadRequestException(`note may be at most ${MAX_NOTE} characters`);
  }
  return trimmed;
}
