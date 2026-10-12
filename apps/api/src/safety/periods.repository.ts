import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { personName } from '../people/names.js';
import { NotStaffError, PoolOffSiteError } from './roster.repository.js';

/**
 * Vigilance periods — 12 October 2026.
 *
 * "Ana watches the main pool and the learner pool, Mondays, Wednesdays and
 * Fridays, 1 October to 30 June, during opening hours" is one form. Saving it
 * writes one `lifeguard_duty` per covered day per tank, tagged `period_id`, so
 * every reader of the roster is unchanged and a single day stays a single row
 * to remove.
 *
 * **Which days are covered** is decided once, in the INSERT below: inside the
 * dates, on a chosen weekday, a day the site opens (`facility_hours`), and not a
 * day a closure covers — the same `closure_covers` rule the gaps and the
 * lessons use, so a feriado is neither a duty nor a gap.
 *
 * **A day the person is already on that tank is left as it is and counted**
 * (`clashes`), never a refusal of the whole period — the same choice a series
 * move makes about one occupied November Wednesday.
 */

export interface LifeguardPeriod {
  id: string;
  membershipId: string;
  name: string | null;
  startsOn: string;
  endsOn: string;
  weekdays: number[];
  /** Null for both: the site's opening hours. */
  from: string | null;
  to: string | null;
  /** The tanks its live duties are on. */
  pools: { id: string; name: string }[];
}

export interface PeriodInput {
  membershipId: string;
  poolIds: string[];
  startsOn: string;
  endsOn: string;
  weekdays: number[];
  /** Both null: opening hours. */
  from: string | null;
  to: string | null;
}

/** The end date is before today — the past is the record, not something to undo. */
export class EndInPastError extends Error {}

export async function addPeriod(
  organizationId: string,
  facilityId: string,
  input: PeriodInput,
): Promise<{ id: string; written: number; clashes: number } | null> {
  return withOrg(organizationId, async (tx) => {
    const site = await tx.query(`SELECT 1 FROM facility WHERE id = $1 AND archived_at IS NULL`, [facilityId]);
    if (site.rowCount === 0) return null;

    const { rows: pools } = await tx.query<{ id: string }>(
      `SELECT id FROM pool WHERE facility_id = $1 AND archived_at IS NULL AND id = ANY($2::uuid[])`,
      [facilityId, input.poolIds],
    );
    if (pools.length !== new Set(input.poolIds).size) throw new PoolOffSiteError();

    const { rows: staff } = await tx.query(
      `SELECT 1 FROM membership m
        WHERE m.id = $1 AND m.archived_at IS NULL
          AND EXISTS (SELECT 1 FROM membership_role r
                       WHERE r.membership_id = m.id AND r.archived_at IS NULL
                         AND r.role IN ('owner', 'admin', 'instructor', 'maintenance'))`,
      [input.membershipId],
    );
    if (staff.length === 0) throw new NotStaffError();

    const me = currentTenant().membershipId;
    const { rows: made } = await tx.query<{ id: string }>(
      `INSERT INTO lifeguard_period (organization_id, facility_id, membership_id, starts_on, ends_on,
                                     weekdays, from_time, to_time, created_by)
       VALUES ($1, $2, $3, $4::date, $5::date, $6::smallint[], $7::time, $8::time, $9)
       RETURNING id`,
      [
        organizationId,
        facilityId,
        input.membershipId,
        input.startsOn,
        input.endsOn,
        input.weekdays,
        input.from,
        input.to,
        me,
      ],
    );
    const periodId = made[0]!.id;

    /*
     * Every covered day × tank, as a window in the site's own time zone. With
     * typed hours a `to` before `from` ends the next day, as a single duty does.
     * ON CONFLICT DO NOTHING lets the no-double exclusion skip a day the person
     * already holds rather than fail the period; planned − written is the count.
     */
    const { rows: counts } = await tx.query<{ planned: number; written: number }>(
      `WITH p AS (
         SELECT * FROM lifeguard_period WHERE id = $1
       ),
       days AS (
         SELECT d::date AS day
           FROM p, generate_series(p.starts_on, p.ends_on, interval '1 day') AS d
          WHERE extract(ISODOW FROM d)::smallint = ANY (p.weekdays)
       ),
       planned AS (
         SELECT pool.id AS pool_id,
                CASE WHEN p.from_time IS NULL
                     THEN (days.day + h.opens_at) AT TIME ZONE f.timezone
                     ELSE (days.day + p.from_time) AT TIME ZONE f.timezone END AS starts_at,
                CASE WHEN p.from_time IS NULL
                     THEN (days.day + h.closes_at) AT TIME ZONE f.timezone
                     WHEN p.to_time > p.from_time
                     THEN (days.day + p.to_time) AT TIME ZONE f.timezone
                     ELSE (days.day + 1 + p.to_time) AT TIME ZONE f.timezone END AS ends_at
           FROM p
           JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
           CROSS JOIN days
           JOIN pool ON pool.facility_id = f.id AND pool.organization_id = f.organization_id
                    AND pool.id = ANY ($2::uuid[])
           JOIN facility_hours h
             ON h.facility_id = f.id AND h.organization_id = f.organization_id
            AND h.weekday = extract(ISODOW FROM days.day)
            AND h.available
            AND h.opens_at IS NOT NULL AND h.closes_at IS NOT NULL
            AND h.closes_at > h.opens_at
          WHERE NOT EXISTS (
                  SELECT 1 FROM closure c
                   WHERE c.organization_id = p.organization_id
                     AND c.archived_at IS NULL
                     AND c.blocks_generation
                     AND (c.pool_id IS NULL OR c.pool_id = pool.id)
                     AND closure_covers(c.starts_on, c.ends_on, c.repeats_annually, days.day))
       ),
       written AS (
         INSERT INTO lifeguard_duty (organization_id, pool_id, membership_id, starts_at, ends_at,
                                     created_by, period_id)
         SELECT $3, planned.pool_id, $4, planned.starts_at, planned.ends_at, $5, $1
           FROM planned
         ON CONFLICT DO NOTHING
         RETURNING 1
       )
       SELECT (SELECT count(*) FROM planned)::int AS planned,
              (SELECT count(*) FROM written)::int AS written`,
      [periodId, input.poolIds, organizationId, input.membershipId, me],
    );
    const { planned, written } = counts[0]!;

    await recordAudit(tx, {
      action: 'lifeguard_period.added',
      entityType: 'lifeguard_period',
      entityId: periodId,
      data: {
        membershipId: input.membershipId,
        poolIds: input.poolIds,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        written,
      },
    });
    return { id: periodId, written, clashes: planned - written };
  });
}

