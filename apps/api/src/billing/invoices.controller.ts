import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireRole } from '../tenant/roles.js';
import {
  archivePayment,
  creditInvoice,
  listInvoices,
  listSeries,
  readInvoice,
  recordChase,
  recordPayment,
  runInvoices,
  updateSeries,
  AlreadyChargedError,
  AlreadyCreditedError,
  NoInvoiceSeriesError,
  NotPayableError,
  SeriesInUseError,
  type ChaseChannel,
  type ChaseInput,
  type Invoice,
  type InvoiceRun,
  type InvoiceRunInput,
  type InvoiceSeries,
  type PaymentInput,
  type PaymentSource,
} from './invoices.repository.js';

/**
 * Invoicing — phase 2.2.
 *
 * **Owner and Admin, reading as well as writing.** What a family is charged is a
 * commercial fact, like the price list and the apólice beside it; an instructor
 * has no more business with a document than with a negotiated mensalidade. The
 * rule is enforced here rather than by a screen omitting a link.
 *
 * Under `/facilities/:facilityId/…` because a document is issued by a site and
 * numbered in that site's own book. A document addressed through the wrong
 * facility answers 404 rather than 403: that a resource exists at another site
 * is not something an error should confirm.
 */
@Controller('facilities/:facilityId/invoices')
export class InvoicesController {
  @Get()
  async list(
    @Param('facilityId') facilityId: string,
    @Query('month') month?: string,
    @Query('studentId') studentId?: string,
    @Query('outstanding') outstanding?: string,
  ): Promise<{ invoices: Invoice[] }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    /*
     * `outstanding=1` is the chase list: everything still owed, oldest debt
     * first. Deliberately not "overdue only" — a club working through its
     * debtors wants the document due on Friday in front of it too, and each row
     * carries its own status to say which is which.
     */
    const outstandingOnly = outstanding === '1' || outstanding === 'true';

    return {
      invoices: await listInvoices(organizationId, facilityId, {
        month: outstandingOnly ? null : optionalDate(month, 'month'),
        studentId: studentId?.trim() === '' ? null : (studentId ?? null),
        outstandingOnly,
      }),
    };
  }

  /**
   * What a run would issue, computed by the code that issues it.
   *
   * A POST rather than a GET because it takes a body — the student filter is a
   * list — and because a preview is not a page anybody should be able to reach
   * by pasting a URL into a browser bar.
   */
  @Post('preview')
  async preview(
    @Param('facilityId') facilityId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<InvoiceRun> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    return refuseNoSeries(
      async () => await runInvoices(organizationId, facilityId, readRun(body), false),
    );
  }

  /** The same run, written. What the operator was shown is what is issued. */
  @Post()
  async issue(
    @Param('facilityId') facilityId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<InvoiceRun> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    try {
      return await refuseNoSeries(
        async () => await runInvoices(organizationId, facilityId, readRun(body), true),
      );
    } catch (error) {
      /*
       * Somebody else issued this occurrence between the preview and the button.
       *
       * The number travels as a field, like every other refusal here: the screen
       * composes "Outubro já está faturado em FT A/17" where the locale is.
       */
      if (error instanceof AlreadyChargedError) {
        throw new ConflictException({
          code: 'invoice_already_charged',
          message: 'That period is already on a document',
          values: { documentNo: error.documentNo },
        });
      }
      throw error;
    }
  }

  @Get(':id')
  async read(
    @Param('facilityId') facilityId: string,
    @Param('id') id: string,
  ): Promise<Invoice> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const invoice = await readInvoice(organizationId, id);
    if (invoice === null || invoice.facilityId !== facilityId) {
      throw new NotFoundException('No such document');
    }
    return invoice;
  }

  /**
   * Money arriving against a document — 2.3.
   *
   * A child row, never a column on the invoice: that table holds no UPDATE
   * grant, deliberately, and a family paying in two instalments is two facts
   * anyway. The document's state is recomputed from the sum whenever it is
   * read, so nothing here has to remember to update anything.
   */
  @Post(':id/payments')
  async pay(
    @Param('facilityId') facilityId: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    try {
      const paymentId = await recordPayment(organizationId, facilityId, id, readPayment(body));
      if (paymentId === null) throw new NotFoundException('No such document');
      return { id: paymentId };
    } catch (error) {
      throw refuseNotPayable(error);
    }
  }

  /** A payment entered against the wrong document, archived rather than erased. */
  @Post(':id/payments/:paymentId/archive')
  async unpay(
    @Param('facilityId') facilityId: string,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
  ): Promise<{ archived: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    if (!(await archivePayment(organizationId, facilityId, id, paymentId))) {
      throw new NotFoundException('No such payment');
    }
    return { archived: true };
  }

  /**
   * A record of the club having asked — 2.3.
   *
   * Not a message Poolse sends: the notification subsystem is phase 3.0. What
   * this records is that a person telephoned, wrote or spoke to a family, which
   * is what makes a second chase a different conversation from the first.
   */
  @Post(':id/chases')
  async chase(
    @Param('facilityId') facilityId: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    try {
      const chaseId = await recordChase(organizationId, facilityId, id, readChase(body));
      if (chaseId === null) throw new NotFoundException('No such document');
      return { id: chaseId };
    } catch (error) {
      throw refuseNotPayable(error);
    }
  }

  /**
   * The only correction there is.
   *
   * A document is never edited and never deleted — the application holds no
   * privilege to do either — so this is what a club reaches for when one is
   * wrong, and the occurrences it covered become billable again.
   */
  @Post(':id/credit-note')
  async credit(
    @Param('facilityId') facilityId: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string; documentNo: string }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const invoice = await readInvoice(organizationId, id);
    if (invoice === null || invoice.facilityId !== facilityId) {
      throw new NotFoundException('No such document');
    }

    const reason = typeof body['reason'] === 'string' ? body['reason'].trim() : '';
    if (reason.length > MAX_NOTES) {
      throw new BadRequestException(`reason may be at most ${MAX_NOTES} characters`);
    }

    try {
      const note = await creditInvoice(organizationId, id, reason === '' ? null : reason);
      if (note === null) throw new NotFoundException('No such document');
      return note;
    } catch (error) {
      if (error instanceof AlreadyCreditedError) {
        throw new ConflictException({
          code: 'invoice_already_credited',
          message: 'That document has already been credited',
          values: { documentNo: error.documentNo },
        });
      }
      throw refuseNoSeriesError(error);
    }
  }
}

