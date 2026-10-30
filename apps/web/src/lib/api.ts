import type { PoolseModule, PoolseSport } from '@poolse/rules';
import { auth } from '@clerk/nextjs/server';
import { cookies } from 'next/headers';
import type { SkillState } from './skills';
import type { PoolMetric } from './pool-metrics';
import type { BandMap, BandOverride } from './water';

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
  /**
   * The visitor's own address, forwarded to the API — POOLSE-62.
   *
   * Set by exactly one caller, the signup action, and read by exactly one
   * endpoint, which hashes it and stores the digest as a soft flag. Without it
   * the API would see this Next server on every signup, which is the same
   * address for everybody and therefore no signal at all.
   *
   * It is not `x-forwarded-for`: that header is the proxy chain's and rewriting
   * it would put our own hop in somebody else's audit. A name of our own says
   * what it is.
   */
  clientIp?: string;
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
  // treats this as a request, not a grant: it re-checks the membership. An
  // explicit one wins; otherwise the club chosen with the switcher — POOLSE-79.
  const organizationId = options.organizationId ?? (await activeOrganization());
  if (organizationId) {
    headers['x-poolse-organization'] = organizationId;
  }

  if (options.clientIp) {
    headers['x-poolse-client-ip'] = options.clientIp;
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

  /*
   * A handler that returns `null` is sent by Nest as a 200 with an **empty
   * body**, not the text `null` — `/platform/tenants/:id/claim` for a club
   * provisioned before trial claims existed is one. `response.json()` throws
   * "Unexpected end of JSON input" on that, which `describeLoad` then reported
   * as the API being unreachable. Empty means the null it was.
   */
  const text = await response.text();
  return (text === '' ? null : JSON.parse(text)) as T;
}

/**
 * The club this browser chose to act in — POOLSE-79. Set by entering a support
 * window (and cleared by leaving one). Absent, the API picks the first
 * membership, as it always has. `/me` puts this club first, so every screen
 * that reads `memberships[0]` reads the club it is acting in.
 */
export const ACTIVE_ORG_COOKIE = 'poolse_org';

async function activeOrganization(): Promise<string | undefined> {
  try {
    const value = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
    return value === undefined || value === '' ? undefined : value;
  } catch {
    // Outside a request (a build, a test): no choice was made.
    return undefined;
  }
}

async function organizationHeader(): Promise<Record<string, string>> {
  const organizationId = await activeOrganization();
  return organizationId === undefined ? {} : { 'x-poolse-organization': organizationId };
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
  options: { organizationId?: string; clientIp?: string } = {},
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

/**
 * Sends a file's bytes to `POST /files` — 12 October 2026.
 *
 * Raw bytes rather than multipart: the file was read from the form here on the
 * Next server, as every importer reads its file, and the API judges what it is
 * from its first bytes, never from a name or a browser's claim.
 */
export async function apiUpload<T>(path: string, bytes: ArrayBuffer): Promise<T> {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) throw new ApiError(401, 'No active session');

  const response = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'content-type': 'application/octet-stream',
      ...(await organizationHeader()),
    },
    body: bytes,
    cache: 'no-store',
  });
  if (!response.ok) {
    throw readError(response.status, await response.text(), response.statusText);
  }
  return (await response.json()) as T;
}

/**
 * The API's own response for a stored file, unread, so `/files/[id]` can hand
 * the stream on without holding a photograph in memory. The status is the
 * API's: a 403 or 404 is passed through as it is.
 */
export async function apiFileResponse(path: string): Promise<Response> {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) return new Response(null, { status: 401 });
  return fetch(`${baseUrl()}${path}`, {
    headers: { authorization: `Bearer ${token}`, ...(await organizationHeader()) },
    cache: 'no-store',
  });
}

import type { Paginated } from './pagination';

export type { Paginated };

export type OrganizationKind = 'business' | 'personal';

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
    /**
     * `business` is a club; `personal` is one person tracking their own pool —
     * slice 4.5. The navigation and the dashboard are shaped by it; nothing
     * else reads it, because a personal tenant is an ordinary tenant with
     * fewer screens.
     */
    organizationKind: OrganizationKind;
    /**
     * Closed by a platform administrator — slice 3.
     *
     * Non-null exactly when `suspensionReason` is. The dashboard shell reads it
     * and draws the notice instead of the app; every tenant-scoped API call
     * would answer 403 `tenant_suspended` anyway, so this is what turns a wall
     * of error screens into one sentence.
     */
    suspendedAt: string | null;
    /** The operator's own words, shown verbatim. */
    suspensionReason: string | null;
    /**
     * The trial ran out and the tenant may read but not write — POOLSE-61.
     *
     * A **third** access state: suspended beats read-only beats open. Null is
     * open. The shell renders a banner *above* the app rather than instead of it,
     * because everything the club built is still readable and still exportable —
     * which is the entire point of the state.
     */
    readOnlyAt: string | null;
    /**
     * The day the data stops being kept, quoted in the banner.
     *
     * Null when no deletion is scheduled, which is what an operator putting a
     * tenant into read-only by hand may well mean. The server's date, never
     * thirty days of arithmetic done here.
     */
    pendingDeleteAt: string | null;
    /**
     * Set only on a Poolse support membership (POOLSE-79): when the window
     * closes. The support banner quotes it; the role came from the grant.
     */
    supportExpiresAt: string | null;
    /**
     * The modules this club has on — POOLSE-87, computed by the API. The menu,
     * the site and pool tabs follow it; the API refuses the rest regardless.
     */
    modules: PoolseModule[];
    /**
     * The sports this club has switched on — POOLSE-124, `pool` always first.
     * Keys; the name is `sport.name.<key>`. POOLSE-125's menu reads it.
     */
    sports?: PoolseSport[];
    membershipId: string;
    roles: string[];
    /**
     * The shared union, not a copy of it.
     *
     * This was spelled out here as four of the six values, so `expired` and
     * `comped` — both of which `/me` can genuinely carry — were type errors to
     * compare against on the one screen that reads this.
     */
    subscriptionStatus: SubscriptionStatus;
    /** ISO date, or null once the organization is no longer trialing. */
    trialEndsAt: string | null;
  }[];
  /**
   * The club this browser asked for is not one of these any more — a support
   * window that ended, above all (POOLSE-79). The shell says so rather than
   * quietly acting in another club.
   */
  requestedOrganizationMissing?: boolean;
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
  /**
   * Away today, and why — round 6. Null when they are at work.
   *
   * Approved leave only, and only today: this list answers "who is here", not
   * "who has anything booked this year".
   */
  awayKind?: LeaveKind | null;
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

/** A staff member's date of birth and ID document — POOLSE-100 (`GET /staff/:id/identity`). */
export interface StaffIdentity {
  birthDate: string | null;
  /** `login`: theirs, set in O meu perfil. `record`: the club's, edited on the staff record. */
  birthDateSource: 'login' | 'record';
  idDocument: { type: 'cc' | 'passport' | 'residence_permit' | 'other'; number: string } | null;
  retentionMonths: number;
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
  /** Null for a link to share from the phone (30-10-2026). */
  email: string | null;
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
  /** What the tank is for — POOLSE-72; picks the temperature band. Null: not said. */
  use: PoolUse | null;
  volumeLitres: number | null;
  laneCount: number | null;
  minDepthM: number | null;
  /** Swimmers in the water at once, across every turma. Null is no ceiling — 4.2. */
  maxCapacity: number | null;
  /** Metres. Decimal — 12.5 m is an ordinary pool length. */
  lengthM: number | null;
  widthM: number | null;
  maxDepthM: number | null;
  /** What shuts it today — POOLSE-84. Absent where the read does not ask. */
  closure?: PoolClosure | null;
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
// The band types travel with the pool, and they are the rules package's — one
// vocabulary for a band, whichever side of the wire it is on.
export type { Band, BandMap, BandOverride } from './water';
import type { LabGrading, PoolUse } from './water';
export type { PoolUse } from './water';

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
  /** Filed from a laboratory report's chemistry (29-10-2026), not typed. */
  fromLab: boolean;
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
  /** Free text, where it belongs. Suggested from what the site already uses. */
  location: string | null;
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
  /** Owner, admin, maintenance. */
  canManage: boolean;
  /** Owner, admin — the trash button. */
  canArchive: boolean;
  facilities: { id: string; name: string; pools: { id: string; name: string }[] }[];
  /** The site being shown — the requested one, or the first. */
  facilityId: string | null;
  /** `total` is how many matched the search, not how many the site has. */
  items: Paginated<InventoryItem>;
  /** What this site already calls its places, for the location suggestions. */
  locations: string[];
}

/** One item somebody left behind — round 5, ticket 6.1. */
export interface LostAndFoundItem {
  id: string;
  description: string;
  locationFound: string | null;
  /** ISO date, no time: the column is a `date` so it never grows one. */
  foundOn: string;
  notes: string | null;
  studentId: string | null;
  /** Composed by the server. Null when nobody has claimed it. */
  studentName: string | null;
  /** When the student was told. Outlives the item being returned. */
  studentNotifiedAt: string | null;
  status: 'found' | 'returned';
  returnedAt: string | null;
}

export interface LostAndFound {
  items: LostAndFoundItem[];
  /** The register, complete — a picker with a window cannot find everybody. */
  students: { id: string; name: string }[];
  canManage: boolean;
  canArchive: boolean;
}

/** The whole filtered list, for the export route. No window. */
export interface InventoryExport {
  facilityId: string | null;
  items: InventoryItem[];
}

export interface Photo {
  id: string;
  /** Object key in the bucket. */
  storageKey: string;
  /** The stored file, read at `/files/:id` — 12 October 2026. */
  fileId: string | null;
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
  /**
   * How old a tank's latest water analysis may be, in hours, before the
   * dashboard calls it due. Null is not measured and flags nothing.
   */
  waterAnalysisMaxAgeHours: number | null;
  /** Recintos — POOLSE-122. A pool is one (sport `pool`); courts and pitches the others. */
  playingAreas: PlayingArea[];
}

export interface PlayingArea {
  id: string;
  sportId: string;
  name: string;
  position: number;
  /** The pool this recinto is, for sport `pool`; null for any other sport. */
  poolId: string | null;
}

/**
 * Espaços — the non-pool parts of a site, round 6.
 *
 * `overdue` arrives computed. It is derived in SQL from the last cleaning and
 * the interval, and the client renders the boolean rather than re-deriving it:
 * two implementations of one rule agree until the day they do not, and this rule
 * is the entire point of the feature.
 */
export type SpaceType =
  | 'changing_room'
  | 'technical'
  | 'storage'
  | 'reception'
  | 'outdoor'
  | 'other';

export type IssueType = 'fault' | 'restock';

export interface Space {
  id: string;
  facilityId: string;
  name: string;
  type: SpaceType;
  description: string | null;
  /** False means out of service: still listed, still openable, never overdue. */
  active: boolean;
  /** Null means no schedule, and therefore never overdue. Never read as zero. */
  intervalHours: number | null;
  /** Null when it has never been cleaned — a state the row renders in words. */
  lastCleanedAt: string | null;
  overdue: boolean;
  openIssues: number;
}

export interface Cleaning {
  id: string;
  performedAt: string;
  performedBy: string | null;
  note: string | null;
}

/** How badly a request needs somebody — POOLSE-66 slice 2b. */
export type Severity = 'low' | 'normal' | 'high';

export interface Issue {
  id: string;
  type: IssueType;
  /** Chosen when it is reported; `normal` for everything older. */
  severity: Severity;
  description: string;
  reportedAt: string;
  reportedBy: string | null;
  status: 'open' | 'resolved';
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
}

/** What the caller may do, answered by the same helper the guards use. */
interface SpacePermissions {
  /** Owner/admin: add, edit and delete. */
  canManage: boolean;
  /** Any management login: log a cleaning, report an issue. */
  canLog: boolean;
  /** Owner/admin/maintenance: resolve. */
  canResolve: boolean;
}

export interface SpaceList extends SpacePermissions {
  facilityId: string;
  items: Space[];
}

export interface SpaceDetail extends SpacePermissions {
  facilityId: string;
  space: Space;
  cleanings: Paginated<Cleaning>;
  issues: Issue[];
}

/**
 * Planned maintenance — slice 4.3.
 *
 * `state` is derived on the server on every read, and the client renders it. It
 * is never recomputed here: there is no `next_due_at` column and no worker, and
 * two implementations of one rule agree until the day they do not.
 */
export type TaskState = 'paused' | 'due' | 'scheduled';

export interface MaintenanceTask {
  id: string;
  facilityId: string;
  facilityName: string;
  title: string;
  description: string | null;
  intervalDays: number;
  active: boolean;
  assignedTo: string | null;
  assignedToName: string | null;
  /** True when that person has left the staff list — the job now belongs to nobody. */
  assigneeArchived: boolean;
  spaceId: string | null;
  spaceName: string | null;
  poolId: string | null;
  poolName: string | null;
  inventoryItemId: string | null;
  inventoryItemName: string | null;
  lastDoneAt: string | null;
  lastDoneByName: string | null;
  /** Null when it has never been done, which is exactly when it is already due. */
  nextDueAt: string | null;
  state: TaskState;
  /** Whole days late. Zero unless due. */
  daysOverdue: number;
}

export interface TaskCompletion {
  id: string;
  performedAt: string;
  performedByName: string | null;
  note: string | null;
}

export interface TaskOption {
  id: string;
  name: string;
}

export interface TaskTarget extends TaskOption {
  kind: 'space' | 'pool' | 'item';
}

// ---------------------------------------------------------------------------
// Energy — slices 5.1 and 5.2
// ---------------------------------------------------------------------------

export type MeterKind = 'pump' | 'heating' | 'lighting' | 'total' | 'other';
/** What a meter measures — POOLSE-106. */
export type MeterCarrier = 'electricity' | 'gas' | 'water';
export const METER_CARRIERS: readonly MeterCarrier[] = ['electricity', 'gas', 'water'];
/** Whether a value is the dial (ever increasing) or a consumption in itself. */
export type MeterReads = 'cumulative_index' | 'interval_consumption';

export interface EnergyMeter {
  id: string;
  facilityId: string;
  facilityName: string;
  poolId: string | null;
  poolName: string | null;
  name: string;
  kind: MeterKind;
  carrier: MeterCarrier;
  unit: string;
  reads: MeterReads;
  initialIndex: number | null;
  replacedMeterId: string | null;
  replacedMeterName: string | null;
  /** Código do Ponto de Entrega, compact — how a bill finds its meter. 5.3. */
  cpe: string | null;
  serial: string | null;
  notes: string | null;
  /** Retired — swapped out or removed. Its page opens, its form is gone. */
  archived: boolean;
  latestAt: string | null;
  latestValue: number | null;
  readingCount: number;
}

export interface EnergyReading {
  takenAt: string;
  value: number;
  source: 'manual' | 'import' | 'feed';
  recordedByName: string | null;
  note: string | null;
  /** Used since the reading before, derived by the API. Null when nothing to measure from. */
  consumed: number | null;
  /**
   * What that consumption cost at the rate live that day — slice 5.3. Null
   * when the meter had no rate then, and rendered as a dash rather than a zero.
   * Always an estimate: see `CostProvenance`.
   */
  costCents: number | null;
  costProvenance: CostProvenance | null;
}

/**
 * How much weight a derived cost carries — docs/financials.md §2.
 *
 * Never `actual`: a euro that happened is a fatura. A cost from a rate the club
 * marked `assumed` is `assumed` too, and the screen says so beside the figure.
 */
export type CostProvenance = 'estimated' | 'assumed';

