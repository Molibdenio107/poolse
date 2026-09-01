import { auth } from '@clerk/nextjs/server';
import type { SkillState } from './skills';
import type { PoolMetric } from './pool-metrics';

/**
 * Server-side client for the Poolse API.
 *
 * Calls go browser → Next server → API, never browser → API directly. Two reasons
 * worth remembering before someone "simplifies" this into a client-side fetch:
 * the session token never reaches client JavaScript, and there is no CORS
 * configuration to keep in sync across two environments.
 *
 * Server components and server actions only — `auth()` throws anywhere else.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /**
     * The API's stable machine-readable reason, where it sends one.
     *
     * Only `403` has two meanings worth separating today — `no_organization`
     * (you are in none, go and create one) and `forbidden_role` (you are a
     * member, this is not yours). Branching on the prose instead would break the
     * first time somebody rewords an error message.
     */
    readonly code: string | null = null,
    /**
     * Field name to translation key, when the API rejected specific fields.
     *
     * Keys rather than sentences, because the API has no message catalogues —
     * the web app owns every user-facing string, in both locales.
     */
    readonly fields: Record<string, string> = {},
    /**
     * The whole parsed error body, for the few errors that carry structure
     * beyond a code — the schedule-clash list, for instance.
     *
     * Deliberately `unknown`: it is somebody else's JSON, and every reader has
     * to narrow it before believing it.
     */
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Nest sends its exceptions as JSON, but a proxy, a crash or a 502 from the
 * platform will send something else entirely — so this never assumes it parsed.
 */
function readError(status: number, body: string, statusText: string): ApiError {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed !== null && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      const code = typeof record['code'] === 'string' ? record['code'] : null;
      const message = typeof record['message'] === 'string' ? record['message'] : body;
      const raw = record['fields'];
      const fields: Record<string, string> = {};
      if (raw !== null && typeof raw === 'object') {
        for (const [field, key] of Object.entries(raw as Record<string, unknown>)) {
          if (typeof key === 'string') fields[field] = key;
        }
      }
      return new ApiError(status, message, code, fields, record);
    }
  } catch {
    // Not JSON. The raw body is still the most useful thing to show.
  }
  return new ApiError(status, body || statusText);
}

function baseUrl(): string {
  return process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';
}

interface RequestOptions {
  organizationId?: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) throw new ApiError(401, 'No active session');

  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    accept: 'application/json',
  };

  // Which organization to act as, when the person belongs to several. The API
  // treats this as a request, not a grant: it re-checks the membership.
  if (options.organizationId) {
    headers['x-poolse-organization'] = options.organizationId;
  }

  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  // Built up rather than declared in one literal: with exactOptionalPropertyTypes
  // an explicit `body: undefined` is not the same as no body at all.
  const init: RequestInit = { method: options.method ?? 'GET', headers, cache: 'no-store' };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);

  const response = await fetch(`${baseUrl()}${path}`, init);

  if (!response.ok) {
    throw readError(response.status, await response.text(), response.statusText);
  }

  // 204, and any other body-less success.
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

export async function apiFetch<T>(
  path: string,
  options: { organizationId?: string } = {},
): Promise<T> {
  return request<T>(path, options);
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  options: { organizationId?: string } = {},
): Promise<T> {
  return request<T>(path, { ...options, method: 'POST', body });
}

export async function apiPut<T>(
  path: string,
  body: unknown,
  options: { organizationId?: string } = {},
): Promise<T> {
  return request<T>(path, { ...options, method: 'PUT', body });
}

export async function apiPatch<T>(
  path: string,
  body: unknown,
  options: { organizationId?: string } = {},
): Promise<T> {
  return request<T>(path, { ...options, method: 'PATCH', body });
}

/**
 * A removal with nothing to send — POOLSE-44.
 *
 * Everything soft-deleted so far has been a `POST .../archive`, because
 * archiving is a state change with an audit entry behind it rather than an
 * erasure. A slot is the first thing whose removal reads as a delete to the
 * person doing it, so the verb matches what they think they are doing; the
 * repository still archives, and the history still stays.
 */
export async function apiDelete<T>(
  path: string,
  options: { organizationId?: string } = {},
): Promise<T> {
  return request<T>(path, { ...options, method: 'DELETE' });
}

import type { Paginated } from './pagination';

export type { Paginated };

export interface Me {
  user: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    avatarUrl: string | null;
    locale: string;
    theme: string;
    /** ISO date, YYYY-MM-DD. */
    birthDate: string | null;
    contactPhone: string | null;
  };
  memberships: {
    appUserId: string;
    organizationId: string;
    organizationName: string;
    organizationSlug: string;
    membershipId: string;
    roles: string[];
    subscriptionStatus: 'trialing' | 'active' | 'past_due' | 'canceled';
    /** ISO date, or null once the organization is no longer trialing. */
    trialEndsAt: string | null;
  }[];
}

export interface OrganizationMember {
  membershipId: string;
  appUserId: string | null;
  status: 'invited' | 'active' | 'suspended';
  firstName: string | null;
  lastName: string | null;
  /**
   * Composed by the server — POOLSE-32. Never assembled here.
   *
   * `displayName` is every part, first name first: the detail page, and any
   * document. `shortName` is "Maria Santos": lists, cards, rosters and the
   * calendar, where a five-part Portuguese name breaks the layout.
   */
  displayName: string | null;
  shortName: string | null;
  email: string | null;
  roles: string[];
  /** Clerk's cached avatar for staff. Students are handled quite differently. */
  avatarUrl: string | null;
  /** ISO date, or null — Poolse's own column, used to flag a birthday. */
  birthDate: string | null;
}

