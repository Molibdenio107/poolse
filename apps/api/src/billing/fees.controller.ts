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
  archiveFeePeriod,
  archiveFeePlan,
  archiveStudentFee,
  createFeePeriod,
  createFeePlan,
  createStudentFee,
  listFeePeriods,
  listFeePlans,
  billingSettings,
  repriceStudentFee,
  setBillingSettings,
  markFeePaid,
  setSocio,
  setStudentPaid,
  studentFees,
  updateFeePeriod,
  updateFeePlan,
  updateStudentFee,
  DuplicateFeePlanError,
  DuplicateSocioNumberError,
  type BillingSettings,
  type FeeAgeBand,
  type FeeKind,
  type FeePenaltyKind,
  type FeeRecurrence,
  type FeePeriod,
  type FeePlan,
  type StudentFees,
} from './fees.repository.js';

/**
 * The price list already answers this — round 5, 3.1.
 *
 * A 409 rather than a 400: nothing about the request is malformed, and the same
 * body would have been accepted a moment before somebody else saved. The `code`
 * is stable so the form can translate it; the prose is for a caller that is not
 * our own screen.
 *
 * Both constraints get their own field hint, because they are two different
 * things to fix — a mensalidade collides on level and lessons per week, a quota
 * on its age band, and pointing at the wrong control is worse than pointing at
 * none.
 *
 * **One field named per case, not two.** The mensalidade collision is really
 * about the pair, but the prices panel renders `fields` by joining their
 * translated values into a single line — so naming both the level and the
 * frequency with the same key prints the sentence twice. The sentence already
 * says "this level and periodicity"; the control it hangs on is the level.
 */
function refuseDuplicatePlan(error: unknown): never {
  if (error instanceof DuplicateFeePlanError) {
    throw new ConflictException(DUPLICATE_PLAN[error.which]);
  }
  throw error;
}

/**
 * One sentence per constraint, and each names the control that fixes it.
 *
 * A mensalidade collides on level and frequency, a quota on its age band, and an
 * inscrição or a seguro on the season — four different things to correct, and
 * pointing at the wrong control is worse than pointing at none. The season one
 * has to say *which* of the two inscrição prices is taken, because a club that
 * already has a joining price and is adding a renovação has done nothing wrong.
 */
const DUPLICATE_PLAN: Record<
  FeeKind,
  { code: string; message: string; fields: Record<string, string> }
> = {
  mensalidade: {
    code: 'fee_plan_exists',
    message: 'A price for this level and periodicity already exists',
    fields: { levelId: 'fees.planExists' },
  },
  quota: {
    code: 'fee_plan_quota_exists',
    message: 'A membership fee already exists for that age band',
    fields: { ageBand: 'fees.planQuotaExists' },
  },
  inscricao: {
    code: 'fee_plan_inscricao_exists',
    message: 'That season already has this joining price',
    fields: { seasonId: 'fees.planInscricaoExists' },
  },
  seguro: {
    code: 'fee_plan_seguro_exists',
    message: 'That season already has an insurance price',
    fields: { seasonId: 'fees.planSeguroExists' },
  },
};

/**
 * The price list and what a student pays — POOLSE-42.
 *
 * **Owner and Admin, for reading as well as writing.** An instructor teaching a
 * turma has no business knowing what each child's family negotiated, and AC10
 * says so; the rule is enforced here rather than by the screen not rendering the
 * block. Students and guardians reading their own fees is phase 3 — denied for
 * now rather than half-built.
 *
 * Prices hang off the facility because that is where the agreement lives, so
 * these sit under `/facilities/:facilityId/…`. A plan or a period addressed
 * through the wrong facility answers 404 and not 403: whether a resource exists
 * at another site is not something an error should confirm.
 */
