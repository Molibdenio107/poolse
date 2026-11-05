import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireRole } from '../tenant/roles.js';
import { CoreRoute } from '../tenant/modules.js';
import {
  archiveCost,
  costWindow,
  ledgerMonths,
  recordCost,
  recordPurchase,
  setPremium,
  type CostEntryInput,
  type Ledger,
  type WindowTotal,
} from './costs.repository.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A window is at most this long: a ledger read is months, and a decade is plenty. */
const MAX_WINDOW_DAYS = 3700;

function day(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DAY.test(value) || Number.isNaN(Date.parse(value))) {
    throw new BadRequestException(`${field} is a date (YYYY-MM-DD)`);
  }
  return value;
}
function optionalDay(value: unknown, field: string): string | null {
  return value === undefined || value === null || value === '' ? null : day(value, field);
}
function cents(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1_000_000_000) {
    throw new BadRequestException(`${field} is a whole number of cents, 0 or more`);
  }
  return value;
}
function text(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new BadRequestException('Text expected');
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.slice(0, max);
}
function uuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !UUID.test(value)) throw new BadRequestException(`${field} is an id`);
  return value;
}
function windowOf(from: unknown, to: unknown): [string, string] {
  const a = day(from, 'from');
  const b = day(to, 'to');
  const span = (Date.parse(b) - Date.parse(a)) / 86_400_000;
  if (span < 0 || span > MAX_WINDOW_DAYS) throw new BadRequestException('from…to is a window of up to ten years');
  return [a, b];
}

/** A database refusal (a bad id, another club's site, a shape the CHECKs refuse) answers 400. */
function refused(error: unknown): never {
  const code = (error as { code?: string }).code;
  if (code === '23503' || code === '23514' || code === '22007' || code === '22P02') {
    throw new BadRequestException('That cost cannot be recorded as given');
  }
  throw error;
}

/**
 * The cost ledger — POOLSE-182. Owner and admin read and write; maintenance
 * records what it handles (a service on an avaria or a task, a purchase) and
 * **sees no totals**, the energy rule carried; instructors and families see
 * nothing. An Admin's totals leave the Owner's pay out.
 */
@CoreRoute()
@Controller('costs')
export class CostsController {
  /** Month by month, by kind and basis — what a chart reads. */
  @Get('months')
  async months(@Query('from') from?: string, @Query('to') to?: string): Promise<Ledger> {
    requireRole('owner', 'admin');
    const [a, b] = windowOf(from, to);
    return ledgerMonths(currentTenant().organizationId, a, b, !hasRole('owner'));
  }

  /** A window's totals — a civil year, an época — split by days where it cuts a month. */
  @Get('window')
  async window(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<{ totals: WindowTotal[]; salariesWithoutHours: number; unpricedSupplyMonths: number }> {
    requireRole('owner', 'admin');
    const [a, b] = windowOf(from, to);
    return costWindow(currentTenant().organizationId, a, b, !hasRole('owner'));
  }

  /** Water, a fixed cost (once, monthly or yearly), or another cost the club pays. */
  @Post()
  async record(@Body() body: Record<string, unknown>): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const kind = body['kind'];
    if (kind !== 'water' && kind !== 'fixed' && kind !== 'other' && kind !== 'maintenance_service') {
      throw new BadRequestException('kind is water, fixed, other or maintenance_service');
    }
    const recurrence = body['recurrence'] ?? 'none';
    if (recurrence !== 'none' && recurrence !== 'monthly' && recurrence !== 'yearly') {
      throw new BadRequestException('recurrence is none, monthly or yearly');
    }
    const input: CostEntryInput = {
      facilityId: uuid(body['facilityId'], 'facilityId'),
      kind,
      amountCents: cents(body['amountCents'], 'amountCents'),
      vatCents: body['vatCents'] === undefined ? 0 : cents(body['vatCents'], 'vatCents'),
      periodFrom: recurrence === 'none' ? day(body['periodFrom'], 'periodFrom') : null,
      periodTo: recurrence === 'none' ? day(body['periodTo'], 'periodTo') : null,
      recurrence,
      effectiveFrom: recurrence === 'none' ? null : day(body['effectiveFrom'], 'effectiveFrom'),
      effectiveTo: recurrence === 'none' ? null : optionalDay(body['effectiveTo'], 'effectiveTo'),
      supplier: text(body['supplier'], 200),
      documentNumber: text(body['documentNumber'], 100),
      note: text(body['note'], 500),
      maintenanceRequestId: null,
      taskCompletionId: null,
    };
    try {
      return { id: await recordCost(currentTenant().organizationId, currentTenant().membershipId, input) };
    } catch (error) {
      refused(error);
    }
  }

