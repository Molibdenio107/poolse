import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
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
  addPhoto,
  CertificateAlreadyAttachedError,
  logoFileId,
  removePhoto,
  setAgreementDocument,
  setLogo,
  setPolicyDocument,
  setQualificationDocument,
  WrongFileError,
  type PhotoOwner,
} from './attachments.repository.js';
import { CoreRoute, PoolseModule } from '../tenant/modules.js';

/**
 * Attaching uploaded files to what they belong to — 12 October 2026.
 *
 * **Owner and admin for every write**, as the uploads themselves: photographs,
 * the club's logo, the apólice, a partnership's contract and a certificate are
 * all the office's to file. Reading them is `GET /files/:id`'s rule, by purpose.
 */
@CoreRoute()
@Controller()
export class AttachmentsController {
  @Post('facilities/:facilityId/photos')
  addFacilityPhoto(
    @Param('facilityId', new ParseUUIDPipe()) facilityId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    return add('facility', facilityId, body);
  }

  @Delete('facilities/:facilityId/photos/:photoId')
  removeFacilityPhoto(
    @Param('facilityId', new ParseUUIDPipe()) facilityId: string,
    @Param('photoId', new ParseUUIDPipe()) photoId: string,
  ): Promise<{ removed: true }> {
    requireRole('owner', 'admin');
    return remove('facility', facilityId, photoId);
  }

  @Post('pools/:poolId/photos')
  addPoolPhoto(
    @Param('poolId', new ParseUUIDPipe()) poolId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    return add('pool', poolId, body);
  }

  @Delete('pools/:poolId/photos/:photoId')
  removePoolPhoto(
    @Param('poolId', new ParseUUIDPipe()) poolId: string,
    @Param('photoId', new ParseUUIDPipe()) photoId: string,
  ): Promise<{ removed: true }> {
    requireRole('owner', 'admin');
    return remove('pool', poolId, photoId);
  }

  @Put('facilities/:facilityId/insurance-policies/:id/document')
  async policyDocument(
    @Param('facilityId', new ParseUUIDPipe()) facilityId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ saved: true }> {
    requireRole('owner', 'admin');
    const fileId = optionalFileId(body);
    const done = await refuseWrongFile(() =>
      setPolicyDocument(currentTenant().organizationId, facilityId, id, fileId),
    );
    if (!done) throw new NotFoundException('No such policy');
    return { saved: true };
  }

  @Put('partners/:partnerId/agreement/document')
  async agreementDocument(
    @Param('partnerId', new ParseUUIDPipe()) partnerId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ saved: true }> {
    requireRole('owner', 'admin');
    const fileId = optionalFileId(body);
    const done = await refuseWrongFile(() =>
      setAgreementDocument(currentTenant().organizationId, partnerId, fileId),
    );
    // A partner with no agreement yet has nothing to attach a contract to.
    if (!done) throw new NotFoundException('No agreement to attach to');
    return { saved: true };
  }

  @PoolseModule('qualifications')
  @Put('qualifications/:id/document')
  async qualificationDocument(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ saved: true }> {
    requireRole('owner', 'admin');
    const fileId = optionalFileId(body);
    if (fileId === null) throw new BadRequestException('fileId is required');
    try {
      const done = await refuseWrongFile(() =>
        setQualificationDocument(currentTenant().organizationId, id, fileId),
      );
      if (!done) throw new NotFoundException();
    } catch (error) {
      if (error instanceof CertificateAlreadyAttachedError) {
        throw new ConflictException({
          code: 'qualification_document_set',
          message: error.message,
        });
      }
      throw error;
    }
    return { saved: true };
  }

  @Get('settings/logo')
  async logo(): Promise<{ fileId: string | null }> {
    requireRole('owner', 'admin', 'instructor', 'maintenance', 'student', 'guardian');
    return { fileId: await logoFileId(currentTenant().organizationId) };
  }

  @Put('settings/logo')
  async setLogo(@Body() body: Record<string, unknown>): Promise<{ saved: true }> {
    requireRole('owner', 'admin');
    const fileId = optionalFileId(body);
    await refuseWrongFile(() => setLogo(currentTenant().organizationId, fileId));
    return { saved: true };
  }
}

async function add(owner: PhotoOwner, parentId: string, body: Record<string, unknown>): Promise<{ id: string }> {
  const fileId = optionalFileId(body);
  if (fileId === null) throw new BadRequestException('fileId is required');
  const caption = typeof body['caption'] === 'string' ? body['caption'].trim().slice(0, 200) : '';
  const added = await refuseWrongFile(() =>
    addPhoto(currentTenant().organizationId, owner, parentId, fileId, caption === '' ? null : caption),
  );
  if (added === null) throw new NotFoundException();
  return added;
}

async function remove(owner: PhotoOwner, parentId: string, photoId: string): Promise<{ removed: true }> {
  if (!(await removePhoto(currentTenant().organizationId, owner, parentId, photoId))) {
    throw new NotFoundException();
  }
  return { removed: true };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `fileId` — a uuid, or null to detach. */
function optionalFileId(body: Record<string, unknown>): string | null {
  const value = body['fileId'];
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new BadRequestException('fileId must be a file id');
  }
  return value;
}

async function refuseWrongFile<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof WrongFileError) {
      throw new BadRequestException({ code: 'wrong_file', message: error.message });
    }
    throw error;
  }
}
