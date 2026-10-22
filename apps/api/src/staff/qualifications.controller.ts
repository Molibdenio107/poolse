import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { readPageQuery, type Paginated } from '../common/pagination.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireRole } from '../tenant/roles.js';
import {
  addQualification,
  archiveQualification,
  archiveType,
  createType,
  DuplicateTypeError,
  listExpiring,
  listTypes,
  personQualifications,
  readAmberDays,
  UnknownReferenceError,
  updateType,
  writeAmberDays,
  type ExpiringRow,
  type PersonQualifications,
  type QualificationInput,
  type QualificationType,
  type TypeInput,
} from './qualifications.repository.js';
import { PoolseModule } from '../tenant/modules.js';

/**
 * Qualifications with expiry — POOLSE-27, 7b.2.
 *
 * **Owner and admin manage everything**: the types, the window, every person's
 * records. **A person may read their own** — the staff member gets warned about
 * their own certificate — and nobody else's: an instructor asking for a
 * colleague's is a 403, not an empty list.
 */

const MANAGERS = ['owner', 'admin'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

interface TypesResponse {
  types: QualificationType[];
  amberDays: number;
}

@PoolseModule('qualifications')
@Controller()
export class QualificationsController {
  @Get('qualification-types')
  async types(): Promise<TypesResponse> {
    requireRole(...MANAGERS);
    const { organizationId } = currentTenant();
    const [types, amberDays] = await Promise.all([
      listTypes(organizationId),
      readAmberDays(organizationId),
    ]);
    return { types, amberDays };
  }

  @Post('qualification-types')
  async createType(@Body() body: Record<string, unknown>): Promise<{ id: string }> {
    requireRole(...MANAGERS);
    try {
      return { id: await createType(currentTenant().organizationId, readType(body)) };
    } catch (error) {
      throw asHttp(error);
    }
  }

  @Patch('qualification-types/:id')
  async updateType(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ ok: true }> {
    requireRole(...MANAGERS);
    try {
      if (!(await updateType(currentTenant().organizationId, id, readType(body)))) {
        throw new NotFoundException();
      }
    } catch (error) {
      throw asHttp(error);
    }
    return { ok: true };
  }

  @Delete('qualification-types/:id')
  async archiveType(@Param('id', new ParseUUIDPipe()) id: string): Promise<{ ok: true }> {
    requireRole(...MANAGERS);
    if (!(await archiveType(currentTenant().organizationId, id))) throw new NotFoundException();
    return { ok: true };
  }

  /** The club's âmbar window, in days. */
  @Put('qualification-settings')
  async window(@Body() body: Record<string, unknown>): Promise<{ amberDays: number }> {
    requireRole(...MANAGERS);
    const days = body['amberDays'];
    if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 365) {
      throw new BadRequestException({
        message: 'amberDays must be a whole number from 1 to 365',
        fields: { amberDays: 'qualifications.error.window' },
      });
    }
    await writeAmberDays(currentTenant().organizationId, days);
    return { amberDays: days };
  }

  @Get('staff/:membershipId/qualifications')
  async person(
    @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
  ): Promise<PersonQualifications & { canManage: boolean }> {
    const { organizationId, membershipId: me } = currentTenant();
    const canManage = hasRole(...MANAGERS);
    if (!canManage && me !== membershipId) {
      throw new ForbiddenException({
        code: 'not_your_record',
        message: "Only management may read another person's qualifications",
      });
    }
    const found = await personQualifications(organizationId, membershipId);
    if (found === null) throw new NotFoundException();
    return { ...found, canManage };
  }

  @Post('staff/:membershipId/qualifications')
  async add(
    @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    requireRole(...MANAGERS);
    const { organizationId, membershipId: me } = currentTenant();
    try {
      return {
        id: await addQualification(organizationId, me ?? null, membershipId, readRecord(body)),
      };
    } catch (error) {
      throw asHttp(error);
    }
  }

  @Delete('qualifications/:id')
  async archive(@Param('id', new ParseUUIDPipe()) id: string): Promise<{ ok: true }> {
    requireRole(...MANAGERS);
    if ((await archiveQualification(currentTenant().organizationId, id)) === null) {
      throw new NotFoundException();
    }
    return { ok: true };
  }

  /**
   * Everybody âmbar, vermelho or em falta — worst first. `certificate=missing`
   * narrows it to records with no certificate on file (POOLSE-97); any other
   * value is the whole list, as an unknown filter should be.
   */
  @Get('qualifications/expiring')
  async expiring(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('certificate') certificate?: string,
  ): Promise<Paginated<ExpiringRow>> {
    requireRole(...MANAGERS);
    return listExpiring(currentTenant().organizationId, readPageQuery(page, limit), {
      withoutCertificate: certificate === 'missing',
    });
  }
}

