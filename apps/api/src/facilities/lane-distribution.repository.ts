import { withOrg, type Tx } from '@poolse/db';
import { LaneTakenError, moveBooking } from './bookings.repository.js';

/**
 * *Distribuir pelas pistas* — Rui, 14/16-11-2026.
 *
 * An imported timetable leaves its classes in *Sem pista*, and two turmas can
 * end up on one lane at one hour (`turma_lane_overlaps()`). This places each
 * of them, at its own day and hour, on free lanes of its pool: the turma's own
 * lane first when it is free, else the lowest-numbered run of free lanes as wide
 * as the class already is (one lane for a class with none). Whatever has no
 * free lane at that hour is left exactly where it is, and said.
 *
 * The plan is made once, in memory, so the question and the doing agree; the
 * doing is the calendar's own move (`moveBooking`) per class, which re-checks
 * every lane, follows the lessons and writes the activity log, as a drag would.
 */
export interface PlacedClass {
  scheduleId: string;
  name: string;
  weekday: number;
  startTime: string;
  lanes: string[];
}

export interface UnplacedClass {
  scheduleId: string;
  name: string;
  weekday: number;
  startTime: string;
}

export interface DistributionPlan {
  placeable: (PlacedClass & { laneIds: string[] })[];
  unplaceable: UnplacedClass[];
}

interface Booking {
  id: string;
  name: string;
  weekday: number;
  start: number;
  end: number;
  startTime: string;
  duration: number;
  slotId: string | null;
  turmaLane: string | null;
  laneIds: string[];
  isTurma: boolean;
}

const minutes = (clock: string): number => {
  const [h, m] = clock.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

async function planIn(tx: Tx, organizationId: string, facilityId: string, poolId: string): Promise<DistributionPlan | null> {
  const found = await tx.query(
    `SELECT 1 FROM pool p WHERE p.id = $1 AND p.facility_id = $2 AND p.archived_at IS NULL`,
    [poolId, facilityId],
  );
  if (found.rowCount === 0) return null;
  const { rows: seasons } = await tx.query<{ id: string }>(
    `SELECT id FROM season WHERE status = 'published' AND archived_at IS NULL LIMIT 1`,
  );
  const seasonId = seasons[0]?.id;
  if (seasonId === undefined) return null;

  const { rows: lanes } = await tx.query<{ id: string; name: string; position: number }>(
    `SELECT id, name, position FROM lane WHERE pool_id = $1 AND archived_at IS NULL ORDER BY position`,
    [poolId],
  );
  if (lanes.length === 0) return { placeable: [], unplaceable: [] };

  // Every live booking of the pool this season, with the lanes it holds.
  const { rows } = await tx.query<{
    id: string;
    name: string;
    weekday: number;
    start_time: string;
    duration_minutes: number;
    slot_id: string | null;
    turma_lane: string | null;
    lane_ids: string[] | null;
    is_turma: boolean;
  }>(
    `SELECT cs.id,
            coalesce(cg.name, pg.name, cs.title, '?') AS name,
            cs.weekday,
            to_char(cs.start_time, 'HH24:MI') AS start_time,
            cs.duration_minutes,
            cs.slot_id,
            cg.lane_id AS turma_lane,
            (SELECT array_agg(bl.lane_id) FROM booking_lane bl WHERE bl.schedule_id = cs.id) AS lane_ids,
            cs.subject_type = 'turma' AS is_turma
       FROM class_schedule cs
       LEFT JOIN class_group cg ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
       LEFT JOIN partner_group pg ON pg.id = cs.partner_group_id AND pg.organization_id = cs.organization_id
      WHERE cs.archived_at IS NULL
        AND coalesce(cs.season_id, cg.season_id) = $2
        AND (cg.id IS NULL OR cg.archived_at IS NULL)
        AND (coalesce(cs.pool_id, cg.pool_id) = $1
             OR EXISTS (SELECT 1 FROM booking_lane bl JOIN lane l ON l.id = bl.lane_id
                         WHERE bl.schedule_id = cs.id AND l.pool_id = $1))
      ORDER BY cs.weekday, cs.start_time, cs.id`,
    [poolId, seasonId],
  );
  const bookings: Booking[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    weekday: row.weekday,
    start: minutes(row.start_time),
    end: minutes(row.start_time) + row.duration_minutes,
    startTime: row.start_time,
    duration: row.duration_minutes,
    slotId: row.slot_id,
    turmaLane: row.turma_lane,
    laneIds: row.lane_ids ?? [],
    isTurma: row.is_turma,
  }));

  // Which to place: turma slots with no lane, and the later of two turmas sharing one.
  // A pair where one side has no lane is that side's to place; only a lane truly
  // held twice moves the second holder (16-11-2026: the first pass moved both).
  const { rows: pairs } = await tx.query<{ schedule_id: string; other_schedule_id: string }>(
    `SELECT schedule_id, other_schedule_id FROM turma_lane_overlaps($1) WHERE pool_id = $2`,
    [organizationId, poolId],
  );
  // The one that starts later moves; the earlier keeps the lane it had.
  const byId = new Map(bookings.map((b) => [b.id, b]));
  const shared = new Set<string>();
  for (const pair of pairs) {
    const a = byId.get(pair.schedule_id);
    const b = byId.get(pair.other_schedule_id);
    if (a === undefined || b === undefined || a.laneIds.length === 0 || b.laneIds.length === 0) continue;
    shared.add(b.start > a.start || (b.start === a.start && b.id > a.id) ? b.id : a.id);
  }
  const toPlace = bookings.filter((b) => b.isTurma && (b.laneIds.length === 0 || shared.has(b.id)));
  const moving = new Set(toPlace.map((b) => b.id));

  // What stays where it is holds its lanes; each placement adds to it as the plan goes.
  const held: { laneId: string; weekday: number; start: number; end: number }[] = [];
  for (const b of bookings) {
    if (moving.has(b.id)) continue;
    for (const laneId of b.laneIds) held.push({ laneId, weekday: b.weekday, start: b.start, end: b.end });
  }
  const free = (laneId: string, b: Booking): boolean =>
    !held.some((h) => h.laneId === laneId && h.weekday === b.weekday && h.start < b.end && b.start < h.end);

  const plan: DistributionPlan = { placeable: [], unplaceable: [] };
  for (const b of toPlace) {
    const width = Math.max(1, b.laneIds.length);
    let chosen: string[] | null = null;
    // The turma's own lane first, when it is this pool's and free (one-lane classes).
    if (width === 1 && b.turmaLane !== null && lanes.some((l) => l.id === b.turmaLane) && free(b.turmaLane, b)) {
      chosen = [b.turmaLane];
    }
    for (let i = 0; chosen === null && i + width <= lanes.length; i++) {
      const run = lanes.slice(i, i + width);
      // A run is lanes side by side: positions with no gap.
      const contiguous = run.every((lane, k) => k === 0 || lane.position === run[k - 1]!.position + 1);
      if (contiguous && run.every((lane) => free(lane.id, b))) chosen = run.map((lane) => lane.id);
    }
    if (chosen === null) {
      plan.unplaceable.push({ scheduleId: b.id, name: b.name, weekday: b.weekday, startTime: b.startTime });
      continue;
    }
    for (const laneId of chosen) held.push({ laneId, weekday: b.weekday, start: b.start, end: b.end });
    plan.placeable.push({
      scheduleId: b.id,
      name: b.name,
      weekday: b.weekday,
      startTime: b.startTime,
      laneIds: chosen,
      lanes: chosen.map((id) => lanes.find((l) => l.id === id)!.name),
    });
  }
  return plan;
}

