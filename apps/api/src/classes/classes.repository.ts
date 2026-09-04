import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { displayName, nameOrder, shortName } from '../people/names.js';
import {
  paginated,
  totalOf,
  TOTAL_COUNT,
  type PageQuery,
  type Paginated,
} from '../common/pagination.js';

export interface ScheduleSlot {
  id: string;
  /** ISO weekday: Monday 1 … Sunday 7. */
  weekday: number;
  /** Wall-clock at the facility, "HH:MM". Never an instant — see the migration. */
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
  /** The site the pool is at — the schedule board filters and draws by it. */
  facilityId: string | null;
  instructorMembershipId: string | null;
  instructorName: string | null;
  capacity: number | null;
  lane: number | null;
  schedules: ScheduleSlot[];
  students: EnrolledStudent[];
  /**
   * What a place in this turma costs a month — POOLSE-42.
   *
   * Matched on the turma's own level and its *own* weekly slot count, so nobody
   * types a frequency twice and the two cannot disagree. Null when the site has
   * no price for that combination, which is a thing to say rather than a zero to
   * show.
   */
  monthlyPriceCents: number | null;
}

/**
 * Raised when a turma is put on a lane its pool does not have — POOLSE-43.
 *
 * Before lanes were rows, `class_group.lane` was a bare smallint and nothing
 * stopped somebody typing 7 into a six-lane pool. Now the number has to name a
 * lane that exists, which is the hole that ticket was written to close.
 */
export class NoSuchLaneError extends Error {
  constructor(readonly lane: number) {
    super('no such lane');
  }
}

/**
 * The lane row a position refers to, in a given pool.
 *
 * The interface still speaks in numbers — "Pista 3" is what an operator says —
 * while the database holds a reference. This is the translation, and it is the
 * only place it happens.
 *
 * Null in, null out: a turma with no lane chosen yet is ordinary, and a turma
 * with no pool cannot have a lane at all.
 */
