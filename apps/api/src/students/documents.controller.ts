import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { isValidCcNumber, normalizeCcNumber } from '@poolse/rules';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireRole } from '../tenant/roles.js';
import { parseBirthDate } from './students.controller.js';
import { recordFamilyPrint } from './family-documents.repository.js';
import {
  acceptSubmission,
  listPending,
  rejectSubmission,
  type Submission,
  maySendFor,
  mayTakeFpnFor,
} from './family-submissions.repository.js';
import { EXAM_RESULTS, type ExamResult } from './medical-exams.repository.js';
import { requireOfficeOrFamily } from './student-access.js';
import { CoreRoute } from '../tenant/modules.js';
import {
  FPN_DISCIPLINES,
  STUDENT_ID_DOCUMENT_TYPES,
  boletimPrint,
  fileCopy,
  fpnPrint,
  readDocuments,
  readIdDocumentFull,
  saveDocumentFields,
  saveFpnClubSettings,
  StoredNumberNotCcError,
  type BoletimPrint,
  type FpnDiscipline,
  type FpnPrint,
  type IdDocumentFull,
  type DocumentEdit,
  type IdDocumentEdit,
  type StudentDocumentKind,
  type StudentDocuments,
  type StudentIdDocumentType,
} from './documents.repository.js';

/**
 * *Documentos* — POOLSE-132. Owner and admin: the ID document's number is
 * decrypted only for the print, and audited there; the signed copies are the
 * office's file.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function date(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !DATE.test(value)) {
    throw new BadRequestException({ code: 'invalid_date', message: `Invalid ${field}`, fields: { [field]: 'documents.error.date' } });
  }
  return value;
}

function short(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new BadRequestException(`Invalid ${field}`);
  const text = value.trim();
  if (text === '') return null;
  if (text.length > 20) {
    throw new BadRequestException({ code: 'too_long', message: `${field} too long`, fields: { [field]: 'documents.error.tooLong' } });
  }
  return text;
}

/** The ID document and the disciplines from a body: one reading, whoever is writing. */
export function readDocumentEdit(body: Record<string, unknown>): DocumentEdit {
  const edit: DocumentEdit = {};

  if ('idDocumentType' in body || 'idDocumentNumber' in body) {
    const rawType = body['idDocumentType'];
    const type = rawType === '' || rawType === null || rawType === undefined ? null : rawType;
    if (type !== null && !(STUDENT_ID_DOCUMENT_TYPES as readonly unknown[]).includes(type)) {
      throw new BadRequestException({ code: 'invalid_type', message: 'Unknown document type', fields: { idDocumentType: 'documents.error.type' } });
    }
    const doc: IdDocumentEdit = {
      type: type as StudentIdDocumentType | null,
      issuedOn: date(body['idDocumentIssuedOn'], 'idDocumentIssuedOn'),
      validUntil: date(body['idDocumentValidUntil'], 'idDocumentValidUntil'),
    };
    // An absent number keeps the one on file: the screen never holds it.
    if (typeof body['idDocumentNumber'] === 'string' && body['idDocumentNumber'].trim() !== '') {
      let number = body['idDocumentNumber'].trim().toUpperCase();
      if (type === 'cc') {
        number = normalizeCcNumber(number);
        if (!isValidCcNumber(number)) {
          throw new BadRequestException({ code: 'invalid_cc', message: 'Not a valid Cartão de Cidadão number', fields: { idDocumentNumber: 'documents.error.cc' } });
        }
      } else if (number.length > 30) {
        throw new BadRequestException({ code: 'too_long', message: 'Number too long', fields: { idDocumentNumber: 'documents.error.tooLong' } });
      }
      doc.number = number;
    } else if (body['idDocumentClear'] === true) {
      doc.number = null;
    }
    if (doc.issuedOn !== null && doc.validUntil !== null && doc.validUntil < doc.issuedOn) {
      throw new BadRequestException({ code: 'dates_order', message: 'Valid until is before issued', fields: { idDocumentValidUntil: 'documents.error.order' } });
    }
    edit.idDocument = doc;
  }

  if ('disciplines' in body) {
    const raw = body['disciplines'];
    if (!Array.isArray(raw) || raw.some((d) => !(FPN_DISCIPLINES as readonly unknown[]).includes(d))) {
      throw new BadRequestException('disciplines is a list of FPN disciplines');
    }
    edit.disciplines = [...new Set(raw as FpnDiscipline[])];
  }
  return edit;
}