export interface MonthlyConsumption {
  /** `YYYY-MM`, in the site's timezone. */
  month: string;
  consumed: number | null;
  /** Null when any reading in the month went unpriced — never a partial bar. */
  costCents: number | null;
  /**
   * The same month a year earlier — slice 5.4. Null means nobody read the
   * meter then, which is drawn as nothing rather than as a fall to zero.
   */
  previousConsumed: number | null;
  previousCostCents: number | null;
  /**
   * Mean outside air temperature that month, and a year earlier — slice 5.4b.
   * Null when the site is not on the map or the archive is switched off, which
   * is the default. **Context, never a correction** to the figures beside it.
   */
  meanTempC: number | null;
  previousMeanTempC: number | null;
}

/**
 * This window against the same window a year earlier — slice 5.4.
 *
 * Computed over the months that have **both** years, so a club with eighteen
 * months of readings is not told it halved its consumption. Cost and
 * consumption stay separate: a flat year of kWh with a bill forty per cent
 * higher is a tariff change, not a pool.
 */
export interface YearOnYear {
  comparableMonths: number;
  consumed: number | null;
  previousConsumed: number | null;
  costCents: number | null;
  previousCostCents: number | null;
  /** Both null unless every comparable month has a temperature in both years. */
  meanTempC: number | null;
  previousMeanTempC: number | null;
}

/** The twelve months and how much of them the rates reached — slice 5.3. */
export interface ConsumptionSeries {
  months: MonthlyConsumption[];
  monthsWithConsumption: number;
  monthsPriced: number;
  costCents: number | null;
  costProvenance: CostProvenance | null;
  yearOnYear: YearOnYear;
}

/** Never `actual` — the schema refuses it, and so does the API. */
export type TariffProvenance = 'contracted' | 'estimated' | 'assumed';

/**
 * What a tank costs per hour taught in it — POOLSE-28, at the month grain.
 *
 * Every figure is a month divided by a month: a club types one meter reading a
 * month, so there is no data from which a single Tuesday 07:00 class could be
 * costed, and the panel says so rather than implying a precision it lacks.
 */
export interface CostMonth {
  month: string;
  kwh: number | null;
  costCents: number | null;
  taughtMinutes: number;
  bathers: number;
  /** Consumption with nothing taught to charge it to — August, a closure. */
  unallocated: boolean;
}

/** A meter the report added up, named so a derived figure can be checked. */
export interface CostSource {
  id: string;
  name: string;
  fullyPriced: boolean;
}

/** One turma's share of its tank's heat — POOLSE-28 AC 6. */
export interface GroupShare {
  /** Null for a parceria: no turma, and its hours still count. */
  groupId: string | null;
  name: string | null;
  taughtMinutes: number;
  bathers: number;
  shareCents: number | null;
}

/** What a turma's page asks: what did my hours in that water cost? */
export interface GroupCost {
  share: GroupShare | null;
  poolName: string | null;
  /** The tank's rate — every hour in it is charged the same. */
  costPerHourCents: number | null;
}

export interface PoolCostReport {
  poolId: string;
  poolName: string;
  months: CostMonth[];
  /** Null is "not measured": the screen says which figure is missing and why. */
  cubicMetres: number | null;
  /** Empty means nothing meters this tank — the report says that, not zero. */
  sources: CostSource[];
  costCents: number | null;
  kwh: number | null;
  taughtMinutes: number;
  /** Taught minutes in the priced months — what cost per hour divides by (13-10-2026 sweep). */
  allocatableMinutes: number;
  bathers: number;
  unallocatedCents: number | null;
  monthsWithConsumption: number;
  monthsPriced: number;
  byGroup: GroupShare[];
}

/** What one unit off a meter costs, effective-dated — slice 5.3. */
export interface Tariff {
  id: string;
  /** EUR per unit, gross. Not cents: EUR 0.1548/kWh is the point of the column. */
  unitPrice: number;
  unitPriceLow: number | null;
  unitPriceHigh: number | null;
  provenance: TariffProvenance;
  /** `YYYY-MM-DD`. */
  effectiveFrom: string;
  /** The last day at this rate, inclusive. Null while it is the live one. */
  effectiveTo: string | null;
  live: boolean;
  note: string | null;
  createdByName: string | null;
}

// Faturas — slice 5.3. Shapes mirror `invoices.repository.ts`.

export interface EnergyInvoiceRegister {
  register: 'vazio' | 'ponta' | 'cheias' | 'super_vazio' | 'total';
  previousIndex: number | null;
  currentIndex: number | null;
  kwh: number;
}

export interface EnergyInvoiceLine {
  kind: 'energy' | 'power' | 'discount' | 'tax' | 'other';
  description: string;
  period: 'simples' | 'ponta' | 'cheias' | 'vazio_normal' | 'super_vazio' | 'fora_vazio' | 'vazio' | null;
  fromOn: string | null;
  toOn: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  amountCents: number;
  discountCents: number;
  totalCents: number;
  vatRate: number | null;
}

export interface EnergyInvoiceSummary {
  id: string;
  supplier: string;
  invoiceNumber: string;
  issuedOn: string;
  periodStart: string;
  periodEnd: string;
  days: number;
  /** Billed energy, summed from the lines by the API. */
  kwh: number;
  subtotalCents: number;
  totalCents: number;
  documentTotalCents: number;
  source: 'manual' | 'import' | 'feed';
}

export interface EnergyInvoiceDetail extends EnergyInvoiceSummary {
  meterId: string;
  meterName: string;
  facilityId: string;
  atcud: string | null;
  documentReference: string | null;
  dueOn: string | null;
  contractedPowerKva: number | null;
  tariff: string | null;
  cycle: string | null;
  readingQuality: 'real' | 'estimated' | null;
  vatCents: number;
  otherChargesCents: number;
  networkAccessCents: number | null;
  regulatedDifferenceCents: number | null;
  notes: string | null;
  sourceFileName: string | null;
  recordedByName: string | null;
  registers: EnergyInvoiceRegister[];
  lines: EnergyInvoiceLine[];
}

export interface EnergyInvoiceList {
  invoices: EnergyInvoiceSummary[];
  canRecord: boolean;
}

/** One month of bills across the club, by the month the billing period ends in. */
export interface MonthlyCost {
  month: string;
  totalCents: number | null;
  kwh: number | null;
  bills: number;
}

/** One carrier's bills in one month — POOLSE-106. `cents` is null when none, or withheld. */
export interface CarrierMonth {
  cents: number | null;
  quantity: number | null;
  bills: number;
}

/** A total, and the same months a year earlier — only months billed in both years. */
export interface ComparedTotal {
  cents: number | null;
  quantity: number | null;
  previousCents: number | null;
  currentComparedCents: number | null;
  comparedMonths: number;
}

/** `GET /energy/summary` — the Energia page's dashboard. */
export interface EnergySummary {
  canSeeMoney: boolean;
  months: { month: string; carriers: Record<MeterCarrier, CarrierMonth> }[];
  metered: Record<MeterCarrier, number>;
  thisMonth: { month: string; carriers: Record<MeterCarrier, ComparedTotal> };
  lastTwelve: Record<MeterCarrier, ComparedTotal>;
  lastBilledMonth: string | null;
  perUse: {
    allocatedCents: number;
    lessonHours: number;
    bathers: number;
    perLessonHourCents: number | null;
    perBatherCents: number | null;
    poolsCounted: number;
    pools: number;
  } | null;
  missing: {
    meterId: string;
    meterName: string;
    facilityName: string;
    carrier: MeterCarrier;
    lastPeriodEnd: string | null;
  }[];
}

export interface EnergyCosts {
  months: MonthlyCost[];
  latest: (EnergyInvoiceSummary & { meterName: string; facilityName: string }) | null;
  billCount: number;
}

/** What a preview says — field refusals, warnings with figures, and the headline kWh. */
export interface EnergyInvoiceCheck {
  fields: Record<string, string>;
  warnings: { key: string; values: Record<string, string | number> }[];
  billedKwh: number;
  registerKwh: number;
  willSetCpe: boolean;
  willSetSerial: boolean;
}

export interface MeterList {
  meters: EnergyMeter[];
  pools: { id: string; name: string }[];
  canPlan: boolean;
  canRecord: boolean;
}

export interface MeterDetail {
  meter: EnergyMeter;
  readings: EnergyReading[];
  monthly: ConsumptionSeries;
  pools: { id: string; name: string }[];
  tariffs: Tariff[];
  canPlan: boolean;
  canRecord: boolean;
  /** Setting a rate is owner and admin; reading the cost is the whole module. */
  canPrice: boolean;
}

export interface TaskList {
  tasks: MaintenanceTask[];
  /** So the screen hides forms the API would refuse — never the control itself. */
  canPlan: boolean;
  canComplete: boolean;
  /**
   * The pickers, whole and shipped with the list.
   *
   * Empty for somebody who may not plan, and empty on the dashboard's "mine"
   * endpoint, which has no form on it. A picker assembled from a paginated list
   * would offer only page 1 — the trap POOLSE-29 names.
   */
  assignees?: TaskOption[];
  targets?: TaskTarget[];
}

export interface TaskDetail {
  task: MaintenanceTask;
  canPlan: boolean;
  canComplete: boolean;
  /** Whole, and empty for somebody who may not plan. */
  assignees?: TaskOption[];
}

/** A possible stand-in for one lesson, and why they might not be one. */
export interface StandInCandidate {
  membershipId: string;
  name: string | null;
  /** Null when free; otherwise the approved leave they are on that day. */
  awayReason: LeaveKind | null;
  /** Already teaching something else at that hour. */
  busy: boolean;
}

export interface StandInOptions {
  currentId: string | null;
  candidates: StandInCandidate[];
}

export type VacationStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

/** Holiday, sick leave or personal leave — round 6. */
export type LeaveKind = 'vacation' | 'medical' | 'personal';

