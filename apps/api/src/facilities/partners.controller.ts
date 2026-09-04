import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireRole } from '../tenant/roles.js';
import { readPageQuery, type Paginated } from '../common/pagination.js';
import {
  MAX_PARTNER_ROWS,
  PARTNER_IMPORT_FIELDS,
  type PartnerImportField,
  type RawPartnerRow,
} from './partner-import.js';
import {
  addContact,
  addGroup,
  archiveGroup,
  archivePartner,
  BILLING_MODELS,
  createPartner,
  DuplicateNameError,
  getPartner,
  isBillingModel,
  isPartnerStatus,
  isPartnerType,
  listBookablePartners,
  listPartners,
  runPartnerImport,
  type PartnerImportResult,
  PARTNER_TYPES,
  PartnerInUseError,
  removeContact,
  setAgreement,
  updateGroup,
  updatePartner,
  type AgreementInput,
  type ContactInput,
  type GroupInput,
  type PartnerDetail,
  type PartnerInput,
  type PartnerRow,
} from './partners.repository.js';

/**
 * Parcerias, through their endpoints — POOLSE-47.
 *
 * Its own controller rather than more methods on `FacilitiesController`, which
 * is already 700 lines about sites, pools, hours and analyses. A partnership is
 * a fifth thing and is about to be read by the lane grid as often as by this
 * screen.
 *
 * **Reads are open to any member; every write is owner/admin** — criterion 12,
 * and the standing convention that a permission rule is enforced here and never
 * by hiding a control. An instructor needs to see that lane 3 belongs to
 * `ES D. Dinis` on Tuesday morning; they have no business editing the contract.
 * `partners.integration.test.ts` issues a denial against each write.
 *
 * **The money never becomes a JavaScript number.** `unitPrice` arrives as a
 * string, is validated as a decimal string, and goes to Postgres as text cast to
 * `numeric`. €14.375 through a float and back is precisely the rounding the
 * column type exists to prevent, and a parse here would undo the schema.
 */
