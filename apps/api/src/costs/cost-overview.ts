import type { CostBasis, CostKind, LedgerMonth } from './costs.repository.js';

/**
 * The arithmetic behind *Custos* — POOLSE-183. Pure, so a cent can be tested
 * without a database; `cost-overview.repository.ts` feeds it.
 *
 * **Eight groups for nine kinds.** A chart cannot carry a ninth hue, and the
 * ticket's eight kinds never named `other`, so it reads with `fixed` as *Fixos e
 * outros*. The order is the stack's, bottom to top, chosen so neighbours stay
 * apart for a colour-blind reader (the dataviz validator's adjacent pairs).
 */
export const COST_GROUPS = [
  'gas',
  'electricity',
  'materials',
  'insurance',
  'salary',
  'water',
  'maintenance_service',
  'fixed',
] as const;
export type CostGroup = (typeof COST_GROUPS)[number];

/** The groups a switched-off module takes with it; the rest are core. */
export const GROUP_MODULE: Partial<Record<CostGroup, 'energy' | 'salaries' | 'maintenance'>> = {
  electricity: 'energy',
  gas: 'energy',
  water: 'energy',
  salary: 'salaries',
  materials: 'maintenance',
  maintenance_service: 'maintenance',
};

/** The kinds a tank's volume can honestly divide. */
export const POOL_GROUPS: readonly CostGroup[] = ['electricity', 'gas', 'water'];

export function groupOf(kind: CostKind): CostGroup {
  return kind === 'other' ? 'fixed' : kind;
}

function amountOf(row: LedgerMonth, withVat: boolean): number {
  return row.netCents + (withVat ? row.vatCents : 0);
}

/** Every month `[from, to]` touches, as `YYYY-MM`, ascending. */
export function monthsOf(from: string, to: string): string[] {
  const months: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const last = to.slice(0, 7);
  for (;;) {
    const at = `${year}-${String(month).padStart(2, '0')}`;
    if (at > last) return months;
    months.push(at);
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
}

function lastDayOf(month: string): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  return new Date(Date.UTC(year, index, 0)).toISOString().slice(0, 10);
}

/** Days of `[from, to]` inside a month, over the month's days. */
export function partOfMonth(month: string, from: string, to: string): number {
  const first = `${month}-01`;
  const last = lastDayOf(month);
  const lo = from > first ? from : first;
  const hi = to < last ? to : last;
  if (hi < lo) return 0;
  const day = (date: string): number => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
  return (day(hi) - day(lo) + 1) / (day(last) - day(first) + 1);
}

/** Months in a window, a partly covered one counted by its days (rule 4). */
export function monthsInWindow(from: string, to: string): number {
  return monthsOf(from, to).reduce((sum, month) => sum + partOfMonth(month, from, to), 0);
}

export interface TableCell {
  invoicedCents: number;
  estimatedCents: number;
}
export interface TableMonth {
  month: string;
  /** The window covers this month only in part. */
  partial: boolean;
  groups: Partial<Record<CostGroup, TableCell>>;
}

/**
 * A window's month table. **Rounding is carried forward per group and basis**,
 * so the cells sum to the rounded whole and the CSV equals the tiles to the cent
 * (QA 7) even where an época cuts a month.
 */
export function windowTable(rows: readonly LedgerMonth[], from: string, to: string, withVat: boolean): TableMonth[] {
  const exact = new Map<string, number>();
  const shown = new Map<string, number>();
  return monthsOf(from, to).map((month) => {
    const part = partOfMonth(month, from, to);
    const groups: TableMonth['groups'] = {};
    const here = new Map<string, { group: CostGroup; basis: CostBasis; amount: number }>();
    for (const row of rows) {
      if (row.month !== month) continue;
      const group = groupOf(row.kind);
      const key = `${group}|${row.basis}`;
      const entry = here.get(key) ?? { group, basis: row.basis, amount: 0 };
      entry.amount += amountOf(row, withVat) * part;
      here.set(key, entry);
    }
    for (const [key, { group, basis, amount }] of here) {
      const running = (exact.get(key) ?? 0) + amount;
      exact.set(key, running);
      const cents = Math.round(running) - (shown.get(key) ?? 0);
      shown.set(key, Math.round(running));
      const cell = groups[group] ?? { invoicedCents: 0, estimatedCents: 0 };
      if (basis === 'invoice') cell.invoicedCents += cents;
      else cell.estimatedCents += cents;
      groups[group] = cell;
    }
    return { month, partial: part < 1, groups };
  });
}