function asHttp(error: unknown): unknown {
  if (error instanceof DuplicateTypeError) {
    return new ConflictException({
      message: 'A type with that name already exists',
      fields: { name: 'qualifications.error.duplicateType' },
    });
  }
  if (error instanceof UnknownReferenceError) return new NotFoundException();
  return error;
}

function optionalInt(
  body: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  fields: Record<string, string>,
  errorKey: string,
): number | null {
  const value = body[key];
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    fields[key] = errorKey;
    return null;
  }
  return value;
}

function readType(body: Record<string, unknown>): TypeInput {
  const fields: Record<string, string> = {};
  const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
  if (name.length === 0) fields['name'] = 'qualifications.error.nameRequired';
  else if (name.length > 120) fields['name'] = 'qualifications.error.nameTooLong';

  const defaultValidityMonths = optionalInt(
    body,
    'defaultValidityMonths',
    1,
    600,
    fields,
    'qualifications.error.validity',
  );
  const amberDays = optionalInt(body, 'amberDays', 1, 365, fields, 'qualifications.error.window');
  const requiredToTeach = body['requiredToTeach'] === true;
  const blocksAssignment = body['blocksAssignment'] === true;
  if (blocksAssignment && !requiredToTeach) {
    fields['blocksAssignment'] = 'qualifications.error.blockNeedsRequired';
  }

  if (Object.keys(fields).length > 0) {
    throw new BadRequestException({ message: 'invalid qualification type', fields });
  }
  return { name, defaultValidityMonths, amberDays, requiredToTeach, blocksAssignment };
}

function optionalDate(
  body: Record<string, unknown>,
  key: string,
  fields: Record<string, string>,
): string | null {
  const value = body[key];
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !DATE.test(value) || Number.isNaN(Date.parse(value))) {
    fields[key] = 'qualifications.error.date';
    return null;
  }
  return value;
}

function readRecord(body: Record<string, unknown>): QualificationInput {
  const fields: Record<string, string> = {};
  const typeId = typeof body['typeId'] === 'string' ? body['typeId'] : '';
  if (!/^[0-9a-f-]{36}$/i.test(typeId)) fields['typeId'] = 'qualifications.error.typeRequired';

  const issuingBodyRaw = typeof body['issuingBody'] === 'string' ? body['issuingBody'].trim() : '';
  if (issuingBodyRaw.length > 200) fields['issuingBody'] = 'qualifications.error.issuerTooLong';

  const issuedOn = optionalDate(body, 'issuedOn', fields);
  const expiresOn = optionalDate(body, 'expiresOn', fields);
  if (issuedOn !== null && expiresOn !== null && expiresOn < issuedOn) {
    fields['expiresOn'] = 'qualifications.error.expiresBeforeIssued';
  }

  if (Object.keys(fields).length > 0) {
    throw new BadRequestException({ message: 'invalid qualification', fields });
  }
  return {
    typeId,
    issuingBody: issuingBodyRaw === '' ? null : issuingBodyRaw,
    issuedOn,
    expiresOn,
  };
}
