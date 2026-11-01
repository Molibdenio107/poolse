import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Put } from '@nestjs/common';
import { parseBoletimPlacement, type BoletimPlacement } from '@poolse/rules';
import { WrongFileError } from '../files/attachments.repository.js';
import { CoreRoute } from '../tenant/modules.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireRole } from '../tenant/roles.js';
import { readTemplate, savePlacements, setTemplate, type BoletimTemplate } from './boletim-template.repository.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** More than any paper form has lines; a ceiling on the size of one save. */
const MAX_PLACEMENTS = 120;

/**
 * The club's own boletim de sócio — POOLSE-142. Configured on *Dados do
 * clube*, so owner and admin, as the rest of that tab. Core, as the boletim is.
 */
@CoreRoute()
@Controller('settings/boletim-template')
export class BoletimTemplateController {
  @Get()
  async read(): Promise<{ template: BoletimTemplate | null }> {
    requireRole('owner', 'admin');
    return { template: await readTemplate(currentTenant().organizationId) };
  }

  /** A new template (the old one and its placements are archived). */
  @Put()
  async set(@Body() body: Record<string, unknown>): Promise<{ saved: true }> {
    requireRole('owner', 'admin');
    const fileId = body['fileId'];
    if (typeof fileId !== 'string' || !UUID.test(fileId)) throw new BadRequestException('fileId must be a file id');
    try {
      await setTemplate(currentTenant().organizationId, fileId);
    } catch (error) {
      if (error instanceof WrongFileError) throw new BadRequestException({ code: 'wrong_file', message: error.message });
      throw error;
    }
    return { saved: true };
  }

  /** Takes the template away: the print goes back to Poolse's own boletim. */
  @Delete()
  async remove(): Promise<{ saved: true }> {
    requireRole('owner', 'admin');
    await setTemplate(currentTenant().organizationId, null);
    return { saved: true };
  }

  /** The placements, as a set. */
  @Put('fields')
  async place(@Body() body: Record<string, unknown>): Promise<{ saved: true }> {
    requireRole('owner', 'admin');
    const raw = body['fields'];
    if (!Array.isArray(raw) || raw.length > MAX_PLACEMENTS) {
      throw new BadRequestException({ code: 'invalid_fields', message: `fields must be a list of at most ${MAX_PLACEMENTS}` });
    }
    const fields: BoletimPlacement[] = [];
    for (const item of raw) {
      const placement = parseBoletimPlacement(item);
      if (placement === null) {
        throw new BadRequestException({ code: 'invalid_fields', message: 'A placement is a known field, on the page, 6–24 pt' });
      }
      fields.push(placement);
    }
    if (!(await savePlacements(currentTenant().organizationId, fields))) {
      throw new NotFoundException({ code: 'no_template', message: 'The club has no boletim template' });
    }
    return { saved: true };
  }
}
