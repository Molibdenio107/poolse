import { withOrg } from '@poolse/db';
import type { BandOverride, PoolContext, PoolKind, PoolMetric, PoolUse } from '@poolse/rules';
import { OVERDUE, SPACE_JOINS } from '../spaces/spaces.repository.js';

/**
 * The management band's aggregates — POOLSE-66 slice 2b.
 *
 * **One statement each, whatever the number of sites.** This screen is the
 * likeliest thing in the product to become its slow query once a club has
 * several sites, and the way that happens is a loop over facilities issuing one
 * query apiece — which is exactly what `scope=all` would turn into. Every
 * function here takes the site list as an array and filters with `= ANY`, and
 * `dashboard.integration.test.ts` counts the statements to keep it so (QA 11).
 *
 * **Every rule is borrowed, never restated.** The money is the per-student rule
 * in `fees.repository.ts` summed; the overdue room is `OVERDUE` from
 * `spaces.repository.ts`; "sem professor" is the booking's own
 * `instructor_status`; a bad reading is judged by `excursions` in the resolver,
 * against the same bands the pool page uses. A dashboard that counted by a rule
 * of its own would agree with the pages until the day it did not.
 *
 * `facilityIds` is the reader's own sites, already narrowed by the selector.
 * An empty list answers zero rows rather than everything — `= ANY('{}')` is
 * false — which is the safe direction for a list that went missing.
 */

export interface MoneyPeriod {
  paidCents: number;
  dueCents: number;
  overdueCents: number;
  /** Fee lines in the current period, and the people behind them. */
  lines: number;
  students: number;
  studentsOverdue: number;
}

/**
 * Mensalidades in their current period: paid, still to pay, and overdue.
 *
 * The per-student screen's rule, summed. `current_period_start` places each
 * line in the occurrence that covers today, `fee_payable_cents` is what that
 * occurrence costs after both kinds of discount, and a line is overdue when
 * nothing paid it and `fee_due_on` has passed — the same three functions
 * `studentFees` reads, so a family's page and the club's total cannot disagree.
 *
 * **Mensalidades only**, as the ticket names them: an inscrição or a seguro is
 * paid once and has no "this month". A line whose period has not begun or has
 * ended has no current occurrence and is not counted. The late-payment penalty
 * is not in these figures — it is charged once per student, not per line, and
 * the student's page is where it is decided.
 *
 * A site is reached through the plan (`student_fee` has no `facility_id`), and
 * `student_fee_plan_idx` is the index that join asked for.
 */
export async function readMoneyPeriod(
  organizationId: string,
  facilityIds: readonly string[],
): Promise<MoneyPeriod> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      paid_cents: string;
      due_cents: string;
      overdue_cents: string;
      lines: number;
      students: number;
      students_overdue: number;
    }>(
      `SELECT coalesce(sum(line.payable) FILTER (WHERE line.paid), 0)              AS paid_cents,
              coalesce(sum(line.payable) FILTER (WHERE NOT line.paid
                                                   AND NOT line.overdue), 0)       AS due_cents,
              coalesce(sum(line.payable) FILTER (WHERE line.overdue), 0)           AS overdue_cents,
              count(*)::int                                                        AS lines,
              count(DISTINCT line.student_id)::int                                 AS students,
              count(DISTINCT line.student_id) FILTER (WHERE line.overdue)::int     AS students_overdue
         FROM (
           SELECT sf.student_id,
                  fee_payable_cents(sf.amount_cents, coalesce(fp.months, 1)::smallint,
                                    sf.discount_percent, sf.line_discount_percent,
                                    sf.line_discount_cents) AS payable,
                  (pay.id IS NOT NULL) AS paid,
                  (pay.id IS NULL
                   AND fee_due_on(cur.period_start, f.payment_due_day) < club_today()) AS overdue
             FROM student_fee sf
             JOIN fee_plan p
               ON p.id = sf.fee_plan_id AND p.organization_id = sf.organization_id
             JOIN fee_period fp
               ON fp.id = sf.fee_period_id AND fp.organization_id = sf.organization_id
             JOIN facility f
               ON f.id = p.facility_id AND f.organization_id = p.organization_id
             JOIN student st
               ON st.id = sf.student_id AND st.organization_id = sf.organization_id
             CROSS JOIN LATERAL (
               SELECT current_period_start(sf.starts_on, sf.ends_on, fp.months) AS period_start
             ) cur
             LEFT JOIN student_fee_payment pay
                    ON pay.student_fee_id = sf.id AND pay.period_start = cur.period_start
            WHERE sf.archived_at IS NULL
              AND st.archived_at IS NULL
              AND p.kind = 'mensalidade'
              AND cur.period_start IS NOT NULL
              AND p.facility_id = ANY($1::uuid[])
         ) line`,
      [facilityIds],
    );

    const row = rows[0]!;
    return {
      // Sums arrive as bigint, which node-postgres hands over as a string.
      paidCents: Number(row.paid_cents),
      dueCents: Number(row.due_cents),
      overdueCents: Number(row.overdue_cents),
      lines: row.lines,
      students: row.students,
      studentsOverdue: row.students_overdue,
    };
  });
}

