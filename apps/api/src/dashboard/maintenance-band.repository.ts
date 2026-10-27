import { withOrg } from '@poolse/db';
import { OVERDUE, SPACE_JOINS } from '../spaces/spaces.repository.js';
import type { Severity } from './management.repository.js';

/**
 * The maintenance band's reads — POOLSE-66, slice 4.
 *
 * **Every site the reader works at, never the selector.** Maintenance holds no
 * site assignment in this schema, so their sites are the club's — and the
 * operational band ignores the management selector (AC 10), so an owner who
 * also fixes the showers is not shown one site's avarias because they were
 * looking at one site's money. The caller passes `ownFacilityIds`.
 *
 * **One statement per card**, each a count plus the first few rows, so a card
 * can say "3 of 11" without a second round trip. The rules are borrowed, not
 * rewritten: overdue is `OVERDUE` from `spaces.repository.ts`, the same text
 * the Espaços screen and the owner's card evaluate.
 *
 * No money anywhere in here.
 */

/** How many rows a card lists before its link takes over. */
const SHOWN = 5;

/**
 * The app's maintenance home (POOLSE-90 slice 3) reads the same statements
 * whole: `limit: null` lists every row, and `restock` adds the reposições a
 * to-do list needs and the band leaves to the inventory card.
 */
export interface BandReadOptions {
  limit?: number | null;
  restock?: boolean;
}

const limitOf = (options: BandReadOptions): string =>
  options.limit === null ? 'ALL' : String(Math.max(0, Math.trunc(options.limit ?? SHOWN)));

export interface OpenFault {
  id: string;
  /** `fault` (avaria) or `restock` (reposição) — the band reads faults only. */
  type: 'fault' | 'restock';
  description: string;
  severity: Severity;
  reportedAt: string;
  /** Reported by the reader — "mine" in a schema with no assignee. */
  mine: boolean;
  facilityId: string;
  facilityName: string;
  spaceId: string | null;
  spaceName: string | null;
  poolId: string | null;
  poolName: string | null;
}

export interface OpenFaults {
  total: number;
  high: number;
  faults: OpenFault[];
}

/**
 * Open avarias at the reader's sites, worst first, oldest first within that.
 *
 * Avarias only: an open *reposição* is the store room's business and lives on
 * the inventory card, so nothing on the band is listed twice. There is no
 * assignee in this schema (decided 10-10-2026: all open, mine marked), so "mine"
 * is the reporter — useful to the person who raised it, harmless to everyone
 * else.
 */
export async function readOpenFaults(
  organizationId: string,
  membershipId: string,
  facilityIds: readonly string[],
  options: BandReadOptions = {},
): Promise<OpenFaults> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      total: number;
      high: number;
      faults: {
        id: string;
        type: 'fault' | 'restock';
        description: string;
        severity: Severity;
        reported_at: string;
        mine: boolean;
        facility_id: string;
        facility_name: string;
        space_id: string | null;
        space_name: string | null;
        pool_id: string | null;
        pool_name: string | null;
      }[];
    }>(
      `WITH open AS (
         SELECT mr.id, mr.type::text AS type, mr.description, mr.severity, mr.reported_at,
                (mr.reported_by = $2) AS mine,
                f.id AS facility_id, f.name AS facility_name,
                s.id AS space_id, s.name AS space_name,
                p.id AS pool_id, p.name AS pool_name
           FROM maintenance_request mr
           JOIN facility f
             ON f.id = mr.facility_id AND f.organization_id = mr.organization_id
           LEFT JOIN space s
                  ON s.id = mr.space_id AND s.organization_id = mr.organization_id
           LEFT JOIN pool p
                  ON p.id = mr.pool_id AND p.organization_id = mr.organization_id
          WHERE mr.status = 'open'
            AND (mr.type = 'fault' OR ($3::boolean AND mr.type = 'restock'))
            AND mr.archived_at IS NULL
            AND mr.facility_id = ANY($1::uuid[])
       )
       SELECT (SELECT count(*) FROM open)::int                          AS total,
              (SELECT count(*) FROM open WHERE severity = 'high')::int  AS high,
              coalesce((
                SELECT json_agg(row_to_json(t))
                  FROM (SELECT * FROM open
                         ORDER BY severity DESC, reported_at, id
                         LIMIT ${limitOf(options)}) t
              ), '[]'::json)                                            AS faults`,
      [facilityIds, membershipId, options.restock === true],
    );

    const row = rows[0]!;
    return {
      total: row.total,
      high: row.high,
      faults: row.faults.map((f) => ({
        id: f.id,
        type: f.type,
        description: f.description,
        severity: f.severity,
        // json_agg renders a timestamptz as text; normalise it to ISO.
        reportedAt: new Date(f.reported_at).toISOString(),
        mine: f.mine,
        facilityId: f.facility_id,
        facilityName: f.facility_name,
        spaceId: f.space_id,
        spaceName: f.space_name,
        poolId: f.pool_id,
        poolName: f.pool_name,
      })),
    };
  });
}

