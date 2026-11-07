import { isSupportMembership, studentLacksPhotoConsent } from './staff.repository.js';
import {
  BadRequestException,
  Body,
  Controller,
  ConflictException,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  Post,

  Query,
} from '@nestjs/common';
import { judgeUpload } from '../files/upload-check.js';
import {
  isIdDocumentType,
  isPoolseSport,
  isValidCcNumber,
  isValidNif,
  isValidNiss,
  normalizeCcNumber,
  normalizeNiss,
} from '@poolse/rules';
import { clubToday } from '../common/club-day.js';
import {
  attachContract,
  CONTRACT_KINDS,
  readContract,
  removeContract,
  writeContractFacts,
  type ContractFacts,
  type ContractKind,
  type StaffContract,
} from './contract.repository.js';
import {
  CLUB_DETAIL_FIELDS,
  DETAIL_COLUMNS,
  readDetails,
  TaxNumberTakenError,
  writeDetails,
  type StaffDetails,
} from './details.repository.js';
import {
  attachIdPhoto,
  BirthDateIsTheirsError,
  ID_PHOTO_SIDES,
  readIdentity,
  removeIdPhoto,
  writeIdentity,
  type IdPhotoSide,
  type IdentityEdit,
  type StaffIdentity,
} from './identity.repository.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireRole } from '../tenant/roles.js';
import { removeClerkPhoto, updateClerkName, updateClerkPhoto } from '../identity/identity.service.js';
import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { MAX_FILE_BYTES, sniffType } from '../files/storage.js';
import { invitationExpiry, issueToken, normaliseEmail } from '../invitations/invitations.service.js';
import { deliver } from '../invitations/invitations.controller.js';
import {
  cancelReinvite,
  findStaff,
  reinvite,
  setStaffSports,
  SportNotEnabledError,
  updateStaff,
  type StaffRecord,
} from './staff.repository.js';
import { CoreRoute } from '../tenant/modules.js';

const MAX_NAME = 120;
const MAX_PHONE = 40;
const MAX_NOTES = 2000;

/**
 * The staff record — POOLSE-39.
 *
 * **Who may edit what**, per the decision recorded in the ticket:
 *
 * - Owner and Admin edit anybody's phone, address and sports.
 * - **Only the Owner** edits the NIF, the NISS, the ID document, the contract and
 *   the notes (Rui, 07-11-2026). An Admin reads them. The person keeps their own
 *   identity, and a name of somebody who signs in is the person's or the Owner's.
 * - An Instructor edits **their own name and phone**, and nothing else. A
 *   misspelled name needing an admin is the complaint that produced this ticket,
 *   and notes are frequently what an admin writes *about* somebody rather than
 *   what they write about themselves.
 * - Nobody edits an email, ever. It is the login identity; it moves by
 *   re-invitation and by nothing else.
 *
 * Role changes are not here at all — they go through `PeopleDedupController`,
 * which applies the POOLSE-01 matrix. AC5 asks for one guard rather than a
 * second endpoint with its own rules, and two endpoints is how the second one
 * ends up more permissive.
 */
@CoreRoute()
@Controller('staff')
export class StaffController {
  /**
   * Date of birth and identity document — POOLSE-100. Owner and admin, and the
   * person on their own record; anybody else is a 403 here as it is on the
   * record. Its own route, so the number is never in the record, the list, the
   * export or the import. A read by anybody but the person is audited.
   */
  @Get(':membershipId/identity')
  async identity(@Param('membershipId', new ParseUUIDPipe()) membershipId: string): Promise<StaffIdentity> {
    const actor = requireOwnOrManaged(membershipId);
    const found = await readIdentity(currentTenant().organizationId, membershipId, actor);
    if (found === null) throw new NotFoundException('No such staff member');
    return found;
  }

