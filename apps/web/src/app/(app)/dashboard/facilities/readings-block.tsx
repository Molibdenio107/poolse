import { ChevronRight } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { PoolAnalysis, PoolMetric } from '@/lib/api';
import { POOL_METRICS } from '@/lib/pool-metrics';
import { TrendChart } from '@/components/trend-chart';
import { excursions, HEALTHY } from '@/lib/water';
import { ExportAnalyses, ImportAnalysis, UnsafeWaterNotice } from './water-actions';
import { AnalysisForm, ArchiveAnalysisButton } from './analysis-forms';

/**
 * Water quality — round 4, built.
 *
 * This was a styled placeholder for two phases, on the honest grounds that
 * readings are time-series with per-metric units and building the table early
 * would be guessing. The decisions it was waiting on have now been taken: an
 * analysis is a visit rather than a row per number, each value carries its own
 * unit, and the store is an ordinary tenant table rather than a hypertable
 * because a club records a handful of these a month and edits them like any
 * other record.
 *
 * **The trend is between analyses, not over time.** Points are evenly spaced by
 * sequence rather than by date. That is deliberate: a club tests weekly in
 * summer and monthly in winter, and a time axis would compress the whole
 * swimming season into the left-hand third of the chart and give six months of
 * empty grid to the part where nothing happens. What an operator asks of this
 * panel is "is the pH drifting", and consecutive analyses answer it.
 *
 * **The numbers are always listed under the charts.** A chart summarises; the
 * table is the record. Nothing here exists only as a line.
 *
 * A server component: the charts are SVG with no interaction, and only the entry
 * form and the archive control are client code.
 */

