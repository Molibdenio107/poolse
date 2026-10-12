import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { personName } from '../people/names.js';

/**
 * The lifeguard on duty — POOLSE-70, slice 2.
 *
 * Who is on which tank, when, and the two warnings: a rostered person with no
 * valid lifeguard qualification that day (`lifeguard_valid_on`) and an open
 * window with nobody (`lifeguard_gaps`). Both are SQL, read here and never
 * recomputed; neither refuses anything (CLAUDE.md: a warning about a person
 * never gates what a club does with them).
 *
 * **Anyone on the staff can be rostered** (Rui, 12 October 2026): owner, admin,
 * instructor or maintenance — a teacher can be the lifeguard too.
 */

export interface LifeguardDuty {
  id: string;
  poolId: string;
  membershipId: string;
  name: string | null;
  startsAt: string;
  endsAt: string;
  /** Held a valid lifeguard qualification on the duty's day. False is a warning. */
  licensed: boolean;
}

export interface RosterGap {
  poolId: string;
  day: string;
  from: string;
  to: string;
}

export interface Roster {
  pools: { id: string; name: string }[];
  duties: LifeguardDuty[];
  gaps: RosterGap[];
}

export interface DutyInput {
  poolId: string;
  membershipId: string;
  /** The site's own day and wall times. */
  day: string;
  from: string;
  to: string;
}

/** The person is not on the staff. */
export class NotStaffError extends Error {}
/** The same person is already on this tank at an overlapping time. */
export class DoubleDutyError extends Error {}
/** The tank is not at this site. */
export class PoolOffSiteError extends Error {}

/**
 * A site's roster over a run of days — a week on the screen. Bounded by the
 * window it asks for, so not paged (CONVENTIONS: a fixed window).
 */
export async function readRoster(
  organizationId: string,
  facilityId: string,
  from: string,
  days: number,
): Promise<Roster | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows: site } = await tx.query<{ timezone: string }>(
      `SELECT timezone FROM facility WHERE id = $1 AND archived_at IS NULL`,
      [facilityId],
    );
    if (site[0] === undefined) return null;

    const { rows: pools } = await tx.query<{ id: string; name: string }>(
      `SELECT id, name FROM pool
        WHERE facility_id = $1 AND archived_at IS NULL
        ORDER BY lower(name), id`,
      [facilityId],
    );

    const { rows: duties } = await tx.query<{
      id: string;
      pool_id: string;
      membership_id: string;
      name: string | null;
      starts_at: Date;
      ends_at: Date;
      licensed: boolean;
    }>(
      `SELECT l.id, l.pool_id, l.membership_id, ${personName('l.membership_id')} AS name,
              l.starts_at, l.ends_at,
              lifeguard_valid_on(l.organization_id, l.membership_id,
                                 (l.starts_at AT TIME ZONE f.timezone)::date) AS licensed
         FROM lifeguard_duty l
         JOIN pool p ON p.id = l.pool_id AND p.organization_id = l.organization_id
         JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
        WHERE p.facility_id = $1
          AND l.archived_at IS NULL
          AND l.starts_at < (($2::date + $3::int) AT TIME ZONE f.timezone)
          AND l.ends_at > ($2::date AT TIME ZONE f.timezone)
        ORDER BY l.starts_at, l.id`,
      [facilityId, from, days],
    );

    const { rows: gaps } = await tx.query<{
      pool_id: string;
      day: string;
      gap_from: Date;
      gap_to: Date;
    }>(
      `SELECT pool_id, to_char(day, 'YYYY-MM-DD') AS day, gap_from, gap_to
         FROM lifeguard_gaps($1, $2, $3::date, $4)`,
      [organizationId, facilityId, from, days],
    );

    return {
      pools,
      duties: duties.map((row) => ({
        id: row.id,
        poolId: row.pool_id,
        membershipId: row.membership_id,
        name: row.name,
        startsAt: row.starts_at.toISOString(),
        endsAt: row.ends_at.toISOString(),
        licensed: row.licensed,
      })),
      gaps: gaps.map((row) => ({
        poolId: row.pool_id,
        day: row.day,
        from: row.gap_from.toISOString(),
        to: row.gap_to.toISOString(),
      })),
    };
  });
}

