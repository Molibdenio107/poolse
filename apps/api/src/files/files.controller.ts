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
  ServiceUnavailableException,
  StreamableFile,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireRole } from '../tenant/roles.js';
import { openFile, RULES, storeFile, type FilePurpose, type StoredFile } from './files.repository.js';
import { MAX_FILE_BYTES, sniffType, storageConfigured } from './storage.js';

const EVERY_ROLE = ['owner', 'admin', 'instructor', 'maintenance', 'student', 'guardian'] as const;

/**
 * Uploading and reading files — 12 October 2026.
 *
 * **The bytes arrive as `application/octet-stream`**, sent by the Next server
 * that read the file from the form (the same place every importer reads its
 * file), with the purpose and the original name in the query. One body parser
 * in `main.ts`, no multipart library and no temporary files on disk.
 *
 * **A file is read only through here**, after the purpose's rule: the bucket is
 * private and nothing hands out a link that works without a session.
 */
@Controller('files')
export class FilesController {
  /** Whether storage is configured, so a screen can say so instead of failing. */
  @Get('status')
  status(): { configured: boolean } {
    requireRole(...EVERY_ROLE);
    return { configured: storageConfigured() };
  }

  @Post()
  async upload(
    @Query('purpose') purpose: string | undefined,
    @Query('name') name: string | undefined,
    @Body() body: unknown,
  ): Promise<StoredFile> {
    // Every purpose switched on today is written by the office; the table
    // below is the finer answer, and the one a later purpose changes.
    requireRole('owner', 'admin');
    if (!storageConfigured()) {
      throw new ServiceUnavailableException({ code: 'storage_not_configured', message: 'File storage is not configured' });
    }

    if (!isPurpose(purpose)) throw new BadRequestException('purpose is not a file purpose');
    const rule = RULES[purpose];
    if (rule.write === null) {
      throw new BadRequestException({ code: 'purpose_not_enabled', message: 'Uploads for this purpose are not switched on' });
    }
    requireRole(...rule.write);

    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new BadRequestException({ code: 'file_empty', message: 'No file was sent' });
    }
    if (body.length > MAX_FILE_BYTES) {
      throw new BadRequestException({ code: 'file_too_large', message: 'A file may be at most 10 MB' });
    }
    const contentType = sniffType(body);
    if (contentType === null) {
      throw new BadRequestException({ code: 'file_type', message: 'Only PDF, JPEG, PNG and WebP files are accepted' });
    }
    // Photos and the logo are images; a document may also be a photograph of one.
    if (IMAGE_ONLY.has(purpose) && contentType === 'application/pdf') {
      throw new BadRequestException({ code: 'file_type', message: 'This needs an image' });
    }

    const originalName = (name ?? '').trim().slice(0, 200) || `file.${contentType.split('/')[1]}`;
    return storeFile(currentTenant().organizationId, purpose, body, contentType, originalName);
  }

  @Get(':id')
  async read(@Param('id', new ParseUUIDPipe()) id: string): Promise<StreamableFile> {
    // Any member may ask; the purpose decides who is answered.
    requireRole(...EVERY_ROLE);
    if (!storageConfigured()) throw new NotFoundException();

    const opened = await openFile(currentTenant().organizationId, id);
    if (opened === null) throw new NotFoundException();
    if (opened === 'refused') throw new ForbiddenException();

    return new StreamableFile(opened.body, {
      type: opened.contentType,
      length: opened.byteSize,
      // Inline, so a PDF opens in the browser's viewer and an image draws in an
      // <img>; the name is what the club uploaded, for "Guardar como".
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(opened.originalName)}`,
    });
  }
}

const IMAGE_ONLY = new Set<FilePurpose>(['facility_photo', 'pool_photo', 'logo', 'student_photo']);

function isPurpose(value: unknown): value is FilePurpose {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(RULES, value);
}
