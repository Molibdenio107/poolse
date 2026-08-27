import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireRole } from '../tenant/roles.js';
import { sendEmail } from '../notifications/notifier.js';
import { vacationDecisionEmail } from '../notifications/vacation-email.js';
import {
  balanceFor,
  createRequest,
  DayUnavailableError,
  decideRequest,
  findDecisionNotice,
  findRequestOwner,
  listHolidays,
  listMyRequests,
  listPendingRequests,
  listTeamYear,
  othersOffOn,
  setEntitlement,
  type Balance,
  type Holiday,
  type TeamMember,
  type VacationRequest,
} from './vacations.repository.js';

/** One request cannot be a whole career. Anything larger is a mistake or an attack. */
const MAX_DAYS = 60;
const MAX_NOTE = 500;

interface MyVacationsResponse {
  organizationId: string;
  year: number;
  membershipId: string;
  balance: Balance;
  requests: VacationRequest[];
  holidays: Holiday[];
  /** So the tab bar can hide a map the API would refuse anyway. */
  canApprove: boolean;
}

interface ApprovalQueueResponse {
  organizationId: string;
  requests: (VacationRequest & { othersOff: { name: string | null; day: string }[] })[];
}

interface TeamResponse {
  organizationId: string;
  year: number;
  members: TeamMember[];
  holidays: Holiday[];
}

/**
 * Leave — backlog round 3, stories 6, 7 and 8.
 *
 * Three surfaces with three different audiences, and the split is the important
 * part: `/vacations/mine` is yours and needs no role at all, while the queue and
 * the team map are `owner` and `admin` only. An instructor may ask for time off;
 * they may not read when their colleagues are away, which is staff
 * administration and lives with the people who run the organization — the same
 * line story 8 drew for People.
 */
@Controller('vacations')
export class VacationsController {
  private readonly logger = new Logger('Vacations');

  /**
   * My own year. No role check, deliberately: this is the one screen everybody
   * gets, and the membership comes from the resolved tenant rather than from
   * anything the client sent, so it cannot be pointed at a colleague.
   */
  @Get('mine')
  async mine(@Query('year') yearRaw?: string): Promise<MyVacationsResponse> {
    const { organizationId, membershipId } = currentTenant();
    const year = parseYear(yearRaw);

    const [balance, requests, holidays] = await Promise.all([
      balanceFor(organizationId, membershipId, year),
      listMyRequests(organizationId, membershipId, year),
      listHolidays(organizationId, year),
    ]);

    return {
      organizationId,
      year,
      membershipId,
      balance,
      requests,
      holidays,
      canApprove: hasRole('owner', 'admin'),
    };
  }

  /**
   * Ask for days off.
   *
   * The days arrive as a list rather than a range because staff take odd single
   * days — see the migration. Sorted and de-duplicated here so the same day sent
   * twice by a confused grid is one day, not a constraint violation the person
   * has to interpret.
   */
  @Post('requests')
  async request(@Body() body: Record<string, unknown>): Promise<{ id: string }> {
    const { organizationId, membershipId } = currentTenant();

    const days = parseDays(body['days']);
    if (days.length === 0) throw new BadRequestException('Choose at least one day');
    if (days.length > MAX_DAYS) {
      throw new BadRequestException(`A single request may cover at most ${MAX_DAYS} days`);
    }

    try {
      return { id: await createRequest(organizationId, membershipId, days) };
    } catch (error) {
      if (error instanceof DayUnavailableError) {
        // The unique index caught a day this person already holds. A sentence,
        // not a constraint name.
        throw new ConflictException({
          code: 'day_already_booked',
          message: 'One or more of those days is already booked',
        });
      }
      throw error;
    }
  }

  /**
   * Withdraw my own pending request.
   *
   * The membership check is the point: `decideRequest` would happily withdraw
   * anybody's, so the ownership test happens before it is called. Story 6 says
   * "by the person who made it", and this is where that is true.
   */
  @Post('requests/:id/withdraw')
  async withdraw(@Param('id') id: string): Promise<{ withdrawn: true }> {
    const { organizationId, membershipId } = currentTenant();

    const outcome = await withdrawOwn(organizationId, membershipId, id);
    if (outcome === 'not_found') throw new NotFoundException('No such request');
    if (outcome === 'not_pending') {
      throw new ConflictException('That request has already been answered');
    }
    return { withdrawn: true };
  }

  /** The queue — story 7. */
  @Get('pending')
  async pending(): Promise<ApprovalQueueResponse> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const requests = await listPendingRequests(organizationId);

    // Who else is already off on those days, so a manager can see the gap in
    // cover before creating it rather than after.
    const withCover = await Promise.all(
      requests.map(async (request) => ({
        ...request,
        othersOff: await othersOffOn(organizationId, request.membershipId, request.days),
      })),
    );

