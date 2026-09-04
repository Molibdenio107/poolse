import { withOrg, type Tx } from '@poolse/db';
import { isContiguous, type RuleLane } from '@poolse/rules';
import { recordAudit } from '../audit/audit.js';
import {
  canCommit,
  previewTimetable,
  type RawTimetableRow,
  type TimetableContext,
  type TimetableRow,
  type TimetableSummary,
} from './timetable-import.js';

/**
 * Moving, spanning and duplicating a booking — POOLSE-50.
 *
 * Building a season is a morning of moving blocks around, and the single
 * most-used action is not "move" — it is **"put another one of these on
 * Thursday"**. The reference schedule repeats the same block on 2ª, 4ª and 6ª,
 * so a duplicate that costs one gesture instead of three form submissions is
 * most of what makes the grid worth having.
 *
 * **One writer for all four gestures.** Move, span, duplicate and the keyboard
 * versions of each all land here, because the alternative is two code paths that
 * agree until the day one of them is fixed. The Dev note asks for the same thing
 * on the client — a single reducer both the pointer and the keyboard call.
 *
 * **Lane spans are contiguous or refused.** Lanes 2 and 4 with 3 free between
 * them is not a booking a pool can honour, and it is not something the reference
 * sheet ever does. Refused here as well as at the gesture, because the gesture is
 * a convenience and this is the rule.
 */

/** Raised when the target lanes are not a single unbroken run. */
export class NonContiguousLanesError extends Error {
  constructor() {
    super('lanes must be contiguous');
  }
}

/** Raised when a lane in the target span is already taken at that day and time. */
export class LaneTakenError extends Error {
  constructor(readonly laneName: string, readonly holder: string) {
    super('lane taken');
  }
}

/** Raised when the same subject already sits at that day and time. */
export class DuplicateBookingError extends Error {
  constructor() {
    super('already there');
  }
}

/**
 * Raised when the facility is shut then, or the booking would run past closing.
 *
 * **It carries a reason and the hours, not the database's sentence.** The
 * trigger raises prose — "Piscina Municipal opens 08:00 to 20:00 on ISO weekday
 * 2, class starts 21:00" — which is English, is not a translation key, and is
 * the wrong thing to put in front of an operator working in Portuguese. The API
 * owns no locale; the web app owns every string. So this parses the trigger's
 * message into a code plus the two facts a sentence needs, and the interface
 * composes it.
 */
export type ClosedReason = 'closedThatDay' | 'outsideHours' | 'endsAfterClosing';

export class ClosedError extends Error {
  constructor(
    readonly reason: ClosedReason,
    /** `HH:MM`, when the trigger said. Absent for a day the site does not open. */
    readonly opensAt: string | null,
    readonly closesAt: string | null,
    /** The raw message, for the log. Never shown to anybody. */
    readonly detail: string,
  ) {
    super('closed');
  }
}

/** `08:00:00` and `08:00` both become `08:00`; anything else becomes null. */
function clock(raw: string | undefined): string | null {
  return raw !== undefined && /^\d{2}:\d{2}/.test(raw) ? raw.slice(0, 5) : null;
}

/**
 * The trigger's prose, read back into a reason and the hours it named.
 *
 * Keyed on the prefix rather than on the words after it, which is the same
 * contract `scheduleRefusal` in `classes.repository.ts` already relies on — the
 * prefixes are the API between the trigger and the application and the sentence
 * after them is free to be reworded.
 */
export function readClosed(message: string): ClosedError {
  if (message.startsWith('facility_closed_on_weekday:')) {
    return new ClosedError('closedThatDay', null, null, message);
  }

  if (message.startsWith('outside_facility_hours:')) {
    // "… opens 08:00:00 to 20:00:00 on ISO weekday 2, class starts 21:00:00"
    const times = message.match(/\d{2}:\d{2}(:\d{2})?/g) ?? [];
    return new ClosedError('outsideHours', clock(times[0]), clock(times[1]), message);
  }

  if (message.startsWith('class_ends_after_closing:')) {
    // "… closes at 20:00:00 on ISO weekday 2, class runs 19:30:00 to 20:30:00"
    const times = message.match(/\d{2}:\d{2}(:\d{2})?/g) ?? [];
    return new ClosedError('endsAfterClosing', null, clock(times[0]), message);
  }

  // Some other check constraint. Nothing here knows what to say about it, and
  // guessing would put a confident wrong sentence in front of an operator.
  return new ClosedError('closedThatDay', null, null, message);
}