  @Patch(':membershipId/identity')
  async editIdentity(
    @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<StaffIdentity> {
    const actor = requireOwnerOrSelf(membershipId);
    const { organizationId } = currentTenant();
    try {
      const corrects = hasRole('owner') && membershipId !== actor;
      if (!(await writeIdentity(organizationId, membershipId, parseIdentity(body), corrects))) {
        throw new NotFoundException('No such staff member');
      }
    } catch (error) {
      if (error instanceof BirthDateIsTheirsError) {
        throw new ConflictException({
          code: 'birth_date_is_theirs',
          message: 'A login holder sets their own date of birth in their profile',
          fields: { birthDate: 'staffIdentity.errors.birthDateIsTheirs' },
        });
      }
      throw error;
    }
    return (await readIdentity(organizationId, membershipId, actor))!;
  }

  /**
   * The contract — POOLSE-149 slice C. Read as pay is: owner and admin, and
   * the person; an Admin never the Owner's, which is a 404 (absent, not
   * refused). Written by owner and admin through the same predicate.
   */
  @Get(':membershipId/contract')
  async contract(@Param('membershipId', new ParseUUIDPipe()) membershipId: string): Promise<StaffContract> {
    requireOwnOrManaged(membershipId);
    const found = await readContract(currentTenant().organizationId, membershipId, hasRole('owner'));
    if (found === null) throw new NotFoundException('No such staff member');
    return { ...found, canEdit: mayWriteContract() };
  }

  @Patch(':membershipId/contract')
  async editContract(
    @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<StaffContract> {
    requireRole('owner');
    const { organizationId } = currentTenant();
    if (!(await writeContractFacts(organizationId, membershipId, hasRole('owner'), parseContractFacts(body)))) {
      throw new NotFoundException('No such staff member');
    }
    return { ...(await readContract(organizationId, membershipId, hasRole('owner')))!, canEdit: true };
  }

  /** Files a new contract, PDF or Word; the current one becomes history. */
  @Post(':membershipId/contract/file')
  async fileContract(
    @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
    @Query('name') name: string | undefined,
    @Body() body: unknown,
  ): Promise<{ fileId: string }> {
    requireRole('owner');
    const { bytes, contentType, originalName } = judgeUpload('staff_contract', body, name);
    const filed = await attachContract(
      currentTenant().organizationId,
      membershipId,
      hasRole('owner'),
      bytes,
      contentType,
      originalName,
    );
    if (filed === null) throw new NotFoundException('No such staff member');
    return filed;
  }

  /** Takes the current contract off; it stays in the history. */
  @Delete(':membershipId/contract/file')
  async removeContract(@Param('membershipId', new ParseUUIDPipe()) membershipId: string): Promise<{ removed: true }> {
    requireRole('owner');
    if (!(await removeContract(currentTenant().organizationId, membershipId, hasRole('owner')))) {
      throw new NotFoundException('No contract on file');
    }
    return { removed: true };
  }

  /**
   * The ID document's photograph, one side at a time — POOLSE-149 slice B.
   * The same three people as the number. One step, never `POST /files` then an
   * attach: the file is sealed, registered and attached in one transaction, and
   * the side's previous photograph is shredded as it is replaced.
   */
  @Post(':membershipId/identity/photo/:side')
  async fileIdPhoto(
    @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
    @Param('side') side: string,
    @Query('name') name: string | undefined,
    @Body() body: unknown,
  ): Promise<{ fileId: string }> {
    requireOwnerOrSelf(membershipId);
    const { bytes, contentType, originalName } = judgeUpload('staff_id_document', body, name);
    const filed = await attachIdPhoto(
      currentTenant().organizationId,
      membershipId,
      photoSide(side),
      bytes,
      contentType,
      originalName,
    );
    if (filed === null) throw new NotFoundException('No such staff member');
    return filed;
  }

  /**
   * The photograph of somebody who signs in, corrected by the Owner (Rui,
   * 07-11-2026). It is their account's, so it goes to Clerk and follows them to
   * any other club, like the name. Support is an Admin here and is refused.
   */
  @Put(':membershipId/login-photo')
  async setLoginPhoto(
    @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
    @Body() body: unknown,
  ): Promise<{ saved: true }> {
    requireRole('owner');
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new BadRequestException({ code: 'file_empty', message: 'No file was sent' });
    }
    if (body.length > MAX_FILE_BYTES) {
      throw new BadRequestException({ code: 'file_too_large', message: 'A file may be at most 10 MB' });
    }
    const type = sniffType(body);
    if (type === null || !type.startsWith('image/')) {
      throw new BadRequestException({ code: 'file_type', message: 'This needs an image' });
    }
    const clerkUserId = await loginOf(membershipId);
    // A face reaches Clerk on the same terms as the club's own copy.
    if (await studentLacksPhotoConsent(currentTenant().organizationId, membershipId)) {
      throw new ConflictException({ code: 'photo_no_consent', message: 'There is no live photo consent' });
    }
    await onTheRecord(membershipId, () => updateClerkPhoto(clerkUserId, body, type));
    return { saved: true };
  }

  @Delete(':membershipId/login-photo')
  async removeLoginPhoto(
    @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
  ): Promise<{ removed: true }> {
    requireRole('owner');
    const clerkUserId = await loginOf(membershipId);
    await onTheRecord(membershipId, () => removeClerkPhoto(clerkUserId));
    return { removed: true };
  }

  /** Takes a side's photograph off; the database shreds it. */
  @Delete(':membershipId/identity/photo/:side')
  async removeIdPhoto(
    @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
    @Param('side') side: string,
  ): Promise<{ removed: true }> {
    requireOwnerOrSelf(membershipId);
    if (!(await removeIdPhoto(currentTenant().organizationId, membershipId, photoSide(side)))) {
      throw new NotFoundException('No photograph on that side');
    }
    return { removed: true };
  }

  /**
   * Personal details — POOLSE-149 slice A. Owner and admin, and the person on
   * their own record, as for the identity document. The person edits their
   * address, nationality, birthplace and emergency contact; the NIF and NISS
   * are the club's (`CLUB_DETAIL_FIELDS`), and changing one of those as anybody
   * else is refused rather than ignored.
   */
  @Get(':membershipId/details')
  async details(@Param('membershipId', new ParseUUIDPipe()) membershipId: string): Promise<StaffDetails> {
    requireOwnOrManaged(membershipId);
    const found = await readDetails(currentTenant().organizationId, membershipId);
    if (found === null) throw new NotFoundException('No such staff member');
    return found;
  }

  @Patch(':membershipId/details')
  async editDetails(
    @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<StaffDetails> {
    requireOwnOrManaged(membershipId);
    const { organizationId } = currentTenant();
    const edit = parseDetails(body);

    const was = await readDetails(organizationId, membershipId);
    if (was === null) throw new NotFoundException('No such staff member');
    if (!hasRole('owner')) {
      const clubs = CLUB_DETAIL_FIELDS.filter((field) => edit[field] !== undefined && edit[field] !== was[field]);
      if (clubs.length > 0) {
        throw new ForbiddenException({
          code: 'forbidden_role',
          message: 'The NIF and NISS are recorded by the owner',
          fields: Object.fromEntries(clubs.map((field) => [field, 'staffDetails.errors.clubsToSet'])),
        });
      }
    }

    try {
      if (!(await writeDetails(organizationId, membershipId, edit))) {
        throw new NotFoundException('No such staff member');
      }
    } catch (error) {
      if (error instanceof TaxNumberTakenError) {
        throw new ConflictException({
          code: 'tax_number_taken',
          message: 'Another person in this club already has that NIF',
          fields: { taxNumber: 'staffDetails.errors.taxNumberTaken' },
        });
      }
      throw error;
    }
    return (await readDetails(organizationId, membershipId))!;
  }

  /**
   * The sports a person belongs to — POOLSE-145. Owner and admin, explicitly
   * (Rui, 01-11-2026); never empty, and only sports the club has on. An
   * instructor then reads only these sports' students (`requireSport`).
   */
  @Patch(':membershipId/sports')
  async setSports(
    @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<StaffRecord> {
    requireRole('owner', 'admin');
    const raw = body['sports'];
    if (!Array.isArray(raw) || raw.length === 0 || !raw.every((sport) => isPoolseSport(sport))) {
      throw new BadRequestException({
        code: 'invalid_sports',
        message: 'sports is a non-empty list of sports',
        fields: { sports: 'staff.sports.errors.required' },
      });
    }
    const { organizationId } = currentTenant();
    try {
      if (!(await setStaffSports(organizationId, membershipId, [...new Set(raw as string[])]))) {
        throw new NotFoundException('No such staff member');
      }
    } catch (error) {
      if (error instanceof SportNotEnabledError) {
        throw new BadRequestException({
          code: 'sport_not_enabled',
          message: error.message,
          fields: { sports: 'staff.sports.errors.notEnabled' },
        });
      }
      throw error;
    }
    return (await findStaff(organizationId, membershipId))!;
  }

  /**
   * One staff record.
   *
   * **`notes` is the club's private note about somebody — "not shown to them" —
   * so an instructor may read only their own record.** This admitted any
   * instructor to any membership id, which meant every colleague's notes, and
   * every guardian's and student's contact details besides, since the id is just
   * a membership. The edit path immediately below already drew that line; the
   * read path did not.
   *
   * Owner and admin still read anybody: managing staff is what they do.
   */
  @Get(':membershipId')
  async one(@Param('membershipId') membershipId: string): Promise<StaffRecord> {
    requireRole('owner', 'admin', 'instructor');
    const { organizationId, membershipId: actor } = currentTenant();

    if (!hasRole('owner', 'admin') && membershipId !== actor) {
      throw new ForbiddenException('That record is not yours');
    }

    const staff = await findStaff(organizationId, membershipId);
    // Also the answer for another tenant's id: RLS hid it, and the caller learns
    // nothing either way.
    if (staff === null) throw new NotFoundException('No such staff member');

    return staff;
  }

  @Patch(':membershipId')
  async update(
    @Param('membershipId') membershipId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<StaffRecord> {
    const { organizationId, membershipId: actor } = currentTenant();

    const privileged = hasRole('owner', 'admin');
    const own = actor === membershipId;

    if (!privileged && !own) {
      throw new ForbiddenException({
        code: 'forbidden_role',
        message: 'You may only edit your own record',
      });
    }

    /*
     * Refused rather than ignored — 39.3.
     *
     * A request that silently drops the field it was sent looks like a save that
     * worked, and the caller goes on believing the address changed. Saying no is
     * the only answer that leaves them knowing where they stand.
     */
    if (body['email'] !== undefined) {
      throw new BadRequestException({
        code: 'email_immutable',
        message: 'Email is the login identity and changes only by re-invitation',
      });
    }

    const staff = await findStaff(organizationId, membershipId);
    if (staff === null) throw new NotFoundException('No such staff member');

    const edit = {
      firstName: text(body['firstName'], 'firstName', MAX_NAME),
      lastName: text(body['lastName'], 'lastName', MAX_NAME),
      phone: text(body['phone'], 'phone', MAX_PHONE),
      // Anybody but the Owner keeps whatever notes were already there rather
      // than being able to clear them by omission (Rui, 07-11-2026).
      notes: hasRole('owner') ? text(body['notes'], 'notes', MAX_NOTES) : staff.notes,
    };

    if (
      !hasRole('owner') &&
      body['notes'] !== undefined &&
      text(body['notes'], 'notes', MAX_NOTES) !== (staff.notes ?? null)
    ) {
      throw new ForbiddenException({
        code: 'forbidden_role',
        message: 'Notes are written by the owner',
      });
    }

    /*
     * Clerk owns the name where there is a login, and the write goes there
     * first — CLAUDE.md's rule, and the reason `updateClerkName` re-reads rather
     * than trusting what it sent. A failure at Clerk must leave nothing changed
     * anywhere, which is why this happens before the row is touched.
     */
    const clerkHandled = staff.clerkUserId !== null;
    const renamed =
      (edit.firstName ?? '') !== (staff.firstName ?? '') || (edit.lastName ?? '') !== (staff.lastName ?? '');

    /*
     * A login's name is the person's own, in every club — sweep of 15-10-2026.
     * Clerk holds one name for them, so an Admin here (or a support session)
     * writing it renamed them in every other club and on their own account. The
     * person changes it on O meu perfil; an unchanged name passes through. **The
     * Owner may correct it** (Rui, 07-11-2026, narrowing that sweep), knowing it
     * follows the person to any other club. Support is an Admin here, so it may not.
     */
    if (clerkHandled && renamed && !own && !hasRole('owner')) {
      throw new ForbiddenException({
        code: 'name_is_theirs',
        message: 'This person signs in, and only they can change their name',
      });
    }

    if (clerkHandled && renamed) {
      // A Poolse operator's account is not the club's to correct.
      if (await isSupportMembership(organizationId, membershipId)) {
        throw new NotFoundException('No such staff member');
      }
      await updateClerkName(staff.clerkUserId as string, edit.firstName, edit.lastName);
    }

    const nameWas = clerkHandled ? { firstName: staff.firstName, lastName: staff.lastName } : null;
    if (!(await updateStaff(organizationId, membershipId, edit, clerkHandled, nameWas))) {
      throw new NotFoundException('No such staff member');
    }

    const saved = await findStaff(organizationId, membershipId);
    if (saved === null) throw new NotFoundException('No such staff member');
    return saved;
  }

  /**
   * Moves somebody to a new address — AC3.
   *
   * Owner only, as the ticket states. It is the one operation that changes who
   * can sign in as an existing person, which is a different thing from inviting
   * somebody new.
   */
  @Post(':membershipId/reinvite')
  async move(
    @Param('membershipId') membershipId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ reinvited: true; delivered: boolean }> {
    requireRole('owner');
    const { organizationId, membershipId: actor } = currentTenant();

    const email = normaliseEmail(String(body['email'] ?? ''));
    if (email === null) throw new BadRequestException('A valid email address is required');

    const staff = await findStaff(organizationId, membershipId);
    if (staff === null) throw new NotFoundException('No such staff member');

    if (staff.email !== null && staff.email.toLowerCase() === email.toLowerCase()) {
      throw new BadRequestException({
        code: 'same_address',
        message: 'That is already their address',
      });
    }

    const { token, tokenHash } = issueToken();
    const expiresAt = invitationExpiry();

    const id = await reinvite(organizationId, membershipId, email, tokenHash, expiresAt, actor);
    /*
     * A live invitation to that address already exists, for somebody else. The
     * index is keyed on the address rather than the person, so revoking this
     * membership's own invitations does not clear it — and a 409 says what
     * happened where the raw 23505 said only "500".
     */
    if (id === 'address_taken') {
      throw new ConflictException('That address already has an invitation outstanding');
    }
    if (id === null) {
      throw new BadRequestException('That person has no login to move');
    }

    /*
     * The same delivery path as an ordinary invitation, not a second one.
     *
     * It writes the outcome to `invitation.delivery` as well as returning it, so
     * a re-invite that failed to send is visible on the record afterwards rather
     * than only to the request that made it. With `EMAIL_PROVIDER=console` the
     * link goes to the API log, which is `not_configured` rather than a failure.
     */
    const delivered = await deliver(organizationId, id, email, staff.roles, token, expiresAt);

    return { reinvited: true, delivered };
  }

  @Post(':membershipId/reinvite/cancel')
  async cancel(@Param('membershipId') membershipId: string): Promise<{ cancelled: true }> {
    requireRole('owner');
    const { organizationId } = currentTenant();

    if (!(await cancelReinvite(organizationId, membershipId))) {
      throw new NotFoundException('There is no pending re-invitation');
    }
    return { cancelled: true };
  }
}

/** Trimmed, bounded, and empty means null rather than an empty string. */
function text(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;

  const trimmed = String(value).trim();
  if (trimmed === '') return null;
  if (trimmed.length > max) {
    throw new BadRequestException(`${field} may be at most ${max} characters`);
  }
  return trimmed;
}

/** The Clerk id behind a member of the club; a person with no login has no such photo. */
async function loginOf(membershipId: string): Promise<string> {
  const { organizationId } = currentTenant();
  const staff = await findStaff(organizationId, membershipId);
  if (staff === null || staff.clerkUserId === null) throw new NotFoundException('No such login');
  if (await isSupportMembership(organizationId, membershipId)) throw new NotFoundException('No such login');
  return staff.clerkUserId;
}

/** Logged first and inside the call, so Clerk failing leaves no row and no change goes unlogged. */
async function onTheRecord(membershipId: string, change: () => Promise<unknown>): Promise<void> {
  await withOrg(currentTenant().organizationId, async (tx) => {
    await recordAudit(tx, {
      action: 'membership.login_photo_changed',
      entityType: 'membership',
      entityId: membershipId,
    });
    await change();
  });
}

/** What only the Owner writes for somebody else; anybody may still write their own. */
function requireOwnerOrSelf(membershipId: string): string {
  const actor = requireOwnOrManaged(membershipId);
  if (actor !== membershipId && !hasRole('owner')) {
    throw new ForbiddenException({ code: 'owner_only', message: 'Only the owner changes this' });
  }
  return actor;
}

/** Owner or admin for anyone; any member of staff for themself. Answers the reader's membership. */
function requireOwnOrManaged(membershipId: string): string {
  requireRole('owner', 'admin', 'instructor', 'maintenance');
  const { membershipId: actor } = currentTenant();
  if (!hasRole('owner', 'admin') && membershipId !== actor) {
    throw new ForbiddenException('That record is not yours');
  }
  return actor;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A contract's facts from a body. Every field is optional; an empty box clears.
 * A fixed term needs its end and an open-ended contract has none — said under
 * the field, before the database's CHECK would have said it less helpfully.
 */
function parseContractFacts(body: Record<string, unknown>): ContractFacts {
  const fields: Record<string, string> = {};
  const day = (field: 'startsOn' | 'endsOn'): string | null => {
    const raw = typeof body[field] === 'string' ? (body[field] as string).trim() : '';
    if (raw === '') return null;
    if (!ISO_DAY.test(raw) || Number.isNaN(Date.parse(`${raw}T12:00:00Z`))) {
      fields[field] = 'staffContract.errors.dateInvalid';
      return null;
    }
    return raw;
  };
  const rawKind = typeof body['kind'] === 'string' ? body['kind'].trim() : '';
  const kind = rawKind === '' ? null : (CONTRACT_KINDS as readonly string[]).includes(rawKind) ? (rawKind as ContractKind) : null;
  if (rawKind !== '' && kind === null) fields['kind'] = 'staffContract.errors.kindInvalid';
  const startsOn = day('startsOn');
  const endsOn = day('endsOn');

  if (kind === 'fixed_term' && endsOn === null && fields['endsOn'] === undefined) {
    fields['endsOn'] = 'staffContract.errors.endRequired';
  }
  if (kind === 'open_ended' && endsOn !== null) fields['endsOn'] = 'staffContract.errors.endNotAllowed';
  if (startsOn !== null && endsOn !== null && endsOn < startsOn) fields['endsOn'] = 'staffContract.errors.endBeforeStart';

  if (Object.keys(fields).length > 0) {
    throw new BadRequestException({ code: 'invalid_contract', message: 'Some fields are not valid', fields });
  }
  return { kind, startsOn, endsOn };
}

/** A contract is the Owner's to file, an Admin's own included (Rui, 07-11-2026). */
function mayWriteContract(): boolean {
  return hasRole('owner');
}

function photoSide(raw: string): IdPhotoSide {
  if (!(ID_PHOTO_SIDES as readonly string[]).includes(raw)) {
    throw new BadRequestException({ code: 'invalid_side', message: 'side is front or back' });
  }
  return raw as IdPhotoSide;
}

const DETAIL_LIMITS: Partial<Record<keyof StaffDetails, number>> = {
  address: 200,
  locality: 100,
  birthplace: 120,
  emergencyName: 160,
  emergencyPhone: 40,
  emergencyRelation: 60,
};

/**
 * The details from a body. An absent key is not asked about; an empty box
 * clears; a value that cannot be what it says is refused under its field, never
 * read as "clear it" (CLAUDE.md, the NIF rule).
 */
function parseDetails(body: Record<string, unknown>): Partial<StaffDetails> {
  const fields: Record<string, string> = {};
  const edit: Partial<StaffDetails> = {};

  for (const [field] of DETAIL_COLUMNS) {
    const raw = body[field];
    if (raw === undefined) continue;
    if (raw !== null && typeof raw !== 'string') {
      fields[field] = 'staffDetails.errors.invalid';
      continue;
    }
    const value = (raw ?? '').trim().replace(/\s+/g, ' ');
    if (value === '') {
      edit[field] = null;
      continue;
    }
    const limit = DETAIL_LIMITS[field];
    if (limit !== undefined && value.length > limit) {
      fields[field] = 'staffDetails.errors.tooLong';
      continue;
    }

    if (field === 'postalCode') {
      const code = value.replace(/\s/g, '');
      if (/^\d{4}-\d{3}$/.test(code)) edit[field] = code;
      else fields[field] = 'staffDetails.errors.postalCodeInvalid';
    } else if (field === 'taxNumber') {
      const nif = value.replace(/\s/g, '');
      if (isValidNif(nif)) edit[field] = nif;
      else fields[field] = 'staffDetails.errors.nifInvalid';
    } else if (field === 'niss') {
      if (isValidNiss(value)) edit[field] = normalizeNiss(value);
      else fields[field] = 'staffDetails.errors.nissInvalid';
    } else if (field === 'nationality') {
      const country = value.toUpperCase();
      if (/^[A-Z]{2}$/.test(country)) edit[field] = country;
      else fields[field] = 'staffDetails.errors.invalid';
    } else {
      edit[field] = value;
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new BadRequestException({ code: 'invalid_details', message: 'Some fields are not valid', fields });
  }
  return edit;
}

function parseIdentity(body: Record<string, unknown>): IdentityEdit {
  const fields: Record<string, string> = {};
  const edit: IdentityEdit = {};

  if (body['birthDate'] !== undefined) {
    const raw = typeof body['birthDate'] === 'string' ? body['birthDate'].trim() : body['birthDate'];
    if (raw === null || raw === '') edit.birthDate = null;
    else if (typeof raw !== 'string' || !ISO_DAY.test(raw) || Number.isNaN(Date.parse(`${raw}T12:00:00Z`))) {
      fields['birthDate'] = 'staffIdentity.errors.birthDateInvalid';
    } else if (raw < '1900-01-01' || raw > clubToday()) {
      fields['birthDate'] = 'staffIdentity.errors.birthDateRange';
    } else edit.birthDate = raw;
  }

  if (body['idDocumentType'] !== undefined || body['idDocumentNumber'] !== undefined) {
    const type = body['idDocumentType'];
    const rawNumber = typeof body['idDocumentNumber'] === 'string' ? body['idDocumentNumber'].trim() : '';
    if ((type === null || type === '') && rawNumber === '') {
      // An empty box clears the document; anything half-typed is refused below.
      edit.idDocument = null;
    } else if (!isIdDocumentType(type)) {
      fields['idDocumentType'] = 'staffIdentity.errors.typeRequired';
    } else if (rawNumber === '') {
      fields['idDocumentNumber'] = 'staffIdentity.errors.numberRequired';
    } else if (type === 'cc') {
      if (!isValidCcNumber(rawNumber)) fields['idDocumentNumber'] = 'staffIdentity.errors.ccInvalid';
      else edit.idDocument = { type, number: normalizeCcNumber(rawNumber) };
    } else if (!/^[A-Za-z0-9 -]{3,30}$/.test(rawNumber)) {
      fields['idDocumentNumber'] = 'staffIdentity.errors.numberInvalid';
    } else edit.idDocument = { type, number: rawNumber.toUpperCase() };
  }

  if (Object.keys(fields).length > 0) {
    throw new BadRequestException({ message: 'Some fields are not valid', fields });
  }
  return edit;
}