/**
 * The numbering books a site holds.
 *
 * Its own controller because it is a settings screen rather than a document
 * one, and because the two answer different questions: this is where a club
 * decides what its numbers look like, once, and never again.
 */
@Controller('facilities/:facilityId/invoice-series')
export class InvoiceSeriesController {
  @Get()
  async list(@Param('facilityId') facilityId: string): Promise<{ series: InvoiceSeries[] }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();
    return { series: await listSeries(organizationId, facilityId) };
  }

  @Patch(':id')
  async update(
    @Param('facilityId') facilityId: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ updated: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const name = text(body['name'], 'name');
    const prefix = readPrefix(body['prefix']);

    try {
      if (!(await updateSeries(organizationId, facilityId, id, { name, prefix }))) {
        throw new NotFoundException('No such series');
      }
    } catch (error) {
      /*
       * A book that has issued documents keeps its letter.
       *
       * Renaming it would leave FT A/1 and FT B/2 in one series, neither of them
       * wrong and nothing able to report it. The count travels as a field so the
       * refusal can say how much has already gone out under it.
       */
      if (error instanceof SeriesInUseError) {
        throw new ConflictException({
          code: 'invoice_series_in_use',
          message: 'Documents have already been issued in this series',
          values: { issued: error.issued },
        });
      }
      if (isDuplicatePrefix(error)) {
        throw new ConflictException({
          code: 'invoice_series_prefix_taken',
          message: 'Another series already uses that letter',
          fields: { prefix: 'invoices.prefixTaken' },
        });
      }
      throw error;
    }
    return { updated: true };
  }
}

const MAX_TEXT = 120;
const MAX_NOTES = 2000;

/** A facility with no book cannot issue anything, which is a 409 and not a 500. */
async function refuseNoSeries(run: () => Promise<InvoiceRun | null>): Promise<InvoiceRun> {
  let result: InvoiceRun | null;
  try {
    result = await run();
  } catch (error) {
    throw refuseNoSeriesError(error);
  }
  if (result === null) throw new NotFoundException('No such facility');
  return result;
}

function refuseNoSeriesError(error: unknown): unknown {
  if (error instanceof NoInvoiceSeriesError) {
    throw new ConflictException({
      code: 'invoice_series_missing',
      message: 'This facility has no numbering series',
    });
  }
  return error;
}

/**
 * A credit note is owed by nobody, so it is neither paid nor chased.
 *
 * A 409 rather than a 400: the request is well formed, and what is wrong is the
 * claim it makes about a document the server can check and the client cannot —
 * the same reasoning the consent-form guard gives for its 422.
 */
function refuseNotPayable(error: unknown): unknown {
  if (error instanceof NotPayableError) {
    throw new ConflictException({
      code: 'invoice_not_payable',
      message: 'A credit note is not paid or chased',
    });
  }
  return error;
}

const SOURCES: PaymentSource[] = ['manual', 'mbway', 'sepa'];
const CHANNELS: ChaseChannel[] = ['email', 'phone', 'message', 'in_person', 'letter'];