/** Saves it, saying a stored number that is no Cartão de Cidadão as a field's error. */
export async function saveEdit(organizationId: string, studentId: string, edit: DocumentEdit): Promise<void> {
  let saved: boolean;
  try {
    saved = await saveDocumentFields(organizationId, studentId, edit);
  } catch (error) {
    // "Cartão de Cidadão" chosen for a number typed on Geral that is not one.
    if (error instanceof StoredNumberNotCcError) {
      throw new BadRequestException({ code: 'invalid_cc', message: error.message, fields: { idDocumentNumber: 'documents.error.ccStored' } });
    }
    throw error;
  }
  if (!saved) throw new NotFoundException('No such student');
}

@CoreRoute()
@Controller('students/:studentId/documents')
export class StudentDocumentsController {
  @Get()
  async read(@Param('studentId', ParseUUIDPipe) studentId: string): Promise<StudentDocuments> {
    requireRole('owner', 'admin');
    const found = await readDocuments(currentTenant().organizationId, studentId);
    if (found === null) throw new NotFoundException('No such student');
    return found;
  }

  /** The ID document and the FPN disciplines. */
  @Patch()
  async save(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ saved: true }> {
    requireRole('owner', 'admin');
    const edit = readDocumentEdit(body);

    await saveEdit(currentTenant().organizationId, studentId, edit);
    return { saved: true };
  }

  /** A signed copy, filed for a season (the FPN declarations) or none (the boletim). */
  @Post('copies')
  async file(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ filed: true }> {
    requireRole('owner', 'admin');
    const { organizationId, membershipId } = currentTenant();
    const kind = body['kind'];
    if (kind !== 'fpn_declaration' && kind !== 'fpn_declaration_minor' && kind !== 'socio_form' && kind !== 'id_document') {
      throw new BadRequestException('Unknown kind');
    }
    // The boletim and the ID's photograph have no season; the declarations do.
    const seasonless = kind === 'socio_form' || kind === 'id_document';
    const fileId = typeof body['fileId'] === 'string' ? body['fileId'] : '';
    const seasonId = typeof body['seasonId'] === 'string' && body['seasonId'] !== '' ? body['seasonId'] : null;
    if (!seasonless && seasonId === null) throw new BadRequestException('A season is needed');
    if (seasonless && seasonId !== null) throw new BadRequestException('This document has no season');

    const outcome = await fileCopy(organizationId, membershipId, studentId, kind as StudentDocumentKind, seasonId, fileId);
    if (outcome === 'not_found') throw new NotFoundException('No such student');
    if (outcome === 'bad_file') throw new BadRequestException('Upload the file first');
    if (outcome === 'bad_season') throw new BadRequestException('No such season');
    return { filed: true };
  }

  /** What the family sent and the office has not decided — POOLSE-179 slice 2. */
  @Get('submissions')
  async submissions(@Param('studentId', ParseUUIDPipe) studentId: string): Promise<{ submissions: Submission[] }> {
    requireRole('owner', 'admin');
    return { submissions: await listPending(currentTenant().organizationId, studentId) };
  }

  /**
   * Accept: filed as the office files a copy (a current one is replaced), or, for
   * an exam, recorded with the result the office reads off the certificate.
   */
  @Post('submissions/:submissionId/accept')
  async accept(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ accepted: true }> {
    requireRole('owner', 'admin');
    const { organizationId, membershipId } = currentTenant();
    const result = body['result'];
    const validUntil = body['validUntil'];
    let exam: { result: ExamResult; validUntil: string | null } | null = null;
    if (result !== undefined) {
      if (!(EXAM_RESULTS as readonly unknown[]).includes(result)) throw new BadRequestException('Unknown result');
      if (validUntil !== undefined && validUntil !== null && (typeof validUntil !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(validUntil))) {
        throw new BadRequestException('validUntil is a date');
      }
      exam = { result: result as ExamResult, validUntil: typeof validUntil === 'string' ? validUntil : null };
    }
    const outcome = await acceptSubmission(
      organizationId,
      membershipId,
      studentId,
      submissionId,
      exam,
      parseBirthDate(body['birthDate']),
    );
    if (outcome === 'not_found') throw new NotFoundException('Nothing waiting with that id');
    if (outcome === 'needs_result') throw new BadRequestException({ code: 'needs_result', message: 'An exam needs its result' });
    if (outcome === 'bad_file') throw new ConflictException('This file cannot be filed');
    return { accepted: true };
  }

