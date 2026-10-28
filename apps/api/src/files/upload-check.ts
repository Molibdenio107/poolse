import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { FilePurpose } from './files.repository.js';
import { MAX_FILE_BYTES, sniffType, storageConfigured, WORD } from './storage.js';

const IMAGE_ONLY = new Set<FilePurpose>(['facility_photo', 'pool_photo', 'logo', 'student_photo', 'staff_photo']);

/**
 * What an uploaded body is, or the refusal — one judgement for `POST /files`
 * and for a route that stores its own file in one step (an atestado,
 * POOLSE-109), so the two can never accept different things.
 */
export function judgeUpload(
  purpose: FilePurpose,
  body: unknown,
  name: string | undefined,
): { bytes: Buffer; contentType: string; originalName: string } {
  if (!storageConfigured()) {
    throw new ServiceUnavailableException({ code: 'storage_not_configured', message: 'File storage is not configured' });
  }
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new BadRequestException({ code: 'file_empty', message: 'No file was sent' });
  }
  if (body.length > MAX_FILE_BYTES) {
    throw new BadRequestException({ code: 'file_too_large', message: 'A file may be at most 10 MB' });
  }
  const contentType = sniffType(body);
  if (contentType === null) {
    throw new BadRequestException({ code: 'file_type', message: 'Only PDF, Word, JPEG, PNG and WebP files are accepted' });
  }
  // A Word document is a contract and nothing else — POOLSE-105.
  if (contentType === WORD && purpose !== 'agreement_document') {
    throw new BadRequestException({ code: 'file_type', message: 'A Word document is accepted only as a signed contract' });
  }
  // Photos and the logo are images; a document may also be a photograph of one.
  if (IMAGE_ONLY.has(purpose) && contentType === 'application/pdf') {
    throw new BadRequestException({ code: 'file_type', message: 'This needs an image' });
  }
  const originalName = (name ?? '').trim().slice(0, 200) || `file.${contentType.split('/')[1]}`;
  return { bytes: body, contentType, originalName };
}