@Controller()
export class PartnersController {
  /**
   * A facility's partners, one page, with the derived columns — criterion 8.
   *
   * Paginated at `PAGE_SIZE`, because a club's partner list grows as it sells
   * more water (criterion 11). The groups table inside one partner is exempt and
   * that exemption is written down in `docs/backlog/CONVENTIONS.md` — it is
   * bounded by its partner.
   */
  @Get('facilities/:facilityId/partners')
  async list(
    @Param('facilityId') facilityId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<Paginated<PartnerRow> & { canManage: boolean }> {
    const { organizationId } = currentTenant();

    const result = await listPartners(organizationId, facilityId, readPageQuery(page, limit));

    return { ...result, canManage: hasRole('owner', 'admin') };
  }

  /**
   * The partners a picker may offer — QA 47.11.
   *
   * Active ones only, with their groups, for the grid's picker in POOLSE-50. An
   * `inativa` partner is absent here and still named on every booking it already
   * has, which is the whole point of the status.
   */
  @Get('facilities/:facilityId/partners/bookable')
  async bookable(@Param('facilityId') facilityId: string): Promise<{
    partners: { id: string; name: string; color: string; groups: { id: string; name: string }[] }[];
  }> {
    const { organizationId } = currentTenant();
    return { partners: await listBookablePartners(organizationId, facilityId) };
  }

  @Get('partners/:partnerId')
  async detail(
    @Param('partnerId') partnerId: string,
  ): Promise<PartnerDetail & { canManage: boolean }> {
    const { organizationId } = currentTenant();

    const partner = await getPartner(organizationId, partnerId);
    if (partner === null) throw new NotFoundException('No such partner');

    return { ...partner, canManage: hasRole('owner', 'admin') };
  }

  @Post('facilities/:facilityId/partners')
  async create(
    @Param('facilityId') facilityId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    let created: { id: string } | null;
    try {
      created = await createPartner(organizationId, facilityId, readPartner(body));
    } catch (error) {
      throw asHttp(error);
    }

    if (created === null) throw new NotFoundException('No such site');
    return created;
  }

  @Patch('partners/:partnerId')
  async edit(
    @Param('partnerId') partnerId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ updated: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    let updated: boolean;
    try {
      updated = await updatePartner(organizationId, partnerId, readPartner(body));
    } catch (error) {
      throw asHttp(error);
    }

    if (!updated) throw new NotFoundException('No such partner');
    return { updated: true };
  }

  @Delete('partners/:partnerId')
  async remove(@Param('partnerId') partnerId: string): Promise<{ archived: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    let archived: boolean;
    try {
      archived = await archivePartner(organizationId, partnerId);
    } catch (error) {
      throw asHttp(error);
    }

    if (!archived) throw new NotFoundException('No such partner');
    return { archived: true };
  }

  @Post('partners/:partnerId/contacts')
  async addPartnerContact(
    @Param('partnerId') partnerId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const created = await addContact(organizationId, partnerId, readContact(body));
    if (created === null) throw new NotFoundException('No such partner');
    return created;
  }

  @Delete('partners/contacts/:contactId')
  async removePartnerContact(
    @Param('contactId') contactId: string,
  ): Promise<{ archived: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const archived = await removeContact(organizationId, contactId);
    if (!archived) throw new NotFoundException('No such contact');
    return { archived: true };
  }

  @Post('partners/:partnerId/agreement')
  async recordAgreement(
    @Param('partnerId') partnerId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const created = await setAgreement(organizationId, partnerId, readAgreement(body));
    if (created === null) throw new NotFoundException('No such partner');
    return created;
  }


  /**
   * Importing a partnerships sheet — POOLSE-48.
   *
   * Preview and commit are one route with a flag, for the reason the register and
   * the inventory both settled: two routes would be two places the rows are
   * turned into records, and applying them differently is how an approved preview
   * becomes a different set of writes.
   *
   * **Owner and admin** — criterion 11. Creating one partner is owner/admin on the
   * form, so creating forty from a file is owner/admin too. An import that took a
   * role the single create refuses would be the permission model, worked around by
   * uploading a spreadsheet.
   *
   * On a literal segment, so `/facilities/:id/partners/import` can never be read
   * as a partner whose id is the word "import".
   */
  @Post('facilities/:facilityId/partners/import')
  async import(
    @Param('facilityId') facilityId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<PartnerImportResult> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const result = await runPartnerImport(organizationId, {
      facilityId,
      rows: readImportRows(body['rows']),
      commit: body['commit'] === true,
      include: readInclude(body['include']),
    });

    if (result === null) throw new NotFoundException('No such site');
    return result;
  }

  @Post('partners/:partnerId/groups')
  async createGroup(
    @Param('partnerId') partnerId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    let created: { id: string } | null;
    try {
      created = await addGroup(organizationId, partnerId, readGroup(body));
    } catch (error) {
      throw asHttp(error);
    }

    if (created === null) throw new NotFoundException('No such partner');
    return created;
  }

  @Patch('partners/groups/:groupId')
  async editGroup(
    @Param('groupId') groupId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ updated: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    let updated: boolean;
    try {
      updated = await updateGroup(organizationId, groupId, readGroup(body));
    } catch (error) {
      throw asHttp(error);
    }

    if (!updated) throw new NotFoundException('No such group');
    return { updated: true };
  }

  @Delete('partners/groups/:groupId')
  async removeGroup(@Param('groupId') groupId: string): Promise<{ archived: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    let archived: boolean;
    try {
      archived = await archiveGroup(organizationId, groupId);
    } catch (error) {
      throw asHttp(error);
    }

    if (!archived) throw new NotFoundException('No such group');
    return { archived: true };
  }
}

/**
 * The rows, off the wire.
 *
 * Keys the API does not know are dropped rather than refused: the web app maps
 * columns and only sends what it mapped, so an unknown key means the two halves
 * are out of step and silently ignoring it is kinder than a 400 nobody can act
 * on. Every value becomes a string — the file reader already made them strings,
 * and a number arriving here would reach `previewPartners` untrimmed.
 */
function readImportRows(raw: unknown): RawPartnerRow[] {
  if (!Array.isArray(raw)) throw new BadRequestException('rows must be a list');
  if (raw.length === 0) throw new BadRequestException('rows is empty');
  if (raw.length > MAX_PARTNER_ROWS) {
    throw new BadRequestException(`at most ${MAX_PARTNER_ROWS} rows in one import`);
  }

  const known = new Set<string>(PARTNER_IMPORT_FIELDS);

  return raw.map((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new BadRequestException('each row must be an object of field to value');
    }

    const row: RawPartnerRow = {};
    for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
      if (!known.has(key)) continue;
      if (value === null || value === undefined) continue;
      row[key as PartnerImportField] = typeof value === 'string' ? value : String(value);
    }
    return row;
  });
}

