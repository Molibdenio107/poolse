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

/** Where a site is, once somebody has picked it off the geocoder. */
export interface Place {
  city: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * How many people, by group — backlog round 3, story 2.
 *
 * Organization-wide, not per site, and that is a limit of the model rather than
 * a choice: a student belongs to the organization and an instructor's membership
 * does too. Neither carries a facility. Deriving "students taught at this site"
 * through enrollment → class_group → pool → facility is possible and is a
 * different, larger question; until somebody asks it, the honest thing is to
 * count what the schema actually knows and label it as the organization's.
 *
 * `owner` is here although story 2 lists five groups. Without it the one person
 * who runs the club is counted nowhere, and a tally that quietly omits somebody
 * is worse than a sixth row.
 */
export interface PeopleCounts {
  student: number;
  owner: number;
  admin: number;
  instructor: number;
  maintenance: number;
  guardian: number;
}

export interface FacilityDetail extends Facility, Place {}

/**
 * Ordinary tenant-scoped SQL, all of it. Nothing here needs a `SECURITY DEFINER`
 * function, and that is the point of the shape phase 0 built: once a caller has a
 * membership, every question they can ask is answerable inside `withOrg`, and RLS
 * supplies the `WHERE organization_id` that none of these queries write out.
 */

/** Raised when a name is already taken in the same organization or facility. */
export class DuplicateNameError extends Error {}

function asDuplicate<T>(error: unknown, name: string): T {
  // 23505 is facility_name_uq, pool_name_uq or pool_material_name_uq — the
  // partial unique indexes.
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

/**
 * One site, with its place and its gallery.
 *
 * A separate read from the listing for the same reason `findPool` is: the list
 * is scanned and stays lean, while this is opened deliberately.
 */
export async function findFacility(
  organizationId: string,
  facilityId: string,
): Promise<FacilityDetail | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      name: string;
      address: string | null;
      timezone: string;
      city: string | null;
      country_code: string | null;
      latitude: number | null;
      longitude: number | null;
      pools: Pool[] | null;
      photos: Photo[] | null;
    }>(
      `
      SELECT f.id,
             f.name,
             f.address,
             f.timezone,
             f.city,
             f.country_code,
             -- numeric comes back as a string from node-pg, which refuses to
             -- guess at precision. Cast so the JSON carries a number; six
             -- decimal places survive float8 exactly.
             f.latitude::float8  AS latitude,
             f.longitude::float8 AS longitude,
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
       WHERE f.id = $1 AND f.archived_at IS NULL
      `,
      [facilityId],
    );

    const row = rows[0];
    // Also the answer for another tenant's facility id: RLS hid it, and the
    // caller learns nothing either way.
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      address: row.address,
      timezone: row.timezone,
      city: row.city,
      countryCode: row.country_code,
      latitude: row.latitude,
      longitude: row.longitude,
      pools: row.pools ?? [],
      photos: row.photos ?? [],
    };
  });
}

/**
 * Every group counted in one statement — story 2 asks for this explicitly, and
 * it is right to.
 *
 * One query per role is five round trips that become eleven the day guardians
 * get sub-groups, and each one re-reads the same two tables. A UNION of two
 * sources grouped once stays one round trip at five students and at five
 * hundred.
 *
 * A person holding two roles is counted under both, which matches how the People
 * list is specified to show them. Archived memberships and archived roles are
 * excluded, and so is anybody still `invited` — they have not joined yet, and a
 * headcount that includes people who never accepted is a headcount nobody can
 * reconcile against the room.
 */
export async function countPeople(organizationId: string): Promise<PeopleCounts> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ kind: string; total: number }>(`
      SELECT kind, count(*)::int AS total
        FROM (
               SELECT 'student'::text AS kind
                 FROM student
                WHERE archived_at IS NULL

               UNION ALL

               SELECT mr.role::text
                 FROM membership_role mr
                 JOIN membership m
                   ON m.id = mr.membership_id
                  AND m.organization_id = mr.organization_id
                WHERE mr.archived_at IS NULL
                  AND m.archived_at IS NULL
                  AND m.status = 'active'
             ) counted
       GROUP BY kind
    `);

    // Seeded at zero, because a group with nobody in it returns no row at all
    // and story 2 asks for "0" rather than a gap. An absent row and a zero mean
    // the same thing to the database and very different things to a reader.
    const counts: PeopleCounts = {
      student: 0,
      owner: 0,
      admin: 0,
      instructor: 0,
      maintenance: 0,
      guardian: 0,
    };

    for (const row of rows) {
      if (row.kind in counts) counts[row.kind as keyof PeopleCounts] = row.total;
    }

    return counts;
  });
}

