/**
 * The period *Tendências* shows, and its summary — Rui, 12-11-2026.
 *
 * Tendências drew every analysis a tank ever had, so a month's daily log was
 * squeezed into a strip. It now shows one period, chosen by *Ano* and *Mês*
 * (`?year=2026&month=11`, or `month=all` for the whole year). It opens on the
 * month of the latest analysis. Above the charts, a summary of that period:
 * analyses, days with a reading, readings outside this tank's limits, and min /
 * average / max per metric.
 *
 * Every moment is placed on the facility's clock (`APP_TIME_ZONE`), so a reading
 * at 00:30 on the 1st belongs to the month it was taken in, not to UTC's.
 * "Outside the limits" is `excursions` with the tank's resolved bands, the same
 * judgement as Última análise and the alert email; nothing here re-defines it.
 *
 * Pure: no server or React import, so `node --test` runs it.
 */
import { excursions, type BandMap, type PoolMetric } from '@poolse/rules';
import { APP_TIME_ZONE } from './date-format.ts';

export interface PeriodAnalysis {
  takenAt: string;
  values: { metric: PoolMetric; value: number; unit: string }[];
}

/** A year, and a month 1–12 or null for the whole year. */
export interface WaterPeriod {
  year: number;
  month: number | null;
}

export interface MetricSummary {
  metric: PoolMetric;
  unit: string;
  count: number;
  min: number;
  max: number;
  average: number;
  /** Readings outside the tank's limits, judged per analysis as `excursions` does. */
  outside: number;
}

export interface PeriodSummary {
  analyses: number;
  daysWithReadings: number;
  /** Days of the period up to today: a month still running counts what has passed. */
  daysInPeriod: number;
  outside: number;
  metrics: MetricSummary[];
}

const PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** `YYYY-MM-DD` of an instant, on the facility's clock. */
export function clubDay(iso: string): string {
  return PARTS.format(new Date(iso));
}

/** The years with an analysis, newest first, and the months of each, ascending. */
export function periodsOffered(analyses: PeriodAnalysis[]): { year: number; months: number[] }[] {
  const byYear = new Map<number, Set<number>>();
  for (const analysis of analyses) {
    const day = clubDay(analysis.takenAt);
    const year = Number(day.slice(0, 4));
    const month = Number(day.slice(5, 7));
    if (!byYear.has(year)) byYear.set(year, new Set());
    byYear.get(year)!.add(month);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => b - a)
    .map(([year, months]) => ({ year, months: [...months].sort((a, b) => a - b) }));
}

/**
 * The period asked for, if it holds readings; otherwise the latest analysis's
 * month. A year alone (or `month=all`) is the whole year. Null with no analyses.
 */
export function resolvePeriod(
  analyses: PeriodAnalysis[],
  year: string | undefined,
  month: string | undefined,
): WaterPeriod | null {
  const offered = periodsOffered(analyses);
  if (offered.length === 0) return null;

  const askedYear = offered.find((one) => String(one.year) === year);
  if (askedYear !== undefined) {
    if (month === 'all') return { year: askedYear.year, month: null };
    const askedMonth = askedYear.months.find((one) => String(one) === month);
    // A year chosen with no month — or a month it has no reading in — opens on its latest month.
    return { year: askedYear.year, month: askedMonth ?? askedYear.months[askedYear.months.length - 1]! };
  }

  const latest = analyses.reduce((a, b) => (a.takenAt > b.takenAt ? a : b));
  const day = clubDay(latest.takenAt);
  return { year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) };
}

/** Whether an instant falls in the period, on the facility's clock. */
export function inPeriod(iso: string, period: WaterPeriod): boolean {
  const day = clubDay(iso);
  if (Number(day.slice(0, 4)) !== period.year) return false;
  return period.month === null || Number(day.slice(5, 7)) === period.month;
}

/** Days of the period that have begun by `today` (`YYYY-MM-DD`). */
export function daysElapsed(period: WaterPeriod, today: string): number {
  const first = period.month === null ? `${period.year}-01-01` : `${period.year}-${pad(period.month)}-01`;
  const last =
    period.month === null
      ? `${period.year}-12-31`
      : `${period.year}-${pad(period.month)}-${pad(new Date(Date.UTC(period.year, period.month, 0)).getUTCDate())}`;
  if (today < first) return 0;
  const end = today < last ? today : last;
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000) + 1;
}

/** The summary of the analyses already narrowed to one period. */
export function summarisePeriod(
  analyses: PeriodAnalysis[],
  bands: BandMap,
  period: WaterPeriod,
  today: string,
): PeriodSummary {
  const days = new Set<string>();
  const byMetric = new Map<PoolMetric, { unit: string; values: number[]; outside: number }>();
  let outside = 0;

  for (const analysis of analyses) {
    days.add(clubDay(analysis.takenAt));
    const off = new Set(excursions(analysis.values, bands).map((one) => one.metric));
    outside += off.size;
    for (const reading of analysis.values) {
      const entry = byMetric.get(reading.metric) ?? { unit: reading.unit, values: [], outside: 0 };
      entry.values.push(reading.value);
      if (off.has(reading.metric)) entry.outside += 1;
      byMetric.set(reading.metric, entry);
    }
  }

  return {
    analyses: analyses.length,
    daysWithReadings: days.size,
    daysInPeriod: daysElapsed(period, today),
    outside,
    metrics: [...byMetric.entries()].map(([metric, entry]) => ({
      metric,
      unit: entry.unit,
      count: entry.values.length,
      min: Math.min(...entry.values),
      max: Math.max(...entry.values),
      // Rounded to the reading's own precision at display, never here.
      average: entry.values.reduce((sum, value) => sum + value, 0) / entry.values.length,
      outside: entry.outside,
    })),
  };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
