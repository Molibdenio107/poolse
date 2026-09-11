import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireCanArchive, requireRole } from '../tenant/roles.js';
import {
  addInvoice,
  archiveInvoice,
  checkInvoice,
  energyCosts,
  getInvoice,
  listInvoices,
  InvoiceRefusedError,
  type EnergyCosts,
  type InvoiceCheck,
  type InvoiceDetail,
  type InvoiceInput,
  type InvoiceSummary,
  type LineInput,
  type LineKind,
  type ReadingQuality,
  type RegisterInput,
  type RegisterName,
  type TariffPeriod,
} from './invoices.repository.js';

/**
 * Faturas — slice 5.3, first half.
 *
 * One route for preview and commit, told apart by `commit` in the body, as
 * every importer here is: what the operator was shown and what gets written
 * come from one code path. A preview answers with the field errors and the
 * warnings; a commit refuses on the errors (422, the same field keys) and
 * writes, warnings or not — a warning is something a person looked at.
 *
 * Same audience as readings: owner, admin and maintenance file a bill; owner
 * and admin remove one.
 */

const ENERGY = ['owner', 'admin', 'maintenance'] as const;

const REGISTERS: readonly RegisterName[] = ['vazio', 'ponta', 'cheias', 'super_vazio', 'total'];
const PERIODS: readonly TariffPeriod[] = [
  'simples', 'ponta', 'cheias', 'vazio_normal', 'super_vazio', 'fora_vazio', 'vazio',
];
const KINDS: readonly LineKind[] = ['energy', 'power', 'discount', 'tax', 'other'];

const MAX_TEXT = 200;
const MAX_NOTES = 2000;
const MAX_LINES = 60;
const MAX_CENTS = 1_000_000_000;

interface PreviewResponse extends InvoiceCheck {
  /** The input as the API understood it, so the form re-seeds from one truth. */
  input: InvoiceInput;
}

@Controller('energy')
export class EnergyInvoicesController {
  /** What the club's electricity has cost, month by month — the dashboard's panel. */
  @Get('costs')
  async costs(): Promise<EnergyCosts> {
    requireRole(...ENERGY);
    const { organizationId } = currentTenant();
    return energyCosts(organizationId);
  }

  @Get('meters/:meterId/invoices')
  async list(@Param('meterId') meterId: string): Promise<{ invoices: InvoiceSummary[]; canRecord: boolean }> {
    requireRole(...ENERGY);
    const { organizationId } = currentTenant();
    return { invoices: await listInvoices(organizationId, meterId), canRecord: hasRole(...ENERGY) };
  }

  @Get('invoices/:invoiceId')
  async one(@Param('invoiceId') invoiceId: string): Promise<{ invoice: InvoiceDetail; canArchive: boolean }> {
    requireRole(...ENERGY);
    const { organizationId } = currentTenant();
    const invoice = await getInvoice(organizationId, invoiceId);
    if (invoice === null) throw new NotFoundException('No such invoice');
    return { invoice, canArchive: hasRole('owner', 'admin') };
  }

