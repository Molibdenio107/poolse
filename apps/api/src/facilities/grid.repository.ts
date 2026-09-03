import { withOrg, type Tx } from '@poolse/db';

/**
 * The lane grid — POOLSE-49.
 *
 * The printed sheet a club pins to the wall is fourteen slots down, five days
 * across, and **six lanes inside every slot**, with a group, an instructor and a
 * headcount in each cell. Poolse's board drew one row per fifteen minutes and
 * one cell per day, which cannot show that Sandra is running Cadetes, Infantis
 * and Absolutos at the same time on lanes 2, 3 and 4.
 *
 * This is the read side of that grid: the rows it is drawn on (slots and lanes),
 * and everything sitting in them (bookings, whatever their subject).
 *
 * **One request, not five.** The screen cannot render a single cell until it has
 * the slots, the lanes, the bookings and the lane assignments together, so
 * splitting them would be four round trips before first paint and four chances
 * to be looking at three-quarters of a week. Every list here is bounded — a
 * facility's slots, its lanes, one season's bookings — which is also why the
 * grid is exempt from pagination.
 *
 * **A booking whose time matches no slot is returned, not dropped.** `slotId`
 * null means "fora da grelha", and the screen renders it in a block underneath
 * with its time on it. Filtering it out here would be a class quietly vanishing
 * from the wall, which is the one outcome worse than an untidy grid.
 */

export type DayGroup = 'weekday' | 'saturday' | 'sunday';

export type SubjectType = 'turma' | 'parceria' | 'evento' | 'manutencao';

export type InstructorStatus = 'assigned' | 'unassigned' | 'external';

export interface GridSlot {
  id: string;
  dayGroup: DayGroup;
  /** `HH:MM`, wall-clock at the facility. `24:00` is a real end time. */
  startTime: string;
  endTime: string;
}

export interface GridLane {
  id: string;
  poolId: string;
  poolName: string;
  name: string;
  position: number;
  /** Null means the club has not said how many fit. A warning needs a number. */
  defaultCapacity: number | null;
}

export interface GridBooking {
  id: string;
  subjectType: SubjectType;
  /**
   * The turma behind a turma booking, and null for everything else.
   *
   * The register and cancel controls are keyed by `groupId|weekday|startTime`,
   * so the grid needs this to find them. A parceria takes no register at all —
   * POOLSE-46 settled that — which is why null here is meaningful rather than
   * missing.
   */
  classGroupId: string | null;
  /** The turma's name, the partner group's, or the booking's own title. */
  name: string;
  /** The level for a turma, the partner for a parceria. Second line of the cell. */
  subtitle: string | null;
  /** The membership actually running it — the booking's override, else the turma's. */
  instructorId: string | null;
  instructorName: string | null;
  instructorStatus: InstructorStatus;
  /** Null when nobody has said. Zero is a real answer and is not null. */
  headcount: number | null;
  categoryId: string | null;
  categoryName: string | null;
  /** A token name from `category_colour`, resolved to a design token by the web app. */
  categoryColour: string | null;
  /** Hex, and only for a parceria. Takes precedence over the category's colour. */
  partnerColour: string | null;
  partnerId: string | null;
  levelId: string | null;
  /** ISO weekday, Monday 1 … Sunday 7. */
  weekday: number;
  startTime: string;
  durationMinutes: number;
  /** Null means fora da grelha — the booking's own time matches no slot. */
  slotId: string | null;
  /** Every lane it occupies, in position order. One block spans all of them. */
  laneIds: string[];
}

export interface Grid {
  seasonId: string | null;
  slots: GridSlot[];
  pools: { id: string; name: string }[];
  lanes: GridLane[];
  bookings: GridBooking[];
  /** Every category at this facility, for the filter. The legend uses what is in view. */
  categories: { id: string; name: string; colour: string }[];
  /** Distinct instructors with something on this grid, for the filter. */
  instructors: { id: string; name: string }[];
  partners: { id: string; name: string; colour: string }[];
}

/**
 * The season the grid is drawn for.
 *
 * The published one by default — a draft is next year's plan and must not show
 * up on the wall. The caller may name another, which is what makes POOLSE-45's
 * planning view possible without this function changing.
 */
