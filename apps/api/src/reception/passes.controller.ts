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
} from '@nestjs/common';
import { isValidNif } from '@poolse/rules';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireRole } from '../tenant/roles.js';
import {
  archiveProduct,
  cancelCheckIn,
  checkIn,
  checkOut,
  createProduct,
  createWalkIn,
  listProducts,
  passesOf,
  readReception,
  sellPass,
  setStayMinutes,
  updateProduct,
  NoSeriesError,
  NoSuchPersonError,
  NoSuchProductError,
  OwnerRequiredError,
  type Pass,
  type PassKind,
  type PassProduct,
  type PassProductInput,
  type Reception,
  type Sale,
} from './passes.repository.js';

/**
 * Free swim, entry passes and reception check-in — POOLSE-68.
 *
 * **Owner and admin, for every read and every write.** There is no reception
 * role; until there is, the people at the desk are the club's management. An
 * instructor or a student is refused on every route here (QA 6), and the
 * products' prices are money the price list already refuses an instructor.
 *
 * Under `/facilities/:facilityId/…` because a pass is sold by a site and used
 * at that site.
 */

const KINDS: readonly PassKind[] = ['single', 'pack', 'period'];
const MAX_NAME = 60;

@Controller('facilities/:facilityId/pass-products')
export class PassProductsController {
  @Get()
  async list(
    @Param('facilityId') facilityId: string,
  ): Promise<{ products: PassProduct[]; stayMinutes: number }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();
    const found = await listProducts(organizationId, facilityId);
    if (found === null) throw new NotFoundException('No such facility');
    return found;
  }

  @Post()
  async create(
    @Param('facilityId') facilityId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();
    try {
      const id = await createProduct(organizationId, facilityId, readProduct(body));
      if (id === null) throw new NotFoundException('No such facility');
      return { id };
    } catch (error) {
      throw duplicateName(error);
    }
  }

  @Patch(':productId')
  async update(
    @Param('facilityId') facilityId: string,
    @Param('productId') productId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ updated: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();
    try {
      if (!(await updateProduct(organizationId, facilityId, productId, readProduct(body)))) {
        throw new NotFoundException('No such product');
      }
    } catch (error) {
      throw duplicateName(error);
    }
    return { updated: true };
  }

  @Post(':productId/archive')
  async archive(
    @Param('facilityId') facilityId: string,
    @Param('productId') productId: string,
  ): Promise<{ archived: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();
    if (!(await archiveProduct(organizationId, facilityId, productId))) {
      throw new NotFoundException('No such product');
    }
    return { archived: true };
  }
}

