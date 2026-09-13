import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { DEFAULT_PAY_PERIODS, isPayPeriods, type CompensationKind } from '@poolse/rules';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireRole } from '../tenant/roles.js';
import { readPageQuery, type Paginated } from '../common/pagination.js';
import {
  addRate,
  archiveRate,
  canSeeCompensation,
  findRate,
  listHistory,
  listSalaries,
  salarySummary,
  updateRate,
  RateOverlapError,
  type RateInput,
  type RateRecord,
  type SalaryRow,
  type SalarySummary,
  type Viewer,
} from './compensation.repository.js';

/**
 * Salários — POOLSE-58.
 *
 * **Owner and Admin, and an Admin may not see the Owner.** `requireRole` is the
 * coarse gate; the row-level half is `viewer()` below, answered once by the
 * repository and applied to the list, the history, the roll-up and every write.
 * Hiding the menu item is not the control and never was — these endpoints refuse
 * an instructor whether or not anything on screen offered them the option.
 *
 * **Reading and writing are one boundary.** A POST an Admin cannot read the
 * result of would be a way to overwrite the Owner's pay without ever seeing it,
 * so `mayTouch` guards both directions with the same question.
 *
 * **Amounts travel in bodies only.** Never in a path, never in a query string,
 * never in an audit entry, and never in the message of a refusal: a 409 carries
 * dates, and the toast says "guardado".
 */

const MAX_NOTE = 500;
const MAX_AMOUNT_CENTS = 100_000_000; // €1,000,000 a month. A typo guard, not a policy.
const MAX_WEEKLY_HOURS = 80;

/** Owner sees everybody; an Admin sees everybody except the Owner. */
function viewer(): Viewer {
  return { isOwner: hasRole('owner') };
}

@Controller('staff/salaries')
export class SalariesController {
  /**
   * The list. Two segments, so it cannot be swallowed by `/staff/:membershipId`
   * — a collision Nest resolves by registration order, which is not a thing to
   * depend on for the screen that shows people's wages.
   */
  @Get()
  async list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<{ organizationId: string; salaries: Paginated<SalaryRow>; canEdit: boolean }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const salaries = await listSalaries(organizationId, viewer(), readPageQuery(page, limit));

    /*
     * `canEdit` is the same answer the guard enforces, so the screen and the API
     * cannot disagree about what is offered — `lesson-plans.repository.ts` sets
     * the pattern. Both roles may edit today; it is a field so that changing
     * that is one place rather than a hunt through the web app.
     *
     * The tenant comes back with the list, as it does from `/people`: somebody
     * who belongs to two clubs has to be able to say which one a save is for,
     * and the API re-checks the membership rather than trusting the header.
     */
    return { organizationId, salaries, canEdit: true };
  }

  /**
   * The roll-up card.
   *
   * Its own endpoint over its own query, not a fold over the page: a total
   * summed from ten visible rows is right on page 1 and wrong on page 2.
   */
  @Get('summary')
  async summary(): Promise<{ summary: SalarySummary }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();
    return { summary: await salarySummary(organizationId, viewer()) };
  }
}

@Controller('staff')
export class CompensationController {
  /** One person's history, newest first. Archived rows included, marked. */
  @Get(':membershipId/compensation')
  async history(
    @Param('membershipId') membershipId: string,
  ): Promise<{ history: RateRecord[]; canEdit: boolean }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    await mayTouch(organizationId, membershipId);

    return { history: await listHistory(organizationId, membershipId), canEdit: true };
  }

  /** A new rate. Closes the one it succeeds; never edits it. */
  @Post(':membershipId/compensation')
  async add(
    @Param('membershipId') membershipId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    await mayTouch(organizationId, membershipId);

    return refuseOverlap(() => addRate(organizationId, membershipId, readRate(body)));
  }

  /** A correction to a rate that was wrong. A raise is a new row, not this. */
  @Patch('compensation/:id')
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ ok: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const rate = await findRate(organizationId, id);
    if (rate === null) throw new NotFoundException('No such rate');
    await mayTouch(organizationId, rate.staffMembershipId);

    await refuseOverlap(() =>
      updateRate(organizationId, id, {
        ...readRate(body),
        effectiveTo: optionalDate(body['effectiveTo'], 'effectiveTo'),
      }),
    );

    return { ok: true };
  }

  /** Archive. There is no delete on this table and there will not be one. */
  @Delete('compensation/:id')
  async archive(@Param('id') id: string): Promise<{ ok: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const rate = await findRate(organizationId, id);
    if (rate === null) throw new NotFoundException('No such rate');
    await mayTouch(organizationId, rate.staffMembershipId);

    await archiveRate(organizationId, id);
    return { ok: true };
  }
}

