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
import { hasRole, requireCanArchive, requireRole } from '../tenant/roles.js';
import { readPageQuery, type Paginated } from '../common/pagination.js';
import {
  addSpace,
  archiveCleaning,
  archiveIssue,
  archiveSpace,
  DuplicateNameError,
  getSpace,
  isRequestType,
  isSpaceType,
  listSpaces,
  logCleaning,
  reportIssue,
  resolveIssue,
  updateSpace,
  type Cleaning,
  type Issue,
  type SpaceInput,
  type SpaceSummary,
} from './spaces.repository.js';

/**
 * Espaços — the non-pool parts of a site, and what happens in them.
 *
 * Its own controller rather than more methods on `FacilitiesController`, on the
 * same reasoning inventory used: a space has a screen of its own with a history
 * and an issue list, and `/facilities/:id/spaces/:spaceId/cleanings` would be a
 * route describing a page rather than a resource.
 *
 * **Three permission tiers, and they are not the usual two.** Reading is open to
 * any member. *Logging a cleaning and reporting a fault are open to every
 * management login* — including instructors and maintenance, who are the people
 * actually in the building — because a feature that made an instructor find an
 * admin to record that they mopped the balneário would simply not be used.
 * Resolving is narrower (owner, admin, maintenance): closing someone's report is
 * a judgement about whether the work was done. Deleting is owner/admin, as
 * everywhere.
 */

/** Every management login. Not students, not guardians. */
const MANAGEMENT = ['owner', 'admin', 'instructor', 'maintenance'] as const;

/** Who may close a report. An instructor may raise one but not close it. */
const CAN_RESOLVE = ['owner', 'admin', 'maintenance'] as const;

interface SpaceListResponse {
  facilityId: string;
  /** Owner/admin: may add, edit and delete spaces. */
  canManage: boolean;
  /** Any management login: may log a cleaning and report an issue. */
  canLog: boolean;
  /** Owner/admin/maintenance: may resolve. */
  canResolve: boolean;
  items: SpaceSummary[];
}

interface SpaceDetailResponse extends Omit<SpaceListResponse, 'items'> {
  space: SpaceSummary;
  cleanings: Paginated<Cleaning>;
  issues: Issue[];
}

/*
 * The same answer the guards give, sent to the screen.
 *
 * The read endpoint reports exactly what the write endpoints will enforce, so a
 * control is shown when and only when pressing it would work. The alternative —
 * the client deciding for itself from a role list — is two implementations of
 * one rule, and they disagree the day the rule moves.
 */
function permissions(): Pick<SpaceListResponse, 'canManage' | 'canLog' | 'canResolve'> {
  return {
    canManage: hasRole('owner', 'admin'),
    canLog: hasRole(...MANAGEMENT),
    canResolve: hasRole(...CAN_RESOLVE),
  };
}

function readName(body: { name?: unknown }): string {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name === '') {
    throw new BadRequestException({
      message: 'name is required',
      fields: { name: 'spaces.nameRequired' },
    });
  }
  return name;
}

/**
 * The type, defaulting to `other`.
 *
 * Absent means `other`, which is the column's own default and the reason the
 * enum carries an escape hatch at all: a club naming a room the six categories
 * do not cover must not be stopped by the classification. A *stated* value that
 * is not one of the six is still refused — that is a client sending nonsense,
 * not an operator declining to categorise.
 */
function readType(body: { type?: unknown }): SpaceInput['type'] {
  if (body.type === undefined || body.type === null || body.type === '') return 'other';

  const type = typeof body.type === 'string' ? body.type : '';
  if (!isSpaceType(type)) {
    throw new BadRequestException({
      message: 'type is not a space type',
      fields: { type: 'spaces.typeInvalid' },
    });
  }
  return type;
}

/**
 * The cleaning interval, in hours.
 *
 * Empty means no schedule, which is a real answer and the default — a car park
 * nobody set an interval for must never shout. Zero is refused rather than
 * quietly stored, because it would mean permanently overdue and nobody types it
 * on purpose; the database refuses it too, and this is the version that says so
 * in the operator's language.
 */
function readInterval(body: { intervalHours?: unknown }): number | null {
  const raw = body.intervalHours;
  if (raw === null || raw === undefined || raw === '') return null;

  const hours = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isInteger(hours) || hours <= 0) {
    throw new BadRequestException({
      message: 'intervalHours must be a positive whole number of hours',
      fields: { intervalHours: 'spaces.intervalInvalid' },
    });
  }
  return hours;
}

function readOptionalText(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text === '' ? null : text;
}

function readSpaceInput(body: Record<string, unknown>): SpaceInput {
  return {
    name: readName(body),
    type: readType(body),
    description: readOptionalText(body.description),
    // Absent means active: a space created without saying is in use.
    active: body.active === undefined ? true : body.active !== false,
    intervalHours: readInterval(body),
  };
}

function nameTaken(error: unknown): never {
  if (error instanceof DuplicateNameError) {
    throw new ConflictException({ message: 'spaces.nameTaken', name: error.message });
  }
  throw error;
}

@Controller('spaces')
export class SpacesController {
  /** The spaces at one site, each with its last cleaning and open-issue count. */
  @Get()
  async list(@Query('facilityId') facilityId?: string): Promise<SpaceListResponse> {
    if (facilityId === undefined || facilityId === '') {
      throw new BadRequestException({ message: 'facilityId is required' });
    }

    const { organizationId } = currentTenant();
    const items = await listSpaces(organizationId, facilityId);
    if (items === null) throw new NotFoundException({ message: 'facilityNotFound' });

    return { facilityId, ...permissions(), items };
  }