export interface OccupancyToday {
  classes: number;
  /** Who is expected in the water: active enrolments, or a partner group's headcount. */
  swimmers: number;
  /** Classes nobody is teaching and somebody should — `to_define` or `uncovered`. */
  withoutInstructor: number;
  /**
   * The busiest moment in any one tank, against that tank's ceiling. Null when
   * nothing is in a tank today. `capacity` null is "not measured", never zero.
   */
  peak: { poolId: string; poolName: string; swimmers: number; capacity: number | null } | null;
}

/**
 * Today's classes, at each site's own date.
 *
 * **`class_session`, never the pattern** — a week moved by hand lands where it
 * was moved to, and the calendar draws it there. Cancelled sessions are out by
 * `status`; that table has no `archived_at`. `class_group` and `partner_group`
 * are LEFT joined, because a parceria's session has no turma and an inner join
 * is how partnerships have silently vanished three times in this codebase.
 *
 * **Today is the site's**, the reading `listSessions` takes: the session's start
 * in the facility's timezone, against now in the same zone. The UTC window
 * around it is there so `class_session_pool_when_idx` / `class_session_when_idx`
 * can narrow the rows before the cast does the exact work.
 *
 * **Sem professor** is the booking's `instructor_status` — a state somebody
 * sets, never a blank somebody reads (POOLSE-53) — and only where nothing
 * resolves for this one session: a substitute, the session's own instructor,
 * the turma's or the booking's. `external` is a partner teaching its own group
 * and is never counted.
 *
 * **The peak** is the most swimmers sharing one tank at one moment: for each
 * session, everyone in the same tank whose class has begun and not ended at its
 * start. The busiest moment always begins at some class's start, so that is
 * every moment worth checking.
 */
export async function readOccupancyToday(
  organizationId: string,
  facilityIds: readonly string[],
): Promise<OccupancyToday> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      classes: number;
      swimmers: number;
      without_instructor: number;
      peak: OccupancyToday['peak'];
    }>(
      `WITH today AS (
         SELECT cs.id, cs.pool_id, cs.starts_at, cs.ends_at,
                -- Counted as pool_occupancy() counts — the figure reception and
                -- the desk's refusal use (13-10-2026 sweep): the turma through
                -- the session or its booking, else the booking's headcount
                -- override, else the partner group's size.
                CASE
                  WHEN coalesce(cs.class_group_id, sch.class_group_id) IS NOT NULL THEN
                    (SELECT count(*) FROM enrollment e
                      WHERE e.organization_id = cs.organization_id
                        AND e.class_group_id = coalesce(cs.class_group_id, sch.class_group_id)
                        AND e.status = 'active')::int
                  ELSE coalesce(sch.headcount_override, pg.participant_count, 0)
                END AS swimmers,
                (coalesce(cs.substitute_instructor_membership_id,
                          cs.instructor_membership_id,
                          cg.instructor_membership_id,
                          sch.instructor_membership_id) IS NULL
                 AND coalesce(sch.instructor_status::text, 'to_define') IN ('to_define', 'uncovered'))
                  AS without_instructor
           FROM class_session cs
           LEFT JOIN class_group cg
                  ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
           LEFT JOIN class_schedule sch
                  ON sch.id = cs.schedule_id AND sch.organization_id = cs.organization_id
           LEFT JOIN partner_group pg
                  ON pg.id = sch.partner_group_id AND pg.organization_id = sch.organization_id
           LEFT JOIN pool p
                  ON p.id = cs.pool_id AND p.organization_id = cs.organization_id
           JOIN facility f
             ON f.id = coalesce(p.facility_id, sch.facility_id)
            AND f.organization_id = cs.organization_id
          WHERE cs.status <> 'cancelled'
            -- Free swim is water held for the public, not a class: it has no
            -- instructor to be missing and its swimmers are check-ins (POOLSE-68).
            AND sch.subject_type IS DISTINCT FROM 'free_swim'
            AND cs.starts_at >= now() - interval '1 day'
            AND cs.starts_at <  now() + interval '2 days'
            AND (cs.starts_at AT TIME ZONE coalesce(f.timezone, 'Europe/Lisbon'))::date
                = (now() AT TIME ZONE coalesce(f.timezone, 'Europe/Lisbon'))::date
            AND f.id = ANY($1::uuid[])
       ),
       load AS (
         SELECT a.pool_id, sum(b.swimmers)::int AS swimmers
           FROM today a
           JOIN today b
             ON b.pool_id = a.pool_id
            AND b.starts_at <= a.starts_at
            AND b.ends_at   >  a.starts_at
          WHERE a.pool_id IS NOT NULL
          GROUP BY a.pool_id, a.id
       ),
       peak AS (
         SELECT pool_id, max(swimmers)::int AS swimmers FROM load GROUP BY pool_id
       )
       SELECT (SELECT count(*) FROM today)::int                                    AS classes,
              (SELECT coalesce(sum(swimmers), 0) FROM today)::int                  AS swimmers,
              (SELECT count(*) FROM today WHERE without_instructor)::int           AS without_instructor,
              (SELECT json_build_object('poolId', po.id, 'poolName', po.name,
                                        'swimmers', pk.swimmers, 'capacity', po.max_capacity)
                 FROM peak pk
                 JOIN pool po ON po.id = pk.pool_id
                ORDER BY (pk.swimmers::float8 / nullif(po.max_capacity, 0)) DESC NULLS LAST,
                         pk.swimmers DESC, po.name
                LIMIT 1)                                                           AS peak`,
      [facilityIds],
    );

    const row = rows[0]!;
    return {
      classes: row.classes,
      swimmers: row.swimmers,
      withoutInstructor: row.without_instructor,
      peak: row.peak,
    };
  });
}