async function laneIdFor(
  tx: Tx,
  poolId: string | null,
  lane: number | null,
): Promise<string | null> {
  if (lane === null || poolId === null) return null;

  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM lane
      WHERE pool_id = $1 AND position = $2 AND archived_at IS NULL`,
    [poolId, lane],
  );

  const found = rows[0]?.id;
  if (found === undefined) throw new NoSuchLaneError(lane);
  return found;
}

/**
 * A turma's bookings, put on the turma's lane — POOLSE-46.
 *
 * **Two things say where a class swims, and they are not the same thing.**
 * `class_group.lane_id` is the turma's default, the way `capacity` is: one lane,
 * chosen on the turma's own form. `booking_lane` is where a booking actually
 * sits, and a booking may span several — which is what a competition squad or a
 * hidroginástica across the whole tank needs.
 *
 * Until the grid can place a booking on lanes of its own (POOLSE-49 and 50), the
 * turma's form is the only way anybody sets a lane, so this pushes that one
 * choice down onto every booking the turma has. When the grid lands, a booking
 * edited there stops following the default — and this is the only place that
 * would have to learn it.
 *
 * Delete-then-insert rather than a diff: a turma has a handful of slots, it all
 * happens in one transaction, and a diff would be more code for a case that
 * never gets large.
 */
async function syncBookingLanes(
  tx: Tx,
  organizationId: string,
  groupId: string,
): Promise<void> {
  await tx.query(
    `DELETE FROM booking_lane
      WHERE schedule_id IN (
        SELECT id FROM class_schedule
         WHERE class_group_id = $1 AND archived_at IS NULL
      )`,
    [groupId],
  );

  await tx.query(
    `INSERT INTO booking_lane (organization_id, schedule_id, lane_id)
     SELECT $1, sch.id, cg.lane_id
       FROM class_schedule sch
       JOIN class_group cg
         ON cg.id = sch.class_group_id AND cg.organization_id = sch.organization_id
      WHERE sch.class_group_id = $2
        AND sch.archived_at IS NULL
        AND cg.lane_id IS NOT NULL
     ON CONFLICT DO NOTHING`,
    [organizationId, groupId],
  );
}

export class DuplicateNameError extends Error {}
/** The lane a turma was moved onto is already busy at one of its hours. */
export class LaneOccupiedError extends Error {}
export class FullError extends Error {}
export class AlreadyEnrolledError extends Error {}

/**
 * Every turma, with its pattern and everybody in it.
 *
 * One query rather than three, because both screens this feeds need all of it at
 * once: the week grid shows who is in each slot, and the list shows how full each
 * turma is. Fetching students separately would be a request per turma — the
 * classic shape that looks fine with three of them and falls over with thirty.
 */
const GROUP_COLUMNS = `
  cg.id,
  cg.name,
  cg.level_id,
  l.name  AS level_name,
  cg.pool_id,
  p.name  AS pool_name,
  -- Which site the turma is at, via its pool — round 5. The schedule board
  -- filters by facility, because the grid's hours come from that facility's
  -- opening hours and a turma at another site would be drawn against the wrong
  -- day.
  p.facility_id,
  /*
   * The price for this turma's level at this turma's frequency.
   *
   * The frequency is counted from the turma's own schedule rather than stored:
   * a turma that meets on Tuesdays and Thursdays *is* two lessons a week, and a
   * second field saying so would be a second thing to keep in step.
   *
   * The turma's facility, not the pool's — a turma with no lane yet still has a
   * site and still has a price.
   */
  (
    SELECT fp.amount_cents
      FROM fee_plan fp
     WHERE fp.organization_id = cg.organization_id
       AND fp.facility_id = cg.facility_id
       AND fp.kind = 'mensalidade'
       AND fp.archived_at IS NULL
       AND fp.level_id = cg.level_id
       AND fp.lessons_per_week = (
         SELECT count(*) FROM class_schedule cs2
          WHERE cs2.organization_id = cg.organization_id
            AND cs2.class_group_id = cg.id
            AND cs2.archived_at IS NULL
       )
  ) AS monthly_price_cents,
  cg.instructor_membership_id,
  short_name(u.cached_first_name, u.cached_last_name) AS instructor_name,
  cg.capacity,
  -- The lane, still as the number the interface shows — POOLSE-43. The column
  -- became a reference to a lane row, whose position is what it used to hold.
  ln.position AS lane,
  (
    SELECT coalesce(
             json_agg(
               json_build_object('id', cs.id, 'weekday', cs.weekday,
                                 'startTime', to_char(cs.start_time, 'HH24:MI'),
                                 'durationMinutes', cs.duration_minutes)
               ORDER BY cs.weekday, cs.start_time
             ), '[]'::json)
      FROM class_schedule cs
     WHERE cs.organization_id = cg.organization_id
       AND cs.class_group_id = cg.id
       AND cs.archived_at IS NULL
  ) AS schedules,
  (
    SELECT coalesce(
             json_agg(
               json_build_object('enrollmentId', e.id, 'studentId', s.id,
                                 'firstName', s.first_name, 'lastName', s.last_name,
                                 'displayName', ${displayName('s')},
                                 'shortName', ${shortName('s')},
                                 'status', e.status, 'waitingPosition', e.waiting_position)
               ORDER BY e.status, e.waiting_position NULLS FIRST, ${nameOrder('s')}
             ), '[]'::json)
      FROM enrollment e
      JOIN student s
        ON s.id = e.student_id AND s.organization_id = e.organization_id
     WHERE e.organization_id = cg.organization_id
       AND e.class_group_id = cg.id
       AND e.status <> 'ended'
       AND s.archived_at IS NULL
  ) AS students
`;

const GROUP_JOINS = `
  FROM class_group cg
  LEFT JOIN student_level l ON l.id = cg.level_id AND l.organization_id = cg.organization_id
  LEFT JOIN pool p         ON p.id = cg.pool_id  AND p.organization_id = cg.organization_id
  LEFT JOIN lane ln        ON ln.id = cg.lane_id AND ln.organization_id = cg.organization_id
  LEFT JOIN membership m   ON m.id = cg.instructor_membership_id
                          AND m.organization_id = cg.organization_id
  LEFT JOIN app_user u     ON u.id = m.app_user_id
`;

interface GroupRow {
  id: string;
  name: string;
  level_id: string | null;
  level_name: string | null;
  pool_id: string | null;
  pool_name: string | null;
  facility_id: string | null;
  monthly_price_cents: number | null;
  instructor_membership_id: string | null;
  instructor_name: string | null;
  capacity: number | null;
  lane: number | null;
  schedules: ScheduleSlot[] | null;
  students: EnrolledStudent[] | null;
}

function toGroup(row: GroupRow): ClassGroup {
  return {
    id: row.id,
    name: row.name,
    levelId: row.level_id,
    levelName: row.level_name,
    poolId: row.pool_id,
    poolName: row.pool_name,
    facilityId: row.facility_id,
    monthlyPriceCents: row.monthly_price_cents,
    instructorMembershipId: row.instructor_membership_id,
    instructorName: row.instructor_name,
    capacity: row.capacity,
    lane: row.lane,
    schedules: row.schedules ?? [],
    students: row.students ?? [],
  };
}

/**
 * The turmas of the season that is running — POOLSE-07.
 *
 * Scoped here rather than at every call site, because "which turmas are there"
 * has exactly one right answer at a time and a screen that forgot the filter
 * would show a retired season's classes beside the current ones with nothing to
 * tell them apart.
 *
 * A retired season's turmas are not gone — they keep every session, enrolment
 * and register, and reporting can still reach them by season. They are simply
 * not what the club is running now.
 */
/**
 * Every turma of the active season.
 *
 * **Deliberately not paginated — POOLSE-29, and it is the interesting exemption.**
 *
 * This feeds a week grid, and a week grid is a calendar: it is the same shape as
 * the Encerramentos and Férias year grids, bounded by a fixed window rather than
 * by how many rows a tenant has. Paginating it would not shorten the week, it
 * would silently empty Tuesday — the reader would see a gap where a turma runs
 * and conclude nobody is teaching, which is worse than a long page.
 *
 * The exemption rule in `docs/backlog/CONVENTIONS.md` is "bounded by the data
 * model or by a fixed window, not by tenant growth", and this is the second half
 * of it. If a turma *list* view is ever built separately from the calendar, that
 * list pages; this query stays whole.
 */
/**
 * The club's turmas, or one instructor's — slice 1.12.
 *
 * `mine` is a membership id or null, and null is not a default anybody falls
 * into by accident: the controller decides which view the caller gets and passes
 * one or the other. An instructor who is only an instructor gets their own; an
 * owner who also teaches gets whichever they asked for.
 *
 * "Mine" is the union of the two places an assignment lives — the turma's own
 * instructor, and any booking of it that names somebody else's substitute. A
 * person covering one Tuesday of Cadetes sees Cadetes, because they need its
 * register on the night they teach it. Same rule as `tenant/assignment.ts`, and
 * the two would be worth sharing if a third caller ever appears.
 */
export async function listClassGroups(
  organizationId: string,
  mine: string | null = null,
): Promise<ClassGroup[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<GroupRow>(
      `SELECT ${GROUP_COLUMNS} ${GROUP_JOINS}
         JOIN season se
           ON se.id = cg.season_id
          AND se.organization_id = cg.organization_id
          AND se.archived_at IS NULL
        WHERE cg.archived_at IS NULL
          AND ($1::uuid IS NULL OR (
            cg.instructor_membership_id = $1
            OR EXISTS (
              SELECT 1 FROM class_schedule sch
               WHERE sch.class_group_id = cg.id
                 AND sch.organization_id = cg.organization_id
                 AND sch.archived_at IS NULL
                 AND sch.instructor_membership_id = $1
            )
          ))
        ORDER BY cg.name`,
      [mine],
    );
    return rows.map(toGroup);
  });
}

export async function findClassGroup(
  organizationId: string,
  groupId: string,
): Promise<ClassGroup | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<GroupRow>(
      `SELECT ${GROUP_COLUMNS} ${GROUP_JOINS}
        WHERE cg.id = $1 AND cg.archived_at IS NULL`,
      [groupId],
    );
    const row = rows[0];
    return row ? toGroup(row) : null;
  });
}

export interface ClassGroupInput {
  name: string;
  levelId: string | null;
  poolId: string | null;
  instructorMembershipId: string | null;
  capacity: number | null;
  lane: number | null;
}

export async function createClassGroup(
  organizationId: string,
  input: ClassGroupInput,
/*
 * `{ id }` rather than a bare string, so "no season" is a case the compiler
 * makes the caller handle. `string | 'no_season'` collapses to `string` and
 * would have let the controller ignore it silently — the same shape of hole the
 * bug being fixed here came through.
 */
): Promise<{ id: string } | 'no_season'> {
  try {
    return await withOrg(organizationId, async (tx) => {
      /*
       * A club that has never opened a season cannot hold a turma, and the
       * NOT NULL below says so as a 23502 — which reached the operator as a 500.
       * Asked first, so the answer is a sentence they can act on.
       */
      const { rows: seasons } = await tx.query<{ id: string }>(
        // Published, not merely unarchived — POOLSE-45. Once drafts exist,
        // `archived_at IS NULL` matches every plan for next year too, and a new
        // turma would land in whichever one the planner happened to return.
        "SELECT id FROM season WHERE status = 'published' LIMIT 1",
      );
      if (seasons.length === 0) return 'no_season' as const;

      // The number the form sends, resolved to the lane it names — POOLSE-43.
      const laneId = await laneIdFor(tx, input.poolId, input.lane);

      const { rows } = await tx.query<{ id: string }>(
        // A new turma joins the season that is running. There is no way to
        // create one in a retired season, which is the point of retiring it.
        `INSERT INTO class_group (
           organization_id, name, level_id, pool_id, instructor_membership_id, capacity, lane_id,
           facility_id, season_id
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           /*
            * The site — POOLSE-42, which needs one to find the price list.
            *
            * A turma with a pool has already said where it is, and the trigger
            * fills this in from it; this covers the turma created before a lane
            * is picked. Oldest facility, which for almost every club is their
            * only one — and a club with two sites moves the turma by giving it
            * a pool, which is the same gesture they already make.
            */
           coalesce(
             (SELECT p.facility_id FROM pool p WHERE p.id = $4),
             (SELECT f.id FROM facility f
               WHERE f.archived_at IS NULL ORDER BY f.created_at, f.id LIMIT 1)
           ),
           /*
            * A club with no active season yields NULL here, and season_id is
            * NOT NULL — so creating a turma answered 23502 as a 500 instead of
            * saying what was missing. The one-active-season index guarantees at
            * most one row, so only the zero-row case could arise.
            *
            * Checked before the insert now, so the operator is told to open a
            * season rather than shown a database error.
            */
           (SELECT id FROM season WHERE status = 'published')
         )
         RETURNING id`,
        [
          organizationId,
          input.name,
          input.levelId,
          input.poolId,
          input.instructorMembershipId,
          input.capacity,
          laneId,
        ],
      );

      const id = rows[0]?.id;
      if (!id) throw new Error('Could not create the class group');

      await recordAudit(tx, {
        action: 'class_group.created',
        entityType: 'class_group',
        entityId: id,
        data: { name: input.name },
      });

      return { id };
    });
  } catch (error) {
    throw asDuplicate(error, input.name);
  }
}

export async function updateClassGroup(
  organizationId: string,
  groupId: string,
  input: ClassGroupInput,
): Promise<boolean> {
  try {
    return await withOrg(organizationId, async (tx) => {
      const laneId = await laneIdFor(tx, input.poolId, input.lane);

      const { rows } = await tx.query<{ id: string }>(
        `UPDATE class_group
            SET name = $2, level_id = $3, pool_id = $4,
                instructor_membership_id = $5, capacity = $6, lane_id = $7
          WHERE id = $1 AND archived_at IS NULL
        RETURNING id`,
        [
          groupId,
          input.name,
          input.levelId,
          input.poolId,
          input.instructorMembershipId,
          input.capacity,
          laneId,
        ],
      );
      if (!rows[0]) return false;

      /*
       * Future sessions follow the turma; past ones do not — backlog round 4,
       * ticket 1.
       *
       * `class_session.instructor_membership_id` is a copy, and a copy has to be
       * told when the original changes or the exclusion constraint is guarding a
       * name nobody is teaching under any more.
       *
       * From today forward only. A session last March keeps whoever actually
       * stood on the poolside, because that is the record attendance and payroll
       * will read — rewriting it would retroactively put somebody at a class
       * they never taught.
       *
       * Cancelled sessions are skipped: they are history too, and the constraint
       * ignores them anyway.
       */
      /*
       * The pool and the lane travel with the instructor.
       *
       * `class_session` copies all three from the turma at generation time —
       * deliberately, because an exclusion constraint cannot reach into another
       * table. This propagated only the instructor, so moving a turma to another
       * pool left every already-generated session in the old one, and
       * regeneration could not repair it either: it inserts `ON CONFLICT DO
       * NOTHING`, so the stale rows simply stayed.
       *
       * The symptom is a calendar that shows a class in a pool the club has
       * stopped using, which nobody would think to look for.
       */
      await tx.query(
        `UPDATE class_session
            SET instructor_membership_id = $2,
                pool_id = $3
          WHERE class_group_id = $1
            AND starts_at >= now()
            AND status <> 'cancelled'
            AND (instructor_membership_id IS DISTINCT FROM $2
                 OR pool_id IS DISTINCT FROM $3)`,
        [groupId, input.instructorMembershipId, input.poolId],
      );

      /*
       * A session's lane is a row in `class_session_lane`, not a column —
       * POOLSE-R2-01.
       *
       * This used to set `class_session.lane_id`, which has never existed. A
       * session holds its lanes in a side table because the exclusion constraint
       * that stops two classes sharing one lane needs a row per lane and a time
       * range to overlap — a single column could not express a class occupying
       * three lanes, which is exactly what `Masters (1-3)` does.
       *
       * So every save of a turma raised `42703: column "lane_id" does not exist`
       * and answered 500. Not on some inputs — on all of them, including a save
       * that changed nothing, which is how QA found it. Creating worked, which
       * is what kept it hidden: the insert path never touches this statement.
       */
      await tx.query(
        `DELETE FROM class_session_lane
          WHERE session_id IN (
            SELECT s.id FROM class_session s
             WHERE s.class_group_id = $1
               AND s.starts_at >= now()
               AND s.status <> 'cancelled'
          )`,
        [groupId],
      );

      if (laneId !== null) {
        await tx.query(
          `INSERT INTO class_session_lane
             (organization_id, session_id, lane_id, starts_at, ends_at, cancelled)
           SELECT $1, s.id, $3, s.starts_at, s.ends_at, false
             FROM class_session s
            WHERE s.class_group_id = $2
              AND s.starts_at >= now()
              AND s.status <> 'cancelled'`,
          /*
           * No `ON CONFLICT DO NOTHING` here, deliberately.
           *
           * It would swallow the exclusion constraint, and the turma would move
           * onto the new lane while the one session that clashed quietly ended
           * up with no lane at all — the operator gets the save they asked for
           * and a class that is not where they put it. The clash is a real
           * answer: somebody else has that lane at that hour. It surfaces as a
           * 409 and the save does not happen.
           *
           * The rows for these sessions were deleted a moment ago in this same
           * transaction, so the primary key cannot be what fires.
           */
          [organizationId, groupId, laneId],
        );
      }

      // The turma moved lane, so its bookings move with it.
      await syncBookingLanes(tx, organizationId, groupId);

      await recordAudit(tx, {
        action: 'class_group.updated',
        entityType: 'class_group',
        entityId: groupId,
        data: { name: input.name },
      });
      return true;
    });
  } catch (error) {
    /*
     * The new lane is already somebody else's at that hour. A real answer, and
     * the operator can act on it — so it must not arrive as a 500 the way the
     * missing column did.
     */
    if (error instanceof Error && (error as { code?: string }).code === '23P01') {
      throw new LaneOccupiedError(input.name);
    }
    throw asDuplicate(error, input.name);
  }
}

/**
 * Archiving a turma ends the enrollments in it.
 *
 * Leaving them live would leave students attached to a class that no longer
 * runs, and every screen that lists "what is this child enrolled in" would have
 * to special-case it.
 */
export async function archiveClassGroup(
  organizationId: string,
  groupId: string,
): Promise<{ archived: boolean; ended: number }> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string; name: string }>(
      `UPDATE class_group SET archived_at = now()
        WHERE id = $1 AND archived_at IS NULL
      RETURNING id, name`,
      [groupId],
    );
    const group = rows[0];
    if (!group) return { archived: false, ended: 0 };

    await tx.query(
      `UPDATE class_schedule SET archived_at = now()
        WHERE class_group_id = $1 AND archived_at IS NULL`,
      [groupId],
    );

    const ended = await tx.query(
      `UPDATE enrollment SET status = 'ended', ended_on = current_date
        WHERE class_group_id = $1 AND status <> 'ended'`,
      [groupId],
    );

    await recordAudit(tx, {
      action: 'class_group.archived',
      entityType: 'class_group',
      entityId: groupId,
      data: { name: group.name, endedEnrollments: ended.rowCount ?? 0 },
    });

    return { archived: true, ended: ended.rowCount ?? 0 };
  });
}

// ---------------------------------------------------------------------------
// The weekly pattern
// ---------------------------------------------------------------------------

/**
 * Why the timetable triggers refused a slot — round 5.
 *
 * The facility-hours triggers raise `check_violation` with a machine-readable
 * prefix. Unread, that reached the operator as "500" while adding a Tuesday to a
 * turma at a pool that does not open on Tuesdays — a rule working exactly as
 * designed, reported as a crash. The prefix is what turns it back into a
 * sentence somebody can act on.
 */
export type ScheduleRefusal = 'closed_that_day' | 'outside_hours' | 'ends_after_closing';

function scheduleRefusal(error: unknown): ScheduleRefusal | null {
  if (!(error instanceof Error)) return null;
  if ((error as { code?: string }).code !== '23514') return null;

  const message = error.message;
  if (message.startsWith('facility_closed_on_weekday:')) return 'closed_that_day';
  if (message.startsWith('class_ends_after_closing:')) return 'ends_after_closing';
  if (message.startsWith('outside_facility_hours:')) return 'outside_hours';

  // Some other check constraint. Nothing here knows what to say about it, and
  // guessing would put a confident wrong sentence in front of an operator.
  return null;
}

export async function addSchedule(
  organizationId: string,
  groupId: string,
  weekday: number,
  startTime: string,
  durationMinutes: number,
): Promise<'added' | 'not_found' | 'duplicate' | ScheduleRefusal> {
  return withOrg(organizationId, async (tx) => {
    const group = await tx.query(
      'SELECT 1 FROM class_group WHERE id = $1 AND archived_at IS NULL',
      [groupId],
    );
    if (group.rows.length === 0) return 'not_found';

    try {
      await tx.query(
        /*
         * The booking carries its own site — POOLSE-46. It used to reach one
         * through its turma, which stops working for a booking that has no
         * turma, and it is the facility the opening-hours trigger checks.
         */
        `INSERT INTO class_schedule (
           organization_id, class_group_id, facility_id, weekday, start_time, duration_minutes
         ) VALUES (
           $1, $2,
           (SELECT cg.facility_id FROM class_group cg WHERE cg.id = $2),
           $3, $4::time, $5
         )
         RETURNING id`,
        [organizationId, groupId, weekday, startTime, durationMinutes],
      );

      // And on the lane the turma uses. `booking_lane` is where a booking
      // actually sits; `class_group.lane_id` is the turma's default, the way
      // `capacity` is.
      await syncBookingLanes(tx, organizationId, groupId);
    } catch (error) {
      if (error instanceof Error && (error as { code?: string }).code === '23505') {
        return 'duplicate';
      }
      const refused = scheduleRefusal(error);
      if (refused !== null) return refused;
      throw error;
    }

    await recordAudit(tx, {
      action: 'class_schedule.added',
      entityType: 'class_group',
      entityId: groupId,
      data: { weekday, startTime, durationMinutes },
    });

    return 'added';
  });
}

/**
 * Move an existing slot to another day or time — round 5, drag and drop.
 *
 * **An UPDATE, not a delete and an insert.** The two are equivalent in the table
 * and are not equivalent anywhere else: the schedule row's id is what
 * `generate_sessions` and the audit trail point at, so recreating it turns "the
 * Tuesday class moved to Thursday" into "a Tuesday class disappeared and a
 * Thursday one appeared", which is a worse answer to the only question anybody
 * asks of the log.
 *
 * The facility-hours trigger fires on this update because `weekday` and
 * `start_time` are both in its column list, so a drag onto a closed day or past
 * closing time is refused by the same rule that refuses it in the form. Dragging
 * cannot get round a constraint typing could not.
 */
export async function moveSchedule(
  organizationId: string,
  groupId: string,
  scheduleId: string,
  weekday: number,
  startTime: string,
): Promise<'moved' | 'not_found' | 'duplicate' | ScheduleRefusal> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ weekday: number; start_time: string }>(
      `SELECT weekday, start_time::text AS start_time
         FROM class_schedule
        WHERE id = $1 AND class_group_id = $2 AND archived_at IS NULL`,
      [scheduleId, groupId],
    );

    const before = rows[0];
    if (!before) return 'not_found';

    try {
      await tx.query(
        `UPDATE class_schedule
            SET weekday = $2, start_time = $3::time
          WHERE id = $1 AND archived_at IS NULL`,
        [scheduleId, weekday, startTime],
      );
    } catch (error) {
      if (error instanceof Error && (error as { code?: string }).code === '23505') {
        return 'duplicate';
      }
      // The same refusals as adding one, for the same reasons. Dragging cannot
      // get round a rule typing could not, and it must not report it as a crash.
      const refused = scheduleRefusal(error);
      if (refused !== null) return refused;
      throw error;
    }

    /*
     * The weeks that have not happened yet follow the pattern — this week
     * forward. Weeks already taught keep the time they were actually taught
     * at, and a week somebody moved by hand is left where they put it.
     */
    const realigned = await realignFutureSessions(tx, organizationId, scheduleId);

    await recordAudit(tx, {
      action: 'class_schedule.moved',
      entityType: 'class_group',
      entityId: groupId,
      // Both ends, so the log says what changed rather than only where it ended.
      data: {
        scheduleId,
        from: { weekday: before.weekday, startTime: before.start_time },
        to: { weekday, startTime },
        realigned,
      },
    });

    return 'moved';
  });
}

export async function removeSchedule(
  organizationId: string,
  groupId: string,
  scheduleId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE class_schedule SET archived_at = now()
        WHERE id = $1 AND class_group_id = $2 AND archived_at IS NULL
      RETURNING id`,
      [scheduleId, groupId],
    );
    if (!rows[0]) return false;

    await recordAudit(tx, {
      action: 'class_schedule.removed',
      entityType: 'class_group',
      entityId: groupId,
      data: { scheduleId },
    });
    return true;
  });
}

