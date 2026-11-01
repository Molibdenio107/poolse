import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Put } from '@nestjs/common';
import { fieldsFor, isTemplateKind, parseBoletimPlacement, type BoletimPlacement, type TemplateKind } from '@poolse/rules';
import { WrongFileError } from '../files/attachments.repository.js';
import { CoreRoute } from '../tenant/modules.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireRole } from '../tenant/roles.js';
import { readTemplate, savePlacements, setTemplate, type BoletimTemplate } from './boletim-template.repository.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** More than any paper form has lines; a ceiling on the size of one save. */
const MAX_PLACEMENTS = 120;

function kindOf(raw: string): TemplateKind {
  if (!isTemplateKind(raw)) throw new NotFoundException({ code: 'no_such_kind', message: 'No such form' });
  return raw;
}

/**
 * A club's own forms — POOLSE-142: the boletim de sócio and the FPN's
 * declaration, adult and minor, on the site page's *Documentos* tab. Owner and
 * admin, as the rest of the club's settings. Core, as the student's documents.
 */
@CoreRoute()
@Controller('settings/document-templates/:kind')
export class DocumentTemplatesController {
  @Get()
  async read(@Param('kind') rawKind: string): Promise<{ template: BoletimTemplate | null }> {
    requireRole('owner', 'admin');
    return { template: await readTemplate(currentTenant().organizationId, kindOf(rawKind)) };
  }

  /** A new template (the old one and its placements are archived). */
  @Put()
  async set(@Param('kind') rawKind: string, @Body() body: Record<string, unknown>): Promise<{ saved: true }> {
    requireRole('owner', 'admin');
    const kind = kindOf(rawKind);
    const fileId = body['fileId'];
    if (typeof fileId !== 'string' || !UUID.test(fileId)) throw new BadRequestException('fileId must be a file id');
    try {
      await setTemplate(currentTenant().organizationId, kind, fileId);
    } catch (error) {
      if (error instanceof WrongFileError) throw new BadRequestException({ code: 'wrong_file', message: error.message });
      throw error;
    }
    return { saved: true };
  }

  /** Takes the template away: the print goes back to Poolse's own form. */
  @Delete()
  async remove(@Param('kind') rawKind: string): Promise<{ saved: true }> {
    requireRole('owner', 'admin');
    await setTemplate(currentTenant().organizationId, kindOf(rawKind), null);
    return { saved: true };
  }

  /** The placements, as a set — only fields this kind of form offers. */
  @Put('fields')
  async place(@Param('kind') rawKind: string, @Body() body: Record<string, unknown>): Promise<{ saved: true }> {
    requireRole('owner', 'admin');
    const kind = kindOf(rawKind);
    const offered = fieldsFor(kind);
    const raw = body['fields'];
    if (!Array.isArray(raw) || raw.length > MAX_PLACEMENTS) {
      throw new BadRequestException({ code: 'invalid_fields', message: `fields must be a list of at most ${MAX_PLACEMENTS}` });
    }
    const fields: BoletimPlacement[] = [];
    for (const item of raw) {
      const placement = parseBoletimPlacement(item);
      if (placement === null || !offered.has(placement.field)) {
        throw new BadRequestException({ code: 'invalid_fields', message: 'A placement is a field this form offers, on the page, 6–24 pt' });
      }
      fields.push(placement);
    }
    if (!(await savePlacements(currentTenant().organizationId, kind, fields))) {
      throw new NotFoundException({ code: 'no_template', message: 'The club has no such form' });
    }
    return { saved: true };
  }
}
