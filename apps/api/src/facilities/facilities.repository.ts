import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';

export type PoolKind = 'indoor' | 'outdoor';

export interface Pool {
  id: string;
  facilityId: string;
  name: string;
  kind: PoolKind;
  volumeLitres: number | null;
  laneCount: number | null;
  /** Metres. Decimal, because 12.5 m is an ordinary pool length. */
  lengthM: number | null;
  widthM: number | null;
  maxDepthM: number | null;
}

export interface Photo {
  id: string;
  /** The object key. Turned into a signed URL at render time, never stored as one. */
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

/** One pool, with everything about it — what the detail view is for. */
export interface PoolDetail extends Pool {
  facilityId: string;
  facilityName: string;
  photos: Photo[];
}

/**
 * Ordinary tenant-scoped SQL, all of it. Nothing here needs a `SECURITY DEFINER`
 * function, and that is the point of the shape phase 0 built: once a caller has a
 * membership, every question they can ask is answerable inside `withOrg`, and RLS
 * supplies the `WHERE organization_id` that none of these queries write out.
 */

/** Raised when a name is already taken in the same organization or facility. */
export class DuplicateNameError extends Error {}

function asDuplicate<T>(error: unknown, name: string): T {
  // 23505 is facility_name_uq or pool_name_uq — the partial unique indexes.
  if (error instanceof Error && (error as { code?: string }).code === '23505') {
    throw new DuplicateNameError(name);
  }
  throw error;
}

/**
 * Facilities with their pools, in one round trip.
 *
 * A pool has no meaning apart from the site it is at, and every screen that shows
 * one shows the other. Two queries and a join in JavaScript would be the same
 * data and one more thing to keep in step.
 */
export async function listFacilities(organizationId: string): Promise<Facility[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      name: string;
      address: string | null;
      timezone: string;
      pools: Pool[] | null;
      photos: Photo[] | null;
    }>(`
      SELECT f.id,
             f.name,
             f.address,
             f.timezone,
             (
               SELECT coalesce(
                        json_agg(
                          json_build_object(
                            'id', p.id,
                            'facilityId', p.facility_id,
                            'name', p.name,
                            'kind', p.kind,
                            'volumeLitres', p.volume_litres,
                            'laneCount', p.lane_count,
                            -- numeric comes back as a string from node-pg, which
                            -- refuses to guess at precision. Cast here so the
                            -- JSON carries a number the UI can format.
                            'lengthM', p.length_m::float8,
                            'widthM', p.width_m::float8,
                            'maxDepthM', p.max_depth_m::float8
                          ) ORDER BY p.name
                        ),
                        '[]'::json
                      )
                 FROM pool p
                WHERE p.organization_id = f.organization_id
                  AND p.facility_id = f.id
                  AND p.archived_at IS NULL
             ) AS pools,
             (
               SELECT coalesce(
                        json_agg(
                          json_build_object('id', fp.id, 'storageKey', fp.storage_key,
                                            'caption', fp.caption)
                          ORDER BY fp.sort_order, fp.created_at
                        ),
                        '[]'::json
                      )
                 FROM facility_photo fp
                WHERE fp.organization_id = f.organization_id
                  AND fp.facility_id = f.id
                  AND fp.archived_at IS NULL
             ) AS photos
        FROM facility f
       WHERE f.archived_at IS NULL
       ORDER BY f.name
    `);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      address: row.address,
      timezone: row.timezone,
      pools: row.pools ?? [],
      photos: row.photos ?? [],
    }));
  });
}

/**
 * One pool, everything about it, and its gallery.
 *
 * A separate read from the facilities listing rather than a filter over it: the
 * list is scanned and should stay small, while this is opened deliberately and
 * can afford to carry the photographs and the site it belongs to.
 */
export async function findPool(
  organizationId: string,
  poolId: string,
): Promise<PoolDetail | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      facility_id: string;
      facility_name: string;
      name: string;
      kind: PoolKind;
      volume_litres: number | null;
      lane_count: number | null;
      length_m: number | null;
      width_m: number | null;
      max_depth_m: number | null;
      photos: Photo[] | null;
    }>(
      `
      SELECT p.id,
             p.facility_id,
             f.name AS facility_name,
             p.name,
             p.kind,
             p.volume_litres,
             p.lane_count,
             p.length_m::float8    AS length_m,
             p.width_m::float8     AS width_m,
             p.max_depth_m::float8 AS max_depth_m,
             (
               SELECT coalesce(
                        json_agg(
                          json_build_object('id', pp.id, 'storageKey', pp.storage_key,
                                            'caption', pp.caption)
                          ORDER BY pp.sort_order, pp.created_at
                        ),
                        '[]'::json
                      )
                 FROM pool_photo pp
                WHERE pp.organization_id = p.organization_id
                  AND pp.pool_id = p.id
                  AND pp.archived_at IS NULL
             ) AS photos
        FROM pool p
        JOIN facility f
          ON f.id = p.facility_id AND f.organization_id = p.organization_id
       WHERE p.id = $1 AND p.archived_at IS NULL
      `,
      [poolId],
    );

    const row = rows[0];
    // Also the answer for another tenant's pool id: RLS hid it, and the caller
    // learns nothing either way.
    if (!row) return null;

    return {
      id: row.id,
      facilityId: row.facility_id,
      facilityName: row.facility_name,
      name: row.name,
      kind: row.kind,
      volumeLitres: row.volume_litres,
      laneCount: row.lane_count,
      lengthM: row.length_m,
      widthM: row.width_m,
      maxDepthM: row.max_depth_m,
      photos: row.photos ?? [],
    };
  });
}

