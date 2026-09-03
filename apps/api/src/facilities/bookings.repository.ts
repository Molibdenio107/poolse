import { withOrg, type Tx } from '@poolse/db';
import { isContiguous, type RuleLane } from '@poolse/rules';
import { recordAudit } from '../audit/audit.js';

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

/** Raised when the facility is shut then, or the booking would run past closing. */
export class ClosedError extends Error {
  constructor(readonly detail: string) {
    super('closed');
  }
}

export interface BookingTarget {
  weekday: number;
  /** The grid row it landed on. Null puts it fora da grelha at an explicit time. */
  slotId: string | null;
  /** Only when `slotId` is null — otherwise the slot's own hours are the truth. */
  startTime: string | null;
  laneIds: string[];
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
    throw new ClosedError((error as { message?: string }).message ?? '');
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
    const duration = durationMinutes ?? booking.duration_minutes;

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
    const duration = durationMinutes ?? source.duration_minutes;

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
