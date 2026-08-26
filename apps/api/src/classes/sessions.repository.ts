import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { holidaysBetween } from './holidays.js';

export interface Closure {
  id: string;
  facilityId: string | null;
  poolId: string | null;
  poolName: string | null;
  startsOn: string;
  endsOn: string;
  reason: string;
  blocksGeneration: boolean;
  repeatsAnnually: boolean;
  source: 'manual' | 'national_holiday';
}

export interface Session {
  id: string;
  classGroupId: string;
  className: string;
  levelName: string | null;
  poolName: string | null;
  lane: number | null;
  instructorName: string | null;
  substituteName: string | null;
  /** ISO instant. The facility's local date and time are derived below. */
  startsAt: string;
  /** Local calendar date at the facility, YYYY-MM-DD. */
  localDate: string;
  /** Local wall-clock, HH:MM. */
  localTime: string;
  weekday: number;
  durationMinutes: number;
  status: 'scheduled' | 'cancelled' | 'completed';
  cancellationReason: string | null;
  /** True when a closure cancelled it, rather than a person. */
  byClosure: boolean;
  enrolled: number;
}

// ---------------------------------------------------------------------------
// Closures
// ---------------------------------------------------------------------------

export async function listClosures(organizationId: string): Promise<Closure[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      facility_id: string | null;
      pool_id: string | null;
      pool_name: string | null;
      starts_on: Date;
      ends_on: Date;
      reason: string;
      blocks_generation: boolean;
      repeats_annually: boolean;
      source: 'manual' | 'national_holiday';
    }>(`
      SELECT c.id, c.facility_id, c.pool_id, p.name AS pool_name,
             c.starts_on, c.ends_on, c.reason,
             c.blocks_generation, c.repeats_annually, c.source
        FROM closure c
        LEFT JOIN pool p ON p.id = c.pool_id AND p.organization_id = c.organization_id
       WHERE c.archived_at IS NULL
       ORDER BY c.starts_on, c.reason
    `);

    return rows.map((row) => ({
      id: row.id,
      facilityId: row.facility_id,
      poolId: row.pool_id,
      poolName: row.pool_name,
      startsOn: isoDate(row.starts_on),
      endsOn: isoDate(row.ends_on),
      reason: row.reason,
      blocksGeneration: row.blocks_generation,
      repeatsAnnually: row.repeats_annually,
      source: row.source,
    }));
  });
}

export interface ClosureInput {
  startsOn: string;
  endsOn: string;
  reason: string;
  poolId: string | null;
  blocksGeneration: boolean;
  repeatsAnnually: boolean;
}

