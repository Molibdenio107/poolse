import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { holidaysBetween } from './holidays.js';
import { nameOrder, shortName } from '../people/names.js';

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
  /** Every lane it occupies, by position. Empty when none was chosen. */
  lanes: number[];
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
  /**
   * The active roll, alphabetical — POOLSE-15.
   *
   * Sent with the session rather than fetched on hover: the calendar already
   * runs one query for the week, and a request per turma per hover is exactly
   * what the ticket asks not to do. A week of thirty classes carries a few
   * hundred short strings, which is smaller than the closure list beside it.
   *
   * Waiting-list students are excluded. They are not in the class, and a roll
   * that listed them would be wrong on the day.
   */
  students: string[];
}

// ---------------------------------------------------------------------------
// Closures
// ---------------------------------------------------------------------------

/**
 * The closures of one year.
 *
 * **Year-scoped rather than paginated — POOLSE-29.** The Encerramentos page is a
 * twelve-month grid, and a grid is bounded by its window rather than by tenant
 * size, so it is exempt from the page control. What it was *not* exempt from is
 * fetching sensibly: this returned every closure the club had ever declared and
 * the browser threw away all but the year on screen, so the exemption was
 * quietly paying for itself in bytes that grew every season.
 *
 * A year is the window. Annually-repeating closures are kept whatever their
 * year, because a closure that repeats belongs to every year including this one
 * — dropping them would empty the grid of exactly the entries that never change.
 */