export interface GroupTotal extends TableCell {
  group: CostGroup;
}

export function windowTotals(table: readonly TableMonth[]): GroupTotal[] {
  return COST_GROUPS.flatMap((group) => {
    const cells = table.flatMap((month) => month.groups[group] ?? []);
    if (cells.length === 0) return [];
    return [
      {
        group,
        invoicedCents: cells.reduce((sum, cell) => sum + cell.invoicedCents, 0),
        estimatedCents: cells.reduce((sum, cell) => sum + cell.estimatedCents, 0),
      },
    ];
  });
}

/**
 * Months with an estimate worth saying. **Salaries are left out**: pay accrues
 * from the contract, so it is an estimate in every month and *inclui N meses
 * estimados* would be true of all of them and tell the reader nothing.
 */
export function estimatedMonths(table: readonly TableMonth[]): number {
  return table.filter((month) =>
    COST_GROUPS.some((group) => group !== 'salary' && (month.groups[group]?.estimatedCents ?? 0) > 0),
  ).length;
}

export interface Comparison {
  /** Months compared: complete, with figures on both sides. */
  months: number;
  groups: { group: CostGroup; currentCents: number; previousCents: number }[];
  currentCents: number;
  previousCents: number;
}

/** Below this, a comparison is absent and says so (rule 5). */
export const MIN_COMPARED_MONTHS = 6;

/**
 * This window beside the previous one. **Only months that have both sides, and
 * have ended, are compared** (the energy 5.4a rule): a running November against a
 * whole one would read as a saving, and a month nobody recorded is not one
 * either. Months pair by position, so there is one definition of "the same month
 * of the previous window".
 */
export function compareWindows(
  rows: readonly LedgerMonth[],
  current: { from: string; to: string },
  previous: { from: string; to: string },
  today: string,
  withVat: boolean,
): Comparison | { months: number; groups: null } {
  const has = new Set(rows.map((row) => row.month));
  const these = monthsOf(current.from, current.to);
  const those = monthsOf(previous.from, previous.to);
  const pairs = these.flatMap((month, index) => {
    const other = those[index];
    if (other === undefined || lastDayOf(month) >= today) return [];
    return has.has(month) && has.has(other) ? [[month, other] as const] : [];
  });
  if (pairs.length < MIN_COMPARED_MONTHS) return { months: pairs.length, groups: null };

  const sum = (months: readonly string[], window: { from: string; to: string }): Map<CostGroup, number> => {
    const totals = new Map<CostGroup, number>();
    for (const row of rows) {
      if (!months.includes(row.month)) continue;
      const group = groupOf(row.kind);
      const part = partOfMonth(row.month, window.from, window.to);
      totals.set(group, (totals.get(group) ?? 0) + amountOf(row, withVat) * part);
    }
    return totals;
  };
  const now = sum(pairs.map(([month]) => month), current);
  const then = sum(pairs.map(([, month]) => month), previous);
  const groups = COST_GROUPS.filter((group) => now.has(group) || then.has(group)).map((group) => ({
    group,
    currentCents: Math.round(now.get(group) ?? 0),
    previousCents: Math.round(then.get(group) ?? 0),
  }));
  return {
    months: pairs.length,
    groups,
    currentCents: groups.reduce((total, group) => total + group.currentCents, 0),
    previousCents: groups.reduce((total, group) => total + group.previousCents, 0),
  };
}