  /** Not paid, or recorded by mistake. */
  @Post(':id/archive')
  async archive(@Param('id', ParseUUIDPipe) id: string): Promise<{ archived: true }> {
    requireRole('owner', 'admin');
    if (!(await archiveCost(currentTenant().organizationId, id))) throw new NotFoundException('No such cost');
    return { archived: true };
  }

  /**
   * A maintenance service's invoice, on the avaria or the task it was for. The
   * maintenance role records it and is answered with an id, never a total.
   */
  @Post('maintenance-service')
  async service(@Body() body: Record<string, unknown>): Promise<{ id: string }> {
    requireRole('owner', 'admin', 'maintenance');
    const maintenanceRequestId = uuid(body['maintenanceRequestId'], 'maintenanceRequestId');
    const taskCompletionId = uuid(body['taskCompletionId'], 'taskCompletionId');
    if ((maintenanceRequestId === null) === (taskCompletionId === null)) {
      throw new BadRequestException('Name the avaria or the task done, one of them');
    }
    const performedOn = day(body['performedOn'], 'performedOn');
    const input: CostEntryInput = {
      facilityId: uuid(body['facilityId'], 'facilityId'),
      kind: 'maintenance_service',
      amountCents: cents(body['amountCents'], 'amountCents'),
      vatCents: body['vatCents'] === undefined ? 0 : cents(body['vatCents'], 'vatCents'),
      periodFrom: performedOn,
      periodTo: performedOn,
      recurrence: 'none',
      effectiveFrom: null,
      effectiveTo: null,
      supplier: text(body['supplier'], 200),
      documentNumber: text(body['documentNumber'], 100),
      note: text(body['note'], 500),
      maintenanceRequestId,
      taskCompletionId,
    };
    try {
      return { id: await recordCost(currentTenant().organizationId, currentTenant().membershipId, input) };
    } catch (error) {
      refused(error);
    }
  }

  /** Materials bought: the stock rises with it. */
  @Post('purchases')
  async purchase(@Body() body: Record<string, unknown>): Promise<{ id: string }> {
    requireRole('owner', 'admin', 'maintenance');
    const itemId = uuid(body['inventoryItemId'], 'inventoryItemId');
    const quantity = body['quantity'];
    if (itemId === null) throw new BadRequestException('inventoryItemId is needed');
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000) {
      throw new BadRequestException('quantity is a whole number, 1 or more');
    }
    try {
      const id = await recordPurchase(currentTenant().organizationId, currentTenant().membershipId, {
        inventoryItemId: itemId,
        quantity,
        amountCents: cents(body['amountCents'], 'amountCents'),
        vatCents: body['vatCents'] === undefined ? 0 : cents(body['vatCents'], 'vatCents'),
        boughtOn: day(body['boughtOn'], 'boughtOn'),
        supplier: text(body['supplier'], 200),
        documentNumber: text(body['documentNumber'], 100),
      });
      if (id === null) throw new NotFoundException('No such inventory item');
      return { id };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      refused(error);
    }
  }

  /** An insurance policy's premium; its period is the policy's. */
  @Put('premiums/:policyId')
  async premium(
    @Param('policyId', ParseUUIDPipe) policyId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ saved: true }> {
    requireRole('owner', 'admin');
    const premium = body['premiumCents'] === null ? null : cents(body['premiumCents'], 'premiumCents');
    const vat = body['premiumVatCents'] === undefined || body['premiumVatCents'] === null ? null : cents(body['premiumVatCents'], 'premiumVatCents');
    if (!(await setPremium(currentTenant().organizationId, policyId, premium, vat))) {
      throw new NotFoundException('No such policy');
    }
    return { saved: true };
  }
}
