import { ChevronRight } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import type {
  BandMap,
  BandOverride,
  LabResult,
  PoolAlert,
  PoolAnalysis,
  PoolClosure,
  PoolMetric,
} from '@/lib/api';
import { POOL_METRICS } from '@/lib/pool-metrics';
import { TrendChart } from '@/components/trend-chart';
import { excursions } from '@/lib/water';
import { ExportAnalyses, UnsafeWaterNotice, WaterBackInRangeNote } from './water-actions';
import { WaterImport } from './pools/[poolId]/water-import';
import { AnalysisForm, ArchiveAnalysisButton, SafeRangesForm } from './analysis-forms';
import { LabResultsSection } from './lab-results';
import { PageError } from '@/components/page-shell';
import { formatStamp } from '@/lib/date-format';
import { formatReading } from '@/lib/pool-metrics';
import { SectionPills, pickSection, sectionHref } from '@/components/section-pills';
import { Pagination } from '@/components/pagination';
import { lastPage, PAGE_SIZE, readPage, type Paginated } from '@/lib/pagination';

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
 *
 * **One section at a time** — 12 October 2026, Rui's standing preference that
 * the reader scrolls as little as possible (`components/section-pills.tsx`).
 * Eight blocks had stacked into a tab where the form somebody came to fill in
 * sat below every chart and every past analysis. Each is now a pill on
 * `?section=`: what the water is now, how it moved, the record, what was sent,
 * adding one, and the bands. A section with nothing in it is not offered —
 * except the two where things are *added*, which are empty until somebody does.
 */

type WaterSection = 'latest' | 'trends' | 'history' | 'alerts' | 'lab' | 'record' | 'ranges';

