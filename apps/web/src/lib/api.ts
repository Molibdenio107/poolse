import { auth } from '@clerk/nextjs/server';

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
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT';
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
  email: string | null;
  roles: string[];
  /** Clerk's cached avatar for staff. Students are handled quite differently. */
  avatarUrl: string | null;
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

export interface People {
  organizationId: string;
  members: OrganizationMember[];
  invitations: PendingInvitation[];
  canInvite: boolean;
  /** Never contains `owner`: it moves only by transfer. */
  grantableRoles: string[];
  canTransferOwnership: boolean;
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
  /** Metres. Decimal — 12.5 m is an ordinary pool length. */
  lengthM: number | null;
  widthM: number | null;
  maxDepthM: number | null;
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

export interface FacilityDetail extends Facility, Place {
  organizationId: string;
  canManage: boolean;
  counts?: PeopleCounts;
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
  requests: (VacationRequest & { othersOff: { name: string | null; day: string }[] })[];
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
  /** Both optional and independent: "Adultos" has a minimum and no maximum. */
  minAgeYears: number | null;
  maxAgeYears: number | null;
  studentCount: number;
}

export interface Student {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  /** Whole years, computed by the database so no timezone shifts a birthday. */
  age: number | null;
  levelId: string | null;
  levelName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
  /** Null unless a live `photo` consent exists — the API decides, not the caller. */
  photoStorageKey: string | null;
  photoConsent: boolean;
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
  students: Student[];
  levels: StudentLevel[];
  canManage: boolean;
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

export interface SensitiveRecord {
  organizationId: string;
  notes: SensitiveNotes;
  consent: ConsentRecord[];
  kinds: ConsentKind[];
  canManage: boolean;
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
  instructorMembershipId: string | null;
  instructorName: string | null;
  capacity: number | null;
  lane: number | null;
  schedules: ScheduleSlot[];
  students: EnrolledStudent[];
}

export interface ClassOptions {
  levels: { id: string; name: string }[];
  pools: { id: string; name: string }[];
  instructors: { id: string; name: string }[];
  students: { id: string; name: string }[];
}

export interface Classes {
  organizationId: string;
  groups: ClassGroup[];
  canManage: boolean;
  options: ClassOptions;
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
  lane: number | null;
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
}

/** Late arrival is deliberately not recorded — POOLSE-13. */
export type AttendanceStatus = 'present' | 'absent' | 'excused';

export interface RegisterEntry {
  studentId: string;
  firstName: string;
  lastName: string;
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
  lane: number | null;
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