export async function createClosure(
  organizationId: string,
  input: ClosureInput,
): Promise<string> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO closure (
         organization_id, pool_id, starts_on, ends_on, reason,
         blocks_generation, repeats_annually, source
       ) VALUES ($1, $2, $3::date, $4::date, $5, $6, $7, 'manual')
       RETURNING id`,
      [
        organizationId,
        input.poolId,
        input.startsOn,
        input.endsOn,
        input.reason,
        input.blocksGeneration,
        input.repeatsAnnually,
      ],
    );

    const id = rows[0]?.id;
    if (!id) throw new Error('Could not create the closure');

    await recordAudit(tx, {
      action: 'closure.created',
      entityType: 'closure',
      entityId: id,
      data: { reason: input.reason, startsOn: input.startsOn, endsOn: input.endsOn },
    });

    return id;
  });
}

export async function archiveClosure(
  organizationId: string,
  closureId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string; reason: string }>(
      `UPDATE closure SET archived_at = now()
        WHERE id = $1 AND archived_at IS NULL
      RETURNING id, reason`,
      [closureId],
    );
    if (!rows[0]) return false;

    await recordAudit(tx, {
      action: 'closure.removed',
      entityType: 'closure',
      entityId: closureId,
      data: { reason: rows[0].reason },
    });
    return true;
  });
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export interface GenerationResult {
  holidaysAdded: number;
  created: number;
  cancelled: number;
  restored: number;
}

/**
 * Builds a season: national holidays first, then the sessions around them.
 *
 * The order is the whole point of doing both in one call. Seeding the holidays
 * after generating would mean creating a class on Christmas Day and cancelling
 * it a moment later — which works, but leaves the calendar full of cancelled
 * rows nobody asked for and makes "was this ever going to run?" unanswerable.
 *
 * Everything here is idempotent, so running it twice on the same window is
 * harmless and running it every time a schedule changes is the intended use.
 */
export async function generateSeason(
  organizationId: string,
  from: string,
  to: string,
): Promise<GenerationResult> {
  return withOrg(organizationId, async (tx) => {
    // The operator chose to have Poolse close on national holidays without
    // asking. Each one is still a visible, deletable closure — a pool that opens
    // on the 5th of October needs to be able to see what removed the class.
    const holidays = holidaysBetween(from, to);
    let holidaysAdded = 0;

    for (const holiday of holidays) {
      const inserted = await tx.query(
        `INSERT INTO closure (
           organization_id, starts_on, ends_on, reason, source, repeats_annually
         ) VALUES ($1, $2::date, $2::date, $3, 'national_holiday', false)
         ON CONFLICT (organization_id, starts_on)
           WHERE source = 'national_holiday' AND archived_at IS NULL
           DO NOTHING`,
        [organizationId, holiday.date, holiday.name],
      );
      holidaysAdded += inserted.rowCount ?? 0;
    }

    const { rows } = await tx.query<{
      o_created: number;
      o_cancelled: number;
      o_restored: number;
    }>('SELECT * FROM generate_sessions($1, $2::date, $3::date)', [organizationId, from, to]);

    const result = rows[0];
    if (!result) throw new Error('generate_sessions returned nothing');

    await recordAudit(tx, {
      action: 'sessions.generated',
      entityType: 'organization',
      entityId: organizationId,
      data: { from, to, ...result, holidaysAdded },
    });

    return {
      holidaysAdded,
      created: result.o_created,
      cancelled: result.o_cancelled,
      restored: result.o_restored,
    };
  });
}

// ---------------------------------------------------------------------------
// Reading the calendar
// ---------------------------------------------------------------------------

const SESSION_COLUMNS = `
  cs.id,
  cs.class_group_id,
  cg.name AS class_name,
  l.name  AS level_name,
  p.name  AS pool_name,
  cs.lane,
  nullif(btrim(coalesce(iu.cached_first_name, '') || ' ' ||
               coalesce(iu.cached_last_name, '')), '')  AS instructor_name,
  nullif(btrim(coalesce(su.cached_first_name, '') || ' ' ||
               coalesce(su.cached_last_name, '')), '')  AS substitute_name,
  cs.starts_at,
  -- Rendered in the facility's own zone, because that is the time somebody
  -- turns up at. A UTC instant on screen would be an hour wrong all summer.
  to_char(cs.starts_at AT TIME ZONE coalesce(f.timezone, 'Europe/Lisbon'), 'YYYY-MM-DD') AS local_date,
  to_char(cs.starts_at AT TIME ZONE coalesce(f.timezone, 'Europe/Lisbon'), 'HH24:MI')    AS local_time,
  extract(ISODOW FROM cs.starts_at AT TIME ZONE coalesce(f.timezone, 'Europe/Lisbon'))::int AS weekday,
  cs.duration_minutes,
  cs.status,
  cs.cancellation_reason,
  cs.closure_id IS NOT NULL AS by_closure,
  (
    SELECT count(*) FROM enrollment e
     WHERE e.organization_id = cs.organization_id
       AND e.class_group_id = cs.class_group_id
       AND e.status = 'active'
  )::int AS enrolled
`;

const SESSION_JOINS = `
  FROM class_session cs
  JOIN class_group cg ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
  LEFT JOIN student_level l ON l.id = cg.level_id AND l.organization_id = cg.organization_id
  LEFT JOIN pool p     ON p.id = cs.pool_id AND p.organization_id = cs.organization_id
  LEFT JOIN facility f ON f.id = p.facility_id AND f.organization_id = cs.organization_id
  LEFT JOIN membership im ON im.id = cg.instructor_membership_id
                         AND im.organization_id = cg.organization_id
  LEFT JOIN app_user iu ON iu.id = im.app_user_id
  LEFT JOIN membership sm ON sm.id = cs.substitute_instructor_membership_id
                         AND sm.organization_id = cs.organization_id
  LEFT JOIN app_user su ON su.id = sm.app_user_id