export interface VacationRequest {
  id: string;
  membershipId: string;
  personName: string | null;
  /** Only `vacation` counts against the year's entitlement. */
  kind: LeaveKind;
  /** What the person wrote. Never a diagnosis. */
  reason: string | null;
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

/**
 * One out-of-range water alert — slice 4.2.
 *
 * `recipients` is a count and not a list of addresses: the readings panel is
 * readable by any member, and "did this reach anybody" is the question somebody
 * actually has. `deliveredAt` null means recorded and not sent, which the panel
 * says in words rather than leaving to be assumed.
 */
export interface PoolAlert {
  id: string;
  raisedAt: string;
  takenAt: string;
  metrics: PoolMetric[];
  recipients: number;
  deliveredAt: string | null;
}

export interface PoolDetail extends Pool {
  /** Every analysis of this pool, oldest first. */
  analyses: PoolAnalysis[];
  /** Out-of-range alerts, newest first, capped at ten — slice 4.2. */
  alerts: PoolAlert[];
  /**
   * The band each metric is judged by on this pool, resolved by the API.
   *
   * A metric absent from the map is not judged — nothing published a band, or
   * this club switched it off. Never merged on the client: the screen renders
   * what it is given, the way it renders the overdue-cleaning boolean.
   */
  bands: BandMap;
  /** The national reference for this tank before any override — POOLSE-72. */
  reference: BandMap;
  /** The raw overrides, which only the editor needs — see `SafeRangesForm`. */
  bandOverrides: BandOverride[];
  /** Whether an alert would actually be sent from this environment. */
  emailConfigured: boolean;
  /**
   * Whether this club has water quality on — POOLSE-87. Off, the API sends no
   * analyses, alerts or overrides and the page drops the Leituras tab.
   */
  waterQuality: boolean;
  organizationId: string;
  facilityId: string;
  facilityName: string;
  photos: Photo[];
}

export interface Facilities {
  organizationId: string;
  facilities: Facility[];
  canManage: boolean;
  /** The site's own page answers this reader: owner, admin, maintenance. */
  canOpenSite: boolean;
  /** A tank's page answers this reader: staff, never a family. */
  canOpenPools: boolean;
  timezones: string[];
  /** The licence's site ceiling (`organization.max_facilities`); null limits nothing. */
  maxFacilities: number | null;
}

export interface StudentLevel {
  id: string;
  name: string;
  sortOrder: number;
  /** The level's own colour. Backfilled from position, so never null in practice. */
  colour: ClassColour | null;
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
  /** Its swimmers compete — POOLSE-81. */
  competitive: boolean;
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

/** POOLSE-131 — the student's address and identity, all optional. */
export interface StudentIdentity {
  addressLine: string | null;
  locality: string | null;
  postalCode: string | null;
  parentOneName: string | null;
  parentTwoName: string | null;
  maritalStatus: 'single' | 'married' | 'civil_union' | 'divorced' | 'widowed' | null;
  profession: string | null;
  education: string | null;
  birthplace: string | null;
  nationality: string | null;
  snsNumber: string | null;
  /** Whether a number is on file, for a reader who may not see it. */
  snsRecorded?: boolean;
}

export interface Student {
  /** When this student left and when their data goes — 7b.8. Null while enrolled. */
  retention?: {
    leftOn: string;
    healthErasesOn: string;
    identityErasesOn: string;
    healthErasedAt: string | null;
  } | null;
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
  /** The FPN licence — POOLSE-81. */
  federationLicence: string | null;
  /** Address and identity — POOLSE-131. `snsNumber` only reaches owner and admin. */
  identity?: StudentIdentity;
  /** In a competitive level with no licence: a warning, never a gate. */
  licenceMissing: boolean;
  notes: string | null;
  /** Where they stand on paying, for the register's column. Decided by the API. */
  paymentState: 'none' | 'paid' | 'due' | 'overdue';
  /** POOLSE-42 — membership is a fact about the person, not a derived one. */
  isSocio: boolean;
  /**
   * The two capacities one person can be in at once — POOLSE-23 AC6.
   *
   * A grandmother who swims on Tuesdays and brings her granddaughter on
   * Thursdays is one record with two things true about her, not two records.
   * `isGuardian` is an *outbound* edge — she is somebody's encarregada — which
   * is the half that is easy to get wrong: asking "does this person have any
   * guardian edges at all" would take her off the adult path for edges that
   * point away from her.
   */
  isAdultStudent: boolean;
  isGuardian: boolean;
  socioNumber: string | null;
  /** Sócio desde, `YYYY-MM-DD` — POOLSE-134. Carried by the export only. */
  socioSince?: string | null;
  /** Null unless a live `photo` consent exists — the API decides, not the caller. */
  photoFileId: string | null;
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
  /** Read by the child's own family: the family's tabs, read-only. */
  familyView?: boolean;
  /** The seguro warning, for staff (POOLSE-88). Null for a family; absent on the list. */
  cover?: StudentCover | null;
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
  /** POOLSE-129: whether *Convidar famílias* is offered. */
  canInviteFamilies: boolean;
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
  | 'ancientDate'
  /** POOLSE-131: a value the identity column cannot hold. */
  | 'badPostalCode'
  | 'badSnsNumber'
  | 'badNationality'
  | 'badMaritalStatus'
  /** POOLSE-134: the sócio number belongs to another student. */
  | 'socioNumberTaken';

/** What is said out loud and imported anyway. */
export type ImportWarningCode =
  | 'noGuardian'
  | 'guardianNotRecorded'
  | 'levelWillBeCreated'
  | 'taxNumberBelongsToAnother';

/** A blank on an existing student that this row would fill in. */
export interface ImportUpdate {
  field:
    | 'birthDate'
    | 'levelId'
    | 'contactEmail'
    | 'contactPhone'
    | 'taxNumber'
    | 'notes'
    | 'federationLicence'
    | 'isSocio'
    | 'socioNumber'
    | 'socioSince'
    | Exclude<keyof StudentIdentity, 'snsRecorded'>;
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
  /** Free text, where it belongs. Suggested from what the site already uses. */
  location: string | null;
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

/**
 * What a price is for — four kinds on one list, never a table each.
 *
 * Invoicing will carry the kind on every line it writes, which is why the kinds
 * exist before invoicing does: adding one afterwards means rewriting lines that
 * have already been sent.
 */
export type FeeKind = 'mensalidade' | 'inscricao' | 'seguro' | 'quota';

/**
 * How often a price is charged.
 *
 * An attribute of the plan rather than of its kind — a club is free to make its
 * quota annual or monthly. Only `periodicity` may name a fee period.
 */
export type FeeRecurrence = 'periodicity' | 'annual' | 'one_off';

export interface FeePlan {
  id: string;
  kind: FeeKind;
  recurrence: FeeRecurrence;
  /**
   * The IVA already inside `amountCents`, and whether the price is isento.
   *
   * Gross always: the rate says what the amount contains, never what to add to
   * it. Isento is its own flag because an exemption and a zero rate are two
   * different statements on a Portuguese invoice.
   */
  vatRate: number;
  vatExempt: boolean;
  /** The season an inscrição or a seguro belongs to. Null on the other two. */
  seasonId: string | null;
  seasonName: string | null;
  /** The cheaper renovação price, for a family that paid in an earlier season. */
  isRenewal: boolean;
  /** A mensalidade has both; every other kind has neither. There is no name. */
  levelId: string | null;
  levelName: string | null;
  lessonsPerWeek: number | null;
  amountCents: number;
  defaultFeePeriodId: string | null;
  /** Quotas only. A mensalidade is banded by its level, which says it better. */
  ageBand: FeeAgeBand;
  /**
   * The plan's periodicity and what it charges with that discount off — 3.0.
   *
   * All three null when the plan names no default period, and the list then
   * shows the monthly amount alone rather than inventing a periodicity. The
   * total comes from SQL's `fee_total_cents`; nothing here recomputes it.
   */
  periodMonths: number | null;
  periodDiscountPercent: number | null;
  periodTotalCents: number | null;
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
  kind: FeeKind;
  enrollmentId: string | null;
  classGroupName: string | null;
  /**
   * The periodicity this line is charged on — **null when it is charged once**.
   *
   * An inscrição is paid once for a season and a seguro is bought once for the
   * season it covers, so neither names a frequency. `amountCents` is then the
   * whole amount rather than a monthly one, and the line has one occurrence.
   */
  periodId: string | null;
  periodName: string | null;
  months: number;
  /** The season an inscrição or a seguro belongs to. Null on the other two. */
  seasonId: string | null;
  seasonName: string | null;
  /**
   * The cover a seguro line buys, and the apólice behind it.
   *
   * The line's own snapshot, not the policy's: correcting a typo in the policy
   * dates must not silently rewrite what a family was told they had.
   */
  insurancePolicyId: string | null;
  insurerName: string | null;
  coversFrom: string | null;
  coversTo: string | null;
  /** The agreed amount per month — the snapshot, never the plan's price today. */
  amountCents: number;
  discountPercent: number;
  lineDiscountPercent: number | null;
  lineDiscountCents: number | null;
  discountReason: string | null;
  /**
   * Who authored the discount above — a category, or a person.
   *
   * Set means the figure came from that concession when the line was agreed, and
   * the name is what the screen says instead of a typed reason. Null with a
   * discount present means somebody typed it and `discountReason` says why. The
   * two are never both true.
   */
  feeCategoryId: string | null;
  feeCategoryName: string | null;
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
  /** Every period this line has been settled for, newest first — 10.0. */
  paidPeriods: string[];
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

/**
 * Whether this student is insured today, and by what.
 *
 * A warning and never a gate: a student with no cover is enrolled, taught and
 * marked present exactly as before. `lapsed` separates "their cover ran out"
 * from "nobody ever insured them", which are two different things to do.
 */
export interface StudentCover {
  covered: boolean;
  coversFrom: string | null;
  coversTo: string | null;
  insurerName: string | null;
  lapsed: boolean;
}

/**
 * A season charge this student could be given, and what it needs to be given.
 *
 * Everything the form needs travels with it — the season, whether this student
 * has already been charged it, and the apólices a seguro may be bought under —
 * so the student's page makes no second request and holds no rule of its own.
 *
 * `suggested` is the renovação answer for this student, decided on the server.
 * A default and not a decision: both rows come back and either can be charged.
 */
export interface SeasonCharge {
  planId: string;
  kind: 'inscricao' | 'seguro';
  isRenewal: boolean;
  suggested: boolean;
  facilityId: string;
  facilityName: string;
  seasonId: string;
  seasonName: string;
  amountCents: number;
  /** Already charged for this season. One per student per season, by index. */
  hasLine: boolean;
  /** The apólices this site holds. Empty on an inscrição, which needs none. */
  policies: {
    id: string;
    insurer: string;
    policyNumber: string;
    validFrom: string;
    validTo: string;
  }[];
}

export interface FeeBalance {
  totalCents: number;
  paidCents: number;
  outstandingCents: number;
  overdueCount: number;
  nextDueOn: string | null;
}

export interface StudentFees {
  /** Read by the child's own family; offers and the office's reasons are empty. */
  familyView?: boolean;
  /** POOLSE-94: where the family pays. Only on the family's read; null when the club says nowhere. */
  payTo?: PayTo | null;
  /** What their turmas come to, before anything is charged. */
  currentPlans: CurrentPlan[];
  /** The joining fee and the insurance fee, offered per season. */
  seasonCharges: SeasonCharge[];
  lines: StudentFeeLine[];
  cover: StudentCover;
  /**
   * Which joining price to offer this student, and whether they are returning.
   *
   * A suggestion, not the price: the form pre-selects it and an admin may pick
   * the other. Decided on the server because "has paid before" is a question
   * about rows the browser cannot see.
   */
  inscricao: { suggestedPlanId: string | null; returning: boolean };
  socio: { isSocio: boolean; socioNumber: string | null; socioSince: string | null };
  /**
   * One penalty per kind of charge — a club may fine a late mensalidade and not
   * a late quota. Shown and added to what is owed; never written as a charge.
   */
  penalties: { mensalidadeCents: number; quotaCents: number };
  penaltyCents: number;
  /** Computed by the API (`fee-balance.ts`) — every screen reads this, none adds it up. */
  balance: FeeBalance;
  /**
   * The club's concessions, and the one this student's turmas imply.
   *
   * `suggestedCategoryId` is a default and not a decision: null the moment two
   * of their live enrolments resolve to different categories, because a student
   * in a senior turma and a staff turma is somebody a person has to choose for.
   */
  categories: { id: string; name: string; discountPercent: number | null; discountCents: number | null }[];
  suggestedCategoryId: string | null;
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
  /**
   * Mobility and physical limitations — POOLSE-23.
   *
   * Beside the medical notes because they are the same class of fact: something
   * about a person's body that whoever is at the poolside needs to know before
   * that person is in the water. Same encryption, same audited read, same
   * permission — owner, admin and any instructor.
   */
  mobilityNotes: string | null;
  recordedAt: string | null;
  recordedByName: string | null;
}

/**
 * Which path a student is on, and therefore which consent applies.
 *
 * Computed on the server, never in the browser. An adult is at or above the
 * club's own age of majority with no live guardian link — the absence of the
 * edge is the definition, and there is deliberately no `isAdult` column, so a
 * corrected birth date moves somebody between paths with nothing to migrate.
 */
export interface EnrolmentContext {
  adultPath: boolean;
  ageYears: number | null;
  ageOfMajority: number;
  hasGuardian: boolean;
  consentForm: 'self' | 'guardian';
}

/**
 * Who to call — and what this deliberately is not.
 *
 * Naming somebody grants them nothing: no role, no login, no access to this
 * student's record, no place in any guardian list. A person link or free text,
 * never both.
 */
export interface EmergencyContact {
  membershipId: string | null;
  name: string | null;
  phone: string | null;
  relationship: string | null;
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
   * Where the atestado is filed — a document number or a location. Still
   * offered beside the file itself (POOLSE-109), for paper kept at the desk.
   */
  justificationReference: string | null;
  recordedByName: string | null;
  active: boolean;
  /**
   * The atestado — POOLSE-109. `file` is null for a coach: told it is attached
   * and when, never the document or its name.
   */
  certificate: { attachedAt: string; file: MedicalCertificateFile | null } | null;
  /** Earlier atestados, newest first — owner and admin only. */
  previousCertificates: (MedicalCertificateFile & { replacedAt: string; replacedBy: string })[];
}

/** An atestado file, sealed at rest and read through `/files/:id` — POOLSE-109. */
export interface MedicalCertificateFile {
  fileId: string;
  originalName: string;
  contentType: string;
  attachedAt: string;
  attachedBy: string;
}

/** A leave as a family reads it in app mode: the dates and its atestado — POOLSE-109. */
export interface FamilyLeave {
  id: string;
  studentId: string;
  startsOn: string;
  endsOn: string | null;
  active: boolean;
  certificate: MedicalCertificateFile | null;
}

export interface SensitiveRecord {
  organizationId: string;
  notes: SensitiveNotes;
  consent: ConsentRecord[];
  kinds: ConsentKind[];
  canManage: boolean;
  /** Every live leave for this student, newest first. */
  medicalLeave: MedicalLeave[];
  /** Which path this student is on — the one answer the screen branches on. */
  enrolment: EnrolmentContext | null;
  emergencyContact: EmergencyContact | null;
}

export type Stroke = 'freestyle' | 'backstroke' | 'breaststroke' | 'butterfly' | 'medley';

/** 25 m (`scm`) or 50 m (`lcm`) — POOLSE-81. Null is "piscina não indicada". */
export type Course = 'scm' | 'lcm';

export interface SwimRecord {
  id: string;
  stroke: Stroke;
  distanceM: number;
  course: Course | null;
  /** Integer milliseconds. Format with formatTime from components/progress-chart. */
  timeMs: number;
  swumOn: string;
  note: string | null;
  recordedByName: string | null;
  meetId: string | null;
  meetName: string | null;
  /** Swum at an official meet. */
  official: boolean;
  /** Best over this stroke, distance and course. */
  isPersonalBest: boolean;
}

export interface PersonalBest {
  stroke: Stroke;
  distanceM: number;
  course: Course | null;
  timeMs: number;
  swumOn: string;
  official: boolean;
  /** The best at an official meet, where that is a different swim. */
  officialBest: { timeMs: number; swumOn: string; meetName: string } | null;
}

/** A meet in Provas — POOLSE-81 slice 2. */
export interface MeetSummary {
  id: string;
  name: string;
  city: string | null;
  course: Course | null;
  startsOn: string;
  endsOn: string;
  official: boolean;
  /** Came from a results file (else named by hand on the time form). */
  imported: boolean;
  resultCount: number;
}

export interface MeetList extends Paginated<MeetSummary> {
  organizationId: string;
  canImport: boolean;
  canArchive: boolean;
  rememberedClubCode: string | null;
}

/** A LENEX file that arrived by email — POOLSE-114. */
export interface MeetInboxItem {
  id: string;
  fileName: string;
  meetName: string;
  meetStartsOn: string;
  status: 'pending' | 'imported';
  meetId: string | null;
  senderName: string;
  receivedAt: string;
  /** Pending past 90 days: the quiet *antigo* tag. */
  stale: boolean;
}

export interface MeetInboxList extends Paginated<MeetInboxItem> {
  /** The club's results address, or null where this deployment receives no mail. */
  address: string | null;
  pendingCount: number;
  /** Owner and admin: *Rejeitar* and a new address. */
  canManage: boolean;
  /** Mail can arrive here: a domain and a bucket are configured. */
  receiving: boolean;
}

export interface MeetResult {
  recordId: string;
  studentId: string;
  studentName: string;
  stroke: Stroke;
  distanceM: number;
  course: Course | null;
  round: string | null;
  eventNumber: number | null;
  timeMs: number;
  swumOn: string;
  isPersonalBest: boolean;
  licenceMissing: boolean;
  /** Live standards whose entry time this swim met, by name (POOLSE-115). */
  qualifies: string[];
  /** FPN age groups admitting the swimmer in the meet's season; empty when none are set. */
  ageGroups: string[];
}

export interface MeetDetail extends MeetSummary {
  sourceFileName: string | null;
  importedAt: string | null;
  results: MeetResult[];
  unmatched: { name: string; results: number }[];
  canArchive: boolean;
  organizationId: string;
}

export type MeetSkipReason =
  | 'relay' | 'dsq' | 'dns' | 'dnf' | 'wdr' | 'otherStatus' | 'noTime' | 'yards' | 'stroke';

export interface MeetPreviewResult {
  eventNumber: number;
  round: string;
  stroke: Stroke;
  distanceM: number;
  course: Course | null;
  swumOn: string;
  timeMs: number;
  action: 'new' | 'update' | 'unchanged';
  previousMs: number | null;
  newBest: boolean;
}

export interface MeetPreviewAthlete {
  key: string;
  name: string;
  birthDate: string | null;
  licence: string | null;
  match: 'licence' | 'proposed' | 'none';
  studentId: string | null;
  studentName: string | null;
  canWriteLicence: boolean;
  results: MeetPreviewResult[];
}

export interface MeetImportPreview {
  meet: { name: string; startsOn: string; existingMeetId: string | null };
  rememberedClubCode: string | null;
  athletes: MeetPreviewAthlete[];
  skipped: Record<MeetSkipReason, number>;
  totals: { new: number; update: number; unchanged: number; unmatched: number; newBests: number };
  meetId?: string;
}

export interface MeetChoice {
  id: string;
  name: string;
  startsOn: string;
  official: boolean;
}

/* POOLSE-85 — gap to qualify. */

export type AgeGroupGender = 'male' | 'female';

export interface FederationAgeGroup {
  id: string;
  name: string;
  /** Null admits both. */
  gender: AgeGroupGender | null;
  bornFrom: number | null;
  bornTo: number | null;
}

export interface QualifyingStandardSummary {
  id: string;
  name: string;
  windowFrom: string | null;
  windowTo: string | null;
  timeCount: number;
}

export interface QualifyingOverview {
  organizationId: string;
  seasons: { id: string; name: string; status: 'draft' | 'published' | 'archived' }[];
  seasonId: string | null;
  ageGroups: FederationAgeGroup[];
  standards: QualifyingStandardSummary[];
  canEdit: boolean;
  canArchive: boolean;
}

export interface EntryTime {
  ageGroupId: string;
  stroke: Stroke;
  distanceM: number;
  course: Course;
  timeMs: number;
}

export interface QualifyingStandard extends QualifyingStandardSummary {
  organizationId: string;
  seasonId: string;
  seasonName: string;
  seasonStartsOn: string;
  seasonEndsOn: string;
  ageGroups: FederationAgeGroup[];
  times: EntryTime[];
  canEdit: boolean;
  canArchive: boolean;
}

/** One event against an entry time. `gapMs` ≤ 0 is qualified; null is no valid time. */
export interface GapRow {
  ageGroupId: string;
  ageGroup: string;
  stroke: Stroke;
  distanceM: number;
  course: Course;
  entryMs: number;
  bestMs: number | null;
  bestSwumOn: string | null;
  bestMeet: string | null;
  gapMs: number | null;
}

/** One cell of an imported entry-times table, as the API judged it — POOLSE-85 slice 2. */
export interface QualifyingImportCell {
  row: number;
  ageGroupId: string;
  ageGroup: string | null;
  eventLabel: string;
  stroke: Stroke | null;
  distanceM: number | null;
  time: string;
  timeMs: number | null;
  previousMs: number | null;
  status: 'new' | 'changed' | 'unchanged' | 'refused';
  reason: 'event' | 'time' | 'ageGroup' | 'duplicate' | null;
}

export interface QualifyingImportResult {
  cells: QualifyingImportCell[];
  summary: Record<QualifyingImportCell['status'], number>;
  committed: boolean;
}

export interface StudentQualifying {
  seasonName: string;
  ageGroups: string[];
  noBand: 'birthDate' | 'gender' | 'none' | null;
  standards: { id: string; name: string; rows: GapRow[] }[];
}

export interface QualifyingBoard {
  organizationId: string;
  standard: { id: string; name: string; seasonName: string };
  marginMs: number;
  swimmers: {
    studentId: string;
    name: string;
    ageGroupId: string;
    ageGroup: string;
    competitive: boolean;
    qualified: GapRow[];
    close: GapRow[];
    further: number;
    noTime: number;
  }[];
  unplaced: { studentId: string; name: string; reason: 'birthDate' | 'none' }[];
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
  courses: Course[];
  /** The turma's pool length, as the time form's default. */
  defaultCourse: Course | null;
  /** Every live meet, for the time form's picker. */
  meets: MeetChoice[];
  /** The gap to the published season's standards — POOLSE-85. Null: none to show. */
  qualifying: StudentQualifying | null;
  canRecord: boolean;
  /** Withdrawing a time is owner/admin since round 5's G1 — separate from recording one. */
  canArchive: boolean;
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
  /**
   * This person's own fee category, against their turma's — POOLSE-23 AC4.
   *
   * Null means "whatever the turma says", which is the ordinary state and the
   * one an override is cleared back to. `feeCategoryName` is what actually
   * applies — their own where they have one, the turma's otherwise — so a
   * roster can print the effective answer without knowing the precedence.
   */
  feeCategoryId: string | null;
  feeCategoryName: string | null;
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

/** The eight tints a turma may wear — round 6. A token, never a hex. */
export type ClassColour =
  | 'teal'
  | 'green'
  | 'lime'
  | 'amber'
  | 'orange'
  | 'rose'
  | 'magenta'
  | 'violet';

export interface ClassGroup {
  id: string;
  name: string;
  /** Null means nobody chose; the calendar falls back to the level's tint. */
  colour: ClassColour | null;
  /**
   * The fee category everybody in this turma is on unless their enrolment says
   * otherwise — POOLSE-23 AC4.
   *
   * The name travels with the id so a list prints it without a second request,
   * and because renaming the category reaches every turma at once — it is
   * resolved, never copied.
   */
  feeCategoryId: string | null;
  feeCategoryName: string | null;
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

/**
 * A fee category — POOLSE-23 AC4, valued in round 19.
 *
 * The reason one person pays a different price from the person in the next lane:
 * Sénior, Estudante, Funcionário. A club invents its own.
 *
 * **It carries what it is worth**, which reverses the "a label, never a price"
 * this comment used to hold. Nothing consulted the label, so the concession was
 * typed into a fee line's free-text reason once per family. The value applies
 * when a line is agreed and is snapshotted onto it — correcting a category never
 * re-prices anybody.
 *
 * The two counts are what make archiving a decision rather than a click — and
 * they are the pair the refusal comes back with if somebody archives one that is
 * still in use. Fee lines are not among them: a line holds the figure rather
 * than a live reference.
 */
export interface FeeCategory {
  id: string;
  name: string;
  sortOrder: number;
  /**
   * What it takes off — one or the other, and often neither.
   *
   * Both null means the category carries no value: a label, which is still a
   * legitimate thing to want. It is **not** zero, and nothing may print 0 % for
   * it. Both null also for a reader the endpoint will not show amounts to,
   * which is why `canSeeValues` travels beside the list rather than leaving a
   * blank to be read as "no discount".
   */
  discountPercent: number | null;
  discountCents: number | null;
  usedByGroups: number;
  usedByEnrollments: number;
  /**
   * What the concession costs, and over how much of its reach.
   *
   * `students` is everybody it reaches — a live enrolment resolving to it, or a
   * live fee line carrying it. `chargedStudents` is how many of those are being
   * billed under it. Both are printed, because a total over part of a list is
   * only honest when it says which part (`docs/financials.md` §6).
   *
   * `forgoneMonthlyCents` is null when nothing is charged under it at all —
   * "not set", which renders as a dash and never as 0,00 €. Zero is a different
   * answer: lines exist and the category takes nothing off them, which is what a
   * label does. Also null for a reader who may not see amounts.
   */
  students: number;
  chargedStudents: number;
  forgoneMonthlyCents: number | null;
}

export interface ClassOptions {
  /** With their age bounds — the enrol picker filters on the turma's level. */
  levels: {
    id: string;
    name: string;
    /** The level's own colour, for the grid and the classes list — round 6. */
    colour: ClassColour | null;
    minAgeMonths: number | null;
    maxAgeMonths: number | null;
  }[];
  pools: { id: string; name: string }[];
  instructors: { id: string; name: string }[];
  /** With birth dates, so the picker can work out who fits. */
  students: { id: string; name: string; birthDate: string | null }[];
  /**
   * The club's fee categories — POOLSE-23 AC4.
   *
   * **Names only, deliberately.** This payload is the turmas list, which any
   * member may read — an instructor needs to know what is in their lane on
   * Tuesday — so putting a concession's value in it would hand an instructor the
   * amounts the price list refuses them. What a category is worth comes from
   * `/fee-categories`, with `canSeeValues` beside it.
   *
   * Writing a turma's category is owner and admin like every other field on it,
   * so nobody can move a club's pricing from here; and the figure is shown where
   * it is decided, on the fee form, rather than in a picker that is choosing a
   * label for forty people at once. The turma's category is the default for
   * everybody in it, and an enrolment may override it.
   */
  feeCategories: { id: string; name: string }[];
}

export interface Classes {
  organizationId: string;
  /** Not paginated — POOLSE-29: a week grid is a calendar, bounded by the week. */
  groups: ClassGroup[];
  canManage: boolean;
  /**
   * Which turmas the list is showing — slice 1.12.
   *
   * An instructor who is only an instructor opens on their own; anybody who can
   * see the club opens on the club. Both may ask for the other.
   */
  scope: 'mine' | 'all';
  /**
   * Whether this person has two real views and should be offered the switch.
   *
   * True for the owner who also teaches, which is the case the slice names. An
   * instructor holding no office role has one view and does not need a control
   * that says so.
   */
  canSwitchScope: boolean;
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

/** Morning or afternoon of one day, cut at `Closures.halfDayCut` — POOLSE-84. */
export type PartOfDay = 'morning' | 'afternoon';

export interface Closure {
  id: string;
  /** The site it shuts. Null only for a holiday, which shuts every site. */
  facilityId: string | null;
  facilityName: string | null;
  /** One tank of that site, or null for the whole site. */
  poolId: string | null;
  poolName: string | null;
  /** Null is the whole day. */
  partOfDay: PartOfDay | null;
  /** Shared by the closures one form made — one per tank. */
  batchId: string;
  /** ISO date, YYYY-MM-DD. A closure is days, not instants. */
  startsOn: string;
  endsOn: string;
  reason: string;
  blocksGeneration: boolean;
  repeatsAnnually: boolean;
  source: 'manual' | 'national_holiday' | 'municipal_holiday';
}

export interface Closures {
  organizationId: string;
  closures: Closure[];
  canManage: boolean;
  /** Every tank, with its site — what a water warning arrives naming. */
  pools: { id: string; name: string; facilityId: string }[];
  /** The sites and their tanks, for the form's scope. */
  sites: { id: string; name: string; pools: { id: string; name: string }[] }[];
  /** Where a morning ends, HH:MM on the site's clock — read from the database. */
  halfDayCut: string;
}

/**
 * A closure as the week calendar draws it — POOLSE-84. One weekday; the whole
 * site or one tank (`poolId`); the whole day, or the window of it a half day
 * shuts, in minutes from midnight on the site's clock. The page works the window
 * out from the database's cut, so the grid never writes the hour itself.
 */
export interface CalendarClosure {
  weekday: number;
  reason: string;
  poolId: string | null;
  window: { from: number; to: number } | null;
}

/** What shuts a tank today — POOLSE-84. `until` is the last closed day. */
export interface PoolClosure {
  reason: string;
  until: string;
  partOfDay: PartOfDay | null;
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
  /** Moved by hand this week — see the API's `Session.moved`. */
  moved?: boolean;
  weekday: number;
  durationMinutes: number;
  status: 'scheduled' | 'cancelled' | 'completed';
  cancellationReason: string | null;
  /** True when a closure cancelled it rather than a person. */
  /** Every lane it occupies this week, by id — what the grid draws with. */
  laneIds: string[];
  /** The recurring booking this is one week of, or null for a one-off. */
  scheduleId: string | null;
  byClosure: boolean;
  /** Somebody marked this register, so the class happened and does not move. */
  registerTaken: boolean;
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
  /**
   * Whether this swimmer had valid insurance on the day of this class.
   *
   * **A warning, never a gate.** Nothing here refuses a mark because of it — an
   * instructor at the poolside cannot fix a seguro, and a register that would
   * not open over a missing piece of paperwork is a register somebody keeps on
   * paper instead. It is judged against the class's own day rather than today,
   * because a register can be marked late and "was this child insured when they
   * swam" is the question that matters.
   */
  insured: boolean;
  /** POOLSE-133: the exame médico on the class's day — a warning, never a gate. */
  examState?: 'valid' | 'expired' | 'none';
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
  classGroupId: string;
  poolName: string | null;
  /** Every lane it occupies, by position — POOLSE-46. Empty when none was chosen. */
  lanes: number[];
  localDate: string;
  localTime: string;
  durationMinutes: number;
  status: 'scheduled' | 'cancelled' | 'completed';
  /** Whether the class has begun: the register opens then, never before (Rui, 28-10-2026). */
  started: boolean;
  instructorName: string | null;
  entries: RegisterEntry[];
  /**
   * Families coming to an aula experimental — POOLSE-69. Not entries: nobody
   * marks a trial, but the instructor is told who to expect.
   */
  trialGuests: { leadId: string; name: string; ageYears: number | null }[];
  /**
   * What the students said about this lesson — POOLSE-116. Every one for
   * management; for an instructor only a lesson they taught. Present on the
   * register read (`GET /sessions/:id/attendance`).
   */
  feedback?: LessonFeedback[];
  /** *Vou / Não vou* answers — on the register read. */
  notices?: SessionNotice[];
}

export interface Calendar {
  organizationId: string;
  from: string;
  to: string;
  sessions: CalendarSession[];
  canManage: boolean;
  /** Owner, admin, instructor — whether Marcar presenças is offered. */
  canTakeRegister?: boolean;
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

/**
 * An apólice the club holds — the facility's half of the seguro.
 *
 * `costPerPersonCents` is what the club pays its insurer, not what a family
 * pays: the family's price is the seguro fee plan, and a club adding a euro of
 * admin to it would otherwise have nowhere to put the difference.
 *
 * `daysToExpiry`, `expired` and `renewalDue` are derived on the server against
 * the database's own date. Nothing here recomputes them — a browser's clock is
 * not the club's, and two implementations of one rule agree until they do not.
 */
export interface InsurancePolicy {
  id: string;
  insurer: string;
  policyNumber: string;
  validFrom: string;
  validTo: string;
  costPerPersonCents: number;
  notes: string | null;
  daysToExpiry: number;
  expired: boolean;
  renewalDue: boolean;
  /** How many students hold cover under it — and the reason to renew. */
  coveredCount: number;
  /** The policy's own document, read at `/files/:id`. */
  documentFileId: string | null;
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
  /** What the turma picker shows on every row — POOLSE-113. */
  slots: { weekday: number; startTime: string }[];
  instructorName: string | null;
  capacity: number | null;
  active: number;
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
  /** Why — POOLSE-112: every required skill, or the age band at the season change. */
  reason: 'skills' | 'age';
  seasonName: string | null;
  /** Set when the club's automatic mode already moved the level; only the turma is left. */
  appliedAt: string | null;
  candidates: TransferCandidate[];
}

/** What the queue shows when it is empty — POOLSE-112 BA 3. */
export type AdvancementMode = 'propose' | 'apply';

export interface LevelStanding {
  levelId: string;
  levelName: string;
  minAgeMonths: number | null;
  maxAgeMonths: number | null;
  aboveNow: number;
  movableNow: number;
  belowNow: number;
  movableNext: number;
}

export interface AdvancementOutlook {
  mode: AdvancementMode;
  currentSeason: { id: string; name: string; startsOn: string } | null;
  nextSeason: { id: string; name: string; startsOn: string; status: string } | null;
  willMove: number;
  levels: LevelStanding[];
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
  /** The club's photograph of somebody with no login (28-10-2026); read at `/files/<id>`. */
  photoFileId: string | null;
  /** The avatar their own account holds in Clerk. */
  avatarUrl: string | null;
}

/**
 * Parcerias — POOLSE-47.
 *
 * `unitPrice` and `vatRate` are **decimal strings**, and stay strings the whole
 * way to the screen. A lane-hour is `numeric(12,6)` in the database precisely
 * because €14.375 is not a cents figure, and parsing it into a JavaScript number
 * here would put the rounding back that the column type exists to prevent. They
 * are formatted for display by the locale, never by arithmetic.
 *
 * `contractedCents` is different and is money: an integer, minor units, rounded
 * once in SQL where the numeric still had its six decimal places.
 */
export type PartnerType =
  | 'escola'
  | 'agrupamento'
  | 'ipss_misericordia'
  | 'jardim_infancia'
  | 'clube'
  | 'camara'
  | 'empresa'
  | 'outro';

export type PartnerStatus = 'ativa' | 'inativa';

export type BillingModel =
  | 'por_hora_pista'
  | 'por_bloco'
  | 'por_participante'
  | 'mensal_fixo';

/** One row of the partner list, derived columns computed in SQL. */
export interface PartnerRow {
  id: string;
  name: string;
  type: PartnerType;
  status: PartnerStatus;
  /** Hex, and never the only cue — the row always carries the name as text. */
  color: string;
  groupCount: number;
  /** Hours a week in the published season. Zero, never blank. */
  weeklyHours: number;
  weeklyLaneHours: number;
  contractedCents: number | null;
  billingModel: BillingModel | null;
}

/**
 * Importing a partnerships sheet — POOLSE-48.
 *
 * Mirrors `apps/api/src/facilities/partner-import.ts`. The shape worth pausing
 * on is that the preview is a **tree** — `partners`, each naming the indexes of
 * its own rows — rather than a flat list. A school's sheet has a row per class
 * with the school's name repeating down the column, so twelve rows across three
 * schools is three partnerships with twelve turmas, and a flat list of twelve
 * rows each saying "this partner already exists" would be technically true and
 * completely misleading.
 */
export type PartnerImportField =
  | 'partnerName'
  | 'partnerType'
  | 'groupName'
  | 'participantCount'
  | 'levelName'
  | 'tag'
  | 'ownInstructorName'
  | 'contactName'
  | 'contactEmail'
  | 'contactPhone'
  | 'notes';

export interface PartnerImportProblem {
  field: PartnerImportField;
  code: 'partnerRequired' | 'groupRequired' | 'tooLong' | 'badCount';
  value?: string;
}

export interface PartnerImportWarning {
  field: PartnerImportField;
  code:
    | 'unknownType'
    | 'countMissing'
    | 'typeConflict'
    | 'levelNotFound'
    | 'badEmail'
    | 'contactNotReachable';
  value?: string;
}

export interface PartnerImportUpdate {
  field: 'participantCount' | 'tag' | 'ownInstructorName' | 'levelId' | 'notes';
  before: string;
  after: string;
}

export interface PartnerImportRowResult {
  index: number;
  line: number;
  partnerName: string;
  partnerType: PartnerType;
  groupName: string;
  participantCount: number;
  levelName: string | null;
  levelId: string | null;
  tag: string | null;
  ownInstructorName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  /** Whether a contact can be written at all — `partner_contact_reachable`. */
  contactReachable: boolean;
  notes: string | null;
  partnerKey: string;
  /** Set when the club already has this partnership at the site. */
  partnerId: string | null;
  /** Set when it already has this group on that partnership — a stocktake. */
  groupId: string | null;
  problems: PartnerImportProblem[];
  warnings: PartnerImportWarning[];
  updates: PartnerImportUpdate[];
  existing: boolean;
  /** An earlier line of the same file naming the same group. */
  repeatOfLine: number | null;
  /** POOLSE-117: the days this row books — `newDays` are *novo*, `sameDays` *igual*. */
  weekdays: number[];
  startTime: string | null;
  durationMinutes: number | null;
  newDays: number[];
  sameDays: number[];
  /** The earlier row that brought this group, when this row only adds days. */
  moreDaysOf: number | null;
  importable: boolean;
}

/** One partnership on the preview, with the indexes of the rows that named it. */
export interface PartnerImportTree {
  key: string;
  name: string;
  type: PartnerType;
  partnerId: string | null;
  isNew: boolean;
  rows: number[];
}

export interface PartnerImportSummary {
  total: number;
  importable: number;
  refused: number;
  partnersToCreate: number;
  partnersExisting: number;
  groupsToCreate: number;
  groupsExisting: number;
  groupsToUpdate: number;
  flagged: number;
}

export interface PartnerImportResult {
  rows: PartnerImportRowResult[];
  partners: PartnerImportTree[];
  summary: PartnerImportSummary;
  /** Present only on a commit. */
  createdPartners?: number;
  createdGroups?: number;
  updatedGroups?: number;
  skipped?: number;
  /** POOLSE-117: days booked, in Sem pista. */
  bookedDays?: number;
}

/** One line per group, in the importer's own vocabulary — criterion 10. */
export interface PartnerExportRow {
  partnerName: string;
  partnerType: PartnerType;
  groupName: string;
  participantCount: number;
  levelName: string | null;
  tag: string | null;
  ownInstructorName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
  /** POOLSE-117: the days this line books, at one hour and length. */
  weekdays: number[];
  startTime: string | null;
  durationMinutes: number | null;
}

export interface PartnerExport {
  rows: PartnerExportRow[];
}

export interface PartnerList {
  items: PartnerRow[];
  total: number;
  page: number;
  limit: number;
  canManage: boolean;
}

export interface PartnerContact {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
}

export interface PartnerAgreement {
  id: string;
  seasonId: string | null;
  /**
   * The contract came before the terms — POOLSE-105. Start date, billing model
   * and price are then all null, never one without the others.
   */
  termsPending: boolean;
  startDate: string | null;
  endDate: string | null;
  billingModel: BillingModel | null;
  /** Decimal string. Never parsed — see the note above. Null while the terms are pending. */
  unitPrice: string | null;
  /** A fraction as a string: '0.2300' is 23%. Null is isento. */
  vatRate: string | null;
  paymentPeriod: string | null;
  notes: string | null;
  /** The signed contract, read at `/files/:id`; null when none is filed. */
  documentFileId: string | null;
  /** The contracts this one replaced, newest first — POOLSE-105. */
  previousContracts: ContractVersion[];
}

/** A signed-contract file — POOLSE-105. */
export interface ContractFile {
  fileId: string;
  originalName: string;
  contentType: string;
  attachedAt: string;
  /** The person's name, composed by the API. */
  attachedBy: string;
}

/** A contract that was replaced or removed, and by whom. */
export interface ContractVersion extends ContractFile {
  replacedAt: string;
  replacedBy: string;
}

export interface PartnerGroup {
  id: string;
  name: string;
  participantCount: number;
  levelId: string | null;
  levelName: string | null;
  bringsOwnInstructor: boolean;
  ownInstructorName: string | null;
  tag: string | null;
  notes: string | null;
}

export interface PartnerBooking {
  id: string;
  groupName: string;
  /** ISO weekday, Monday 1 … Sunday 7. */
  weekday: number;
  startTime: string;
  durationMinutes: number;
  poolName: string | null;
  laneNames: string[];
}

export interface PartnerDetail {
  id: string;
  facilityId: string;
  name: string;
  type: PartnerType;
  status: PartnerStatus;
  color: string;
  nif: string | null;
  address: string | null;
  notes: string | null;
  /**
   * The club runs these lessons: their calendar blocks carry a training plan
   * and can be cancelled. Never a register — a partnership group has a
   * headcount rather than a list of students.
   */
  managedLessons: boolean;
  contacts: PartnerContact[];
  /** The typed terms — owner and admin only; null for everybody else. */
  agreement: PartnerAgreement | null;
  /**
   * The signed contract on its own: staff may download it (Rui, 23-10-2026)
   * while the terms stay the office's — POOLSE-105.
   */
  contract: ContractFile | null;
  groups: PartnerGroup[];
  bookings: PartnerBooking[];
  canManage: boolean;
}

/**
 * The lane grid — POOLSE-49.
 *
 * The rows the timetable is drawn on (slots and lanes) and everything sitting in
 * them. One request, because the screen cannot paint a single cell until it has
 * all of it, and every list here is bounded — a facility's slots, its lanes, one
 * season's bookings — which is also why the grid is exempt from pagination.
 */
export interface GridSlot {
  id: string;
  dayGroup: DayGroup;
  /** `HH:MM`, wall-clock at the facility. `24:00` is a real end time. */
  startTime: string;
  endTime: string;
}

export interface GridLane {
  id: string;
  poolId: string;
  poolName: string;
  name: string;
  position: number;
  /** Null means the club has not said how many fit. A warning needs a number. */
  defaultCapacity: number | null;
}

export interface GridBooking {
  id: string;
  subjectType: 'turma' | 'parceria' | 'evento' | 'manutencao' | 'free_swim';
  /** The turma behind a turma booking; null for everything else. */
  classGroupId: string | null;
  name: string;
  /** The level for a turma, the partner for a parceria. */
  subtitle: string | null;
  instructorId: string | null;
  instructorName: string | null;
  instructorStatus: 'assigned' | 'to_define' | 'external' | 'uncovered';
  /** Null when nobody has said. Zero is a real answer and is not null. */
  headcount: number | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColour: string | null;
  /** The turma's own tint, when somebody chose one. Beats the level's. */
  classColour: ClassColour | null;
  /** Hex, and only for a parceria. Beats the category's colour. */
  partnerColour: string | null;
  partnerId: string | null;
  /** The club runs this partnership's lessons: plan and cancel are offered. */
  managedLessons: boolean;
  /** The partner group behind a parceria booking, with what an edit needs. */
  partnerGroupId: string | null;
  groupTag: string | null;
  bringsOwnInstructor: boolean;
  ownInstructorName: string | null;
  groupNotes: string | null;
  levelId: string | null;
  /** ISO weekday, Monday 1 … Sunday 7. */
  weekday: number;
  startTime: string;
  durationMinutes: number;
  /** Null means fora da grelha — drawn under the grid, never dropped. */
  slotId: string | null;
  /** Every lane it occupies, in position order. One block spans all of them. */
  laneIds: string[];
}

/**
 * The two staffing gaps, counted over the season's bookings — POOLSE-53.
 *
 * Never one number. `toDefine` is "we have not decided"; `uncovered` is "nobody
 * is covering this". Folding them together makes the alert include every slot
 * the club already knows about and has not staffed yet, which is a figure nobody
 * can act on. `external` — the school's own teacher — is in neither.
 */
export interface GridStaffing {
  uncovered: number;
  toDefine: number;
}

export interface FacilityGrid {
  /** The site this grid is of — the printed sheet is titled with it. */
  facilityName: string;
  seasonId: string | null;
  /** The counter has to say which season it counted. */
  seasonName: string | null;
  /** `draft` or `published` — a draft is next year's plan and says so. */
  seasonStatus: string | null;
  /** The dates the season covers — the grid stops drawing outside them. */
  seasonStartsOn: string | null;
  seasonEndsOn: string | null;
  staffing: GridStaffing;
  slots: GridSlot[];
  pools: { id: string; name: string }[];
  lanes: GridLane[];
  bookings: GridBooking[];
  categories: { id: string; name: string; colour: string }[];
  instructors: { id: string; name: string }[];
  partners: { id: string; name: string; colour: string }[];
  /** Keyed `laneId:levelId` — POOLSE-51's per-level capacity overrides. */
  laneLevelCapacity: Record<string, number>;
  /** Null means the club has no opinion about concurrent groups per instructor. */
  maxConcurrentGroups: number | null;
  canManage: boolean;
}

/**
 * How much of the water is sold — POOLSE-52.
 *
 * Lane-hours are **decimal strings**: a quantity that gets multiplied by a
 * price, and never a float. Percentages arrive already computed — the web app
 * formats them for the locale and performs no arithmetic of its own, which is
 * criterion 8 and the reason there is only ever one answer to "what is our
 * occupancy".
 */
export type TimeBand = 'manha' | 'tarde' | 'noite';

export interface OccupancySlice {
  soldLaneHours: string;
  turmaLaneHours: string;
  parceriaLaneHours: string;
  headcount: number;
  turmaHeadcount: number;
  parceriaHeadcount: number;
}

/** One day of the week × one part of the day — POOLSE-93. Mirrors `occupancy.repository.ts`. */
export interface OccupancyDayBand {
  weekday: number;
  band: TimeBand;
  availableLaneHours: string;
  soldLaneHours: string;
  /** Days of the season this cell was open, after closures. */
  openDays: number;
  freeLaneHoursPerWeek: string;
  /** 0–100; null for a cell the site never opens. */
  freePercent: number | null;
  opensAt: string | null;
  closesAt: string | null;
}

export interface Occupancy {
  seasonId: string;
  seasonName: string;
  seasonStartsOn: string;
  seasonEndsOn: string;
  total: OccupancySlice & { availableLaneHours: string };
  /** Sold ÷ available. Null when the club has no slot grid to divide by. */
  laneHourOccupancy: number | null;
  /** Swimmers ÷ places, over booked lanes that have a capacity. */
  seatOccupancy: number | null;
  /** Booked lanes with no capacity recorded — the percentage's asterisk. */
  lanesWithoutCapacity: number;
  byDay: (OccupancySlice & { weekday: number; availableLaneHours: string })[];
  byBand: (OccupancySlice & { band: TimeBand })[];
  /** All 21 cells, Monday morning first. */
  byDayBand: OccupancyDayBand[];
  /** Up to five cells with the most free lane-hours a week, ranked by the server. */
  mostFree: OccupancyDayBand[];
  /** Owner/admin only; null otherwise. Rendered nowhere yet — POOLSE-52 AC9. */
  contractedCents: number | null;
}

/**
 * Invoicing — phase 2.2.
 *
 * **Internal records, not legal faturas.** Poolse is not certified software
 * under Decreto-Lei 28/2019; what a club gets is a priced, numbered, immutable
 * document it hands to whatever issues its faturas. The screens say so, because
 * a club that thought otherwise would find out at the wrong moment.
 */
export type InvoiceDocumentKind = 'invoice' | 'credit_note';

/**
 * What state a document is in — 2.3.
 *
 * Derived on the server and rendered here; there is no status column. The
 * precedence matters: a **credited** document is owed by nobody whatever was
 * paid against it, and a partly paid document past its due date is still
 * **overdue** — half of nothing arriving on time is still late.
 */
export type InvoiceStatus =
  | 'open'
  | 'partly_paid'
  | 'overdue'
  | 'paid'
  | 'credited'
  | 'credit_note';

/** How money reached the club. The same enum the fee register already uses. */
export type PaymentSource = 'manual' | 'mbway' | 'sepa';

/** How a family was asked. A person's action until the notifications phase. */
/** `poolse_email` is a reminder Poolse sent — POOLSE-86; never recorded by hand. */
export type ChaseChannel = 'email' | 'phone' | 'message' | 'in_person' | 'letter' | 'poolse_email';

export interface InvoicePayment {
  id: string;
  amountCents: number;
  paidOn: string;
  source: PaymentSource;
  reference: string | null;
  notes: string | null;
  recordedByName: string | null;
}

export interface InvoiceChase {
  id: string;
  chasedOn: string;
  channel: ChaseChannel;
  note: string | null;
  recordedByName: string | null;
  /** A reminder Poolse emailed: whether it left. Null for any other channel. */
  delivered: boolean | null;
}

/** Invoice reminders by email — POOLSE-86, 3.0b. */
export interface ReminderPayer {
  key: string;
  payerName: string;
  email: string | null;
  documents: { invoiceId: string; documentNo: string; issuedOn: string; dueOn: string; outstandingCents: number }[];
  lastRemindedOn: string | null;
  recentlyReminded: boolean;
}

export interface ReminderPreview {
  payers: ReminderPayer[];
  nothingOverdue: string[];
  /** *Como pagar* as the email will say it — POOLSE-94; null is "contact the club". */
  payment: PaymentDestinations | null;
  emailConfigured: boolean;
}

export interface ReminderSent {
  reminderIds: string[];
  noAddress: string[];
  /** The emails go after the answer; this says whether any can leave at all. */
  emailConfigured: boolean;
}

export interface InvoiceSeries {
  id: string;
  kind: InvoiceDocumentKind;
  name: string;
  prefix: string;
  nextNumber: number;
  isDefault: boolean;
  /** Has issued at least one document, so its letter is fixed. */
  inUse: boolean;
}

export interface InvoiceLine {
  id: string | null;
  /**
   * The swimmer and the fee a line charges — all null on a free-swim sale
   * (POOLSE-68), where `passId` is set instead and the person is the payer.
   */
  studentId: string | null;
  studentName: string | null;
  studentTaxNumber: string | null;
  studentFeeId: string | null;
  kind: FeeKind | null;
  /** The pass this line sold. Null on a fee line. */
  passId: string | null;
  /**
   * The club's own words — a level's name, or a season's. Never the kind:
   * `kind` is an enum whose Portuguese is a translation key, so the sentence is
   * composed on screen rather than stored half-translated on the document.
   */
  description: string | null;
  /**
   * The concession this line was charged under, in the club's own words.
   *
   * Null where none applied. A snapshot like every other name on a document: the
   * amount is already net of the discount, so without this the document says
   * 28,00 where the price list says 35,00 and nothing accounts for the rest.
   */
  feeCategoryName: string | null;
  lessonsPerWeek: number | null;
  periodStart: string;
  months: number;
  /** Gross, VAT included, integer cents. */
  amountCents: number;
  vatRate: number;
  vatExempt: boolean;
  vatExemptionReason: string | null;
  vatCents: number;
  netCents: number;
  creditsInvoiceLineId: string | null;
}

export interface Invoice {
  id: string;
  kind: InvoiceDocumentKind;
  documentNo: string;
  number: number;
  seriesId: string;
  facilityId: string;
  facilityName: string;
  issuedOn: string;
  dueOn: string;
  systemEntryAt: string;
  payerMembershipId: string | null;
  payerStudentId: string | null;
  /** Null only on an anonymous free-swim sale: "Consumidor final", said by the interface. */
  payerName: string | null;
  payerTaxNumber: string | null;
  payerAddress: string | null;
  payerEmail: string | null;
  correctsInvoiceId: string | null;
  correctsDocumentNo: string | null;
  creditedByInvoiceId: string | null;
  creditedByDocumentNo: string | null;
  notes: string | null;
  totalCents: number;
  vatCents: number;
  netCents: number;
  lineCount: number;
  /** Settlement — 2.3. All derived on the server, never recomputed here. */
  status: InvoiceStatus;
  paidCents: number;
  /** Floored at zero: an overpayment settles rather than owing a family money. */
  outstandingCents: number;
  /** Days past due, null once settled or credited. From the database's date. */
  daysOverdue: number | null;
  lastChasedOn: string | null;
  chaseCount: number;
  lines?: InvoiceLine[];
  payments?: InvoicePayment[];
  chases?: InvoiceChase[];
}

// ---------------------------------------------------------------------------
// Free swim — POOLSE-68
// ---------------------------------------------------------------------------

export type PassKind = 'single' | 'pack' | 'period';

/** What a site sells at reception. Priced like a fee: gross, VAT inside. */
export interface PassProduct {
  id: string;
  kind: PassKind;
  name: string;
  /** A pack's entries. Null for a single entry and a period pass. */
  entries: number | null;
  /** Days a sold pass is good for. Required on a period pass, optional on a pack. */
  validityDays: number | null;
  amountCents: number;
  vatRate: number;
  vatExempt: boolean;
  provenance: 'actual' | 'contracted' | 'estimated' | 'assumed';
  soldCount: number;
}

/** One tank right now. `capacity` null is "not measured" and refuses nothing. */
export interface PoolOccupancy {
  poolId: string;
  poolName: string;
  capacity: number | null;
  swimmers: number;
  inClasses: number;
  /** What shuts it now; a check-in is refused while it is set — POOLSE-84. */
  closure: PoolClosure | null;
}

export interface InWater {
  checkInId: string;
  passId: string;
  poolId: string;
  membershipId: string | null;
  /** Null for an anonymous single entry. */
  personName: string | null;
  productName: string;
  kind: PassKind;
  checkedInAt: string;
  leavesAt: string;
}

export interface Reception {
  stayMinutes: number;
  pools: PoolOccupancy[];
  inWater: InWater[];
  products: PassProduct[];
  month: FreeSwimMonth;
}

/** A sold pass, with everything about it derived on the server. */
export interface Pass {
  id: string;
  productName: string;
  kind: PassKind;
  entries: number | null;
  entriesUsed: number;
  entriesLeft: number | null;
  validFrom: string;
  validUntil: string | null;
  soldAt: string;
  voided: boolean;
  expired: boolean;
  notYet: boolean;
  inWater: boolean;
  documentNo: string | null;
  invoiceId: string | null;
}

export interface InvoiceDraft {
  /** `m:<id>` for a guardian, `s:<id>` for a student who pays for themselves. */
  payerKey: string;
  payerMembershipId: string | null;
  payerStudentId: string | null;
  payerName: string;
  payerTaxNumber: string | null;
  payerAddress: string | null;
  payerEmail: string | null;
  lines: InvoiceLine[];
  totalCents: number;
  vatCents: number;
  /** Present only on a run that was committed. */
  documentNo?: string;
  invoiceId?: string;
}

export interface InvoiceRun {
  periodStart: string;
  dueOn: string;
  seriesId: string;
  drafts: InvoiceDraft[];
  /**
   * Occurrences left out because they are already on a live document.
   *
   * Shown rather than dropped: "nothing to bill" and "everything is already
   * billed" look identical on an empty table and are different things to do.
   */
  alreadyChargedCount: number;
  committed: boolean;
}

/**
 * The platform operator's side — `/admin`, not a tenant screen.
 *
 * Nothing here is scoped to an organization and nothing here sends
 * `x-poolse-organization`: the API derives the caller's identity from the
 * session and `PlatformAdminGuard` decides. A 403 with `not_platform_admin` is
 * the whole authorisation answer, and it is distinct from `forbidden_role` on
 * purpose — that one sends somebody to an admin, this one sends them nowhere.
 */
export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  /** Set by the trial clock when the trial runs out — POOLSE-61. */
  | 'expired'
  /**
   * Readable, never written — POOLSE-63.
   *
   * The free pilot lives on `billingMode` now: `comped` there with an ordinary
   * `active` status. The value stays so a row written before that still renders.
   */
  | 'comped';

/**
 * How a club pays for Poolse — POOLSE-63.
 *
 * Beside the status, never inside it: the mode says *how*, the status says
 * *whether*, and `suspendedAt` says whether the door is open.
 */
export type BillingMode = 'stripe' | 'manual' | 'comped';

/** How money that never went through Stripe arrived. */
export type PaymentMethod = 'cash' | 'bank_transfer' | 'other';

/** One payment a club made outside Stripe. Insert-only, so there is no edit. */
export interface ManualPayment {
  id: string;
  amountCents: number;
  currency: string;
  receivedOn: string;
  method: PaymentMethod;
  coversFrom: string | null;
  coversTo: string;
  note: string | null;
  recordedByClerkUserId: string;
  createdAt: string;
}

/** The club's own fiscal identity — POOLSE-62, read under Faturação. */
export interface TaxSettings {
  /** Nine digits, normalised, or null where nobody has filled it in. */
  taxNumber: string | null;
  /** *Como pagar* — POOLSE-86: the club's own words, the third card since POOLSE-94. */
  paymentInstructions: string | null;
  /** POOLSE-94: `PT50…` without spaces, the holder, and `+3519…` for MB WAY. */
  paymentIban: string | null;
  paymentAccountHolder: string | null;
  paymentMbwayPhone: string | null;
}

/** Where families pay the club — POOLSE-94. Null fields were left empty. */
export interface PaymentDestinations {
  iban: string | null;
  /** The club's name where an IBAN is set and nobody typed a holder. */
  accountHolder: string | null;
  mbwayPhone: string | null;
  instructions: string | null;
}

/** Where to pay, and what to give as the reference: open document numbers, else the student's name. */
export interface PayTo {
  destinations: PaymentDestinations;
  reference: string;
}

/**
 * The trial a club claimed when it signed up — POOLSE-62.
 *
 * The *normalised* address, never the raw one, and the IP only ever as a count:
 * an operator needs to know that two signups came from one address, never what
 * it was.
 */
export interface TenantClaim {
  normalizedEmail: string;
  emailDomain: string;
  claimedAt: string;
  releasedAt: string | null;
  releasedByClerkUserId: string | null;
  /** Soft flags. They block nothing — clubs share offices and NAT is real. */
  sameDomainCount: number;
  /** Null where no salt is configured: nothing recorded, not nothing matched. */
  sameIpCount: number | null;
}

/** A manual subscription running out inside the window. Negative days are late. */
export interface RenewalDue {
  organizationId: string;
  name: string;
  paidThrough: string;
  daysLeft: number;
  subscriptionStatus: SubscriptionStatus;
  readOnlyAt: string | null;
}

/**
 * `/platform/billing` — the operator's own picture.
 *
 * Counts per mode, and euros only for what Poolse actually holds a record of.
 * **There is no Stripe figure** and the screen says why: the prices live in
 * Stripe, nothing here stores an amount, and a number this product guessed would
 * be worse than a sentence pointing at the dashboard that knows.
 */
export interface BillingOverview {
  tenantsByMode: Record<BillingMode, number>;
  /** Started counts the ledger, not the clubs still here — POOLSE-62. */
  trialsStarted: number;
  trialsConverted: number;
  trialsStillRunning: number;
  manualCentsAllTime: number;
  manualCentsLast12Months: number;
  manualPaymentCount: number;
  /** Bills read by the model, per month, newest last — POOLSE-106. */
  energyReads: { month: string; reads: number; unread: number }[];
  renewals: RenewalDue[];
  renewalsWindowDays: number;
}

/** One sport on the /admin *Desportos* block — POOLSE-124. */
export interface PlatformTenantSport {
  sport: PoolseSport;
  enabled: boolean;
  recintos: number;
  /** Null is not priced yet. */
  addonMonthlyCents: number | null;
}

export interface PlatformTenant {
  id: string;
  /** POOLSE-87: the modules switched off; empty is the full product. */
  disabledModules: PoolseModule[];
  /** POOLSE-124: every sport, whether it is on, its live recintos and its add-on price. */
  sports: PlatformTenantSport[];
  name: string;
  slug: string;
  kind: OrganizationKind;
  createdAt: string;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: string | null;
  /** Set once they pay — POOLSE-60 made it one plan, so it is a yes or a no. */
  planTier: PlanKey | null;
  /**
   * How they pay, and the last day they are paid up to — POOLSE-63.
   *
   * `paidThrough` is a `YYYY-MM-DD` day, inclusive, and only ever moves because
   * a payment was recorded. There is no control that types it.
   */
  billingMode: BillingMode;
  paidThrough: string | null;
  /** Active management memberships plus invitations still outstanding. */
  managementSeatsUsed: number;
  /** Null is unlimited, never zero. */
  maxManagementUsers: number | null;
  facilityCount: number;
  maxFacilities: number | null;
  poolCount: number;
  /** Last *recorded write*, not last login — see the API repository's note. */
  lastActivityAt: string | null;
  archivedAt: string | null;
  /**
   * Closed by an operator — slice 3. Distinct from `archivedAt`, which is
   * deletion, and from `subscriptionStatus`, which is what they are paying.
   */
  suspendedAt: string | null;
  /**
   * Read-only, and until when the data is kept — POOLSE-61.
   *
   * Beside suspension rather than folded into it: a tenant can be read-only and
   * open, suspended and not read-only, or both, and this screen has to be able to
   * say which. `suspendedAt` beats `readOnlyAt` beats open.
   */
  readOnlyAt: string | null;
  pendingDeleteAt: string | null;
  /** Non-null exactly when suspended. Shown to the club verbatim. */
  suspensionReason: string | null;