export interface OverdueSpace {
  id: string;
  facilityId: string;
  name: string;
  /** Null: never cleaned — which is overdue once an interval is set. */
  lastCleanedAt: string | null;
  intervalHours: number;
}

export interface OverdueSpaces {
  total: number;
  spaces: OverdueSpace[];
}

/**
 * Espaços past their cleaning interval — `OVERDUE`, read exactly as the Espaços
 * screen reads it: out of service is never overdue, no interval is never
 * overdue, never cleaned is. The longest-neglected first, never-cleaned on top.
 */
export async function readOverdueSpaces(
  organizationId: string,
  facilityIds: readonly string[],
  options: BandReadOptions = {},
): Promise<OverdueSpaces> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      total: number;
      spaces: {
        id: string;
        facility_id: string;
        name: string;
        last_cleaned_at: string | null;
        interval_hours: number;
      }[];
    }>(
      `WITH overdue AS (
         SELECT s.id, s.facility_id, s.name, c.last_cleaned_at,
                s.expected_cleaning_interval_hours AS interval_hours
           FROM space s
           ${SPACE_JOINS}
          WHERE s.archived_at IS NULL
            AND s.facility_id = ANY($1::uuid[])
            AND (${OVERDUE})
       )
       SELECT (SELECT count(*) FROM overdue)::int AS total,
              coalesce((
                SELECT json_agg(row_to_json(t))
                  FROM (SELECT * FROM overdue
                         ORDER BY last_cleaned_at NULLS FIRST, name, id
                         LIMIT ${limitOf(options)}) t
              ), '[]'::json) AS spaces`,
      [facilityIds],
    );

    const row = rows[0]!;
    return {
      total: row.total,
      spaces: row.spaces.map((s) => ({
        id: s.id,
        facilityId: s.facility_id,
        name: s.name,
        lastCleanedAt: s.last_cleaned_at === null ? null : new Date(s.last_cleaned_at).toISOString(),
        intervalHours: s.interval_hours,
      })),
    };
  });
}

/** How far back "newly found" reaches on the lost-property list. */
export const LOST_FOUND_RECENT_DAYS = 7;

export interface InventoryWatch {
  restockTotal: number;
  restocks: {
    id: string;
    description: string;
    severity: Severity;
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

/**
 * Open reposições, and lost property found this week and not yet returned.
 *
 * Two lists, one statement. A reposição is a `maintenance_request` of type
 * `restock` — the store room's "we are out of chlorine tablets" — whether or
 * not it names an item. Lost property counts only what is still `found`: a
 * returned towel is a closed matter, and an old one is the inventory screen's
 * list, not today's news.
 */
export async function readInventoryWatch(
  organizationId: string,
  facilityIds: readonly string[],
): Promise<InventoryWatch> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      restock_total: number;
      restocks: InventoryWatch['restocks'];
      lost_total: number;
      lost: InventoryWatch['lost'];
    }>(
      `WITH restock AS (
         SELECT mr.id, mr.description, mr.severity, i.name AS "itemName",
                mr.facility_id AS "facilityId", mr.reported_at
           FROM maintenance_request mr
           LEFT JOIN inventory_item i
                  ON i.id = mr.inventory_item_id AND i.organization_id = mr.organization_id
          WHERE mr.status = 'open'
            AND mr.type = 'restock'
            AND mr.archived_at IS NULL
            AND mr.facility_id = ANY($1::uuid[])
       ),
       lost AS (
         SELECT l.id, l.description, l.found_on::text AS "foundOn",
                l.location_found AS "locationFound", l.facility_id AS "facilityId"
           FROM lost_and_found_item l
          WHERE l.status = 'found'
            AND l.archived_at IS NULL
            AND l.facility_id = ANY($1::uuid[])
            AND l.found_on >= club_today() - ${LOST_FOUND_RECENT_DAYS}
       )
       SELECT (SELECT count(*) FROM restock)::int AS restock_total,
              coalesce((SELECT json_agg(json_build_object(
                                 'id', t.id, 'description', t.description,
                                 'severity', t.severity, 'itemName', t."itemName",
                                 'facilityId', t."facilityId"))
                          FROM (SELECT * FROM restock
                                 ORDER BY severity DESC, reported_at, id
                                 LIMIT ${SHOWN}) t), '[]'::json) AS restocks,
              (SELECT count(*) FROM lost)::int AS lost_total,
              coalesce((SELECT json_agg(row_to_json(t))
                          FROM (SELECT * FROM lost
                                 ORDER BY "foundOn" DESC, id
                                 LIMIT ${SHOWN}) t), '[]'::json) AS lost`,
      [facilityIds],
    );

    const row = rows[0]!;
    return {
      restockTotal: row.restock_total,
      restocks: row.restocks,
      lostTotal: row.lost_total,
      lost: row.lost,
    };
  });
}
