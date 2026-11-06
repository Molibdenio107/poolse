import { ReceiptEuro } from 'lucide-react';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { DownloadLink } from '@/components/download-link';
import { FromLink } from '@/components/from-link';
import { PageEmpty, PageError, PageShell } from '@/components/page-shell';
import { SectionPills } from '@/components/section-pills';
import { StackedMonthBars, type ChartRuler } from '@/components/stacked-month-bars';
import { Hint } from '@/components/ui/tooltip';
import { apiFetch, COST_GROUPS, type CostGroup, type CostRuler, type CostsOverview } from '@/lib/api';
import { backProp, originBack } from '@/lib/back';
import { formatDate } from '@/lib/date-format';
import { describeLoad } from '@/lib/load-failure';
import { formatCents } from '@/lib/money';
import { cn } from '@/lib/utils';

/**
 * *Custos* — POOLSE-183. What the club spent, by kind, read by the civil year or
 * by the época from the same months.
 *
 * `GET /costs/overview` decides everything (the windows, the months compared, who
 * sees the Owner's pay, which kinds a switched-off module removes), so this file
 * only lays it out. **Three numbers, never one**: faturado is documents, estimado
 * is arithmetic, and the total is labelled as both. Nothing here is edited; a kind
 * links to where it is recorded, where that has a screen.
 */

const FILL: Record<CostGroup, string> = {
  gas: 'bg-chart-2',
  electricity: 'bg-chart-1',
  materials: 'bg-chart-5',
  insurance: 'bg-chart-6',
  salary: 'bg-chart-4',
  water: 'bg-chart-3',
  maintenance_service: 'bg-chart-7',
  fixed: 'bg-chart-8',
};

const RECORDED_AT: Partial<Record<CostGroup, string>> = {
  electricity: '/dashboard/energy',
  gas: '/dashboard/energy',
  water: '/dashboard/energy',
  salary: '/dashboard/facilities/staff/salaries',
  materials: '/dashboard/facilities/inventory',
};

function monthPosition(date: string, months: readonly string[], endOfDay: boolean): number | null {
  const index = months.indexOf(date.slice(0, 7));
  if (index < 0) return null;
  const day = Number(date.slice(8, 10));
  const inMonth = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
  return index + (endOfDay ? day : day - 1) / inMonth;
}

