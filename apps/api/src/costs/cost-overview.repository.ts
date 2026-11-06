import { withOrg } from '@poolse/db';
import { clubToday } from '../common/club-day.js';
import {
  COST_GROUPS,
  POOL_GROUPS,
  compareWindows,
  estimatedMonths,
  groupOf,
  monthsInWindow,
  monthsOf,
  windowTable,
  windowTotals,
  type Comparison,
  type CostGroup,
  type GroupTotal,
  type TableMonth,
} from './cost-overview.js';
import { ledgerMonths } from './costs.repository.js';

export type CostRuler = 'civil' | 'season';

export interface CostWindowOption {
  key: string;
  label: string;
  from: string;
  to: string;
}

export interface CostsOverview {
  ruler: CostRuler;
  withVat: boolean;
  windows: Record<CostRuler, Omit<CostWindowOption, 'from' | 'to'>[]>;
  /** The chosen window; `to` stops at today, so a running year counts no future pay. */
  window: CostWindowOption & { runningToday: boolean };
  chart: { month: string; groups: Partial<Record<CostGroup, number>> }[];
  seasons: { name: string; startsOn: string; endsOn: string }[];
  totals: GroupTotal[];
  invoicedCents: number;
  estimatedCents: number;
  /** Months estimated by something other than pay, which is always estimated. */
  estimatedMonths: number;
  table: TableMonth[];
  averages: {
    months: number;
    perMonthCents: number | null;
    taughtHours: number;
    perHourCents: number | null;
    studentMonths: number;
    perStudentMonthCents: number | null;
    cubicMetres: number | null;
    poolsWithoutVolume: number;
    perCubicMetreCents: number | null;
  };
  comparison: Comparison | { months: number; groups: null } | null;
  previousLabel: string | null;
  salariesWithoutHours: number;
  unpricedSupplyMonths: number;
  ownerPayLeftOut: boolean;
}

function divide(cents: number, by: number | null): number | null {
  return by === null || by <= 0 ? null : Math.round(cents / by);
}

/**
 * Everything the *Custos* page shows, in one read — POOLSE-183.
 *
 * **A ruler is two windows over the same rows.** The civil years come from the
 * first month with a cost, the épocas from the shared seasons a person has
 * published. Which window is shown, and the one before it, are chosen here so the
 * screen and its CSV cannot differ.
 */