@Controller('facilities/:facilityId/fee-periods')
export class FeePeriodsController {
  @Get()
  async list(@Param('facilityId') facilityId: string): Promise<{ periods: FeePeriod[] }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();
    return { periods: await listFeePeriods(organizationId, facilityId) };
  }

  @Post()
  async create(
    @Param('facilityId') facilityId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();
    return { id: await createFeePeriod(organizationId, facilityId, readPeriod(body)) };
  }

  @Patch(':id')
  async update(
    @Param('facilityId') facilityId: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ updated: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    if (!(await updateFeePeriod(organizationId, facilityId, id, readPeriod(body)))) {
      throw new BadRequestException('No such periodicity');
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

    if (!(await archiveFeePeriod(organizationId, facilityId, id))) {
      throw new BadRequestException('No such periodicity');
    }
    return { archived: true };
  }
}

@Controller('facilities/:facilityId/fee-plans')
export class FeePlansController {
  @Get()
  async list(@Param('facilityId') facilityId: string): Promise<{ plans: FeePlan[] }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();
    return { plans: await listFeePlans(organizationId, facilityId) };
  }

  @Post()
  async create(
    @Param('facilityId') facilityId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    try {
      return { id: await createFeePlan(organizationId, facilityId, readPlan(body)) };
    } catch (error) {
      refuseDuplicatePlan(error);
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
      if (!(await updateFeePlan(organizationId, facilityId, id, readPlan(body)))) {
        throw new BadRequestException('No such plan');
      }
    } catch (error) {
      refuseDuplicatePlan(error);
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

    if (!(await archiveFeePlan(organizationId, facilityId, id))) {
      throw new BadRequestException('No such plan');
    }
    return { archived: true };
  }
}

@Controller('students/:studentId/fees')
export class StudentFeesController {
  @Get()
  async list(@Param('studentId') studentId: string): Promise<StudentFees> {
    // Reading, not only writing. What a family pays is not something the
    // instructor who teaches them is entitled to see — AC10.
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();
    return studentFees(organizationId, studentId);
  }

  @Post()
  async create(
    @Param('studentId') studentId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ created: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const outcome = await createStudentFee(organizationId, studentId, {
      feePlanId: requiredId(body['feePlanId'], 'feePlanId'),
      feePeriodId: requiredId(body['feePeriodId'], 'feePeriodId'),
      enrollmentId: optionalId(body['enrollmentId']),
      ...readManualDiscount(body),
      startsOn: optionalDate(body['startsOn'], 'startsOn'),
    });

    // The insert selects from the plan and the period; no rows means one of them
    // is not this club's, is archived, or belongs to another site.
    if (outcome === 'not_found') throw new BadRequestException('No such plan or periodicity');
    return { created: true };
  }

  @Patch(':id')
  async update(
    @Param('studentId') studentId: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ updated: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const changed = await updateStudentFee(organizationId, studentId, id, {
      feePeriodId: requiredId(body['feePeriodId'], 'feePeriodId'),
      ...readManualDiscount(body),
      endsOn: optionalDate(body['endsOn'], 'endsOn'),
    });
    if (!changed) throw new BadRequestException('No such fee line');
    return { updated: true };
  }

  @Post(':id/reprice')
  async reprice(
    @Param('studentId') studentId: string,
    @Param('id') id: string,
  ): Promise<{ repriced: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    if (!(await repriceStudentFee(organizationId, studentId, id))) {
      throw new BadRequestException('No such fee line');
    }
    return { repriced: true };
  }

  /**
   * Pago — the one action on this screen an office does every period.
   *
   * Its own endpoint rather than a field on the edit form, so marking a payment
   * is one click rather than opening and saving an agreement.
   */
  @Post(':id/paid')
  async paid(
    @Param('studentId') studentId: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ updated: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const periodStart = optionalDate(body['periodStart'], 'periodStart');
    if (periodStart === null) {
      throw new BadRequestException('periodStart is required — which occurrence is this');
    }

    const marked = await markFeePaid(
      organizationId,
      studentId,
      id,
      periodStart,
      body['isPaid'] === true,
      optionalDate(body['paidOn'], 'paidOn'),
    );
    if (!marked) throw new BadRequestException('No such fee line');
    return { updated: true };
  }

  @Post(':id/archive')
  async archive(
    @Param('studentId') studentId: string,
    @Param('id') id: string,
  ): Promise<{ archived: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    if (!(await archiveStudentFee(organizationId, studentId, id))) {
      throw new BadRequestException('No such fee line');
    }
    return { archived: true };
  }
}