export interface BookingTarget {
  weekday: number;
  /** The grid row it landed on. Null puts it fora da grelha at an explicit time. */
  slotId: string | null;
  /** Only when `slotId` is null — otherwise the slot's own hours are the truth. */
  startTime: string | null;
  laneIds: string[];
  /**
   * An explicit length, overriding the slot's — POOLSE-50, time span.
   *
   * Absent means "take the row's length", which is what a plain move does and
   * what makes the grid the club's grid. Present means somebody dragged the
   * block's bottom edge: a 90-minute masters session in a grid of 45-minute rows
   * is a real thing, and the alternative was drawing it one row tall and letting
   * the second half of it be invisible.
   */
  durationMinutes?: number | null;
}

/**
 * The lanes a booking may take, in position order, with what already holds them.
 *
 * One query rather than one per lane: a six-lane span would otherwise be six
 * round trips inside a transaction that is holding a row lock.
 */
async function laneConflicts(
  tx: Tx,
  scheduleId: string,
  weekday: number,
  startTime: string,
  durationMinutes: number,
  laneIds: string[],
): Promise<{ laneName: string; holder: string } | null> {
  if (laneIds.length === 0) return null;

  const { rows } = await tx.query<{ lane_name: string; holder: string }>(
    /*
     * Overlap, not equality. A 45-minute class at 09:00 and a 60-minute one at
     * 09:30 are a clash even though no two columns match — comparing start times
     * would let the second one through and the pool would be double-sold.
     */
    `SELECT l.name AS lane_name,
            coalesce(cg.name, pg.name, cs.title, '?') AS holder
       FROM booking_lane bl
       JOIN class_schedule cs
         ON cs.id = bl.schedule_id AND cs.organization_id = bl.organization_id
       JOIN lane l ON l.id = bl.lane_id AND l.organization_id = bl.organization_id
       LEFT JOIN class_group cg
         ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
       LEFT JOIN partner_group pg
         ON pg.id = cs.partner_group_id AND pg.organization_id = cs.organization_id
      WHERE bl.lane_id = ANY($1::uuid[])
        AND cs.archived_at IS NULL
        AND cs.weekday = $2
        AND cs.id <> $3
        AND (cs.start_time, cs.start_time + make_interval(mins => cs.duration_minutes))
            OVERLAPS ($4::time, $4::time + make_interval(mins => $5))
      ORDER BY l.position
      LIMIT 1`,
    [laneIds, weekday, scheduleId, startTime, durationMinutes],
  );

  const hit = rows[0];
  return hit === undefined ? null : { laneName: hit.lane_name, holder: hit.holder };
}

/**
 * Whether the given lanes are one unbroken run within a single pool.
 *
 * Positions, not ids — the grid orders lanes by position and a "span" means the
 * rows between two edges. Lanes drawn from two different tanks are never
 * contiguous however their positions happen to number.
 */
async function assertContiguous(tx: Tx, laneIds: string[]): Promise<void> {
  if (laneIds.length < 2) return;

  const { rows } = await tx.query<{ id: string; pool_id: string; position: number }>(
    `SELECT id, pool_id, position FROM lane
      WHERE id = ANY($1::uuid[]) AND archived_at IS NULL`,
    [laneIds],
  );

  /*
   * The judgement is `@poolse/rules`', not this file's — POOLSE-51, criterion 10.
   *
   * The browser runs the same function while the pointer is still moving, so the
   * cell that said "fine" and the endpoint that accepts the drop cannot disagree.
   * All this does is fetch the lanes the pure function needs; reimplementing the
   * check here would be the exact divergence the criterion exists to prevent.
   */
  const lanes: RuleLane[] = rows.map((row) => ({
    id: row.id,
    poolId: row.pool_id,
    name: '',
    position: row.position,
    defaultCapacity: null,
  }));

  if (rows.length !== laneIds.length) throw new NonContiguousLanesError();
  if (!isContiguous(laneIds, lanes)) throw new NonContiguousLanesError();
}