export async function listClosures(organizationId: string, year: number | null): Promise<Closure[]> {
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
         AND (
           $1::int IS NULL
           OR c.repeats_annually
           OR (c.starts_on <= make_date($1::int, 12, 31)
               AND c.ends_on   >= make_date($1::int, 1, 1))
         )
       ORDER BY c.starts_on, c.reason
    `, [year]);

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
    /*
     * Checked here as well as by `closure_no_overlap` — POOLSE-31, criterion 7.
     *
     * Not belt and braces: the constraint is what makes the guarantee true under
     * two operators at once, and this is what turns it into a message naming the
     * closure already there. A raw exclusion violation would reach the operator
     * as "conflicting key value", which tells them nothing they can act on.
     */
    const clash = await overlapping(tx, input.startsOn, input.endsOn, input.poolId, null);
    if (clash !== null) throw new ClosureOverlapError(clash);

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

    /*
     * Take effect now, not at the next generation — POOLSE-31, criterion 8.
     *
     * Without this, closing the pool for next week leaves next week's classes
     * standing on the calendar until somebody presses "Gerar a época". An
     * operator who has just told the system the pool is shut is entitled to see
     * it shut.
     */
    const { rows: applied } = await tx.query<{ apply_closure: number }>(
      `SELECT apply_closure($1, $2)`,
      [organizationId, id],
    );

    await recordAudit(tx, {
      action: 'closure.created',
      entityType: 'closure',
      entityId: id,
      data: {
        reason: input.reason,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        // How many classes it took down, so the trail says what it cost rather
        // than only what was asked for.
        cancelled: applied[0]?.apply_closure ?? 0,
      },
    });

    return id;
  });
}

/**
 * Raised when a closure would cover days another already covers — POOLSE-31,
 * criterion 7.
 *
 * Carries the name of the closure already there, because "overlaps with an
 * existing closure" sends somebody hunting through a year of calendar, and
 * "overlaps with Encerramento de Natal" does not.
 */
export class ClosureOverlapError extends Error {
  constructor(readonly existing: string) {
    super(`Overlaps with ${existing}`);
  }
}

/** The closure already covering any of these days, if there is one. */
async function overlapping(
  tx: Tx,
  startsOn: string,
  endsOn: string,
  poolId: string | null,
  excludeId: string | null,
): Promise<string | null> {
  const { rows } = await tx.query<{ reason: string }>(
    `SELECT reason FROM closure
      WHERE archived_at IS NULL
        AND source = 'manual'
        AND NOT repeats_annually
        AND coalesce(pool_id, '00000000-0000-0000-0000-000000000000'::uuid)
            = coalesce($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
        AND daterange(starts_on, ends_on, '[]') && daterange($1::date, $2::date, '[]')
        AND ($4::uuid IS NULL OR id <> $4::uuid)
      LIMIT 1`,
    [startsOn, endsOn, poolId, excludeId],
  );
  return rows[0]?.reason ?? null;
}

/**
 * What a range would take down, before anybody commits to it — criterion 10.
 *
 * `marked` is the number that matters. Cancelling a class nobody has registered
 * is routine; cancelling one whose register was already taken means somebody
 * stood at the poolside and wrote it down, and they should be told before rather
 * than after.
 */
export interface ClosureImpact {
  sessions: number;
  marked: number;
}

export async function closureImpact(
  organizationId: string,
  startsOn: string,
  endsOn: string,
  poolId: string | null,
): Promise<ClosureImpact> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ o_sessions: number; o_marked: number }>(
      `SELECT o_sessions, o_marked FROM closure_impact($1, $2::date, $3::date, $4::uuid)`,
      [organizationId, startsOn, endsOn, poolId],
    );
    return { sessions: rows[0]?.o_sessions ?? 0, marked: rows[0]?.o_marked ?? 0 };
  });
}

/**
 * Extend, shorten or rename an existing closure — criterion 6.
 *
 * Re-applies afterwards, so shortening a closure gives back the classes it no
 * longer covers and extending it takes down the ones it now does. The restore
 * half is `generate_sessions`' own step 3, which only revives what a closure put
 * down; a class cancelled by a person is never touched.
 */
export async function updateClosure(
  organizationId: string,
  closureId: string,
  input: ClosureInput,
): Promise<'updated' | 'not_found'> {
  return withOrg(organizationId, async (tx) => {
    const clash = await overlapping(
      tx,
      input.startsOn,
      input.endsOn,
      input.poolId,
      closureId,
    );
    if (clash !== null) throw new ClosureOverlapError(clash);

    const { rows } = await tx.query<{ id: string }>(
      `UPDATE closure
          SET starts_on = $2::date, ends_on = $3::date, reason = $4,
              pool_id = $5, blocks_generation = $6, repeats_annually = $7
        WHERE id = $1 AND archived_at IS NULL AND source = 'manual'
      RETURNING id`,
      [
        closureId,
        input.startsOn,
        input.endsOn,
        input.reason,
        input.poolId,
        input.blocksGeneration,
        input.repeatsAnnually,
      ],
    );
    if (!rows[0]) return 'not_found';

    await tx.query(`SELECT apply_closure($1, $2)`, [organizationId, closureId]);

    await recordAudit(tx, {
      action: 'closure.updated',
      entityType: 'closure',
      entityId: closureId,
      data: { reason: input.reason, startsOn: input.startsOn, endsOn: input.endsOn },
    });

    return 'updated';
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
  /*
   * Every lane this session occupies — POOLSE-46. A competition squad takes
   * two or three; hidroginastica takes the tank. Ordered by position, so
   * "Pistas 2-4" reads the way the pool is laid out.
   */
  coalesce((
    SELECT array_agg(ln.position ORDER BY ln.position)
      FROM class_session_lane csl
      JOIN lane ln ON ln.id = csl.lane_id
     WHERE csl.session_id = cs.id
  ), '{}') AS lanes,
  short_name(iu.cached_first_name, iu.cached_last_name) AS instructor_name,
  short_name(su.cached_first_name, su.cached_last_name) AS substitute_name,
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
  )::int AS enrolled,
  -- The names behind that count — POOLSE-15. Wrapped in coalesce because a
  -- turma with nobody in it aggregates to NULL rather than to an empty array,
  -- and the mapper should not have to know that.
  coalesce((
    SELECT array_agg(${shortName('s')} ORDER BY ${nameOrder('s')})
      FROM enrollment e
      JOIN student s ON s.id = e.student_id AND s.organization_id = e.organization_id
     WHERE e.organization_id = cs.organization_id
       AND e.class_group_id = cs.class_group_id
       AND e.status = 'active'
  ), '{}') AS students
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
  lanes: number[] | null;
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
  students: string[];
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    classGroupId: row.class_group_id,
    className: row.class_name,
    levelName: row.level_name,
    poolName: row.pool_name,
    lanes: row.lanes ?? [],
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
    students: row.students,
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
 * Calls off one class. Nothing here puts one back.
 *
 * It used to take a boolean and do both. Backlog round 3, story 5 removed the
 * operator-facing restore, and the `false` branch went with it rather than
 * staying as an unreachable half of a function — a dead branch behind a boolean
 * parameter is the easiest kind of code to reinstate by accident.
 *
 * The row is not deleted. `status = 'cancelled'` is what attendance history,
 * invoicing and any later "was there a class that Tuesday?" all rest on; only
 * the way back is gone, not the record.
 *
 * Never touches `closure_id`, which is what keeps the two kinds of cancellation
 * apart: a class called off here has no closure behind it, so the generator will
 * never quietly reinstate it. A class a *closure* took down still returns on its
 * own when the closure is removed — that happens inside `generate_sessions`, in
 * SQL, and is untouched by any of this.
 */
export interface RemovalOutcome {
  /** How many occurrences were called off. */
  removed: number;
  /**
   * How many were left alone because somebody had already taken a register.
   *
   * Reported rather than swallowed: an operator who asked to remove a term and
   * got fourteen of sixteen needs to know which two are still standing and why.
   */
  keptMarked: number;
  /** The last day the turma now runs, when the removal ended it. */
  endsOn: string | null;
}

/**
 * Removes this occurrence and every later one — POOLSE-14.
 *
 * Three things happen, and the third is the one that is easy to miss.
 *
 * **Marked occurrences are skipped, not failed.** A class somebody has taken a
 * register for cannot be cancelled — slice 1.8 enforces that with a trigger — and
 * without the `NOT EXISTS` here the trigger would abort the whole statement, so
 * one marked session this afternoon would refuse to remove a term. They are
 * counted and reported instead.
 *
 * **Past occurrences are never touched** (criterion 4). The window starts at this
 * session and runs forward; last March keeps whatever happened.
 *
 * **The turma stops running.** Cancelling rows alone would be undone by the next
 * "Gerar a época" the moment the window extended past them, so `ends_on` is set
 * to the day before. That is what makes "and all future" mean the future rather
 * than "until somebody presses generate".
 */
export async function removeFutureSessions(
  organizationId: string,
  sessionId: string,
  reason: string | null,
): Promise<RemovalOutcome | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows: anchors } = await tx.query<{
      class_group_id: string;
      starts_at: Date;
      local_date: string;
    }>(
      `SELECT cs.class_group_id,
              cs.starts_at,
              to_char(session_local_date($1, cs.pool_id, cs.starts_at), 'YYYY-MM-DD')
                AS local_date
         FROM class_session cs
        WHERE cs.id = $2`,
      [organizationId, sessionId],
    );

    const anchor = anchors[0];
    if (!anchor) return null;

    const { rows: removed } = await tx.query<{ id: string }>(
      `UPDATE class_session cs
          SET status = 'cancelled', cancellation_reason = $3
        WHERE cs.class_group_id = $1
          AND cs.starts_at >= $2
          AND cs.status <> 'cancelled'
          AND NOT EXISTS (
                SELECT 1 FROM attendance a
                 WHERE a.class_session_id = cs.id
                   AND a.organization_id = cs.organization_id
              )
      RETURNING cs.id`,
      [anchor.class_group_id, anchor.starts_at, reason],
    );

    const { rows: kept } = await tx.query<{ n: string }>(
      `SELECT count(*) AS n
         FROM class_session cs
        WHERE cs.class_group_id = $1
          AND cs.starts_at >= $2
          AND cs.status <> 'cancelled'`,
      [anchor.class_group_id, anchor.starts_at],
    );

    /*
     * The turma ends the day before, so the generator stops there.
     *
     * `least` rather than a plain assignment: a turma that already ended earlier
     * keeps its earlier date. Removing from a date after it stopped should not
     * quietly extend it.
     */
    const { rows: ended } = await tx.query<{ ends_on: string }>(
      `UPDATE class_group
          SET ends_on = least(coalesce(ends_on, DATE '9999-12-31'), $2::date - 1)
        WHERE id = $1 AND archived_at IS NULL
      RETURNING to_char(ends_on, 'YYYY-MM-DD') AS ends_on`,
      [anchor.class_group_id, anchor.local_date],
    );

    await recordAudit(tx, {
      action: 'class_session.removed_future',
      entityType: 'class_group',
      entityId: anchor.class_group_id,
      data: {
        fromSessionId: sessionId,
        from: anchor.local_date,
        removed: removed.length,
        keptMarked: Number(kept[0]?.n ?? 0),
        reason,
      },
    });

    return {
      removed: removed.length,
      keptMarked: Number(kept[0]?.n ?? 0),
      endsOn: ended[0]?.ends_on ?? null,
    };
  });
}

/**
 * Who is allowed to remove this class — POOLSE-14, criterion 7.
 *
 * Owner and admin always. The assigned instructor may remove their *own*
 * classes, which includes one they are covering as a substitute — if they are
 * the person standing at the poolside, they are the person who knows it is off.
 * Never somebody else's.
 */
export async function isOwnClass(
  organizationId: string,
  sessionId: string,
  membershipId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ mine: boolean }>(
      `SELECT coalesce(cs.substitute_instructor_membership_id, cs.instructor_membership_id)
                = $2 AS mine
         FROM class_session cs
        WHERE cs.id = $1`,
      [sessionId, membershipId],
    );
    return rows[0]?.mine === true;
  });
}

export async function cancelSession(
  organizationId: string,
  sessionId: string,
  reason: string | null,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE class_session
          SET status = 'cancelled', cancellation_reason = $2
        WHERE id = $1 AND status <> 'cancelled'
      RETURNING id`,
      [sessionId, reason],
    );
    if (!rows[0]) return false;

    await recordAudit(tx, {
      action: 'class_session.cancelled',
      entityType: 'class_session',
      entityId: sessionId,
      data: { reason },
    });
    return true;
  });
}