/**
 * Everything this student currently owes, settled in one call.
 *
 * What the tick on the register means. Its own controller because it is about
 * the student rather than about one line, and because the register calls it
 * without knowing what lines exist.
 */
@Controller('students/:studentId/paid')
export class StudentPaidController {
  @Post()
  async mark(
    @Param('studentId') studentId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ lines: number }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    return { lines: await setStudentPaid(organizationId, studentId, body['isPaid'] === true) };
  }
}

@Controller('facilities/:facilityId/billing')
export class FacilityBillingController {
  @Get()
  async read(@Param('facilityId') facilityId: string): Promise<BillingSettings> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const settings = await billingSettings(organizationId, facilityId);
    if (settings === null) throw new BadRequestException('No such facility');
    return settings;
  }

  @Patch()
  async update(
    @Param('facilityId') facilityId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ updated: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const day = Number(body['paymentDueDay']);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      throw new BadRequestException({
        code: 'due_day',
        message: 'The due day is a day of the month',
        fields: { paymentDueDay: 'fees.dueDayRange' },
      });
    }

    const changed = await setBillingSettings(organizationId, facilityId, {
      paymentDueDay: day,
      latePenaltyKind: readPenaltyKind(body['latePenaltyKind'], 'latePenaltyKind'),
      latePenaltyCents: cents(body['latePenaltyCents'] ?? 0, 'latePenaltyCents'),
      latePenaltyPercent: rate(body['latePenaltyPercent'], 'latePenaltyPercent') ?? 0,
      quotaPenaltyKind: readPenaltyKind(body['quotaPenaltyKind'], 'quotaPenaltyKind'),
      quotaPenaltyCents: cents(body['quotaPenaltyCents'] ?? 0, 'quotaPenaltyCents'),
      quotaPenaltyPercent: rate(body['quotaPenaltyPercent'], 'quotaPenaltyPercent') ?? 0,
    });
    if (!changed) throw new BadRequestException('No such facility');
    return { updated: true };
  }
}

@Controller('students/:studentId/socio')
export class StudentSocioController {
  @Patch()
  async update(
    @Param('studentId') studentId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ updated: true; quotaAdded: boolean; quotaUnavailable: boolean }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    let result;
    try {
      result = await setSocio(organizationId, studentId, {
        isSocio: body['isSocio'] === true,
        socioNumber: optionalText(body['socioNumber'], 'socioNumber', 40),
        socioSince: optionalDate(body['socioSince'], 'socioSince'),
      });
    } catch (error) {
      // A number identifies one member. Named as a field error so the form can
      // put the sentence beside the box rather than at the top of the card.
      if (error instanceof DuplicateSocioNumberError) {
        throw new BadRequestException({
          code: 'socio_number_taken',
          message: 'Another student already holds that membership number',
          fields: { socioNumber: 'fees.socioNumberTaken' },
        });
      }
      throw error;
    }
    if (!result.updated) throw new BadRequestException('No such student');

    // Reported rather than silent: the screen says whether a quota was attached,
    // and says so when the club has none to attach.
    return {
      updated: true,
      quotaAdded: result.quotaAdded,
      quotaUnavailable: result.quotaUnavailable,
    };
  }
}

// ---------------------------------------------------------------------------
// Reading a request
// ---------------------------------------------------------------------------

const MAX_NAME = 120;
const MAX_REASON = 500;

function requiredText(value: unknown, field: string, max: number): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed === '') throw new BadRequestException(`${field} is required`);
  if (trimmed.length > max) {
    throw new BadRequestException(`${field} may be at most ${max} characters`);
  }
  return trimmed;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed === '') return null;
  if (trimmed.length > max) {
    throw new BadRequestException(`${field} may be at most ${max} characters`);
  }
  return trimmed;
}

function requiredId(value: unknown, field: string): string {
  return requiredText(value, field, 64);
}

function optionalId(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed === '' ? null : trimmed;
}