  /** Request health over the last 24 hours — slice 2. */
  health: TenantHealth;
  requestCount24h: number;
  count4xx24h: number;
  count5xx24h: number;
  lastErrorAt: string | null;
}

/** `/health` — public, unauthenticated, tenant-less. */
export type CheckStatus = 'ok' | 'slow' | 'failing' | 'not_installed';

export interface DependencyCheck {
  /** `postgres`, `timescale`, `clerk`. Translated by the client. */
  name: string;
  status: CheckStatus;
  latencyMs: number | null;
}

export interface Health {
  status: 'ok' | 'degraded' | 'down';
  checks: DependencyCheck[];
}

/**
 * Is this tenant's API behaving — slice 2.
 *
 * Derived on the server from the last 24 hours of `tenant_request_stats` and
 * never stored, so the client renders the verdict and never recomputes it.
 * `unknown` means no requests were recorded, which is a different fact from
 * healthy.
 */
export type TenantHealth = 'green' | 'amber' | 'red' | 'unknown';

export interface RequestBucket {
  /** Hour, ISO instant. */
  bucket: string;
  requestCount: number;
  count4xx: number;
  count5xx: number;
  p95LatencyMs: number;
}

export interface RecentError {
  at: string;
  route: string;
  message: string | null;
}

export interface TenantRequests {
  organizationId: string;
  name: string;
  windowDays: number;
  health: TenantHealth;
  requestCount24h: number;
  count4xx24h: number;
  count5xx24h: number;
  /** Oldest first. */
  buckets: RequestBucket[];
  /** Newest first, one per distinct route. */
  errors: RecentError[];
}

/**
 * Staff salaries — POOLSE-58.
 *
 * Both figures on a rate arrive computed, with a flag saying which of the two
 * was derived from the other: the arithmetic lives once, in `@poolse/rules`, and
 * is run by the API. Nothing on this side multiplies a wage by anything.
 *
 * `cents: null` means the contracted hours are not recorded. It renders as a
 * dash and contributes nothing to a total — never a zero, which would make
 * somebody look free.
 */
/** Where a monetary figure came from — docs/financials.md §2. */
export type MoneyProvenance = 'actual' | 'contracted' | 'estimated' | 'assumed';

export interface StaffRate {
  id: string;
  kind: 'monthly' | 'hourly';
  amountCents: number;
  currency: string;
  /** A typed or imported rate is `contracted`; a guess says so and renders muted. */
  provenance: MoneyProvenance;
  /** The optional three-point range — §3. Null on a contracted rate. */
  amountLowCents: number | null;
  amountHighCents: number | null;
  weeklyHours: number | null;
  payPeriodsPerYear: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  note: string | null;
  monthlyCents: number | null;
  monthlyDerived: boolean;
  hourlyCents: number | null;
  hourlyDerived: boolean;
}

export interface StaffRateRecord extends StaffRate {
  createdByName: string | null;
  createdAt: string;
  archivedAt: string | null;
  /** The rate covering today. At most one, by exclusion constraint. */
  current: boolean;
}

export interface SalaryRow {
  membershipId: string;
  displayName: string | null;
  shortName: string | null;
  roles: string[];
  /** Null for somebody with nothing recorded — "sem valor definido". */
  live: StaffRate | null;
}

export interface SalarySummary {
  /** What leaves the bank in an ordinary month. */
  thisMonthCents: number;
  /** What employing these people costs per month, subsídios spread. */
  annualisedMonthlyCents: number;
  monthlyContractCents: number;
  hourlyContractCents: number;
  monthlyContractCount: number;
  hourlyContractCount: number;
  /** Live rates whose contracted hours are unknown. Counted, never summed. */
  hoursUnknownCount: number;
  noRateCount: number;
  /**
   * How much of the club this total is about — docs/financials.md §6. Said out
   * loud, because an unqualified figure over partial data is the same shape as a
   * complete one and nothing on it says which.
   */
  coverage: { withRate: number; total: number };
  complete: boolean;
  /** The weakest provenance summed — §2. Never one unlabelled figure across them. */
  provenance: MoneyProvenance;
  byProvenance: Record<MoneyProvenance, number>;
  /**
   * True for an Admin, always: the Owner's rate is not in these figures.
   *
   * Said on the card in words. An Admin's total is a different number from the
   * Owner's for the same club, and an absence nobody explains reads as a zero.
   */
  ownerExcluded: boolean;
}

export interface Salaries {
  organizationId: string;
  salaries: Paginated<SalaryRow>;
  canEdit: boolean;
}

/**
 * Exporting and importing the pay list — POOLSE-59.
 *
 * Every exported value is a string, in the shape the file holds it: the type as
 * its enum spelling and the date as ISO, so a file exported under `en` imports
 * under `pt-PT`. The amount is a plain decimal; `parseSheetCents` reads it back
 * along with whatever else a club's own workbook carries.
 */
export interface SalaryExportRow {
  name: string;
  email: string;
  taxNumber: string;
  kind: string;
  amount: string;
  weeklyHours: string;
  payPeriods: string;
  effectiveFrom: string;
  /** Where the figure came from — docs/financials.md §2. The enum's own spelling. */
  provenance: string;
  note: string;
}

/** Machine keys. The catalogue owns the sentence, in both languages. */
export type SalaryImportProblem =
  | 'noKey'
  | 'badNif'
  | 'notFound'
  | 'notStaff'
  | 'ownerRefused'
  | 'kindMissing'
  | 'provenanceInvalid'
  | 'amountInvalid'
  | 'hoursInvalid'
  | 'periodsInvalid'
  | 'dateMissing'
  | 'dateInvalid'
  | 'overlap'
  | 'duplicateInFile';

export interface SalaryImportRowResult {
  index: number;
  /** The spreadsheet line, counting the header as 1. */
  line: number;
  name: string;
  email: string | null;
  taxNumber: string | null;
  membershipId: string | null;
  /** What the club calls them, which may not be what the file does. */
  matchedName: string | null;
  roles: string[];
  kind: 'monthly' | 'hourly' | null;
  amountCents: number | null;
  weeklyHours: number | null;
  payPeriodsPerYear: number;
  effectiveFrom: string | null;
  provenance: MoneyProvenance;
  note: string | null;
  /** What they are on today, so the preview shows old → new. */
  current: {
    kind: 'monthly' | 'hourly';
    amountCents: number;
    weeklyHours: number | null;
    effectiveFrom: string;
  } | null;
  unchanged: boolean;
  /** No amount at all — an exported line for somebody with no rate yet. */
  blank: boolean;
  problems: SalaryImportProblem[];
  repeatOfLine: number | null;
  importable: boolean;
}

export interface SalaryImportResult {
  rows: SalaryImportRowResult[];
  summary: {
    total: number;
    importable: number;
    unchanged: number;
    blank: number;
    rejected: number;
  };
  /** Set when the whole file is refused rather than individual rows. */
  refusal: 'duplicatePerson' | null;
  committed: boolean;
  written: number;
}

/**
 * What the club pays Poolse — slice 2.4.
 *
 * `configured` is false on every installation with no Stripe key, which is every
 * development machine and the free pilot. The screen says so; nothing else in
 * the app changes shape.
 *
 * The Stripe ids never cross to the browser. A club has no use for them, and a
 * customer id in a screenshot is one more thing to keep out of one.
 */
export interface OrganizationSubscription {
  organizationId: string;
  name: string;
  plan: PlanKey | null;
  /** How often they are billed. Null until they subscribe. */
  interval: BillingInterval | null;
  /**
   * The shared union, not a second copy of it.
   *
   * This listed five of the six and left out `expired`, which the API passes
   * straight through from `organization.subscription_status` — so the one state
   * that brings an owner to this page on purpose was a type error to test for,
   * and the missing `subscription.state.expired` message hid behind that.
   */
  status: SubscriptionStatus | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasCustomer: boolean;
  hasSubscription: boolean;
  suspendedAt: string | null;
}

/** One plan — POOLSE-60. It is what a club bought, never what it may do. */
export type PlanKey = 'poolse_full';

export type BillingInterval = 'monthly' | 'yearly';

export interface IntervalOffer {
  interval: BillingInterval;
  /** Null until somebody prices it in Stripe — the page says so. */
  amountCents: number | null;
  currency: string | null;
}

export interface SubscriptionView {
  subscription: OrganizationSubscription;
  intervals: IntervalOffer[];
  /** What yearly saves against twelve monthly payments. Null unless both are priced. */
  yearlySavingPercent: number | null;
  configured: boolean;
  /** The owner, and nobody else. An admin reads this screen and cannot act on it. */
  canManage: boolean;
  /**
   * Each sport switched on beyond the pool — one add-on line under the plan
   * (POOLSE-124). `monthlyCents` null is not priced yet. Empty for a pool club.
   */
  addons: { sport: PoolseSport; monthlyCents: number | null; currency: string }[];
}

/* -------------------------------------------------------------------------- */
/* The dashboard — POOLSE-66                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What a card knows about itself.
 *
 * `empty` and `error` are **different states and render differently**: a club
 * with nothing outstanding and a query that broke must not look the same. The
 * server decides which — a resolver answering `null` is `empty`, a resolver that
 * throws is `error` — and the client never infers one from missing data.
 *
 * An `error` card carries **no message**, deliberately: a resolver's own words
 * name columns and constraints, and that is not a sentence for a club.
 */
export type WidgetState = 'ok' | 'empty' | 'error';

export interface DashboardWidget {
  id: string;
  /** Column span in its band: 1, 2, or the full width. */
  size: 1 | 2 | 3;
  priority: number;
  state: WidgetState;
  /** Null for `empty` and `error`; the widget's own shape for `ok`. */
  data: unknown;
}

export interface DashboardBand {
  id: 'management' | 'operational' | 'personal';
  order: number;
  widgets: DashboardWidget[];
}

/**
 * The facility selector's state — sent from slice 1, rendered from slice 2b.
 *
 * Every widget in 2a is tenant- or self-scoped, so a selector would change
 * nothing on screen yet. It arrives with the first facility-scoped aggregate.
 */
export interface DashboardScope {
  mode: 'all' | 'facility';
  facilityId: string | null;
  facilities: { id: string; name: string }[];
}

/** Whose cards the personal band shows — the reader's own records, and the one chosen. */
export interface DashboardFamily {
  children: { id: string; name: string; self: boolean }[];
  selectedId: string;
}

export interface Dashboard {
  scope: DashboardScope;
  bands: DashboardBand[];
  /** Null for anybody with no record of their own or a child's. */
  family: DashboardFamily | null;
}

/** `me.nextclass` — the child's next lesson, on the site's clock. */
export interface ChildNextClassWidgetData {
  sessionId: string;
  className: string;
  levelName: string | null;
  poolId: string | null;
  poolName: string | null;
  lanes: number[];
  localDate: string;
  localTime: string;
  durationMinutes: number;
  dayOffset: number;
  weekday: number;
  instructorName: string | null;
}

/** `me.trainingplan` — that lesson's plan, read-only, no author. */
export interface ChildPlanWidgetData {
  next: Pick<ChildNextClassWidgetData, 'sessionId' | 'className' | 'localDate' | 'localTime' | 'dayOffset' | 'weekday'>;
  body: string;
}

/** `me.attendance` — this month so far. */
export interface ChildAttendanceWidgetData {
  month: string;
  held: number;
  present: number;
  absent: number;
  excused: number;
  unmarked: number;
}

/** `me.fees` — the API's `balance`, and how many lines are running. */
export interface ChildFeesWidgetData extends FeeBalance {
  lines: number;
}

/** `me.water` — the latest water temperature at the next lesson's pool. */
export interface PoolTemperatureWidgetData {
  poolName: string;
  celsius: string;
  localDate: string;
  localTime: string;
}

/** `maint.mytasks` — the jobs that are mine, plus the ones nobody has taken. */
export interface TasksWidgetData {
  total: number;
  tasks: MaintenanceTask[];
  /** The site page answers this reader; an instructor's card opens the task instead. */
  canOpenSite: boolean;
}

/** `setup.checklist` — a club with no sites, and the only card it gets. */
/** `mgmt.money.period` — mensalidades in their current period. Cents. */
/** POOLSE-68: free swim this month — never summed with mensalidades. */
export interface FreeSwimMonth {
  from: string;
  salesCents: number;
  sales: number;
  entries: number;
  provenance: 'actual';
}

/** The `mgmt.freeswim` card: the tanks now, the month, how many products are sold. */
export interface FreeSwimWidgetData {
  pools: PoolOccupancy[];
  month: FreeSwimMonth;
  products: number;
}

export interface MoneyWidgetData {
  paidCents: number;
  dueCents: number;
  overdueCents: number;
  lines: number;
  students: number;
  studentsOverdue: number;
}

/** `mgmt.occupancy.today` — today's classes at each site's own date. */
export interface OccupancyTodayWidgetData {
  classes: number;
  swimmers: number;
  withoutInstructor: number;
  /** The busiest moment in one tank. `capacity` null is "not measured". */
  peak: { poolId: string; poolName: string; swimmers: number; capacity: number | null } | null;
}

/** `mgmt.waterquality.alerts` — tanks out of range or due an analysis. */
export interface WaterWidgetData {
  tanks: number;
  flagged: {
    poolId: string;
    poolName: string;
    takenAt: string | null;
    outOfRange: PoolMetric[];
    due: boolean;
  }[];
}

/** `mgmt.maintenance.open` — open requests by kind and severity, and overdue rooms. */
export interface MaintenanceWidgetData {
  open: { type: IssueType; severity: Severity; count: number }[];
  overdueCleanings: number;
  /** Per site, only those with something outstanding — most overdue rooms first. */
  bySite: { facilityId: string; overdueCleanings: number; openRequests: number }[];
}

/** `mgmt.people` — the club's people. Club-wide: no site owns a person. */
export interface PeopleWidgetData {
  students: number;
  staff: number;
  byRole: { owner: number; admin: number; instructor: number; maintenance: number; guardian: number };
  pendingInvitations: number;
  expiringInvitations: number;
}

/** `mgmt.staffcost` — `salarySummary`, the figure Salários shows. */
export interface StaffCostWidgetData {
  thisMonthCents: number;
  coverage: { withRate: number; total: number };
  complete: boolean;
  ownerExcluded: boolean;
}

/** `inst.nextclass` — POOLSE-66 slice 3. Days and times are the site's. */
export interface NextClassWidgetData {
  sessionId: string;
  classGroupId: string | null;
  partner: boolean;
  className: string;
  levelName: string | null;
  poolName: string | null;
  lanes: number[];
  startsAt: string;
  localDate: string;
  localTime: string;
  durationMinutes: number;
  /** 0 today, 1 tomorrow — computed on the site's clock, by the server. */
  dayOffset: number;
  weekday: number;
  enrolled: number;
  capacity: number | null;
  registerOpen: boolean;
  registerTaken: boolean;
  coveringFor: string | null;
}

/** `inst.week`. Cancelled classes included, flagged. */
export interface WeekWidgetData {
  remaining: number;
  classes: {
    sessionId: string;
    classGroupId: string | null;
    partner: boolean;
    className: string;
    poolName: string | null;
    localDate: string;
    localTime: string;
    weekday: number;
    dayOffset: number;
    durationMinutes: number;
    cancelled: boolean;
    registerTaken: boolean;
    past: boolean;
  }[];
}

/** `inst.trainingplan.next`. The previous lesson's text is never sent. */
export interface TrainingPlanWidgetData {
  next: {
    sessionId: string;
    classGroupId: string | null;
    className: string;
    localDate: string;
    localTime: string;
    dayOffset: number;
    weekday: number;
  };
  written: boolean;
  excerpt: string | null;
  updatedBy: string | null;
  previousOn: string | null;
  canEdit: boolean;
}

/** `inst.myturmas`. */
export interface MyTurmasWidgetData {
  total: number;
  turmas: {
    id: string;
    name: string;
    levelName: string | null;
    students: number;
    capacity: number | null;
  }[];
}

/** `maint.requests` — POOLSE-66 slice 4. Avarias only; "mine" is the reporter. */
export interface FaultsWidgetData {
  total: number;
  high: number;
  faults: {
    id: string;
    description: string;
    severity: 'low' | 'normal' | 'high';
    reportedAt: string;
    mine: boolean;
    facilityId: string;
    facilityName: string;
    spaceId: string | null;
    spaceName: string | null;
    poolId: string | null;
    poolName: string | null;
  }[];
}

/** `maint.cleanings.overdue`. */
export interface OverdueSpacesWidgetData {
  total: number;
  spaces: {
    id: string;
    facilityId: string;
    name: string;
    lastCleanedAt: string | null;
    intervalHours: number;
  }[];
}

/** `maint.inventory`. */
export interface InventoryWatchWidgetData {
  restockTotal: number;
  restocks: {
    id: string;
    description: string;
    severity: 'low' | 'normal' | 'high';
    itemName: string | null;
    facilityId: string;
  }[];
  lostTotal: number;
  lost: {
    id: string;
    description: string;
    foundOn: string;
    locationFound: string | null;
    facilityId: string;
  }[];
}

export interface ChecklistWidgetData {
  steps: { id: 'facility' | 'pools' | 'prices' | 'staff' | 'students'; done: boolean }[];
}

/** `mgmt.energy.costs` — twelve months of bills, summed on the server. */
export interface EnergyCostsWidgetData {
  totalCents: number;
  kwh: number;
  billCount: number;
  months: { month: string; totalCents: number | null; kwh: number | null }[];
  latest: {
    supplier: string;
    meterName: string;
    periodStart: string;
    periodEnd: string;
    totalCents: number;
    kwh: number;
  } | null;
}

/* ---------------------------------------------------------------------------
 * Messages to families — POOLSE-67
 * ------------------------------------------------------------------------- */

export type MessageAudience = 'class_group' | 'level' | 'facility' | 'organization' | 'closure' | 'session';

/** Who a message is written for — a closure's warning also reaches partners and leads. */
export type RecipientKind = 'student' | 'partner' | 'lead';

export interface MessagePreview {
  studentCount: number;
  /** Partners a closure's warning reaches — POOLSE-84. */
  partnerCount: number;
  /** Trial leads a closure's warning reaches — POOLSE-84. */
  leadCount: number;
  /** Distinct addresses: what will be sent, and what the daily ceiling counts. */
  addressCount: number;
  /** Addresses left out because they opted out — POOLSE-86. Always 0 for a closure. */
  optedOutCount: number;
  /** Nobody can be written to for these — named, never only counted. */
  unreachable: { studentId: string; name: string; kind: RecipientKind }[];
  /** False where no email provider is configured: recorded, not sent. */
  emailConfigured: boolean;
  /** Present once the message has been written. */
  id?: string;
}

export interface MessageSummary {
  id: string;
  audience: MessageAudience;
  targetId: string | null;
  targetName: string | null;
  subject: string;
  sentAt: string;
  sentByName: string | null;
  addressCount: number;
  deliveredCount: number;
  unreachableCount: number;
}

export interface MessageList extends Paginated<MessageSummary> {
  canSend: boolean;
}

export interface MessageRecipient {
  /** The student's name — or the partner's, or the trial swimmer's, by `kind`. */
  studentName: string;
  name: string;
  isGuardian: boolean;
  kind: RecipientKind;
  email: string | null;
  deliveredAt: string | null;
}

export interface MessageDetail extends MessageSummary {
  body: string;
  recipients: MessageRecipient[];
  canArchive: boolean;
}

export interface AudienceOption {
  id: string;
  name: string;
  detail: string | null;
}

export interface AudienceOptions {
  classGroups: AudienceOption[];
  levels: AudienceOption[];
  facilities: AudienceOption[];
}

/* ---------------------------------------------------------------------------
 * Qualifications with expiry — POOLSE-27, 7b.2
 * ------------------------------------------------------------------------- */

export type QualificationStanding = 'green' | 'amber' | 'red' | 'missing';

export interface QualificationType {
  id: string;
  name: string;
  defaultValidityMonths: number | null;
  amberDays: number | null;
  requiredToTeach: boolean;
  blocksAssignment: boolean;
}

export interface QualificationTypes {
  types: QualificationType[];
  amberDays: number;
}

export interface Standing {
  typeId: string;
  typeName: string;
  status: QualificationStanding;
  qualificationId: string | null;
  expiresOn: string | null;
  issuingBody: string | null;
}

export interface QualificationRecord {
  id: string;
  typeId: string;
  typeName: string;
  issuingBody: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  archived: boolean;
  createdAt: string;
  /** The scanned certificate, attached once — read at `/files/:id`. */
  documentFileId: string | null;
}

export interface PersonQualifications {
  standings: Standing[];
  history: QualificationRecord[];
  canManage: boolean;
}

export interface ExpiringQualification extends Standing {
  membershipId: string;
  personName: string | null;
  /** The record's certificate, read through `/files/:id`; null for none and for em falta — POOLSE-97. */
  documentFileId: string | null;
  documentName: string | null;
}

export interface QualificationsWidgetData {
  red: number;
  amber: number;
  missing: number;
  top: ExpiringQualification[];
}

/**
 * Bather incidents — POOLSE-70, slice 1. Mirrors `safety/incidents.repository.ts`.
 *
 * The facts are any staff member's; what happened, the injury, the first aid and
 * the words of every addendum are `IncidentDetail`, read by a POST that the API
 * logs, and only for the owner, the admins and the incident's author.
 */
export interface IncidentSummary {
  id: string;
  occurredAt: string;
  /** The tank's or space's name; null when it happened elsewhere on the site. */
  placeName: string | null;
  personName: string;
  personKind: 'student' | 'member' | 'visitor';
  emergencyCalled: boolean;
  lifeguardName: string | null;
  recordedByName: string | null;
  addendaCount: number;
  archived: boolean;
}

export type IncidentList = Paginated<IncidentSummary>;

export interface IncidentFacts extends IncidentSummary {
  facilityId: string;
  facilityName: string;
  poolId: string | null;
  spaceId: string | null;
  lifeguardMembershipId: string | null;
  /**
   * Whether the lifeguard held a valid lifeguard qualification on the incident's
   * day — POOLSE-70 slice 2. Null when nobody was named. False is a warning only.
   */
  lifeguardLicensed: boolean | null;
  policyReference: string | null;
  recordedBy: string;
  createdAt: string;
  /** Who added a correction and when — the words are behind the detail rule. */
  addenda: { id: string; writtenByName: string | null; createdAt: string }[];
  /** The API's answer to the per-row rule, so the screen and the guard agree. */
  canReadDetail: boolean;
  canArchive: boolean;
}

/**
 * The lifeguard roster — POOLSE-70, slice 2. Mirrors `safety/roster.repository.ts`.
 *
 * `licensed` false and every gap are warnings, derived in SQL; neither refuses
 * anything. Several duties on one tank at once are allowed.
 */
export interface LifeguardDuty {
  id: string;
  poolId: string;
  membershipId: string;
  name: string | null;
  startsAt: string;
  endsAt: string;
  /** Held a valid lifeguard qualification on the duty's day. */
  licensed: boolean;
  /** The vigilance period that wrote it; null for a duty added on its own. */
  periodId: string | null;
}

/** A vigilance period — who, which tanks, when, which weekdays, which hours. */
export interface LifeguardPeriod {
  id: string;
  membershipId: string;
  name: string | null;
  startsOn: string;
  endsOn: string;
  /** ISO weekdays, 1 = Monday. */
  weekdays: number[];
  /** Both null: the site's opening hours of each day. */
  from: string | null;
  to: string | null;
  pools: { id: string; name: string }[];
}

/** An open window on a tank with nobody rostered. `day` is `YYYY-MM-DD`; the ends are instants. */
export interface RosterGap {
  poolId: string;
  day: string;
  from: string;
  to: string;
}

export interface LifeguardRoster {
  pools: { id: string; name: string }[];
  duties: LifeguardDuty[];
  gaps: RosterGap[];
  /** Periods still running on or after the first day asked for. */
  periods: LifeguardPeriod[];
  /** Owner and admin — the API's answer, so the buttons and the guard agree. */
  canManage: boolean;
}

/** Who the roster says was on a tank at a moment — the incident form's pre-fill. */
export interface OnDuty {
  onDuty: { membershipId: string; name: string | null; licensed: boolean }[];
}

/** POOLSE-70 slice 3: the insurer's copy. Read under the detail's rule, logged as an export. */
export interface IncidentExport {
  facts: IncidentFacts;
  detail: IncidentDetail;
  /** The recorded lifeguard's lifeguard-type records as they stood on the incident's day. */
  lifeguardQualifications: {
    typeName: string;
    issuingBody: string | null;
    issuedOn: string | null;
    expiresOn: string | null;
    validThatDay: boolean;
  }[];
  exportedAt: string;
}

export interface IncidentDetail {
  whatHappened: string;
  injury: string | null;
  firstAid: string | null;
  addenda: { id: string; body: string; writtenByName: string | null; createdAt: string }[];
}

/**
 * Arquivados — POOLSE-78. One row per archive *action*, so a site archived with
 * its tanks is one entry carrying `children: { pool: 3 }`.
 */
export type ArchiveKind =
  | 'student'
  | 'class_group'
  | 'facility'
  | 'pool'
  | 'space'
  | 'inventory_item'
  | 'maintenance_task'
  | 'partner'
  | 'student_fee'
  | 'swim_meet';

export interface ArchiveEntry {
  /** The audit entry's id — what *Restaurar* sends. */
  id: string;
  kind: ArchiveKind;
  entityId: string;
  name: string;
  /** An enum to translate — a fee line's kind. */
  detail: string | null;
  archivedAt: string;
  actor: { membershipId: string; name: string } | null;
  children: Record<string, number>;
  /** False once the row is live again. */
  archived: boolean;
}

export type ArchiveList = Paginated<ArchiveEntry>;

export interface ArchiveActor {
  membershipId: string;
  name: string;
}

export interface ArchiveRestored {
  kind: ArchiveKind;
  entityId: string;
  name: string;
  children: Record<string, number>;
  kept: number;
}

/**
 * A record's *Atividade* — POOLSE-80. One audit entry, read for one record.
 * A value's `label` is the name behind an id (a level, a tank, a person), so
 * no screen ever shows a uuid; it is null for a value that is not an id.
 */
export interface ActivityValue {
  value: unknown;
  label: string | null;
}

export interface ActivityField {
  field: string;
  before: ActivityValue;
  after: ActivityValue;
  revertible: boolean;
}

export interface ActivityEntry {
  id: string;
  action: string;
  createdAt: string;
  actor: { membershipId: string; name: string } | null;
  fields: ActivityField[];
  /** Fields that moved and whose values the log does not keep. */
  withheld: string[];
  revertOf: string | null;
  session: { id: string; date: string } | null;
  student: { id: string; name: string } | null;
  revertible: boolean;
}

export type ActivityPage = Paginated<ActivityEntry>;

export interface RevertConflict {
  field: string;
  before: ActivityValue;
  after: ActivityValue;
  current: ActivityValue;
}

/** Support access — POOLSE-79. A window the club's Owner opened, asked for, or Poolse forced. */
export type SupportSource = 'owner' | 'request' | 'override';

export interface SupportGrant {
  id: string;
  source: SupportSource;
  reason: string | null;
  startsAt: string;
  expiresAt: string;
  endedAt: string | null;
  /** Derived on the server: expiry is never written. */
  state: 'live' | 'expired' | 'revoked' | 'ended';
  grantedByName: string | null;
  /** An override's notice to the Owners: how many it was owed to, and whether it left. */
  notice: { recipients: number; delivered: boolean } | null;
}

export interface SupportRequest {
  id: string;
  reason: string;
  requestedAt: string;
}

export interface SupportActivity {
  id: string;
  action: string;
  entityType: string;
  at: string;
  byName: string;
}

export interface SupportStatus {
  live: { id: string; expiresAt: string; source: SupportSource } | null;
  pendingRequests: number;
}

export interface OpenSupportGrant {
  grantId: string;
  organizationId: string;
  organizationName: string;
  source: SupportSource;
  expiresAt: string;
}

export interface TenantSupport {
  live: { grantId: string; source: SupportSource; expiresAt: string } | null;
  pendingRequest: { id: string; reason: string; requestedAt: string } | null;
}

/**
 * A public pre-registration — POOLSE-69. `open` leads are `new` or
 * `trial_booked`; the rest have been answered. The swimmer's birth date is a
 * day (`YYYY-MM-DD`), never an instant.
 */
export type LeadStatus = 'new' | 'waitlisted' | 'trial_booked' | 'converted' | 'dismissed';

export interface Lead {
  id: string;
  status: LeadStatus;
  createdAt: string;
  swimmerFirstName: string;
  swimmerLastName: string;
  /** Null only on an app request naming a student the club already has. */
  swimmerBirthDate: string | null;
  swimmerTaxNumber: string | null;
  guardianName: string | null;
  guardianRelationship: string | null;
  guardianTaxNumber: string | null;
  email: string;
  phone: string | null;
  note: string | null;
  locale: string;
  preferredDays: number[];
  facilityId: string | null;
  facilityName: string | null;
  levelId: string | null;
  levelName: string | null;
  consentTextVersion: string;
  consentedAt: string;
  dismissedReason: string | null;
  studentId: string | null;
  trialSessionId: string | null;
  trialStartsAt: string | null;
  trialGroupName: string | null;
  trialTimezone: string | null;
  decidedAt: string | null;
  /** POOLSE-121: the turma asked for from the app. */
  requestedClassGroupId: string | null;
  requestedClassName: string | null;
  requestedClassSlots: { weekday: number; startTime: string }[];
  /** Who asked from the app; null for the public form. */
  requestedByName: string | null;
  /** Names a student the club already has, still open — Inscrever attaches the turma to them. */
  existingStudent: boolean;
  /** Asked for one of the club's students, whatever has happened since — the card's wording. */
  forExistingStudent: boolean;
}

/** Asking to join a class from the app — POOLSE-121. */
export interface AppJoinOptions {
  clubName: string;
  retentionMonths: number;
  people: { id: string; name: string; self: boolean; levelId: string | null }[];
  classes: {
    id: string;
    name: string;
    levelId: string | null;
    levelName: string | null;
    levelOrder: number | null;
    capacity: number | null;
    active: number;
    slots: { weekday: number; startTime: string }[];
    instructorName: string | null;
    facilityName: string;
  }[];
  sent: { id: string; swimmerName: string; className: string | null; createdAt: string; status: LeadStatus }[];
}

export interface Leads {
  leads: Lead[];
  retentionMonths: number;
  /** The last time, within a week, the public form turned people away for being flooded. */
  ceilingReachedAt: string | null;
}

export interface TrialOption {
  sessionId: string;
  startsAt: string;
  timezone: string;
  /** Null when the turma has no recorded capacity — not measured, not zero. */
  freeSeats: number | null;
}

/** The club's public sign-up switch and address — POOLSE-69. */
export interface RegistrationSettings {
  slug: string;
  open: boolean;
}

/** `mgmt.leads` — POOLSE-69: pre-registrations to answer. */
export interface LeadsWidgetData {
  waiting: number;
  trials: number;
  /** Whole days the oldest unanswered request has waited; null with none waiting. */
  oldestWaitingDays: number | null;
}

/** A lab parameter: one of the seven organisms, or a chemistry metric — POOLSE-72. */
export type LabParameter = string;

/** One laboratory report on a tank, graded by the API with `gradeLabResult()`. */
export interface LabResult {
  id: string;
  sampledAt: string;
  laboratory: string | null;
  reportReference: string | null;
  samplePoint: string | null;
  sampleDepth: 'surface' | 'subsurface' | null;
  notes: string | null;
  values: { parameter: LabParameter; value: number; unit: string }[];
  grading: LabGrading;
  /** Null when the report raised no alert. */
  alert: { raisedAt: string; recipients: string[]; deliveredAt: string | null } | null;
}

/* -------------------------------------------------------------------------- */
/* App mode — POOLSE-90                                                         */
/* -------------------------------------------------------------------------- */

/** One child's lesson on the family agenda — a `class_session`, never the pattern. */
export interface AppAgendaEntry {
  studentId: string;
  sessionId: string;
  className: string;
  levelName: string | null;
  siteName: string | null;
  poolId: string | null;
  poolName: string | null;
  lanes: number[];
  /** Where the week lands, on the site's clock. */
  localDate: string;
  localTime: string;
  durationMinutes: number;
  instructorFirstName: string | null;
  standIn: boolean;
  status: 'scheduled' | 'cancelled' | 'completed';
  byClosure: boolean;
  cancellationReason: string | null;
  moved: boolean;
  /** *Vou / Não vou* — POOLSE-90 slice 2: the last answer, or null. */
  going: boolean | null;
  /** This reader answers for this child. */
  mayAnswer: boolean;
  /** Still takes an answer: a turma's, not cancelled, not started. */
  noticeOpen: boolean;
}

/** One answer on a lesson, for its register — POOLSE-90 slice 2. */
export interface SessionNotice {
  studentId: string;
  going: boolean;
  answeredAt: string;
  answeredByName: string | null;
}

/** The maintenance home's to-do — POOLSE-90 slice 3 (`GET /app/maintenance`). */
export interface MaintenanceHome {
  tasks: {
    id: string;
    facilityName: string;
    title: string;
    spaceName: string | null;
    poolName: string | null;
    inventoryItemName: string | null;
    assignedTo: string | null;
    lastDoneAt: string | null;
    daysOverdue: number;
  }[];
  overdueSpaces: { id: string; name: string; facilityName: string; lastCleanedAt: string | null; intervalHours: number }[];
  issues: {
    id: string;
    type: 'fault' | 'restock';
    description: string;
    severity: 'low' | 'normal' | 'high';
    reportedAt: string;
    mine: boolean;
    facilityName: string;
    spaceId: string | null;
    spaceName: string | null;
    poolName: string | null;
  }[];
  spaces: { id: string; name: string; facilityName: string }[];
  pools: { id: string; name: string; facilityName: string }[];
}

/** One lesson on the instructor's home — the dashboard band's own week. */
export interface TeachingLesson {
  sessionId: string;
  classGroupId: string | null;
  partner: boolean;
  className: string;
  poolName: string | null;
  localDate: string;
  localTime: string;
  weekday: number;
  /** Days from the site's today: 0 today, negative past. */
  dayOffset: number;
  durationMinutes: number;
  cancelled: boolean;
  registerTaken: boolean;
  past: boolean;
  /** Enrolled that day; null for a parceria. */
  enrolled: number | null;
  notComing: number;
}

export interface AppWater {
  poolId: string;
  celsius: string;
  /** An instant: the screen says how long ago. */
  takenAt: string;
}

export interface AppChild {
  id: string;
  name: string;
  relationship: string | null;
  self: boolean;
  /** From the fee read's `balance`; null when nothing is agreed. */
  fees: (FeeBalance & { lines: number }) | null;
  /** Where to pay, when something is owed and the club says where — POOLSE-94. */
  payTo: PayTo | null;
}

export interface AppAgenda {
  children: AppChild[];
  entries: AppAgendaEntry[];
  water: AppWater[];
  /** *Últimas aulas* — POOLSE-116. */
  recent: RecentLesson[];
}

export interface AppLesson {
  entries: AppAgendaEntry[];
  water: AppWater[];
  /** Each of the reader's children in this lesson, and where their feedback stands. */
  feedback: FamilyFeedback[];
}

/**
 * A student's feedback after a lesson — POOLSE-116. `authoredBy` is derived
 * from who wrote it; null once anonymised.
 */
export interface LessonFeedback {
  id: string;
  sessionId: string;
  studentId: string;
  studentName: string;
  /** 1 (muito mal) to 5 (muito bem). */
  mood: number;
  comment: string | null;
  authoredBy: 'student' | 'guardian' | null;
  authorName: string | null;
  lessonDate: string;
  className: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FeedbackState = 'open' | 'closed' | 'cancelled' | 'notEnded' | 'notMarked' | 'absent' | 'excused';

export interface FamilyFeedback {
  studentId: string;
  studentName: string;
  state: FeedbackState;
  /** The last day it may be written or changed. */
  closesOn: string;
  mayAnswer: boolean;
  feedback: LessonFeedback | null;
}

export interface RecentLesson {
  studentId: string;
  sessionId: string;
  className: string;
  localDate: string;
  localTime: string;
  mood: number | null;
  open: boolean;
  /** The reader answers for this child; else *Dar feedback* is not offered. */
  mayAnswer: boolean;
}