export type Severity = 'low' | 'normal' | 'high';

export interface MaintenanceOpen {
  /** Open requests by kind and severity; a combination with none is absent. */
  open: { type: 'fault' | 'restock'; severity: Severity; count: number }[];
  /** Espaços past their cleaning interval, by `OVERDUE`. */
  overdueCleanings: number;
}

/**
 * Open avarias and reposições, and rooms overdue for cleaning.
 *
 * Two counts in one statement. The requests are grouped by kind and severity in
 * the database; the overdue rooms reuse `OVERDUE` and `SPACE_JOINS` exactly, so
 * the card and the Espaços screen are one rule read twice — out of service is
 * never overdue, no interval is never overdue, never cleaned is.
 */
export async function readMaintenanceOpen(
  organizationId: string,
  facilityIds: readonly string[],
): Promise<MaintenanceOpen> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      open: MaintenanceOpen['open'];
      overdue_cleanings: number;
    }>(
      `SELECT
         (SELECT coalesce(json_agg(json_build_object('type', g.type, 'severity', g.severity,
                                                     'count', g.n)
                                   ORDER BY g.type, g.severity DESC), '[]'::json)
            FROM (SELECT mr.type::text AS type, mr.severity::text AS severity, count(*)::int AS n
                    FROM maintenance_request mr
                   WHERE mr.status = 'open'
                     AND mr.archived_at IS NULL
                     AND mr.facility_id = ANY($1::uuid[])
                   GROUP BY mr.type, mr.severity) g)                AS open,
         (SELECT count(*)::int
            FROM space s
            ${SPACE_JOINS}
           WHERE s.archived_at IS NULL
             AND s.facility_id = ANY($1::uuid[])
             AND (${OVERDUE}))                                      AS overdue_cleanings`,
      [facilityIds],
    );

    const row = rows[0]!;
    return { open: row.open, overdueCleanings: row.overdue_cleanings };
  });
}

export interface PoolWaterRow {
  poolId: string;
  poolName: string;
  facilityId: string;
  takenAt: string | null;
  values: { metric: PoolMetric; value: number; unit: string }[];
  overrides: BandOverride[];
  /** What the national bands depend on — POOLSE-72. */
  pool: PoolContext;
  /** Past the site's threshold, or never analysed while one is set. */
  due: boolean;
}

/**
 * Every live tank's latest analysis, its own band overrides, and whether it is
 * due — in one statement.
 *
 * The verdict on the values is *not* taken here: whether a reading is out of
 * range is `excursions` against `resolveBands`, in `@poolse/rules`, which is the
 * one definition the pool page and the alert email already share. SQL fetches,
 * the rules package judges.
 *
 * **Due** reads `facility.water_analysis_max_age_hours`, and a null there is not
 * measured and enforces nothing — so a site that never set a threshold has no
 * tank due, ever. Where one is set, a tank with no analysis at all is due:
 * an absence of history is not evidence that the water is fine.
 */
