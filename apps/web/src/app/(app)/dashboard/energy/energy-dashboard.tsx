import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { AlertTriangle } from 'lucide-react';
import { FromLink } from '@/components/from-link';
import { cn } from '@/lib/utils';
import { StackedMonthBars } from '@/components/stacked-month-bars';
import { formatDate } from '@/lib/date-format';
import { formatCents } from '@/lib/money';
import { METER_CARRIERS, type ComparedTotal, type EnergySummary, type MeterCarrier } from '@/lib/api';

/**
 * The Energia page's dashboard — POOLSE-106. The whole club, at a glance.
 *
 * Read off `GET /energy/summary`, which decides everything here — the months,
 * the comparisons, who may see a euro — so this file only lays it out. Two
 * sources, never added: the running costs are **bills** (what suppliers
 * charged), the cost per lesson hour and per swimmer are POOLSE-28's
 * **estimates** (the tanks' meters at their tariffs), and each says which it is.
 *
 * Maintenance reads the same dashboard in kWh: the API sends no euro, and the
 * page says the euros are the office's rather than showing blanks.
 */

const FILL: Record<MeterCarrier, string> = {
  electricity: 'bg-chart-1',
  gas: 'bg-chart-2',
  water: 'bg-chart-3',
};

export async function EnergyDashboard({ summary }: { summary: EnergySummary }): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  const format = await getFormatter();
  const money = summary.canSeeMoney;

  const monthName = (month: string): string => format.dateTime(new Date(`${month}-01T12:00:00Z`), 'month');
  const number = (value: number): string => format.number(value, { maximumFractionDigits: 0 });
  const unitOf = (carrier: MeterCarrier): string => (carrier === 'water' ? 'm³' : 'kWh');
  const amount = (total: ComparedTotal, carrier: MeterCarrier): string | null =>
    money
      ? total.cents === null
        ? null
        : formatCents(locale, total.cents)
      : total.quantity === null
        ? null
        : `${number(total.quantity)} ${unitOf(carrier)}`;

  /** "+12 % face aos mesmos 3 meses de há um ano", or why there is no comparison. */
  const change = (total: ComparedTotal): string => {
    if (!money) return '';
    if (total.comparedMonths === 0 || total.previousCents === null || total.currentComparedCents === null) {
      return t('energy.dashboard.noComparison');
    }
    if (total.previousCents === 0) return t('energy.dashboard.noComparison');
    const percent = Math.round(((total.currentComparedCents - total.previousCents) / total.previousCents) * 100);
    return t('energy.dashboard.change', { percent, months: total.comparedMonths });
  };

  // Carriers worth a line: those with a meter, and electricity always.
  const carriers = METER_CARRIERS.filter((c) => c === 'electricity' || summary.metered[c] > 0);
  const noBillThisMonth = carriers.every((c) => summary.thisMonth.carriers[c].quantity === null);

  const perUse = summary.perUse;

  return (
    <section aria-labelledby="energy-dashboard" className="flex flex-col gap-5 rounded border border-border bg-surface p-5">
      <div>
        <h2 id="energy-dashboard" className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('energy.dashboard.title')}
        </h2>
        <p className="mt-1 text-sm text-foreground-muted">{t('energy.dashboard.hint')}</p>
        {!money && <p className="mt-1 text-sm text-foreground-muted">{t('energy.dashboard.noMoney')}</p>}
      </div>

      {summary.missing.length > 0 && (
        <div role="status" className="flex items-start gap-2 rounded border border-warning/50 bg-warning/10 p-3 text-sm">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="flex flex-col gap-1">
            <p className="font-medium">{t('energy.dashboard.missingTitle', { days: 45 })}</p>
            <ul className="flex flex-col gap-1">
              {summary.missing.map((m) => (
                <li key={m.meterId} className="flex flex-wrap items-baseline gap-x-2">
                  <span>
                    {t('energy.dashboard.missingLine', {
                      meter: m.meterName,
                      site: m.facilityName,
                      carrier: t(`energy.carrier.${m.carrier}`),
                    })}{' '}
                    <span className="text-foreground-muted">
                      {m.lastPeriodEnd === null
                        ? t('energy.dashboard.neverBilled')
                        : t('energy.dashboard.lastBilled', { date: formatDate(m.lastPeriodEnd) })}
                    </span>
                  </span>
                  <FromLink
                    href={`/dashboard/energy?import=${m.meterId}#importar`}
                    className="rounded text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    {t('energy.dashboard.importIt')}
                  </FromLink>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* This month, by the month a billing period ends in. */}
        <div className="flex flex-col gap-2 rounded border border-border p-4">
          <h3 className="text-sm font-medium">
            {t('energy.dashboard.thisMonth', { month: monthName(summary.thisMonth.month) })}
          </h3>
          {noBillThisMonth ? (
            <p className="text-sm text-foreground-muted">
              {summary.lastBilledMonth === null
                ? t('energy.dashboard.noBillsYet')
                : t('energy.dashboard.noBillThisMonth', { month: monthName(summary.lastBilledMonth) })}
            </p>
          ) : (
            <CarrierLines
              carriers={carriers}
              totals={summary.thisMonth.carriers}
              amount={amount}
              change={change}
              label={(c) => t(`energy.carrier.${c}`)}
              none={t('energy.dashboard.noBill')}
              unmetered={(c) => summary.metered[c] === 0}
              unmeteredLabel={t('energy.dashboard.unmetered')}
            />
          )}
        </div>

        <div className="flex flex-col gap-2 rounded border border-border p-4">
          <h3 className="text-sm font-medium">{t('energy.dashboard.lastTwelve')}</h3>
          <CarrierLines
            carriers={METER_CARRIERS}
            totals={summary.lastTwelve}
            amount={amount}
            change={change}
            label={(c) => t(`energy.carrier.${c}`)}
            none={t('energy.dashboard.noBill')}
            unmetered={(c) => summary.metered[c] === 0}
            unmeteredLabel={t('energy.dashboard.unmetered')}
          />
        </div>

        {/* POOLSE-28's figures, summed over the club's tanks — owner and admin only. */}
        {perUse !== null && (
          <>
            <PerUseTile
              title={t('energy.dashboard.perLessonHour')}
              value={perUse.perLessonHourCents === null ? null : formatCents(locale, perUse.perLessonHourCents)}
              explain={t('energy.dashboard.perLessonHourExplain')}
              coverage={t('energy.dashboard.coverage', { counted: perUse.poolsCounted, pools: perUse.pools })}
              none={t('energy.dashboard.perUseNone')}
            />
            <PerUseTile
              title={t('energy.dashboard.perSwimmer')}
              value={perUse.perBatherCents === null ? null : formatCents(locale, perUse.perBatherCents)}
              explain={t('energy.dashboard.perSwimmerExplain')}
              coverage={t('energy.dashboard.coverage', { counted: perUse.poolsCounted, pools: perUse.pools })}
              none={t('energy.dashboard.perUseNone')}
            />
          </>
        )}
      </div>

      <StackedMonthBars
        caption={money ? t('energy.dashboard.chartCaption') : t('energy.dashboard.chartCaptionKwh')}
        emptyLabel={t('energy.dashboard.noBill')}
        series={(money ? METER_CARRIERS.filter((c) => summary.metered[c] > 0) : METER_CARRIERS.filter((c) => c !== 'water' && summary.metered[c] > 0)).map(
          (c) => ({ key: c, label: t(`energy.carrier.${c}`), fill: FILL[c] }),
        )}
        months={summary.months.map((m) => ({
          month: m.month,
          values: Object.fromEntries(
            METER_CARRIERS.map((c) => [c, money ? (m.carriers[c].cents === null ? null : m.carriers[c].cents! / 100) : m.carriers[c].quantity]),
          ),
        }))}
        formatValue={money ? (value) => formatCents(locale, Math.round(value * 100)) : (value) => `${number(value)} kWh`}
      />
    </section>
  );
}

function CarrierLines({
  carriers,
  totals,
  amount,
  change,
  label,
  none,
  unmetered,
  unmeteredLabel,
}: {
  carriers: readonly MeterCarrier[];
  totals: Record<MeterCarrier, ComparedTotal>;
  amount: (total: ComparedTotal, carrier: MeterCarrier) => string | null;
  change: (total: ComparedTotal) => string;
  label: (carrier: MeterCarrier) => string;
  none: string;
  unmetered: (carrier: MeterCarrier) => boolean;
  unmeteredLabel: string;
}): React.ReactElement {
  return (
    <dl className="flex flex-col gap-2 text-sm">
      {carriers.map((carrier) => {
        const total = totals[carrier];
        const value = amount(total, carrier);
        const moved = change(total);
        return (
          <div key={carrier} className="grid grid-cols-[1fr_auto] items-baseline gap-x-3">
            <dt className="flex items-center gap-1.5">
              <span aria-hidden className={cn('inline-block size-2.5 rounded-sm', FILL[carrier])} />
              {label(carrier)}
            </dt>
            <dd className="text-right font-medium tabular-nums">
              {unmetered(carrier) ? (
                <span className="font-normal text-foreground-muted">{unmeteredLabel}</span>
              ) : (
                value ?? <span className="font-normal text-foreground-muted">{none}</span>
              )}
            </dd>
            {value !== null && moved !== '' && (
              <dd className="col-span-2 text-xs text-foreground-muted">{moved}</dd>
            )}
          </div>
        );
      })}
    </dl>
  );
}

function PerUseTile({
  title,
  value,
  explain,
  coverage,
  none,
}: {
  title: string;
  value: string | null;
  explain: string;
  coverage: string;
  none: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1 rounded border border-border p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="text-2xl font-semibold tabular-nums">{value ?? <span className="text-base font-normal text-foreground-muted">{none}</span>}</p>
      {/* The one-liner is visible text, not a tooltip: it is what makes the figure honest. */}
      <p className="text-xs text-foreground-muted">{explain}</p>
      <p className="text-xs text-foreground-muted">{coverage}</p>
    </div>
  );
}