// ---------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------

/**
 * Puts a student in a turma, or on its waiting list.
 *
 * Capacity is checked here so the operator gets a sentence rather than a
 * constraint violation — but the guarantee is the locking trigger in the
 * database, because two people taking the last place at the same moment would
 * both pass this check.
 */
export async function enrol(
  organizationId: string,
  groupId: string,
  studentId: string,
  waiting: boolean,
): Promise<'enrolled' | 'waiting' | 'not_found'> {
  try {
    return await withOrg(organizationId, async (tx) => {
      const group = await tx.query<{ capacity: number | null }>(
        'SELECT capacity FROM class_group WHERE id = $1 AND archived_at IS NULL',
        [groupId],
      );
      if (!group.rows[0]) return 'not_found';

      const student = await tx.query(
        'SELECT 1 FROM student WHERE id = $1 AND archived_at IS NULL',
        [studentId],
      );
      if (student.rows.length === 0) return 'not_found';

      const status = waiting ? 'waiting' : 'active';
      const position = waiting
        ? (
            await tx.query<{ next: number }>(
              `SELECT coalesce(max(waiting_position), 0) + 1 AS next
                 FROM enrollment WHERE class_group_id = $1 AND status = 'waiting'`,
              [groupId],
            )
          ).rows[0]?.next ?? 1
        : null;

      await tx.query(
        `INSERT INTO enrollment (
           organization_id, class_group_id, student_id, status, waiting_position
         ) VALUES ($1, $2, $3, $4::enrollment_status, $5)`,
        [organizationId, groupId, studentId, status, position],
      );

      await recordAudit(tx, {
        action: 'enrollment.created',
        entityType: 'class_group',
        entityId: groupId,
        data: { studentId, status },
      });

      return waiting ? 'waiting' : 'enrolled';
    });
  } catch (error) {
    const code = error instanceof Error ? (error as { code?: string }).code : undefined;
    // 23505 is enrollment_live_uq; 23514 is the capacity trigger, which raises
    // with a check_violation code so it reads like the constraint it is.
    if (code === '23505') throw new AlreadyEnrolledError(studentId);
    if (code === '23514') throw new FullError(groupId);
    throw error;
  }
}

