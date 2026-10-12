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
  Query,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireRole, type MemberRole } from '../tenant/roles.js';
import { readPageQuery, type Paginated } from '../common/pagination.js';
import {
  addAddendum,
  archiveIncident,
  listIncidents,
  mayReadDetail,
  readIncident,
  readIncidentDetail,
  recordIncident,
  OccurredInFutureError,
  PlaceOffSiteError,
  type IncidentDetail,
  type IncidentFacts,
  type IncidentInput,
  type IncidentSummary,
} from './incidents.repository.js';

/**
 * Bather incidents — POOLSE-70.
 *
 * **Staff record and read the facts**: owner, admin, instructor and maintenance
 * — the people on the deck when something happens. A student or a guardian is
 * refused everywhere here.
 *
 * **The health detail and the addenda are Owner/Admin's and the author's**
 * (answered 12-10-2026), decided per row in the repository; reading them is a
 * POST because every read writes an audit row, and a GET that writes is a GET a
 * browser may prefetch.
 */

const STAFF: readonly MemberRole[] = ['owner', 'admin', 'instructor', 'maintenance'];
const MAX_TEXT = 5000;
const MAX_SHORT = 200;

@Controller('facilities/:facilityId/incidents')
export class FacilityIncidentsController {
  @Get()
  async list(
    @Param('facilityId', new ParseUUIDPipe()) facilityId: string,
    @Query('page') page?: string,
  ): Promise<Paginated<IncidentSummary>> {
    requireRole(...STAFF);
    return listIncidents(currentTenant().organizationId, facilityId, readPageQuery(page));
  }

  @Post()
  async record(
    @Param('facilityId', new ParseUUIDPipe()) facilityId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    requireRole(...STAFF);
    try {
      const id = await recordIncident(currentTenant().organizationId, facilityId, readInput(body));
      if (id === null) throw new NotFoundException('No such site');
      return { id };
    } catch (error) {
      if (error instanceof OccurredInFutureError) {
        throw new BadRequestException({
          message: 'occurredAt is in the future',
          fields: { occurredAt: 'incidents.error.future' },
        });
      }
      if (error instanceof PlaceOffSiteError) {
        throw new BadRequestException({
          message: 'The tank or space is not at this site',
          fields: { place: 'incidents.error.placeOffSite' },
        });
      }
      throw error;
    }
  }
}

@Controller('incidents')
export class IncidentsController {
  @Get(':id')
  async one(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<IncidentFacts & { canReadDetail: boolean; canArchive: boolean }> {
    requireRole(...STAFF);
    const facts = await readIncident(currentTenant().organizationId, id);
    if (facts === null) throw new NotFoundException();
    return {
      ...facts,
      canReadDetail: mayReadDetail(facts, hasRole('owner', 'admin')),
      canArchive: hasRole('owner', 'admin'),
    };
  }

  @Post(':id/detail')
  async detail(@Param('id', new ParseUUIDPipe()) id: string): Promise<IncidentDetail> {
    requireRole(...STAFF);
    const detail = await readIncidentDetail(
      currentTenant().organizationId,
      id,
      hasRole('owner', 'admin'),
    );
    if (detail === null) throw new NotFoundException();
    if (detail === 'refused') {
      throw new ForbiddenException({
        code: 'incident_detail_refused',
        message: 'The health detail is for the owner, the admins and its author',
      });
    }
    return detail;
  }

  @Post(':id/addenda')
  async addendum(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ added: true }> {
    requireRole(...STAFF);
    const text = typeof body['body'] === 'string' ? body['body'].trim() : '';
    if (text === '' || text.length > MAX_TEXT) {
      throw new BadRequestException({
        message: 'body is required',
        fields: { body: 'incidents.error.addendumRequired' },
      });
    }
    const outcome = await addAddendum(
      currentTenant().organizationId,
      id,
      text,
      hasRole('owner', 'admin'),
    );
    if (outcome === null) throw new NotFoundException();
    if (outcome === 'refused') {
      throw new ForbiddenException({
        code: 'incident_detail_refused',
        message: 'A correction is added by the owner, the admins or its author',
      });
    }
    return { added: true };
  }

  @Post(':id/archive')
  async archive(@Param('id', new ParseUUIDPipe()) id: string): Promise<{ archived: true }> {
    requireRole('owner', 'admin');
    if (!(await archiveIncident(currentTenant().organizationId, id))) {
      throw new NotFoundException();
    }
    return { archived: true };
  }
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.slice(0, max);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function id(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value.trim()) ? value.trim() : null;
}

function readInput(body: Record<string, unknown>): IncidentInput {
  const fields: Record<string, string> = {};

  const occurredAt = text(body['occurredAt'], 32);
  if (occurredAt === null || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(occurredAt)) {
    fields['occurredAt'] = 'incidents.error.whenRequired';
  }

  const studentId = id(body['studentId']);
  const membershipId = id(body['membershipId']);
  const visitorName = text(body['visitorName'], MAX_SHORT);
  if ([studentId, membershipId, visitorName].filter((one) => one !== null).length !== 1) {
    fields['person'] = 'incidents.error.personRequired';
  }

  const poolId = id(body['poolId']);
  const spaceId = id(body['spaceId']);
  if (poolId !== null && spaceId !== null) fields['place'] = 'incidents.error.onePlace';

  const whatHappened = text(body['whatHappened'], MAX_TEXT);
  if (whatHappened === null) fields['whatHappened'] = 'incidents.error.whatRequired';

  if (Object.keys(fields).length > 0) {
    throw new BadRequestException({ message: 'Invalid incident', fields });
  }

  return {
    occurredAt: occurredAt!,
    poolId,
    spaceId,
    studentId,
    membershipId,
    visitorName,
    emergencyCalled: body['emergencyCalled'] === true,
    lifeguardMembershipId: id(body['lifeguardMembershipId']),
    policyReference: text(body['policyReference'], MAX_SHORT),
    whatHappened: whatHappened!,
    injury: text(body['injury'], MAX_TEXT),
    firstAid: text(body['firstAid'], MAX_TEXT),
  };
}
