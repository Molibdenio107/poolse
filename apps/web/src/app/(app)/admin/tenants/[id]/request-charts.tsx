import { getTranslations } from 'next-intl/server';
import type { RequestBucket } from '@/lib/api';
import { ScrollX } from '@/components/page-shell';
import { cn } from '@/lib/utils';
import { formatDate, formatStamp } from '@/lib/date-format';

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
 * **The figures are above the bars, not only inside them.** This said they were
 * "in the table below", which was not true — the table below is recent errors by
 * *route*, and every per-hour number lived only in a `title` attribute. A
 * sentence over each chart now carries the window's totals and the hour that
 * matters, and each bar names itself to the accessibility tree; a tooltip
 * explains, it never informs.
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

  /*
   * The window in words, because a figure only a mouse can reach is a figure
   * half this page's readers do not have.
   *
   * The busiest and the worst hour rather than an average: an operator opening
   * this page is looking for the hour something happened, and a mean over 168
   * of them is the one number that cannot point at it. Both are picked by
   * `reduce` over the columns that have a row — a gap is not a quiet hour.
   */
  const recorded = columns.filter((c) => c.bucket !== undefined);
  const totalRequests = recorded.reduce((sum, c) => sum + c.bucket!.requestCount, 0);
  const total4xx = recorded.reduce((sum, c) => sum + c.bucket!.count4xx, 0);
  const total5xx = recorded.reduce((sum, c) => sum + c.bucket!.count5xx, 0);

  const busiest = recorded.reduce<Column | null>(
    (best, c) => (best === null || c.bucket!.requestCount > best.bucket!.requestCount ? c : best),
    null,
  );
  const errorsIn = (c: Column): number => c.bucket!.count4xx + c.bucket!.count5xx;
  const worst = recorded.reduce<Column | null>(
    (best, c) => (best === null || errorsIn(c) > errorsIn(best) ? c : best),
    null,
  );

  const volumeSummary =
    busiest === null || totalRequests === 0
      ? t('admin.chart.volumeSummaryNone', { days: windowDays })
      : t('admin.chart.volumeSummary', {
          total: totalRequests,
          days: windowDays,
          hour: formatStamp(busiest.at),
          requests: busiest.bucket!.requestCount,
          ms: busiest.bucket!.p95LatencyMs,
        });

  const errorsSummary =
    worst === null || total4xx + total5xx === 0
      ? t('admin.chart.errorsSummaryNone', { days: windowDays })
      : t('admin.chart.errorsSummary', {
          count4xx: total4xx,
          count5xx: total5xx,
          days: windowDays,
          hour: formatStamp(worst.at),
          worst: errorsIn(worst),
        });

  return (
    <div className="flex flex-col gap-page-gap">
      <Chart
        title={t('admin.chart.volume')}
        caption={t('admin.chart.volumeCaption', { days: windowDays })}
        summary={volumeSummary}
        series="volume"
        columns={columns}
        peak={peakRequests}
        t={t}
      />
      <Chart
        title={t('admin.chart.errors')}
        caption={t('admin.chart.errorsCaption', { days: windowDays })}
        summary={errorsSummary}
        series="errors"
        columns={columns}
        peak={peakErrors}
        t={t}
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
  summary,
  series,
  columns,
  peak,
  t,
}: {
  title: string;
  caption: string;
  /** The window's figures as a sentence — see the note where it is rendered. */
  summary: string;
  series: Series;
  columns: Column[];
  peak: number;
  t: Awaited<ReturnType<typeof getTranslations>>;
}): Promise<React.ReactElement> {
  return (
    <section className="rounded border border-border bg-surface p-4">
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mt-0.5 text-sm text-foreground-muted">{caption}</p>

      {/*
        The week's figures as words, above the bars.

        This header used to say the numbers were "in the table below", and they
        were not: the table below is recent errors by *route*. Every per-hour
        figure lived only in a `title` attribute — invisible to a keyboard, to a
        touch screen and to a screen reader on a bare `div`, which is the exact
        shape CLAUDE.md rules out. A tooltip may explain; it may not be the only
        place a number appears.

        A summary rather than 168 rows: the totals and the worst hour are what an
        operator actually reads, and each bar now carries its own hour in the
        accessibility tree for the rest.
      */}
      <p className="mt-1 text-sm">{summary}</p>

      {/*
        168 columns do not fit a phone and are not meant to: the table scrolls,
        the page does not — the standing rule, and the reason `ScrollX` is named
        rather than left to each caller to remember.
      */}
      <ScrollX className="mt-3">
        <div className="flex h-32 min-w-[42rem] items-end gap-px">
          {columns.map((column) => (
            <Bar key={column.at.toISOString()} column={column} series={series} peak={peak} t={t} />
          ))}
        </div>
      </ScrollX>

      {/* The axis: the day each midnight starts, so a week reads as a week. */}
      <div className="mt-2 flex justify-between text-xs text-foreground-muted">
        <span>{formatDate(columns[0]!.at)}</span>
        <span>{formatDate(columns[columns.length - 1]!.at)}</span>
      </div>
    </section>
  );
}

function Bar({
  column,
  series,
  peak,
  t,
}: {
  column: Column;
  series: Series;
  peak: number;
  t: Awaited<ReturnType<typeof getTranslations>>;
}): React.ReactElement {
  const hour = formatStamp(column.at);

  /*
   * `role="img"` with the sentence as its name, beside the `title`.
   *
   * The `title` alone was the whole of it, which meant the hour's figures
   * existed for a mouse and for nothing else: a bare `div` has no role to hang a
   * name on, so a screen reader announces nothing, and a touch screen has no
   * hover to give. The pair is deliberate — `title` is what a mouse expects, the
   * role and the label are what everything else reads. Not `tabIndex`: 168 tab
   * stops per chart is a worse page than the one being fixed, and the summary
   * above carries what a keyboard reader needs at a glance.
   */
  // No row for this hour: a gap, deliberately, not a zero-height bar.
  if (column.bucket === undefined) {
    const label = t('admin.chart.noData', { hour });
    return <div className="h-full flex-1" role="img" aria-label={label} title={label} />;
  }

  const { requestCount, count4xx, count5xx, p95LatencyMs } = column.bucket;

  if (series === 'volume') {
    const label = t('admin.chart.volumeTip', {
      hour,
      requests: requestCount,
      ms: p95LatencyMs,
    });

    return (
      <div className="flex h-full flex-1 items-end" role="img" aria-label={label} title={label}>
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
  const label = t('admin.chart.errorsTip', { hour, count4xx, count5xx });

  return (
    <div
      className="flex h-full flex-1 flex-col justify-end"
      role="img"
      aria-label={label}
      title={label}
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