export async function endEnrollment(
  organizationId: string,
  groupId: string,
  enrollmentId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ student_id: string }>(
      `UPDATE enrollment
          SET status = 'ended', ended_on = current_date, waiting_position = NULL
        WHERE id = $1 AND class_group_id = $2 AND status <> 'ended'
      RETURNING student_id`,
      [enrollmentId, groupId],
    );
    if (!rows[0]) return false;

    await recordAudit(tx, {
      action: 'enrollment.ended',
      entityType: 'class_group',
      entityId: groupId,
      data: { studentId: rows[0].student_id },
    });
    return true;
  });
}

// ---------------------------------------------------------------------------
// One student's week
// ---------------------------------------------------------------------------

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

export async function timetableFor(
  organizationId: string,
  studentId: string,
): Promise<TimetableEntry[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      class_group_id: string;
      class_name: string;
      level_name: string | null;
      pool_name: string | null;
      instructor_name: string | null;
      lane: number | null;
      weekday: number;
      start_time: string;
      duration_minutes: number;
      status: 'active' | 'waiting';
    }>(
      `
      SELECT cg.id AS class_group_id,
             cg.name AS class_name,
             l.name AS level_name,
             p.name AS pool_name,
             short_name(u.cached_first_name, u.cached_last_name) AS instructor_name,
             ln.position AS lane,
             cs.weekday,
             to_char(cs.start_time, 'HH24:MI') AS start_time,
             cs.duration_minutes,
             e.status
        FROM enrollment e
        JOIN class_group cg
          ON cg.id = e.class_group_id AND cg.organization_id = e.organization_id
         AND cg.archived_at IS NULL
        JOIN class_schedule cs
          ON cs.class_group_id = cg.id AND cs.organization_id = cg.organization_id
         AND cs.archived_at IS NULL
        LEFT JOIN student_level l ON l.id = cg.level_id AND l.organization_id = cg.organization_id
        LEFT JOIN pool p         ON p.id = cg.pool_id  AND p.organization_id = cg.organization_id
        LEFT JOIN lane ln        ON ln.id = cg.lane_id AND ln.organization_id = cg.organization_id
        LEFT JOIN membership m   ON m.id = cg.instructor_membership_id
                                AND m.organization_id = cg.organization_id
        LEFT JOIN app_user u     ON u.id = m.app_user_id
       WHERE e.student_id = $1
         AND e.status <> 'ended'
       ORDER BY cs.weekday, cs.start_time
      `,
      [studentId],
    );

    return rows.map((row) => ({
      classGroupId: row.class_group_id,
      className: row.class_name,
      levelName: row.level_name,
      poolName: row.pool_name,
      instructorName: row.instructor_name,
      lane: row.lane,
      weekday: row.weekday,
      startTime: row.start_time,
      durationMinutes: row.duration_minutes,
      status: row.status,
    }));
  });
}