function optionalDate(value: unknown, field: string): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (raw === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new BadRequestException(`${field} must be a date, as YYYY-MM-DD`);
  }
  return raw;
}

/**
 * Cents, as an integer.
 *
 * Refused rather than rounded when it is not whole. A caller sending 3500.5 has
 * a bug, and quietly picking one of the two adjacent cents for them hides it
 * somewhere it will be found by a parent instead.
 */
function cents(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BadRequestException(`${field} must be a whole number of cents, zero or more`);
  }
  return parsed;
}

/** A rate between 0 and 100, to two decimals. Null where the field is absent. */
function rate(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null;

  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new BadRequestException(`${field} must be a percentage between 0 and 100`);
  }
  return Math.round(parsed * 100) / 100;
}

function readPeriod(body: Record<string, unknown>): {
  name: string;
  months: number;
  discountPercent: number;
  isDefault: boolean;
  sortOrder: number;
} {
  const months = Number(body['months']);
  if (!Number.isInteger(months) || months < 1 || months > 24) {
    throw new BadRequestException('months must be a whole number between 1 and 24');
  }

  return {
    name: requiredText(body['name'], 'name', MAX_NAME),
    months,
    discountPercent: rate(body['discountPercent'], 'discountPercent') ?? 0,
    isDefault: body['isDefault'] === true,
    sortOrder: Number.isInteger(body['sortOrder']) ? (body['sortOrder'] as number) : 0,
  };
}

const KINDS: FeeKind[] = ['mensalidade', 'inscricao', 'seguro', 'quota'];

function isFeeKind(value: unknown): value is FeeKind {
  return KINDS.includes(value as FeeKind);
}

/**
 * What a plan of each kind must and must not carry.
 *
 * The table says all of this too. It is said here as well so an operator gets a
 * sentence naming the box to fill rather than the name of a constraint — and
 * because the API is where the *defaults* live: an inscrição that arrives with
 * no recurrence is one-off, which is what every club means by it, rather than a
 * 400 asking somebody to restate the obvious.
 */
function readPlan(body: Record<string, unknown>): {
  kind: FeeKind;
  recurrence: FeeRecurrence;
  levelId: string | null;
  lessonsPerWeek: number | null;
  amountCents: number;
  defaultFeePeriodId: string | null;
  ageBand: FeeAgeBand;
  vatRate: number;
  vatExempt: boolean;
  seasonId: string | null;
  isRenewal: boolean;
} {
  const kind = body['kind'];
  if (!isFeeKind(kind)) {
    throw new BadRequestException(`kind must be one of ${KINDS.join(', ')}`);
  }

  const levelId = optionalId(body['levelId']);
  const raw = body['lessonsPerWeek'];
  const lessons =
    raw === undefined || raw === null || raw === '' ? null : Number(raw);

  const seasonId = optionalId(body['seasonId']);
  const seasonScoped = kind === 'inscricao' || kind === 'seguro';

  if (seasonScoped && seasonId === null) {
    throw new BadRequestException({
      code: 'season_required',
      message: 'An inscrição and a seguro belong to a season',
      fields: { seasonId: 'fees.seasonRequired' },
    });
  }

  const recurrence = readRecurrence(body['recurrence'], kind);

  if (kind === 'mensalidade') {
    if (levelId === null) {
      throw new BadRequestException({
        code: 'level_required',
        message: 'A mensalidade is a price for a level',
        fields: { levelId: 'fees.levelRequired' },
      });
    }
    if (lessons === null || !Number.isInteger(lessons) || lessons < 1 || lessons > 7) {
      throw new BadRequestException({
        code: 'lessons_required',
        message: 'A mensalidade is a price for a number of lessons a week',
        fields: { lessonsPerWeek: 'fees.lessonsRequired' },
      });
    }
  }

  const vatExempt = body['vatExempt'] === true;

  return {
    kind,
    recurrence,
    // Only a mensalidade is priced by a place in the timetable, whatever the
    // client sent — the table refuses the other shape and this is what keeps
    // the message readable.
    levelId: kind === 'mensalidade' ? levelId : null,
    lessonsPerWeek: kind === 'mensalidade' ? lessons : null,
    amountCents: cents(body['amountCents'], 'amountCents'),
    // A periodicity belongs to a plan that is charged by one. An annual or a
    // one-off price naming a three-month period is a pair something would read.
    defaultFeePeriodId:
      recurrence === 'periodicity' ? optionalId(body['defaultFeePeriodId']) : null,
    // A mensalidade is banded by its level, which says it better than a birth
    // date does. The table refuses anything else on one.
    ageBand: kind === 'quota' ? readBand(body['ageBand']) : 'any',
    // Isento is zero, said out loud. A rate kept beside an exemption would be a
    // number nobody charged, sitting where invoicing will look for one.
    vatRate: vatExempt ? 0 : (rate(body['vatRate'], 'vatRate') ?? 0),
    vatExempt,
    seasonId: seasonScoped ? seasonId : null,
    // Renovação is a second inscrição price and means nothing anywhere else.
    isRenewal: kind === 'inscricao' && body['isRenewal'] === true,
  };
}

