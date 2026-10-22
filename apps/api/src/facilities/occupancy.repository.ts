import { withOrg, type Tx } from '@poolse/db';

/**
 * How much of the water is sold — POOLSE-52.
 *
 * Once the grid holds turmas and parcerias together, the club can finally answer
 * the question it actually has: how much of the pool is booked, when is it
 * empty, and how much of it is families rather than organisations. The reference
 * club's mornings are almost entirely partnerships and its evenings almost
 * entirely turmas, and that split was invisible while half of it could not be
 * recorded.
 *
 * **Every number here is computed by Postgres.** The same rule POOLSE-42 set for
 * money: a total arriving from the API *is* the total, and the web app formats it
 * for the locale rather than working it out again. Two implementations of
 * "lane-hours" is two answers to one question, and the one on screen would be
 * the one nobody could reproduce.
 *
 * **Lane-hours is the unit, because it is what a club sells.** A booking over
 * three lanes for 45 minutes is 2.25 lane-hours. `numeric`, never float — it is
 * a quantity that gets multiplied by a price.
 *
 * **Over dated sessions, not the weekly pattern.** A grid that says 80% while
 * the pool was shut for a fortnight is a grid nobody trusts twice, so closures
 * and disabled weekdays reduce both halves of the fraction.
 */

/** `manhã` before 12:00, `tarde` 12:00–17:59, `noite` from 18:00. */
export type TimeBand = 'manha' | 'tarde' | 'noite';

export interface OccupancySlice {
  /** Decimal strings: a quantity that will be multiplied by a price. */
  soldLaneHours: string;
  turmaLaneHours: string;
  parceriaLaneHours: string;
  /** People, never multiplied by lanes — see the note on `headcount`. */
  headcount: number;
  turmaHeadcount: number;
  parceriaHeadcount: number;
}

export interface Occupancy {
  seasonId: string;
  seasonName: string;
  /** The season's first and last day, `YYYY-MM-DD` — the tab's header line (POOLSE-93). */
  seasonStartsOn: string;
  seasonEndsOn: string;
  /** Sold and available across the whole season. */
  total: OccupancySlice & { availableLaneHours: string };
  /**
   * Sold ÷ available, as a percentage, or null when the club has no grid yet.
   *
   * This is time utilisation and needs no capacity: a lane-hour is available
   * whether or not anybody has said how many swimmers fit in it.
   */
  laneHourOccupancy: number | null;
  /**
   * Swimmers ÷ places, over the booked lanes that have a capacity.
   *
   * **The one that carries an asterisk.** `lane.default_capacity` is nullable by
   * design (POOLSE-43) — a club that has not decided how many fit in a lane must
   * not be blocked from using the product. Such a lane contributes its
   * lane-hours and is excluded from this percentage, because treating unknown
   * capacity as zero or as infinite would both be inventions. `lanesWithoutCapacity`
   * is how the screen admits the gap instead of hiding it.
   */
  seatOccupancy: number | null;
  lanesWithoutCapacity: number;
  byDay: (OccupancySlice & { weekday: number; availableLaneHours: string })[];
  byBand: (OccupancySlice & { band: TimeBand })[];
  /**
   * Each day of the week × each part of the day, all 21 — POOLSE-93.
   *
   * What a club can still sell, said the way it sells it: "Friday mornings have
   * 21 lane-hours free a week". A fixed window (7 × 3), so never paginated.
   */
  byDayBand: DayBandCell[];
  /**
   * The five cells with the most free lane-hours a week, most first — ranked
   * here, never on the client. A cell the site never opens is never in it, nor
   * one with nothing free. Fewer than five when fewer have room.
   */
  mostFree: DayBandCell[];
  /**
   * What the partnerships are contracted for, in integer minor units.
   *
   * Exposed for the dashboards module and rendered nowhere in this ticket —
   * criterion 9. Null for a caller who may not see money.
   */
  contractedCents: number | null;
}

export interface DayBandCell {
  weekday: number;
  band: TimeBand;
  /** Over the whole season, as `total` is. Decimal strings. */
  availableLaneHours: string;
  soldLaneHours: string;
  /**
   * The days of the season this cell was actually open: its weekday, with slots
   * in this part of the day, not shut by a closure or the site's hours, and with
   * at least one tank open. What "a week" divides by.
   */
  openDays: number;
  /** (available − sold, never below zero) ÷ `openDays`. "0" for a closed cell. */
  freeLaneHoursPerWeek: string;
  /** Free as a share of available, 0–100; null for a closed cell. */
  freePercent: number | null;
  /** The cell's slots on the club's clock, `HH:MM`; null for a closed cell. */
  opensAt: string | null;
  closesAt: string | null;
}