/** The time a target implies: the slot's own start, or an explicit one. */
async function timeFor(
  tx: Tx,
  target: BookingTarget,
): Promise<{ startTime: string; durationMinutes: number | null }> {
  if (target.slotId === null) {
    return { startTime: target.startTime ?? '00:00', durationMinutes: null };
  }

  const { rows } = await tx.query<{ start_time: string; minutes: number }>(
    `SELECT start_time::text,
            (extract(epoch FROM (end_time - start_time)) / 60)::int AS minutes
       FROM facility_time_slot
      WHERE id = $1 AND archived_at IS NULL`,
    [target.slotId],
  );

  const slot = rows[0];
  if (slot === undefined) return { startTime: target.startTime ?? '00:00', durationMinutes: null };

  /*
   * A block dropped into a row takes that row's length.
   *
   * That is what makes the grid the club's grid rather than a backdrop: 09:00
   * to 09:45 is a real span the building runs on, and a class landing in it that
   * kept a 60-minute duration would draw over the row below.
   */
  return { startTime: slot.start_time.slice(0, 5), durationMinutes: slot.minutes };
}

/** 23505 on the subject index, 23514/`P0001` from the facility-hours trigger. */
function classify(error: unknown): never {
  const code = (error as { code?: string }).code;
  if (code === '23505') throw new DuplicateBookingError();
  if (code === '23514' || code === 'P0001') {
    throw readClosed((error as { message?: string }).message ?? '');
  }
  throw error;
}

/** Replaces a booking's lanes wholesale. Simpler than diffing, and atomic. */
async function setLanes(
  tx: Tx,
  organizationId: string,
  scheduleId: string,
  laneIds: string[],
): Promise<void> {
  await tx.query(`DELETE FROM booking_lane WHERE schedule_id = $1`, [scheduleId]);
  if (laneIds.length === 0) return;

  await tx.query(
    `INSERT INTO booking_lane (organization_id, schedule_id, lane_id)
     SELECT $1, $2, unnest($3::uuid[])`,
    [organizationId, scheduleId, laneIds],
  );
}

/**
 * Moves a booking to a day, a slot and a set of lanes.
 *
 * Covers the plain move, the lane-only span and any combination — the client
 * sends where the block ended up and this puts it there, which is the single
 * reducer the ticket asks for rather than three endpoints that drift.
 */
export async function moveBooking(
  organizationId: string,
  scheduleId: string,
  target: BookingTarget,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ duration_minutes: number; name: string }>(
      `SELECT cs.duration_minutes,
              coalesce(cg.name, pg.name, cs.title, '?') AS name
         FROM class_schedule cs
         LEFT JOIN class_group cg
           ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
         LEFT JOIN partner_group pg
           ON pg.id = cs.partner_group_id AND pg.organization_id = cs.organization_id
        WHERE cs.id = $1 AND cs.archived_at IS NULL
        FOR UPDATE OF cs`,
      [scheduleId],
    );

    const booking = rows[0];
    if (booking === undefined) return false;

    await assertContiguous(tx, target.laneIds);

    const { startTime, durationMinutes } = await timeFor(tx, target);
    // The caller's own length wins over the slot's, and the slot's over the one
    // the booking already had.
    const duration = target.durationMinutes ?? durationMinutes ?? booking.duration_minutes;

    const clash = await laneConflicts(
      tx,
      scheduleId,
      target.weekday,
      startTime,
      duration,
      target.laneIds,
    );
    if (clash !== null) throw new LaneTakenError(clash.laneName, clash.holder);

    try {
      await tx.query(
        `UPDATE class_schedule
            SET weekday = $2, start_time = $3::time, duration_minutes = $4, slot_id = $5
          WHERE id = $1`,
        [scheduleId, target.weekday, startTime, duration, target.slotId],
      );
    } catch (error) {
      classify(error);
    }

    await setLanes(tx, organizationId, scheduleId, target.laneIds);

    await recordAudit(tx, {
      action: 'booking.moved',
      entityType: 'class_schedule',
      entityId: scheduleId,
      data: {
        name: booking.name,
        weekday: target.weekday,
        startTime,
        lanes: target.laneIds.length,
      },
    });

    return true;
  });
}

