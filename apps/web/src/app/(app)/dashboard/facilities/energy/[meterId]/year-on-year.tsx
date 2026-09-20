import { getFormatter, getTranslations } from 'next-intl/server';
import { centsToText } from '@/lib/energy-invoice';
import type { YearOnYear } from '@/lib/api';

/**
 * This year against last — slice 5.4a.
 *
 * **Consumption and cost are two sentences, never one.** A club whose bill is
 * forty per cent higher on a flat year of kWh has a tariff problem, not a pool
 * problem, and those are different things to do something about. The screen
 * says which by naming the **implied unit price of each period** — the period's
 * own euros divided by its own kWh — so the distinction is a fact rather than a
 * guess at what size of divergence is worth mentioning.
 *
 * **It compares only the months that have both years**, and says how many those
 * were. A club with eighteen months of readings would otherwise be told it had
 * halved its consumption, which is the shape `docs/financials.md` §6 warns
 * about: an unqualified figure over partial data looks exactly like a complete
 * one.
 *
 * Absent entirely when there is nothing to compare. A first-year club is shown
 * no panel rather than a row of dashes.
 */
export async function YearOnYearPanel({
  yearOnYear,
  unit,
}: {
  yearOnYear: YearOnYear;
  unit: string;
}): Promise<React.ReactElement | null> {
  const t = await getTranslations();
  const format = await getFormatter();

  const {
    comparableMonths,
    consumed,
    previousConsumed,
    costCents,
    previousCostCents,
    meanTempC,
    previousMeanTempC,
  } = yearOnYear;

  if (comparableMonths === 0 || consumed === null || previousConsumed === null) return null;

  const quantity = (value: number): string =>
    format.number(value, { maximumFractionDigits: 1 });

  /*
   * A change against a previous period of zero has no percentage — dividing by
   * it gives Infinity, and "+∞%" is not a thing to tell somebody about their
   * pool. The figures themselves are always on screen beside it.
   */
  const change = (now: number, before: number): string | null =>
    before === 0 ? null : format.number((now - before) / before, {
      style: 'percent',
      maximumFractionDigits: 0,
      signDisplay: 'exceptZero',
    });

  const consumedChange = change(consumed, previousConsumed);

  const comparingCost = costCents !== null && previousCostCents !== null;
  const costChange = comparingCost ? change(costCents, previousCostCents) : null;

  // The implied rate each period actually paid. Only sayable when that period
  // has both its euros and its kWh, which after the guard above means cost.
  const impliedNow = comparingCost && consumed > 0 ? costCents / 100 / consumed : null;
  const impliedBefore =
    comparingCost && previousConsumed > 0 ? previousCostCents / 100 / previousConsumed : null;

  const rate = (value: number): string =>
    format.number(value, {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });

  /*
   * Did the price move? Compared as stored figures rather than as rendered
   * text, because two rates that differ in the fifth decimal place round to the
   * same four and would then be called equal by the screen alone.
   */
  const rateMoved =
    impliedNow !== null && impliedBefore !== null && impliedNow.toFixed(6) !== impliedBefore.toFixed(6);

  const degrees = (fmt: typeof format, value: number): string =>
    `${fmt.number(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`;

  return (
    <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
      <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
        {t('energy.yoy.section')}
      </h2>

      <dl className="flex flex-wrap gap-x-10 gap-y-4">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs uppercase tracking-wider text-foreground-muted">
            {t('energy.yoy.consumption')}
          </dt>
          <dd className="text-lg font-medium tabular-nums">
            {quantity(consumed)} {unit}
            {consumedChange !== null && (
              <span className="ml-2 text-sm font-normal text-foreground-muted">
                {consumedChange}
              </span>
            )}
          </dd>
          <dd className="text-xs text-foreground-muted">
            {t('energy.yoy.wasThen', { value: `${quantity(previousConsumed)} ${unit}` })}
          </dd>
        </div>

        {comparingCost && (
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs uppercase tracking-wider text-foreground-muted">
              {t('energy.yoy.cost')}
            </dt>
            <dd className="text-lg font-medium tabular-nums">
              {centsToText(costCents)} €
              {costChange !== null && (
                <span className="ml-2 text-sm font-normal text-foreground-muted">{costChange}</span>
              )}
            </dd>
            <dd className="text-xs text-foreground-muted">
              {t('energy.yoy.wasThen', { value: `${centsToText(previousCostCents)} €` })}
            </dd>
          </div>
        )}
      </dl>

      {/*
        How cold it was — slice 5.4b, POOLSE-28 AC 7.

        **Context, never a correction.** Nothing above has been adjusted for
        the weather; this sentence exists so a club reading "consumption up
        12%" can see that the year was also two degrees colder, and decide for
        itself. A weather-normalised headline would be a model with opinions
        wearing the clothes of a measurement.

        Absent unless every comparable month has a figure on both sides, and
        absent entirely with the archive switched off — which is the default.
      */}
      {meanTempC !== null && previousMeanTempC !== null && (
        <p className="text-sm text-foreground-muted">
          {meanTempC.toFixed(1) === previousMeanTempC.toFixed(1)
            ? t('energy.yoy.tempSame', { temp: degrees(format, meanTempC) })
            : t(meanTempC < previousMeanTempC ? 'energy.yoy.tempColder' : 'energy.yoy.tempWarmer', {
                temp: degrees(format, meanTempC),
                before: degrees(format, previousMeanTempC),
                difference: degrees(format, Math.abs(meanTempC - previousMeanTempC)),
              })}
        </p>
      )}

      {/*
        The sentence the panel exists for. Said only when the rate actually
        moved, and said with both rates in it, so "the bill went up because the
        tariff went up" is checkable rather than asserted.
      */}
      {rateMoved && impliedNow !== null && impliedBefore !== null && (
        <p className="text-sm">
          {t(impliedNow > impliedBefore ? 'energy.yoy.rateUp' : 'energy.yoy.rateDown', {
            before: rate(impliedBefore),
            now: rate(impliedNow),
            unit,
          })}
        </p>
      )}

      <p className="text-sm text-foreground-muted">
        {t('energy.yoy.coverage', { months: comparableMonths })}
        {!comparingCost && ` ${t('energy.yoy.costNotComparable')}`}
      </p>
    </section>
  );
}