/** Raised for a season that has no dated sessions to measure. */
export class DraftSeasonError extends Error {
  constructor(readonly seasonName: string) {
    super('draft season');
  }
}

/**
 * The season being measured.
 *
 * **A draft is refused, and that is QA 52.12 decided.** Occupancy is computed
 * over dated sessions, and POOLSE-45 made the generator refuse a draft on
 * purpose: a draft is a plan, and it has no sessions. Computing it from the
 * weekly pattern instead would be a second definition of every number in this
 * file, which is exactly what criterion 8 forbids — and reporting 0% for a
 * fully-planned season would be worse than refusing. So: refuse, name the
 * season, and say publish it first.
 */
async function seasonFor(
  tx: Tx,
  requested: string | null,
): Promise<{ id: string; name: string; startsOn: string; endsOn: string } | null> {
  const { rows } = await tx.query<{ id: string; name: string; status: string; starts_on: string; ends_on: string }>(
    requested === null
      ? `SELECT id, name, status, starts_on::text, ends_on::text FROM season WHERE status = 'published' LIMIT 1`
      : `SELECT id, name, status, starts_on::text, ends_on::text FROM season WHERE id = $1`,
    requested === null ? [] : [requested],
  );

  const season = rows[0];
  if (season === undefined) return null;
  if (season.status === 'draft') throw new DraftSeasonError(season.name);

  return { id: season.id, name: season.name, startsOn: season.starts_on, endsOn: season.ends_on };
}

/**
 * One statement for every figure.
 *
 * The CTEs are stacked deliberately rather than run as separate queries: the
 * denominator has to be derived from the same dated calendar as the numerator or
 * every club looks under-booked, and two round trips is two chances for them to
 * be derived differently.
 */
