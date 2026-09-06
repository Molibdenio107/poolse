import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import {
  windowed,
  TOTAL_COUNT,
  type PageQuery,
  type Paginated,
} from '../common/pagination.js';

/**
 * Espaços, cleanings and issues — round 6.
 *
 * Ordinary tenant-scoped SQL: nothing writes `where organization_id`, because
 * RLS supplies it. What the queries do write is `facility_id`, which is the
 * boundary this feature cares about — two sites in one club do not share a
 * balneário.
 *
 * **Overdue is computed here, in SQL, and once.** There is no `is_overdue`
 * column and nothing keeps one up to date; a stored flag would need a cron job
 * or a worker, and per-tenant running cost is a design constraint on this
 * project. It is also computed *only* here — the API ships a boolean and the
 * interface renders it. Two implementations of one rule agree until the day they
 * do not, and this particular rule is the whole point of the feature.
 */

export const SPACE_TYPES = [
  'changing_room',
  'technical',
  'storage',
  'reception',
  'outdoor',
  'other',
] as const;

export type SpaceType = (typeof SPACE_TYPES)[number];

export const REQUEST_TYPES = ['fault', 'restock'] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

export function isSpaceType(value: string): value is SpaceType {
  return (SPACE_TYPES as readonly string[]).includes(value);
}

export function isRequestType(value: string): value is RequestType {
  return (REQUEST_TYPES as readonly string[]).includes(value);
}

/** Raised when a name is already taken at the same facility. */
export class DuplicateNameError extends Error {}

function asDuplicate<T>(error: unknown, name: string): T {
  // 23505 is `space_name_uq`, the partial, accent-insensitive unique index.
  if (error instanceof Error && (error as { code?: string }).code === '23505') {
    throw new DuplicateNameError(name);
  }
  throw error;
}

export interface SpaceSummary {
  id: string;
  facilityId: string;
  name: string;
  type: SpaceType;
  description: string | null;
  /** False means out of service — still listed, still openable, never overdue. */
  active: boolean;
  /** Null means no schedule, and therefore never overdue. Never read as zero. */
  intervalHours: number | null;
  /** Null when it has never been cleaned, which is a state the list renders. */
  lastCleanedAt: string | null;
  overdue: boolean;
  openIssues: number;
}

export interface SpaceInput {
  name: string;
  type: SpaceType;
  description: string | null;
  active: boolean;
  intervalHours: number | null;
}

export interface Cleaning {
  id: string;
  performedAt: string;
  /** Null when the membership has no name anywhere — a pending invitation. */
  performedBy: string | null;
  note: string | null;
}

export interface Issue {
  id: string;
  type: RequestType;
  description: string;
  reportedAt: string;
  reportedBy: string | null;
  status: 'open' | 'resolved';
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
}

export interface SpaceDetail {
  space: SpaceSummary;
  cleanings: Paginated<Cleaning>;
  issues: Issue[];
}

/*
 * The name of whoever did something, from Clerk's cache with the membership as
 * the fallback.
 *
 * `display_name(m.first_name, m.last_name)` alone is null for anybody who signs
 * in: their membership carries no name of its own because Clerk owns it and
 * `app_user` holds the cache — CLAUDE.md, decision 2. The lesson-plan reader
 * learned this the hard way and reported that nobody had written the plan the
 * person had just saved.
 */
const ACTOR_NAME = (alias: string, user: string) =>
  `nullif(btrim(concat_ws(' ',
     coalesce(${user}.cached_first_name, ${alias}.first_name),
     coalesce(${user}.cached_last_name,  ${alias}.last_name))), '')`;

/*
 * The overdue rule, in one place.
 *
 * Read the branches in order, because the order is the rule:
 *   - out of service  → never overdue. Nobody cleans a room that is shut, and a
 *     warning about it is a warning an operator learns to ignore.
 *   - no interval     → never overdue. Null is "not measured", exactly as a null
 *     tank ceiling is, and it enforces nothing.
 *   - never cleaned   → overdue. A balneário with a schedule and no history is
 *     the most overdue thing on the site; treating an absence as "fine" would
 *     hide precisely the spaces this feature exists to surface.
 *   - otherwise       → time since the last cleaning against the interval.
 */
