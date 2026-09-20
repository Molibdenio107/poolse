import { getFormatter, getTranslations } from 'next-intl/server';
import { centsToText } from '@/lib/energy-invoice';
import type { PoolCostReport } from '@/lib/api';

/**
 * What this tank costs per hour taught in it — POOLSE-28.
 *
 * Every energy product tells a club it used 14 000 kWh last month. This says
 * that the tank costs €38 an hour to heat, or €4 a bather, which is the figure
 * that decides whether a class is worth running — and Poolse can say it because
 * it is the only one holding both the meter and the timetable.
 *
 * **It states its own limits before it states a number.** The grain is a month,
 * because a club types one reading a month; the euros are an estimate from a
 * tariff, not a bill; and the meters it added up are named. A figure this
 * consequential presented with more confidence than it has earned is worse than
 * no figure — `docs/financials.md` §6 and §9, and the ticket's own AC 5.
 *
 * Owner and admin only, enforced on the endpoint. The page renders nothing at
 * all when the read was refused, so a maintenance member sees no empty shell.
 */
export async function CostPerUsePanel({
  report,
}: {
  report: PoolCostReport;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const format = await getFormatter();

  const money = (cents: number): string => `${centsToText(Math.round(cents))} €`;

  /*
   * The three rates. Arithmetic over two figures the API already sent — the
   * same licence the bills table takes for its €/kWh — and never a rule: what
   * counts as a taught minute or a bather was decided in SQL.
   *
   * Each is null rather than zero when its denominator is missing, because a
   * zero here is a number an owner would act on.
   */
  const hours = report.taughtMinutes / 60;
  const perHour = report.costCents !== null && hours > 0 ? report.costCents / hours : null;
  const perBather =
    report.costCents !== null && report.bathers > 0 ? report.costCents / report.bathers : null;
  const perCubicMetre =
    report.costCents !== null && report.cubicMetres !== null && report.cubicMetres > 0
      ? report.costCents / report.cubicMetres
      : null;

  const unpricedSources = report.sources.filter((source) => !source.fullyPriced);

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
        {t('energy.perUse.section')}
      </h2>

      {report.sources.length === 0 ? (
        /*
         * Nothing meters this tank. Said as a sentence with what would fix it,
         * rather than hidden — an unset input the owner can see is the point of
         * financials §6. The site's own "Geral" dial is deliberately not used:
         * its kWh light the car park too, and splitting them would be a guess
         * dressed as a measurement.
         */
        <p className="text-sm text-foreground-muted">{t('energy.perUse.noMeter')}</p>
      ) : (
        <>
          <p className="text-sm text-foreground-muted">
            {t('energy.perUse.basis', {
              meters: report.sources.map((source) => source.name).join(', '),
            })}
          </p>

          {report.costCents === null ? (
            <p className="text-sm text-foreground-muted">{t('energy.perUse.noTariff')}</p>
          ) : (
            <>
              <dl className="flex flex-wrap gap-x-10 gap-y-4">
                <Figure
                  label={t('energy.perUse.perHour')}
                  value={perHour === null ? null : money(perHour)}
                  missing={t('energy.perUse.noHours')}
                />
                <Figure
                  label={t('energy.perUse.perBather')}
                  value={perBather === null ? null : money(perBather)}
                  missing={t('energy.perUse.noBathers')}
                />
                <Figure
                  label={t('energy.perUse.perCubicMetre')}
                  value={perCubicMetre === null ? null : money(perCubicMetre)}
                  // Which figure is unavailable, and why. Never a blank cell
                  // and never a zero — QA 28.4.
                  missing={t('energy.perUse.noVolume')}
                />
              </dl>

              {/*
                Coverage, in visible text. An unqualified rate over partial data
                has the same shape as a complete one, so the denominators it was
                built from are on screen beside it — financials §6.
              */}
              <p className="text-sm text-foreground-muted">
                {t('energy.perUse.coverage', {
                  cost: money(report.costCents),
                  priced: report.monthsPriced,
                  total: report.monthsWithConsumption,
                  hours: format.number(hours, { maximumFractionDigits: 1 }),
                  bathers: report.bathers,
                })}
              </p>

              {report.unallocatedCents !== null && report.unallocatedCents > 0 && (
                /*
                 * Energy in months where nothing was taught — August, a
                 * closure, a week of works. The tank was still heated, so the
                 * euros are real; there is simply no lesson to charge them to.
                 * Reported rather than dropped, QA 28.3.
                 */
                <p className="text-sm text-foreground-muted">
                  {t('energy.perUse.unallocated', { amount: money(report.unallocatedCents) })}
                </p>
              )}
            </>
          )}

          {unpricedSources.length > 0 && (
            <p className="text-sm text-foreground-muted">
              {t('energy.perUse.unpriced', {
                meters: unpricedSources.map((source) => source.name).join(', '),
              })}
            </p>
          )}

          {/*
            What the number is and is not, last and unmissable: an estimate, at
            the grain of a month, from a tariff rather than a bill. AC 5 — the
            report must not present a derived figure with the same visual
            confidence as a measured one.
          */}
          <p className="text-xs text-foreground-muted">{t('energy.perUse.caveat')}</p>
        </>
      )}
    </section>
  );
}

/** One rate, or the sentence saying why it is unavailable. */
function Figure({
  label,
  value,
  missing,
}: {
  label: string;
  value: string | null;
  missing: string;
}): React.ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs uppercase tracking-wider text-foreground-muted">{label}</dt>
      <dd className={value === null ? 'text-sm text-foreground-muted' : 'text-lg font-medium tabular-nums'}>
        {value ?? missing}
      </dd>
    </div>
  );
}