export async function addDuty(
  organizationId: string,
  facilityId: string,
  input: DutyInput,
): Promise<string | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows: pool } = await tx.query<{ timezone: string }>(
      `SELECT f.timezone
         FROM pool p JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
        WHERE p.id = $1 AND p.facility_id = $2 AND p.archived_at IS NULL`,
      [input.poolId, facilityId],
    );
    if (pool[0] === undefined) throw new PoolOffSiteError();

    const { rows: staff } = await tx.query(
      `SELECT 1 FROM membership m
        WHERE m.id = $1 AND m.archived_at IS NULL
          AND EXISTS (SELECT 1 FROM membership_role r
                       WHERE r.membership_id = m.id AND r.archived_at IS NULL
                         AND r.role IN ('owner', 'admin', 'instructor', 'maintenance'))`,
      [input.membershipId],
    );
    if (staff.length === 0) throw new NotStaffError();

    let id: string;
    try {
      // A duty past midnight ends the next day: `to` before `from` rolls over.
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO lifeguard_duty (organization_id, pool_id, membership_id, starts_at, ends_at,
                                     created_by)
         VALUES ($1, $2, $3,
                 ($4::date + $5::time) AT TIME ZONE $7,
                 (CASE WHEN $6::time > $5::time THEN $4::date ELSE $4::date + 1 END + $6::time)
                   AT TIME ZONE $7,
                 $8)
         RETURNING id`,
        [
          organizationId,
          input.poolId,
          input.membershipId,
          input.day,
          input.from,
          input.to,
          pool[0].timezone,
          currentTenant().membershipId,
        ],
      );
      id = rows[0]!.id;
    } catch (error) {
      if ((error as { code?: string }).code === '23P01') throw new DoubleDutyError();
      throw error;
    }

    await recordAudit(tx, {
      action: 'lifeguard_duty.added',
      entityType: 'lifeguard_duty',
      entityId: id,
      data: { poolId: input.poolId, membershipId: input.membershipId, day: input.day },
    });
    return id;
  });
}

/** Off the roster — archived, so who was on duty last Saturday stays answerable. */
export async function removeDuty(organizationId: string, dutyId: string): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE lifeguard_duty SET archived_at = now() WHERE id = $1 AND archived_at IS NULL`,
      [dutyId],
    );
    if ((rowCount ?? 0) === 0) return false;
    await recordAudit(tx, {
      action: 'lifeguard_duty.removed',
      entityType: 'lifeguard_duty',
      entityId: dutyId,
      data: {},
    });
    return true;
  });
}

/**
 * Who was on duty on a tank at a moment — the incident form's pre-fill. The
 * moment is the site's wall time, as the form sends it.
 */
export async function onDuty(
  organizationId: string,
  poolId: string,
  at: string,
): Promise<{ membershipId: string; name: string | null; licensed: boolean }[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      membership_id: string;
      name: string | null;
      licensed: boolean;
    }>(
      `SELECT l.membership_id, ${personName('l.membership_id')} AS name,
              lifeguard_valid_on(l.organization_id, l.membership_id, $2::timestamp::date) AS licensed
         FROM lifeguard_duty l
         JOIN pool p ON p.id = l.pool_id AND p.organization_id = l.organization_id
         JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
        WHERE l.pool_id = $1 AND l.archived_at IS NULL
          AND tstzrange(l.starts_at, l.ends_at) @> ($2::timestamp AT TIME ZONE f.timezone)
        ORDER BY l.starts_at, l.id`,
      [poolId, at],
    );
    return rows.map((row) => ({
      membershipId: row.membership_id,
      name: row.name,
      licensed: row.licensed,
    }));
  });
}