const OVERDUE = `
  CASE
    WHEN NOT s.active THEN false
    WHEN s.expected_cleaning_interval_hours IS NULL THEN false
    WHEN c.last_cleaned_at IS NULL THEN true
    ELSE now() - c.last_cleaned_at
         > make_interval(hours => s.expected_cleaning_interval_hours)
  END`;

/*
 * The last cleaning and the open-issue count, as lateral joins.
 *
 * `archived_at IS NULL` on the cleaning is not an optimisation, it is the rule:
 * an archived log did not happen. Delete a cleaning logged against the wrong
 * room and the space goes straight back to overdue, which is the only honest
 * answer — the alternative leaves a room looking clean because somebody
 * corrected a mistake.
 */
const SPACE_JOINS = `
  LEFT JOIN LATERAL (
    SELECT max(cl.performed_at) AS last_cleaned_at
      FROM cleaning_log cl
     WHERE cl.space_id = s.id AND cl.archived_at IS NULL
  ) c ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS open_count
      FROM maintenance_request mr
     WHERE mr.space_id = s.id AND mr.status = 'open' AND mr.archived_at IS NULL
  ) r ON true`;

interface CleaningRow {
  total_count: number;
  id: string;
  performed_at: Date;
  performed_by: string | null;
  note: string | null;
}

interface SpaceRow {
  id: string;
  facility_id: string;
  name: string;
  type: SpaceType;
  description: string | null;
  active: boolean;
  expected_cleaning_interval_hours: number | null;
  last_cleaned_at: Date | null;
  overdue: boolean;
  open_count: number;
}

function toSummary(row: SpaceRow): SpaceSummary {
  return {
    id: row.id,
    facilityId: row.facility_id,
    name: row.name,
    type: row.type,
    description: row.description,
    active: row.active,
    intervalHours: row.expected_cleaning_interval_hours,
    lastCleanedAt: row.last_cleaned_at?.toISOString() ?? null,
    overdue: row.overdue,
    openIssues: row.open_count,
  };
}

const SPACE_COLUMNS = `
  s.id, s.facility_id, s.name, s.type, s.description, s.active,
  s.expected_cleaning_interval_hours,
  c.last_cleaned_at,
  coalesce(r.open_count, 0) AS open_count,
  ${OVERDUE} AS overdue`;

/**
 * The spaces at one site.
 *
 * Out-of-service ones sort last but are not hidden: a balneário closed for works
 * is a fact about the site somebody may need to see, and hiding it would make an
 * operator create a second one.
 */
export async function listSpaces(
  organizationId: string,
  facilityId: string,
): Promise<SpaceSummary[] | null> {
  return withOrg(organizationId, async (tx) => {
    const facility = await tx.query(
      `SELECT 1 FROM facility WHERE id = $1 AND archived_at IS NULL`,
      [facilityId],
    );
    if (facility.rowCount === 0) return null;

    const { rows } = await tx.query<SpaceRow>(
      `SELECT ${SPACE_COLUMNS}
         FROM space s
         ${SPACE_JOINS}
        WHERE s.facility_id = $1 AND s.archived_at IS NULL
        ORDER BY s.active DESC, lower(strip_accents(s.name))`,
      [facilityId],
    );
    return rows.map(toSummary);
  });
}

