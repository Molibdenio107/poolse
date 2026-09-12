import { getFormatter } from 'next-intl/server';
import { getTranslations } from 'next-intl/server';
import type { RequestBucket } from '@/lib/api';
import { ScrollX } from '@/components/page-shell';
import { cn } from '@/lib/utils';

/**
 * A week of hourly requests, as two stacks of bars.
 *
 * **HTML and CSS rather than a charting library**, for the reason
 * `consumption-bars.tsx` and `trend-chart.tsx` both give and this screen gives
 * more strongly than either: a bar whose height is a percentage needs no
 * coordinate system, reflows on a phone for free, renders its labels as real
 * text, ships no client JavaScript, and costs about a kilobyte. Recharts on an
 * internal operations page one person opens would be a phase-5 bundle bought for
 * a phase-2 screen, and per-tenant running cost is a design constraint here.
 *
 * **An hour with no requests is a gap, not a zero.** Same rule as the energy
 * chart: "nobody used the app" and "the app answered nothing" are different
 * facts, and a zero-height bar in a row of them reads as the second. A missing
 * hour simply has no bar and the axis still advances, because the columns are
 * one per hour of the window rather than one per row returned.
 *
 * **The figures are in the table below.** The chart summarises; the list is the
 * record, and a reader who sees no colour gets every number.
 */

/** How the two charts differ, so the layout is written once. */
type Series = 'volume' | 'errors';

export async function RequestCharts({
  buckets,
  windowDays,
}: {
  /** Oldest first, as the API returns them. May have gaps. */
  buckets: RequestBucket[];
  windowDays: number;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const format = await getFormatter();

  /*
   * One column per hour of the window, filled from the rows.
   *
   * Drawing only the hours that came back would compress a quiet night into
   * nothing and make Tuesday sit next to Thursday — the chart would be of the
   * rows rather than of the week. 168 columns at 7 days.
   */
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  const hours = windowDays * 24;

  const byHour = new Map(buckets.map((bucket) => [bucket.bucket, bucket]));

  const columns = Array.from({ length: hours }, (_, index) => {
    const at = new Date(now.getTime() - (hours - 1 - index) * 3_600_000);
    return { at, bucket: byHour.get(at.toISOString()) };
  });

  const peakRequests = Math.max(1, ...columns.map((c) => c.bucket?.requestCount ?? 0));
  const peakErrors = Math.max(
    1,
    ...columns.map((c) => (c.bucket?.count4xx ?? 0) + (c.bucket?.count5xx ?? 0)),
  );

  return (
    <div className="flex flex-col gap-page-gap">
      <Chart
        title={t('admin.chart.volume')}
        caption={t('admin.chart.volumeCaption', { days: windowDays })}
        series="volume"
        columns={columns}
        peak={peakRequests}
        t={t}
        format={format}
      />
      <Chart
        title={t('admin.chart.errors')}
        caption={t('admin.chart.errorsCaption', { days: windowDays })}
        series="errors"
        columns={columns}
        peak={peakErrors}
        t={t}
        format={format}
      />
    </div>
  );
}

interface Column {
  at: Date;
  bucket: RequestBucket | undefined;
}

async function Chart({
  title,
  caption,
  series,
  columns,
  peak,
  t,
  format,
}: {
  title: string;
  caption: string;
  series: Series;
  columns: Column[];
  peak: number;
  t: Awaited<ReturnType<typeof getTranslations>>;
  format: Awaited<ReturnType<typeof getFormatter>>;
}): Promise<React.ReactElement> {
  return (
    <section className="rounded border border-border bg-surface p-4">
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mt-0.5 text-sm text-foreground-muted">{caption}</p>

      {/*
        168 columns do not fit a phone and are not meant to: the table scrolls,
        the page does not — the standing rule, and the reason `ScrollX` is named
        rather than left to each caller to remember.
      */}
      <ScrollX className="mt-3">
        <div className="flex h-32 min-w-[42rem] items-end gap-px">
          {columns.map((column) => (
            <Bar key={column.at.toISOString()} column={column} series={series} peak={peak} t={t} format={format} />
          ))}
        </div>
      </ScrollX>

      {/* The axis: the day each midnight starts, so a week reads as a week. */}
      <div className="mt-2 flex justify-between text-xs text-foreground-muted">
        <span>{format.dateTime(columns[0]!.at, 'short')}</span>
        <span>{format.dateTime(columns[columns.length - 1]!.at, 'short')}</span>
      </div>
    </section>
  );
}

function Bar({
  column,
  series,
  peak,
  t,
  format,
}: {
  column: Column;
  series: Series;
  peak: number;
  t: Awaited<ReturnType<typeof getTranslations>>;
  format: Awaited<ReturnType<typeof getFormatter>>;
}): React.ReactElement {
  const hour = format.dateTime(column.at, 'stamp');

  // No row for this hour: a gap, deliberately, not a zero-height bar.
  if (column.bucket === undefined) {
    return <div className="h-full flex-1" title={t('admin.chart.noData', { hour })} />;
  }

  const { requestCount, count4xx, count5xx, p95LatencyMs } = column.bucket;

  if (series === 'volume') {
    return (
      <div
        className="flex h-full flex-1 items-end"
        title={t('admin.chart.volumeTip', { hour, requests: requestCount, ms: p95LatencyMs })}
      >
        <div
          className="w-full rounded-t-sm bg-chart-1"
          style={{ height: `${Math.max((requestCount / peak) * 100, requestCount > 0 ? 2 : 0)}%` }}
        />
      </div>
    );
  }

  /*
   * 4xx and 5xx stacked, 5xx on top and in the danger tone.
   *
   * Two series in one column rather than two charts, because the question is
   * "how much of this hour's trouble was ours" — and a 4xx bar beside a 5xx bar
   * makes that a subtraction the reader has to do. The 5xx sits on top so it is
   * the one against the eye's baseline of "how bad".
   */
  const total = count4xx + count5xx;

  return (
    <div
      className="flex h-full flex-1 flex-col justify-end"
      title={t('admin.chart.errorsTip', { hour, count4xx, count5xx })}
    >
      <div
        className={cn('w-full rounded-t-sm bg-danger', count5xx === 0 && 'hidden')}
        style={{ height: `${Math.max((count5xx / peak) * 100, count5xx > 0 ? 3 : 0)}%` }}
      />
      <div
        className={cn('w-full bg-warning/60', count4xx === 0 && 'hidden')}
        style={{ height: `${Math.max((count4xx / peak) * 100, count4xx > 0 ? 2 : 0)}%` }}
      />
      {/* An hour that was recorded and had no trouble: a hairline on the floor,
          so "measured and fine" is visibly different from "not measured". */}
      {total === 0 && <div className="h-px w-full bg-border" />}
    </div>
  );
}