/**
 * Copies a booking onto another day, slot and lanes — the season-building move.
 *
 * **The copy carries the subject, the instructor, the category and the lane
 * span. It does not carry the notes.** A note on a booking almost always names a
 * date or a reason — "sala ocupada até Novembro" — and carrying it onto a
 * different day would restate something that is no longer true.
 *
 * One transaction for the row and its lanes, so a copy is never half-made: a
 * booking that exists with no lanes looks, on the grid, exactly like a booking
 * somebody forgot to place.
 */
export async function duplicateBooking(
  organizationId: string,
  scheduleId: string,
  target: BookingTarget,
): Promise<{ id: string } | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ duration_minutes: number; name: string }>(
      `SELECT duration_minutes,
              coalesce((SELECT name FROM class_group cg
                         WHERE cg.id = cs.class_group_id
                           AND cg.organization_id = cs.organization_id),
                       (SELECT name FROM partner_group pg
                         WHERE pg.id = cs.partner_group_id
                           AND pg.organization_id = cs.organization_id),
                       cs.title, '?') AS name
         FROM class_schedule cs
        WHERE cs.id = $1 AND cs.archived_at IS NULL`,
      [scheduleId],
    );

    const source = rows[0];
    if (source === undefined) return null;

    await assertContiguous(tx, target.laneIds);

    const { startTime, durationMinutes } = await timeFor(tx, target);
    const duration = target.durationMinutes ?? durationMinutes ?? source.duration_minutes;

    // The new row is not yet in the table, so nothing to exclude from the check.
    const clash = await laneConflicts(
      tx,
      '00000000-0000-0000-0000-000000000000',
      target.weekday,
      startTime,
      duration,
      target.laneIds,
    );
    if (clash !== null) throw new LaneTakenError(clash.laneName, clash.holder);

    let copyId: string;
    try {
      const inserted = await tx.query<{ id: string }>(
        /*
         * Column by column from the original, so a column added later is a
         * deliberate decision about whether a copy should carry it rather than
         * something `select *` silently inherits. `notes` is the one that is
         * deliberately absent — see the header.
         */
        `INSERT INTO class_schedule
           (organization_id, facility_id, subject_type, class_group_id, partner_group_id,
            season_id, slot_id, instructor_membership_id, instructor_status,
            headcount_override, category_id, title, weekday, start_time, duration_minutes)
         SELECT organization_id, facility_id, subject_type, class_group_id, partner_group_id,
                season_id, $3, instructor_membership_id, instructor_status,
                headcount_override, category_id, title, $2, $4::time, $5
           FROM class_schedule
          WHERE id = $1
         RETURNING id`,
        [scheduleId, target.weekday, target.slotId, startTime, duration],
      );
      copyId = inserted.rows[0]!.id;
    } catch (error) {
      classify(error);
    }

    await setLanes(tx, organizationId, copyId, target.laneIds);

    await recordAudit(tx, {
      action: 'booking.duplicated',
      entityType: 'class_schedule',
      entityId: copyId,
      data: { from: scheduleId, name: source.name, weekday: target.weekday, startTime },
    });

    return { id: copyId };
  });
}

/**
 * The operator escalates a slot to "sem professor", or takes it back — POOLSE-53.
 *
 * **Only between the two states a person is entitled to set.** `assigned` and
 * `external` are facts the database maintains for itself — somebody is teaching
 * this, or the school is sending someone — and letting a request claim either
 * would put a name-shaped blank on the grid. The state machine in
 * `1788019200000_instructor-status.sql` would overrule it on the way in anyway;
 * refusing here means the caller finds out rather than watching a save appear to
 * work and read back differently.
 *
 * The interesting outcome is the one that looks like a bug: escalating a booking
 * that turns out to have an instructor comes back `assigned`, because the
 * trigger corrected it. So the new state is **returned**, not assumed, and the
 * screen renders what the database actually holds.
 */