function asDuplicate(error: unknown, name: string): unknown {
  if (error instanceof Error && (error as { code?: string }).code === '23505') {
    return new DuplicateNameError(name);
  }
  return error;
}

/**
 * Moving one week's class, without moving every week's.
 *
 * A drag used to edit the pattern, which changes the class for the rest of the
 * season. That is right about half the time; the other half is "the pool is
 * booked this Tuesday, put *this week's* class on Wednesday", and there was no
 * way to say it.
 *
 * This is that half. It moves the occurrence and nothing else, stamps
 * `moved_at`, and leaves `occurs_on` alone — which is what stops the next
 * regeneration quietly putting a second class back on Tuesday.
 *
 * The lane rows follow through `class_session_lane_sync`, so the lane the class
 * moved into is the one the exclusion constraint checks. A clash comes back as
 * `occupied` rather than as a stack trace: the lane is genuinely busy, and that
 * is a sentence an operator can act on.
 */
export async function moveOccurrence(
  organizationId: string,
  sessionId: string,
  date: string,
  startTime: string,
): Promise<'moved' | 'not_found' | 'occupied'> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ starts_at: Date; occurs_on: string }>(
      `SELECT starts_at, occurs_on::text AS occurs_on
         FROM class_session
        WHERE id = $1 AND status <> 'cancelled'`,
      [sessionId],
    );

    const before = rows[0];
    if (!before) return 'not_found';

    try {
      /*
       * The caller gives a day and a wall clock, not an instant, because that
       * is what somebody dragging a chip onto Wednesday 18:00 means. The pool
       * knows which timezone that clock is in, so the conversion happens here
       * rather than in a browser that would have to be told.
       */
      await tx.query(
        `UPDATE class_session cs
            SET starts_at = ($2::date + $3::time) AT TIME ZONE coalesce((
                  SELECT f.timezone
                    FROM pool p
                    JOIN facility f
                      ON f.id = p.facility_id AND f.organization_id = p.organization_id
                   WHERE p.id = cs.pool_id AND p.organization_id = cs.organization_id
                ), 'Europe/Lisbon'),
                moved_at = now()
          WHERE cs.id = $1`,
        [sessionId, date, startTime],
      );
    } catch (error) {
      // 23P01 is the lane exclusion; 23505 the one-occurrence-per-booking key.
      const code = (error as { code?: string }).code;
      if (code === '23P01' || code === '23505') return 'occupied';
      throw error;
    }

    await recordAudit(tx, {
      action: 'class_session.moved',
      entityType: 'class_session',
      entityId: sessionId,
      // Both ends, and the week it belongs to — so the log says what changed
      // rather than only where it ended up.
      data: {
        occursOn: before.occurs_on,
        from: before.starts_at.toISOString(),
        to: `${date} ${startTime}`,
      },
    });

    return 'moved';
  });
}

