import { withOrg } from '@poolse/db';
import { liveTariffJoin } from './tariffs.repository.js';

/**
 * What a tank's energy costs per hour taught in it — POOLSE-28.
 *
 * The number no competitor can compute, because none of them holds both the
 * meter and the lesson schedule. A club is told it used 14 000 kWh; what
 * decides whether a Tuesday 07:00 turma is worth running is that it costs €38
 * an hour to heat while Saturday morning costs €4 a bather.
 *
 * **Built at the MONTH, not at the ticket's fifteen minutes** — and that is a
 * narrowing, taken knowingly on 2026-09-20. POOLSE-28's Dev section assumes a
 * TimescaleDB hypertable with continuous aggregates at a 15-minute grain,
 * tariff bands allocated by time of day, and DST-boundary arithmetic. None of
 * that is reachable: `energy_reading` is deliberately not a hypertable and a
 * club types **one figure per meter per month**, so there is no data from which
 * a single Tuesday could be costed. Attributing a month's kWh to one 07:00
 * class would be an invention, not a measurement. When automated feeds land,
 * this file is where the finer grain goes and the API shape does not change.
 *
 * **So every figure here is a month divided by a month**, and the report says
 * so. Three denominators, all over the same window:
 *
 * - **per turma hour** — the tank's cost over the hours actually taught in it
 * - **per bather** — over the people who were in the water, which is recorded
 *   attendance and therefore includes reposição guests
 * - **per m³** — over the basin's volume, or nothing when it has none
 *
 * **A cancelled session contributes nothing and its energy is not lost.** The
 * tank was still heated, so that consumption is reported as *unallocated*
 * rather than dropped or divided by zero — POOLSE-28 AC and QA 28.3.
 */

/** One month of the report. Every month in the window is present. */
export interface CostMonth {
  /** `YYYY-MM`, in the site's timezone. */
  month: string;
  /** What the tank's meters consumed, in their own units summed as kWh. */
  kwh: number | null;
  /** Estimated cost, or null when any of the month's consumption went unpriced. */
  costCents: number | null;
  /** Minutes taught in this tank that month, cancelled sessions excluded. */
  taughtMinutes: number;
  /** People in the water, summed over those sessions. Guests included. */
  bathers: number;
  /**
   * True when the month has consumption but nothing was taught in the tank.
   *
   * The energy is real and the denominator is zero, so there is no rate to
   * report — and a blank would read as "nothing happened". QA 28.3.
   */
  unallocated: boolean;
}

/**
 * One turma's share of the tank — POOLSE-28 AC 6.
 *
 * **Pro rata by the hours it was actually taught**, which is the only division
 * the data supports: a month's kWh cannot be attributed to a Tuesday at 07:00,
 * so every hour in the tank is charged the same rate. A turma that teaches a
 * fifth of the hours carries a fifth of the cost.
 *
 * The shares of every turma plus the unallocated months add back up to the
 * tank's total, which is the property that makes the number safe to quote.
 */
export interface GroupShare {
  /** Null for a parceria — it has no turma, and its hours still count. */
  groupId: string | null;
  name: string | null;
  taughtMinutes: number;
  bathers: number;
  /** Its share of the window's cost, or null when the tank has no rate. */
  shareCents: number | null;
}

/** A meter the report added up, named so the derivation is checkable. */
export interface CostSource {
  id: string;
  name: string;
  /** False when the meter has no rate covering part of the window. */
  fullyPriced: boolean;
}

export interface PoolCostReport {
  poolId: string;
  poolName: string;
  months: CostMonth[];

  /**
   * The basin's volume in m³, or null.
   *
   * Null is "not measured" and the screen says which figure is unavailable and
   * why — never a blank cell and never a zero. QA 28.4.
   */
  cubicMetres: number | null;

  /** The meters this report is the sum of. Empty means nothing is metered here. */
  sources: CostSource[];

  // --- the window's totals, from which the three rates are read -------------
  costCents: number | null;
  kwh: number | null;
  taughtMinutes: number;
  bathers: number;
  /** Consumption in months where nothing was taught, in cents. */
  unallocatedCents: number | null;

  /** Months with consumption, and how many of those carried a rate throughout. */
  monthsWithConsumption: number;
  monthsPriced: number;