export interface Clash {
  /** The class already in that slot. */
  className: string;
  /** Local wall-clock at the facility, "2026-09-07 10:00". */
  when: string;
  poolName: string | null;
  lane: number | null;
  /** Which rule was broken, so the message can say the right thing. */
  kind: 'lane' | 'instructor';
}

/**
 * What a session would collide with — backlog round 4, ticket 1.
 *
 * "The refusal names the clashing class, its time and its lane — never a bare
 * constraint error." Postgres raises `23P01` with the offending key in its
 * detail string, but parsing that string is exactly the kind of thing that
 * breaks on a minor version bump. Asking the same question in SQL is both
 * stabler and better: it can return the class's *name*.
 *
 * Half-open on purpose, matching `tstzrange(starts_at, ends_at)`: a class
 * starting the moment another ends is not a clash, and this must agree with the
 * constraint or the message would name a collision the database allowed.
 */
export async function findClash(
  organizationId: string,
  candidate: {
    sessionId?: string | null;
    poolId: string | null;
    lane: number | null;
    instructorMembershipId: string | null;
    startsAt: Date;
    endsAt: Date;
  },
): Promise<Clash | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      class_name: string;
      when: string;
      pool_name: string | null;
      lane: number | null;
      kind: 'lane' | 'instructor';
    }>(
      `
      SELECT cg.name AS class_name,
             to_char(
               cs.starts_at AT TIME ZONE coalesce(f.timezone, 'Europe/Lisbon'),
               'YYYY-MM-DD HH24:MI'
             ) AS when,
             p.name AS pool_name,
             ln.position AS lane,
             CASE
               WHEN $4::uuid IS NOT NULL
                AND coalesce(cs.substitute_instructor_membership_id,
                             cs.instructor_membership_id) = $4::uuid
                 THEN 'instructor'
               ELSE 'lane'
             END AS kind
        FROM class_session cs
        JOIN class_group cg
          ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
        LEFT JOIN pool p     ON p.id = cs.pool_id     AND p.organization_id = cs.organization_id
        LEFT JOIN class_session_lane csl ON csl.session_id = cs.id
        LEFT JOIN lane ln    ON ln.id = csl.lane_id    AND ln.organization_id = cs.organization_id
        LEFT JOIN facility f ON f.id = p.facility_id  AND f.organization_id = cs.organization_id
       WHERE cs.status <> 'cancelled'
         AND ($1::uuid IS NULL OR cs.id <> $1::uuid)
         AND tstzrange(cs.starts_at, cs.ends_at) && tstzrange($5::timestamptz, $6::timestamptz)
         AND (
              -- Same pool and lane.
              ($2::uuid IS NOT NULL AND $3::smallint IS NOT NULL
                 AND cs.pool_id = $2::uuid AND ln.position = $3::smallint)
              -- Or the same person teaching, wherever they are.
           OR ($4::uuid IS NOT NULL
                 AND coalesce(cs.substitute_instructor_membership_id,
                              cs.instructor_membership_id) = $4::uuid)
         )
       /*
        * An instructor clash is the more surprising of the two and the harder to
        * spot on a calendar, so it is named first when both apply.
        *
        * ASC, because the values are the literals 'instructor' and 'lane' and
        * 'instructor' sorts first. This said DESC, which did the exact opposite
        * of the sentence above it — the sort of disagreement that survives
        * review precisely because the comment reads correct.
        */
       ORDER BY kind ASC, cs.starts_at
       LIMIT 1
      `,
      [
        candidate.sessionId ?? null,
        candidate.poolId,
        candidate.lane,
        candidate.instructorMembershipId,
        candidate.startsAt,
        candidate.endsAt,
      ],
    );

    const row = rows[0];
    if (!row) return null;

    return {
      className: row.class_name,
      when: row.when,
      poolName: row.pool_name,
      lane: row.lane,
      kind: row.kind,
    };
  });
}