export type SettableStatus = 'to_define' | 'uncovered';

export async function setInstructorStatus(
  organizationId: string,
  scheduleId: string,
  status: SettableStatus,
): Promise<{ status: string } | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ name: string; instructor_status: string }>(
      `UPDATE class_schedule cs
          SET instructor_status = $2
        WHERE cs.id = $1 AND cs.archived_at IS NULL
      RETURNING cs.instructor_status,
                coalesce(
                  (SELECT cg.name FROM class_group cg
                    WHERE cg.id = cs.class_group_id
                      AND cg.organization_id = cs.organization_id),
                  (SELECT pg.name FROM partner_group pg
                    WHERE pg.id = cs.partner_group_id
                      AND pg.organization_id = cs.organization_id),
                  cs.title, '?') AS name`,
      [scheduleId, status],
    );

    const updated = rows[0];
    if (updated === undefined) return null;

    /*
     * Audited, because it is the club saying a slot is a problem — or saying it
     * is not one any more. That second one is the reason this is in the log: a
     * gap that stopped being reported and nobody remembers deciding to stop
     * reporting it is exactly the question a manager asks in October.
     */
    await recordAudit(tx, {
      action: 'booking.instructor_status',
      entityType: 'class_schedule',
      entityId: scheduleId,
      data: { name: updated.name, status: updated.instructor_status },
    });

    return { status: updated.instructor_status };
  });
}

/**
 * Who is teaching this booking — the other half of POOLSE-53.
 *
 * The alert said "2 por definir", clicking it filtered the grid to those two,
 * and then there was nothing to do to them: `class_schedule.instructor_membership_id`
 * had no interface at all. A turma could be staffed by leaving the grid and
 * editing the turma; a **parceria could not be staffed by one of the club's own
 * instructors by any route**, because it has no turma to edit.
 *
 * A counter that names a problem and offers no way to fix it is worse than no
 * counter: it teaches the operator that the number is somebody else's job.
 *
 * **It writes the booking's own override, never the turma's instructor.** Those
 * are different facts — "Sandra runs Cadetes" against "somebody is covering
 * Cadetes this Tuesday" — and POOLSE-46 added the column precisely so a
 * substitute on one day shows as the substitute rather than silently
 * reassigning the whole turma. Editing the turma is still where "Sandra runs
 * Cadetes" is said, and that is the Turmas screen's job.
 *
 * Null clears the override, which returns the booking to the turma's own
 * instructor — or, where there is none, to `to_define` by POOLSE-53's trigger.
 * The status is never written here: it is the database's, and it follows.
 */
export async function assignInstructor(
  organizationId: string,
  scheduleId: string,
  membershipId: string | null,
): Promise<{ status: string; instructorName: string | null } | null> {
  return withOrg(organizationId, async (tx) => {
    if (membershipId !== null) {
      /*
       * The person has to be an instructor at this club.
       *
       * Checked rather than trusted: the composite key stops another tenant's
       * membership, and this stops a member of *this* tenant who does not
       * teach — a student id pasted into the request would otherwise put a
       * twelve-year-old on the timetable as staff.
       */
      const { rowCount } = await tx.query(
        `SELECT 1
           FROM membership m
           JOIN membership_role r
             ON r.membership_id = m.id AND r.organization_id = m.organization_id
          WHERE m.id = $1 AND m.archived_at IS NULL AND r.role = 'instructor'`,
        [membershipId],
      );
      if (rowCount === 0) return null;
    }

    const { rows } = await tx.query<{
      instructor_status: string;
      name: string | null;
      subject: string;
    }>(
      `UPDATE class_schedule cs
          SET instructor_membership_id = $2
        WHERE cs.id = $1 AND cs.archived_at IS NULL
      RETURNING cs.instructor_status::text AS instructor_status,
                (SELECT nullif(btrim(concat_ws(' ',
                          coalesce(u.cached_first_name, m.first_name),
                          coalesce(u.cached_last_name,  m.last_name))), '')
                   FROM membership m
                   LEFT JOIN app_user u ON u.id = m.app_user_id
                  WHERE m.id = coalesce(cs.instructor_membership_id,
                                        (SELECT cg.instructor_membership_id
                                           FROM class_group cg
                                          WHERE cg.id = cs.class_group_id
                                            AND cg.organization_id = cs.organization_id))
                    AND m.organization_id = cs.organization_id) AS name,
                coalesce(
                  (SELECT cg.name FROM class_group cg
                    WHERE cg.id = cs.class_group_id
                      AND cg.organization_id = cs.organization_id),
                  (SELECT pg.name FROM partner_group pg
                    WHERE pg.id = cs.partner_group_id
                      AND pg.organization_id = cs.organization_id),
                  cs.title, '?') AS subject`,
      [scheduleId, membershipId],
    );

    const updated = rows[0];
    if (updated === undefined) return null;

    await recordAudit(tx, {
      action: 'booking.instructor_assigned',
      entityType: 'class_schedule',
      entityId: scheduleId,
      data: {
        name: updated.subject,
        instructor: updated.name,
        status: updated.instructor_status,
      },
    });

    return { status: updated.instructor_status, instructorName: updated.name };
  });
}