function readPayment(body: Record<string, unknown>): PaymentInput {
  const amountCents = cents(body['amountCents'], 'amountCents');
  if (amountCents <= 0) {
    throw new BadRequestException({
      code: 'amount_required',
      message: 'A payment is more than zero',
      fields: { amountCents: 'invoices.amountRequired' },
    });
  }

  const source = String(body['source'] ?? 'manual');
  if (!SOURCES.includes(source as PaymentSource)) {
    throw new BadRequestException('source must be manual, mbway or sepa');
  }

  return {
    amountCents,
    paidOn: optionalDate(body['paidOn'], 'paidOn') ?? today(),
    source: source as PaymentSource,
    reference: optionalText(body['reference'], 'reference'),
    notes: optionalText(body['notes'], 'notes', MAX_NOTES),
  };
}

function readChase(body: Record<string, unknown>): ChaseInput {
  const channel = String(body['channel'] ?? '');
  if (!CHANNELS.includes(channel as ChaseChannel)) {
    throw new BadRequestException({
      code: 'channel_required',
      message: 'Say how the family was asked',
      fields: { channel: 'invoices.channelRequired' },
    });
  }

  return {
    chasedOn: optionalDate(body['chasedOn'], 'chasedOn') ?? today(),
    channel: channel as ChaseChannel,
    note: optionalText(body['note'], 'note', MAX_NOTES),
  };
}

/**
 * Today, as an ISO day.
 *
 * The server's, not the browser's — a page held open overnight would otherwise
 * date a payment yesterday. `paid_on` still defaults in SQL for anything that
 * reaches the table another way.
 */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function cents(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BadRequestException(`${field} must be a whole number of cents, zero or more`);
  }
  return parsed;
}

function optionalText(value: unknown, field: string, max = MAX_TEXT): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed === '') return null;
  if (trimmed.length > max) {
    throw new BadRequestException(`${field} may be at most ${max} characters`);
  }
  return trimmed;
}

function isDuplicatePrefix(error: unknown): boolean {
  const { code, constraint } = error as { code?: string; constraint?: string };
  return code === '23505' && constraint === 'invoice_series_prefix_uq';
}

function readRun(body: Record<string, unknown>): InvoiceRunInput {
  return {
    periodStart: readDate(body['periodStart'], 'periodStart'),
    dueOn: optionalDate(body['dueOn'], 'dueOn'),
    studentIds: readIds(body['studentIds'], 'studentIds'),
    payerKeys: readPayerKeys(body['payerKeys']),
  };
}

/** An ISO day, kept as text: a `date` parsed into a Date is a day early in UTC. */
function readDate(value: unknown, field: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new BadRequestException({
      code: `${field}_required`,
      message: `${field} must be a date`,
      fields: { [field]: `invoices.${field}Required` },
    });
  }
  return trimmed;
}

function optionalDate(value: unknown, field: string): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed === '' ? null : readDate(trimmed, field);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readIds(value: unknown, field: string): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.filter((entry): entry is string => typeof entry === 'string');
  if (ids.some((id) => !UUID.test(id))) {
    throw new BadRequestException(`${field} must be ids`);
  }
  return ids.length === 0 ? null : ids;
}

/**
 * `m:<uuid>` or `s:<uuid>` — a membership or a student, said in one string.
 *
 * Validated rather than trusted: these come back from a preview the client
 * holds, and an id that reached a query unchecked is an id somebody can change.
 */
function readPayerKeys(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const keys = value.filter((entry): entry is string => typeof entry === 'string');
  if (keys.some((key) => !/^[ms]:/.test(key) || !UUID.test(key.slice(2)))) {
    throw new BadRequestException('payerKeys must name a payer');
  }
  return keys.length === 0 ? null : keys;
}

function text(value: unknown, field: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed === '') {
    throw new BadRequestException({
      code: `${field}_required`,
      message: `${field} is required`,
      fields: { [field]: `invoices.${field}Required` },
    });
  }
  if (trimmed.length > MAX_TEXT) {
    throw new BadRequestException(`${field} may be at most ${MAX_TEXT} characters`);
  }
  return trimmed;
}

/**
 * The series letter, in the shape the AT accepts.
 *
 * Uppercased rather than refused for case: an operator typing "a" means A, and
 * the unique index compares them the same way. Checked here as well as by the
 * CHECK so the message can name the field.
 */
function readPrefix(value: unknown): string {
  const trimmed = (typeof value === 'string' ? value.trim() : '').toUpperCase();
  if (!/^[A-Z0-9]{1,10}$/.test(trimmed)) {
    throw new BadRequestException({
      code: 'prefix_invalid',
      message: 'A series letter is 1 to 10 letters or digits',
      fields: { prefix: 'invoices.prefixInvalid' },
    });
  }
  return trimmed;
}
