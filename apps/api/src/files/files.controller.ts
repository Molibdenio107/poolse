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
  StreamableFile,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireRole } from '../tenant/roles.js';
import { openFile, RULES, storeFile, type FilePurpose, type StoredFile } from './files.repository.js';
import { storageConfigured, WORD } from './storage.js';
import { judgeUpload } from './upload-check.js';
import { CoreRoute } from '../tenant/modules.js';

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
@CoreRoute()
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
    if (!isPurpose(purpose)) throw new BadRequestException('purpose is not a file purpose');
    const rule = RULES[purpose];
    if (rule.write === null) {
      throw new BadRequestException({ code: 'purpose_not_enabled', message: 'Uploads for this purpose are not switched on' });
    }
    requireRole(...rule.write);

    const { bytes, contentType, originalName } = judgeUpload(purpose, body, name);
    return storeFile(currentTenant().organizationId, purpose, bytes, contentType, originalName);
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
      // <img>; the name is what the club uploaded, for "Guardar como". A Word
      // document is always a download (POOLSE-105): no browser shows one.
      disposition: `${opened.contentType === WORD ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(opened.originalName)}`,
    });
  }
}

function isPurpose(value: unknown): value is FilePurpose {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(RULES, value);
}
