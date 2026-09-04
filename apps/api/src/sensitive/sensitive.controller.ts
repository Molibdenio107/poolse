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
  archiveMedicalLeave,
  createMedicalLeave,
  listMedicalLeave,
  type MedicalLeave,
} from '../students/medical-leave.repository.js';
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
  /** Every live leave for this student, newest first. */
  medicalLeave: MedicalLeave[];
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
 * Writing is owner and admin only.
 *
 * **Slice 1.12 revisited this and changed nothing, deliberately.** Narrowing the
 * read to an instructor's own turmas was considered and rejected on the argument
 * the paragraph above already makes: a child in the water with epilepsy is a
 * safety matter for whoever is standing at the poolside, and the person covering
 * a colleague's class at short notice is exactly who would be locked out. The
 * audit log is what makes that safe, and it is unconditional.
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
      // Travels with the medical page rather than behind its own request: it is
      // three rows, always shown, and a second round trip would put a loading
      // state on a panel that is usually empty.
      medicalLeave: await listMedicalLeave(organizationId, studentId),
    };
  }

  /**
   * Record a period a student cannot swim — round 5.
   *
   * Owner and admin, the same as every other write on this screen. An instructor
   * can *see* that a student is off — they have to, to take the register — but
   * deciding that a child is medically unable to swim for six weeks is not a
   * poolside call.
   *
   * The leave writes no attendance. It makes "falta justificada" the offered
   * mark from today forward; anything already marked stays exactly as the
   * instructor left it, and removing the leave simply stops the offer. That is
   * the round-5 decision, and it is why no reposição credit can ever be created
   * or destroyed by editing this.
   */
  @Post('medical-leave')
  async addLeave(
    @Param('studentId') studentId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const { organizationId, membershipId } = currentTenant();

    const startsOn = isoDate(body['startsOn'], 'startsOn', true);
    const endsOn = isoDate(body['endsOn'], 'endsOn', false);

    if (startsOn !== null && endsOn !== null && endsOn < startsOn) {
      throw new BadRequestException('endsOn is before startsOn');
    }

    const raw = typeof body['reason'] === 'string' ? body['reason'].trim() : '';
    if (raw.length > 200) {
      throw new BadRequestException('The reason may be at most 200 characters');
    }

    const reference =
      typeof body['justificationReference'] === 'string'
        ? body['justificationReference'].trim()
        : '';
    if (reference.length > 200) {
      throw new BadRequestException('The justification reference may be at most 200 characters');
    }

    try {
      return {
        id: await createMedicalLeave(organizationId, {
          studentId,
          startsOn: startsOn!,
          endsOn,
          reason: raw.length > 0 ? raw : null,
          justificationReference: reference.length > 0 ? reference : null,
          recordedBy: membershipId,
        }),
      };
    } catch (error) {
      /*
       * The one error this can raise, turned into a sentence.
       *
       * `23P01` is the exclusion constraint refusing a second live leave over
       * the same days. It is the only way this insert fails that an operator can
       * do anything about, and "already has leave covering those dates" is a
       * great deal more use than a 500 naming a constraint.
       */
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: string }).code === '23P01'
      ) {
        throw new ConflictException('This student already has leave covering those dates');
      }
      throw error;
    }
  }

  @Post('medical-leave/:leaveId/archive')
  async removeLeave(@Param('leaveId') leaveId: string): Promise<{ archived: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    if (!(await archiveMedicalLeave(organizationId, leaveId))) {
      throw new NotFoundException('No such medical leave');
    }
    return { archived: true };
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


/**
 * A plain `YYYY-MM-DD` from a form.
 *
 * Deliberately not `new Date(...)`: a date input posts a calendar day with no
 * time and no zone, and turning it into an instant here would shift it a day
 * backwards for anybody west of Greenwich. The column is a `date`, so the string
 * goes through as it arrived.
 */
function isoDate(value: unknown, field: string, required: boolean): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new BadRequestException(`${field} is required`);
    return null;
  }

  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new BadRequestException(`${field} must be a date`);
  }
  return text;
}