/**
 * The future occurrences of a pattern that has just moved.
 *
 * "Every week" means this week forward. Weeks already taught keep the time they
 * were actually taught at, because a register is a record of what happened and
 * rewriting it would make the record wrong.
 *
 * **Sessions somebody moved by hand are skipped.** They already said what should
 * happen that week, and a later "every week" must not silently undo it — which
 * is the whole reason `moved_at` exists.
 *
 * **`occurs_on` moves with them**, and that is the part worth reading twice. It
 * is the day the pattern implies, so when the pattern moves to Thursday the
 * occurrence's day is Thursday. Leaving it on Tuesday would mean the next
 * regeneration found no session for the Thursday the pattern now implies and
 * created a second one — the class twice in one week, which is exactly the bug
 * `occurs_on` was added to prevent.
 *
 * Cancelled ones are skipped: a class that is not happening has no time to move,
 * and shifting it would collide it with whatever has since taken its lane.
 */
export async function realignFutureSessions(
  tx: Tx,
  organizationId: string,
  scheduleId: string,
): Promise<number> {
  const { rowCount } = await tx.query(
    `
    WITH moved AS (
      SELECT cs.id,
             /*
              * The same week, on the pattern's new weekday. ISO weekdays run
              * 1..7, so the difference is a plain number of days either way.
              */
             cs.occurs_on
               + (sch.weekday - extract(ISODOW FROM cs.occurs_on)::int) AS on_date,
             sch.start_time,
             sch.duration_minutes,
             -- A class happens at a wall clock, not at an instant.
             coalesce(f.timezone, 'Europe/Lisbon') AS timezone
        FROM class_session cs
        JOIN class_schedule sch
          ON sch.id = cs.schedule_id AND sch.organization_id = cs.organization_id
        LEFT JOIN facility f
          ON f.id = sch.facility_id AND f.organization_id = sch.organization_id
       WHERE sch.id = $1
         AND cs.organization_id = $2
         AND cs.occurs_on >= current_date
         AND cs.moved_at IS NULL
         AND cs.status <> 'cancelled'
    )
    UPDATE class_session cs
       SET occurs_on = m.on_date,
           starts_at = (m.on_date + m.start_time) AT TIME ZONE m.timezone,
           duration_minutes = m.duration_minutes
      FROM moved m
     WHERE cs.id = m.id
    `,
    [scheduleId, organizationId],
  );

  return rowCount ?? 0;
}