/**
 * Ends a period from a day on: its duties on that day and after are archived,
 * and the period now ends the day before — or is archived whole when it had
 * not started. Days before stay as the record of who was on duty. Never in the
 * past: `from` must be the club's today or later.
 */
export async function endPeriod(
  organizationId: string,
  periodId: string,
  from: string,
): Promise<{ removed: number } | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows: period } = await tx.query<{ starts_on: string; today: string }>(
      `SELECT starts_on::text AS starts_on, club_today()::text AS today
         FROM lifeguard_period WHERE id = $1 AND archived_at IS NULL`,
      [periodId],
    );
    if (period[0] === undefined) return null;
    if (from < period[0].today) throw new EndInPastError();

    const { rowCount } = await tx.query(
      `UPDATE lifeguard_duty l SET archived_at = now()
         FROM pool p, facility f
        WHERE l.period_id = $1 AND l.archived_at IS NULL
          AND p.id = l.pool_id AND p.organization_id = l.organization_id
          AND f.id = p.facility_id AND f.organization_id = p.organization_id
          AND (l.starts_at AT TIME ZONE f.timezone)::date >= $2::date`,
      [periodId, from],
    );

    await tx.query(
      `UPDATE lifeguard_period
          SET ends_on = CASE WHEN $2::date > starts_on THEN least(ends_on, $2::date - 1) ELSE ends_on END,
              archived_at = CASE WHEN $2::date <= starts_on THEN now() ELSE NULL END
        WHERE id = $1`,
      [periodId, from],
    );

    await recordAudit(tx, {
      action: 'lifeguard_period.ended',
      entityType: 'lifeguard_period',
      entityId: periodId,
      data: { from, removed: rowCount ?? 0 },
    });
    return { removed: rowCount ?? 0 };
  });
}

/** A site's periods still running on or after `from` — the roster's list. */
export async function listPeriods(
  organizationId: string,
  facilityId: string,
  from: string,
): Promise<LifeguardPeriod[]> {
  const rows = await withOrg(organizationId, async (tx) => (await tx.query<{
    id: string;
    membership_id: string;
    name: string | null;
    starts_on: string;
    ends_on: string;
    weekdays: number[];
    from_time: string | null;
    to_time: string | null;
    pools: { id: string; name: string }[] | null;
  }>(
    `SELECT lp.id, lp.membership_id, ${personName('lp.membership_id')} AS name,
            lp.starts_on::text AS starts_on, lp.ends_on::text AS ends_on,
            lp.weekdays::int[] AS weekdays,
            to_char(lp.from_time, 'HH24:MI') AS from_time,
            to_char(lp.to_time, 'HH24:MI') AS to_time,
            (SELECT json_agg(json_build_object('id', p.id, 'name', p.name) ORDER BY lower(p.name))
               FROM pool p
              WHERE p.organization_id = lp.organization_id
                AND EXISTS (SELECT 1 FROM lifeguard_duty l
                             WHERE l.period_id = lp.id AND l.organization_id = lp.organization_id
                               AND l.pool_id = p.id AND l.archived_at IS NULL)) AS pools
       FROM lifeguard_period lp
      WHERE lp.facility_id = $1 AND lp.archived_at IS NULL AND lp.ends_on >= $2::date
      ORDER BY lp.starts_on, lp.id`,
    [facilityId, from],
  )).rows);
  return rows.map((row) => ({
    id: row.id,
    membershipId: row.membership_id,
    name: row.name,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    weekdays: row.weekdays,
    from: row.from_time,
    to: row.to_time,
    pools: row.pools ?? [],
  }));
}
