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
import {
  hasRole,
  isMemberRole,
  requireCanArchive,
  requireGrantable,
  requireRole,
} from '../tenant/roles.js';

interface StudentDetail extends Student {
  /**
   * Whether this caller may open the medical record.
   *
   * Kept in step with `SensitiveController.read`, which is where the rule
   * actually lives. Two places knowing one rule is a cost paid knowingly: the
   * alternative is a screen that renders a button leading to a 403.
   */
  canViewSensitive: boolean;
  canViewProgress: boolean;
}
import {
  archiveLevel,
  archiveStudent,
  countOutsideRange,
  createLevel,
  createStudent,
  DuplicateNameError,
  findStudent,
  ageOfMajority,
  findDuplicate,
  grantRole,
  listGuardians,
  mergeCandidates,
  mergePeople,
  revokeRole,
  listLevels,
  listStudents,
  reorderLevels,
  renameLevel,
  searchPeople,
  studentsOf,
  updateStudent,
  type DuplicateMatch,
  type GuardianInput,
  type GuardianRow,
  type MergeCandidate,
  type PersonSummary,
  type Student,
  type StudentInput,
  type StudentLevel,
} from './students.repository.js';
import { readPageQuery, type Paginated } from '../common/pagination.js';
import { readSearch } from '../common/search.js';
import { creditsFor, type ReposicaoCredit } from './credits.repository.js';

const MAX_NAME = 120;
const MAX_NOTES = 2000;

/**
 * More than four encarregados for one child is a typo, not a family.
 *
 * POOLSE-04 allows more than one and puts no number on it, so this is a sanity
 * bound rather than a rule anybody will meet.
 */
const MAX_GUARDIANS = 4;

interface StudentsResponse {
  organizationId: string;
  /**
   * One page of the register — POOLSE-29.
   *
   * `total` is how many matched the search and the level filter, not how many
   * students exist, because that is the number the range label has to say.
   * `levels` beside it is deliberately not paginated: the programme ladder is
   * fixed by the data model, and it populates the filter that narrows this list.
   */
  students: Paginated<Student>;
  levels: StudentLevel[];
  canManage: boolean;
  /**
   * The club's maioridade — POOLSE-22.
   *
   * Sent to the client so the guardian block and every "under N" message read
   * the tenant's line rather than a number compiled into the bundle.
   */
  ageOfMajority: number;
}

/**
 * Slice 1.2 — the student register.
 *
 * Reading is open to any member, because an instructor needs to know who is in
 * their lane. Writing is owner and admin, the same line facilities and
 * invitations draw. Slice 1.12 revisits the whole role surface; until then the
 * rule is uniform and easy to reason about rather than clever.
 *
 * Nothing here touches medical information or consent. Those live in separate
 * tables with their own access rules (slice 1.3) precisely so that this
 * controller — the ordinary, widely-readable one — cannot reach them.
 */
/**
 * People, for the guardian picker — POOLSE-17.
 *
 * Its own controller rather than a route under `students`, because a person is
 * not a student: the whole point of the ticket is that the same human can be
 * both, and filing the lookup under one of their roles would be the mistake this
 * models its way out of.
 */
/**
 * Encarregados de educação — POOLSE-35.
 *
 * Under Alunos rather than Pessoas, and readable by anyone who can see students:
 * an instructor needs to know who to hand a child back to. Pessoas stays staff
 * and stays owner/admin.
 */
@Controller('guardians')
export class GuardiansController {
  @Get()
  async list(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<{ organizationId: string; guardians: Paginated<GuardianRow> }> {
    const { organizationId } = currentTenant();
    return {
      organizationId,
      guardians: await listGuardians(
        organizationId,
        readSearch(search),
        readPageQuery(page, limit),
      ),
    };
  }
}

/**
 * Duplicates and merges — POOLSE-17 AC8, AC9, AC10.
 *
 * The dedup check is readable by anybody who may create a person, because it is
 * called *while they are typing* — refusing it would mean the warning only
 * appears for admins, and an instructor enrolling a family would create the
 * duplicate the ticket exists to prevent.
 *
 * Merging is owner and admin, and refused server-side. It is irreversible from
 * the interface, touches live tenant data, and is exactly what the conventions
 * mean by permission-sensitive.
 */
@Controller('people')
export class PeopleDedupController {
  @Get('duplicate')
  async duplicate(
    @Query('taxNumber') taxNumber?: string,
    @Query('email') email?: string,
  ): Promise<{ match: DuplicateMatch | null }> {
    const { organizationId } = currentTenant();
    return {
      match: await findDuplicate(organizationId, taxNumber ?? null, email ?? null),
    };
  }

