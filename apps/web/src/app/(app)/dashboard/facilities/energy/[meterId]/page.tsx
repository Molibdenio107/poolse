import { notFound } from 'next/navigation';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { PageShell } from '@/components/page-shell';
import { ConsumptionBars } from '@/components/consumption-bars';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { backTarget, withFrom } from '@/lib/back';
import { centsToText } from '@/lib/energy-invoice';
import { getMeter } from '../../energy.actions';
import { listInvoices } from '../invoice.actions';
import { MeterAdmin, ReadingForm, RemoveReading } from './meter-forms';

/**
 * One meter: its consumption by month, the form for the next reading, and the
 * record of every reading — slice 5.2, "a month of data is visible".
 *
 * The chart comes first because it is what the page is opened for; the form
 * next because it is what the page is opened *to do*; the record last because
 * it is the thing the other two are made from. Every figure on this page was
 * derived by the API from the meter's `reads` flag — nothing here subtracts.
 */
export default async function MeterPage({
  params,
  searchParams,
}: {
  params: Promise<{ meterId: string }>;
  searchParams: Promise<{ from?: string }>;
}): Promise<React.ReactElement> {
  const { meterId } = await params;
  const { from } = await searchParams;
  const t = await getTranslations();
  const locale = await getLocale();
  const format = await getFormatter();

  const detail = await getMeter(meterId);
  // Another tenant's meter is indistinguishable from none, deliberately.
  if (detail === null) notFound();
  const { meter, readings, monthly, pools, canPlan, canRecord } = detail;

  // The bills on this meter — slice 5.3. Their own section, never merged with
  // the readings: billing periods are not reading dates and bills carry
  // estimates. Absent when the endpoint refuses.
  const bills = await listInvoices(meterId);

  const back = backTarget(from, `/dashboard/facilities/${meter.facilityId}`);

  const subtitle = [
    t(`energy.kind.${meter.kind}`),
    meter.poolName ?? meter.facilityName,
    t(`energy.reads.${meter.reads}`),
  ].join(' · ');

  return (
    <PageShell
      title={meter.name}
      subtitle={subtitle}
      back={{ href: back.href, label: t(back.labelKey) }}
    >
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

      <section className="rounded border border-border bg-surface p-5">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('energy.consumption')}
        </h2>
        {readings.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t('energy.noReadingsHint')}</p>
        ) : (
          <ConsumptionBars monthly={monthly} unit={meter.unit} locale={locale} />
        )}
      </section>

      {canRecord && (
        <section className="rounded border border-border bg-surface p-5">
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {t('energy.recordTitle')}
          </h2>
          <ReadingForm meter={meter} />
        </section>
      )}

      <section className="rounded border border-border bg-surface p-5">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('energy.history')}
        </h2>

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
                      What this reading says was used since the one before it.
                      Said beside the figure rather than only on the chart, so a
                      dial reading — which means nothing on its own — is legible
                      as a consumption in the same glance.
                    */}
                    {meter.reads === 'cumulative_index' && (
                      <span className="ml-2 text-foreground-muted">
                        {reading.consumed === null
                          ? t('energy.firstReading')
                          : t('energy.sinceLast', {
                              value: format.number(reading.consumed, { maximumFractionDigits: 1 }),
                              unit: meter.unit,
                            })}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-foreground-muted">
                    {format.dateTime(new Date(reading.takenAt), 'stamp')}
                    {reading.recordedByName !== null && ` · ${reading.recordedByName}`}
                    {reading.note !== null && ` · ${reading.note}`}
                  </span>
                </span>

                {canRecord && <RemoveReading meter={meter} takenAt={reading.takenAt} />}
              </li>
            ))}
          </ul>
        )}
      </section>

      {bills !== null && (
        <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
              {t('energy.invoice.section')}
            </h2>
            {bills.canRecord && !meter.archived && (
              <Link
                href={withFrom(`/dashboard/facilities/energy/${meter.id}/invoices/new`, `/dashboard/facilities/energy/${meter.id}`)}
                className="inline-flex h-control items-center gap-1.5 rounded border border-border-strong px-3 text-sm transition-colors hover:border-primary/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <Plus className="size-4" aria-hidden="true" />
                {t('energy.invoice.add')}
              </Link>
            )}
          </div>

          {bills.invoices.length === 0 ? (
            <p className="text-sm text-foreground-muted">{t('energy.invoice.none')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-foreground-muted">
                    <th className="py-1 pr-2 font-medium">{t('energy.invoice.period')}</th>
                    <th className="py-1 pr-2 font-medium">{t('energy.invoice.number')}</th>
                    <th className="py-1 pr-2 text-right font-medium">kWh</th>
                    <th className="py-1 pr-2 text-right font-medium">{t('energy.invoice.subtotalShort')}</th>
                    <th className="py-1 pr-2 text-right font-medium">{t('energy.invoice.totalShort')}</th>
                    <th className="py-1 text-right font-medium">{t('energy.invoice.perKwh')}</th>
                  </tr>
                </thead>
                <tbody>
                  {bills.invoices.map((bill) => (
                    <tr key={bill.id} className="border-t border-border">
                      <td className="py-1.5 pr-2">
                        <Link
                          href={withFrom(`/dashboard/facilities/energy/${meter.id}/invoices/${bill.id}`, `/dashboard/facilities/energy/${meter.id}`)}
                          className="font-medium hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                          {format.dateTime(new Date(`${bill.periodStart}T00:00:00`), 'short')} – {format.dateTime(new Date(`${bill.periodEnd}T00:00:00`), 'short')}
                        </Link>
                        <span className="block text-xs text-foreground-muted">{t('energy.invoice.days', { days: bill.days })} · {bill.supplier}</span>
                      </td>
                      <td className="py-1.5 pr-2 text-foreground-muted">{bill.invoiceNumber}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{format.number(bill.kwh, { maximumFractionDigits: 0 })}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{centsToText(bill.subtotalCents)} €</td>
                      <td className="py-1.5 pr-2 text-right font-medium tabular-nums">{centsToText(bill.totalCents)} €</td>
                      {/*
                        Cost per kWh, all in — the figure a club compares
                        suppliers on. Derived here from two figures the API
                        sent, which is arithmetic rather than a rule.
                      */}
                      <td className="py-1.5 text-right tabular-nums">
                        {bill.kwh > 0 ? `${format.number(bill.totalCents / 100 / bill.kwh, { maximumFractionDigits: 3 })} €` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {canPlan && !meter.archived && (
        <section className="rounded border border-border bg-surface p-5">
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {t('energy.details')}
          </h2>
          <MeterAdmin meter={meter} pools={pools} />
        </section>
      )}
    </PageShell>
  );
}