/** `not_configured` is not a failure — no provider is set up, so copy the link. */
export type InvitationDelivery = 'pending' | 'sent' | 'failed' | 'not_configured';

export interface PendingInvitation {
  id: string;
  email: string;
  roles: string[];
  expiresAt: string;
  createdAt: string;
  delivery: InvitationDelivery;
  deliveredAt: string | null;
  invitedByFirstName: string | null;
  invitedByLastName: string | null;
}

export interface StaffCounts {
  total: number;
  /** Keyed by staff role. Every staff role is present, zero included. */
  byRole: Record<string, number>;
}

export interface People {
  organizationId: string;
  /** One page of the staff list — POOLSE-29. */
  members: Paginated<OrganizationMember>;
  /** Not paginated: a queue worked down, not a register that grows. */
  invitations: PendingInvitation[];
  /**
   * Every admin the organization could be handed to — not a page of them.
   *
   * Its own field rather than a filter over `members`, because a picker has to
   * be complete: filtering the page would offer only the admins who landed on
   * page 1 — POOLSE-29.
   */
  transferCandidates: OrganizationMember[];
  /**
   * The size of the team, independent of whatever filter is applied.
   *
   * `members.total` is the total of the current query — under the Instrutor chip
   * it is the number of instructors, not the number of staff. `total` counts
   * people and `byRole` counts roles, so they deliberately do not add up: an
   * admin who also instructs is one person and two roles.
   */
  counts: StaffCounts;
  canInvite: boolean;
  /** Never contains `owner`: it moves only by transfer. */
  grantableRoles: string[];
  canTransferOwnership: boolean;
  /** Owner or admin — POOLSE-03. The honest signal for "may manage things". */
  canArchive: boolean;
}

export interface CreatedInvitation {
  id: string;
  email: string;
  roles: string[];
  expiresAt: string;
  /** Shown once and never retrievable again: the API stores only its hash. */
  token: string;
  /** True when the invitation was actually emailed. False means copy the link. */
  emailed: boolean;
}

export type InvitationStatus =
  | 'pending'
  | 'expired'
  | 'revoked'
  | 'already_accepted'
  | 'not_found';

export interface InvitationPreview {
  status: InvitationStatus;
  organizationName: string | null;
  email: string | null;
  roles: string[];
  expiresAt: string | null;
}

export type AcceptStatus =
  | 'accepted'
  | 'expired'
  | 'revoked'
  | 'already_accepted'
  | 'not_found'
  | 'unknown_account';

export interface AcceptResult {
  status: AcceptStatus;
  organizationId: string | null;
  organizationName: string | null;
  membershipId: string | null;
}

export interface Pool {
  id: string;
  facilityId: string;
  name: string;
  kind: 'indoor' | 'outdoor';
  volumeLitres: number | null;
  laneCount: number | null;
  minDepthM: number | null;
  /** Metres. Decimal — 12.5 m is an ordinary pool length. */
  lengthM: number | null;
  widthM: number | null;
  maxDepthM: number | null;
}

/**
 * The metric list lives in `lib/pool-metrics.ts`, not here.
 *
 * This module imports Clerk's server SDK, so anything exported from it as a
 * runtime value is unreachable from a `'use client'` component — the analysis
 * form needs the list to render its inputs. The type is re-exported so server
 * code that already reads it from `@/lib/api` keeps working.
 */
export type { PoolMetric } from './pool-metrics';

export interface AnalysisValue {
  metric: PoolMetric;
  value: number;
  /** Travels with the value — pH, °C and ppm do not share a type. */
  unit: string;
}

/**
 * One water analysis of a pool — round 4.
 *
 * A visit: one moment, one author, one set of notes, and the values measured
 * then. Ordered oldest first by the API, which is the order both the trend and
 * the report read in.
 */
export interface PoolAnalysis {
  id: string;
  /** ISO instant, UTC. Displayed in the facility's timezone. */
  takenAt: string;
  notes: string | null;
  recordedByName: string | null;
  values: AnalysisValue[];
}

/**
 * Where a kind of item lives — round 6.
 *
 * `facility` is the building rather than any tank: a store room, an office, the
 * AED. `pools` is a chosen set. `all_pools` is every tank at this site,
 * including ones bought next season — which is why it is a scope and not a
 * snapshot of pool ids.
 */
export type InventoryScope = 'facility' | 'pools' | 'all_pools';

/**
 * One kind of item in a site's store — round 4, rescoped in round 6.
 *
 * A count against a free-text name, not a stock ledger. Nobody labels forty pull
 * buoys, and a movement log nobody posts to drifts from reality within a month
 * and then lies with more precision than a count does.
 */
export interface InventoryItem {
  id: string;
  facilityId: string;
  name: string;
  quantity: number;
  /** What the number counts when the name does not say — pares, caixas, metros. */
  unit: string | null;
  notes: string | null;
  scope: InventoryScope;
  /** Empty unless `scope` is `pools`. */
  poolIds: string[];
  poolNames: string[];
}

/**
 * A row of a facility's schedule grid — POOLSE-44.
 *
 * Three day groups, because a club that opens Saturday morning and not Sunday
 * has to be able to say so. `24:00` is a real end time and means the end of the
 * day; `00:00` as an end is refused by the API with that instruction.
 */
export type DayGroup = 'weekday' | 'saturday' | 'sunday';

export interface TimeSlot {
  id: string;
  dayGroup: DayGroup;
  /** `HH:MM`, wall-clock at the facility. */
  startTime: string;
  endTime: string;
}

export interface FacilitySlots {
  organizationId: string;
  canManage: boolean;
  /** Null when the club has no season yet, in which case there is no grid. */
  seasonId: string | null;
  slots: TimeSlot[];
}