export async function readPoolWater(
  organizationId: string,
  facilityIds: readonly string[],
): Promise<PoolWaterRow[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      pool_id: string;
      pool_name: string;
      facility_id: string;
      taken_at: Date | null;
      values: PoolWaterRow['values'] | null;
      overrides: { metric: PoolMetric; from: number | null; to: number | null }[] | null;
      kind: PoolKind | null;
      use: PoolUse | null;
      due: boolean;
    }>(
      `SELECT p.id AS pool_id, p.name AS pool_name, p.facility_id,
              p.kind::text AS kind, p.use::text AS use,
              latest.taken_at,
              (SELECT json_agg(json_build_object('metric', v.metric,
                                                 -- ::float8, or numeric arrives as a string
                                                 'value', v.value::float8,
                                                 'unit', v.unit))
                 FROM pool_analysis_value v
                WHERE v.analysis_id = latest.id
                  AND v.organization_id = p.organization_id) AS values,
              (SELECT json_agg(json_build_object('metric', r.metric,
                                                 'from', r.min_value::float8,
                                                 'to', r.max_value::float8))
                 FROM pool_metric_range r
                WHERE r.pool_id = p.id
                  AND r.organization_id = p.organization_id
                  AND r.archived_at IS NULL) AS overrides,
              (f.water_analysis_max_age_hours IS NOT NULL
               AND (latest.taken_at IS NULL
                    OR now() - latest.taken_at
                       > make_interval(hours => f.water_analysis_max_age_hours))) AS due
         FROM pool p
         JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
         LEFT JOIN LATERAL (
           SELECT a.id, a.taken_at
             FROM pool_analysis a
            WHERE a.pool_id = p.id
              AND a.organization_id = p.organization_id
              AND a.archived_at IS NULL
            ORDER BY a.taken_at DESC
            LIMIT 1
         ) latest ON true
        WHERE p.archived_at IS NULL
          AND p.facility_id = ANY($1::uuid[])
        ORDER BY p.name`,
      [facilityIds],
    );

    return rows.map((row) => ({
      poolId: row.pool_id,
      poolName: row.pool_name,
      facilityId: row.facility_id,
      takenAt: row.taken_at === null ? null : row.taken_at.toISOString(),
      values: row.values ?? [],
      overrides: (row.overrides ?? []).map((o) => ({ metric: o.metric, from: o.from, to: o.to })),
      pool: { kind: row.kind, use: row.use },
      due: row.due,
    }));
  });
}

export interface PeopleSummary {
  students: number;
  /** Distinct people holding a staff role, so an owner who teaches counts once. */
  staff: number;
  byRole: { owner: number; admin: number; instructor: number; maintenance: number; guardian: number };
  pendingInvitations: number;
  /** Pending invitations that lapse within the next 24 hours. */
  expiringInvitations: number;
}

/**
 * The club's people — club-wide, because a membership and an invitation belong
 * to the club and never to a site, so the selector has nothing to narrow.
 *
 * The headcount rules are `countPeople`'s: archived and still-`invited`
 * memberships are out, a person holding two roles counts under both in the
 * breakdown — and once in `staff`, which is a count of people.
 */
export async function readPeopleSummary(organizationId: string): Promise<PeopleSummary> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      students: number;
      staff: number;
      by_role: Record<string, number> | null;
      pending: number;
      expiring: number;
    }>(
      `WITH held AS (
         SELECT m.id AS membership_id, mr.role::text AS role
           FROM membership_role mr
           JOIN membership m
             ON m.id = mr.membership_id AND m.organization_id = mr.organization_id
          WHERE mr.archived_at IS NULL
            AND m.archived_at IS NULL
            AND m.status = 'active'
       )
       SELECT (SELECT count(*) FROM student WHERE archived_at IS NULL)::int          AS students,
              (SELECT count(DISTINCT membership_id) FROM held
                WHERE role IN ('owner', 'admin', 'instructor', 'maintenance'))::int  AS staff,
              (SELECT json_object_agg(role, n)
                 FROM (SELECT role, count(*)::int AS n FROM held GROUP BY role) r)    AS by_role,
              (SELECT count(*) FROM invitation
                WHERE accepted_at IS NULL AND revoked_at IS NULL
                  AND expires_at > now())::int                                        AS pending,
              (SELECT count(*) FROM invitation
                WHERE accepted_at IS NULL AND revoked_at IS NULL
                  AND expires_at > now()
                  AND expires_at <= now() + interval '24 hours')::int                AS expiring`,
    );

    const row = rows[0]!;
    const held = row.by_role ?? {};
    return {
      students: row.students,
      staff: row.staff,
      byRole: {
        owner: held['owner'] ?? 0,
        admin: held['admin'] ?? 0,
        instructor: held['instructor'] ?? 0,
        maintenance: held['maintenance'] ?? 0,
        guardian: held['guardian'] ?? 0,
      },
      pendingInvitations: row.pending,
      expiringInvitations: row.expiring,
    };
  });
}
