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
import { deliverLabAlert } from './alert-delivery.js';
import {
  LAB_PARAMETERS,
  archiveLabResult,
  createLabResult,
  listLabResults,
  type LabParameter,
  type LabResult,
  type LabResultInput,
} from './lab-results.repository.js';
import { SampleInFutureError, sampleMoment } from './sample-moment.js';
import { PoolseModule } from '../tenant/modules.js';

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
export function parseLabResult(body: Record<string, unknown>): LabResultInput {
  // Shape only: the instant, and "not in the future", are resolved in the
  // facility's timezone by `resolveSample` (13-10-2026 sweep).
  const sampledAt = sampleMoment(body['sampledAt']);
  if (sampledAt === null) {
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
@PoolseModule('water_quality')
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
    let created: Awaited<ReturnType<typeof createLabResult>>;
    try {
      created = await createLabResult(organizationId, poolId, input, membershipId);
    } catch (error) {
      if (error instanceof SampleInFutureError) {
        throw field('sampledAt', 'sampledAt is in the future');
      }
      throw error;
    }
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

  /** Sends after the commit; `deliverLabAlert` never throws. */
  private async notify(organizationId: string, alertId: string): Promise<void> {
    // POOLSE-86: one function, shared with the hourly retry.
    await deliverLabAlert(organizationId, alertId);
  }
}