/** The plan, for the question. Null when the pool, site or published season is not this club's. */
export async function planDistribution(
  organizationId: string,
  facilityId: string,
  poolId: string,
): Promise<DistributionPlan | null> {
  return withOrg(organizationId, (tx) => planIn(tx, organizationId, facilityId, poolId));
}

/**
 * The plan, done: each class moved as the calendar would move it. A lane taken
 * in the meantime leaves that class where it was, counted as not placed.
 */
export async function applyDistribution(
  organizationId: string,
  facilityId: string,
  poolId: string,
): Promise<{ placed: number; unplaced: number } | null> {
  const plan = await planDistribution(organizationId, facilityId, poolId);
  if (plan === null) return null;
  const slots = await withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string; slot_id: string | null; duration_minutes: number }>(
      `SELECT id, slot_id, duration_minutes FROM class_schedule WHERE id = ANY($1::uuid[])`,
      [plan.placeable.map((one) => one.scheduleId)],
    );
    return new Map(rows.map((row) => [row.id, row]));
  });
  let placed = 0;
  let unplaced = plan.unplaceable.length;
  for (const one of plan.placeable) {
    const slot = slots.get(one.scheduleId);
    try {
      const moved = await moveBooking(organizationId, one.scheduleId, {
        weekday: one.weekday,
        // Its own row and length, so only the lanes change.
        slotId: slot?.slot_id ?? null,
        startTime: one.startTime,
        laneIds: one.laneIds,
        durationMinutes: slot?.duration_minutes ?? null,
      });
      if (moved === null) unplaced += 1;
      else placed += 1;
    } catch (error) {
      if (!(error instanceof LaneTakenError)) throw error;
      unplaced += 1;
    }
  }
  return { placed, unplaced };
}
