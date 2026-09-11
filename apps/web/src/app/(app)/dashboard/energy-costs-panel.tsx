import Link from 'next/link';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import type { EnergyCosts } from '@/lib/api';
import { centsToText } from '@/lib/energy-invoice';
import { ConsumptionBars } from '@/components/consumption-bars';
import { withFrom } from '@/lib/back';

/**
 * What electricity costs — the dashboard's energy panel, slice 5.3.
 *
 * Twelve months of bills, in euros, by the month each billing period ended
 * in; the latest bill named, with its €/kWh; a link to Energia. Nothing is
 * derived here that the API did not send — the months arrive already summed,
 * every month present, an empty one null and drawn as a gap.
 *
 * **Absent rather than empty when there are no bills**, like the tasks
 * panel: a card saying "nothing" costs a scroll on every load. The one
 * exception is a club with meters and no bill yet, which is told where the
 * bills go — the whole point of the drop zone on Energia is that this panel
 * fills up.
 */
export async function EnergyCostsPanel({ costs }: { costs: EnergyCosts }): Promise<React.ReactElement | null> {
  const t = await getTranslations();
  const locale = await getLocale();
  const format = await getFormatter();

  if (costs.billCount === 0) return null;

  const year = costs.months.reduce((sum, m) => sum + (m.totalCents ?? 0), 0);
  const kwh = costs.months.reduce((sum, m) => sum + (m.kwh ?? 0), 0);
  const latest = costs.latest;

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('energy.costs.title')}
        </h2>
        <p className="text-sm text-foreground-muted">
          {t('energy.costs.summary', {
            total: `${centsToText(year)} €`,
            kwh: format.number(kwh, { maximumFractionDigits: 0 }),
            bills: costs.billCount,
          })}
        </p>
      </div>

      <ConsumptionBars
        monthly={costs.months.map((m) => ({ month: m.month, consumed: m.totalCents === null ? null : m.totalCents / 100 }))}
        unit="€"
        locale={locale}
        money
      />

      {latest !== null && (
        <p className="text-sm">
          {t('energy.costs.latest', {
            supplier: latest.supplier,
            meter: latest.meterName,
            from: format.dateTime(new Date(`${latest.periodStart}T00:00:00`), 'short'),
            to: format.dateTime(new Date(`${latest.periodEnd}T00:00:00`), 'short'),
            total: `${centsToText(latest.totalCents)} €`,
            perKwh: latest.kwh > 0 ? format.number(latest.totalCents / 100 / latest.kwh, { maximumFractionDigits: 3 }) : '—',
          })}
        </p>
      )}

      <Link
        href={withFrom('/dashboard/energy', '/dashboard')}
        className="self-start text-sm text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {t('energy.costs.open')}
      </Link>
    </section>
  );
}