/** One space, its cleaning history and its issues. */
export async function getSpace(
  organizationId: string,
  spaceId: string,
  page: PageQuery,
): Promise<SpaceDetail | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<SpaceRow>(
      `SELECT ${SPACE_COLUMNS}
         FROM space s
         ${SPACE_JOINS}
        WHERE s.id = $1 AND s.archived_at IS NULL`,
      [spaceId],
    );
    const space = rows[0];
    if (space === undefined) return null;

    const cleanings = await windowed<CleaningRow, Cleaning>(
      page,
      (limit, offset) =>
        tx.query<CleaningRow>(
          `SELECT ${TOTAL_COUNT},
                  cl.id, cl.performed_at, cl.note,
                  ${ACTOR_NAME('m', 'u')} AS performed_by
             FROM cleaning_log cl
             LEFT JOIN membership m ON m.id = cl.performed_by
             LEFT JOIN app_user  u ON u.id = m.app_user_id
            WHERE cl.space_id = $1 AND cl.archived_at IS NULL
            ORDER BY cl.performed_at DESC, cl.id DESC
            LIMIT $2 OFFSET $3`,
          [spaceId, limit, offset],
        ),
      (row) => ({
        id: row.id,
        performedAt: row.performed_at.toISOString(),
        performedBy: row.performed_by,
        note: row.note,
      }),
    );

    /*
     * Open first, then resolved, each newest first.
     *
     * Not paginated, unlike the cleaning history: a space with more open issues
     * than fit on a screen is a space in trouble, and hiding the tail behind a
     * pager would be the wrong kindness. The history grows forever and genuinely
     * needs pages.
     */
    const issues = await tx.query<{
      id: string;
      type: RequestType;
      description: string;
      reported_at: Date;
      reported_by: string | null;
      status: 'open' | 'resolved';
      resolved_at: Date | null;
      resolved_by: string | null;
      resolution_note: string | null;
    }>(
      `SELECT mr.id, mr.type, mr.description, mr.reported_at, mr.status,
              mr.resolved_at, mr.resolution_note,
              ${ACTOR_NAME('rep', 'ru')} AS reported_by,
              ${ACTOR_NAME('res', 'su')} AS resolved_by
         FROM maintenance_request mr
         LEFT JOIN membership rep ON rep.id = mr.reported_by
         LEFT JOIN app_user  ru  ON ru.id  = rep.app_user_id
         LEFT JOIN membership res ON res.id = mr.resolved_by
         LEFT JOIN app_user  su  ON su.id  = res.app_user_id
        WHERE mr.space_id = $1 AND mr.archived_at IS NULL
        ORDER BY (mr.status = 'open') DESC, mr.reported_at DESC`,
      [spaceId],
    );

    return {
      space: toSummary(space),
      cleanings,
      issues: issues.rows.map((row) => ({
        id: row.id,
        type: row.type,
        description: row.description,
        reportedAt: row.reported_at.toISOString(),
        reportedBy: row.reported_by,
        status: row.status,
        resolvedAt: row.resolved_at?.toISOString() ?? null,
        resolvedBy: row.resolved_by,
        resolutionNote: row.resolution_note,
      })),
    };
  });
}

export async function addSpace(
  organizationId: string,
  facilityId: string,
  input: SpaceInput,
): Promise<string | null> {
  return withOrg(organizationId, async (tx) => {
    const facility = await tx.query(
      `SELECT 1 FROM facility WHERE id = $1 AND archived_at IS NULL`,
      [facilityId],
    );
    if (facility.rowCount === 0) return null;

    let id: string;
    try {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO space
           (organization_id, facility_id, name, type, description, active,
            expected_cleaning_interval_hours)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          organizationId,
          facilityId,
          input.name,
          input.type,
          input.description,
          input.active,
          input.intervalHours,
        ],
      );
      id = rows[0]!.id;
    } catch (error) {
      return asDuplicate(error, input.name);
    }

    await recordAudit(tx, {
      action: 'space.added',
      entityType: 'space',
      entityId: id,
      data: { facilityId, name: input.name, type: input.type },
    });

    return id;
  });
}

export async function updateSpace(
  organizationId: string,
  spaceId: string,
  input: SpaceInput,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    let facilityId: string;
    try {
      const { rows } = await tx.query<{ facility_id: string }>(
        `UPDATE space
            SET name = $2, type = $3, description = $4, active = $5,
                expected_cleaning_interval_hours = $6
          WHERE id = $1 AND archived_at IS NULL
        RETURNING facility_id`,
        [
          spaceId,
          input.name,
          input.type,
          input.description,
          input.active,
          input.intervalHours,
        ],
      );
      if (rows.length === 0) return false;
      facilityId = rows[0]!.facility_id;
    } catch (error) {
      return asDuplicate(error, input.name);
    }

    await recordAudit(tx, {
      action: 'space.updated',
      entityType: 'space',
      entityId: spaceId,
      data: { facilityId, name: input.name },
    });
    return true;
  });
}

/** Soft delete. History is archived, never destroyed. */
export async function archiveSpace(
  organizationId: string,
  spaceId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ facility_id: string; name: string }>(
      `UPDATE space SET archived_at = now()
        WHERE id = $1 AND archived_at IS NULL
      RETURNING facility_id, name`,
      [spaceId],
    );
    if (rows.length === 0) return false;

    await recordAudit(tx, {
      action: 'space.archived',
      entityType: 'space',
      entityId: spaceId,
      data: { facilityId: rows[0]!.facility_id, name: rows[0]!.name },
    });
    return true;
  });
}