export async function costsOverview(
  organizationId: string,
  asked: { ruler: CostRuler; key: string | undefined; withVat: boolean },
  withoutOwner: boolean,
  isOn: (group: CostGroup) => boolean,
): Promise<CostsOverview> {
  const today = clubToday();
  const { ruler, withVat } = asked;

  const lists = await withOrg(organizationId, async (tx) => {
    const { rows: seasons } = await tx.query<{ id: string; name: string; starts_on: string; ends_on: string }>(
      `SELECT id, name, starts_on::text, ends_on::text
         FROM season
        WHERE organization_id = $1 AND archived_at IS NULL AND status <> 'draft'
          AND sport_id IS NULL AND starts_on <= $2::date
        ORDER BY starts_on DESC`,
      [organizationId, today],
    );
    const { rows: first } = await tx.query<{ year: number | null }>(
      `SELECT extract(YEAR FROM least(
                (SELECT min(month) FROM cost_month WHERE organization_id = $1),
                (SELECT min(effective_from) FROM staff_compensation
                  WHERE organization_id = $1 AND archived_at IS NULL)))::int AS year`,
      [organizationId],
    );
    return { seasons, firstYear: first[0]?.year ?? null };
  });

  const thisYear = Number(today.slice(0, 4));
  const firstYear = Math.max(thisYear - 4, lists.firstYear ?? thisYear);
  const civil: CostWindowOption[] = [];
  for (let year = thisYear; year >= firstYear; year -= 1) {
    civil.push({ key: String(year), label: String(year), from: `${year}-01-01`, to: `${year}-12-31` });
  }
  const seasons: CostWindowOption[] = lists.seasons.map((season) => ({
    key: season.id,
    label: season.name,
    from: season.starts_on,
    to: season.ends_on,
  }));

  // A ruler with nothing to show yet (no época published) falls back to civil.
  const usable: CostRuler = ruler === 'season' && seasons.length > 0 ? 'season' : 'civil';
  const options = usable === 'season' ? seasons : civil;
  const running = options.find((option) => option.from <= today && option.to >= today);
  const chosen = options.find((option) => option.key === asked.key) ?? running ?? options[0]!;
  const before = options[options.indexOf(chosen) + 1];
  const previous =
    usable === 'civil' && before === undefined
      ? { key: '', label: String(Number(chosen.key) - 1), from: `${Number(chosen.key) - 1}-01-01`, to: `${Number(chosen.key) - 1}-12-31` }
      : before;

  const to = chosen.to < today ? chosen.to : today;
  const window = { from: chosen.from, to };

  const chartMonths = monthsOf(shiftYears(today, -2), today).slice(-24);
  const start = [`${chartMonths[0]!}-01`, chosen.from, previous?.from ?? chosen.from].sort()[0]!;
  const ledger = await ledgerMonths(organizationId, start, today, withoutOwner);
  const rows = ledger.months.filter((row) => isOn(groupOf(row.kind)));

  const chart = chartMonths.map((month) => {
    const groups: Partial<Record<CostGroup, number>> = {};
    for (const row of rows) {
      if (row.month !== month) continue;
      const group = groupOf(row.kind);
      groups[group] = (groups[group] ?? 0) + row.netCents + (withVat ? row.vatCents : 0);
    }
    return { month, groups };
  });

  const table = windowTable(rows, window.from, window.to, withVat);
  const totals = windowTotals(table);
  const invoicedCents = totals.reduce((sum, total) => sum + total.invoicedCents, 0);
  const estimatedCents = totals.reduce((sum, total) => sum + total.estimatedCents, 0);
  const totalCents = invoicedCents + estimatedCents;
  const poolCents = totals
    .filter((total) => POOL_GROUPS.includes(total.group))
    .reduce((sum, total) => sum + total.invoicedCents + total.estimatedCents, 0);

  const denominators = await withOrg(organizationId, async (tx) => {
    // POOLSE-28's denominator, across every recinto: taught, not timetabled,
    // no free-swim block, and `class_group` not joined, so a parceria's hours count.
    const { rows: taught } = await tx.query<{ minutes: number }>(
      `SELECT coalesce(sum(cs.duration_minutes), 0)::int AS minutes
         FROM class_session cs
        WHERE cs.organization_id = $1
          AND cs.occurs_on BETWEEN $2::date AND $3::date
          AND cs.status <> 'cancelled'
          AND cs.starts_at <= now()
          AND NOT EXISTS (
            SELECT 1 FROM class_schedule fs
             WHERE fs.id = cs.schedule_id AND fs.organization_id = cs.organization_id
               AND fs.subject_type = 'free_swim')`,
      [organizationId, window.from, window.to],
    );
    // Each active enrolment's days in each month, over that month's days.
    const { rows: students } = await tx.query<{ months: number }>(
      `WITH m AS (
         SELECT g::date AS first, (g + interval '1 month - 1 day')::date AS last
           FROM generate_series(date_trunc('month', $2::date), date_trunc('month', $3::date), interval '1 month') AS g
       )
       SELECT coalesce(sum(
                (least(m.last, $3::date, coalesce(e.ended_on, m.last))
                 - greatest(m.first, $2::date, e.joined_on) + 1)::numeric
                / (m.last - m.first + 1)), 0)::float8 AS months
         FROM m
         JOIN enrollment e
           ON e.organization_id = $1
          AND e.status <> 'waiting'
          AND e.joined_on <= least(m.last, $3::date)
          AND (e.ended_on IS NULL OR e.ended_on >= greatest(m.first, $2::date))`,
      [organizationId, window.from, window.to],
    );
    const { rows: pools } = await tx.query<{ cubic_metres: number | null; unknown: number }>(
      `SELECT (sum(volume_litres) / 1000.0)::float8 AS cubic_metres,
              count(*) FILTER (WHERE volume_litres IS NULL)::int AS unknown
         FROM pool WHERE organization_id = $1 AND archived_at IS NULL`,
      [organizationId],
    );
    return {
      taughtHours: (taught[0]?.minutes ?? 0) / 60,
      studentMonths: students[0]?.months ?? 0,
      // A partly known volume would flatter the figure, so it says so instead.
      cubicMetres: pools[0]?.unknown === 0 ? pools[0].cubic_metres : null,
      poolsWithoutVolume: pools[0]?.unknown ?? 0,
    };
  });

  const months = monthsInWindow(window.from, window.to);

  return {
    ruler: usable,
    withVat,
    windows: {
      civil: civil.map(({ key, label }) => ({ key, label })),
      season: seasons.map(({ key, label }) => ({ key, label })),
    },
    window: { ...chosen, to, runningToday: chosen.to > today },
    chart,
    seasons: lists.seasons
      .filter((season) => season.ends_on >= `${chartMonths[0]!}-01`)
      .map((season) => ({ name: season.name, startsOn: season.starts_on, endsOn: season.ends_on })),
    totals,
    invoicedCents,
    estimatedCents,
    estimatedMonths: estimatedMonths(table),
    table,
    averages: {
      months,
      perMonthCents: rows.length === 0 ? null : divide(totalCents, months),
      taughtHours: denominators.taughtHours,
      perHourCents: divide(totalCents, denominators.taughtHours),
      studentMonths: denominators.studentMonths,
      perStudentMonthCents: divide(totalCents, denominators.studentMonths),
      cubicMetres: denominators.cubicMetres,
      poolsWithoutVolume: denominators.poolsWithoutVolume,
      perCubicMetreCents: divide(poolCents, denominators.cubicMetres),
    },
    comparison: previous === undefined ? null : compareWindows(rows, window, previous, today, withVat),
    previousLabel: previous?.label ?? null,
    salariesWithoutHours: COST_GROUPS.filter(isOn).includes('salary') ? ledger.salariesWithoutHours : 0,
    unpricedSupplyMonths: isOn('electricity') ? ledger.unpricedSupplyMonths : 0,
    ownerPayLeftOut: withoutOwner,
  };
}

function shiftYears(date: string, years: number): string {
  return `${Number(date.slice(0, 4)) + years}${date.slice(4, 8)}01`;
}