  /** AC9's "add the role to the existing Person instead". */
  @Post(':membershipId/roles')
  async grant(
    @Param('membershipId') membershipId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ granted: true }> {
    const { organizationId, membershipId: actor } = currentTenant();

    const role = typeof body['role'] === 'string' ? body['role'].trim() : '';
    if (!isMemberRole(role)) throw new BadRequestException('role is not a member role');

    /*
     * The invite matrix governs granting a role, not only inviting somebody to
     * it — POOLSE-01 AC4 says the rule applies to role *changes* too. Without
     * this, an admin could not invite an owner but could promote one, which is
     * the same escalation by a different door.
     */
    requireGrantable([role]);

    if (!(await grantRole(organizationId, membershipId, role, actor))) {
      throw new NotFoundException('No such person');
    }
    return { granted: true };
  }

  @Post(':membershipId/roles/:role/revoke')
  async revoke(
    @Param('membershipId') membershipId: string,
    @Param('role') role: string,
  ): Promise<{ revoked: true }> {
    const { organizationId } = currentTenant();

    if (!isMemberRole(role)) throw new BadRequestException('role is not a member role');
    requireGrantable([role]);

    if (!(await revokeRole(organizationId, membershipId, role))) {
      throw new NotFoundException('No such role on that person');
    }
    return { revoked: true };
  }

  /** Phase 1: what a merge would do. Read-only, and reviewed before phase 2. */
  @Get('merge-report')
  async report(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<{ candidates: Paginated<MergeCandidate> }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();
    return { candidates: await mergeCandidates(organizationId, readPageQuery(page, limit)) };
  }

  /** Phase 2: absorb one record into another. */
  @Post('merge')
  async merge(@Body() body: Record<string, unknown>): Promise<{ merged: true; rows: number }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const keepId = typeof body['keepId'] === 'string' ? body['keepId'].trim() : '';
    const absorbId = typeof body['absorbId'] === 'string' ? body['absorbId'].trim() : '';
    if (keepId === '' || absorbId === '') {
      throw new BadRequestException('keepId and absorbId are required');
    }
    if (keepId === absorbId) {
      throw new BadRequestException('A person cannot be merged into themselves');
    }

    // Zero means one of them was not live in this tenant — which is also the
    // answer for another tenant's id, because RLS hid it. The caller learns
    // nothing either way.
    const rows = await mergePeople(organizationId, keepId, absorbId);
    return { merged: true, rows };
  }
}

@Controller('people-search')
export class PeopleSearchController {
  @Get()
  async search(@Query('q') q?: string): Promise<{ people: PersonSummary[] }> {
    const { organizationId } = currentTenant();

    // Two characters is where a search stops being a list of everybody. Below
    // that, nothing — an empty result reads as "keep typing", a full one reads
    // as "these are your matches", and the second is a lie.
    const search = q?.trim() ?? '';
    if (search.length < 2) return { people: [] };

    return { people: await searchPeople(organizationId, search) };
  }

  /** The children one person is responsible for — POOLSE-04, criterion 9. */
  @Get(':membershipId/students')
  async students(
    @Param('membershipId') membershipId: string,
  ): Promise<{ students: { id: string; name: string; relationship: string | null }[] }> {
    const { organizationId } = currentTenant();
    return { students: await studentsOf(organizationId, membershipId) };
  }
}

