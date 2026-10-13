import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireRole } from '../tenant/roles.js';
import { sendEmail } from '../notifications/notifier.js';
import { labAlertEmail } from '../notifications/lab-alert-email.js';
import {
  LAB_PARAMETERS,
  archiveLabResult,
  createLabResult,
  findLabAlertNotice,
  listLabResults,
  markLabAlertSent,
  type LabParameter,
  type LabResult,
  type LabResultInput,
} from './lab-results.repository.js';

/** The people who record analyses record lab results — POOLSE-72. */
const CAN_RECORD_LAB = ['owner', 'admin', 'maintenance'] as const;
/** Archiving stays with management, as archiving an analysis does. */
const CAN_ARCHIVE_LAB = ['owner', 'admin'] as const;

function field(key: string, message: string): BadRequestException {
  return new BadRequestException({ code: 'invalid', message, fields: { [key]: `labResults.${key}Invalid` } });
}

function optionalText(value: unknown, key: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw field(key, `${key} must be text`);
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > max) throw field(key, `${key} is too long`);
  return trimmed;
}

/** The body as a report, or a 400 naming the box that is wrong. */
export function parseLabResult(body: Record<string, unknown>, now: Date = new Date()): LabResultInput {
  const raw = body['sampledAt'];
  const sampledAt = typeof raw === 'string' ? new Date(raw.trim()) : new Date(Number.NaN);
  // A sample cannot have been taken tomorrow; a minute of slack for a client clock.
  if (Number.isNaN(sampledAt.getTime()) || sampledAt.getTime() > now.getTime() + 60_000
      || sampledAt.getUTCFullYear() < 2000) {
    throw field('sampledAt', 'sampledAt is not a valid past date and time');
  }

  const depth = body['sampleDepth'];
  if (depth !== undefined && depth !== null && depth !== '' && depth !== 'surface' && depth !== 'subsurface') {
    throw field('sampleDepth', 'sampleDepth is surface or subsurface');
  }

  const values: { parameter: LabParameter; value: number }[] = [];
  const seen = new Set<string>();
  const rawValues = Array.isArray(body['values']) ? body['values'] : [];
  for (const entry of rawValues as Record<string, unknown>[]) {
    const parameter = entry?.['parameter'];
    const value = entry?.['value'];
    if (value === '' || value === null || value === undefined) continue;
    if (typeof parameter !== 'string' || !(LAB_PARAMETERS as readonly string[]).includes(parameter)) {
      throw field('values', `Unknown parameter: ${String(parameter)}`);
    }
    const number = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
    if (!Number.isFinite(number) || number < 0) {
      throw new BadRequestException({
        code: 'invalid',
        message: `${parameter} must be a number of zero or more`,
        fields: { [parameter]: 'labResults.valueInvalid' },
      });
    }
    if (parameter === 'ph' && number > 14) {
      throw new BadRequestException({
        code: 'invalid', message: 'pH is between 0 and 14', fields: { ph: 'labResults.valueInvalid' },
      });
    }
    if (seen.has(parameter)) throw field('values', `${parameter} was sent twice`);
    seen.add(parameter);
    values.push({ parameter: parameter as LabParameter, value: number });
  }
  if (values.length === 0) {
    throw field('values', 'A lab result needs at least one value');
  }

  return {
    sampledAt,
    laboratory: optionalText(body['laboratory'], 'laboratory', 200),
    reportReference: optionalText(body['reportReference'], 'reportReference', 100),
    samplePoint: optionalText(body['samplePoint'], 'samplePoint', 100),
    sampleDepth: depth === 'surface' || depth === 'subsurface' ? depth : null,
    notes: optionalText(body['notes'], 'notes', 2000),
    values,
  };
}

/**
 * Laboratory results on one tank — POOLSE-72. Graded on every read by
 * `gradeLabResult()`; a não conforme result alerts owner, admin and
 * maintenance after the commit, exactly as a water analysis does.
 */
@Controller('facilities/pools/:poolId/lab-results')
export class LabResultsController {
  private readonly logger = new Logger(LabResultsController.name);

  @Get()
  async list(@Param('poolId', new ParseUUIDPipe()) poolId: string): Promise<{ results: LabResult[] }> {
    requireRole(...CAN_RECORD_LAB);
    return { results: await listLabResults(currentTenant().organizationId, poolId) };
  }

  @Post()
  async record(
    @Param('poolId', new ParseUUIDPipe()) poolId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    requireRole(...CAN_RECORD_LAB);
    const { organizationId, membershipId } = currentTenant();
    const input = parseLabResult(body);
    const created = await createLabResult(organizationId, poolId, input, membershipId);
    if (created === null) throw new NotFoundException('No such pool');

    // After the commit, and unable to undo it.
    if (created.alertId !== null) await this.notify(organizationId, created.alertId);
    return { id: created.id };
  }

  @Post(':labResultId/archive')
  async archive(
    @Param('poolId', new ParseUUIDPipe()) poolId: string,
    @Param('labResultId', new ParseUUIDPipe()) labResultId: string,
  ): Promise<{ archived: true }> {
    requireRole(...CAN_ARCHIVE_LAB);
    const archived = await archiveLabResult(currentTenant().organizationId, poolId, labResultId);
    if (!archived) throw new NotFoundException();
    return { archived: true };
  }

  /** One message per recipient; `sendEmail` never throws and this catches the rest. */
  private async notify(organizationId: string, alertId: string): Promise<void> {
    try {
      const notice = await findLabAlertNotice(organizationId, alertId);
      if (notice === null) return;
      let delivered = false;
      for (const to of notice.recipients) {
        const sent = await sendEmail(
          labAlertEmail({
            to,
            organizationName: notice.organizationName,
            facilityName: notice.facilityName,
            poolName: notice.poolName,
            sampledAt: notice.sampledAt,
            timezone: notice.facilityTimezone,
            laboratory: notice.laboratory,
            failures: notice.grading.failures,
            locale: notice.organizationLocale,
          }),
        );
        delivered = delivered || sent;
      }
      await markLabAlertSent(organizationId, alertId, notice.recipients, delivered);
    } catch (error) {
      this.logger.warn(`Could not send lab alert ${alertId}: ${String(error)}`);
    }
  }
}