export interface CreateFacilityInput {
  organizationId: string;
  name: string;
  address: string | null;
  timezone: string;
}

export async function createFacility(input: CreateFacilityInput): Promise<string> {
  try {
    return await withOrg(input.organizationId, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO facility (organization_id, name, address, timezone)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [input.organizationId, input.name, input.address, input.timezone],
      );

      const id = rows[0]?.id;
      if (!id) throw new Error('Could not create the facility');

      await recordAudit(tx, {
        action: 'facility.created',
        entityType: 'facility',
        entityId: id,
        data: { name: input.name, timezone: input.timezone },
      });

      return id;
    });
  } catch (error) {
    return asDuplicate(error, input.name);
  }
}

export interface CreatePoolInput {
  organizationId: string;
  facilityId: string;
  name: string;
  kind: PoolKind;
  volumeLitres: number | null;
  laneCount: number | null;
  lengthM: number | null;
  widthM: number | null;
  maxDepthM: number | null;
}

/**
 * Returns null when the facility does not exist in this organization.
 *
 * Two things could produce that: a stale page, or somebody sending another
 * tenant's facility id. RLS makes them indistinguishable from here — the SELECT
 * simply finds nothing — which is the correct amount of information to give back.
 */
export async function createPool(input: CreatePoolInput): Promise<string | null> {
  try {
    return await withOrg(input.organizationId, async (tx) => {
      const facility = await tx.query<{ id: string }>(
        `SELECT id FROM facility WHERE id = $1 AND archived_at IS NULL`,
        [input.facilityId],
      );
      if (!facility.rows[0]) return null;

      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO pool (
           organization_id, facility_id, name, kind, volume_litres, lane_count,
           length_m, width_m, max_depth_m
         )
         VALUES ($1, $2, $3, $4::pool_kind, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          input.organizationId,
          input.facilityId,
          input.name,
          input.kind,
          input.volumeLitres,
          input.laneCount,
          input.lengthM,
          input.widthM,
          input.maxDepthM,
        ],
      );

      const id = rows[0]?.id;
      if (!id) throw new Error('Could not create the pool');

      await recordAudit(tx, {
        action: 'pool.created',
        entityType: 'pool',
        entityId: id,
        data: {
          name: input.name,
          kind: input.kind,
          facilityId: input.facilityId,
          dimensions: { lengthM: input.lengthM, widthM: input.widthM, maxDepthM: input.maxDepthM },
        },
      });

      return id;
    });
  } catch (error) {
    return asDuplicate(error, input.name);
  }
}

export interface UpdatePoolInput {
  name: string;
  kind: PoolKind;
  volumeLitres: number | null;
  laneCount: number | null;
  lengthM: number | null;
  widthM: number | null;
  maxDepthM: number | null;
}

/**
 * Edit a pool.
 *
 * Every field is sent every time, including the empty ones, because clearing a
 * measurement is a real thing an operator does — they guessed the depth, then
 * measured it and found they were wrong. A partial-update shape could not
 * express "I no longer know this".
 *
 * The facility is deliberately not editable here. Moving a pool between sites
 * would orphan every class group scheduled in it, and that is a migration of
 * data rather than an edit of a row.
 */
export async function updatePool(
  organizationId: string,
  poolId: string,
  input: UpdatePoolInput,
): Promise<boolean> {
  try {
    return await withOrg(organizationId, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `UPDATE pool
            SET name = $2, kind = $3::pool_kind, volume_litres = $4, lane_count = $5,
                length_m = $6, width_m = $7, max_depth_m = $8
          WHERE id = $1 AND archived_at IS NULL
        RETURNING id`,
        [
          poolId,
          input.name,
          input.kind,
          input.volumeLitres,
          input.laneCount,
          input.lengthM,
          input.widthM,
          input.maxDepthM,
        ],
      );
      if (!rows[0]) return false;

      await recordAudit(tx, {
        action: 'pool.updated',
        entityType: 'pool',
        entityId: poolId,
        data: { name: input.name, kind: input.kind },
      });

      return true;
    });
  } catch (error) {
    return asDuplicate(error, input.name);
  }
}

/**
 * Archive rather than delete, both here and for pools.
 *
 * A facility will shortly have class sessions, attendance and invoices pointing
 * at it, and none of that history should disappear because a site closed. The
 * partial unique indexes are what make this safe to undo: archiving "Piscina
 * Norte" leaves the name free to use again.
 */
export async function archiveFacility(
  organizationId: string,
  facilityId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string; name: string }>(
      `UPDATE facility SET archived_at = now()
        WHERE id = $1 AND archived_at IS NULL
      RETURNING id, name`,
      [facilityId],
    );

    const facility = rows[0];
    if (!facility) return false;

    // The pools go with it. Leaving them live would leave a pool with no site,
    // which every later screen would have to special-case.
    await tx.query(
      `UPDATE pool SET archived_at = now()
        WHERE facility_id = $1 AND archived_at IS NULL`,
      [facilityId],
    );

    await recordAudit(tx, {
      action: 'facility.archived',
      entityType: 'facility',
      entityId: facilityId,
      data: { name: facility.name },
    });

    return true;
  });
}

export async function archivePool(organizationId: string, poolId: string): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string; name: string }>(
      `UPDATE pool SET archived_at = now()
        WHERE id = $1 AND archived_at IS NULL
      RETURNING id, name`,
      [poolId],
    );

    const pool = rows[0];
    if (!pool) return false;

    await recordAudit(tx, {
      action: 'pool.archived',
      entityType: 'pool',
      entityId: poolId,
      data: { name: pool.name },
    });

    return true;
  });
}