/**
 * One tap: the server supplies who and when.
 *
 * Neither is taken from the request. A cleaning log is a claim about who did
 * something, and a client that could name somebody else — or backdate the
 * claim — would make the record worth less than the paper sheet it replaces.
 */
export async function logCleaning(
  organizationId: string,
  spaceId: string,
  membershipId: string,
  note: string | null,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const space = await tx.query<{ facility_id: string }>(
      `SELECT facility_id FROM space WHERE id = $1 AND archived_at IS NULL`,
      [spaceId],
    );
    if (space.rowCount === 0) return false;

    await tx.query(
      `INSERT INTO cleaning_log (organization_id, space_id, performed_by, note)
       VALUES ($1, $2, $3, $4)`,
      [organizationId, spaceId, membershipId, note],
    );

    await recordAudit(tx, {
      action: 'space.cleaned',
      entityType: 'space',
      entityId: spaceId,
      data: { facilityId: space.rows[0]!.facility_id },
    });
    return true;
  });
}

/**
 * A cleaning entered by mistake.
 *
 * Archived, never edited — an entry is a claim about a moment, and rewriting one
 * is rewriting what somebody said they did. Archiving is the honest correction,
 * and it puts the space back to overdue if that entry was the only one.
 */
export async function archiveCleaning(
  organizationId: string,
  spaceId: string,
  cleaningId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE cleaning_log SET archived_at = now()
        WHERE id = $1 AND space_id = $2 AND archived_at IS NULL
      RETURNING id`,
      [cleaningId, spaceId],
    );
    if (rows.length === 0) return false;

    await recordAudit(tx, {
      action: 'space.cleaning.archived',
      entityType: 'space',
      entityId: spaceId,
      data: { cleaningId },
    });
    return true;
  });
}

export async function reportIssue(
  organizationId: string,
  spaceId: string,
  membershipId: string,
  type: RequestType,
  description: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const space = await tx.query<{ facility_id: string }>(
      `SELECT facility_id FROM space WHERE id = $1 AND archived_at IS NULL`,
      [spaceId],
    );
    if (space.rowCount === 0) return false;

    /*
     * `facility_id` comes from the space rather than from the caller, which is
     * what makes the composite key meaningful: a request cannot be filed at one
     * site naming a room at another, because nobody gets to state both.
     */
    await tx.query(
      `INSERT INTO maintenance_request
         (organization_id, facility_id, space_id, type, description, reported_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [organizationId, space.rows[0]!.facility_id, spaceId, type, description, membershipId],
    );

    await recordAudit(tx, {
      action: 'space.issue.reported',
      entityType: 'space',
      entityId: spaceId,
      data: { facilityId: space.rows[0]!.facility_id, type },
    });
    return true;
  });
}

/** Distinguishes "no such issue" from "already resolved", so the API can say which. */
export type ResolveResult = 'resolved' | 'missing' | 'already';

export async function resolveIssue(
  organizationId: string,
  spaceId: string,
  requestId: string,
  membershipId: string,
  note: string | null,
): Promise<ResolveResult> {
  return withOrg(organizationId, async (tx) => {
    const existing = await tx.query<{ status: 'open' | 'resolved' }>(
      `SELECT status FROM maintenance_request
        WHERE id = $1 AND space_id = $2 AND archived_at IS NULL`,
      [requestId, spaceId],
    );
    if (existing.rowCount === 0) return 'missing';
    // Re-stamping a resolved issue would quietly rewrite who fixed it and when.
    if (existing.rows[0]!.status === 'resolved') return 'already';

    await tx.query(
      `UPDATE maintenance_request
          SET status = 'resolved', resolved_by = $3, resolved_at = now(),
              resolution_note = $4
        WHERE id = $1 AND space_id = $2`,
      [requestId, spaceId, membershipId, note],
    );

    await recordAudit(tx, {
      action: 'space.issue.resolved',
      entityType: 'space',
      entityId: spaceId,
      data: { requestId },
    });
    return 'resolved';
  });
}

export async function archiveIssue(
  organizationId: string,
  spaceId: string,
  requestId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE maintenance_request SET archived_at = now()
        WHERE id = $1 AND space_id = $2 AND archived_at IS NULL
      RETURNING id`,
      [requestId, spaceId],
    );
    if (rows.length === 0) return false;

    await recordAudit(tx, {
      action: 'space.issue.archived',
      entityType: 'space',
      entityId: spaceId,
      data: { requestId },
    });
    return true;
  });
}
