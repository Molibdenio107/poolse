import { notFound } from 'next/navigation';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { PageShell } from '@/components/page-shell';
import { ConsumptionBars } from '@/components/consumption-bars';
import { backTarget } from '@/lib/back';
import { getMeter } from '../../energy.actions';
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