export default async function CostsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; ruler?: string; window?: string; vat?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  const format = await getFormatter();
  const query = await searchParams;
  const asked: CostRuler = query.ruler === 'season' ? 'season' : 'civil';
  const withVat = query.vat === '1';

  const params = new URLSearchParams({ ruler: asked });
  if (query.window !== undefined) params.set('window', query.window);
  if (withVat) params.set('vat', '1');

  const shell = {
    back: backProp(originBack(query.from), t),
    title: t('costs.title'),
    subtitle: t('costs.subtitle'),
  };

  let data: CostsOverview;
  try {
    data = await apiFetch<CostsOverview>(`/costs/overview?${params.toString()}`);
  } catch (error) {
    const failure = describeLoad(error);
    return (
      <PageShell {...shell}>
        <PageError message={t(failure.key)} {...(failure.detail === '' ? {} : { detail: failure.detail })} />
      </PageShell>
    );
  }

  const money = (cents: number): string => formatCents(locale, cents);
  const name = (group: CostGroup): string => t(`costs.kind.${group}`);
  const decimal = (value: number): string => format.number(value, { maximumFractionDigits: 1 });
  const monthName = (month: string): string => format.dateTime(new Date(`${month}-01T12:00:00Z`), 'month');

  const href = (next: { ruler?: CostRuler; window?: string | null; vat?: boolean }): string => {
    const out = new URLSearchParams({ ruler: next.ruler ?? data.ruler });
    const window = next.window === null ? undefined : (next.window ?? data.window.key);
    if (window !== undefined) out.set('window', window);
    if (next.vat ?? withVat) out.set('vat', '1');
    return `/dashboard/faturacao/custos?${out.toString()}`;
  };

  const present = COST_GROUPS.filter((group) =>
    data.chart.some((month) => (month.groups[group] ?? 0) > 0) || data.totals.some((total) => total.group === group),
  );
  const chartMonths = data.chart.map((month) => month.month);

  const rulers: ChartRuler[] = chartMonths.flatMap((month, index) =>
    index > 0 && month.endsWith('-01') ? [{ at: index, style: 'solid' as const, label: month.slice(0, 4) }] : [],
  );
  for (const season of data.seasons) {
    const start = monthPosition(season.startsOn, chartMonths, false);
    const end = monthPosition(season.endsOn, chartMonths, true);
    if (start !== null) rulers.push({ at: start, style: 'dashed', label: season.name });
    if (end !== null) rulers.push({ at: end, style: 'dashed' });
  }

  const totalCents = data.invoicedCents + data.estimatedCents;
  const compared = data.comparison !== null && data.comparison.groups !== null ? data.comparison : null;
  const change = (now: number, then: number): string => {
    const difference = now - then;
    const signed = `${difference > 0 ? '+' : difference < 0 ? '−' : ''}${money(Math.abs(difference))}`;
    return then === 0
      ? signed
      : t('costs.changePercent', { difference: signed, percent: Math.round((difference / then) * 100) });
  };
  const changeOf = (group: CostGroup): string | null => {
    const row = compared?.groups.find((one) => one.group === group);
    return row === undefined ? null : change(row.currentCents, row.previousCents);
  };

  const averages: { key: string; value: number | null; basis: string; missing: string }[] = [
    {
      key: 'perMonth',
      value: data.averages.perMonthCents,
      basis: t('costs.average.perMonthBasis', { months: decimal(data.averages.months) }),
      missing: t('costs.average.noMonths'),
    },
    {
      key: 'perHour',
      value: data.averages.perHourCents,
      basis: t('costs.average.perHourBasis', { hours: decimal(data.averages.taughtHours) }),
      missing: t('costs.average.noHours'),
    },
    {
      key: 'perStudentMonth',
      value: data.averages.perStudentMonthCents,
      basis: t('costs.average.perStudentMonthBasis', { months: decimal(data.averages.studentMonths) }),
      missing: t('costs.average.noStudents'),
    },
    {
      key: 'perCubicMetre',
      value: data.averages.perCubicMetreCents,
      basis: t('costs.average.perCubicMetreBasis', { metres: decimal(data.averages.cubicMetres ?? 0) }),
      missing:
        data.averages.poolsWithoutVolume > 0
          ? t('costs.average.noVolume', { count: data.averages.poolsWithoutVolume })
          : t('costs.average.noPoolCosts'),
    },
  ];

  const tile = 'flex flex-col gap-1 rounded bg-surface p-4 shadow-card';
  const empty = data.totals.length === 0;

  return (
    <PageShell
      {...shell}
      actions={
        <DownloadLink
          href={`/dashboard/faturacao/custos/export?${params.toString()}`}
          className="inline-flex h-control items-center justify-center rounded-sm bg-surface px-4 text-control shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t('costs.exportCsv')}
        </DownloadLink>
      }
    >
      <div className="flex flex-col gap-2">
        <SectionPills
          label={t('costs.rulerLabel')}
          current={data.ruler}
          items={[
            { key: 'civil', label: t('costs.ruler.civil'), href: href({ ruler: 'civil', window: null }) },
            ...(data.windows.season.length > 0
              ? [{ key: 'season', label: t('costs.ruler.season'), href: href({ ruler: 'season', window: null }) }]
              : []),
          ]}
        />
        <SectionPills
          label={t('costs.windowLabel')}
          current={data.window.key}
          items={data.windows[data.ruler].map((window) => ({
            key: window.key,
            label: window.label,
            href: href({ window: window.key }),
          }))}
        />
        <SectionPills
          label={t('costs.taxLabel')}
          current={withVat ? 'with' : 'without'}
          items={[
            { key: 'without', label: t('costs.withoutVat'), href: href({ vat: false }) },
            { key: 'with', label: t('costs.withVat'), href: href({ vat: true }) },
          ]}
        />
      </div>

      {data.windows.season.length === 0 && <p className="text-sm text-foreground-muted">{t('costs.noSeasons')}</p>}

      {empty ? (
        <PageEmpty icon={ReceiptEuro} message={t('costs.empty')} hint={t('costs.emptyHint')} />
      ) : (
        <>
          <section className="rounded bg-surface p-5 shadow-card">
            <StackedMonthBars
              months={data.chart.map((month) => ({
                month: month.month,
                values: Object.fromEntries(present.map((group) => [group, month.groups[group] ?? 0])),
              }))}
              series={present.map((group) => ({ key: group, label: name(group), fill: FILL[group] }))}
              formatValue={money}
              caption={t(withVat ? 'costs.chartCaptionWithVat' : 'costs.chartCaption')}
              emptyLabel={t('costs.noFigure')}
              rulers={rulers}
              showTable={false}
            />
            <p className="mt-3 flex flex-wrap items-center gap-4 text-xs text-foreground-muted">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-3 border-l border-foreground-muted" />
                {t('costs.legendCivil')}
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-3 border-l border-dashed border-foreground-muted" />
                {t('costs.legendSeason')}
              </span>
            </p>
          </section>

          <section aria-label={t('costs.totalsLabel')} className="flex flex-col gap-3">
            <p className="text-sm">
              {t(data.window.runningToday ? 'costs.windowToday' : 'costs.window', {
                from: formatDate(data.window.from),
                to: formatDate(data.window.to),
              })}
              {data.estimatedMonths > 0 && ` ${t('costs.includesEstimates', { count: data.estimatedMonths })}`}
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className={tile}>
                <span className="text-sm text-foreground-muted">{t('costs.invoiced')}</span>
                <span className="text-xl font-semibold tabular-nums">{money(data.invoicedCents)}</span>
              </div>
              <div className={tile}>
                <span className="text-sm text-foreground-muted">{t('costs.estimated')}</span>
                <span className="text-xl font-semibold tabular-nums">{money(data.estimatedCents)}</span>
                <span className="text-xs text-foreground-muted">{t('costs.estimatedHint')}</span>
              </div>
              <div className={tile}>
                <span className="text-sm text-foreground-muted">{t('costs.total')}</span>
                <span className="text-xl font-semibold tabular-nums">{money(totalCents)}</span>
                {compared !== null && (
                  <span className="text-xs text-foreground-muted">
                    {change(compared.currentCents, compared.previousCents)}
                  </span>
                )}
              </div>
            </div>

            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {data.totals.map((total) => {
                const difference = changeOf(total.group);
                const recordedAt = RECORDED_AT[total.group];
                return (
                  <li key={total.group} className={tile}>
                    <span className="flex items-center gap-1.5 text-sm text-foreground-muted">
                      <span aria-hidden className={cn('inline-block size-3 rounded-sm', FILL[total.group])} />
                      {name(total.group)}
                    </span>
                    <span className="text-lg font-semibold tabular-nums">
                      {money(total.invoicedCents + total.estimatedCents)}
                    </span>
                    {total.estimatedCents > 0 && total.invoicedCents > 0 && (
                      <span className="text-xs text-foreground-muted">
                        {t('costs.ofWhichEstimated', { amount: money(total.estimatedCents) })}
                      </span>
                    )}
                    {difference !== null && <span className="text-xs text-foreground-muted">{difference}</span>}
                    {recordedAt !== undefined && (
                      <FromLink href={recordedAt} className="mt-1 text-xs text-primary hover:underline">
                        {t('costs.seeWhereRecorded')}
                      </FromLink>
                    )}
                  </li>
                );
              })}
            </ul>

            <p className="text-sm text-foreground-muted">
              {data.previousLabel === null
                ? t('costs.noPrevious')
                : compared !== null
                  ? t('costs.compared', { months: compared.months, window: data.previousLabel })
                  : t('costs.noComparison', {
                      months: data.comparison?.months ?? 0,
                      window: data.previousLabel,
                    })}
            </p>
          </section>

          <section aria-label={t('costs.averagesLabel')} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {averages.map((average) => (
              <div key={average.key} className={tile}>
                <span className="text-sm text-foreground-muted">{t(`costs.average.${average.key}`)}</span>
                {average.value === null ? (
                  <span className="text-sm">{average.missing}</span>
                ) : (
                  <>
                    <span className="text-lg font-semibold tabular-nums">{money(average.value)}</span>
                    <span className="text-xs text-foreground-muted">{average.basis}</span>
                  </>
                )}
              </div>
            ))}
          </section>

          {(data.ownerPayLeftOut || data.salariesWithoutHours > 0 || data.unpricedSupplyMonths > 0) && (
            <ul className="flex flex-col gap-1 text-sm text-foreground-muted">
              {data.ownerPayLeftOut && <li>{t('costs.ownerLeftOut')}</li>}
              {data.salariesWithoutHours > 0 && (
                <li>{t('costs.salariesWithoutHours', { count: data.salariesWithoutHours })}</li>
              )}
              {data.unpricedSupplyMonths > 0 && (
                <li>{t('costs.unpricedSupply', { count: data.unpricedSupplyMonths })}</li>
              )}
            </ul>
          )}

          <section className="flex flex-col gap-2 rounded bg-surface p-5 shadow-card">
            <h2 className="font-medium">{t('costs.tableTitle')}</h2>
            <p className="text-xs text-foreground-muted">{t('costs.tableLegend')}</p>
            <div className="overflow-x-auto">
              <table className="table-stack w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-foreground-muted">
                    <th scope="col" className="py-1 pr-3 font-medium">
                      {t('costs.month')}
                    </th>
                    {data.totals.map((total) => (
                      <th key={total.group} scope="col" className="py-1 pr-3 text-right font-medium">
                        {name(total.group)}
                      </th>
                    ))}
                    <th scope="col" className="py-1 pr-3 text-right font-medium">
                      {t('costs.total')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.table.map((row) => {
                    const cells = data.totals.map((total) => row.groups[total.group]);
                    const rowTotal = cells.reduce(
                      (sum, cell) => sum + (cell?.invoicedCents ?? 0) + (cell?.estimatedCents ?? 0),
                      0,
                    );
                    return (
                      <tr key={row.month}>
                        <th scope="row" className="py-1 pr-3 text-left font-normal">
                          {monthName(row.month)}
                          {row.partial && ` ${t('costs.partial')}`}
                        </th>
                        {data.totals.map((total, index) => {
                          const cell = cells[index];
                          const amount = (cell?.invoicedCents ?? 0) + (cell?.estimatedCents ?? 0);
                          const estimated = (cell?.estimatedCents ?? 0) > 0;
                          return (
                            <td key={total.group} data-label={name(total.group)} className="py-1 pr-3 text-right tabular-nums">
                              {cell === undefined ? (
                                '—'
                              ) : estimated ? (
                                <Hint text={t('costs.estimatedCell')}>
                                  <span tabIndex={0} className="italic">
                                    {money(amount)}
                                  </span>
                                </Hint>
                              ) : (
                                money(amount)
                              )}
                            </td>
                          );
                        })}
                        <td data-label={t('costs.total')} className="py-1 pr-3 text-right font-medium tabular-nums">
                          {money(rowTotal)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border font-medium">
                    <th scope="row" className="py-1 pr-3 text-left font-medium">
                      {t('costs.tableTotal')}
                    </th>
                    {data.totals.map((total) => (
                      <td key={total.group} data-label={name(total.group)} className="py-1 pr-3 text-right tabular-nums">
                        {money(total.invoicedCents + total.estimatedCents)}
                      </td>
                    ))}
                    <td data-label={t('costs.total')} className="py-1 pr-3 text-right tabular-nums">
                      {money(totalCents)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </>
      )}
    </PageShell>
  );
}