export interface UpdateFacilityInput {
  name?: string;
  address?: string | null;
  city?: string | null;
  countryCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * Changes a site's details, including where it is.
 *
 * The coordinates arrive together or not at all — the database enforces that
 * with `facility_coordinates_complete`, and this passes them through as a pair
 * so a caller cannot write half a location by omitting one field.
 */
export async function updateFacility(
  organizationId: string,
  facilityId: string,
  input: UpdateFacilityInput,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `
      UPDATE facility
         SET name         = coalesce($2, name),
             address      = CASE WHEN $3::boolean THEN $4 ELSE address END,
             city         = CASE WHEN $5::boolean THEN $6 ELSE city END,
             country_code = CASE WHEN $5::boolean THEN $7 ELSE country_code END,
             latitude     = CASE WHEN $5::boolean THEN $8::numeric ELSE latitude END,
             longitude    = CASE WHEN $5::boolean THEN $9::numeric ELSE longitude END,
             updated_at   = now()
       WHERE id = $1 AND archived_at IS NULL
      RETURNING id
      `,
      [
        facilityId,
        input.name ?? null,
        input.address !== undefined,
        input.address ?? null,
        input.city !== undefined,
        input.city,
        input.countryCode,
        input.latitude,
        input.longitude,
      ],
    );
    if (!rows[0]) return false;

    await recordAudit(tx, {
      action: 'facility.updated',
      entityType: 'facility',
      entityId: facilityId,
      data: { fields: Object.keys(input) },
    });
    return true;
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

// ---------------------------------------------------------------------------
// Opening hours — round 4
//
// A site's standing weekly rules: which days classes may be scheduled on, and
// between what times. The database holds seven rows per facility, always, and
// enforces the rule on `class_schedule` with a trigger — so nothing here has to
// default a missing day, and nothing here is what actually protects the rule.
// See `packages/db/migrations/1787929200000_facility-hours.sql`.
// ---------------------------------------------------------------------------

export interface FacilityDay {
  /** ISO weekday: Monday 1 … Sunday 7, matching `class_schedule.weekday`. */
  weekday: number;
  available: boolean;
  /** `HH:MM`. `24:00` is a real time here and means "to the end of the day". */
  opensAt: string;
  closesAt: string;
  /**
   * How many turma slots already sit on this weekday at this site.
   *
   * Sent so the interface can say "3 turmas already use Sunday" *before*
   * somebody switches it off, which is the whole reason the decision was "block
   * new, keep existing": a warning after the fact is a warning about something
   * that already happened.
   */
  scheduledClasses: number;
}

/** `HH:MM` from Postgres's `HH:MM:SS`, which no interface wants to render. */
function hhmm(value: string): string {
  return value.slice(0, 5);
}

export async function facilityHours(
  organizationId: string,
  facilityId: string,
): Promise<FacilityDay[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      weekday: number;
      available: boolean;
      opens_at: string;
      closes_at: string;
      scheduled_classes: number;
    }>(
      `
      SELECT h.weekday,
             h.available,
             h.opens_at::text  AS opens_at,
             h.closes_at::text AS closes_at,
             (
               SELECT count(*)::int
                 FROM class_schedule cs
                 JOIN class_group g
                   ON g.id = cs.class_group_id
                  AND g.organization_id = cs.organization_id
                 JOIN pool p
                   ON p.id = g.pool_id
                  AND p.organization_id = g.organization_id
                WHERE cs.organization_id = h.organization_id
                  AND cs.weekday = h.weekday
                  AND cs.archived_at IS NULL
                  AND g.archived_at IS NULL
                  AND p.archived_at IS NULL
                  AND p.facility_id = h.facility_id
             ) AS scheduled_classes
        FROM facility_hours h
       WHERE h.facility_id = $1
       ORDER BY h.weekday
      `,
      [facilityId],
    );

    return rows.map((row) => ({
      weekday: row.weekday,
      available: row.available,
      opensAt: hhmm(row.opens_at),
      closesAt: hhmm(row.closes_at),
      scheduledClasses: row.scheduled_classes,
    }));
  });
}

export interface FacilityDayInput {
  weekday: number;
  available: boolean;
  opensAt: string;
  closesAt: string;
}

/**
 * Writes all seven days at once.
 *
 * A whole-week save rather than a per-day PATCH, because that is the shape of
 * the decision somebody is making — "these are our hours" — and because a
 * partial save of a weekly grid leaves a screen showing a week that was never
 * true. It also means the audit entry is one legible before-and-after instead of
 * up to seven.
 *
 * The rows already exist (the facility trigger seeds them), so this is an UPDATE
 * per day and never an upsert: a weekday that is missing here is a bug, not a
 * new row to invent.
 */