/**
 * How often this price is charged, defaulted to what its kind usually means.
 *
 * The default is here rather than in the database because it is a product
 * opinion, not a rule: a club is free to make its quota annual or monthly, and
 * the column exists precisely so it can. What the schema enforces is the pair
 * that cannot both be true — a periodicity on a price that does not recur by one.
 */
function readRecurrence(value: unknown, kind: FeeKind): FeeRecurrence {
  if (value === 'periodicity' || value === 'annual' || value === 'one_off') return value;
  if (value !== undefined && value !== null && value !== '') {
    throw new BadRequestException('recurrence must be periodicity, annual or one_off');
  }
  if (kind === 'inscricao') return 'one_off';
  if (kind === 'seguro') return 'annual';
  return 'periodicity';
}

/** Which members a quota is for. Absent means the club charges one rate. */
function readBand(value: unknown): FeeAgeBand {
  if (value === 'under_18' || value === 'adult' || value === 'any') return value;
  if (value === undefined || value === null || value === '') return 'any';
  throw new BadRequestException('ageBand must be any, under_18 or adult');
}

/**
 * How a late payment is charged, and the amount that goes with it.
 *
 * The two amounts are read whatever the kind, and the kind decides which one
 * counts — so switching from a flat penalty to a percentage and back does not
 * make the operator retype the number they had.
 */
function readPenaltyKind(value: unknown, field: string): FeePenaltyKind {
  if (value === 'amount' || value === 'percent' || value === 'none') return value;
  if (value === undefined || value === null || value === '') return 'none';
  throw new BadRequestException(`${field} must be none, amount or percent`);
}

/**
 * A manual discount is one kind or the other, and never without a reason.
 *
 * The database says both of these too. They are said here as well so the
 * operator gets a sentence naming the field rather than a constraint name —
 * QA 42.9 asks for a field-level error, in both locales, which means the API has
 * to name the field.
 */
function readManualDiscount(body: Record<string, unknown>): {
  manualDiscountPercent: number | null;
  manualDiscountCents: number | null;
  discountReason: string | null;
} {
  const percent = rate(body['manualDiscountPercent'], 'manualDiscountPercent');
  const raw = body['manualDiscountCents'];
  const amount = raw === undefined || raw === null || raw === ''
    ? null
    : cents(raw, 'manualDiscountCents');

  if (percent !== null && amount !== null) {
    throw new BadRequestException({
      code: 'one_manual_discount',
      message: 'A discount is a percentage or an amount, not both',
      fields: { manualDiscountCents: 'fees.oneDiscountOnly' },
    });
  }

  const reason = optionalText(body['discountReason'], 'discountReason', MAX_REASON);
  if ((percent !== null || amount !== null) && reason === null) {
    throw new BadRequestException({
      code: 'discount_needs_reason',
      message: 'A manual discount needs a reason',
      fields: { discountReason: 'fees.discountReasonRequired' },
    });
  }

  return {
    manualDiscountPercent: percent,
    manualDiscountCents: amount,
    discountReason: reason,
  };
}