  /** Who taught in the tank, and what each one's share of the heat was. */
  byGroup: GroupShare[];
}

/**
 * The tank's own meters, costed — the same `CONSUMED`/tariff pair the meter
 * page uses, widened from one meter to every meter serving one pool.
 *
 * `$1` organization, `$2` pool, `$3` timezone. A meter is *this tank's* when
 * `pool_id` names it; a site-wide "Geral" dial is not, because its kWh heat the
 * changing rooms and the car park lights as well and splitting them would be a
 * guess. That is also why a club with no sub-meter on the tank gets an empty
 * report saying so rather than a plausible wrong number.
 */
const POOL_CONSUMED = `
  SELECT r.organization_id, r.meter_id, r.taken_at,
         CASE
           WHEN m.reads = 'interval_consumption' THEN r.value
           ELSE r.value - coalesce(
                  lag(r.value) OVER (PARTITION BY r.meter_id ORDER BY r.taken_at),
                  m.initial_index)
         END AS consumed
    FROM energy_reading r
    JOIN energy_meter m ON m.id = r.meter_id AND m.organization_id = r.organization_id
   WHERE r.organization_id = $1
     AND m.pool_id = $2
     AND r.archived_at IS NULL`;

interface MonthRow {
  month: string;
  kwh: number | null;
  cost_cents: number | null;
  unpriced: number;
  taught_minutes: number;
  bathers: number;
}

/**
 * Twelve months of what this tank cost and what was taught in it.
 *
 * One query for the energy side and one for the teaching side, joined in
 * TypeScript on the month key rather than in SQL — they share no row, only a
 * calendar, and a single query would need a full outer join over two
 * independently sparse sets to say the same thing less legibly.
 */