export async function ReadingsBlock({
  organizationId,
  poolId,
  poolName,
  analyses,
  alerts,
  bands,
  reference,
  labResults,
  labFailed,
  bandOverrides,
  emailConfigured,
  canManage,
  canRecord,
  section,
  from,
  page,
  closure,
}: {
  organizationId: string;
  poolId: string;
  poolName: string;
  /** Oldest first, as the API sends them. */
  analyses: PoolAnalysis[];
  /** Newest first, as the API sends them — slice 4.2. */
  alerts: PoolAlert[];
  /**
   * The band each metric is judged by *on this pool*, resolved by the API.
   *
   * Not `HEALTHY`, which this file used to read: a club may override a band,
   * drop one bound or switch a metric off, and the published constant knows
   * none of that. The merge happens once, on the server, so the chart, the
   * warning and the alert email cannot disagree.
   */
  bands: BandMap;
  /** The national band per metric for this tank, before overrides — POOLSE-72. */
  reference: BandMap;
  /**
   * Laboratory reports, newest first, graded by the API — POOLSE-72. Null when
   * they could not be read for this person, and the section is then not offered.
   */
  labResults: LabResult[] | null;
  /** They were refused by nobody and still did not load: offered, with an error. */
  labFailed: boolean;
  /** The raw overrides, for the editor's three-state selects. */
  bandOverrides: BandOverride[];
  /** Whether an alert would actually be sent from this environment. */
  emailConfigured: boolean;
  canManage: boolean;
  /** The record-one-analysis form: owner, admin and maintenance. */
  canRecord: boolean;
  /** The `?section=` the page was asked for; resolved against what is offered. */
  section?: string | string[] | undefined;
  /** The page's own `?from=`, kept on every pill so "Voltar" still knows the way. */
  from?: string | undefined;
  /** `?page=` for Histórico and Laboratório, ten a page like every list (POOLSE-29). */
  page?: string | undefined;
  /** What shuts the tank now, so the warning and its aftermath can say so. */
  closure: PoolClosure | null;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();

  const labelFor = (metric: PoolMetric): string => t(`facilities.metric.${metric}`);

  // Only the metrics this pool actually has readings for. A club that tests pH
  // and chlorine should see two charts, not nine, seven of which are empty.
  const measured = POOL_METRICS.filter((metric) =>
    analyses.some((analysis) => analysis.values.some((value) => value.metric === metric)),
  );

  const latest = analyses[analyses.length - 1];

  /*
   * The chart shades a region, so it needs both edges.
   *
   * A one-sided band is real — an outdoor tank with a floor and no ceiling — and
   * a shaded area with one edge missing would have to invent the other one. So
   * the band is drawn only where both ends are judged; the numbers are always in
   * the list below, and the warning still names the bound that was crossed.
   */
  const bandFor = (metric: PoolMetric): { from: number; to: number } | undefined => {
    const band = bands[metric];
    if (band === undefined || band.from === null || band.to === null) return undefined;
    return { from: band.from, to: band.to };
  };

  /*
   * What is offered. Última análise always is — with no analysis it is the empty
   * state naming what the first one unlocks, and a tab must never be a row of
   * zero pills. Registar and Limites follow the roles that may write them, not
   * whether anything is there yet, because they are where it gets there.
   */
  const offered = (
    [
      ['latest', true],
      ['trends', measured.length > 0],
      ['history', analyses.length > 0],
      ['alerts', alerts.length > 0],
      // Where reports are added as well as read, so offered empty — like Registar.
      ['lab', labResults !== null || labFailed],
      // The club's own readings only, since POOLSE-101 — so the roles that may type one.
      ['record', canRecord],
      ['ranges', canManage],
    ] as const
  )
    .filter(([, on]) => on)
    .map(([key]): WaterSection => key);
  const current = pickSection(offered, section, 'latest');
  const unsafe = latest === undefined ? [] : excursions(latest.values, bands);

  /*
   * Ten a page, like every list that grows (POOLSE-29; Rui, 29-10-2026). Both
   * lists arrive whole — the charts need every analysis — so the page is a slice,
   * and a page past the end shows the last one rather than an empty list.
   */
  const windowOf = <T,>(items: T[]): Paginated<T> => {
    const at = Math.min(readPage(page), lastPage(items.length, PAGE_SIZE));
    return {
      items: items.slice((at - 1) * PAGE_SIZE, at * PAGE_SIZE),
      total: items.length,
      page: at,
      limit: PAGE_SIZE,
    };
  };
  const basePath = `/dashboard/facilities/pools/${poolId}`;
  const pageQuery = (key: WaterSection): Record<string, string | undefined> => ({
    tab: 'water',
    section: key,
    from,
  });
  const history = windowOf([...analyses].reverse());
  const lab = labResults === null ? null : windowOf(labResults);
  const counts: Partial<Record<WaterSection, number>> = {
    history: analyses.length,
    alerts: alerts.length,
    ...(labResults !== null && labResults.length > 0 ? { lab: labResults.length } : {}),
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-foreground-muted">{t('facilities.readingsHint')}</p>

      {/*
        Above the pills, in every section: water out of range is a safety
        warning, and a warning that disappears when somebody opens Histórico or
        Registar is one they can miss on the day it matters.
      */}
      <UnsafeWaterNotice
        poolId={poolId}
        excursions={unsafe}
        closure={closure}
        recordHref={
          canRecord ? sectionHref(`/dashboard/facilities/pools/${poolId}`, { tab: 'water', from }, 'record') : null
        }
      />
      {unsafe.length === 0 && closure !== null && (
        <WaterBackInRangeNote
          closure={closure}
          closuresHref={`/dashboard/calendar/closures?poolId=${encodeURIComponent(poolId)}`}
        />
      )}

      <SectionPills
        label={t('facilities.waterSection.nav')}
        current={current}
        items={offered.map((key) => ({
          key,
          label: t(`facilities.waterSection.${key}`),
          href: sectionHref(`/dashboard/facilities/pools/${poolId}`, { tab: 'water', from }, key),
          count: counts[key],
        }))}
      />

      {current === 'latest' &&
        (analyses.length === 0 ? (
          /*
            An empty state that says what will be here — round 4 follow-up.
            "None recorded" alone reads as a dead panel; naming the three things
            the first analysis unlocks tells an operator Registar is worth
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
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {latest?.values.map((value) => (
                <div
                  key={value.metric}
                  className="flex flex-col gap-0.5 rounded border border-border p-3"
                >
                  <dt className="text-sm text-foreground-muted">{labelFor(value.metric)}</dt>
                  <dd className="text-lg font-medium">
                    {formatReading(value.value, locale)}{' '}
                    <span className="text-sm font-normal text-foreground-muted">{value.unit}</span>
                  </dd>
                </div>
              ))}
            </dl>

          </>
        ))}

      {current === 'trends' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
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
                locale={locale}
                points={points}
                label={labelFor(metric)}
                unit={
                  latest?.values.find((value) => value.metric === metric)?.unit ??
                  analyses
                    .flatMap((analysis) => analysis.values)
                    .find((value) => value.metric === metric)?.unit ??
                  ''
                }
                /*
                  This pool's band, not the published one. A tank judged
                  only from below draws one edge, and a metric switched off
                  draws none — the honest picture either way.
                */
                band={bandFor(metric)}
              />
            );
          })}
        </div>
      )}

      {current === 'history' && (
        <>
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
              className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-border transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
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

          {/* The record itself. Newest first here — a list is read from the top. */}
          <ul className="flex flex-col divide-y divide-border rounded border border-border">
            {history.items.map((analysis) => (
              <li key={analysis.id} className="flex flex-col gap-1 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="font-medium">
                    {formatStamp(new Date(analysis.takenAt))}
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
                      {formatReading(value.value, locale)} {value.unit}
                    </span>
                  ))}
                </span>

                {analysis.notes !== null && analysis.notes !== '' && (
                  <span className="text-sm text-foreground-muted">{analysis.notes}</span>
                )}
              </li>
            ))}
          </ul>

          <Pagination page={history} basePath={basePath} query={pageQuery('history')} />
        </>
      )}

      {/*
        What was actually sent, and to how many people — slice 4.2.

        Beside the record because it answers the next question an operator has:
        the band is crossed, and did anybody hear about it. Its pill is offered
        only when there is a history, so a tank that has never had a bad reading
        carries no empty section — and it is decided by the alerts alone, never
        by whether analyses remain, because archiving a mistyped reading does not
        unsend the email it caused.

        **A count, not the addresses.** This panel is readable by any member and
        the club's staff addresses are not what it is for.

        **"Registado, sem envio" is said in words.** An alert with no delivery is
        the ordinary state on a laptop and a real state in production — a club
        whose staff have no email addresses on file — and a row that looked
        identical either way would let somebody believe a message went out. Same
        reasoning as the chase list in 2.3.
      */}
      {current === 'alerts' && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t('facilities.alertHistory')}</h3>
          <p className="text-sm text-foreground-muted">{t('facilities.alertHint')}</p>

          {!emailConfigured && (
            <p className="text-sm text-foreground-muted">{t('facilities.alertNoEmail')}</p>
          )}

          <ul className="flex flex-col divide-y divide-border rounded border border-border">
            {alerts.map((alert) => (
              <li
                key={alert.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-3 text-sm"
              >
                <span className="flex flex-wrap items-baseline gap-x-2">
                  {/* A named format, never an options object — see i18n.ts. */}
                  <span className="font-medium">
                    {formatStamp(new Date(alert.raisedAt))}
                  </span>
                  <span className="text-foreground-muted">
                    {alert.metrics.map((metric) => labelFor(metric)).join(', ')}
                  </span>
                </span>

                <span className="text-foreground-muted">
                  {alert.deliveredAt === null
                    ? t('facilities.alertNotSent')
                    : t('facilities.alertDelivered', { count: alert.recipients })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/*
        Registar — the club's own reading, typed. Only the form since POOLSE-101:
        the report import beneath it read as a second way to enter a laboratory's
        analysis, so it moved to Laboratório.

        The form still folds (round 5), but it opens already unfolded: choosing
        this pill *is* the click that used to open it, and a second one would be
        ceremony. `<details>` rather than a state hook because the browser's own
        disclosure is keyboard-operable, announced as one, and works before any
        JavaScript arrives.
      */}
      {current === 'record' && canRecord && (
        <details open className="group rounded border border-border">
          <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            <ChevronRight
              aria-hidden
              className="size-4 transition-transform group-open:rotate-90"
            />
            {t('facilities.recordOwnTitle')}
          </summary>
          <div className="flex flex-col gap-4 border-t border-border p-4">
            <p className="text-sm text-foreground-muted">{t('facilities.recordOwnHint')}</p>
            <AnalysisForm organizationId={organizationId} poolId={poolId} poolName={poolName} />
          </div>
        </details>
      )}

      {current === 'lab' && labFailed && <PageError message={t('detailTabs.loadFailed')} />}

      {current === 'lab' && lab !== null && (
        <LabResultsSection
          poolId={poolId}
          results={lab.items}
          total={lab.total}
          canRecord={canRecord || canManage}
          canArchive={canManage}
          emailConfigured={emailConfigured}
          /*
            On top since 29-10-2026 (Rui), as Histórico's buttons are: the way in
            comes before the list it adds to.
          */
          importer={canManage ? <WaterImport poolId={poolId} canManage={canManage} /> : null}
          pagination={<Pagination page={lab} basePath={basePath} query={pageQuery('lab')} />}
        />
      )}

      {/*
        Importing a laboratory's report — round 6, ticket 1; under Laboratório
        since POOLSE-101, beside *Registar um resultado*. Its rows are filed by
        what they hold: an organism count makes a row the laboratory's, graded
        here, and chemistry alone goes to the readings — the preview says which,
        row by row, before anything is written.

        The wizard renders nothing for somebody who may not write, so a
        read-only visitor sees the results and no control the API would refuse.
      */}

      {/*
        What this tank's water is supposed to look like — slice 4.2, second half.

        The last pill, because it is a setting rather than a job: a club sets it
        once when a tank is not a municipal pool, and never looks at it again.
        Still a `<details>`, opened when its pill is chosen, for the reason the
        analysis form keeps one.
      */}
      {current === 'ranges' && canManage && (
        <details open className="group rounded border border-border">
          <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            <ChevronRight
              aria-hidden
              className="size-4 transition-transform group-open:rotate-90"
            />
            {t('facilities.rangesTitle')}
          </summary>
          <div className="flex flex-col gap-4 border-t border-border p-4">
            <SafeRangesForm
              organizationId={organizationId}
              poolId={poolId}
              overrides={bandOverrides}
              reference={reference}
            />
          </div>
        </details>
      )}
    </div>
  );
}