/** Which rows the operator ticked. Null is "you decide", not "none of them". */
function readInclude(raw: unknown): number[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) throw new BadRequestException('include must be a list of row indexes');

  return raw.map((value) => {
    const index = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(index) || index < 0) {
      throw new BadRequestException('include must be row indexes');
    }
    return index;
  });
}

function asHttp(error: unknown): unknown {
  if (error instanceof DuplicateNameError) {
    return new ConflictException({ message: 'partnerNameTaken', name: error.name });
  }

  if (error instanceof PartnerInUseError) {
    return new ConflictException({ message: 'partnerInUse', bookings: error.bookings });
  }

  return error;
}

function readText(raw: unknown, field: string, max: number): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new BadRequestException(`${field} is required`);
  }
  const value = raw.trim();
  if (value.length > max) throw new BadRequestException(`${field} is too long`);
  return value;
}

function optionalText(raw: unknown, field: string, max: number): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') throw new BadRequestException(`${field} must be text`);
  const value = raw.trim();
  if (value === '') return null;
  if (value.length > max) throw new BadRequestException(`${field} is too long`);
  return value;
}

function readPartner(body: Record<string, unknown>): PartnerInput {
  const type = body['type'];
  if (!isPartnerType(type)) {
    throw new BadRequestException(`type must be one of ${PARTNER_TYPES.join(', ')}`);
  }

  // Defaults to ativa: a partnership somebody is entering is one they are
  // starting, and asking for the state of a thing being created is a question
  // with one sensible answer.
  const rawStatus = body['status'];
  const status = rawStatus === undefined || rawStatus === null ? 'ativa' : rawStatus;
  if (!isPartnerStatus(status)) {
    throw new BadRequestException('status must be ativa or inativa');
  }

  const color = optionalText(body['color'], 'color', 7) ?? '#67a6b6';
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw new BadRequestException('color must be a hex colour like #67a6b6');
  }

  const nif = optionalText(body['nif'], 'nif', 9);
  if (nif !== null && !/^[0-9]{9}$/.test(nif)) {
    throw new BadRequestException('nif must be nine digits');
  }

  return {
    name: readText(body['name'], 'name', 160),
    type,
    status,
    color,
    nif,
    address: optionalText(body['address'], 'address', 400),
    notes: optionalText(body['notes'], 'notes', 2000),
  };
}

function readContact(body: Record<string, unknown>): ContactInput {
  const email = optionalText(body['email'], 'email', 254);
  const phone = optionalText(body['phone'], 'phone', 40);

  /*
   * Refused here as well as by the CHECK, so the operator is told what to do.
   *
   * The constraint would catch it, but a constraint name reaching a form is not
   * a message anybody can act on — and this one is genuinely a rule about the
   * data rather than a typo: a contact nobody can reach is a name in a box.
   */
  if (email === null && phone === null) {
    throw new BadRequestException({
      code: 'contact_unreachable',
      message: 'A contact needs an email address or a telephone number',
      fields: { email: 'partners.contactReachable' },
    });
  }

  return {
    name: readText(body['name'], 'name', 160),
    role: optionalText(body['role'], 'role', 160),
    email,
    phone,
  };
}

/**
 * A date as `YYYY-MM-DD`, off the wire.
 *
 * Kept as a string all the way to Postgres, which casts it. A `Date` here would
 * carry a timezone into a column that has none, and "the contract starts on
 * 1 September" is a calendar date rather than a moment.
 */