export async function ReadingsBlock({
  organizationId,
  poolId,
  poolName,
  analyses,
  canManage,
}: {
  organizationId: string;
  poolId: string;
  poolName: string;
  /** Oldest first, as the API sends them. */
  analyses: PoolAnalysis[];
  canManage: boolean;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const format = await getFormatter();

  const labelFor = (metric: PoolMetric): string => t(`facilities.metric.${metric}`);

  // Only the metrics this pool actually has readings for. A club that tests pH
  // and chlorine should see two charts, not nine, seven of which are empty.
  const measured = POOL_METRICS.filter((metric) =>
    analyses.some((analysis) => analysis.values.some((value) => value.metric === metric)),
  );

  const latest = analyses[analyses.length - 1];

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-foreground-muted">{t('facilities.readingsHint')}</p>

      {analyses.length === 0 ? (
        /*
          An empty state that says what will be here — round 4 follow-up.
          "None recorded" alone reads as a dead panel; naming the three things
          the first analysis unlocks tells an operator the form below is worth
          filling in.
        */
        <div className="flex flex-col gap-2 rounded border border-dashed border-border p-4">
          <p className="text-sm font-medium">{t('facilities.noAnalyses')}</p>
          <ul className="list-inside list-disc text-sm text-foreground-muted">
            <li>{t('facilities.emptyLatest')}</li>
            <li>{t('facilities.emptyTrend')}</li>
            <li>{t('facilities.emptyReport')}</li>
          </ul>
        </div>
      ) : (
        <>
          {/*
            The most recent reading, as tiles. This is the question the panel is
            opened for nine times out of ten — "what is it right now" — and it
            should not require reading a chart.
          */}
          <dl className="grid gap-3 sm:grid-cols-3">
            {latest?.values.map((value) => (
              <div
                key={value.metric}
                className="flex flex-col gap-0.5 rounded border border-border p-3"
              >
                <dt className="text-sm text-foreground-muted">{labelFor(value.metric)}</dt>
                <dd className="text-lg font-medium">
                  {value.value}{' '}
                  <span className="text-sm font-normal text-foreground-muted">{value.unit}</span>
                </dd>
              </div>
            ))}
          </dl>

          {/*
            Between the readings and the charts on purpose: it is a consequence
            of the numbers just above it, and putting it under the trend would
            mean scrolling past the thing it is warning about.
          */}
          <UnsafeWaterNotice
            poolId={poolId}
            excursions={latest === undefined ? [] : excursions(latest.values)}
          />

          {measured.length > 0 && (
            <div className="grid gap-5 lg:grid-cols-2">
              {measured.map((metric) => {
                const points = analyses
                  .filter((analysis) =>
                    analysis.values.some((value) => value.metric === metric),
                  )
                  .map((analysis) => ({
                    at: analysis.takenAt,
                    value:
                      analysis.values.find((value) => value.metric === metric)?.value ?? 0,
                  }));

                return (
                  <TrendChart
                    key={metric}
                    points={points}
                    label={labelFor(metric)}
                    unit={
                      latest?.values.find((value) => value.metric === metric)?.unit ??
                      analyses
                        .flatMap((analysis) => analysis.values)
                        .find((value) => value.metric === metric)?.unit ??
                      ''
                    }
                    band={HEALTHY[metric]}
                  />
                );
              })}
            </div>
          )}

          {/* The record itself. Newest first here — a list is read from the top. */}
          <ul className="flex flex-col divide-y divide-border rounded border border-border">
            {[...analyses].reverse().map((analysis) => (
              <li key={analysis.id} className="flex flex-col gap-1 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="font-medium">
                    {format.dateTime(new Date(analysis.takenAt), {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </span>
                  <span className="flex items-center gap-3 text-sm text-foreground-muted">
                    {analysis.recordedByName}
                    {canManage && (
                      <ArchiveAnalysisButton
                        organizationId={organizationId}
                        poolId={poolId}
                        analysisId={analysis.id}
                      />
                    )}
                  </span>
                </div>

                <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {analysis.values.map((value) => (
                    <span key={value.metric}>
                      <span className="text-foreground-muted">{labelFor(value.metric)}: </span>
                      {value.value} {value.unit}
                    </span>
                  ))}
                </span>

                {analysis.notes !== null && analysis.notes !== '' && (
                  <span className="text-sm text-foreground-muted">{analysis.notes}</span>
                )}
              </li>
            ))}
          </ul>

          {/*
            The report opens in its own tab and prints. Not a link styled as a
            button on the page it reports on — an operator sending a lab report
            to the câmara wants a page with the club, the pool and the dates on
            it, and nothing else.
          */}
          <div className="flex flex-wrap gap-2">
            <a
              href={`/dashboard/facilities/pools/${poolId}/report`}
              target="_blank"
              rel="noreferrer"
              className="rounded border border-border px-3 py-1.5 text-sm transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {t('facilities.analysisReport')}
            </a>

            {/*
              Two exports, two audiences: the PDF goes to the camara, the CSV
              goes into somebody's spreadsheet. Neither substitutes for the other.
            */}
            <ExportAnalyses
              analyses={analyses}
              poolName={poolName}
              metrics={measured.map((metric) => ({
                key: metric,
                label: labelFor(metric),
                unit: t(`facilities.unit.${metric}`),
              }))}
              headers={{
                takenAt: t('facilities.analysisTakenAt'),
                notes: t('facilities.analysisNotes'),
                export: t('facilities.exportAnalyses'),
              }}
            />
          </div>
        </>
      )}

      {/*
        The form folds; the readings and the trends do not — round 5.

        Recording an analysis is a weekly job that takes thirty seconds; reading
        the last one is what this panel is opened for every other time. So the
        nine inputs sit behind a disclosure and the tiles, the charts and the
        record stay where they are. `<details>` rather than a state hook: the
        browser's own disclosure is keyboard-operable, announced as one, and
        works before any JavaScript arrives.
      */}
      {canManage && (
        <details className="group rounded border border-border">
          <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            <ChevronRight
              aria-hidden
              className="size-4 transition-transform group-open:rotate-90"
            />
            {t('facilities.recordAnalysisTitle')}
          </summary>
          <div className="flex flex-col gap-4 border-t border-border p-4">
            <AnalysisForm organizationId={organizationId} poolId={poolId} poolName={poolName} />
            <ImportAnalysis />
          </div>
        </details>
      )}
    </div>
  );
}