  /** One space: its header, its cleaning history and its issues. */
  @Get(':id')
  async detail(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<SpaceDetailResponse> {
    const { organizationId } = currentTenant();
    const detail = await getSpace(organizationId, id, readPageQuery(page, limit));
    if (detail === null) throw new NotFoundException({ message: 'spaceNotFound' });

    return {
      facilityId: detail.space.facilityId,
      ...permissions(),
      space: detail.space,
      cleanings: detail.cleanings,
      issues: detail.issues,
    };
  }

  @Post()
  async create(
    @Body() body: Record<string, unknown> & { facilityId?: string },
  ): Promise<{ id: string }> {
    requireRole('owner', 'admin');

    const facilityId = typeof body.facilityId === 'string' ? body.facilityId : '';
    if (facilityId === '') {
      throw new BadRequestException({ message: 'facilityId is required' });
    }

    const { organizationId } = currentTenant();
    const input = readSpaceInput(body);

    const id = await addSpace(organizationId, facilityId, input).catch(nameTaken);
    if (id === null) throw new NotFoundException({ message: 'facilityNotFound' });
    return { id };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ ok: true }> {
    requireRole('owner', 'admin');

    const { organizationId } = currentTenant();
    const input = readSpaceInput(body);

    const updated = await updateSpace(organizationId, id, input).catch(nameTaken);
    if (!updated) throw new NotFoundException({ message: 'spaceNotFound' });
    return { ok: true };
  }

  @Post(':id/archive')
  async archive(@Param('id') id: string): Promise<{ ok: true }> {
    requireCanArchive();

    const { organizationId } = currentTenant();
    if (!(await archiveSpace(organizationId, id))) {
      throw new NotFoundException({ message: 'spaceNotFound' });
    }
    return { ok: true };
  }

  /**
   * "Marcar como limpo" — one tap.
   *
   * The body carries at most a note. Who and when are the server's, never the
   * client's: a log that could name somebody else, or claim a time, is worth
   * less than the paper sheet on the back of the door.
   */
  @Post(':id/cleanings')
  async clean(
    @Param('id') id: string,
    @Body() body: { note?: unknown },
  ): Promise<{ ok: true }> {
    requireRole(...MANAGEMENT);

    const { organizationId, membershipId } = currentTenant();
    const logged = await logCleaning(
      organizationId,
      id,
      membershipId,
      readOptionalText(body?.note),
    );
    if (!logged) throw new NotFoundException({ message: 'spaceNotFound' });
    return { ok: true };
  }

  @Post(':id/cleanings/:cleaningId/archive')
  async removeCleaning(
    @Param('id') id: string,
    @Param('cleaningId') cleaningId: string,
  ): Promise<{ ok: true }> {
    requireCanArchive();

    const { organizationId } = currentTenant();
    if (!(await archiveCleaning(organizationId, id, cleaningId))) {
      throw new NotFoundException({ message: 'cleaningNotFound' });
    }
    return { ok: true };
  }

  @Post(':id/issues')
  async report(
    @Param('id') id: string,
    @Body() body: { type?: unknown; description?: unknown },
  ): Promise<{ ok: true }> {
    requireRole(...MANAGEMENT);

    const type = typeof body?.type === 'string' ? body.type : '';
    if (!isRequestType(type)) {
      throw new BadRequestException({
        message: 'type must be fault or restock',
        fields: { type: 'spaces.issueTypeInvalid' },
      });
    }

    const description = readOptionalText(body?.description);
    if (description === null) {
      throw new BadRequestException({
        message: 'description is required',
        fields: { description: 'spaces.descriptionRequired' },
      });
    }

    const { organizationId, membershipId } = currentTenant();
    const reported = await reportIssue(organizationId, id, membershipId, type, description);
    if (!reported) throw new NotFoundException({ message: 'spaceNotFound' });
    return { ok: true };
  }

  /**
   * Owner, admin or maintenance. An instructor may raise a fault and not close
   * it — reporting is noticing, resolving is a judgement that the work is done.
   */
  @Post(':id/issues/:issueId/resolve')
  async resolve(
    @Param('id') id: string,
    @Param('issueId') issueId: string,
    @Body() body: { note?: unknown },
  ): Promise<{ ok: true }> {
    requireRole(...CAN_RESOLVE);

    const { organizationId, membershipId } = currentTenant();
    const result = await resolveIssue(
      organizationId,
      id,
      issueId,
      membershipId,
      readOptionalText(body?.note),
    );

    if (result === 'missing') throw new NotFoundException({ message: 'issueNotFound' });
    // Not an error the operator caused — somebody else closed it first — but it
    // must not silently rewrite who resolved it and when.
    if (result === 'already') {
      throw new ConflictException({ message: 'spaces.issueAlreadyResolved' });
    }
    return { ok: true };
  }

  @Post(':id/issues/:issueId/archive')
  async removeIssue(
    @Param('id') id: string,
    @Param('issueId') issueId: string,
  ): Promise<{ ok: true }> {
    requireCanArchive();

    const { organizationId } = currentTenant();
    if (!(await archiveIssue(organizationId, id, issueId))) {
      throw new NotFoundException({ message: 'issueNotFound' });
    }
    return { ok: true };
  }
}