function readDate(raw: unknown, field: string): string {
  const value = readText(raw, field, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${field} must be a date like 2026-09-01`);
  }
  return value;
}

function optionalDate(raw: unknown, field: string): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  return readDate(raw, field);
}

/**
 * A decimal, validated as text and never parsed.
 *
 * This is the ticket's "most likely to be got wrong", handled at the layer where
 * it would go wrong: `Number('14.375')` is fine, but the habit of parsing leads
 * to rounding, and there is no reason to ever hold this as a float. It is
 * checked for shape and range against a string and handed to Postgres as one.
 */
function readDecimal(raw: unknown, field: string, maxIntegerDigits: number): string {
  const value = readText(raw, field, 24).replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new BadRequestException(`${field} must be a number like 14.375`);
  }

  const [whole = '', fraction = ''] = value.split('.');
  if (whole.length > maxIntegerDigits) {
    throw new BadRequestException(`${field} is too large`);
  }
  if (fraction.length > 6) {
    throw new BadRequestException(`${field} has more than six decimal places`);
  }

  return value;
}

function readAgreement(body: Record<string, unknown>): AgreementInput {
  const billingModel = body['billingModel'];
  if (!isBillingModel(billingModel)) {
    throw new BadRequestException(`billingModel must be one of ${BILLING_MODELS.join(', ')}`);
  }

  const startDate = readDate(body['startDate'], 'startDate');
  const endDate = optionalDate(body['endDate'], 'endDate');
  if (endDate !== null && endDate < startDate) {
    throw new BadRequestException('endDate must be on or after startDate');
  }

  /*
   * Null is isento — criterion 5, and the reason this is not simply optional.
   *
   * The wire carries a percentage because that is what a contract says (23), and
   * the column holds a fraction because that is what it is multiplied by. The
   * conversion is one division on a string, done here rather than in the browser
   * so that both the form and the import land on the same rule.
   */
  const rawVat = body['vatRate'];
  let vatRate: string | null = null;
  if (rawVat !== null && rawVat !== undefined && rawVat !== '') {
    const percent = readDecimal(rawVat, 'vatRate', 2);
    if (Number(percent) >= 100) {
      throw new BadRequestException('vatRate must be below 100');
    }
    vatRate = (Number(percent) / 100).toFixed(4);
  }

  return {
    seasonId: optionalText(body['seasonId'], 'seasonId', 40),
    startDate,
    endDate,
    billingModel,
    // Six integer digits: a per-hour lane price of 999 999 is far past anything
    // real and stops a mistyped figure reaching a numeric(12,6) as an overflow.
    unitPrice: readDecimal(body['unitPrice'], 'unitPrice', 6),
    vatRate,
    paymentPeriod: optionalText(body['paymentPeriod'], 'paymentPeriod', 40),
    notes: optionalText(body['notes'], 'notes', 2000),
  };
}

function readGroup(body: Record<string, unknown>): GroupInput {
  const rawCount = body['participantCount'];
  const participantCount =
    rawCount === null || rawCount === undefined || rawCount === '' ? 0 : Number(rawCount);

  if (!Number.isInteger(participantCount) || participantCount < 0 || participantCount > 10_000) {
    throw new BadRequestException('participantCount must be a whole number, zero or more');
  }

  const bringsOwnInstructor = body['bringsOwnInstructor'] === true;

  /*
   * The name is dropped when the flag is off, rather than refused.
   *
   * The CHECK forbids the combination, and a 400 here would be technically
   * correct and practically annoying: somebody unticking "traz professor" has
   * said what they mean, and the stale name is a leftover rather than an
   * instruction. Clearing it is what they intended; erroring would make them do
   * it by hand.
   */
  const ownInstructorName = bringsOwnInstructor
    ? optionalText(body['ownInstructorName'], 'ownInstructorName', 160)
    : null;

  return {
    name: readText(body['name'], 'name', 120),
    participantCount,
    levelId: optionalText(body['levelId'], 'levelId', 40),
    bringsOwnInstructor,
    ownInstructorName,
    tag: optionalText(body['tag'], 'tag', 40),
    notes: optionalText(body['notes'], 'notes', 2000),
  };
}