@Controller('facilities/:facilityId/reception')
export class ReceptionController {
  @Get()
  async read(@Param('facilityId') facilityId: string): Promise<Reception> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();
    const reception = await readReception(organizationId, facilityId);
    if (reception === null) throw new NotFoundException('No such facility');
    return reception;
  }

  @Patch('stay')
  async stay(
    @Param('facilityId') facilityId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ updated: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();
    const minutes = body['minutes'];
    if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 15 || minutes > 720) {
      throw new BadRequestException({
        message: 'minutes must be a whole number from 15 to 720',
        fields: { minutes: 'passes.stayInvalid' },
      });
    }
    if (!(await setStayMinutes(organizationId, facilityId, minutes))) {
      throw new NotFoundException('No such facility');
    }
    return { updated: true };
  }

  @Get('people/:membershipId/passes')
  async passes(
    @Param('facilityId') facilityId: string,
    @Param('membershipId') membershipId: string,
  ): Promise<{ passes: Pass[] }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();
    return { passes: await passesOf(organizationId, facilityId, membershipId) };
  }

  /** Somebody new at the desk, to sell a pack or a monthly pass to. */
  @Post('people')
  async walkIn(@Body() body: Record<string, unknown>): Promise<{ membershipId: string }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const firstName = text(body['firstName']);
    const lastName = text(body['lastName']);
    const email = text(body['email']);
    const phone = text(body['phone']);
    const taxNumber = text(body['taxNumber']);

    const fields: Record<string, string> = {};
    if (firstName === null) fields['firstName'] = 'passes.firstNameRequired';
    if (lastName === null) fields['lastName'] = 'passes.lastNameRequired';
    if (taxNumber !== null && !isValidNif(taxNumber)) fields['taxNumber'] = 'students.nifInvalid';
    if (Object.keys(fields).length > 0) {
      throw new BadRequestException({ message: 'Invalid person', fields });
    }

    try {
      return {
        membershipId: await createWalkIn(organizationId, {
          firstName: firstName!,
          lastName: lastName!,
          email,
          phone,
          taxNumber,
        }),
      };
    } catch (error) {
      // The club already knows this email or NIF: the person exists, and the
      // answer is to find them rather than make a second one.
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException({
          code: 'person_exists',
          message: 'Somebody in this club already has that email or NIF',
          fields: { email: 'passes.personExists' },
        });
      }
      throw error;
    }
  }

  @Post('sales')
  async sell(
    @Param('facilityId') facilityId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<Sale> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const productId = text(body['productId']);
    if (productId === null) {
      throw new BadRequestException({
        message: 'productId is required',
        fields: { productId: 'passes.productRequired' },
      });
    }
    const validFrom = text(body['validFrom']);
    if (validFrom !== null && !/^\d{4}-\d{2}-\d{2}$/.test(validFrom)) {
      throw new BadRequestException({
        message: 'validFrom must be YYYY-MM-DD',
        fields: { validFrom: 'passes.validFromInvalid' },
      });
    }

    try {
      return await sellPass(organizationId, facilityId, {
        productId,
        membershipId: text(body['membershipId']),
        validFrom,
        checkInPoolId: text(body['checkInPoolId']),
      });
    } catch (error) {
      if (error instanceof NoSuchProductError) throw new NotFoundException('No such product');
      if (error instanceof NoSuchPersonError) throw new NotFoundException('No such person');
      if (error instanceof OwnerRequiredError) {
        throw new BadRequestException({
          code: 'pass_owner_required',
          message: 'Only a single entry may be sold to nobody in particular',
          fields: { membershipId: 'passes.ownerRequired' },
        });
      }
      if (error instanceof NoSeriesError) {
        throw new ConflictException({
          code: 'no_invoice_series',
          message: 'This site has no invoice series to number the sale in',
        });
      }
      throw checkInRefusal(error);
    }
  }

  @Post('check-ins')
  async checkIn(
    @Param('facilityId') facilityId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const passId = text(body['passId']);
    const poolId = text(body['poolId']);
    if (passId === null || poolId === null) {
      throw new BadRequestException({
        message: 'passId and poolId are required',
        fields: { poolId: 'passes.poolRequired' },
      });
    }

    try {
      const id = await checkIn(organizationId, facilityId, passId, poolId);
      if (id === null) throw new NotFoundException('No such pass');
      return { id };
    } catch (error) {
      throw checkInRefusal(error);
    }
  }

  @Post('check-ins/:checkInId/check-out')
  async checkOut(
    @Param('facilityId') facilityId: string,
    @Param('checkInId') checkInId: string,
  ): Promise<{ checkedOut: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();
    if (!(await checkOut(organizationId, facilityId, checkInId))) {
      throw new NotFoundException('No such check-in in the water');
    }
    return { checkedOut: true };
  }

  @Post('check-ins/:checkInId/cancel')
  async cancel(
    @Param('facilityId') facilityId: string,
    @Param('checkInId') checkInId: string,
  ): Promise<{ cancelled: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();
    if (!(await cancelCheckIn(organizationId, facilityId, checkInId))) {
      throw new NotFoundException('No such check-in');
    }
    return { cancelled: true };
  }
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function readProduct(body: Record<string, unknown>): PassProductInput {
  const fields: Record<string, string> = {};

  const kind = body['kind'];
  if (typeof kind !== 'string' || !KINDS.includes(kind as PassKind)) {
    fields['kind'] = 'passes.kindRequired';
  }
  const name = text(body['name']) ?? '';
  if (name === '') fields['name'] = 'passes.nameRequired';
  else if (name.length > MAX_NAME) fields['name'] = 'passes.nameTooLong';

  const amountCents = body['amountCents'];
  if (typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents < 0) {
    fields['amountCents'] = 'fees.amountInvalid';
  }

  const whole = (raw: unknown): number | null =>
    raw === null || raw === undefined || raw === '' ? null : Number(raw);
  const entries = whole(body['entries']);
  const validityDays = whole(body['validityDays']);

  if (kind === 'pack' && (entries === null || !Number.isInteger(entries) || entries < 2 || entries > 500)) {
    fields['entries'] = 'passes.entriesInvalid';
  }
  if (
    kind !== 'single' &&
    validityDays !== null &&
    (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 3660)
  ) {
    fields['validityDays'] = 'passes.validityInvalid';
  }
  if (kind === 'period' && validityDays === null) fields['validityDays'] = 'passes.validityRequired';

  const vatExempt = body['vatExempt'] === true;
  const vatRate = vatExempt ? 0 : Number(body['vatRate'] ?? 0);
  if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
    fields['vatRate'] = 'passes.vatInvalid';
  }

  if (Object.keys(fields).length > 0) {
    throw new BadRequestException({ message: 'Invalid pass product', fields });
  }

  return {
    kind: kind as PassKind,
    name,
    entries,
    validityDays,
    amountCents: amountCents as number,
    vatRate,
    vatExempt,
  };
}

