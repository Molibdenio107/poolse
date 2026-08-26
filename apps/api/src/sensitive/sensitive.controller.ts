import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireRole } from '../tenant/roles.js';
import {
  ConsentAlreadyRecordedError,
  CONSENT_KINDS,
  listConsent,
  readSensitive,
  recordConsent,
  withdrawConsent,
  writeSensitive,
  type ConsentKind,
  type ConsentRecord,
  type SensitiveNotes,
} from './sensitive.repository.js';

interface SensitiveResponse {
  organizationId: string;
  notes: SensitiveNotes;
  consent: ConsentRecord[];
  kinds: ConsentKind[];
  canManage: boolean;
}

const MAX_NOTES = 4000;
const MAX_EVIDENCE = 500;

/**
 * Special-category data, behind its own routes and its own role check.
 *
 * **Who may read this, and why.** Owner, admin and instructor — and the
 * instructor is the deliberate part. A child in the water with epilepsy or a
 * severe allergy is a safety matter for the person standing at the poolside, not
 * for the office; withholding it from them would be the more dangerous choice.
 * What makes that safe rather than lax is the other half: every read is written
 * to the audit log with who did it, so access is accountable rather than merely
 * permitted.
 *
 * Everyone else in the organization — a receptionist, a maintenance technician,
 * a student or guardian account later — sees nothing here at all, while still
 * having ordinary access to the student register. That split is the entire
 * reason `student_sensitive` is a separate table.
 *
 * Writing is owner and admin only. Slice 1.12 revisits the role surface; this is
 * the shape to revisit from.
 */
@Controller('students/:studentId')
export class SensitiveController {
  @Get('sensitive')
  async read(@Param('studentId') studentId: string): Promise<SensitiveResponse> {
    requireRole('owner', 'admin', 'instructor');
    const { organizationId } = currentTenant();

    // The read itself is the audited event — see readSensitive.
    const notes = await readSensitive(organizationId, studentId);
    if (notes === null) throw new NotFoundException('No such student');

    return {
      organizationId,
      notes,
      consent: await listConsent(organizationId, studentId),
      kinds: CONSENT_KINDS,
      canManage: hasRole('owner', 'admin'),
    };
  }

  /**
   * PUT rather than PATCH: there is one field and sending it empty means
   * "there are no medical notes", which is a real and different statement from
   * "leave what is there alone". A PATCH shape would make clearing them
   * impossible to express.
   */
  @Put('sensitive')
  async write(
    @Param('studentId') studentId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ saved: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const raw = typeof body['medicalNotes'] === 'string' ? body['medicalNotes'].trim() : '';
    if (raw.length > MAX_NOTES) {
      throw new BadRequestException(`Medical notes may be at most ${MAX_NOTES} characters`);
    }

    if (!(await writeSensitive(organizationId, studentId, raw.length > 0 ? raw : null))) {
      throw new NotFoundException('No such student');
    }
    return { saved: true };
  }

  @Post('consent')
  async record(
    @Param('studentId') studentId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ recorded: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const kind = body['kind'];
    if (typeof kind !== 'string' || !CONSENT_KINDS.includes(kind as ConsentKind)) {
      throw new BadRequestException(`kind must be one of: ${CONSENT_KINDS.join(', ')}`);
    }
    if (typeof body['granted'] !== 'boolean') {
      throw new BadRequestException('granted must be true or false');
    }

    const evidence = typeof body['evidenceNote'] === 'string' ? body['evidenceNote'].trim() : '';
    if (evidence.length > MAX_EVIDENCE) {
      throw new BadRequestException(`Evidence may be at most ${MAX_EVIDENCE} characters`);
    }

    let recorded: boolean;
    try {
      recorded = await recordConsent(
        organizationId,
        studentId,
        kind as ConsentKind,
        body['granted'],
        evidence.length > 0 ? evidence : null,
      );
    } catch (error) {
      if (error instanceof ConsentAlreadyRecordedError) {
        // Not an edit conflict — a deliberate refusal. Correcting a consent
        // record means withdrawing it and recording a new decision, so that both
        // facts survive.
        throw new ConflictException(
          `A live ${error.message} decision already exists. Withdraw it before recording a new one.`,
        );
      }
      throw error;
    }

    if (!recorded) throw new NotFoundException('No such student');
    return { recorded: true };
  }

  @Post('consent/:consentId/withdraw')
  async withdraw(
    @Param('studentId') studentId: string,
    @Param('consentId') consentId: string,
  ): Promise<{ withdrawn: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    if (!(await withdrawConsent(organizationId, studentId, consentId))) {
      throw new NotFoundException('No live consent record with that id');
    }
    return { withdrawn: true };
  }
}
