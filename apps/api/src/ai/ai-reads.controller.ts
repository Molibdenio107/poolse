import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { isAiReader, type AiReader, type PoolseModule } from '@poolse/rules';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireRole, type MemberRole } from '../tenant/roles.js';
import { CoreRoute, moduleIsOn } from '../tenant/modules.js';
import { AiClaimRefusedError, claimRead, finishRead } from './ai-reads.repository.js';

/**
 * Who may spend each reader's calls — the roles of the endpoint its result is
 * written through, so this and the web app's `AI_ROLES` agree. The PDF table
 * reader serves every list importer that takes a PDF, so it is their union.
 */
const READER_ROLES: Record<AiReader, readonly MemberRole[]> = {
  energy_invoice: ['owner', 'admin', 'maintenance'],
  id_document: ['owner', 'admin'],
  water_report: ['owner', 'admin'],
  pdf_table: ['owner', 'admin', 'maintenance', 'instructor'],
  column_match: ['owner', 'admin'],
  // POOLSE-142: whoever may place the boletim's fields.
  boletim_template: ['owner', 'admin'],
  // POOLSE-149: whoever may record a qualification.
  qualification_certificate: ['owner', 'admin'],
};

/**
 * The module whose screen a reader serves, where it serves one. A module the
 * club has switched off hides and refuses (POOLSE-87), so its reader must not
 * spend a call whose result could not be saved. The ID, PDF table and column
 * readers serve core screens.
 */
const READER_MODULE: Partial<Record<AiReader, PoolseModule>> = {
  energy_invoice: 'energy',
  water_report: 'water_quality',
  qualification_certificate: 'qualifications',
};

/** Large enough for any one call; a figure past it is a bug or a lie. */
const MAX_TOKENS = 10_000_000;

function readTokens(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > MAX_TOKENS) {
    throw new BadRequestException({ fields: { tokens: 'ai.error.tokens' } });
  }
  return raw;
}

/**
 * The meter on the AI readers — POOLSE-137. The web app claims before every
 * model call and finishes after it; a claim refused is a call never made.
 */
@CoreRoute()
@Controller('ai-reads')
export class AiReadsController {
  @Post('claim')
  async claim(@Body() body: { reader?: unknown }): Promise<{ id: string }> {
    if (!isAiReader(body.reader)) throw new BadRequestException({ fields: { reader: 'ai.error.reader' } });
    const reader = body.reader;
    requireRole(...READER_ROLES[reader]);
    const module = READER_MODULE[reader];
    if (module !== undefined && !moduleIsOn(module)) {
      throw new ForbiddenException({ code: 'module_disabled', module });
    }
    const { organizationId } = currentTenant();
    try {
      return await claimRead(organizationId, reader);
    } catch (error) {
      if (error instanceof AiClaimRefusedError) throw new ConflictException({ code: error.code });
      throw error;
    }
  }

  @Post(':id/finish')
  async finish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { succeeded?: unknown; model?: unknown; inputTokens?: unknown; outputTokens?: unknown },
  ): Promise<{ finished: true }> {
    // Anybody who may claim some reader may finish; the row is this club's by
    // RLS and is filled once, so the worst a wrong role can do is nothing.
    requireRole(...new Set(Object.values(READER_ROLES).flat()));
    const { organizationId } = currentTenant();
    const model = typeof body.model === 'string' && body.model.length <= 100 ? body.model : null;
    const done = await finishRead(organizationId, id, {
      succeeded: body.succeeded === true,
      model,
      inputTokens: readTokens(body.inputTokens),
      outputTokens: readTokens(body.outputTokens),
    });
    if (!done) throw new NotFoundException('No such open read');
    return { finished: true };
  }
}