function duplicateName(error: unknown): unknown {
  if ((error as { code?: string }).code === '23505') {
    return new ConflictException({
      code: 'pass_product_name_taken',
      message: 'This site already sells a product with that name',
      fields: { name: 'passes.nameTaken' },
    });
  }
  return error;
}

/**
 * Every reason an entry is refused, read off the trigger's DETAIL.
 *
 * The figures come out of the database — `pool_occupancy|40|40|1` — rather than
 * being recounted here, the arrangement `poolCapacityRefusal` set out: two
 * implementations of one count agree until the day a refusal quotes a number
 * the operator cannot see on the screen.
 */
export function checkInRefusal(error: unknown): unknown {
  const detail = (error as { detail?: unknown }).detail;
  if (typeof detail !== 'string') return error;
  const [reason, ...figures] = detail.split('|');

  switch (reason) {
    case 'pool_occupancy': {
      const [capacity, occupied, requested] = figures.map(Number);
      return new ConflictException({
        code: 'pool_full_now',
        message: `The tank holds ${capacity}; ${occupied} are in the water`,
        values: { capacity, occupied, requested },
      });
    }
    case 'pass_used_up':
      return new ConflictException({
        code: 'pass_used_up',
        message: 'Every entry on this pass is used',
        values: { entries: Number(figures[0]) },
      });
    case 'pass_expired':
      return new ConflictException({
        code: 'pass_expired',
        message: 'This pass has ended',
        values: { date: figures[0] },
      });
    case 'pass_not_yet':
      return new ConflictException({
        code: 'pass_not_yet',
        message: 'This pass has not started',
        values: { date: figures[0] },
      });
    case 'pass_void':
      return new ConflictException({ code: 'pass_void', message: 'This pass was credited' });
    case 'pass_in_water':
      return new ConflictException({
        code: 'pass_in_water',
        message: 'Somebody on this pass is already in the water',
      });
    case 'pass_wrong_site':
      return new BadRequestException({
        code: 'pass_wrong_site',
        message: 'A pass is used at the site that sold it, in one of its tanks',
      });
    default:
      return error;
  }
}
