import { cn } from '@/lib/utils';
import { ChevronRight } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import type {
  BandMap,
  BandOverride,
  ChemistryReport,
  LabEntry,
  LabResult,
  PoolAlert,
  PoolAnalysis,
  PoolClosure,
  PoolMetric,
} from '@/lib/api';
import { POOL_METRICS } from '@/lib/pool-metrics';
import { TrendZoom, type ZoomPoint } from './trend-zoom';
import { TrendsPeriod } from './trends-period';
import { clubDay, inPeriod, periodsOffered, resolvePeriod, summarisePeriod } from '@/lib/water-period';
import { excursions } from '@/lib/water';
import { ExportAnalyses, UnsafeWaterNotice, WaterBackInRangeNote } from './water-actions';
import { WaterImport } from './pools/[poolId]/water-import';
import { WaterDropCatcher } from './pools/[poolId]/water-drop';
import { AnalysisForm, ArchiveAnalysisButton, ArchiveWaterButton, SafeRangesForm } from './analysis-forms';
import { FoldCard } from '@/components/fold-card';
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
  chemistryReports,
  labFailed,
  bandOverrides,
  emailConfigured,
  canManage,
  canRecord,
  section,
  from,
  page,
  year,
  month,
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
  /** Chemistry-only reports filed as readings, listed in Laboratório too — POOLSE-153. */
  chemistryReports: ChemistryReport[];
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
  /** `?year=&month=` for Tendências (`month=all`: the whole year) — Rui, 12-11-2026. */
  year?: string | undefined;
  month?: string | undefined;
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
  /*
   * Tendências shows one period, Ano + Mês, opening on the latest analysis's
   * month (Rui, 12-11-2026). Narrowed here, once; the summary, the charts and
   * each zoom read the same slice, judged by this tank's bands.
   */
  // A month with only a laboratory report is a month too: both kinds of moment offer it.
  const moments = [...analyses, ...(labResults ?? []).map((result) => ({ takenAt: result.sampledAt, values: [] }))];
  const period = resolvePeriod(moments, year, month);
  const periodAnalyses = period === null ? [] : analyses.filter((one) => inPeriod(one.takenAt, period));
  const summary =
    period === null ? null : summarisePeriod(periodAnalyses, bands, period, clubDay(new Date().toISOString()));
  // In the order the page always lists metrics, not the order they were first seen.
  const periodMetrics = POOL_METRICS.flatMap((metric) => summary?.metrics.find((one) => one.metric === metric) ?? []);
  const periodLab = (labResults ?? [])
    .filter((result) => period !== null && inPeriod(result.sampledAt, period))
    .sort((a, b) => a.sampledAt.localeCompare(b.sampledAt));
  const monthNames = Array.from({ length: 12 }, (_, index) =>
    new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, index, 15))),
  );
  const periodLabel =
    period === null
      ? ''
      : period.month === null
        ? String(period.year)
        : t('facilities.trends.periodLabel', { month: monthNames[period.month - 1]!, year: period.year });
  const unsafe = latest === undefined ? [] : excursions(latest.values, bands);
  /*
   * POOLSE-214: the dot follows the problem to its pill. The newest graded lab
   * report failing NP 4542 is what lights the tank (the attention map reads the
   * same latest report), so Laboratório breathes until a newer one passes.
   */
  const newestLab = [...(labResults ?? [])].sort((a, b) => b.sampledAt.localeCompare(a.sampledAt))[0];
  const labFails = newestLab?.grading.grade === 'nao_conforme';
  const offMetrics = new Set(unsafe.map((one) => one.metric));

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
  /*
   * Laboratório lists every imported report (POOLSE-153): the graded lab
   * results and the chemistry-only reports, newest first, paged together.
   */
  const labEntries: LabEntry[] | null =
    labResults === null
      ? null
      : [
          ...labResults.map((result): LabEntry => ({ kind: 'lab', at: result.sampledAt, result })),
          ...chemistryReports.map((report): LabEntry => ({ kind: 'chemistry', at: report.takenAt, report })),
        ].sort((one, other) => other.at.localeCompare(one.at));
  const lab = labEntries === null ? null : windowOf(labEntries);

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
      {/* Only after a reading: no analysis at all is not "back within the limits". */}
      {latest !== undefined && unsafe.length === 0 && closure !== null && (
        <WaterBackInRangeNote
          closure={closure}
          closuresHref={`/dashboard/calendar/closures?poolId=${encodeURIComponent(poolId)}`}
        />
      )}

      {/*
        A report dropped on any other section jumps to Laboratório and is read
        there (Rui, 29-10-2026). Laboratório mounts the importer itself.
      */}
      {canManage && current !== 'lab' && offered.includes('lab') && (
        <WaterDropCatcher poolId={poolId} labHref={sectionHref(basePath, { tab: 'water', from }, 'lab')} />
      )}

      <SectionPills
        label={t('facilities.waterSection.nav')}
        current={current}
        items={offered.map((key) => ({
          key,
          label: t(`facilities.waterSection.${key}`),
          href: sectionHref(`/dashboard/facilities/pools/${poolId}`, { tab: 'water', from }, key),
          attention:
            (key === 'latest' && unsafe.length > 0) || (key === 'lab' && labFails)
              ? t('detailTabs.badge.toResolve')
              : undefined,
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
                  // Out of range: the emphasised card and the dot (POOLSE-214).
                  className={cn(
                    'flex flex-col gap-0.5 rounded border border-border p-3',
                    // Always the subtle highlight, one or several (Rui, 10-11-2026): the red
                    // warning above the pills already says what is wrong.
                    offMetrics.has(value.metric) && 'attention-row',
                  )}
                >
                  <dt className="flex items-center gap-2 text-sm text-foreground-muted">
                    {labelFor(value.metric)}
                    {offMetrics.has(value.metric) && <span aria-hidden className="attention-dot" />}
                  </dt>
                  <dd className="text-lg font-medium">
                    {formatReading(value.value, locale)}{' '}
                    <span className="text-sm font-normal text-foreground-muted">{value.unit}</span>
                  </dd>
                </div>
              ))}
            </dl>

          </>
        ))}

      {current === 'trends' && period !== null && summary !== null && (
        <div className="flex flex-col gap-5">
          <TrendsPeriod
            offered={periodsOffered(moments)}
            year={period.year}
            month={period.month}
            monthNames={monthNames}
          />

          {/* The period in words, folded until asked for (Rui, 12-11-2026); its line says the headline. */}
          <FoldCard
            title={t('facilities.trends.summaryTitle', { period: periodLabel })}
            summary={t('facilities.trends.summaryLine', {
              analyses: summary.analyses,
              days: summary.daysWithReadings,
              of: summary.daysInPeriod,
              outside: summary.outside,
            })}
          >
            <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-0.5">
                <dt className="text-sm text-foreground-muted">{t('facilities.trends.analyses')}</dt>
                <dd className="text-lg font-semibold tabular-nums">{summary.analyses}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-sm text-foreground-muted">{t('facilities.trends.coverage')}</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {t('facilities.trends.daysOf', { days: summary.daysWithReadings, of: summary.daysInPeriod })}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-sm text-foreground-muted">{t('facilities.trends.outsideTotal')}</dt>
                <dd className={cn('text-lg font-semibold tabular-nums', summary.outside > 0 && 'text-danger')}>
                  {summary.outside}
                </dd>
              </div>
            </dl>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t('facilities.trends.metricsCaption', { period: periodLabel })}</caption>
                <thead>
                  <tr className="border-b border-border text-left text-foreground-muted">
                    <th scope="col" className="py-2 pr-3 font-medium">{t('facilities.trends.col.metric')}</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">{t('facilities.trends.stat.records')}</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">{t('facilities.trends.stat.min')}</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">{t('facilities.trends.stat.average')}</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">{t('facilities.trends.stat.max')}</th>
                    <th scope="col" className="py-2 text-right font-medium">{t('facilities.trends.stat.outside')}</th>
                  </tr>
                </thead>
                <tbody>
                  {periodMetrics.map((line) => (
                    <tr key={line.metric} className="border-b border-border last:border-0">
                      <th scope="row" className="py-2 pr-3 text-left font-medium">
                        {labelFor(line.metric)} <span className="font-normal text-foreground-muted">({line.unit})</span>
                      </th>
                      <td className="py-2 pr-3 text-right tabular-nums">{line.count}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatReading(line.min, locale)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatReading(Math.round(line.average * 100) / 100, locale)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatReading(line.max, locale)}</td>
                      <td className={cn('py-2 text-right tabular-nums', line.outside > 0 && 'font-semibold text-danger')}>
                        {line.outside}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-1.5">
              <h3 className="text-sm font-semibold">{t('facilities.trends.labTitle')}</h3>
              {periodLab.length === 0 ? (
                <p className="text-sm text-foreground-muted">{t('facilities.trends.labNone')}</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {periodLab.map((result) => (
                    <li key={result.id} className="flex flex-wrap gap-x-2">
                      <span className="tabular-nums">{formatStamp(new Date(result.sampledAt))}</span>
                      {result.reportReference !== null && (
                        <span className="text-foreground-muted">{result.reportReference}</span>
                      )}
                      <span className={cn('font-medium', result.grading.grade === 'nao_conforme' && 'text-danger')}>
                        {result.grading.grade === null
                          ? t('labResults.grade.none')
                          : t(`labResults.grade.${result.grading.grade}`)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            </div>
          </FoldCard>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {periodMetrics.map((line) => {
              const metric = line.metric;
              const points: ZoomPoint[] = periodAnalyses
                .filter((analysis) => analysis.values.some((value) => value.metric === metric))
                .map((analysis) => {
                  const off = excursions(analysis.values, bands).find((one) => one.metric === metric);
                  return {
                    at: analysis.takenAt,
                    value: analysis.values.find((value) => value.metric === metric)?.value ?? 0,
                    // A reading from a laboratory report is a hollow ring (POOLSE-153).
                    fromLab: analysis.fromLab || analysis.origin === 'report',
                    outside: off === undefined ? null : off.direction,
                    recordedBy: analysis.recordedByName,
                  };
                });

              return (
                <TrendZoom
                  key={metric}
                  locale={locale}
                  points={points}
                  label={labelFor(metric)}
                  unit={line.unit}
                  /*
                    This pool's band, not the published one. A tank judged
                    only from below draws one edge, and a metric switched off
                    draws none — the honest picture either way.
                  */
                  band={bandFor(metric)}
                  legend={{ typed: t('facilities.trendLegend.reading'), lab: t('facilities.trendLegend.lab') }}
                  summary={line}
                  period={periodLabel}
                />
              );
            })}
          </div>
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
              className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded-sm transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary bg-surface shadow-card"
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
            {/* The workbook beside the CSV (Rui, 12-11-2026): a plain link to a route, so it is a file. */}
            <a
              href={`/dashboard/facilities/pools/${poolId}/export`}
              download
              className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded-sm transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary bg-surface shadow-card"
            >
              {t('facilities.waterExport.button')}
            </a>
            {canManage && (
              <span className="ml-auto">
                <ArchiveWaterButton poolId={poolId} poolName={poolName} what="analyses" count={analyses.length} />
              </span>
            )}
          </div>

          {/* The record itself. Newest first here — a list is read from the top. */}
          <ul className="flex flex-col divide-y divide-border rounded border border-border">
            {history.items.map((analysis) => (
              <li key={analysis.id} className="flex flex-col gap-1 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="flex flex-wrap items-baseline gap-x-2 font-medium">
                    {formatStamp(new Date(analysis.takenAt))}
                    {/* Filed from a laboratory report, not typed (29-10-2026). */}
                    {analysis.fromLab && (
                      <span className="rounded border border-border px-1.5 text-sm font-normal text-foreground-muted">
                        {t('facilities.fromLab')}
                      </span>
                    )}
                    {/* Imported, not typed — POOLSE-153. A lab reading says so above. */}
                    {!analysis.fromLab && (analysis.origin === 'log' || analysis.origin === 'report') && (
                      <span className="rounded border border-border px-1.5 text-sm font-normal text-foreground-muted">
                        {t(`facilities.origin.${analysis.origin}`)}
                      </span>
                    )}
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

          {canManage && (
            <div className="flex justify-end">
              <ArchiveWaterButton poolId={poolId} poolName={poolName} what="alerts" count={alerts.length} />
            </div>
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

                <span className="flex items-center gap-2 text-foreground-muted">
                  {alert.deliveredAt === null
                    ? t('facilities.alertNotSent')
                    : t('facilities.alertDelivered', { count: alert.recipients })}
                  {canManage && (
                    <ArchiveWaterButton poolId={poolId} poolName={poolName} what="alert" count={1} alertId={alert.id} />
                  )}
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
          flaggedId={labFails ? newestLab?.id : undefined}
          entries={lab.items}
          total={lab.total}
          canRecord={canRecord || canManage}
          canArchive={canManage}
          emailConfigured={emailConfigured}
          /*
            On top since 29-10-2026 (Rui), as Histórico's buttons are: the way in
            comes before the list it adds to.
          */
          importer={canManage ? <WaterImport poolId={poolId} poolName={poolName} canManage={canManage} /> : null}
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