async function seasonFor(tx: Tx, requested: string | null): Promise<string | null> {
  if (requested !== null) {
    const { rows } = await tx.query<{ id: string }>(`SELECT id FROM season WHERE id = $1`, [
      requested,
    ]);
    return rows[0]?.id ?? null;
  }

  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM season WHERE status = 'published' LIMIT 1`,
  );
  return rows[0]?.id ?? null;
}

/** `HH:MM` from Postgres's `HH:MM:SS`. `24:00:00` stays `24:00`, which is right. */
function toClock(raw: string): string {
  return raw.slice(0, 5);
}

export async function readGrid(
  organizationId: string,
  facilityId: string,
  seasonId: string | null,
): Promise<Grid | null> {
  return withOrg(organizationId, async (tx) => {
    const site = await tx.query(
      `SELECT 1 FROM facility WHERE id = $1 AND archived_at IS NULL`,
      [facilityId],
    );
    if (site.rowCount === 0) return null;

    const season = await seasonFor(tx, seasonId);

    /*
     * No season means no grid — and that is a real state, not an error. A club
     * that has not opened a season yet gets empty lists and a screen that says
     * so, rather than a 404 on a facility that plainly exists.
     */
    const slots = season === null
      ? { rows: [] as { id: string; day_group: DayGroup; start_time: string; end_time: string }[] }
      : await tx.query<{
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

    /*
     * Lanes, with their pool, in the order the grid draws them.
     *
     * `position` and not `name`: a club that calls lane 6 "Pista do fundo" has
     * not moved it, and ordering by name would put it between 5 and 7 or not,
     * depending on the word.
     */
    const lanes = await tx.query<{
      id: string;
      pool_id: string;
      pool_name: string;
      name: string;
      position: number;
      default_capacity: number | null;
    }>(
      `SELECT l.id, l.pool_id, p.name AS pool_name, l.name, l.position, l.default_capacity
         FROM lane l
         JOIN pool p ON p.id = l.pool_id AND p.organization_id = l.organization_id
        WHERE p.facility_id = $1
          AND l.archived_at IS NULL
          AND p.archived_at IS NULL
        ORDER BY p.name, l.position`,
      [facilityId],
    );

    /*
     * Every booking in the season, whatever its subject.
     *
     * The season of a booking is `coalesce(cs.season_id, cg.season_id)` — the
     * rule POOLSE-47 wrote into the schema: a turma takes its season from its
     * turma, everything else carries its own. Getting this wrong shows next
     * year's draft on this year's wall.
     *
     * `left join lateral` for the lanes rather than a plain join, so a booking
     * with no lane assigned still appears. That is an ordinary state for a
     * turma created before lanes existed, and dropping it would hide a class.
     */
    const bookings = season === null
      ? { rows: [] as GridBookingRow[] }
      : await tx.query<GridBookingRow>(
          `SELECT cs.id,
                  cs.subject_type,
                  cs.class_group_id,
                  coalesce(cg.name, pg.name, cs.title, '')          AS name,
                  coalesce(sl.name, p.name)                          AS subtitle,
                  nullif(btrim(concat_ws(' ',
                    coalesce(im.cached_first_name, m.first_name),
                    coalesce(im.cached_last_name,  m.last_name))), '') AS instructor_name,
                  coalesce(cs.instructor_membership_id, cg.instructor_membership_id)
                                                                     AS instructor_membership_id,
                  cs.instructor_status,
                  coalesce(cs.headcount_override, pg.participant_count) AS headcount,
                  cs.category_id,
                  bc.name                                            AS category_name,
                  bc.colour::text                                    AS category_colour,
                  p.color                                            AS partner_colour,
                  p.id                                               AS partner_id,
                  coalesce(cg.level_id, pg.level_id)                 AS level_id,
                  cs.weekday,
                  cs.start_time::text,
                  cs.duration_minutes,
                  cs.slot_id,
                  coalesce(bl.lane_ids, '{}')                        AS lane_ids
             FROM class_schedule cs
             LEFT JOIN class_group cg
               ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
             LEFT JOIN student_level sl
               ON sl.id = cg.level_id AND sl.organization_id = cs.organization_id
             LEFT JOIN partner_group pg
               ON pg.id = cs.partner_group_id AND pg.organization_id = cs.organization_id
             LEFT JOIN partner p
               ON p.id = pg.partner_id AND p.organization_id = cs.organization_id
             LEFT JOIN booking_category bc
               ON bc.id = cs.category_id AND bc.organization_id = cs.organization_id
             /*
              * The instructor: the booking's override if it has one, otherwise
              * the turma's own. That precedence is the whole point of the
              * override column — a substitute on a Tuesday must show as the
              * substitute, not as the person they are covering for.
              */
             LEFT JOIN membership m
               ON m.id = coalesce(cs.instructor_membership_id, cg.instructor_membership_id)
              AND m.organization_id = cs.organization_id
             LEFT JOIN app_user im ON im.id = m.app_user_id
             LEFT JOIN LATERAL (
               SELECT array_agg(b.lane_id ORDER BY l.position) AS lane_ids
                 FROM booking_lane b
                 JOIN lane l ON l.id = b.lane_id AND l.organization_id = b.organization_id
                WHERE b.schedule_id = cs.id AND b.organization_id = cs.organization_id
             ) bl ON true
            WHERE cs.facility_id = $1
              AND cs.archived_at IS NULL
              AND coalesce(cs.season_id, cg.season_id) = $2
            ORDER BY cs.weekday, cs.start_time`,
          [facilityId, season],
        );

    const categories = await tx.query<{ id: string; name: string; colour: string }>(
      `SELECT id, name, colour::text AS colour
         FROM booking_category
        WHERE facility_id = $1 AND archived_at IS NULL
        ORDER BY name`,
      [facilityId],
    );

    const pools = await tx.query<{ id: string; name: string }>(
      `SELECT id, name FROM pool
        WHERE facility_id = $1 AND archived_at IS NULL
        ORDER BY name`,
      [facilityId],
    );

    /*
     * Everything POOLSE-51's warnings need, in the same request as the grid.
     *
     * Criterion 9: the warnings for the whole visible grid are computed in one
     * query — or rather, from one payload. A 14x5x6 grid is 420 cells, and one
     * round trip per cell is a screen that never finishes painting.
     */
    const capacities = await tx.query<{ lane_id: string; level_id: string; capacity: number }>(
      `SELECT llc.lane_id, llc.level_id, llc.capacity
         FROM lane_level_capacity llc
         JOIN lane l ON l.id = llc.lane_id AND l.organization_id = llc.organization_id
         JOIN pool p ON p.id = l.pool_id AND p.organization_id = l.organization_id
        WHERE p.facility_id = $1`,
      [facilityId],
    );

    const limits = await tx.query<{ max_concurrent_groups_per_instructor: number | null }>(
      `SELECT max_concurrent_groups_per_instructor FROM facility WHERE id = $1`,
      [facilityId],
    );

    const partners = await tx.query<{ id: string; name: string; colour: string }>(
      `SELECT id, name, color AS colour
         FROM partner
        WHERE facility_id = $1 AND archived_at IS NULL
        ORDER BY name`,
      [facilityId],
    );

    /*
     * The instructor filter is built from the bookings actually on the grid, not
     * from every instructor the club employs — the same rule the legend follows.
     * A filter offering somebody who teaches nothing this season is a filter that
     * returns an empty grid and looks broken.
     */
    const instructors = new Map<string, string>();
    for (const row of bookings.rows) {
      const id = row.instructor_membership_id;
      if (id !== null && row.instructor_name !== null) instructors.set(id, row.instructor_name);
    }

    return {
      seasonId: season,
      slots: slots.rows.map((row) => ({
        id: row.id,
        dayGroup: row.day_group,
        startTime: toClock(row.start_time),
        endTime: toClock(row.end_time),
      })),
      pools: pools.rows,
      lanes: lanes.rows.map((row) => ({
        id: row.id,
        poolId: row.pool_id,
        poolName: row.pool_name,
        name: row.name,
        position: row.position,
        defaultCapacity: row.default_capacity,
      })),
      bookings: bookings.rows.map((row) => ({
        id: row.id,
        subjectType: row.subject_type,
        classGroupId: row.class_group_id,
        name: row.name,
        subtitle: row.subtitle,
        instructorId: row.instructor_membership_id,
        instructorName: row.instructor_name,
        instructorStatus: row.instructor_status,
        headcount: row.headcount,
        categoryId: row.category_id,
        categoryName: row.category_name,
        categoryColour: row.category_colour,
        partnerColour: row.partner_colour,
        partnerId: row.partner_id,
        levelId: row.level_id,
        weekday: row.weekday,
        startTime: toClock(row.start_time),
        durationMinutes: row.duration_minutes,
        slotId: row.slot_id,
        laneIds: row.lane_ids ?? [],
      })),
      categories: categories.rows,
      instructors: [...instructors].map(([id, name]) => ({ id, name })).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
      partners: partners.rows,
      laneLevelCapacity: Object.fromEntries(
        capacities.rows.map((row) => [`${row.lane_id}:${row.level_id}`, row.capacity]),
      ),
      maxConcurrentGroups: limits.rows[0]?.max_concurrent_groups_per_instructor ?? null,
    };
  });
}

interface GridBookingRow {
  id: string;
  subject_type: SubjectType;
  class_group_id: string | null;
  name: string;
  subtitle: string | null;
  instructor_name: string | null;
  instructor_membership_id: string | null;
  instructor_status: InstructorStatus;
  headcount: number | null;
  category_id: string | null;
  category_name: string | null;
  category_colour: string | null;
  partner_colour: string | null;
  partner_id: string | null;
  level_id: string | null;
  weekday: number;
  start_time: string;
  duration_minutes: number;
  slot_id: string | null;
  lane_ids: string[] | null;
}