/* ------------------------------------------- importing a timetable — POOLSE-57 */

export interface TimetableImportRequest {
  facilityId: string;
  rows: RawTimetableRow[];
  commit: boolean;
  /**
   * Rows the operator dropped in the conflict dialog — decision 2.
   *
   * Dropping a row is how a clash gets decided: the incoming class yields to
   * what is already there. Nothing is ever overwritten, so this is the only
   * verb the dialog has, and a row left out of the file is a row nobody
   * imports rather than a booking somebody loses.
   */
  drop: number[];
}

export interface TimetableImportResult {
  rows: TimetableRow[];
  summary: TimetableSummary;
  committable: boolean;
  /** Only on a commit. */
  created?: number;
}

/** The grid this facility already keeps, as `packages/rules` wants to see it. */
async function timetableContext(
  tx: Tx,
  facilityId: string,
  seasonId: string,
): Promise<TimetableContext> {
  const lanes = await tx.query<{
    id: string;
    name: string;
    pool_id: string;
    position: number;
    default_capacity: number | null;
  }>(
    `SELECT l.id, l.name, l.pool_id, l.position, l.default_capacity
       FROM lane l
       JOIN pool p ON p.id = l.pool_id AND p.organization_id = l.organization_id
      WHERE p.facility_id = $1 AND l.archived_at IS NULL AND p.archived_at IS NULL
      ORDER BY p.name, l.position`,
    [facilityId],
  );

  const instructors = await tx.query<{ id: string; name: string }>(
    `SELECT m.id,
            nullif(btrim(concat_ws(' ',
              coalesce(u.cached_first_name, m.first_name),
              coalesce(u.cached_last_name,  m.last_name))), '') AS name
       FROM membership m
       LEFT JOIN app_user u ON u.id = m.app_user_id
       JOIN membership_role r
         ON r.membership_id = m.id AND r.organization_id = m.organization_id
      WHERE r.role = 'instructor' AND m.archived_at IS NULL`,
  );

  const existing = await tx.query<{
    id: string;
    name: string;
    weekday: number;
    start_time: string;
    duration_minutes: number;
    lane_ids: string[] | null;
    pool_id: string | null;
    instructor_id: string | null;
    level_id: string | null;
    headcount: number | null;
  }>(
    `SELECT cs.id,
            coalesce(cg.name, pg.name, cs.title, '?')            AS name,
            cs.weekday, cs.start_time::text, cs.duration_minutes,
            coalesce(bl.lane_ids, '{}')                          AS lane_ids,
            cg.pool_id,
            coalesce(cs.instructor_membership_id, cg.instructor_membership_id)
                                                                 AS instructor_id,
            coalesce(cg.level_id, pg.level_id)                   AS level_id,
            coalesce(cs.headcount_override, pg.participant_count) AS headcount
       FROM class_schedule cs
       LEFT JOIN class_group cg
         ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
       LEFT JOIN partner_group pg
         ON pg.id = cs.partner_group_id AND pg.organization_id = cs.organization_id
       LEFT JOIN LATERAL (
         SELECT array_agg(b.lane_id) AS lane_ids
           FROM booking_lane b
          WHERE b.schedule_id = cs.id AND b.organization_id = cs.organization_id
       ) bl ON true
      WHERE cs.facility_id = $1
        AND cs.archived_at IS NULL
        AND coalesce(cs.season_id, cg.season_id) = $2`,
    [facilityId, seasonId],
  );

  const hours = await tx.query<{ weekday: number }>(
    `SELECT weekday FROM facility_hours WHERE facility_id = $1 AND available`,
    [facilityId],
  );

  const capacities = await tx.query<{ lane_id: string; level_id: string; capacity: number }>(
    `SELECT llc.lane_id, llc.level_id, llc.capacity
       FROM lane_level_capacity llc
       JOIN lane l ON l.id = llc.lane_id AND l.organization_id = llc.organization_id
       JOIN pool p ON p.id = l.pool_id AND p.organization_id = l.organization_id
      WHERE p.facility_id = $1`,
    [facilityId],
  );

  const limit = await tx.query<{ max_concurrent_groups_per_instructor: number | null }>(
    `SELECT max_concurrent_groups_per_instructor FROM facility WHERE id = $1`,
    [facilityId],
  );

  const minutes = (clock: string): number => {
    const [h, m] = clock.split(':');
    return Number(h) * 60 + Number(m);
  };

  return {
    lanes: lanes.rows.map((row) => ({
      id: row.id,
      name: row.name,
      poolId: row.pool_id,
      position: row.position,
      defaultCapacity: row.default_capacity,
    })),
    instructors: instructors.rows
      .filter((row): row is { id: string; name: string } => row.name !== null)
      .map((row) => ({ id: row.id, name: row.name })),
    existing: existing.rows.map((row) => ({
      id: row.id,
      name: row.name,
      weekday: row.weekday,
      startMinutes: minutes(row.start_time),
      durationMinutes: row.duration_minutes,
      laneIds: row.lane_ids ?? [],
      poolId: row.pool_id,
      instructorId: row.instructor_id,
      levelId: row.level_id,
      headcount: row.headcount,
      cancelled: false,
    })),
    openWeekdays: hours.rows.map((row) => row.weekday),
    // A closure cancels dated sessions, not the weekly pattern an import
    // writes — so the pattern is judged against the club's opening hours and
    // nothing else. POOLSE-31 is where a closed fortnight lives.
    closures: [],
    laneLevelCapacity: Object.fromEntries(
      capacities.rows.map((row) => [`${row.lane_id}:${row.level_id}`, row.capacity]),
    ),
    maxConcurrentGroupsPerInstructor:
      limit.rows[0]?.max_concurrent_groups_per_instructor ?? null,
  };
}

