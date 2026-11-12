import { formatDate, formatStamp } from '@/lib/date-format';
import { notFound } from 'next/navigation';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { PageError, PageShell } from '@/components/page-shell';
import { DetailPage } from '@/components/detail-page';
import { ConsumptionBars } from '@/components/consumption-bars';
import { FromLink } from '@/components/from-link';
import { Plus } from 'lucide-react';
import { backTarget } from '@/lib/back';
import { centsToText } from '@/lib/energy-invoice';
import { getMeter } from '../../energy.actions';
import { listInvoices } from '../invoice.actions';
import { MeterAdmin, ReadingForm, RemoveReading } from './meter-forms';
import { TariffPanel } from './tariff-panel';
import { EnergyArchiveButton } from '../../../energy/energy-archive-button';
import { DIALS_OF, UNUSUAL_SHARE, BASELINE_INTERVALS, needsGasFactor } from '@poolse/rules';
import { GasFactorPanel } from './gas-factor-panel';
import { FoldCard } from '@/components/fold-card';
import { YearOnYearPanel, hasYearOnYear } from './year-on-year';
import { SectionPills, pickSection, sectionHref } from '@/components/section-pills';

/**
 * One meter: its consumption by month, the form for the next reading, and the
 * record of every reading — slice 5.2, "a month of data is visible".
 *
 * The chart comes first because it is what the page is opened for; the form
 * next because it is what the page is opened *to do*; the record last because
 * it is the thing the other two are made from. Every figure on this page was
 * derived by the API from the meter's `reads` flag — nothing here subtracts.
 *
 * **Tabs since the detail-tabs change**: General (consumption, year on year and
 * the estimated cost, one at a time by `?section=`), Leituras (the form and the record), Faturas — fetched
 * when it opens — Tarifário, and Detalhes (owner and admin).
 */