@Controller('students')
export class StudentsController {
  @Get()
  async list(
    @Query('search') search?: string,
    @Query('levelId') levelId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<StudentsResponse> {
    const { organizationId } = currentTenant();

    // All three are tenant-scoped reads on the same organization; together they
    // cost one round trip instead of three.
    const [students, levels, majority] = await Promise.all([
      listStudents(
        organizationId,
        {
          // A term under the floor is no filter at all — POOLSE-30.
          search: readSearch(search),
          levelId: levelId?.trim() ? levelId.trim() : null,
        },
        readPageQuery(page, limit),
      ),
      listLevels(organizationId),
      ageOfMajority(organizationId),
    ]);

    return {
      organizationId,
      students,
      levels,
      canManage: hasRole('owner', 'admin'),
      ageOfMajority: majority,
    };
  }

  @Get(':id')
  async one(@Param('id') id: string): Promise<StudentDetail> {
    const { organizationId } = currentTenant();
    const student = await findStudent(organizationId, id);
    // Also the answer when the id belongs to another tenant: RLS makes the two
    // indistinguishable from here, which is the point.
    if (!student) throw new NotFoundException('No such student');

    // So the record can hide a control its owner may not use. Not access
    // control — SensitiveController and RecordsController each enforce their own
    // and would refuse the request anyway. This only stops the screen offering a
    // door that opens onto a refusal.
    return {
      ...student,
      canViewSensitive: hasRole('owner', 'admin', 'instructor'),
      canViewProgress: hasRole('owner', 'admin', 'instructor'),
    };
  }

  /**
   * What this student is owed — POOLSE-21, criteria 2 and 5.
   *
   * Oldest expiry first, so the perishable credits are the ones a family is
   * offered. Readable by any member: an instructor asked "do I owe them a class?"
   * at the poolside needs the answer, and it reveals nothing a register does not.
   */
  @Get(':id/credits')
  async credits(@Param('id') id: string): Promise<{ credits: ReposicaoCredit[] }> {
    const { organizationId } = currentTenant();

    // Through the same lookup as every other student read, so "not ours" and
    // "not there" stay indistinguishable.
    if ((await findStudent(organizationId, id)) === null) {
      throw new NotFoundException('No such student');
    }

    return { credits: await creditsFor(organizationId, id) };
  }

  @Post()
  async create(@Body() body: Record<string, unknown>): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    // Read before parsing: the guardian requirement depends on the club's
    // maioridade, not on a number compiled into this file — POOLSE-22.
    const majority = await ageOfMajority(organizationId);
    const id = await createStudent(organizationId, parseStudent(body, majority));
    if (id === null) throw new BadRequestException('No such level');
    return { id };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ updated: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const majority = await ageOfMajority(organizationId);
    const outcome = await updateStudent(organizationId, id, parseStudent(body, majority));
    if (outcome === 'bad_level') throw new BadRequestException('No such level');
    if (outcome === 'not_found') throw new NotFoundException('No such student');
    return { updated: true };
  }

  @Post(':id/archive')
  async archive(@Param('id') id: string): Promise<{ archived: true }> {
    requireCanArchive();
    const { organizationId } = currentTenant();

    if (!(await archiveStudent(organizationId, id))) {
      throw new NotFoundException('No such student');
    }
    return { archived: true };
  }
}

/**
 * Levels get their own controller rather than living under `/students`.
 *
 * `/students/levels` would sit in the same space as `/students/:id`, and which
 * one wins depends on declaration order — a footgun that only fires the day
 * somebody reorders the methods.
 */
/** 120 years. Generous: a masters club with a "90+" level is a real thing. */
const MAX_AGE_MONTHS = 1440;

/**
 * An optional age bound, in months — POOLSE-06.
 *
 * Absent, empty and null all mean "no bound", because "Adultos" genuinely has no
 * maximum and an operator should not have to invent 120 years to say so.
 */
function age(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null;

  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_AGE_MONTHS) {
    throw new BadRequestException(
      `${field} must be a whole number of months between 0 and ${MAX_AGE_MONTHS}`,
    );
  }
  return parsed;
}

function ageRange(body: Record<string, unknown>): {
  minAgeMonths: number | null;
  maxAgeMonths: number | null;
} {
  const minAgeMonths = age(body['minAgeMonths'], 'minAgeMonths');
  const maxAgeMonths = age(body['maxAgeMonths'], 'maxAgeMonths');

  // Checked here as well as by the constraint, so an operator who sets 10 down
  // to 4 gets a sentence rather than a constraint name.
  if (minAgeMonths !== null && maxAgeMonths !== null && maxAgeMonths < minAgeMonths) {
    throw new BadRequestException('maxAgeMonths cannot be below minAgeMonths');
  }
  return { minAgeMonths, maxAgeMonths };
}

