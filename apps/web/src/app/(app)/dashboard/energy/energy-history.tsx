import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { describeLoad } from '@/lib/load-failure';
import { formatDate, formatStamp } from '@/lib/date-format';
import { centsToText } from '@/lib/energy-invoice';
import type { Paginated } from '@/lib/pagination';
import { FilterSelect } from '@/components/filter-select';
import { FromLink } from '@/components/from-link';
import { Pagination } from '@/components/pagination';
import { PageError } from '@/components/page-shell';
import { cn } from '@/lib/utils';
import { EnergyArchiveButton } from './energy-archive-button';

interface HistoryReading {
  meterId: string;
  meterName: string;
  unit: string;
  takenAt: string;
  value: number;
  note: string | null;
  recordedByName: string | null;
}

interface HistoryInvoice {
  id: string;
  meterId: string;
  meterName: string;
  supplier: string;
  invoiceNumber: string;
  periodStart: string;
  periodEnd: string;
  totalCents: number;
}

interface HistoryAnswer {
  readings?: Paginated<HistoryReading>;
  invoices?: Paginated<HistoryInvoice>;
  months: string[];
  canArchive: boolean;
}

const BASE = '/dashboard/energy';
const SEGMENT =
  'inline-flex h-control items-center justify-center px-4 text-control rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * Energia › Histórico — every meter's readings or bills in one list (Rui,
 * 12-11-2026). Leituras or Faturas, then a meter and a month, all in the URL.
 * Owner and Admin delete a row, or everything the filter shows, into
 * Arquivados; maintenance reads it.
 */