export async function setFacilityHours(
  organizationId: string,
  facilityId: string,
  days: readonly FacilityDayInput[],
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const exists = await tx.query(
      `SELECT 1 FROM facility WHERE id = $1 AND archived_at IS NULL`,
      [facilityId],
    );
    if (exists.rowCount === 0) return false;

    for (const day of days) {
      await tx.query(
        `UPDATE facility_hours
            SET available = $3, opens_at = $4::time, closes_at = $5::time
          WHERE facility_id = $1 AND weekday = $2`,
        [facilityId, day.weekday, day.available, day.opensAt, day.closesAt],
      );
    }

    /*
     * The whole week, not the fields that changed.
     *
     * "Sunday was switched off" is only intelligible in a year beside the six
     * days that were not — the interesting question about this entry will be
     * "what were the hours then", and a diff cannot answer it.
     */
    await recordAudit(tx, {
      action: 'facility.hours.updated',
      entityType: 'facility',
      entityId: facilityId,
      data: {
        days: days.map((day) => ({
          weekday: day.weekday,
          available: day.available,
          opensAt: day.opensAt,
          closesAt: day.closesAt,
        })),
      },
    });

    return true;
  });
}

// ---------------------------------------------------------------------------
// Pool inventory — round 4
//
// One row per kind of item with a count on it, not a stock ledger. The name is
// free text because every club calls these things something slightly different,
// and a fixed vocabulary means the first operator who wants "arcos" writes them
// into a notes field instead. See the migration for the rest of the reasoning.
// ---------------------------------------------------------------------------

export interface PoolMaterial {
  id: string;
  name: string;
  quantity: number;
  unit: string | null;
  notes: string | null;
}

export async function listPoolMaterials(
  organizationId: string,
  poolId: string,
): Promise<PoolMaterial[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<PoolMaterial>(
      `
      SELECT id, name, quantity, unit, notes
        FROM pool_material
       WHERE pool_id = $1
         AND archived_at IS NULL
       ORDER BY lower(strip_accents(name))
      `,
      [poolId],
    );
    return rows;
  });
}

export interface PoolMaterialInput {
  name: string;
  quantity: number;
  unit: string | null;
  notes: string | null;
}

/**
 * Adds an item to a pool's inventory.
 *
 * Throws `DuplicateNameError` on a second row for the same pile of things, which
 * the unique index decides accent- and case-insensitively rather than this
 * function — "Flutuadores" and "flutuádores" are one pile, and the database is
 * the only place that can say so without a race.
 */
export async function addPoolMaterial(
  organizationId: string,
  poolId: string,
  input: PoolMaterialInput,
): Promise<string | null> {
  return withOrg(organizationId, async (tx) => {
    const pool = await tx.query(
      `SELECT 1 FROM pool WHERE id = $1 AND archived_at IS NULL`,
      [poolId],
    );
    if (pool.rowCount === 0) return null;

    try {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO pool_material (organization_id, pool_id, name, quantity, unit, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [organizationId, poolId, input.name, input.quantity, input.unit, input.notes],
      );

      const id = rows[0]!.id;

      await recordAudit(tx, {
        action: 'pool.material.added',
        entityType: 'pool',
        entityId: poolId,
        data: { name: input.name, quantity: input.quantity },
      });

      return id;
    } catch (error) {
      return asDuplicate<string>(error, input.name);
    }
  });
}

/**
 * Corrects an item, most often its count after a stock check.
 *
 * The count is the whole point of the row, and correcting it is the operation
 * this table exists to support — which is why it is an ordinary update rather
 * than a movement posted against a running total. A total nobody posts against
 * drifts within a month and then lies with more precision than a count does.
 */
export async function updatePoolMaterial(
  organizationId: string,
  materialId: string,
  input: PoolMaterialInput,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    try {
      const { rowCount } = await tx.query(
        `UPDATE pool_material
            SET name = $2, quantity = $3, unit = $4, notes = $5
          WHERE id = $1 AND archived_at IS NULL`,
        [materialId, input.name, input.quantity, input.unit, input.notes],
      );
      if (rowCount === 0) return false;
    } catch (error) {
      return asDuplicate<boolean>(error, input.name);
    }

    await recordAudit(tx, {
      action: 'pool.material.updated',
      entityType: 'pool_material',
      entityId: materialId,
      data: { name: input.name, quantity: input.quantity },
    });

    return true;
  });
}

/** Archived, never deleted — the club had these once, and that is history. */
export async function archivePoolMaterial(
  organizationId: string,
  materialId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE pool_material SET archived_at = now()
        WHERE id = $1 AND archived_at IS NULL`,
      [materialId],
    );
    if (rowCount === 0) return false;

    await recordAudit(tx, {
      action: 'pool.material.archived',
      entityType: 'pool_material',
      entityId: materialId,
    });

    return true;
  });
}