  /**
   * Preview, or commit — `body.commit === true`.
   *
   * The 422 on commit carries the same `fields` the preview would have, so a
   * client that skipped the preview still gets the answer beside the box.
   */
  @Post('meters/:meterId/invoices')
  async file(
    @Param('meterId') meterId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<PreviewResponse | { id: string }> {
    requireRole(...ENERGY);
    const { organizationId, membershipId } = currentTenant();
    if (membershipId === null) {
      throw new BadRequestException('Only a member of this organization can file a bill');
    }

    const input = readInvoice(body);

    if (body['commit'] !== true) {
      const check = await checkInvoice(organizationId, meterId, input);
      return { ...check, input };
    }

    try {
      return { id: await addInvoice(organizationId, meterId, membershipId, input) };
    } catch (error) {
      if (error instanceof InvoiceRefusedError) {
        throw new UnprocessableEntityException({
          code: 'invoice_refused',
          message: 'The bill was refused; see fields',
          fields: error.fields,
        });
      }
      throw error;
    }
  }

  @Post('invoices/:invoiceId/archive')
  async remove(@Param('invoiceId') invoiceId: string): Promise<{ archived: true }> {
    requireCanArchive();
    const { organizationId } = currentTenant();
    if (!(await archiveInvoice(organizationId, invoiceId))) throw new NotFoundException('No such invoice');
    return { archived: true };
  }
}

// ---------------------------------------------------------------------------
// Reading the body — strictly, with the field named on every refusal
// ---------------------------------------------------------------------------

function readInvoice(body: Record<string, unknown>): InvoiceInput {
  const supplier = text(body['supplier'], 'supplier');
  if (supplier === null) throw refuse('supplier', 'A bill names its supplier');
  const invoiceNumber = text(body['invoiceNumber'], 'invoiceNumber');
  if (invoiceNumber === null) throw refuse('invoiceNumber', 'A bill has a number');

  const issuedOn = date(body['issuedOn'], 'issuedOn');
  const periodStart = date(body['periodStart'], 'periodStart');
  const periodEnd = date(body['periodEnd'], 'periodEnd');
  if (issuedOn === null) throw refuse('issuedOn', 'When was the bill issued?');
  if (periodStart === null) throw refuse('periodStart', 'When does the billing period start?');
  if (periodEnd === null) throw refuse('periodEnd', 'When does the billing period end?');

  const readingQuality = body['readingQuality'];
  if (readingQuality !== undefined && readingQuality !== null && readingQuality !== ''
      && readingQuality !== 'real' && readingQuality !== 'estimated') {
    throw refuse('readingQuality', 'real or estimated');
  }

  const source = body['source'] === 'import' ? 'import' : 'manual';

  const rawRegisters = Array.isArray(body['registers']) ? body['registers'] : [];
  const rawLines = Array.isArray(body['lines']) ? body['lines'] : [];
  if (rawLines.length > MAX_LINES) throw refuse('lines', `At most ${MAX_LINES} lines`);

  const registers = rawRegisters.map((raw, i) => readRegister(raw, i));
  const seen = new Set<string>();
  for (const [i, r] of registers.entries()) {
    if (seen.has(r.register)) throw refuse(`registers.${i}.register`, 'Each register once');
    seen.add(r.register);
  }

  return {
    supplier,
    invoiceNumber,
    atcud: text(body['atcud'], 'atcud'),
    documentReference: text(body['documentReference'], 'documentReference'),
    issuedOn,
    periodStart,
    periodEnd,
    dueOn: date(body['dueOn'], 'dueOn'),
    contractedPowerKva: decimal(body['contractedPowerKva'], 'contractedPowerKva'),
    tariff: text(body['tariff'], 'tariff'),
    cycle: text(body['cycle'], 'cycle'),
    readingQuality: (readingQuality as ReadingQuality | '' | null | undefined) || null,
    cpe: cpeOf(body['cpe']),
    meterSerial: text(body['meterSerial'], 'meterSerial'),
    subtotalCents: cents(body['subtotalCents'], 'subtotalCents', true),
    vatCents: cents(body['vatCents'], 'vatCents', true),
    totalCents: cents(body['totalCents'], 'totalCents', true),
    otherChargesCents: cents(body['otherChargesCents'], 'otherChargesCents', false) ?? 0,
    documentTotalCents: cents(body['documentTotalCents'], 'documentTotalCents', true),
    networkAccessCents: cents(body['networkAccessCents'], 'networkAccessCents', false),
    regulatedDifferenceCents: cents(body['regulatedDifferenceCents'], 'regulatedDifferenceCents', false),
    notes: text(body['notes'], 'notes', MAX_NOTES),
    source,
    sourceFileName: text(body['sourceFileName'], 'sourceFileName'),
    registers,
    lines: rawLines.map((raw, i) => readLine(raw, i)),
  };
}

function readRegister(raw: unknown, i: number): RegisterInput {
  const r = (raw ?? {}) as Record<string, unknown>;
  const register = r['register'];
  if (!REGISTERS.includes(register as RegisterName)) {
    throw refuse(`registers.${i}.register`, 'vazio, ponta, cheias, super_vazio or total');
  }
  const kwh = decimal(r['kwh'], `registers.${i}.kwh`);
  if (kwh === null || kwh < 0) throw refuse(`registers.${i}.kwh`, 'kWh, zero or more');
  return {
    register: register as RegisterName,
    previousIndex: decimal(r['previousIndex'], `registers.${i}.previousIndex`),
    currentIndex: decimal(r['currentIndex'], `registers.${i}.currentIndex`),
    kwh,
  };
}

function readLine(raw: unknown, i: number): LineInput {
  const l = (raw ?? {}) as Record<string, unknown>;
  const kind = l['kind'];
  if (!KINDS.includes(kind as LineKind)) {
    throw refuse(`lines.${i}.kind`, 'energy, power, discount, tax or other');
  }
  const description = text(l['description'], `lines.${i}.description`);
  if (description === null) throw refuse(`lines.${i}.description`, 'A line says what it is');
  const period = l['period'];
  if (period !== undefined && period !== null && period !== '' && !PERIODS.includes(period as TariffPeriod)) {
    throw refuse(`lines.${i}.period`, 'Not a tariff period');
  }
  const vatRate = decimal(l['vatRate'], `lines.${i}.vatRate`);
  if (vatRate !== null && (vatRate < 0 || vatRate > 100)) throw refuse(`lines.${i}.vatRate`, 'A percentage');

  return {
    kind: kind as LineKind,
    description,
    period: (period as TariffPeriod | '' | null | undefined) || null,
    fromOn: date(l['fromOn'], `lines.${i}.fromOn`),
    toOn: date(l['toOn'], `lines.${i}.toOn`),
    quantity: decimal(l['quantity'], `lines.${i}.quantity`),
    unit: text(l['unit'], `lines.${i}.unit`, 12),
    unitPrice: decimal(l['unitPrice'], `lines.${i}.unitPrice`),
    amountCents: cents(l['amountCents'], `lines.${i}.amountCents`, true),
    discountCents: cents(l['discountCents'], `lines.${i}.discountCents`, false) ?? 0,
    totalCents: cents(l['totalCents'], `lines.${i}.totalCents`, true),
    vatRate,
  };
}

function refuse(field: string, message: string): BadRequestException {
  return new BadRequestException({ message, field, fields: { [field]: 'energy.invoice.fieldInvalid' } });
}

function text(value: unknown, field: string, max = MAX_TEXT): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw refuse(field, 'Text expected');
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > max) throw refuse(field, `At most ${max} characters`);
  return trimmed;
}

/** An ISO calendar day, `YYYY-MM-DD`, or null when absent. */
function date(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw refuse(field, 'A date, YYYY-MM-DD');
  if (Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) throw refuse(field, 'A date, YYYY-MM-DD');
  return value;
}

function decimal(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw refuse(field, 'A number');
  return n;
}

/** Integer cents, signed — a credit note is negative. */
function cents(value: unknown, field: string, required: true): number;
function cents(value: unknown, field: string, required: false): number | null;
function cents(value: unknown, field: string, required: boolean): number | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw refuse(field, 'An amount');
    return null;
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || Math.abs(n) > MAX_CENTS) throw refuse(field, 'Whole cents');
  return n;
}

/**
 * A CPE as the schema wants it: the bill prints "PT 0002 000 042 466 003 BW"
 * and the column holds it without the spaces, so two bills for one point of
 * delivery compare equal however each supplier spaces it.
 */
function cpeOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const compact = value.replace(/\s+/g, '').toUpperCase();
  if (compact === '') return null;
  if (!/^[A-Z]{2}[A-Z0-9]{14,20}$/.test(compact)) throw refuse('cpe', 'Not a CPE');
  return compact;
}