/**
 * Preview, then commit — one function called twice — POOLSE-57.
 *
 * The arrangement all five importers in this codebase share, and here it carries
 * decision 1 as well: the commit re-runs the *same* preview and refuses on its
 * `committable`, so an operator cannot approve one set of rows and have another
 * written, and a file that became conflicted while they were reading it is
 * refused rather than half-applied.
 *
 * **One transaction.** `withOrg` gives it one. A half-imported timetable is the
 * thing decision 1 exists to prevent, and a failure at row thirty must take the
 * first twenty-nine with it.
 */
export async function runTimetableImport(
  organizationId: string,
  request: TimetableImportRequest,
): Promise<TimetableImportResult | null> {
  return withOrg(organizationId, async (tx) => {
    const site = await tx.query(
      `SELECT 1 FROM facility WHERE id = $1 AND archived_at IS NULL`,
      [request.facilityId],
    );
    if (site.rowCount === 0) return null;

    const season = await tx.query<{ id: string }>(
      `SELECT id FROM season WHERE status = 'published' AND archived_at IS NULL LIMIT 1`,
    );
    const seasonId = season.rows[0]?.id;
    if (seasonId === undefined) return null;

    /*
     * The dropped rows leave before anything is judged.
     *
     * Decision 2's only verb: a clash is settled by the incoming class yielding,
     * never by overwriting what is there. Removing them first also means the
     * rows that remain are re-judged *without* them, so dropping one of two
     * colliding lines clears the other's clash rather than leaving it flagged
     * against something that is no longer coming.
     */
    const dropped = new Set(request.drop);
    const kept: RawTimetableRow[] = [];
    /*
     * ...but their positions do not, and that is the whole subtlety.
     *
     * `previewTimetable` numbers rows by where they sit in the array it is
     * given, so previewing the *filtered* array renumbers everything after a
     * dropped row. The dialog sends back the numbers it was shown, and the
     * second trip through it would then drop a different row than the operator
     * pointed at — quietly, with a plausible-looking preview.
     *
     * So the original position travels with the row and is put back below. What
     * the dialog is shown and what it sends are the same numbers on every round.
     */
    const origin: number[] = [];
    request.rows.forEach((row, index) => {
      if (dropped.has(index)) return;
      kept.push(row);
      origin.push(index);
    });

    const context = await timetableContext(tx, request.facilityId, seasonId);
    const judged = previewTimetable(kept, context);
    const preview = {
      ...judged,
      rows: judged.rows.map((row) => ({ ...row, index: origin[row.index] ?? row.index })),
    };

    if (!request.commit) return { ...preview };

    // Decision 1, read from one place. A caller cannot forget a case because
    // there is only one boolean to consult.
    if (!canCommit(preview)) return { ...preview, created: 0 };

    let created = 0;

    for (const row of preview.rows) {
      if (!row.importable) continue;

      /*
       * An `evento`, not a turma.
       *
       * A cell on a wall sheet says "Masters" — a name, not a turma id. Creating
       * turmas from it would invent groups with no level, no capacity and no
       * enrolment, which is a register nobody asked for; matching it to an
       * existing turma by name would be a guess with a register attached.
       *
       * So the booking carries its own title and holds the water, which is what
       * the sheet actually asserts. The operator turns one into a turma from the
       * grid when they are ready, and until then the timetable is true.
       */
      /*
       * The day group is worked out here rather than in a `CASE` on `$4`.
       *
       * Reusing one parameter as both a `smallint` column and a comparison
       * inside a `CASE` makes Postgres refuse the statement outright —
       * "inconsistent types deduced for parameter $4" — and the honest fix is
       * not a cast but to stop asking one placeholder to be two things.
       */
      const dayGroup = row.weekday === 6 ? 'saturday' : row.weekday === 7 ? 'sunday' : 'weekday';

      const booking = await tx.query<{ id: string }>(
        `INSERT INTO class_schedule
           (organization_id, facility_id, subject_type, season_id, weekday,
            start_time, duration_minutes, title, instructor_membership_id,
            headcount_override, slot_id)
         VALUES ($1, $2, 'evento', $3, $4::smallint, $5::time, $6, $7, $8, $9,
                 (SELECT s.id FROM facility_time_slot s
                   WHERE s.facility_id = $2 AND s.season_id = $3
                     AND s.archived_at IS NULL
                     AND s.day_group = $10::day_group
                     AND s.start_time = $5::time
                   LIMIT 1))
         RETURNING id`,
        [
          organizationId,
          request.facilityId,
          seasonId,
          row.weekday,
          toClockText(row.startMinutes),
          row.durationMinutes,
          row.name,
          row.instructorId,
          row.headcount,
          dayGroup,
        ],
      );

      const scheduleId = booking.rows[0]!.id;

      for (const laneId of row.laneIds) {
        await tx.query(
          `INSERT INTO booking_lane (organization_id, schedule_id, lane_id)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [organizationId, scheduleId, laneId],
        );
      }

      created += 1;
    }

    await recordAudit(tx, {
      action: 'timetable.imported',
      entityType: 'facility',
      entityId: request.facilityId,
      data: { created, dropped: request.drop.length },
    });

    return { ...preview, created };
  });
}

/** Minutes from midnight back to `HH:MM`, for the `::time` cast. */
function toClockText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