@Controller('levels')
export class LevelsController {
  @Post()
  async create(@Body() body: Record<string, unknown>): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const name = requiredText(body['name'], 'name');
    try {
      return { id: await createLevel(organizationId, name, ageRange(body)) };
    } catch (error) {
      throw asHttp(error);
    }
  }

  /**
   * How many students would fall outside a proposed range — round 4, ticket 4.
   *
   * A GET with the candidate bounds in the query string, asked before saving.
   * Deliberately not part of the save: the count is a thing to be *told*, and a
   * save that refused on it would be the hard block ticket 3 argues against.
   */
  @Get(':id/outside')
  async outside(
    @Param('id') id: string,
    @Query('minAgeMonths') min?: string,
    @Query('maxAgeMonths') max?: string,
  ): Promise<{ outside: number }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    return {
      outside: await countOutsideRange(organizationId, id, {
        minAgeMonths: age(min, 'minAgeMonths'),
        maxAgeMonths: age(max, 'maxAgeMonths'),
      }),
    };
  }

  @Patch(':id')
  async rename(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ renamed: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const name = requiredText(body['name'], 'name');
    let renamed: boolean;
    try {
      renamed = await renameLevel(organizationId, id, name, ageRange(body));
    } catch (error) {
      throw asHttp(error);
    }
    if (!renamed) throw new NotFoundException('No such level');
    return { renamed: true };
  }

  /**
   * The whole order at once — POOLSE-05.
   *
   * One call rather than one per hop, because dragging a level from fifth to
   * first is four moves and four chances to be left half applied. The optimistic
   * list on the client is what makes it feel instant; this is what makes it true.
   */
  @Post('reorder')
  async reorder(@Body() body: Record<string, unknown>): Promise<{ reordered: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const raw = body['ids'];
    if (!Array.isArray(raw)) throw new BadRequestException('ids must be a list of level ids');

    const ids = raw.filter((id): id is string => typeof id === 'string' && id.trim() !== '');
    if (ids.length !== raw.length) throw new BadRequestException('ids must all be strings');
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('ids must not repeat');
    }

    if (!(await reorderLevels(organizationId, ids))) {
      throw new NotFoundException('No such levels');
    }
    return { reordered: true };
  }

  /*
   * There is no `POST :id/move`. POOLSE-05 replaced the up/down arrows with
   * dragging, and the endpoint went with them rather than staying as a second
   * way to order the same list — two orderings disagree the first time somebody
   * uses both. `POST /levels/reorder` takes the whole sequence at once.
   */

  @Post(':id/archive')
  async archive(@Param('id') id: string): Promise<{ archived: true; unlevelled: number }> {
    requireCanArchive();
    const { organizationId } = currentTenant();

    const result = await archiveLevel(organizationId, id);
    if (!result.archived) throw new NotFoundException('No such level');
    return { archived: true, unlevelled: result.unlevelled };
  }
}

function asHttp(error: unknown): unknown {
  if (error instanceof DuplicateNameError) {
    return new ConflictException(`"${error.message}" already exists`);
  }
  return error;
}

function parseStudent(body: Record<string, unknown>, majority: number): StudentInput {
  const birthDate = parseBirthDate(body['birthDate']);

  const guardians = readGuardians(body);

  /*
   * A minor needs a guardian who can be reached — POOLSE-04, criterion 2.
   *
   * Checked here rather than in the schema, because age moves on its own: a
   * student who was fifteen when the row was written turns eighteen without
   * anybody touching it, and a constraint that quietly became false would block
   * every later edit to a record that was perfectly valid when it was made.
   *
   * A student with no birth date is never blocked. Missing dates are the normal
   * case after an import, and refusing to save them would fail most rows.
   */
  if (birthDate !== null && isMinor(birthDate, majority)) {
    const first = guardians[0];

    if (first === undefined) {
      throw new BadRequestException({
        code: 'guardian_required',
        message: 'A student under 18 needs a guardian',
        fields: { guardianName: 'students.guardianNameRequired' },
      });
    }

    /*
     * An existing person is taken as sufficient.
     *
     * Their name and contact details are theirs, live on their own page, and
     * were checked when they were created — re-validating them here would refuse
     * a perfectly good guardian because the operator picking them cannot see
     * what is missing from a record they did not open.
     */
    if (first.membershipId === null) {
      if (first.name === null) {
        throw new BadRequestException({
          code: 'guardian_required',
          message: 'A student under 18 needs a guardian',
          fields: { guardianName: 'students.guardianNameRequired' },
        });
      }
      if (first.phone === null && first.email === null) {
        throw new BadRequestException({
          code: 'guardian_required',
          message: 'A guardian needs a phone number or an email address',
          fields: { guardianPhone: 'students.guardianContactRequired' },
        });
      }
    }

    if (first.relationship === null) {
      throw new BadRequestException({
        code: 'guardian_required',
        message: 'A guardian needs a relationship to the student',
        fields: { guardianRelationship: 'students.guardianRelationshipRequired' },
      });
    }
  }

  return {
    firstName: requiredText(body['firstName'], 'firstName'),
    lastName: requiredText(body['lastName'], 'lastName'),
    birthDate,
    levelId: optionalText(body['levelId'], 'levelId', 64),
    contactEmail: optionalText(body['contactEmail'], 'contactEmail', 254),
    contactPhone: optionalText(body['contactPhone'], 'contactPhone', 40),
    notes: optionalText(body['notes'], 'notes', MAX_NOTES),
    guardians,
  };
}

