import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import {
  assertContiguous,
  ClosedError,
  laneConflicts,
  readClosed,
  setLanes,
} from './bookings.repository.js';

/**
 * A partnership group's days — POOLSE-117 (Rui, 28-10-2026).
 *
 * A school's class may swim on several days. Each day is its own
 * `class_schedule` row (one per group, weekday and hour, by unique index), so
 * "6A on Monday and Wednesday" is two rows — and this is **the one write path
 * that creates them**: the calendar's *Colocar aqui*, the Turmas card's
 * *Adicionar dia* and the partnerships import all call `placePartnerDaysIn`.
 *
 * **All or nothing.** Every chosen day is judged before anything is kept: the
 * lane check the grid's drag uses (`laneConflicts`), the same group already
 * there that day and hour, and — by inserting under a savepoint — the opening
 * hours and the tank's capacity, which the triggers own. If any day fails,
 * every day's reason is returned and nothing is written; a school booked on
 * Monday but not Wednesday is a half-answer the club would have to notice.
 *
 * The days are judged against each other too, for free: they are different
 * weekdays, and the lane check reads rows this transaction already wrote.
 */

export interface PartnerDaysInput {
  /** ISO weekdays, 1..7, at least one. */
  weekdays: number[];
  /** `HH:MM`, the facility's wall clock. */
  startTime: string;
  durationMinutes: number;
  /** Contiguous lanes of one tank, or none — *Sem pista*. */
  laneIds: string[];
}

/** Why one day could not be booked — one per refused day, as structure. */
export type PartnerDayClash =
  | { weekday: number; reason: 'lane_taken'; lane: string; holder: string }
  | { weekday: number; reason: 'already_booked' }
  | { weekday: number; reason: 'closed'; detail: ClosedError['reason']; opensAt: string | null; closesAt: string | null }
  | { weekday: number; reason: 'refused'; code: string };

export class PartnerDaysClashError extends Error {
  constructor(readonly clashes: PartnerDayClash[]) {
    super('partner days clash');
  }
}

/** No published season: a timetable has nowhere to be written (rule 9). */
export class NoPublishedSeasonError extends Error {}

/** A lane that is not this site's. */
export class PartnerLaneError extends Error {}

/**
 * Books a group on the given days, inside the caller's transaction. Null when
 * the group is not this club's. Throws `PartnerDaysClashError` with every
 * refused day, having written nothing.
 */
export async function placePartnerDaysIn(
  tx: Tx,
  organizationId: string,
  groupId: string,
  input: PartnerDaysInput,
): Promise<{ ids: string[] } | null> {
  const { rows: groups } = await tx.query<{ facility_id: string; name: string }>(
    `SELECT p.facility_id, g.name
       FROM partner_group g
       JOIN partner p ON p.id = g.partner_id AND p.organization_id = g.organization_id
      WHERE g.id = $1 AND g.archived_at IS NULL AND p.archived_at IS NULL`,
    [groupId],
  );
  const group = groups[0];
  if (group === undefined) return null;

  const { rows: seasons } = await tx.query<{ id: string }>(
    `SELECT id FROM season WHERE status = 'published' AND archived_at IS NULL LIMIT 1`,
  );
  const seasonId = seasons[0]?.id;
  if (seasonId === undefined) throw new NoPublishedSeasonError();

  if (input.laneIds.length > 0) {
    const { rows: known } = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM lane l JOIN pool p ON p.id = l.pool_id AND p.organization_id = l.organization_id
        WHERE l.id = ANY($1::uuid[]) AND p.facility_id = $2 AND l.archived_at IS NULL AND p.archived_at IS NULL`,
      [input.laneIds, group.facility_id],
    );
    if (known[0]!.n !== input.laneIds.length) throw new PartnerLaneError();
    await assertContiguous(tx, input.laneIds);
  }

  const clashes: PartnerDayClash[] = [];
  const ids: string[] = [];
  const weekdays = [...new Set(input.weekdays)].sort((a, b) => a - b);

  for (const weekday of weekdays) {
    const { rows: same } = await tx.query(
      `SELECT 1 FROM class_schedule
        WHERE partner_group_id = $1 AND weekday = $2 AND start_time = $3::time AND archived_at IS NULL`,
      [groupId, weekday, input.startTime],
    );
    if (same.length > 0) {
      clashes.push({ weekday, reason: 'already_booked' });
      continue;
    }

    const lane = await laneConflicts(
      tx,
      '00000000-0000-0000-0000-000000000000',
      weekday,
      input.startTime,
      input.durationMinutes,
      input.laneIds,
      seasonId,
    );
    if (lane !== null) {
      clashes.push({ weekday, reason: 'lane_taken', lane: lane.laneName, holder: lane.holder });
      continue;
    }

    // The triggers judge the hours and the tank; a savepoint keeps one refused
    // day from aborting the transaction, so every day's reason can be said.
    await tx.query('SAVEPOINT partner_day');
    try {
      const dayGroup = weekday === 6 ? 'saturday' : weekday === 7 ? 'sunday' : 'weekday';
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO class_schedule
           (organization_id, facility_id, subject_type, partner_group_id, season_id, weekday,
            start_time, duration_minutes, slot_id)
         VALUES ($1, $2, 'parceria', $3, $4, $5, $6::time, $7,
                 (SELECT s.id FROM facility_time_slot s
                   WHERE s.facility_id = $2 AND s.season_id = $4 AND s.archived_at IS NULL
                     AND s.day_group = $8::day_group AND s.start_time = $6::time
                     AND s.end_time = $6::time + make_interval(mins => $7)
                   LIMIT 1))
         RETURNING id`,
        [organizationId, group.facility_id, groupId, seasonId, weekday, input.startTime, input.durationMinutes, dayGroup],
      );
      const id = rows[0]!.id;
      await setLanes(tx, organizationId, id, input.laneIds);
      await tx.query('RELEASE SAVEPOINT partner_day');
      ids.push(id);
    } catch (error) {
      await tx.query('ROLLBACK TO SAVEPOINT partner_day');
      clashes.push(dayRefusal(weekday, error));
    }
  }

  if (clashes.length > 0) throw new PartnerDaysClashError(clashes);

  await recordAudit(tx, {
    action: 'partner_group.days_booked',
    entityType: 'partner_group',
    entityId: groupId,
    data: {
      weekdays,
      startTime: input.startTime,
      durationMinutes: input.durationMinutes,
      lanes: input.laneIds.length,
    },
  });
  return { ids };
}

