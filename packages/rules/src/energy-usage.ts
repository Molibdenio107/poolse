/**
 * Altos e baixos — how a meter's use moves between readings (Rui, 12-11-2026;
 * research in docs/research/energy-metering-2026-11.md › 3).
 *
 * A club reads its dials by hand, weekly or monthly, never at even gaps — so
 * use is compared **per day**: an interval's consumption divided by its days.
 * An interval is unusual when its daily use sits more than `UNUSUAL_SHARE`
 * (30 %) above or below the **median** of the intervals before it (up to
 * `BASELINE_INTERVALS`, at least `MIN_BASELINE`): a median, so one odd month
 * does not move the yardstick. The same-month-last-year comparison already
 * lives in Comparação; this one catches a leak, a stuck pump or a typo soon.
 *
 * Pure, one definition for the API that derives it and any screen that
 * explains it. The thresholds are named so the screen can say them in words.
 */

export const UNUSUAL_SHARE = 0.3;
export const BASELINE_INTERVALS = 6;
export const MIN_BASELINE = 3;

/** One reading, oldest first, with what it used since the one before. */
export interface UsageInterval {
  takenAt: string;
  /** The previous reading's moment, or null for the first of a series. */
  previousAt: string | null;
  /** What was used in the interval, or null when there is nothing to measure from. */
  consumed: number | null;
}

export interface IntervalUsage {
  takenAt: string;
  days: number | null;
  /** Use per day over the interval, or null. */
  perDay: number | null;
  /** The median per-day use it was compared with, or null with too little history. */
  usual: number | null;
  /** (perDay − usual) / usual — +0.42 is 42 % above the usual. */
  deviation: number | null;
  flag: 'high' | 'low' | null;
}

export interface UsageSummary {
  intervals: number;
  highest: { takenAt: string; previousAt: string; perDay: number } | null;
  lowest: { takenAt: string; previousAt: string; perDay: number } | null;
  /** Total used ÷ total days over the intervals counted. */
  averagePerDay: number | null;
  unusual: number;
}

const DAY_MS = 86_400_000;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Each interval's use per day and whether it is unusual, in the order given (oldest first). */
export function intervalUsage(series: UsageInterval[]): IntervalUsage[] {
  const earlier: number[] = [];
  return series.map((one) => {
    const days =
      one.previousAt === null ? null : (Date.parse(one.takenAt) - Date.parse(one.previousAt)) / DAY_MS;
    // Under an hour is not an interval anybody meant to compare; it divides by almost nothing.
    const perDay = one.consumed === null || days === null || days < 1 / 24 ? null : one.consumed / days;

    const baseline = earlier.slice(-BASELINE_INTERVALS);
    const usual = baseline.length >= MIN_BASELINE ? median(baseline) : null;
    const deviation = perDay === null || usual === null || usual <= 0 ? null : (perDay - usual) / usual;
    const flag =
      deviation === null ? null : deviation > UNUSUAL_SHARE ? 'high' : deviation < -UNUSUAL_SHARE ? 'low' : null;

    if (perDay !== null) earlier.push(perDay);
    return { takenAt: one.takenAt, days, perDay, usual, deviation, flag };
  });
}

/** The period's highs and lows, from the intervals that end on or after `since`. */
export function summariseUsage(series: UsageInterval[], usage: IntervalUsage[], since: string): UsageSummary {
  let highest: UsageSummary['highest'] = null;
  let lowest: UsageSummary['lowest'] = null;
  let used = 0;
  let days = 0;
  let intervals = 0;
  let unusual = 0;

  usage.forEach((one, index) => {
    const source = series[index]!;
    if (one.perDay === null || one.days === null || source.previousAt === null || one.takenAt < since) return;
    intervals += 1;
    used += source.consumed ?? 0;
    days += one.days;
    if (one.flag !== null) unusual += 1;
    const point = { takenAt: one.takenAt, previousAt: source.previousAt, perDay: one.perDay };
    if (highest === null || one.perDay > highest.perDay) highest = point;
    if (lowest === null || one.perDay < lowest.perDay) lowest = point;
  });

  return { intervals, highest, lowest, averagePerDay: days > 0 ? used / days : null, unusual };
}