export async function poolCostReport(
  organizationId: string,
  poolId: string,
  timezone: string,
  months = 12,
): Promise<PoolCostReport | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows: pools } = await tx.query<{ name: string; cubic_metres: number | null }>(
      `SELECT name, (volume_litres / 1000.0)::float8 AS cubic_metres
         FROM pool WHERE organization_id = $1 AND id = $2`,
      [organizationId, poolId],
    );
    const pool = pools[0];
    if (pool === undefined) return null;

    // The meters that make this report, and whether each one is priced
    // throughout. Named on screen so a derived figure can be checked rather
    // than trusted — POOLSE-28 AC 5.
    const { rows: sources } = await tx.query<{ id: string; name: string; unpriced: number }>(
      `WITH c AS (${POOL_CONSUMED}), p AS (
         SELECT c.*, tar.unit_price
           FROM c
           ${liveTariffJoin('c', '(c.taken_at AT TIME ZONE $3)::date')}
       )
       SELECT m.id, m.name,
              count(p.consumed) FILTER (WHERE p.unit_price IS NULL)::int AS unpriced
         FROM energy_meter m
         LEFT JOIN p ON p.meter_id = m.id
        WHERE m.organization_id = $1 AND m.pool_id = $2 AND m.archived_at IS NULL
        GROUP BY m.id, m.name
        ORDER BY m.name`,
      [organizationId, poolId, timezone],
    );

    const { rows: energy } = await tx.query<Omit<MonthRow, 'taught_minutes' | 'bathers'>>(
      `WITH c AS (${POOL_CONSUMED}), p AS (
         SELECT c.*, tar.unit_price,
                CASE WHEN c.consumed IS NULL OR tar.unit_price IS NULL THEN NULL
                     ELSE c.consumed * tar.unit_price END AS cost
           FROM c
           ${liveTariffJoin('c', '(c.taken_at AT TIME ZONE $3)::date')}
       ),
       months AS (
         SELECT to_char(
                  date_trunc('month', (now() AT TIME ZONE $3)) - (n || ' months')::interval,
                  'YYYY-MM') AS month
           FROM generate_series($4::int - 1, 0, -1) AS n
       )
       SELECT months.month,
              sum(p.consumed)::float8 AS kwh,
              -- Null unless every consuming reading that month carried a rate.
              -- A partly priced month is not a cheap month, and a rate computed
              -- from one would be wrong in the direction nobody checks.
              CASE WHEN count(p.consumed) > 0
                    AND count(p.consumed) FILTER (WHERE p.unit_price IS NULL) = 0
                   THEN round(sum(p.cost) * 100)
                   ELSE NULL END::int AS cost_cents,
              count(p.consumed) FILTER (WHERE p.unit_price IS NULL)::int AS unpriced
         FROM months
         LEFT JOIN p ON to_char(p.taken_at AT TIME ZONE $3, 'YYYY-MM') = months.month
                    AND p.consumed IS NOT NULL
        GROUP BY months.month
        ORDER BY months.month`,
      [organizationId, poolId, timezone, months],
    );

    /*
     * What was taught in the tank, and who was in the water.
     *
     * `occurs_on` is the session's own calendar day, so the month needs no
     * timezone arithmetic here — that is the column's whole purpose.
     *
     * **A cancelled session is not taught**, so it contributes no minutes and
     * no bathers while its month keeps the consumption; that is what makes a
     * closure month read as unallocated rather than as free heating.
     *
     * **`class_group` is not joined at all**, and deliberately: a parceria
     * session carries no `class_group_id`, and inner-joining that table is how
     * every partnership hour has silently vanished from three earlier queries
     * in this codebase. A partner's hour in the water is an hour the tank was
     * heated, whoever booked it.
     *
     * Bathers are counted from `attendance` with a LATERAL, not a join, so a
     * session with two hundred rows does not multiply its own minutes.
     *
     * **`present` is the whole of it.** `attendance_status` is
     * `present | absent | excused` — POOLSE-13 dropped `late`, so there is no
     * "arrived but was counted separately" state to fold in, and the other two
     * are people who were not in the water to be heated. A first draft of this
     * query said `IN ('present', 'late')` against a label that no longer
     * exists; `tsc` has no opinion about a SQL literal and the integration test
     * is what caught it, which is the lesson `class_session.status` already
     * carries in CLAUDE.md.
     *
     * Reposição guests have ordinary attendance rows and are therefore counted,
     * which is the divergence from the *enrolled* count that QA 28.2 asks to be
     * stated on the report rather than left to be inferred.
     */
    const { rows: teaching } = await tx.query<{ month: string; taught_minutes: number; bathers: number }>(
      `SELECT to_char(cs.occurs_on, 'YYYY-MM') AS month,
              coalesce(sum(cs.duration_minutes), 0)::int AS taught_minutes,
              coalesce(sum(att.n), 0)::int AS bathers
         FROM class_session cs
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS n
             FROM attendance a
            WHERE a.organization_id = cs.organization_id
              AND a.class_session_id = cs.id
              AND a.status = 'present'
         ) att ON true
        WHERE cs.organization_id = $1
          AND cs.pool_id = $2
          AND cs.status <> 'cancelled'
          AND cs.occurs_on >= (date_trunc('month', (now() AT TIME ZONE $3)) - (($4::int - 1) || ' months')::interval)::date
        GROUP BY 1`,
      [organizationId, poolId, timezone, months],
    );

    /*
     * The same window, cut by turma instead of by month — AC 6.
     *
     * A LEFT JOIN to `class_group`, never an inner one: a parceria session
     * carries no `class_group_id`, and an inner join is how partnership hours
     * have silently vanished from three earlier queries here. Its share is
     * reported under a null id, because the tank was heated for it too.
     */
    const { rows: groups } = await tx.query<{
      group_id: string | null;
      name: string | null;
      taught_minutes: number;
      bathers: number;
    }>(
      `SELECT cs.class_group_id AS group_id,
              cg.name,
              coalesce(sum(cs.duration_minutes), 0)::int AS taught_minutes,
              coalesce(sum(att.n), 0)::int AS bathers
         FROM class_session cs
         LEFT JOIN class_group cg
           ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS n
             FROM attendance a
            WHERE a.organization_id = cs.organization_id
              AND a.class_session_id = cs.id
              AND a.status = 'present'
         ) att ON true
        WHERE cs.organization_id = $1
          AND cs.pool_id = $2
          AND cs.status <> 'cancelled'
          AND cs.occurs_on >= (date_trunc('month', (now() AT TIME ZONE $3)) - (($4::int - 1) || ' months')::interval)::date
        GROUP BY 1, 2
        ORDER BY 3 DESC`,
      [organizationId, poolId, timezone, months],
    );

    const taught = new Map(teaching.map((row) => [row.month, row]));

    const monthly: CostMonth[] = energy.map((row) => {
      const side = taught.get(row.month);
      const taughtMinutes = side?.taught_minutes ?? 0;
      return {
        month: row.month,
        kwh: row.kwh,
        costCents: row.cost_cents,
        taughtMinutes,
        bathers: side?.bathers ?? 0,
        // Energy with nothing taught to charge it to. Not an error: August, a
        // closure, a week of works.
        unallocated: row.kwh !== null && taughtMinutes === 0,
      };
    });

    const withConsumption = monthly.filter((m) => m.kwh !== null);
    const priced = withConsumption.filter((m) => m.costCents !== null);
    const sum = (pick: (m: CostMonth) => number | null): number =>
      monthly.reduce((total, m) => total + (pick(m) ?? 0), 0);

    const costCents =
      priced.length === 0 ? null : priced.reduce((t, m) => t + (m.costCents ?? 0), 0);
    const unallocatedCents =
      priced.length === 0
        ? null
        : priced.filter((m) => m.unallocated).reduce((t, m) => t + (m.costCents ?? 0), 0);

    /*
     * What there is to share out: the cost of the months something was actually
     * taught in. An unallocated month's euros are real and belong to no turma,
     * so charging them to the ones that did teach would inflate every share.
     */
    const allocatableCents = costCents === null ? null : costCents - (unallocatedCents ?? 0);
    const allocatableMinutes = sum((m) => m.taughtMinutes);

    return {
      poolId,
      poolName: pool.name,
      months: monthly,
      cubicMetres: pool.cubic_metres,
      sources: sources.map((row) => ({
        id: row.id,
        name: row.name,
        fullyPriced: row.unpriced === 0,
      })),
      // Every total is null rather than zero when nothing fed it — a zero here
      // is a figure an owner would act on.
      costCents,
      kwh: withConsumption.length === 0 ? null : sum((m) => m.kwh),
      taughtMinutes: allocatableMinutes,
      bathers: sum((m) => m.bathers),
      unallocatedCents,
      monthsWithConsumption: withConsumption.length,
      monthsPriced: priced.length,
      byGroup: shareOut(groups, allocatableCents, allocatableMinutes),
    };
  });
}