`;

interface SessionRow {
  id: string;
  class_group_id: string;
  class_name: string;
  level_name: string | null;
  pool_name: string | null;
  lane: number | null;
  instructor_name: string | null;
  substitute_name: string | null;
  starts_at: Date;
  local_date: string;
  local_time: string;
  weekday: number;
  duration_minutes: number;
  status: Session['status'];
  cancellation_reason: string | null;
  by_closure: boolean;
  enrolled: number;
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    classGroupId: row.class_group_id,
    className: row.class_name,
    levelName: row.level_name,
    poolName: row.pool_name,
    lane: row.lane,
    instructorName: row.instructor_name,
    substituteName: row.substitute_name,
    startsAt: row.starts_at.toISOString(),
    localDate: row.local_date,
    localTime: row.local_time,
    weekday: row.weekday,
    durationMinutes: row.duration_minutes,
    status: row.status,
    cancellationReason: row.cancellation_reason,
    byClosure: row.by_closure,
    enrolled: row.enrolled,
  };
}

/**
 * Every session in a window.
 *
 * Filtered on the facility's local date rather than on the UTC instant, so "the
 * week of the 12th" means the week an operator sees on their wall, not a window
 * that slides by an hour when the clocks change.
 */
export async function listSessions(
  organizationId: string,
  from: string,
  to: string,
): Promise<Session[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<SessionRow>(
      `SELECT ${SESSION_COLUMNS} ${SESSION_JOINS}
        WHERE (cs.starts_at AT TIME ZONE coalesce(f.timezone, 'Europe/Lisbon'))::date
              BETWEEN $1::date AND $2::date
        ORDER BY cs.starts_at`,
      [from, to],
    );
    return rows.map(toSession);
  });
}

export async function sessionsForStudent(
  organizationId: string,
  studentId: string,
  from: string,
  to: string,
): Promise<Session[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<SessionRow>(
      `SELECT ${SESSION_COLUMNS} ${SESSION_JOINS}
        WHERE (cs.starts_at AT TIME ZONE coalesce(f.timezone, 'Europe/Lisbon'))::date
              BETWEEN $2::date AND $3::date
          AND EXISTS (
            SELECT 1 FROM enrollment e
             WHERE e.organization_id = cs.organization_id
               AND e.class_group_id = cs.class_group_id
               AND e.student_id = $1
               AND e.status = 'active'
          )
        ORDER BY cs.starts_at`,
      [studentId, from, to],
    );
    return rows.map(toSession);
  });
}

/**
 * Calls off one class, or puts it back.
 *
 * Never touches `closure_id`, which is what keeps the two kinds of cancellation
 * apart: a class called off here has no closure behind it, so the generator will
 * never quietly reinstate it.
 */
export async function setSessionCancelled(
  organizationId: string,
  sessionId: string,
  cancelled: boolean,
  reason: string | null,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      cancelled
        ? `UPDATE class_session
              SET status = 'cancelled', cancellation_reason = $2
            WHERE id = $1 AND status <> 'cancelled'
          RETURNING id`
        : `UPDATE class_session
              SET status = 'scheduled', cancellation_reason = NULL, closure_id = NULL
            WHERE id = $1 AND status = 'cancelled'
          RETURNING id`,
      cancelled ? [sessionId, reason] : [sessionId],
    );
    if (!rows[0]) return false;

    await recordAudit(tx, {
      action: cancelled ? 'class_session.cancelled' : 'class_session.restored',
      entityType: 'class_session',
      entityId: sessionId,
      data: { reason },
    });
    return true;
  });
}

export async function setSubstitute(
  organizationId: string,
  sessionId: string,
  membershipId: string | null,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE class_session SET substitute_instructor_membership_id = $2
        WHERE id = $1
      RETURNING id`,
      [sessionId, membershipId],
    );
    if (!rows[0]) return false;

    await recordAudit(tx, {
      action: 'class_session.substitute_set',
      entityType: 'class_session',
      entityId: sessionId,
      data: { membershipId },
    });
    return true;
  });
}

function isoDate(value: Date): string {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}