/** What the inventory screen loads: a site's store, and the sites to choose from. */
export interface Inventory {
  organizationId: string;
  canManage: boolean;
  facilities: { id: string; name: string; pools: { id: string; name: string }[] }[];
  /** The site being shown — the requested one, or the first. */
  facilityId: string | null;
  /** `total` is how many matched the search, not how many the site has. */
  items: Paginated<InventoryItem>;
}

/** The whole filtered list, for the export route. No window. */
export interface InventoryExport {
  facilityId: string | null;
  items: InventoryItem[];
}

export interface Photo {
  id: string;
  /** Object key. Resolved to a signed URL by photoUrlFor, never stored as one. */
  storageKey: string;
  caption: string | null;
}

export interface Facility {
  id: string;
  name: string;
  address: string | null;
  timezone: string;
  pools: Pool[];
  photos: Photo[];
}

/** Where a site is, once somebody has chosen it from the geocoder. */
export interface Place {
  city: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** One candidate from the city autocomplete. */
export interface PlaceSuggestion {
  id: number;
  city: string;
  countryCode: string | null;
  country: string | null;
  /** "Distrito de Aveiro" — what tells two places of the same name apart. */
  region: string | null;
  latitude: number;
  longitude: number;
}

/**
 * Headcounts, organization-wide.
 *
 * Not per site: neither a student nor a membership carries a facility, so these
 * are the organization's numbers shown on its site page. Absent entirely for
 * anybody who is not an owner or an admin.
 */
export interface PeopleCounts {
  student: number;
  owner: number;
  admin: number;
  instructor: number;
  maintenance: number;
  guardian: number;
}

/**
 * One weekday of a site's standing opening rules — round 4.
 *
 * ISO weekday, Monday 1 … Sunday 7, matching `class_schedule.weekday` and
 * `extract(ISODOW …)`. Times are `HH:MM` wall-clock at the facility; `24:00` is
 * a real value and means the end of the day, which is what every site starts
 * with until somebody narrows it.
 */
export interface FacilityDay {
  weekday: number;
  available: boolean;
  opensAt: string;
  closesAt: string;
  /** Turma slots already on this weekday at this site. Warns before, not after. */
  scheduledClasses: number;
}

export interface FacilityDetail extends Facility, Place {
  organizationId: string;
  canManage: boolean;
  counts?: PeopleCounts;
  /** Always seven, ascending. Readable by anyone who may see the site. */
  hours: FacilityDay[];
}

export type VacationStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

export interface VacationRequest {
  id: string;
  membershipId: string;
  personName: string | null;
  status: VacationStatus;
  requestedAt: string;
  decidedAt: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
  /** ISO dates, ascending. */
  days: string[];
}

export interface Holiday {
  day: string;
  name: string;
  scope: 'national' | 'municipal';
}

export interface Balance {
  entitlement: number;
  taken: number;
  /** Asked for and not yet answered. Does not reduce `remaining`. */
  requested: number;
  remaining: number;
}

export interface MyVacations {
  organizationId: string;
  year: number;
  membershipId: string;
  balance: Balance;
  requests: VacationRequest[];
  holidays: Holiday[];
  canApprove: boolean;
}

export interface PendingVacations {
  organizationId: string;
  /** One page of the approval queue — POOLSE-29. */
  requests: Paginated<VacationRequest & { othersOff: { name: string | null; day: string }[] }>;
}

export interface TeamMember {
  membershipId: string;
  name: string | null;
  /** Approved days only — a pending request is not cover anybody can plan around. */
  days: string[];
}

export interface TeamVacations {
  organizationId: string;
  year: number;
  members: TeamMember[];
  holidays: Holiday[];
}

export interface ForecastDay {
  date: string;
  minC: number | null;
  maxC: number | null;
  weatherCode: number | null;
  precipitationMm: number | null;
}

export interface Weather {
  temperatureC: number | null;
  apparentTemperatureC: number | null;
  windSpeedKmh: number | null;
  precipitationMm: number | null;
  /** WMO code, translated in this app — the API holds no user-facing strings. */
  weatherCode: number | null;
  isDay: boolean | null;
  days: ForecastDay[];
}

export interface WeatherResponse {
  available: boolean;
  weather: Weather | null;
}

export interface PoolDetail extends Pool {
  /** Every analysis of this pool, oldest first. */
  analyses: PoolAnalysis[];
  organizationId: string;
  facilityId: string;
  facilityName: string;
  photos: Photo[];
}

export interface Facilities {
  organizationId: string;
  facilities: Facility[];
  canManage: boolean;
  timezones: string[];
}

export interface StudentLevel {
  id: string;
  name: string;
  sortOrder: number;
  /**
   * Months, both optional and independent — POOLSE-06.
   *
   * "Adultos" has a minimum and no maximum; a baby class starts at six months,
   * which whole years could not express.
   */
  minAgeMonths: number | null;
  maxAgeMonths: number | null;
  /**
   * Who the escalão admits — round 5. Both true is misto, and the default.
   *
   * This is what lets two escalões share a name: "Cadetes" for the girls and
   * "Cadetes" for the boys are two rows an operator reads as one word.
   */
  admitsMale: boolean;
  admitsFemale: boolean;
  studentCount: number;
}

export interface Guardian {
  /** The link between this guardian and this student. */
  linkId: string;
  /** The person. One row per human per club, however many children they bring. */
  membershipId: string;
  /** Every part, first name first — the block reads as a record, not a list. */
  name: string;
  /** First given name + last surname, for anywhere they appear in a list. */
  shortName: string;
  relationship: string | null;
  phone: string | null;
  email: string | null;
  /** NIF, optional. */
  taxNumber: string | null;
  address: string | null;
  /** Who to ring first. At most one per student. */
  isPrimary: boolean;
  /** Clerk owns their name and email — the form shows those read-only. */
  hasLogin: boolean;
}

/**
 * A person the club already knows — POOLSE-17.
 *
 * Everybody, not only guardians: the grandmother enrolling a child may already
 * be a student or an instructor, and picking her rather than typing her again is
 * what keeps one human as one record.
 */
export interface PersonSummary {
  membershipId: string;
  name: string;
  email: string | null;
  phone: string | null;
  taxNumber: string | null;
  address: string | null;
  roles: string[];
  hasLogin: boolean;
  /** How many students they already look after. Shown so a pick is confident. */
  guardianOf: number;
  /** First given name + last surname, for the picker's list — POOLSE-32. */
  shortName: string;
}

export interface Student {
  id: string;
  firstName: string;
  lastName: string;
  /**
   * Composed by the server — POOLSE-32. Never assembled here.
   *
   * `displayName` is every part, first name first: the detail page, and any
   * document. `shortName` is "Maria Santos": lists, cards, rosters and the
   * calendar, where a five-part Portuguese name breaks the layout.
   */
  displayName: string;
  shortName: string;
  birthDate: string | null;
  /** Whole years, computed by the database so no timezone shifts a birthday. */
  age: number | null;
  levelId: string | null;
  levelName: string | null;
  /**
   * Masculino or feminino, optional — round 5.
   *
   * Null is the ordinary state of an imported row. Matched against an escalão's
   * `admitsMale`/`admitsFemale` for display only: nothing refuses an enrolment
   * on it, exactly as nothing refuses one on the age range.
   */
  gender: 'male' | 'female' | null;
  contactEmail: string | null;
  contactPhone: string | null;
  /**
   * The student's own NIF, for somebody invoiced in their own name.
   *
   * No age rule — minors have NIFs in Portugal, and a parent deducts the lessons
   * against the child's number. Unique among the club's living students.
   */
  taxNumber: string | null;
  notes: string | null;
  /** Where they stand on paying, for the register's column. Decided by the API. */
  paymentState: 'none' | 'paid' | 'due' | 'overdue';
  /** POOLSE-42 — membership is a fact about the person, not a derived one. */
  isSocio: boolean;
  socioNumber: string | null;
  /** Null unless a live `photo` consent exists — the API decides, not the caller. */
  photoStorageKey: string | null;
  photoConsent: boolean;
  /**
   * Every encarregado de educação, primary first — POOLSE-04, POOLSE-17.
   *
   * Each is a link to a person, not a copy of their details: the same
   * grandmother covers three grandchildren from one record, and correcting her
   * phone number once corrects it everywhere.
   *
   * Kept whatever the student's age. Nothing severs a link when somebody turns
   * eighteen, because "who was your guardian" stays true about the years it
   * covered.
   */
  guardians: Guardian[];
  /**
   * Present on the single-student read, absent from the list.
   *
   * The record hides controls this caller may not use; the endpoints behind them
   * refuse independently, so these are courtesy rather than access control.
   */
  canViewSensitive?: boolean;
  canViewProgress?: boolean;
}

export interface Students {
  organizationId: string;
  /**
   * One page of the register — POOLSE-29.
   *
   * `total` counts what matched the search and the level filter, not what
   * exists, because that is the number the range label reports.
   */
  students: Paginated<Student>;
  /** Not paginated: the programme ladder is fixed, and it fills the filter. */
  levels: StudentLevel[];
  canManage: boolean;
  /**
   * The club's maioridade — POOLSE-22.
   *
   * Sent by the API so the guardian block and every "under N" message read the
   * tenant's line rather than a number compiled into this bundle.
   */
  ageOfMajority: number;
}

/**
 * The import — slice 1.10. Mirrors `students/import.ts` on the API.
 *
 * `problems` carry machine codes, never sentences: the API has no message
 * catalogues, so `students.importProblem.*` in this app's catalogue is where
 * each one becomes Portuguese.
 */
/** What refuses a row. Short on purpose — only the name is mandatory. */
export type ImportProblemCode =
  | 'nameRequired'
  | 'tooLong'
  | 'badDate'
  | 'futureDate'
  | 'ancientDate';

/** What is said out loud and imported anyway. */
export type ImportWarningCode =
  | 'noGuardian'
  | 'guardianNotRecorded'
  | 'levelWillBeCreated'
  | 'taxNumberBelongsToAnother';

/** A blank on an existing student that this row would fill in. */
export interface ImportUpdate {
  field: 'birthDate' | 'levelId' | 'contactEmail' | 'contactPhone' | 'taxNumber' | 'notes';
  value: string;
}

export interface ImportProblem {
  field: string;
  code: ImportProblemCode;
  value?: string;
}

export interface ImportWarning {
  field: string;
  code: ImportWarningCode;
  value?: string;
}

export interface ImportDuplicate {
  /** `register` is a student Poolse already has; `file` is an earlier row of this sheet. */
  kind: 'register' | 'file';
  studentId?: string;
  name: string;
  line?: number;
  /** Which rung matched — a NIF is an identity, a name and a birthday are a hint. */
  matchedOn: 'taxNumber' | 'nameAndBirthDate';
}

export interface ImportRowResult {
  index: number;
  line: number;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  levelId: string | null;
  levelName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  taxNumber: string | null;
  notes: string | null;
  guardian: {
    name: string;
    relationship: string | null;
    phone: string | null;
    email: string | null;
    taxNumber: string | null;
  } | null;
  problems: ImportProblem[];
  warnings: ImportWarning[];
  duplicate: ImportDuplicate | null;
  /** What a commit would fill in on the matched student. Empty when nothing would change. */
  updates: ImportUpdate[];
  /** A duplicate is still importable — the operator decides, the tick carries it. */
  importable: boolean;
}

export interface ImportResult {
  rows: ImportRowResult[];
  summary: {
    total: number;
    importable: number;
    refused: number;
    duplicates: number;
    toUpdate: number;
    toCreate: number;
    flagged: number;
    minorsWithoutGuardian: number;
    /** Level names this import would add to the club's programme. */
    levelsToCreate: string[];
  };
  /** Present only on a commit. */
  created?: number;
  updated?: number;
  skipped?: number;
  levelsCreated?: string[];
}

/**
 * The inventory import's answer — round 6.
 *
 * The same shape as the register's, deliberately: one preview, one commit, the
 * same rows both times. What differs is the vocabulary — a duplicate here is a
 * stocktake rather than a mistake, so a match carries the values it would
 * replace instead of a list of blanks it would fill.
 */
export interface InventoryImportProblem {
  field: string;
  code: 'nameRequired' | 'tooLong' | 'badQuantity';
  value?: string;
}

export interface InventoryImportWarning {
  field: string;
  code: 'poolNotFound' | 'noPoolsMatched' | 'quantityMissing';
  value?: string;
}

export interface InventoryImportUpdate {
  field: 'quantity' | 'unit' | 'notes' | 'scope' | 'pools';
  /** What is recorded now, so the screen can show it beside the new value. */
  before: string;
  after: string;
}

export interface InventoryImportRowResult {
  index: number;
  line: number;
  name: string;
  quantity: number;
  unit: string | null;
  notes: string | null;
  scope: InventoryScope;
  poolIds: string[];
  poolNames: string[];
  problems: InventoryImportProblem[];
  warnings: InventoryImportWarning[];
  duplicate: {
    /** `store` is already at this site; `file` is an earlier row of the same sheet. */
    kind: 'store' | 'file';
    itemId?: string;
    name: string;
    line?: number;
  } | null;
  updates: InventoryImportUpdate[];
  importable: boolean;
}

export interface InventoryImportResult {
  rows: InventoryImportRowResult[];
  summary: {
    total: number;
    importable: number;
    refused: number;
    duplicates: number;
    toUpdate: number;
    toCreate: number;
    flagged: number;
  };
  /** Present only on a commit. */
  created?: number;
  updated?: number;
  skipped?: number;
}

/**
 * The price list and what a student pays — POOLSE-42.
 *
 * Every total here was computed by Postgres. `fee_total_cents` is the single
 * definition (AC7) and nothing in this app recomputes it — a number arriving
 * from the API is the number, and the screen's job is to format it for the
 * locale, not to work it out again.
 */
export interface FeePeriod {
  id: string;
  name: string;
  months: number;
  discountPercent: number;
  isDefault: boolean;
  sortOrder: number;
}

/**
 * Which members a quota is for — round 5.
 *
 * `any` is a club with one rate. A banded row beats `any` where both exist, so a
 * child rate can be added to an existing list without editing anything else.
 */
export type FeeAgeBand = 'any' | 'under_18' | 'adult';

/** How a late payment is charged. `none` is most clubs, and the default. */
export type FeePenaltyKind = 'none' | 'amount' | 'percent';

export interface FeePlan {
  id: string;
  kind: 'mensalidade' | 'quota';
  /** A mensalidade has both; a quota has neither. There is no name. */
  levelId: string | null;
  levelName: string | null;
  lessonsPerWeek: number | null;
  amountCents: number;
  defaultFeePeriodId: string | null;
  /** Quotas only. A mensalidade is banded by its level, which says it better. */
  ageBand: FeeAgeBand;
  /** The turmas this price governs, matched by level and weekly sessions. */
  classGroups: { id: string; name: string }[];
}

/** When a payment is due at this site, and what being late costs. */
export interface BillingSettings {
  paymentDueDay: number;
  /** A late mensalidade: how it is charged, and both possible amounts. */
  latePenaltyKind: FeePenaltyKind;
  latePenaltyCents: number;
  latePenaltyPercent: number;
  /** A late quota, asked separately: a club may fine one and not the other. */
  quotaPenaltyKind: FeePenaltyKind;
  quotaPenaltyCents: number;
  quotaPenaltyPercent: number;
}

export interface StudentFeeLine {
  id: string;
  facilityId: string;
  facilityName: string;
  planId: string;
  levelName: string | null;
  lessonsPerWeek: number | null;
  kind: 'mensalidade' | 'quota';
  enrollmentId: string | null;
  classGroupName: string | null;
  periodId: string;
  periodName: string;
  months: number;
  /** The agreed amount per month — the snapshot, never the plan's price today. */
  amountCents: number;
  discountPercent: number;
  manualDiscountPercent: number | null;
  manualDiscountCents: number | null;
  discountReason: string | null;
  periodTotalCents: number;
  payableCents: number;
  startsOn: string;
  endsOn: string | null;
  /**
   * The occurrence being asked for, and whether it is settled.
   *
   * An occurrence, not a calendar month: a trimestral line has four a year.
   * Null on an ended line, which is not asking for anything.
   */
  currentPeriodStart: string | null;
  dueOn: string | null;
  isPaid: boolean;
  paidOn: string | null;
  isOverdue: boolean;
  /** Set only when the plan has moved on — that is the marker, and the whole rule. */
  planAmountCentsNow: number | null;
  /**
   * True when a quota line is on the wrong side of eighteen — round 5.
   *
   * The agreed amount does not move on a birthday; the record says the rate has
   * changed and applying it is the same one click as any other price change.
   */
  bandChanged: boolean;
}

/**
 * The price a student's classes imply — POOLSE-42, third pass.
 *
 * Nobody picks this. A child in Iniciação twice a week is on the
 * Iniciação-twice-a-week price, and the timetable already says so.
 */
export interface CurrentPlan {
  facilityId: string;
  facilityName: string;
  levelId: string | null;
  levelName: string | null;
  lessonsPerWeek: number;
  planId: string | null;
  amountCents: number | null;
  defaultFeePeriodId: string | null;
  /** Whether it is already being charged. */
  hasLine: boolean;
}

export interface StudentFees {
  /** What their turmas come to, before anything is charged. */
  currentPlans: CurrentPlan[];
  lines: StudentFeeLine[];
  socio: { isSocio: boolean; socioNumber: string | null; socioSince: string | null };
  /**
   * One penalty per kind of charge — a club may fine a late mensalidade and not
   * a late quota. Shown and added to what is owed; never written as a charge.
   */
  penalties: { mensalidadeCents: number; quotaCents: number };
  penaltyCents: number;
}

export type ConsentKind = 'photo' | 'medical_data' | 'parent_sharing';

export interface ConsentRecord {
  id: string;
  kind: ConsentKind;
  granted: boolean;
  grantedAt: string;
  grantedByName: string | null;
  evidenceNote: string | null;
  withdrawnAt: string | null;
  withdrawnByName: string | null;
}

export interface SensitiveNotes {
  /** Decrypted for the caller. The database only ever held ciphertext. */
  medicalNotes: string | null;
  recordedAt: string | null;
  recordedByName: string | null;
}

/**
 * A period a student is medically unable to swim — round 5.
 *
 * `active` is computed by the database against `current_date`, so two clients
 * with two clocks cannot disagree about whether somebody is off today.
 */
export interface MedicalLeave {
  id: string;
  startsOn: string;
  /** Null means open-ended. */
  endsOn: string | null;
  reason: string | null;
  /**
   * Where the atestado is filed — a document number or a location.
   *
   * Deliberately a reference and not a file: object storage is deferred, and a
   * medical certificate is not the document to bring it forward for.
   */
  justificationReference: string | null;
  recordedByName: string | null;
  active: boolean;
}

export interface SensitiveRecord {
  organizationId: string;
  notes: SensitiveNotes;
  consent: ConsentRecord[];
  kinds: ConsentKind[];
  canManage: boolean;
  /** Every live leave for this student, newest first. */
  medicalLeave: MedicalLeave[];
}

export type Stroke = 'freestyle' | 'backstroke' | 'breaststroke' | 'butterfly' | 'medley';

export interface SwimRecord {
  id: string;
  stroke: Stroke;
  distanceM: number;
  /** Integer milliseconds. Format with formatTime from components/progress-chart. */
  timeMs: number;
  swumOn: string;
  note: string | null;
  recordedByName: string | null;
  isPersonalBest: boolean;
}

export interface PersonalBest {
  stroke: Stroke;
  distanceM: number;
  timeMs: number;
  swumOn: string;
}

export interface Progression {
  organizationId: string;
  records: SwimRecord[];
  bests: PersonalBest[];
  /** Fastest, not "best" — see the note on fastestStroke in the API. */
  fastestStroke: Stroke | null;
  /** Declared by a person, never derived. */
  favouriteStroke: Stroke | null;
  strokes: Stroke[];
  canRecord: boolean;
}

export interface ActiveSession {
  id: string;
  createdAt: string;
  lastActiveAt: string;
  isCurrent: boolean;
}

export interface ScheduleSlot {
  id: string;
  /** ISO weekday: Monday 1 … Sunday 7. */
  weekday: number;
  /** Wall-clock "HH:MM" at the facility — not an instant. */
  startTime: string;
  durationMinutes: number;
}

export interface EnrolledStudent {
  enrollmentId: string;
  studentId: string;
  firstName: string;
  lastName: string;
  /**
   * Composed by the server — POOLSE-32. Never assembled here.
   *
   * `displayName` is every part, first name first: the detail page, and any
   * document. `shortName` is "Maria Santos": lists, cards, rosters and the
   * calendar, where a five-part Portuguese name breaks the layout.
   */
  displayName: string;
  shortName: string;
  status: 'active' | 'waiting';
  waitingPosition: number | null;
}

export interface ClassGroup {
  id: string;
  name: string;
  levelId: string | null;
  levelName: string | null;
  poolId: string | null;
  poolName: string | null;
  /** The site the pool is at — the schedule board filters and draws by it. */
  facilityId: string | null;
  instructorMembershipId: string | null;
  instructorName: string | null;
  capacity: number | null;
  lane: number | null;
  schedules: ScheduleSlot[];
  students: EnrolledStudent[];
  /**
   * A month's price for a place here — POOLSE-42.
   *
   * Matched by the API on this turma's level and its own weekly slot count.
   * Null when the site prices no such combination.
   */
  monthlyPriceCents: number | null;
}

export interface ClassOptions {
  /** With their age bounds — the enrol picker filters on the turma's level. */
  levels: { id: string; name: string; minAgeMonths: number | null; maxAgeMonths: number | null }[];
  pools: { id: string; name: string }[];
  instructors: { id: string; name: string }[];
  /** With birth dates, so the picker can work out who fits. */
  students: { id: string; name: string; birthDate: string | null }[];
}

export interface Classes {
  organizationId: string;
  /** Not paginated — POOLSE-29: a week grid is a calendar, bounded by the week. */
  groups: ClassGroup[];
  canManage: boolean;
  /** Not paginated: a half-filled dropdown is a form that cannot say what it means. */
  options: ClassOptions;
  /**
   * Every site with its weekly opening hours — round 5.
   *
   * The schedule board draws its rows between a day's opening and closing time
   * instead of between two constants, which is what stopped a 06:30 class at a
   * site open from 06:00 from being invisible above the grid.
   */
  facilities: { id: string; name: string; hours: FacilityDay[] }[];
}

export interface TimetableEntry {
  classGroupId: string;
  className: string;
  levelName: string | null;
  poolName: string | null;
  instructorName: string | null;
  lane: number | null;
  weekday: number;
  startTime: string;
  durationMinutes: number;
  status: 'active' | 'waiting';
}

export interface Closure {
  id: string;
  facilityId: string | null;
  poolId: string | null;
  poolName: string | null;
  /** ISO date, YYYY-MM-DD. A closure is days, not instants. */
  startsOn: string;
  endsOn: string;
  reason: string;
  blocksGeneration: boolean;
  repeatsAnnually: boolean;
  source: 'manual' | 'national_holiday';
}

export interface Closures {
  organizationId: string;
  closures: Closure[];
  canManage: boolean;
  pools: { id: string; name: string }[];
}

export interface CalendarSession {
  id: string;
  classGroupId: string;
  className: string;
  levelName: string | null;
  poolName: string | null;
  /** Every lane it occupies, by position — POOLSE-46. Empty when none was chosen. */
  lanes: number[];
  instructorName: string | null;
  substituteName: string | null;
  startsAt: string;
  /** Local calendar date at the facility. This is the one to group by. */
  localDate: string;
  /** Local wall-clock, "HH:MM". */
  localTime: string;
  weekday: number;
  durationMinutes: number;
  status: 'scheduled' | 'cancelled' | 'completed';
  cancellationReason: string | null;
  /** True when a closure cancelled it rather than a person. */
  byClosure: boolean;
  enrolled: number;
  /** The active roll, alphabetical — POOLSE-15, for the hover panel. */
  students: string[];
}

/** Late arrival is deliberately not recorded — POOLSE-13. */
export type AttendanceStatus = 'present' | 'absent' | 'excused';

export interface RegisterEntry {
  studentId: string;
  firstName: string;
  lastName: string;
  /**
   * Composed by the server — POOLSE-32. Never assembled here.
   *
   * `displayName` is every part, first name first: the detail page, and any
   * document. `shortName` is "Maria Santos": lists, cards, rosters and the
   * calendar, where a five-part Portuguese name breaks the layout.
   */
  displayName: string;
  shortName: string;
  /**
   * Here on a reposição — POOLSE-21 criterion 8.
   *
   * Marked like anybody else and never enrolled: a guest is not in `enrollment`
   * at all, so no roster, seat count or proposal can mistake them for one.
   */
  isGuest: boolean;
  /** Null until somebody marks them — not the same as `absent`. */
  status: AttendanceStatus | null;
  note: string | null;
  recordedByName: string | null;
  recordedAt: string | null;
  /** False for a trial, a make-up, or a sibling brought along. */
  enrolled: boolean;
}

export interface Register {
  sessionId: string;
  className: string;
  poolName: string | null;
  /** Every lane it occupies, by position — POOLSE-46. Empty when none was chosen. */
  lanes: number[];
  localDate: string;
  localTime: string;
  durationMinutes: number;
  status: 'scheduled' | 'cancelled' | 'completed';
  instructorName: string | null;
  entries: RegisterEntry[];
}

export interface Calendar {
  organizationId: string;
  from: string;
  to: string;
  sessions: CalendarSession[];
  canManage: boolean;
}

/**
 * A season — POOLSE-07.
 *
 * September to August, the year a club actually runs. Exactly one is current at
 * a time; the rest are history that stays readable.
 */
export interface Season {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  /**
   * POOLSE-45. One published season at a time; any number of drafts beside it,
   * from which no dated session is ever generated; archived is a year that
   * happened and stays fully readable.
   */
  status: 'draft' | 'published' | 'archived';
  /** True for the published season — the same fact, kept for existing readers. */
  active: boolean;
  classGroups: number;
}

/** What a reset would retire, so the confirmation can name real numbers. */
export interface ResetPreview {
  seasonName: string;
  classGroups: number;
  enrollments: number;
  sessions: number;
  attendance: number;
}

export interface Seasons {
  organizationId: string;
  seasons: Season[];
  canManage: boolean;
  preview?: ResetPreview;
  suggested: { name: string; startsOn: string; endsOn: string };
}

/**
 * An encarregado de educação with the students they look after — POOLSE-35.
 *
 * One guardian to many students, which is the shape a free-text guardian column
 * could never express: the mother of three is one row with three children under
 * her, not three copies of the same woman.
 */
export interface GuardianRow {
  membershipId: string;
  /** The full legal name, for the heading of their own row. */
  name: string;
  /** First given name + last surname — POOLSE-32. */
  shortName: string;
  email: string | null;
  phone: string | null;
  hasLogin: boolean;
  /**
   * Their own student record, when this guardian also swims. Usually null.
   *
   * Matched by the server on name and birth date, and only when both are
   * recorded — see the query for why the birth date is not optional there.
   */
  studentId: string | null;
  /** Their children, already abbreviated and filed by surname by the server. */
  students: { id: string; name: string; relationship: string | null }[];
}

/**
 * A reposição credit — POOLSE-21.
 *
 * What the club owes a family for a class they justifiably missed. Minted by the
 * database when an absence is marked *falta justificada*, so it cannot drift
 * from the mark that earned it.
 */
export interface ReposicaoCredit {
  id: string;
  studentId: string;
  /** The date of the class that was missed. */
  issuedOn: string;
  expiresOn: string;
  status: 'available' | 'booked' | 'used' | 'expired';
  /** The turma the absence was in, so a credit reads as a class rather than a token. */
  className: string | null;
  /** The live booking, when there is one. Null unless the credit is `booked`. */
  bookingId: string | null;
  /**
   * Days remaining, counted in the club's calendar, or null once spent or gone.
   *
   * Computed by the server on purpose: "expires today" is a question about the
   * club's date, and a browser in another timezone would answer it differently.
   */
  daysLeft: number | null;
}

/**
 * An occurrence a reposição credit could be spent on — POOLSE-21, criteria 3 and 4.
 *
 * `freeSeats` counts places by the shared rule: enrolled, minus absences already
 * recorded on that date, minus guests already booked. Null when the turma has no
 * capacity set.
 */
export interface RedemptionOption {
  sessionId: string;
  classGroupId: string;
  className: string;
  levelName: string | null;
  poolName: string | null;
  /** The club's own date — a family reads a day, never an instant. */
  localDate: string;
  startTime: string;
  freeSeats: number | null;
}

/**
 * A turma a level-advancement proposal could move a student into — POOLSE-19.
 *
 * `rankReason` is why it sits where it does, so the queue can explain the
 * ranking rather than leaving an admin to re-derive it.
 */
export interface TransferCandidate {
  classGroupId: string;
  className: string;
  levelName: string | null;
  freeSeats: number | null;
  rankReason: 'same_slot' | 'same_instructor' | 'available';
}

/**
 * A student who has finished their level — POOLSE-19.
 *
 * `candidates` is computed when the queue is read, never stored: a ranking made
 * when the last skill was marked is wrong by the time anybody opens this, because
 * seats fill. An empty list is "ready to advance — no seat", which is a demand
 * signal for next season rather than a task anybody clears.
 */
export interface TransferProposal {
  id: string;
  studentId: string;
  studentName: string;
  fromLevelName: string;
  toLevelName: string;
  generatedAt: string;
  candidates: TransferCandidate[];
}

/** The club's rules for reposições — POOLSE-21, criteria 1, 4, 6 and 9. */
export interface ReposicaoSettings {
  enabled: boolean;
  /** Days from the absence. Capped at the end of the época when a credit is minted. */
  windowDays: number;
  /** Credits per student per época, or null for no cap. */
  capPerSeason: number | null;
  /** Redeemable only into a slot another student has vacated. Read by redemption. */
  backfillOnly: boolean;
  mode: 'self_service' | 'request';
}

export interface Guardians {
  organizationId: string;
  /** One page of encarregados — POOLSE-29. A family is never split across pages. */
  guardians: Paginated<GuardianRow>;
}

/**
 * Skills, in four states — POOLSE-20.
 *
 * Não iniciado, Iniciado, Avaliado, Adquirido. Assessment poolside is not
 * binary: an instructor introduces a skill, watches it, tests it, and only then
 * signs it off.
 */
// Re-exported so server code can keep importing types from one place; the value
// side lives in `./skills` because this module is server-only. See that file.
export type { SkillState } from './skills';

export interface Skill {
  id: string;
  levelId: string;
  name: string;
  sortOrder: number;
  /** Dias mínimos before this can be signed off. Null means no threshold. */
  minDays: number | null;
  /** Aulas mínimas — attended, not merely scheduled. */
  minLessons: number | null;
  videoUrl: string | null;
}

export interface SkillMark {
  studentId: string;
  skillId: string;
  state: SkillState;
  /** Whether signing off would need an override. Known before the tap, not after. */
  ready: boolean;
  overridden: boolean;
}

export interface TurmaSkills {
  classGroupId: string;
  className: string;
  levelId: string | null;
  levelName: string | null;
  students: { id: string; name: string }[];
  skills: Skill[];
  marks: SkillMark[];
}

export interface MarkOutcome {
  saved: number;
  needsOverride: { studentId: string; skillId: string }[];
}

/**
 * Somebody the club already knows, matched by the stable key — POOLSE-17 AC9.
 *
 * NIF first, then email. Returned while an operator is still typing, so the
 * warning can offer to add the role to this person rather than making a second
 * them.
 */
export interface DuplicateMatch {
  membershipId: string;
  name: string;
  matchedOn: 'nif' | 'email';
  roles: string[];
  email: string | null;
  phone: string | null;
  guardianOf: number;
}

/** One pair the merge would join, and every field the two disagree about. */
export interface MergeCandidate {
  keepId: string;
  absorbId: string;
  matchedOn: string;
  keepName: string;
  absorbName: string;
  conflicts: Record<string, { keep: string; absorb: string }>;
}

/**
 * A staff record — POOLSE-39.
 *
 * Name, phone and notes are editable. Email is not: it is the login identity and
 * moves only by re-invitation.
 */
export interface StaffRecord {
  membershipId: string;
  appUserId: string | null;
  clerkUserId: string | null;
  firstName: string | null;
  lastName: string | null;
  /**
   * Composed by the server — POOLSE-32. Never assembled here.
   *
   * `displayName` is every part, first name first: the detail page, and any
   * document. `shortName` is "Maria Santos": lists, cards, rosters and the
   * calendar, where a five-part Portuguese name breaks the layout.
   */
  displayName: string | null;
  shortName: string | null;
  /** Read-only for everybody, including the owner. */
  email: string | null;
  phone: string | null;
  notes: string | null;
  status: string;
  roles: string[];
  /** Set while a re-invite is outstanding; the existing login still works. */
  pendingInvite: { id: string; email: string; expiresAt: string } | null;
  /** The Alunos side of the same Person, where they are also a student. */
  studentId: string | null;
}