/** The shape `findClash` needs, read back from a session that already exists. */
export async function findSessionSlot(
  organizationId: string,
  sessionId: string,
): Promise<{
  sessionId: string;
  poolId: string | null;
  lane: number | null;
  instructorMembershipId: string | null;
  startsAt: Date;
  endsAt: Date;
} | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      pool_id: string | null;
      lane: number | null;
      instructor: string | null;
      starts_at: Date;
      ends_at: Date;
    }>(
      `SELECT cs.pool_id,
              -- The lowest lane it holds; findClash asks about one at a time.
              min(ln.position)::int AS lane,
              coalesce(cs.substitute_instructor_membership_id, cs.instructor_membership_id)
                AS instructor,
              cs.starts_at,
              cs.ends_at
         FROM class_session cs
         LEFT JOIN class_session_lane csl ON csl.session_id = cs.id
         LEFT JOIN lane ln ON ln.id = csl.lane_id AND ln.organization_id = cs.organization_id
        WHERE cs.id = $1
        GROUP BY cs.pool_id, cs.substitute_instructor_membership_id,
                 cs.instructor_membership_id, cs.starts_at, cs.ends_at`,
      [sessionId],
    );

    const row = rows[0];
    if (!row) return null;

    return {
      sessionId,
      poolId: row.pool_id,
      lane: row.lane,
      instructorMembershipId: row.instructor,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
    };
  });
}