export async function EnergyHistory({
  meters,
  query,
}: {
  meters: { id: string; label: string }[];
  query: { kind?: string | undefined; meter?: string | undefined; month?: string | undefined; page?: string | undefined };
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();

  const kind = query.kind === 'invoices' ? 'invoices' : 'readings';
  const meter = meters.some((one) => one.id === query.meter) ? query.meter : undefined;
  const month = /^\d{4}-\d{2}$/.test(query.month ?? '') ? query.month : undefined;

  const params = new URLSearchParams({ kind });
  if (meter !== undefined) params.set('meter', meter);
  if (month !== undefined) params.set('month', month);
  if (query.page !== undefined) params.set('page', query.page);

  let answer: HistoryAnswer;
  try {
    answer = await apiFetch<HistoryAnswer>(`/energy/history?${params}`);
  } catch (error) {
    return <PageError message={t(describeLoad(error).key)} />;
  }

  const monthLabel = (value: string): string =>
    new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${value}-15T00:00:00Z`),
    );
  const meterName = meters.find((one) => one.id === meter)?.label;
  const scope = [
    meterName === undefined ? t('energy.historyList.scopeAllMeters') : t('energy.historyList.scopeMeter', { name: meterName }),
    month === undefined ? t('energy.historyList.scopeAllMonths') : t('energy.historyList.scopeMonth', { month: monthLabel(month) }),
  ].join(' ');

  const page: Paginated<unknown> | undefined = kind === 'readings' ? answer.readings : answer.invoices;
  const total = page?.total ?? 0;
  const kindHref = (next: 'readings' | 'invoices'): string => {
    const link = new URLSearchParams({ section: 'history', kind: next });
    if (meter !== undefined) link.set('meter', meter);
    return `${BASE}?${link}`;
  };

  return (
    <section className="flex flex-col gap-4 rounded bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-end gap-3">
        <nav aria-label={t('energy.historyList.kindNav')} className="flex gap-1 rounded-sm bg-surface-muted p-1">
          {(['readings', 'invoices'] as const).map((one) => (
            <FromLink
              key={one}
              href={kindHref(one)}
              aria-current={kind === one ? 'page' : undefined}
              className={cn(SEGMENT, kind === one ? 'bg-primary text-primary-foreground' : 'hover:bg-surface')}
            >
              {t(`energy.historyList.kind.${one}`)}
            </FromLink>
          ))}
        </nav>
        <FilterSelect
          name="meter"
          label={t('energy.historyList.meter')}
          value={meter ?? ''}
          anyLabel={t('energy.historyList.allMeters')}
          options={meters.map((one) => ({ value: one.id, label: one.label }))}
        />
        <FilterSelect
          name="month"
          label={t('energy.historyList.month')}
          value={month ?? ''}
          anyLabel={t('energy.historyList.allMonths')}
          options={answer.months.map((value) => ({ value, label: monthLabel(value) }))}
        />
        {answer.canArchive && total > 0 && (
          <span className="ml-auto">
            <EnergyArchiveButton
              what="batch"
              kind={kind}
              meterId={meter ?? null}
              month={month ?? null}
              count={total}
              scope={scope}
            />
          </span>
        )}
      </div>

      <p className="text-sm text-foreground-muted">{t(`energy.historyList.count.${kind}`, { count: total })}</p>

      {total === 0 ? (
        <p className="text-sm text-foreground-muted">{t(`energy.historyList.none.${kind}`)}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-foreground-muted">
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t(kind === 'readings' ? 'energy.historyList.col.when' : 'energy.historyList.col.period')}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">{t('energy.historyList.col.meter')}</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  {t(kind === 'readings' ? 'energy.historyList.col.value' : 'energy.historyList.col.total')}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t(kind === 'readings' ? 'energy.historyList.col.by' : 'energy.historyList.col.bill')}
                </th>
                {answer.canArchive && (
                  <th scope="col" className="py-2 text-right font-medium">
                    <span className="sr-only">{t('energy.historyList.col.actions')}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {kind === 'readings'
                ? (answer.readings?.items ?? []).map((row) => (
                    <tr key={`${row.meterId}-${row.takenAt}`} className="border-b border-border last:border-0">
                      <td className="py-2 pr-3 tabular-nums">{formatStamp(new Date(row.takenAt))}</td>
                      <td className="py-2 pr-3">
                        <FromLink href={`/dashboard/facilities/energy/${row.meterId}?tab=readings`} className="hover:text-primary">
                          {row.meterName}
                        </FromLink>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {format.number(row.value, { maximumFractionDigits: 3 })}{' '}
                        <span className="text-foreground-muted">{row.unit}</span>
                      </td>
                      <td className="py-2 pr-3 text-foreground-muted">
                        {[row.recordedByName, row.note].filter((one) => one !== null).join(' · ')}
                      </td>
                      {answer.canArchive && (
                        <td className="py-2 text-right">
                          <EnergyArchiveButton what="reading" meterId={row.meterId} takenAt={row.takenAt} />
                        </td>
                      )}
                    </tr>
                  ))
                : (answer.invoices?.items ?? []).map((row) => (
                    <tr key={row.id} className="border-b border-border last:border-0">
                      <td className="py-2 pr-3 tabular-nums">
                        {formatDate(row.periodStart)} – {formatDate(row.periodEnd)}
                      </td>
                      <td className="py-2 pr-3">{row.meterName}</td>
                      <td className="py-2 pr-3 text-right font-medium tabular-nums">{centsToText(row.totalCents)} €</td>
                      <td className="py-2 pr-3">
                        <FromLink
                          href={`/dashboard/facilities/energy/${row.meterId}/invoices/${row.id}`}
                          className="hover:text-primary"
                        >
                          {row.supplier} · {row.invoiceNumber}
                        </FromLink>
                      </td>
                      {answer.canArchive && (
                        <td className="py-2 text-right">
                          <EnergyArchiveButton
                            what="invoice"
                            meterId={row.meterId}
                            invoiceId={row.id}
                            name={`${row.supplier} · ${row.invoiceNumber}`}
                          />
                        </td>
                      )}
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}

      {page !== undefined && (
        <Pagination
          page={page}
          basePath={BASE}
          query={{ section: 'history', kind, meter, month }}
        />
      )}
    </section>
  );
}
