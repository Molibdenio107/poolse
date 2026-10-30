import {
  BadRequestException,
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
import { CoreRoute } from '../tenant/modules.js';
import {
  FPN_DISCIPLINES,
  STUDENT_ID_DOCUMENT_TYPES,
  boletimPrint,
  fileCopy,
  fpnPrint,
  readDocuments,
  saveDocumentFields,
  saveFpnClubSettings,
  type BoletimPrint,
  type FpnDiscipline,
  type FpnPrint,
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
    const edit: { idDocument?: IdDocumentEdit; disciplines?: FpnDiscipline[] } = {};

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
        if (type === null) {
          throw new BadRequestException({ code: 'type_required', message: 'Choose the document type', fields: { idDocumentType: 'documents.error.typeRequired' } });
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

    if (!(await saveDocumentFields(currentTenant().organizationId, studentId, edit))) {
      throw new NotFoundException('No such student');
    }
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
    if (kind !== 'fpn_declaration' && kind !== 'fpn_declaration_minor' && kind !== 'socio_form') {
      throw new BadRequestException('Unknown kind');
    }
    const fileId = typeof body['fileId'] === 'string' ? body['fileId'] : '';
    const seasonId = typeof body['seasonId'] === 'string' && body['seasonId'] !== '' ? body['seasonId'] : null;
    if (kind !== 'socio_form' && seasonId === null) throw new BadRequestException('A season is needed');
    if (kind === 'socio_form' && seasonId !== null) throw new BadRequestException('The boletim has no season');

    const outcome = await fileCopy(organizationId, membershipId, studentId, kind as StudentDocumentKind, seasonId, fileId);
    if (outcome === 'not_found') throw new NotFoundException('No such student');
    if (outcome === 'bad_file') throw new BadRequestException('Upload the file first');
    if (outcome === 'bad_season') throw new BadRequestException('No such season');
    return { filed: true };
  }

  /** What the Anexo 2 prints. Decrypts the ID number; the read is audited. */
  @Get('fpn')
  async print(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query('season') season?: string,
    @Query('minor') minor?: string,
  ): Promise<FpnPrint> {
    requireRole('owner', 'admin');
    const seasonId = season !== undefined && /^[0-9a-f-]{36}$/i.test(season) ? season : null;
    const found = await fpnPrint(currentTenant().organizationId, studentId, seasonId, minor === '1');
    if (found === null) throw new NotFoundException('No such student');
    return found;
  }
}

/** What the boletim de sócio prints (POOLSE-134). No SNS number. */
@CoreRoute()
@Controller('students/:studentId/boletim')
export class BoletimController {
  @Get()
  async print(@Param('studentId', ParseUUIDPipe) studentId: string): Promise<BoletimPrint> {
    requireRole('owner', 'admin');
    const found = await boletimPrint(currentTenant().organizationId, studentId);
    if (found === null) throw new NotFoundException('No such student');
    return found;
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