/** Raised in place of a bare `23P01` so a controller can answer in words. */
export class SessionClashError extends Error {
  constructor(readonly clash: Clash | null) {
    super('That slot is already taken');
    this.name = 'SessionClashError';
  }
}

/**
 * The trigger that refuses to cancel a class somebody has marked.
 *
 * `restrict_violation` is raised by `refuse_cancelling_marked_session`, and it
 * reaches here from two directions: a person pressing cancel on the calendar,
 * and `generate_sessions` when a newly-added closure covers a day that has
 * already been taught. Both deserve the same sentence.
 */
export function isMarkedSessionViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === '23001'
  );
}

export function isExclusionViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === '23P01'
  );
}

/**
 * The clashes a season generation would hit, found before it runs.
 *
 * Generation writes a year of rows in one statement, so one instructor booked
 * twice would abort the whole run — and the operator would be told a constraint
 * name for a problem in a turma they set up weeks ago.
 *
 * Asked as a question about the weekly *patterns* instead: two turmas sharing an
 * instructor, on the same weekday, whose times overlap. Answered before anything
 * is written, so the operator is told which two turmas to fix rather than that
 * something went wrong.
 */
export interface ScheduleClash {
  firstClass: string;
  secondClass: string;
  weekday: number;
  firstTime: string;
  secondTime: string;
}

export async function findScheduleClashes(organizationId: string): Promise<ScheduleClash[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      first_class: string;
      second_class: string;
      weekday: number;
      first_time: string;
      second_time: string;
    }>(`
      WITH slot AS (
        SELECT cg.id AS group_id,
               cg.name,
               cg.instructor_membership_id,
               s.weekday,
               s.start_time,
               s.start_time + make_interval(mins => s.duration_minutes) AS end_time
          FROM class_group cg
          JOIN class_schedule s
            ON s.class_group_id = cg.id
           AND s.organization_id = cg.organization_id
           AND s.archived_at IS NULL
         WHERE cg.archived_at IS NULL
           AND cg.instructor_membership_id IS NOT NULL
      )
      SELECT a.name              AS first_class,
             b.name              AS second_class,
             a.weekday,
             to_char(a.start_time, 'HH24:MI') AS first_time,
             to_char(b.start_time, 'HH24:MI') AS second_time
        FROM slot a
        JOIN slot b
          ON b.instructor_membership_id = a.instructor_membership_id
         AND b.weekday = a.weekday
         -- Each pair once. Without this every clash is reported twice, once
         -- from each side, and the operator counts double.
         AND b.group_id > a.group_id
         -- Half-open, agreeing with the constraint: back-to-back is not a clash.
         AND a.start_time < b.end_time
         AND b.start_time < a.end_time
       ORDER BY a.weekday, a.start_time
    `);

    return rows.map((row) => ({
      firstClass: row.first_class,
      secondClass: row.second_class,
      weekday: row.weekday,
      firstTime: row.first_time,
      secondTime: row.second_time,
    }));
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
