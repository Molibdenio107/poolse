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
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireRole } from '../tenant/roles.js';
import {
  DuplicateEffectiveDateError,
  archiveRegulation,
  listRegulations,
  publishRegulation,
  readComplaintsSettings,
  updateComplaintsSettings,
  type ComplaintsSettings,
  type RegulationVersion,
} from './regulations.repository.js';
import { LIVRO_RECLAMACOES_URL } from './public-notices.js';
import { CoreRoute } from '../tenant/modules.js';

/** Every staff role reads it — it is on the public page anyway. */
const CAN_READ = ['owner', 'admin', 'instructor', 'maintenance'] as const;
/** Publishing a club's rules is a management act. */
const CAN_PUBLISH = ['owner', 'admin'] as const;

/** The regulation's length ceiling, as the table's CHECK holds it. */
export const REGULATION_MAX_LENGTH = 50_000;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A facility's operating regulation — POOLSE-73. Versions are published, never
 * edited; the version in force is the latest whose day has come.
 */
@CoreRoute()
@Controller('facilities/:facilityId/regulations')
export class RegulationsController {
  @Get()
  async list(
    @Param('facilityId', new ParseUUIDPipe()) facilityId: string,
  ): Promise<{ versions: RegulationVersion[] }> {
    requireRole(...CAN_READ);
    const versions = await listRegulations(currentTenant().organizationId, facilityId);
    if (versions === null) throw new NotFoundException();
    return { versions };
  }

  @Post()
  async publish(
    @Param('facilityId', new ParseUUIDPipe()) facilityId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    requireRole(...CAN_PUBLISH);
    const { organizationId, membershipId } = currentTenant();

    const text = typeof body['body'] === 'string' ? body['body'].replace(/\r\n/g, '\n').trim() : '';
    if (text === '' || text.length > REGULATION_MAX_LENGTH) {
      throw new BadRequestException({
        code: 'invalid',
        message: 'The regulation needs text, within the length limit',
        fields: { body: text === '' ? 'regulation.bodyRequired' : 'regulation.bodyTooLong' },
      });
    }
    const day = typeof body['effectiveFrom'] === 'string' ? body['effectiveFrom'].trim() : '';
    const parsed = new Date(`${day}T12:00:00Z`);
    if (!ISO_DAY.test(day) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
      throw new BadRequestException({
        code: 'invalid',
        message: 'effectiveFrom is a day, YYYY-MM-DD',
        fields: { effectiveFrom: 'regulation.dateInvalid' },
      });
    }

    try {
      const id = await publishRegulation(organizationId, facilityId, { effectiveFrom: day, body: text }, membershipId);
      if (id === null) throw new NotFoundException();
      return { id };
    } catch (error) {
      if (error instanceof DuplicateEffectiveDateError) {
        throw new ConflictException({
          code: 'regulation_same_day',
          message: 'A version already takes effect on that day',
          fields: { effectiveFrom: 'regulation.sameDay' },
        });
      }
      throw error;
    }
  }

  @Post(':regulationId/archive')
  async archive(
    @Param('facilityId', new ParseUUIDPipe()) facilityId: string,
    @Param('regulationId', new ParseUUIDPipe()) regulationId: string,
  ): Promise<{ archived: true }> {
    requireRole(...CAN_PUBLISH);
    const archived = await archiveRegulation(currentTenant().organizationId, facilityId, regulationId);
    if (!archived) throw new NotFoundException();
    return { archived: true };
  }
}

/**
 * Where the club's complaints go — POOLSE-73. Private (the official Livro de
 * Reclamações Eletrónico, the default) or a public service, which names its own
 * platform. Owner and Admin, the people who answer for the club's paperwork.
 */
@CoreRoute()
@Controller('settings/complaints')
export class ComplaintsSettingsController {
  @Get()
  async read(): Promise<ComplaintsSettings & { officialUrl: string }> {
    requireRole(...CAN_PUBLISH);
    return { ...(await readComplaintsSettings(currentTenant().organizationId)), officialUrl: LIVRO_RECLAMACOES_URL };
  }

  @Put()
  async update(@Body() body: Record<string, unknown>): Promise<ComplaintsSettings> {
    requireRole(...CAN_PUBLISH);
    const regime = body['regime'] === 'public_service' ? 'public_service' : 'private';
    const raw = typeof body['url'] === 'string' ? body['url'].trim() : '';
    if (regime === 'public_service' && !/^https:\/\/\S+$/.test(raw)) {
      throw new BadRequestException({
        code: 'invalid',
        message: 'A public service names its complaints platform with an https address',
        fields: { url: 'publicNotices.urlRequired' },
      });
    }
    if (raw.length > 300) {
      throw new BadRequestException({
        code: 'invalid', message: 'Address too long', fields: { url: 'publicNotices.urlTooLong' },
      });
    }
    return updateComplaintsSettings(currentTenant().organizationId, {
      regime,
      // A private operator's link is the official one; a stale public address is dropped.
      url: regime === 'public_service' ? raw : null,
    });
  }
}