export default async function MeterPage({
  params,
  searchParams,
}: {
  params: Promise<{ meterId: string }>;
  searchParams: Promise<{ from?: string; tab?: string | string[]; section?: string | string[] }>;
}): Promise<React.ReactElement> {
  const { meterId } = await params;
  const { from, tab, section } = await searchParams;
  const t = await getTranslations();
  const locale = await getLocale();
  const format = await getFormatter();

  const loaded = await getMeter(meterId);
  /*
   * A refusal or a true 404 is "no such record", as before — another club's
   * is indistinguishable from none. Anything else is said: a timeout used to
   * read as a deleted record (October 2026).
   */
  if (loaded.state === 'failed' && loaded.status !== 404) {
    return (
      <PageShell title={t('energy.title')}>
        <PageError message={t(loaded.failure.key)} />
      </PageShell>
    );
  }
  if (loaded.state !== 'ok') notFound();
  const { meter, readings, usage, gasFactors, monthly, pools, tariffs, canPlan, canRecord, canPrice } = loaded.data;
  const gasInM3 = needsGasFactor(meter.carrier, meter.unit);
  // A water bill is read in m³ and priced per m³; electricity and gas bills in kWh (12-11-2026).
  const billUnit = meter.carrier === 'water' ? 'm³' : 'kWh';
  const billQuantity = (bill: { kwh: number; volumeM3: number | null }): number =>
    meter.carrier === 'water' ? (bill.volumeM3 ?? 0) : bill.kwh;
  const perDay = (value: number): string => format.number(value, { maximumFractionDigits: value < 10 ? 2 : 0 });

  const back = backTarget(from, '/dashboard/energy');

  const subtitle = [
    t(`energy.kind.${meter.kind}`),
    meter.poolName ?? meter.facilityName,
    t(`energy.reads.${meter.reads}`),
  ].join(' · ');

  /*
   * General shows one section at a time — 12 October 2026, Rui's standing
   * preference that the reader scrolls as little as possible; the pill row is
   * `components/section-pills.tsx`. Three charts had stacked into a page whose
   * cost estimate sat two screens below the fold.
   *
   * A section is offered only where it would draw something. Year on year asks
   * `hasYearOnYear`, the panel's own guard — a pill leading to a blank page reads
   * as a broken one.
   * Consumption is always offered: its empty state is the hint that says how to
   * get a chart.
   */
  const generalSections = (
    [
      ['consumption', true],
      ['yearOnYear', hasYearOnYear(monthly.yearOnYear)],
      ['cost', monthly.monthsPriced > 0],
    ] as const
  )
    .filter(([, offered]) => offered)
    .map(([key]) => key);
  const generalSection = pickSection(generalSections, section, 'consumption');
  const meterPath =`/dashboard/facilities/energy/${meter.id}`;

  return (
    <DetailPage
      title={meter.name}
      subtitle={subtitle}
      back={{ href: back.href, label: t(back.labelKey) }}
      requested={tab}
      tabs={[
        {
          slug: 'general',
          labelKey: 'detailTabs.general',
          content: () => (
            <>
              {meter.archived && (
                <section className="rounded border border-border bg-surface-muted p-4 text-sm text-foreground-muted">
                  {t('energy.retired')}
                </section>
              )}

              {meter.replacedMeterName !== null && (
                <p className="text-sm text-foreground-muted">
                  {t('energy.replaced', { name: meter.replacedMeterName })}
                </p>
              )}

              <SectionPills
                label={t('energy.meterSection.nav')}
                current={generalSection}
                items={generalSections.map((key) => ({
                  key,
                  label: t(`energy.meterSection.${key}`),
                  href: sectionHref(meterPath, { tab: 'general', from }, key),
                }))}
              />

              {generalSection === 'consumption' && (
                <section className="rounded bg-surface p-5 shadow-card">
                  <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                    {t('energy.consumption')}
                  </h2>
                  {readings.length === 0 ? (
                    <p className="text-sm text-foreground-muted">{t('energy.noReadingsHint')}</p>
                  ) : (
                    <ConsumptionBars
                      monthly={monthly.months.map((m) => ({
                        month: m.month,
                        consumed: m.consumed,
                        previous: m.previousConsumed,
                        // Context in the record, not a second axis — slice 5.4b.
                        temperatureC: m.meanTempC,
                      }))}
                      unit={meter.unit}
                      locale={locale}
                    />
                  )}
                </section>
              )}

              {/*
                This year against last — slice 5.4a. Its own pill, offered only
                for a club with counterpart months; the chart's outlined bars
                still carry last year on Consumo.
              */}
              {generalSection === 'yearOnYear' && (
                <YearOnYearPanel yearOnYear={monthly.yearOnYear} unit={meter.unit} />
              )}

              {/*
                What that consumption cost, at the rates the club typed — slice
                5.3. Absent until something is actually priced.

                **Its own section, never merged with the bills.** A billed euro
                is `actual` and this one is `estimated`, and docs/financials.md
                §2 forbids summing across provenances into one unlabelled figure
                — so the heading says estimate, the coverage says how much of
                the year it reached, and the two totals never meet.
              */}
              {generalSection === 'cost' && (
                <section className="flex flex-col gap-3 rounded bg-surface p-5 shadow-card">
                  <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                    {t('energy.tariff.costSection')}
                  </h2>

                  <p className="text-sm">
                    <span className="text-lg font-medium tabular-nums">
                      {monthly.costCents === null ? '—' : `${centsToText(monthly.costCents)} €`}
                    </span>{' '}
                    <span className="text-foreground-muted">
                      {t('energy.tariff.costTotal')}
                      {' · '}
                      {/*
                        Coverage, in visible text and never only as a caveat
                        elsewhere — docs/financials.md §6.
                      */}
                      {t('energy.tariff.coverage', {
                        priced: monthly.monthsPriced,
                        total: monthly.monthsWithConsumption,
                      })}
                      {monthly.costProvenance !== null &&
                        ` · ${t(`energy.tariff.costProvenance.${monthly.costProvenance}`)}`}
                    </span>
                  </p>

                  <ConsumptionBars
                    monthly={monthly.months.map((m) => ({
                      month: m.month,
                      // The bars take euros, not cents — one scale, no second axis.
                      consumed: m.costCents === null ? null : m.costCents / 100,
                      previous: m.previousCostCents === null ? null : m.previousCostCents / 100,
                    }))}
                    unit="€"
                    locale={locale}
                    money
                    labelKey="energy.tariff.costChartLabel"
                    captionKey="energy.tariff.costChartCaption"
                  />
                </section>
              )}
            </>
          ),
        },
        {
          slug: 'readings',
          labelKey: 'energy.history',
          content: () => (
            <>
              {canRecord && (
                <section className="rounded bg-surface p-5 shadow-card">
                  <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                    {t('energy.recordTitle')}
                  </h2>
                  <ReadingForm meter={meter} />
                </section>
              )}

              {/*
                Altos e baixos (Rui, 12-11-2026): the last twelve months per day,
                folded, its line saying the headline. The rule is said in words.
              */}
              {usage.intervals > 0 && (
                <FoldCard
                  title={t('energy.usage.title')}
                  summary={t('energy.usage.line', {
                    average: usage.averagePerDay === null ? '—' : perDay(usage.averagePerDay),
                    unit: meter.unit,
                    unusual: usage.unusual,
                  })}
                >
                  <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    {(
                      [
                        ['highest', usage.highest],
                        ['lowest', usage.lowest],
                      ] as const
                    ).map(([key, point]) => (
                      <div key={key} className="flex flex-col gap-0.5">
                        <dt className="text-sm text-foreground-muted">{t(`energy.usage.${key}`)}</dt>
                        <dd className="text-lg font-semibold tabular-nums">
                          {point === null ? '—' : t('energy.usage.perDay', { value: perDay(point.perDay), unit: meter.unit })}
                        </dd>
                        {point !== null && (
                          <dd className="text-xs text-foreground-muted tabular-nums">
                            {formatDate(point.previousAt)} – {formatDate(point.takenAt)}
                          </dd>
                        )}
                      </div>
                    ))}
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-sm text-foreground-muted">{t('energy.usage.unusualLabel')}</dt>
                      <dd className="text-lg font-semibold tabular-nums">{usage.unusual}</dd>
                      <dd className="text-xs text-foreground-muted">
                        {t('energy.usage.intervals', { count: usage.intervals })}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-sm text-foreground-muted">
                    {t('energy.usage.rule', { share: Math.round(UNUSUAL_SHARE * 100), intervals: BASELINE_INTERVALS })}
                  </p>
                </FoldCard>
              )}

              <section className="rounded bg-surface p-5 shadow-card">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                    {t('energy.history')}
                  </h2>
                  {/* Rui, 12-11-2026: the whole list to Arquivados, restorable. Owner and Admin. */}
                  {canPlan && readings.length > 0 && (
                    <EnergyArchiveButton
                      what="batch"
                      kind="readings"
                      meterId={meter.id}
                      month={null}
                      count={readings.length}
                      scope={`${t('energy.historyList.scopeMeter', { name: meter.name })} ${t('energy.historyList.scopeAllMonths')}`}
                    />
                  )}
                </div>

                {readings.length === 0 ? (
                  <p className="text-sm text-foreground-muted">{t('energy.noReadings')}</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border rounded border border-border">
                    {readings.map((reading) => (
                      <li
                        key={reading.takenAt}
                        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-3 text-sm"
                      >
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span>
                            <span className="font-medium tabular-nums">
                              {format.number(reading.value, { maximumFractionDigits: 3 })}
                            </span>{' '}
                            <span className="text-foreground-muted">{meter.unit}</span>
                            {/*
                              What this reading says was used since the one
                              before it, beside the figure — a dial reading means
                              nothing on its own.
                            */}
                            {meter.reads === 'cumulative_index' && (
                              <span className="ml-2 text-foreground-muted">
                                {reading.consumed === null
                                  ? t('energy.firstReading')
                                  : t('energy.sinceLast', {
                                      value: format.number(reading.consumed, {
                                        maximumFractionDigits: 1,
                                      }),
                                      unit: meter.unit,
                                    })}
                              </span>
                            )}
                            {/*
                              What it cost, at the rate live that day — slice
                              5.3. A meter with no rate shows nothing here rather
                              than a zero, and the estimate is marked as one.
                            */}
                            {reading.costCents !== null && (
                              <span className="ml-2 text-foreground-muted">
                                ·{' '}
                                <span className="tabular-nums">
                                  {centsToText(reading.costCents)} €
                                </span>{' '}
                                <span className="text-xs">
                                  {t(
                                    `energy.tariff.costProvenance.${reading.costProvenance ?? 'estimated'}`,
                                  )}
                                </span>
                              </span>
                            )}
                          </span>
                          {/* Gas m³ in kWh at the day's factor, and a water interval's backwashes (12-11-2026). */}
                          {(reading.consumedKwh !== null || reading.backwashes !== null || (gasInM3 && reading.consumed !== null)) && (
                            <span className="text-xs tabular-nums text-foreground-muted">
                              {reading.consumedKwh !== null
                                ? t('energy.gas.inKwh', { value: format.number(reading.consumedKwh, { maximumFractionDigits: 0 }) })
                                : gasInM3 && reading.consumed !== null
                                  ? t('energy.gas.noFactor')
                                  : null}
                              {reading.backwashes !== null && t('energy.water.backwashCount', { count: reading.backwashes })}
                            </span>
                          )}
                          {/* Use per day, and the word when it is unusual — words, never colour alone. */}
                          {reading.perDay !== null && (
                            <span className="text-xs tabular-nums text-foreground-muted">
                              {t('energy.usage.perDay', { value: perDay(reading.perDay), unit: meter.unit })}
                              {reading.flag !== null && reading.deviation !== null && (
                                <span
                                  className={
                                    reading.flag === 'high' ? 'ml-2 font-medium text-danger' : 'ml-2 font-medium text-warning'
                                  }
                                >
                                  {t(`energy.usage.flag.${reading.flag}`, {
                                    share: Math.round(Math.abs(reading.deviation) * 100),
                                  })}
                                </span>
                              )}
                            </span>
                          )}
                          {/* What each dial used, in the meter's own order (12-11-2026). */}
                          {(reading.dialsConsumed ?? reading.dials) !== null && (
                            <span className="text-xs tabular-nums text-foreground-muted">
                              {t(reading.dialsConsumed === null ? 'energy.dials.readAs' : 'energy.dials.usedAs', {
                                list: DIALS_OF[meter.dialSet]
                                  .filter((dial) => (reading.dialsConsumed ?? reading.dials)?.[dial] !== undefined)
                                  .map(
                                    (dial) =>
                                      `${t(`energy.dials.name.${dial}`)} ${format.number((reading.dialsConsumed ?? reading.dials)?.[dial] ?? 0, { maximumFractionDigits: 1 })}`,
                                  )
                                  .join(' · '),
                                unit: meter.unit,
                              })}
                            </span>
                          )}
                          <span className="text-xs text-foreground-muted">
                            {formatStamp(new Date(reading.takenAt))}
                            {reading.recordedByName !== null && ` · ${reading.recordedByName}`}
                            {reading.note !== null && ` · ${reading.note}`}
                          </span>
                        </span>

                        {/* Archiving is the office's (POOLSE-03), never maintenance's. */}
                        {canRecord && canPlan && <RemoveReading meter={meter} takenAt={reading.takenAt} />}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          ),
        },
        {
          /*
            The bills on this meter — slice 5.3. Their own tab, never merged with
            the readings: billing periods are not reading dates and bills carry
            estimates. The list answers to the same roles as this page, so the
            tab is always there and the list is fetched when it opens.
          */
          slug: 'invoices',
          labelKey: 'energy.invoice.section',
          content: async () => {
            const bills = await listInvoices(meterId);
            if (bills === null) return <PageError message={t('detailTabs.loadFailed')} />;

            const here = `/dashboard/facilities/energy/${meter.id}`;
            return (
              <section className="flex flex-col gap-4 rounded bg-surface p-5 shadow-card">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                    {t('energy.invoice.section')}
                  </h2>
                  <div className="flex flex-wrap items-center gap-2">
                  {bills.canRecord && !meter.archived && (
                    <FromLink
                      href={`${here}/invoices/new`}
                      className="inline-flex h-control items-center justify-center px-4 text-control gap-1.5 rounded-sm transition-colors hover:border-primary/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary bg-surface shadow-card"
                    >
                      <Plus className="size-4" aria-hidden="true" />
                      {t('energy.invoice.add')}
                    </FromLink>
                  )}
                  {canPlan && bills.invoices.length > 0 && (
                    <EnergyArchiveButton
                      what="batch"
                      kind="invoices"
                      meterId={meter.id}
                      month={null}
                      count={bills.invoices.length}
                      scope={`${t('energy.historyList.scopeMeter', { name: meter.name })} ${t('energy.historyList.scopeAllMonths')}`}
                    />
                  )}
                  </div>
                </div>

                {bills.invoices.length === 0 ? (
                  <p className="text-sm text-foreground-muted">{t('energy.invoice.none')}</p>
                ) : (
                  <div className="relative overflow-x-auto">
                    <table className="w-full min-w-[40rem] text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wider text-foreground-muted">
                          <th className="py-1 pr-2 font-medium">{t('energy.invoice.period')}</th>
                          <th className="py-1 pr-2 font-medium">{t('energy.invoice.number')}</th>
                          <th className="py-1 pr-2 text-right font-medium">{billUnit}</th>
                          <th className="py-1 pr-2 text-right font-medium">
                            {t('energy.invoice.subtotalShort')}
                          </th>
                          <th className="py-1 pr-2 text-right font-medium">
                            {t('energy.invoice.totalShort')}
                          </th>
                          <th className="py-1 text-right font-medium">{t('energy.invoice.perUnit', { unit: billUnit })}</th>
                          {canPlan && (
                            <th className="py-1 text-right font-medium">
                              <span className="sr-only">{t('energy.historyList.col.actions')}</span>
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {bills.invoices.map((bill) => (
                          <tr key={bill.id} className="border-t border-border">
                            <td className="py-1.5 pr-2">
                              <FromLink
                                href={`${here}/invoices/${bill.id}`}
                                className="font-medium hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                              >
                                {formatDate(bill.periodStart)} –{' '}
                                {formatDate(bill.periodEnd)}
                              </FromLink>
                              <span className="block text-xs text-foreground-muted">
                                {t('energy.invoice.days', { days: bill.days })} · {bill.supplier}
                              </span>
                            </td>
                            <td className="py-1.5 pr-2 text-foreground-muted">{bill.invoiceNumber}</td>
                            <td className="py-1.5 pr-2 text-right tabular-nums">
                              {format.number(billQuantity(bill), { maximumFractionDigits: 0 })}
                            </td>
                            <td className="py-1.5 pr-2 text-right tabular-nums">
                              {centsToText(bill.subtotalCents)} €
                            </td>
                            <td className="py-1.5 pr-2 text-right font-medium tabular-nums">
                              {centsToText(bill.totalCents)} €
                            </td>
                            {/*
                              Cost per kWh, all in — the figure a club compares
                              suppliers on. Arithmetic on two figures the API
                              sent, rather than a rule.
                            */}
                            <td className="py-1.5 text-right tabular-nums">
                              {billQuantity(bill) > 0
                                ? `${format.number(bill.totalCents / 100 / billQuantity(bill), { maximumFractionDigits: 3 })} €`
                                : '—'}
                            </td>
                            {canPlan && (
                              <td className="py-1.5 pl-2 text-right">
                                <EnergyArchiveButton
                                  what="invoice"
                                  meterId={meter.id}
                                  invoiceId={bill.id}
                                  name={`${bill.supplier} · ${bill.invoiceNumber}`}
                                />
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          },
        },
        {
          /*
            The rate, after the bills on purpose: a meter that has a fatura does
            not need one. Visible to the whole module — a fatura already is —
            while setting one stays owner and admin, which is `canPrice`.
          */
          slug: 'tariff',
          labelKey: 'energy.tariff.section',
          content: () => (
            <>
              {/* A gas meter in m³ is converted before it is priced (12-11-2026). */}
              {gasInM3 && <GasFactorPanel meter={meter} factors={gasFactors} canPlan={canPlan} />}
              <TariffPanel meter={meter} tariffs={tariffs} canPrice={canPrice} />
            </>
          ),
        },
        {
          slug: 'details',
          labelKey: 'energy.details',
          visible: canPlan && !meter.archived,
          content: () => (
            <section className="rounded bg-surface p-5 shadow-card">
              <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('energy.details')}
              </h2>
              <MeterAdmin meter={meter} pools={pools} />
            </section>
          ),
        },
      ]}
    />
  );
}