/**
 * The guardians a request is asking for — POOLSE-04, POOLSE-17.
 *
 * Accepts `guardians` as an array. The single flat `guardianName`/`guardianPhone`
 * form is still read when no array is given, because that is what the student
 * form posts for the ordinary one-guardian case and there is no reason to make
 * every caller build an array to say one thing.
 *
 * An entry naming a `membershipId` is an existing person being attached. One
 * without is described by its fields and will be matched against the club's
 * people before anybody new is created.
 */
function readGuardians(body: Record<string, unknown>): GuardianInput[] {
  const raw = body['guardians'];

  if (Array.isArray(raw)) {
    if (raw.length > MAX_GUARDIANS) {
      throw new BadRequestException(`at most ${MAX_GUARDIANS} guardians`);
    }
    return raw
      .map((entry, index) => readGuardian(entry as Record<string, unknown>, index))
      .filter((guardian): guardian is GuardianInput => guardian !== null);
  }

  const flat = readGuardian(
    {
      membershipId: body['guardianMembershipId'],
      name: body['guardianName'],
      relationship: body['guardianRelationship'],
      phone: body['guardianPhone'],
      email: body['guardianEmail'],
      taxNumber: body['guardianTaxNumber'],
      address: body['guardianAddress'],
    },
    0,
  );

  return flat === null ? [] : [flat];
}

/** Null for an entry that names nobody — an untouched row in the form. */
function readGuardian(
  entry: Record<string, unknown>,
  index: number,
): GuardianInput | null {
  const guardian: GuardianInput = {
    membershipId: optionalText(entry['membershipId'], 'guardianMembershipId', 64),
    name: optionalText(entry['name'], 'guardianName', MAX_NAME),
    relationship: optionalText(entry['relationship'], 'guardianRelationship', 80),
    phone: optionalText(entry['phone'], 'guardianPhone', 40),
    email: optionalText(entry['email'], 'guardianEmail', 254),
    taxNumber: optionalText(entry['taxNumber'], 'guardianTaxNumber', 20),
    address: optionalText(entry['address'], 'guardianAddress', 500),
    // The first listed is the primary contact unless one says otherwise. The
    // repository re-checks this; here it only carries what was asked for.
    isPrimary: entry['isPrimary'] === true || entry['isPrimary'] === 'true' || index === 0,
  };

  if (guardian.membershipId === null && guardian.name === null) return null;
  return guardian;
}

/**
 * Under eighteen, as of today.
 *
 * UTC on both sides, because a birth date is a calendar day rather than an
 * instant — read in a local timezone west of Greenwich it would make somebody a
 * day younger and flip this answer on their eighteenth birthday.
 */
function isMinor(birthDate: string, majority: number): boolean {
  const born = new Date(`${birthDate}T00:00:00Z`);
  const now = new Date();

  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const month = now.getUTCMonth() - born.getUTCMonth();
  if (month < 0 || (month === 0 && now.getUTCDate() < born.getUTCDate())) age -= 1;

  // The club's line, not ours — POOLSE-22.
  return age < majority;
}

function requiredText(value: unknown, field: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length === 0) throw new BadRequestException(`${field} is required`);
  if (trimmed.length > MAX_NAME) {
    throw new BadRequestException(`${field} may be at most ${MAX_NAME} characters`);
  }
  return trimmed;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) {
    throw new BadRequestException(`${field} may be at most ${max} characters`);
  }
  return trimmed;
}

/**
 * A plain calendar date, and refused if it is in the future.
 *
 * The lower bound is a CHECK on the table; the upper bound cannot be, because
 * `current_date` is not IMMUTABLE and Postgres will not have it in a constraint.
 * So it is enforced here — and a student born tomorrow is a typo every time.
 */
function parseBirthDate(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (raw.length === 0) return null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new BadRequestException('birthDate must be a date, as YYYY-MM-DD');
  }

  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException('birthDate is not a real date');
  }
  if (parsed.getTime() > Date.now()) {
    throw new BadRequestException('birthDate cannot be in the future');
  }
  return raw;
}