/**
 * The row-level guard, in one place.
 *
 * **404 for another tenant's id and 403 for the Owner's**, and the difference
 * matters: RLS hid the first and the caller learns nothing, while the second is
 * a person they can see on the staff list and a boundary they are meant to
 * understand. Collapsing them into one answer would either confirm the existence
 * of rows in other clubs or tell an Admin their colleague does not exist.
 */
async function mayTouch(organizationId: string, membershipId: string): Promise<void> {
  const verdict = await canSeeCompensation(organizationId, viewer(), membershipId);

  if (verdict === 'missing') throw new NotFoundException('No such staff member');
  if (verdict === 'forbidden') {
    throw new ForbiddenException({
      code: 'compensation_owner_only',
      message: 'Only the owner may see the owner’s compensation',
    });
  }
}

/**
 * A refusal that needs numbers carries them as fields.
 *
 * `from` and `to` rather than a sentence, so the web app can say "já existe um
 * valor de 1 de setembro a 31 de outubro" in either language — the same contract
 * as the pool-capacity refusal. Empty strings mean the row was taken by another
 * transaction between the check and the constraint; the screen falls back to the
 * sentence without dates, which is still actionable.
 */
async function refuseOverlap<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof RateOverlapError) {
      throw new ConflictException({
        code: 'compensation_overlap',
        message: 'That person already has a rate covering those dates',
        from: error.from,
        to: error.to,
      });
    }
    throw error;
  }
}

/** Everything a rate needs, validated. Nothing here reaches a log. */
function readRate(body: Record<string, unknown>): RateInput {
  const kind = body['kind'];
  if (kind !== 'monthly' && kind !== 'hourly') {
    throw new BadRequestException({ code: 'invalid_kind', field: 'kind' });
  }

  const amountCents = body['amountCents'];
  if (
    typeof amountCents !== 'number' ||
    !Number.isInteger(amountCents) ||
    amountCents <= 0 ||
    amountCents > MAX_AMOUNT_CENTS
  ) {
    throw new BadRequestException({ code: 'invalid_amount', field: 'amountCents' });
  }

  /*
   * Null is "not measured" and is allowed — the derived figure becomes a dash
   * and the roll-up counts that person separately. Zero is not the same thing
   * and is refused: it is a divisor that would make somebody look free.
   */
  const rawHours = body['weeklyHours'];
  let weeklyHours: number | null = null;
  if (rawHours !== null && rawHours !== undefined && rawHours !== '') {
    const parsed = typeof rawHours === 'number' ? rawHours : Number.parseFloat(String(rawHours));
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_WEEKLY_HOURS) {
      throw new BadRequestException({ code: 'invalid_hours', field: 'weeklyHours' });
    }
    weeklyHours = Math.round(parsed * 100) / 100;
  }

  const rawPeriods = body['payPeriodsPerYear'];
  const payPeriodsPerYear =
    rawPeriods === null || rawPeriods === undefined
      ? DEFAULT_PAY_PERIODS
      : Number(rawPeriods);
  if (!isPayPeriods(payPeriodsPerYear)) {
    throw new BadRequestException({ code: 'invalid_periods', field: 'payPeriodsPerYear' });
  }

  const effectiveFrom = optionalDate(body['effectiveFrom'], 'effectiveFrom');
  if (effectiveFrom === null) {
    throw new BadRequestException({ code: 'invalid_date', field: 'effectiveFrom' });
  }

  const rawNote = body['note'];
  const note =
    typeof rawNote === 'string' && rawNote.trim() !== '' ? rawNote.trim().slice(0, MAX_NOTE) : null;

  return {
    kind: kind as CompensationKind,
    amountCents,
    weeklyHours,
    payPeriodsPerYear,
    effectiveFrom,
    note,
  };
}

/**
 * `YYYY-MM-DD` or nothing.
 *
 * A date is a date, not a timestamp: a rate starts on a day in the club's own
 * calendar, and letting an ISO instant through here would make "1 October" mean
 * different things either side of midnight.
 */
function optionalDate(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException({ code: 'invalid_date', field });
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException({ code: 'invalid_date', field });
  }
  return value;
}
