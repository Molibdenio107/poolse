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
import { hasRole, requireRole } from '../tenant/roles.js';
import { CoreRoute } from '../tenant/modules.js';
import { judgeUpload } from '../files/upload-check.js';
import {
  EXAM_RESULTS,
  archiveExam,
  attachExamCertificate,
  listExams,
  recordExam,
  type ExamResult,
  type StudentExams,
} from './medical-exams.repository.js';

/**
 * The exame médico — POOLSE-133. Read by staff (an instructor sees the state
 * and the dates, never the note or the certificate); written by owner and admin.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function date(value: unknown, field: string, required: boolean): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new BadRequestException({ code: 'required', message: `${field} is required`, fields: { [field]: 'exams.error.required' } });
    return null;
  }
  if (typeof value !== 'string' || !DATE.test(value)) {
    throw new BadRequestException({ code: 'invalid_date', message: `Invalid ${field}`, fields: { [field]: 'exams.error.date' } });
  }
  return value;
}

function result(value: unknown): ExamResult {
  if (!(EXAM_RESULTS as readonly unknown[]).includes(value)) {
    throw new BadRequestException({ code: 'invalid_result', message: 'Unknown result', fields: { result: 'exams.error.result' } });
  }
  return value as ExamResult;
}

@CoreRoute()
@Controller('students/:studentId/medical-exams')
export class MedicalExamsController {
  @Get()
  async list(@Param('studentId', ParseUUIDPipe) studentId: string): Promise<StudentExams> {
    requireRole('owner', 'admin', 'instructor');
    const found = await listExams(currentTenant().organizationId, studentId, hasRole('owner', 'admin'));
    if (found === null) throw new NotFoundException('No such student');
    return found;
  }

  @Post()
  async record(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const { organizationId, membershipId } = currentTenant();
    const examinedOn = date(body['examinedOn'], 'examinedOn', true)!;
    const validUntil = date(body['validUntil'], 'validUntil', false);
    if (validUntil !== null && validUntil < examinedOn) {
      throw new BadRequestException({ code: 'dates_order', message: 'Valid until is before the exam', fields: { validUntil: 'exams.error.order' } });
    }
    const rawNote = typeof body['note'] === 'string' ? body['note'].trim() : '';
    if (rawNote.length > 500) {
      throw new BadRequestException({ code: 'too_long', message: 'Note too long', fields: { note: 'exams.error.tooLong' } });
    }
    const id = await recordExam(
      organizationId,
      studentId,
      { examinedOn, result: result(body['result']), validUntil, note: rawNote === '' ? null : rawNote },
      membershipId,
    );
    if (id === null) throw new NotFoundException('No such student');
    return { id };
  }

  /** The certificate, raw bytes, one step; sealed (POOLSE-109's shape). */
  @Post(':examId/certificate')
  async certificate(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query('name') name: string | undefined,
    @Body() body: unknown,
  ): Promise<{ fileId: string }> {
    requireRole('owner', 'admin');
    const { bytes, contentType, originalName } = judgeUpload('medical_certificate', body, name);
    const attached = await attachExamCertificate(currentTenant().organizationId, studentId, examId, bytes, contentType, originalName);
    if (attached === null) throw new NotFoundException('No exam without a certificate here');
    return attached;
  }

  @Post(':examId/archive')
  async archive(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Param('examId', ParseUUIDPipe) examId: string,
  ): Promise<{ archived: true }> {
    requireRole('owner', 'admin');
    if (!(await archiveExam(currentTenant().organizationId, studentId, examId))) {
      throw new NotFoundException('No such exam');
    }
    return { archived: true };
  }
}
