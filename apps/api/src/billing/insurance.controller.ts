import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireRole } from '../tenant/roles.js';
import {
  archivePolicy,
  createPolicy,
  listPolicies,
  updatePolicy,
  DuplicatePolicyNumberError,
  PolicyInUseError,
  type InsurancePolicy,
  type InsurancePolicyInput,
} from './insurance.repository.js';

/**
 * The apólices a facility holds.
 *
 * **Owner and Admin, reading as well as writing**, exactly as the price list
 * beside it: what the club pays its insurer is a commercial fact, and an
 * instructor has no more business with it than with a family's negotiated
 * mensalidade. The rule is enforced here rather than by the panel not rendering.
 *
 * Under `/facilities/:facilityId/…` because a policy is bought by a site. A
 * policy addressed through the wrong facility answers 404 rather than 403: that
 * a resource exists at another site is not something an error should confirm.
 */
@Controller('facilities/:facilityId/insurance-policies')
export class InsurancePoliciesController {
  @Get()
  async list(
    @Param('facilityId') facilityId: string,
  ): Promise<{ policies: InsurancePolicy[] }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();
    return { policies: await listPolicies(organizationId, facilityId) };
  }

  @Post()
  async create(
    @Param('facilityId') facilityId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    try {
      return { id: await createPolicy(organizationId, facilityId, readPolicy(body)) };
    } catch (error) {
      refuseDuplicate(error);
    }
  }

  @Patch(':id')
  async update(
    @Param('facilityId') facilityId: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ updated: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    try {
      if (!(await updatePolicy(organizationId, facilityId, id, readPolicy(body)))) {
        throw new BadRequestException('No such policy');
      }
    } catch (error) {
      refuseDuplicate(error);
    }
    return { updated: true };
  }

  @Post(':id/archive')
  async archive(
    @Param('facilityId') facilityId: string,
    @Param('id') id: string,
  ): Promise<{ archived: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    try {
      if (!(await archivePolicy(organizationId, facilityId, id))) {
        throw new BadRequestException('No such policy');
      }
    } catch (error) {
      /*
       * The figure travels as a field, not inside a sentence.
       *
       * Same family as the trigger refusals: the API answers with the number and
       * the screen composes the words where the locale is, so "3 alunos estão
       * cobertos por esta apólice" and its English twin are one translation
       * entry rather than two strings built in TypeScript.
       */
      if (error instanceof PolicyInUseError) {
        throw new ConflictException({
          code: 'insurance_policy_in_use',
          message: 'Students are still covered by this policy',
          values: { count: error.coveredCount },
        });
      }
      throw error;
    }
    return { archived: true };
  }
}

/** The club already has a policy under that number, which is a 409 not a 400. */
function refuseDuplicate(error: unknown): never {
  if (error instanceof DuplicatePolicyNumberError) {
    throw new ConflictException({
      code: 'insurance_policy_exists',
      message: 'That policy number is already recorded',
      fields: { policyNumber: 'insurance.numberExists' },
    });
  }
  throw error;
}

const MAX_TEXT = 120;
const MAX_NOTES = 2000;

/**
 * An apólice, checked here as well as by the table.
 *
 * The dates are the pair worth the words: a policy that expires before it starts
 * is refused by a CHECK, and an operator reading "insurance_policy_dates_ordered"
 * learns nothing. Named here so the message can point at the field that is wrong.
 */
function readPolicy(body: Record<string, unknown>): InsurancePolicyInput {
  const validFrom = readDate(body['validFrom'], 'validFrom');
  const validTo = readDate(body['validTo'], 'validTo');

  if (validTo < validFrom) {
    throw new BadRequestException({
      code: 'dates_out_of_order',
      message: 'A policy cannot end before it starts',
      fields: { validTo: 'insurance.datesOutOfOrder' },
    });
  }

  const notes = typeof body['notes'] === 'string' ? body['notes'].trim() : '';
  if (notes.length > MAX_NOTES) {
    throw new BadRequestException(`notes may be at most ${MAX_NOTES} characters`);
  }

  return {
    insurer: text(body['insurer'], 'insurer'),
    policyNumber: text(body['policyNumber'], 'policyNumber'),
    validFrom,
    validTo,
    costPerPersonCents: cents(body['costPerPersonCents'], 'costPerPersonCents'),
    notes: notes === '' ? null : notes,
  };
}

function text(value: unknown, field: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed === '') {
    throw new BadRequestException({
      code: `${field}_required`,
      message: `${field} is required`,
      fields: { [field]: `insurance.${field}Required` },
    });
  }
  if (trimmed.length > MAX_TEXT) {
    throw new BadRequestException(`${field} may be at most ${MAX_TEXT} characters`);
  }
  return trimmed;
}

/** An ISO day, kept as text: a `date` parsed into a Date is a day early in UTC. */
function readDate(value: unknown, field: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new BadRequestException({
      code: `${field}_required`,
      message: `${field} must be a date`,
      fields: { [field]: `insurance.${field}Required` },
    });
  }
  return trimmed;
}

function cents(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BadRequestException(`${field} must be a whole number of cents, zero or more`);
  }
  return parsed;
}