/**
 * Splits the allocatable cost across the turmas, pro rata by taught minutes.
 *
 * The **last share takes the rounding**, so the parts sum exactly to the whole.
 * Dividing each share independently and rounding each one leaves a total that
 * is a cent or two off its own breakdown, which is the kind of discrepancy that
 * makes somebody distrust every other figure on the page.
 */
function shareOut(
  rows: { group_id: string | null; name: string | null; taught_minutes: number; bathers: number }[],
  allocatableCents: number | null,
  allocatableMinutes: number,
): GroupShare[] {
  let remaining = allocatableCents;

  return rows.map((row, index) => {
    let shareCents: number | null = null;
    if (allocatableCents !== null && allocatableMinutes > 0) {
      shareCents =
        index === rows.length - 1
          ? (remaining ?? 0)
          : Math.round((allocatableCents * row.taught_minutes) / allocatableMinutes);
      remaining = (remaining ?? 0) - shareCents;
    }
    return {
      groupId: row.group_id,
      name: row.name,
      taughtMinutes: row.taught_minutes,
      bathers: row.bathers,
      shareCents,
    };
  });
}

/** The tank a turma teaches in, so its cost can be read off that tank's report. */
export async function groupPool(
  organizationId: string,
  groupId: string,
): Promise<string | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ pool_id: string | null }>(
      `SELECT pool_id FROM class_group WHERE organization_id = $1 AND id = $2`,
      [organizationId, groupId],
    );
    return rows[0]?.pool_id ?? null;
  });
}

/** The site's clock, which is what a month is measured in. */
export async function poolTimezone(organizationId: string, poolId: string): Promise<string | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ timezone: string }>(
      `SELECT f.timezone
         FROM pool p
         JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
        WHERE p.organization_id = $1 AND p.id = $2`,
      [organizationId, poolId],
    );
    return rows[0]?.timezone ?? null;
  });
}