  /** Reject: nothing is filed, and a sealed file (ID photo, exam) is shredded. */
  @Post('submissions/:submissionId/reject')
  async reject(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
  ): Promise<{ rejected: true }> {
    requireRole('owner', 'admin');
    const { organizationId, membershipId } = currentTenant();
    if ((await rejectSubmission(organizationId, membershipId, studentId, submissionId)) !== 'done') {
      throw new NotFoundException('Nothing waiting with that id');
    }
    return { rejected: true };
  }

  /** The ID document with the number in full, for the record (each read audited). */
  @Get('id-document')
  async idDocument(@Param('studentId', ParseUUIDPipe) studentId: string): Promise<IdDocumentFull> {
    requireRole('owner', 'admin');
    const found = await readIdDocumentFull(currentTenant().organizationId, studentId);
    if (found === null) throw new NotFoundException('No such student');
    return found;
  }

  /** What the Anexo 2 prints. Decrypts the ID number; the read is audited. */
  @Get('fpn')
  async print(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query('season') season?: string,
    @Query('minor') minor?: string,
  ): Promise<FpnPrint> {
    const reader = await requireOfficeOrFamily(studentId);
    const seasonId = season !== undefined && /^[0-9a-f-]{36}$/i.test(season) ? season : null;
    const { organizationId, membershipId } = currentTenant();
    // POOLSE-193: the one who signs takes it, and only once it is complete. The
    // office's desk path never asked, and does not now.
    if (reader === 'family') {
      if (!membershipId || !(await mayTakeFpnFor(organizationId, membershipId, studentId))) {
        throw new ForbiddenException({ code: 'minor_reads_only', message: 'A guardian takes this form' });
      }
      const held = await readDocuments(organizationId, studentId);
      if (held !== null && held.missing.length > 0) {
        throw new ConflictException({ code: 'form_incomplete', message: 'Mandatory data is missing', missing: held.missing });
      }
    }
    const found = await fpnPrint(organizationId, studentId, seasonId, minor === '1');
    if (found === null) throw new NotFoundException('No such student');
    if (reader === 'family') await recordFamilyPrint(organizationId, studentId, 'fpn');
    return found;
  }
}

/** What the boletim de sócio prints (POOLSE-134). No SNS number. */
@CoreRoute()
@Controller('students/:studentId/boletim')
export class BoletimController {
  @Get()
  async print(@Param('studentId', ParseUUIDPipe) studentId: string): Promise<BoletimPrint> {
    const reader = await requireOfficeOrFamily(studentId);
    const { organizationId, membershipId } = currentTenant();
    const found = await boletimPrint(organizationId, studentId);
    if (found === null) throw new NotFoundException('No such student');
    if (reader === 'office') return found;
    // POOLSE-131: the SNS number is read by the office alone.
    await recordFamilyPrint(organizationId, studentId, 'boletim');
    // A minor's own login takes neither form's ID number (POOLSE-193).
    const signs = membershipId !== undefined && membershipId !== null && (await maySendFor(organizationId, membershipId, studentId));
    return { ...found, snsNumber: null, ...(signs ? {} : { idDocumentNumber: null }) };
  }
}

/** The club's regional association and FPN abbreviation, printed on every Anexo 2. */
@CoreRoute()
@Controller('fpn-settings')
export class FpnSettingsController {
  @Patch()
  async save(@Body() body: Record<string, unknown>): Promise<{ saved: true }> {
    requireRole('owner', 'admin');
    await saveFpnClubSettings(currentTenant().organizationId, {
      association: short(body['association'], 'association'),
      clubCode: short(body['clubCode'], 'clubCode'),
    });
    return { saved: true };
  }
}