export async function readOccupancy(
  organizationId: string,
  facilityId: string,
  seasonId: string | null,
  includeMoney: boolean,
): Promise<Occupancy | null> {
  return withOrg(organizationId, async (tx) => {
    const site = await tx.query(
      `SELECT 1 FROM facility WHERE id = $1 AND archived_at IS NULL`,
      [facilityId],
    );
    if (site.rowCount === 0) return null;

    const season = await seasonFor(tx, seasonId);
    if (season === null) return null;

    /*
     * What was actually swum.
     *
     * `class_session_lane` for the lanes and **not** for the headcount — the
     * mistake the ticket names. Thirty swimmers on a three-lane hidroginástica
     * booking is thirty people and 2.25 lane-hours, not ninety people. So the
     * lanes are counted in a subquery and the headcount is resolved once per
     * session.
     */
    const sessions = `
      SELECT s.id,
             sch.subject_type,
             extract(ISODOW FROM (s.starts_at AT TIME ZONE f.timezone))::int AS weekday,
             CASE
               WHEN (s.starts_at AT TIME ZONE f.timezone)::time < '12:00' THEN 'manha'
               WHEN (s.starts_at AT TIME ZONE f.timezone)::time < '18:00' THEN 'tarde'
               ELSE 'noite'
             END AS band,
             s.duration_minutes,
             coalesce(l.lanes, 0) AS lanes,
             /*
              * Override, else a turma's active enrolments, else the partner
              * group's size, else zero — criterion 1, in that order. Zero is
              * reported rather than omitted: a blank would read as "unknown" and
              * be silently dropped from a percentage.
              */
             coalesce(
               sch.headcount_override,
               /*
                * The enrolment count only where there is a turma to count.
                *
                * count(*) over an empty set is 0, NOT null -- so with a bare
                * subquery here a parceria, whose class_group_id is null, matched
                * no enrolments, produced 0, and coalesce stopped there and never
                * reached the partner group's size. Every partnership reported
                * zero swimmers while its lane-hours were perfectly correct,
                * which is the worst shape a reporting bug can take: half the
                * numbers right.
                *
                * The CASE yields null for a non-turma, which is what lets the
                * fallback chain continue. (No backticks in here: this comment
                * lives inside a JS template literal and one would end the string.)
                */
               CASE
                 WHEN sch.class_group_id IS NOT NULL THEN (
                   SELECT count(*)::int FROM enrollment e
                    WHERE e.class_group_id = sch.class_group_id
                      AND e.organization_id = sch.organization_id
                      AND e.status = 'active'
                 )
               END,
               pg.participant_count,
               0
             ) AS headcount
        FROM class_session s
        JOIN class_schedule sch
          ON sch.id = s.schedule_id AND sch.organization_id = s.organization_id
        JOIN facility f
          ON f.id = sch.facility_id AND f.organization_id = sch.organization_id
        LEFT JOIN class_group cg
          ON cg.id = sch.class_group_id AND cg.organization_id = sch.organization_id
        LEFT JOIN partner_group pg
          ON pg.id = sch.partner_group_id AND pg.organization_id = sch.organization_id
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS lanes
            FROM class_session_lane csl
           WHERE csl.session_id = s.id
             AND csl.organization_id = s.organization_id
             AND NOT csl.cancelled
        ) l ON true
       WHERE sch.facility_id = $1
         AND sch.archived_at IS NULL
         AND s.status <> 'cancelled'
         AND coalesce(sch.season_id, cg.season_id) = $2`;

    /*
     * What could have been sold.
     *
     * Every date of the season, crossed with the slots that date's day group
     * offers and the lanes of the site's pools — minus the days the club is shut
     * and the days its hours disable. Derived from the same calendar as the
     * numerator, which is the second thing the ticket says is easy to get wrong:
     * `slots × lanes × 7` makes every club look under-booked.
     */
    const available = `
      SELECT extract(ISODOW FROM d)::int AS weekday,
             CASE
               WHEN fts.start_time < '12:00' THEN 'manha'
               WHEN fts.start_time < '18:00' THEN 'tarde'
               ELSE 'noite'
             END AS band,
             sum(
               (extract(epoch FROM (fts.end_time - fts.start_time)) / 3600.0) * lanes.n
             ) AS lane_hours
        FROM season se
        CROSS JOIN LATERAL generate_series(se.starts_on, se.ends_on, interval '1 day') AS d
        JOIN facility_hours fh
          ON fh.facility_id = $1
         AND fh.organization_id = se.organization_id
         AND fh.weekday = extract(ISODOW FROM d)::int
         AND fh.available
        JOIN facility_time_slot fts
          ON fts.facility_id = $1
         AND fts.season_id = se.id
         AND fts.archived_at IS NULL
         AND fts.day_group = (
           CASE
             WHEN extract(ISODOW FROM d) BETWEEN 1 AND 5 THEN 'weekday'
             WHEN extract(ISODOW FROM d) = 6 THEN 'saturday'
             ELSE 'sunday'
           END
         )::day_group
        CROSS JOIN LATERAL (
          SELECT count(*)::int AS n
            FROM lane l
            JOIN pool p ON p.id = l.pool_id AND p.organization_id = l.organization_id
           WHERE p.facility_id = $1
             AND l.archived_at IS NULL
             AND p.archived_at IS NULL
             -- A tank shut all day sells nothing that day — POOLSE-84.
             -- Every closure of the day together: morning + afternoon shut it (sweep 19-10b).
             AND NOT closure_day_shut(p.organization_id, $1, ARRAY[p.id], d::date)
        ) lanes
       WHERE se.id = $2
         -- A day the site is shut (or a holiday) is not on offer at all.
         AND NOT closure_day_shut(se.organization_id, $1, '{}'::uuid[], d::date)
       GROUP BY 1, 2`;

    const totals = await tx.query<{
      sold: string;
      turma: string;
      parceria: string;
      headcount: number;
      turma_headcount: number;
      parceria_headcount: number;
      availabl: string;
    }>(
      `WITH sess AS (${sessions}), avail AS (${available})
       SELECT
         coalesce((SELECT sum(duration_minutes / 60.0 * lanes) FROM sess), 0)::text AS sold,
         coalesce((SELECT sum(duration_minutes / 60.0 * lanes) FROM sess
                    WHERE subject_type = 'turma'), 0)::text AS turma,
         coalesce((SELECT sum(duration_minutes / 60.0 * lanes) FROM sess
                    WHERE subject_type = 'parceria'), 0)::text AS parceria,
         coalesce((SELECT sum(headcount) FROM sess), 0)::int AS headcount,
         coalesce((SELECT sum(headcount) FROM sess WHERE subject_type = 'turma'), 0)::int
           AS turma_headcount,
         coalesce((SELECT sum(headcount) FROM sess WHERE subject_type = 'parceria'), 0)::int
           AS parceria_headcount,
         coalesce((SELECT sum(lane_hours) FROM avail), 0)::text AS availabl`,
      [facilityId, season.id],
    );

    const byDay = await tx.query<{
      weekday: number;
      sold: string;
      turma: string;
      parceria: string;
      headcount: number;
      turma_headcount: number;
      parceria_headcount: number;
      availabl: string;
    }>(
      `WITH sess AS (${sessions}), avail AS (${available}),
       days AS (SELECT generate_series(1, 7) AS weekday)
       SELECT d.weekday,
              coalesce((SELECT sum(duration_minutes / 60.0 * lanes) FROM sess
                         WHERE sess.weekday = d.weekday), 0)::text AS sold,
              coalesce((SELECT sum(duration_minutes / 60.0 * lanes) FROM sess
                         WHERE sess.weekday = d.weekday AND subject_type = 'turma'), 0)::text
                AS turma,
              coalesce((SELECT sum(duration_minutes / 60.0 * lanes) FROM sess
                         WHERE sess.weekday = d.weekday AND subject_type = 'parceria'), 0)::text
                AS parceria,
              coalesce((SELECT sum(headcount) FROM sess WHERE sess.weekday = d.weekday), 0)::int
                AS headcount,
              coalesce((SELECT sum(headcount) FROM sess
                         WHERE sess.weekday = d.weekday AND subject_type = 'turma'), 0)::int
                AS turma_headcount,
              coalesce((SELECT sum(headcount) FROM sess
                         WHERE sess.weekday = d.weekday AND subject_type = 'parceria'), 0)::int
                AS parceria_headcount,
              coalesce((SELECT sum(lane_hours) FROM avail
                         WHERE avail.weekday = d.weekday), 0)::text AS availabl
         FROM days d
        ORDER BY d.weekday`,
      [facilityId, season.id],
    );

    const byBand = await tx.query<{
      band: TimeBand;
      sold: string;
      turma: string;
      parceria: string;
      headcount: number;
      turma_headcount: number;
      parceria_headcount: number;
    }>(
      `WITH sess AS (${sessions}),
       bands AS (SELECT unnest(ARRAY['manha', 'tarde', 'noite']) AS band)
       SELECT b.band,
              coalesce((SELECT sum(duration_minutes / 60.0 * lanes) FROM sess
                         WHERE sess.band = b.band), 0)::text AS sold,
              coalesce((SELECT sum(duration_minutes / 60.0 * lanes) FROM sess
                         WHERE sess.band = b.band AND subject_type = 'turma'), 0)::text AS turma,
              coalesce((SELECT sum(duration_minutes / 60.0 * lanes) FROM sess
                         WHERE sess.band = b.band AND subject_type = 'parceria'), 0)::text
                AS parceria,
              coalesce((SELECT sum(headcount) FROM sess WHERE sess.band = b.band), 0)::int
                AS headcount,
              coalesce((SELECT sum(headcount) FROM sess
                         WHERE sess.band = b.band AND subject_type = 'turma'), 0)::int
                AS turma_headcount,
              coalesce((SELECT sum(headcount) FROM sess
                         WHERE sess.band = b.band AND subject_type = 'parceria'), 0)::int
                AS parceria_headcount
         FROM bands b`,
      [facilityId, season.id],
    );

    /*
     * Where there is room to sell — POOLSE-93.
     *
     * The same two halves as `byDay`, cut by part of the day as well, plus what
     * neither of them can say: how many days of the season the cell was really
     * open. That is counted date by date from the same calendar as the hours, so
     * a closure that shut a Friday takes that Friday out of "per week" exactly as
     * it takes its hours out of the total — dividing by a count of weeks in the
     * season would spread the free hours over days nobody could sell.
     *
     * Free is floored at zero: a session's part of the day is read from its own
     * start and a slot's from the slot's, so a cell can show more sold than
     * offered, and "minus three hours free" is not a thing a club can act on.
     */
    const dayBand = await tx.query<{
      weekday: number;
      band: TimeBand;
      availabl: string;
      sold: string;
      open_days: number;
      free_per_week: string;
      free_percent: string | null;
      opens_at: string | null;
      closes_at: string | null;
      rank: number | null;
    }>(
      `WITH sess AS (${sessions}),
       dated AS (
         SELECT d::date AS day,
                extract(ISODOW FROM d)::int AS weekday,
                CASE
                  WHEN fts.start_time < '12:00' THEN 'manha'
                  WHEN fts.start_time < '18:00' THEN 'tarde'
                  ELSE 'noite'
                END AS band,
                sum((extract(epoch FROM (fts.end_time - fts.start_time)) / 3600.0) * lanes.n)
                  AS lane_hours,
                min(fts.start_time) AS opens,
                max(fts.end_time) AS closes
           FROM season se
           CROSS JOIN LATERAL generate_series(se.starts_on, se.ends_on, interval '1 day') AS d
           JOIN facility_hours fh
             ON fh.facility_id = $1
            AND fh.organization_id = se.organization_id
            AND fh.weekday = extract(ISODOW FROM d)::int
            AND fh.available
           JOIN facility_time_slot fts
             ON fts.facility_id = $1
            AND fts.season_id = se.id
            AND fts.archived_at IS NULL
            AND fts.day_group = (
              CASE
                WHEN extract(ISODOW FROM d) BETWEEN 1 AND 5 THEN 'weekday'
                WHEN extract(ISODOW FROM d) = 6 THEN 'saturday'
                ELSE 'sunday'
              END
            )::day_group
           CROSS JOIN LATERAL (
             SELECT count(*)::int AS n
               FROM lane l
               JOIN pool p ON p.id = l.pool_id AND p.organization_id = l.organization_id
              WHERE p.facility_id = $1
                AND l.archived_at IS NULL
                AND p.archived_at IS NULL
                AND NOT closure_day_shut(p.organization_id, $1, ARRAY[p.id], d::date)
           ) lanes
          WHERE se.id = $2
            AND NOT closure_day_shut(se.organization_id, $1, '{}'::uuid[], d::date)
          GROUP BY 1, 2, 3
       ),
       grid AS (
         SELECT w AS weekday, b.band, b.ord
           FROM generate_series(1, 7) AS w
           CROSS JOIN unnest(ARRAY['manha', 'tarde', 'noite']) WITH ORDINALITY AS b(band, ord)
       ),
       cells AS (
         SELECT g.weekday, g.band, g.ord,
                coalesce((SELECT sum(lane_hours) FROM dated
                           WHERE dated.weekday = g.weekday AND dated.band = g.band), 0) AS availabl,
                coalesce((SELECT sum(duration_minutes / 60.0 * lanes) FROM sess
                           WHERE sess.weekday = g.weekday AND sess.band = g.band), 0) AS sold,
                (SELECT count(*)::int FROM dated
                  WHERE dated.weekday = g.weekday AND dated.band = g.band
                    AND dated.lane_hours > 0) AS open_days,
                (SELECT to_char(min(opens), 'HH24:MI') FROM dated
                  WHERE dated.weekday = g.weekday AND dated.band = g.band
                    AND dated.lane_hours > 0) AS opens_at,
                (SELECT to_char(max(closes), 'HH24:MI') FROM dated
                  WHERE dated.weekday = g.weekday AND dated.band = g.band
                    AND dated.lane_hours > 0) AS closes_at
           FROM grid g
       ),
       freed AS (
         SELECT *,
                CASE WHEN open_days > 0
                     THEN greatest(availabl - sold, 0) / open_days
                     ELSE 0 END AS free_per_week,
                CASE WHEN availabl > 0
                     THEN greatest(availabl - sold, 0) / availabl * 100 END AS free_percent
           FROM cells
       )
       SELECT weekday, band,
              availabl::text AS availabl,
              sold::text AS sold,
              open_days,
              free_per_week::text AS free_per_week,
              free_percent::text AS free_percent,
              opens_at, closes_at,
              CASE WHEN availabl > 0 AND free_per_week > 0
                   THEN row_number() OVER (
                          PARTITION BY (availabl > 0 AND free_per_week > 0)
                          ORDER BY free_per_week DESC, weekday, ord)
              END::int AS rank
         FROM freed
        ORDER BY weekday, ord`,
      [facilityId, season.id],
    );

    /*
     * Seat occupancy, and the lanes it could not account for.
     *
     * Only lanes that carry a booking *and* have a capacity go into the
     * fraction. The uncovered ones are counted so the screen can print the
     * asterisk rather than imply there isn't one — criterion 3.
     */
    const seats = await tx.query<{
      swimmers: number;
      places: number;
      uncovered: number;
    }>(
      `WITH sess AS (${sessions}),
       booked AS (
         SELECT DISTINCT csl.lane_id
           FROM class_session_lane csl
           JOIN sess ON sess.id = csl.session_id
          WHERE NOT csl.cancelled
       )
       SELECT coalesce((SELECT sum(headcount) FROM sess), 0)::int AS swimmers,
              coalesce((SELECT sum(l.default_capacity) FROM booked b
                          JOIN lane l ON l.id = b.lane_id
                         WHERE l.default_capacity IS NOT NULL), 0)::int AS places,
              (SELECT count(*)::int FROM booked b
                 JOIN lane l ON l.id = b.lane_id
                WHERE l.default_capacity IS NULL) AS uncovered`,
      [facilityId, season.id],
    );

    /*
     * What the partnerships are contracted for — criterion 9 and 10.
     *
     * Exposed for the dashboards module and rendered by nothing here. Null for a
     * caller who may not see money, which is enforced at the controller: an
     * instructor may read occupancy and may not read what a school pays.
     */
    let contractedCents: number | null = null;
    if (includeMoney) {
      const money = await tx.query<{ cents: number }>(
        `SELECT coalesce(sum(round(pa.unit_price * 100)), 0)::int AS cents
           FROM partner_agreement pa
           JOIN partner p ON p.id = pa.partner_id AND p.organization_id = pa.organization_id
          WHERE p.facility_id = $1
            AND p.archived_at IS NULL
            AND pa.archived_at IS NULL
            AND pa.start_date <= club_today()
            AND (pa.end_date IS NULL OR pa.end_date >= club_today())`,
        [facilityId],
      );
      contractedCents = money.rows[0]?.cents ?? 0;
    }

    const cells = dayBand.rows.map((cell) => ({
      rank: cell.rank,
      cell: {
        weekday: cell.weekday,
        band: cell.band,
        availableLaneHours: cell.availabl,
        soldLaneHours: cell.sold,
        openDays: cell.open_days,
        freeLaneHoursPerWeek: cell.free_per_week,
        freePercent: cell.free_percent === null ? null : Number(cell.free_percent),
        opensAt: cell.opens_at,
        closesAt: cell.closes_at,
      } satisfies DayBandCell,
    }));

    const row = totals.rows[0]!;
    const sold = Number(row.sold);
    const availableHours = Number(row.availabl);
    const seat = seats.rows[0]!;

    return {
      seasonId: season.id,
      seasonName: season.name,
      seasonStartsOn: season.startsOn,
      seasonEndsOn: season.endsOn,
      total: {
        soldLaneHours: row.sold,
        turmaLaneHours: row.turma,
        parceriaLaneHours: row.parceria,
        headcount: row.headcount,
        turmaHeadcount: row.turma_headcount,
        parceriaHeadcount: row.parceria_headcount,
        availableLaneHours: row.availabl,
      },
      // Null rather than zero when there is nothing to divide by: a club with no
      // slot grid has no occupancy, which is not the same as 0%.
      laneHourOccupancy: availableHours > 0 ? (sold / availableHours) * 100 : null,
      seatOccupancy: seat.places > 0 ? (seat.swimmers / seat.places) * 100 : null,
      lanesWithoutCapacity: seat.uncovered,
      byDay: byDay.rows.map((day) => ({
        weekday: day.weekday,
        soldLaneHours: day.sold,
        turmaLaneHours: day.turma,
        parceriaLaneHours: day.parceria,
        headcount: day.headcount,
        turmaHeadcount: day.turma_headcount,
        parceriaHeadcount: day.parceria_headcount,
        availableLaneHours: day.availabl,
      })),
      byBand: byBand.rows.map((band) => ({
        band: band.band,
        soldLaneHours: band.sold,
        turmaLaneHours: band.turma,
        parceriaLaneHours: band.parceria,
        headcount: band.headcount,
        turmaHeadcount: band.turma_headcount,
        parceriaHeadcount: band.parceria_headcount,
      })),
      byDayBand: cells.map((one) => one.cell),
      mostFree: cells
        .filter((one) => one.rank !== null && one.rank <= 5)
        .sort((a, b) => a.rank! - b.rank!)
        .map((one) => one.cell),
      contractedCents,
    };
  });
}