/** A trigger's refusal as one day's reason; anything unknown is still a reason, never a 500. */
function dayRefusal(weekday: number, error: unknown): PartnerDayClash {
  const code = (error as { code?: string }).code;
  const message = (error as { message?: string }).message ?? '';
  if (code === '23505') return { weekday, reason: 'already_booked' };
  if (code === '23514' || code === 'P0001') {
    if (/^(facility_closed_on_weekday|outside_facility_hours|class_ends_after_closing):/.test(message)) {
      const closed = readClosed(message);
      return { weekday, reason: 'closed', detail: closed.reason, opensAt: closed.opensAt, closesAt: closed.closesAt };
    }
  }
  return { weekday, reason: 'refused', code: (error as { detail?: string }).detail?.split('|')[0] ?? code ?? 'unknown' };
}

export async function placePartnerDays(
  organizationId: string,
  groupId: string,
  input: PartnerDaysInput,
): Promise<{ ids: string[] } | null> {
  return withOrg(organizationId, (tx) => placePartnerDaysIn(tx, organizationId, groupId, input));
}

/**
 * *Remover este dia* — the booking ends, as a turma's slot does: archived,
 * and its lessons from today on cancelled (never deleted, never one already
 * given). False when there is no such partnership booking.
 */
export async function removePartnerDay(organizationId: string, scheduleId: string): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ partner_group_id: string; weekday: number; start_time: string }>(
      `UPDATE class_schedule SET archived_at = now()
        WHERE id = $1 AND subject_type = 'parceria' AND archived_at IS NULL
      RETURNING partner_group_id, weekday, to_char(start_time, 'HH24:MI') AS start_time`,
      [scheduleId],
    );
    const removed = rows[0];
    if (removed === undefined) return false;

    const cancelled = await tx.query(
      `UPDATE class_session s
          SET status = 'cancelled'
        WHERE s.schedule_id = $1
          AND s.status <> 'cancelled'
          AND s.occurs_on >= club_today()
          AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.class_session_id = s.id)`,
      [scheduleId],
    );
    // A closure's cancellation stops being the closure's, so lifting it later
    // does not bring back a day that no longer runs (19-10-2026 sweep).
    await tx.query(
      `UPDATE class_session s SET closure_id = NULL
        WHERE s.schedule_id = $1 AND s.status = 'cancelled' AND s.closure_id IS NOT NULL
          AND s.occurs_on >= club_today()`,
      [scheduleId],
    );

    await recordAudit(tx, {
      action: 'partner_group.day_removed',
      entityType: 'partner_group',
      entityId: removed.partner_group_id,
      data: {
        scheduleId,
        weekday: removed.weekday,
        startTime: removed.start_time,
        lessonsCancelled: cancelled.rowCount ?? 0,
      },
    });
    return true;
  });
}
