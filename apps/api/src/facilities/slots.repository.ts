import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';

/**
 * The rows of a facility's schedule grid — POOLSE-44.
 *
 * A club's timetable has rows before it has classes, and those rows are a
 * property of the building: 06:30, 08:45, 09:30 … with a hole at lunchtime and a
 * different set at the weekend. This is the table behind that, and nothing here
 * knows what sits in a slot.
 */

export type DayGroup = 'weekday' | 'saturday' | 'sunday';

export const DAY_GROUPS: readonly DayGroup[] = ['weekday', 'saturday', 'sunday'];

export interface TimeSlot {
  id: string;
  dayGroup: DayGroup;
  /** `HH:MM`, wall-clock at the facility. `24:00` is a real end time. */
  startTime: string;
  endTime: string;
}

export interface SlotInput {
  dayGroup: DayGroup;
  startTime: string;
  endTime: string;
}

/** Raised when a slot would overlap one that is already there. */
export class SlotOverlapError extends Error {
  constructor(readonly startTime: string, readonly endTime: string) {
    super('slot overlaps');
  }
}

/** Raised when a slot is deleted while bookings still sit on it. */
export class SlotInUseError extends Error {
  constructor(readonly bookings: string[]) {
    super('slot in use');
  }
}

/**
 * `HH:MM`, from what Postgres gives back.
 *
 * `time` arrives as `HH:MM:SS`, and `24:00` arrives as `24:00:00` — which is
 * exactly what the grid wants to show, minus the seconds nobody typed.
 */
function toClock(raw: string): string {
  return raw.slice(0, 5);
}

/**
 * The season a grid belongs to.
 *
 * The club's current one until POOLSE-45 gives seasons a status and a draft; the
 * caller may name another, which is what makes next year's planning possible
 * without this function changing.
 */
async function seasonFor(tx: Tx, requested: string | null): Promise<string | null> {
  if (requested !== null) {
    const { rows } = await tx.query<{ id: string }>(`SELECT id FROM season WHERE id = $1`, [
      requested,
    ]);
    return rows[0]?.id ?? null;
  }

  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM season WHERE archived_at IS NULL LIMIT 1`,
  );
  return rows[0]?.id ?? null;
}

/**
 * A site's grid, all three day groups at once.
 *
 * One read rather than three: the editor shows every group and the schedule
 * needs the weekend block beside the weekday one, so splitting this would be
 * three round trips for one screen. Ordered by clock time, which is the only
 * order a grid has — see the migration on why there is no `position` column.
 */
export async function listSlots(
  organizationId: string,
  facilityId: string,
  seasonId: string | null,
): Promise<{ seasonId: string | null; slots: TimeSlot[] }> {
  return withOrg(organizationId, async (tx) => {
    const season = await seasonFor(tx, seasonId);
    if (season === null) return { seasonId: null, slots: [] };

    const { rows } = await tx.query<{
      id: string;
      day_group: DayGroup;
      start_time: string;
      end_time: string;
    }>(
      `SELECT id, day_group, start_time::text, end_time::text
         FROM facility_time_slot
        WHERE facility_id = $1 AND season_id = $2 AND archived_at IS NULL
        ORDER BY day_group, start_time`,
      [facilityId, season],
    );

    return {
      seasonId: season,
      slots: rows.map((row) => ({
        id: row.id,
        dayGroup: row.day_group,
        startTime: toClock(row.start_time),
        endTime: toClock(row.end_time),
      })),
    };
  });
}

function asOverlap<T>(error: unknown, input: SlotInput): T {
  // 23P01 is `facility_time_slot_no_overlap`.
  if (error instanceof Error && (error as { code?: string }).code === '23P01') {
    throw new SlotOverlapError(input.startTime, input.endTime);
  }
  throw error;
}

/**
 * Adds slots, all or none.
 *
 * One call for one row and for the forty a generator produces, because "gerar
 * grelha" is exactly this with a longer list — a separate generate endpoint
 * would be a second way to create a slot, and two ways drift. The generation
 * itself is arithmetic and happens on the client, where the operator can see the
 * rows before committing to them.
 *
 * The whole batch is one transaction: half a grid is worse than none, because
 * nobody can tell which half.
 */
export async function addSlots(
  organizationId: string,
  facilityId: string,
  seasonId: string | null,
  inputs: SlotInput[],
): Promise<{ created: number } | null> {
  return withOrg(organizationId, async (tx) => {
    const facility = await tx.query(
      `SELECT 1 FROM facility WHERE id = $1 AND archived_at IS NULL`,
      [facilityId],
    );
    if (facility.rowCount === 0) return null;

    const season = await seasonFor(tx, seasonId);
    if (season === null) return null;

    for (const input of inputs) {
      try {
        await tx.query(
          `INSERT INTO facility_time_slot
             (organization_id, facility_id, season_id, day_group, start_time, end_time)
           VALUES ($1, $2, $3, $4::day_group, $5::time, $6::time)`,
          [organizationId, facilityId, season, input.dayGroup, input.startTime, input.endTime],
        );
      } catch (error) {
        return asOverlap<{ created: number }>(error, input);
      }
    }

    await recordAudit(tx, {
      action: 'facility.slots.added',
      entityType: 'facility',
      entityId: facilityId,
      data: { count: inputs.length, seasonId: season },
    });

    return { created: inputs.length };
  });
}

/** Corrects one slot's hours. */
export async function updateSlot(
  organizationId: string,
  slotId: string,
  input: SlotInput,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    try {
      const { rowCount } = await tx.query(
        `UPDATE facility_time_slot
            SET day_group = $2::day_group, start_time = $3::time, end_time = $4::time
          WHERE id = $1 AND archived_at IS NULL`,
        [slotId, input.dayGroup, input.startTime, input.endTime],
      );
      if (rowCount === 0) return false;
    } catch (error) {
      return asOverlap<boolean>(error, input);
    }

    await recordAudit(tx, {
      action: 'facility.slot.updated',
      entityType: 'facility_time_slot',
      entityId: slotId,
      data: { dayGroup: input.dayGroup, startTime: input.startTime, endTime: input.endTime },
    });

    return true;
  });
}

/**
 * Removes a slot.
 *
 * Archived rather than deleted, so the hours come free again and the history
 * stays — the partial exclusion constraint is what makes that work.
 *
 * **The in-use check is not here yet, and that is deliberate rather than
 * forgotten.** Nothing references a slot until POOLSE-46 adds
 * `class_schedule.slot_id`, so there is no query to write: an early version of
 * this reached for `to_jsonb(cs) ? 'slot_id'` to survive the column not
 * existing, which is a clever way to write a check that checks nothing. When
 * POOLSE-46 lands, this gains the ordinary join and throws `SlotInUseError`,
 * which the controller and the web layer already know how to render — AC7.
 */
export async function archiveSlot(organizationId: string, slotId: string): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE facility_time_slot SET archived_at = now()
        WHERE id = $1 AND archived_at IS NULL`,
      [slotId],
    );
    if (rowCount === 0) return false;

    await recordAudit(tx, {
      action: 'facility.slot.archived',
      entityType: 'facility_time_slot',
      entityId: slotId,
    });

    return true;
  });
}