    return { organizationId, requests: withCover };
  }

  @Post('requests/:id/approve')
  async approve(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    requireRole('owner', 'admin');
    return this.decide(id, 'approved', body);
  }

  @Post('requests/:id/reject')
  async reject(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    requireRole('owner', 'admin');

    // Story 7 is explicit, and the database agrees — but a 400 naming the field
    // is a better answer than a constraint violation.
    const note = text(body['note'], MAX_NOTE);
    if (note === null) {
      throw new BadRequestException({
        code: 'note_required',
        message: 'A rejection needs a reason',
      });
    }
    return this.decide(id, 'rejected', body);
  }

  private async decide(
    id: string,
    status: 'approved' | 'rejected',
    body: Record<string, unknown>,
  ): Promise<{ decided: true }> {
    const { organizationId, membershipId } = currentTenant();

    const outcome = await decideRequest(
      organizationId,
      id,
      status,
      membershipId,
      text(body['note'], MAX_NOTE),
    );

    if (outcome === 'not_found') throw new NotFoundException('No such request');
    if (outcome === 'not_pending') {
      // Two managers in the queue at once. The second is told rather than
      // silently overwriting the first one's decision.
      throw new ConflictException({
        code: 'already_decided',
        message: 'That request has already been answered',
      });
    }

    await this.notify(organizationId, id, status === 'approved', text(body['note'], MAX_NOTE));

    return { decided: true };
  }

  /**
   * Tells the requester — story 7.
   *
   * After the decision is committed, and it can never undo one: `sendEmail`
   * never throws, and this catches anything the lookup could raise. A manager
   * pressing "approve" must not see a failure because a mail server was slow,
   * and the person's leave is approved either way — the screen is the record,
   * the email is a courtesy.
   *
   * Locally `EMAIL_PROVIDER=console` writes the message to the log instead of
   * sending it, which is how the whole flow works on a laptop with no domain.
   */
  private async notify(
    organizationId: string,
    requestId: string,
    approved: boolean,
    note: string | null,
  ): Promise<void> {
    try {
      const notice = await findDecisionNotice(organizationId, requestId);
      if (!notice?.email) return;

      await sendEmail(
        vacationDecisionEmail({
          to: notice.email,
          personName: notice.personName,
          organizationName: notice.organizationName,
          approved,
          days: notice.days,
          note,
          locale: notice.organizationLocale,
        }),
      );
    } catch (error) {
      this.logger.warn(`Could not notify the requester of ${requestId}: ${String(error)}`);
    }
  }

  /** The team map — story 8. */
  @Get('team')
  async team(@Query('year') yearRaw?: string): Promise<TeamResponse> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();
    const year = parseYear(yearRaw);

    const [members, holidays] = await Promise.all([
      listTeamYear(organizationId, year),
      listHolidays(organizationId, year),
    ]);

    return { organizationId, year, members, holidays };
  }

  /** Entitlement, set by an admin — the gap story 6 flagged before it could be built. */
  @Put('entitlement/:membershipId')
  async entitlement(
    @Param('membershipId') membershipId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ updated: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const days = Number(body['days']);
    if (!Number.isInteger(days) || days < 0 || days > 365) {
      throw new BadRequestException('days must be a whole number between 0 and 365');
    }

    if (!(await setEntitlement(organizationId, membershipId, days))) {
      throw new NotFoundException('No such member');
    }
    return { updated: true };
  }
}

/**
 * Withdrawal, with the ownership test the shared decision path does not make.
 *
 * Kept out of the repository because it is an authorization rule rather than a
 * data one: "only the person who asked may take it back" is about who is
 * calling, and the repository does not know.
 */
async function withdrawOwn(
  organizationId: string,
  membershipId: string,
  requestId: string,
): Promise<'not_found' | 'not_pending' | 'decided'> {
  const owner = await findRequestOwner(organizationId, requestId);

  // Somebody else's request is reported as missing, not as forbidden. A refusal
  // would confirm that a request with that id exists, which is a small leak and
  // an entirely free one to avoid.
  if (!owner || owner.membershipId !== membershipId) return 'not_found';
  if (owner.status !== 'pending') return 'not_pending';

  return decideRequest(organizationId, requestId, 'withdrawn', null, null);
}

/** Defaults to the current year, which is what "Férias" means with no argument. */
function parseYear(value: string | undefined): number {
  if (value === undefined || value === '') return new Date().getFullYear();

  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new BadRequestException('year must be a four-digit year between 2000 and 2100');
  }
  return year;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A list of calendar days, validated as calendar days.
 *
 * `new Date('2026-02-31')` does not throw — it rolls into March — so the only
 * way to know the input was real is to format it back and see whether it still
 * says what it said.
 */
function parseDays(value: unknown): string[] {
  if (!Array.isArray(value)) throw new BadRequestException('days must be a list of dates');

  const days = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string' || !ISO_DATE.test(entry)) {
      throw new BadRequestException(`Not a date: ${String(entry)}`);
    }
    const parsed = new Date(`${entry}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== entry) {
      throw new BadRequestException(`Not a real date: ${entry}`);
    }
    // Sunday. The database refuses it too; this turns a check violation into a
    // sentence, and stops a whole request failing for one bad day.
    if (parsed.getUTCDay() === 0) {
      throw new BadRequestException({
        code: 'sunday_not_allowed',
        message: `${entry} is a Sunday`,
      });
    }
    days.add(entry);
  }

  return [...days].sort();
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > max) throw new BadRequestException(`Too long: at most ${max} characters`);
  return trimmed;
}
