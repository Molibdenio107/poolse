import { getFormatter, getTranslations } from 'next-intl/server';
import type { MonthlyConsumption } from '@/lib/api';

/**
 * Consumption by month — slice 5.2.
 *
 * **Magnitude over a fixed calendar, so vertical bars, one series.** Twelve
 * columns, one per month whatever was logged: a chart of only the months with
 * data would make a gap in the record look like continuity. An empty month is
 * a labelled gap, not a zero-height bar, because "nobody read the meter" and
 * "nothing was used" are different facts.
 *
 * HTML and CSS rather than SVG, for the reason `occupancy-bars.tsx` gives: a
 * bar whose height is a percentage needs no coordinate system, reflows on a
 * phone for free, and renders its labels as real text. `--chart-1` rather than
 * the brand teal, which fails the chroma floor and the 3:1 mark contrast on
 * white; the chart hue clears both in both themes.
 *
 * **The numbers are always in the table below.** The chart summarises; the
 * list is the record, and a reader who sees no colour gets every figure.
 * Each bar carries its figure as a `title`, which is the hover layer a static
 * page can offer without a script.
 */
export async function ConsumptionBars({
  monthly,
  unit,
  locale,
}: {
  monthly: MonthlyConsumption[];
  unit: string;
  locale: string;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const format = await getFormatter();

  const number = (value: number): string =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);

  const max = Math.max(0, ...monthly.map((m) => m.consumed ?? 0));

  // "set." rather than "2026-09": a month is named in the reader's language,
  // and the year appears only where it changes, which is once a year.
  const label = (month: string): string => {
    const [year, mm] = month.split('-');
    const date = new Date(Number(year), Number(mm) - 1, 1);
    return format.dateTime(date, 'monthShort');
  };

  return (
    <figure className="flex flex-col gap-2">
      <div
        className="grid h-40 items-end gap-1.5"
        style={{ gridTemplateColumns: `repeat(${monthly.length}, minmax(0, 1fr))` }}
        role="img"
        aria-label={t('energy.chartLabel', { unit })}
      >
        {monthly.map((m) => {
          const height = m.consumed === null || max === 0 ? 0 : (m.consumed / max) * 100;
          return (
            <div key={m.month} className="flex h-full flex-col justify-end">
              {m.consumed === null ? (
                // A labelled gap: a dashed floor the height of the axis rule.
                <div
                  className="h-0.5 rounded border-t border-dashed border-border-strong"
                  title={`${label(m.month)}: ${t('energy.noReadingThatMonth')}`}
                />
              ) : (
                <div
                  className="rounded-t bg-chart-1"
                  style={{ height: `${Math.max(height, 2)}%` }}
                  title={`${label(m.month)}: ${number(m.consumed)} ${unit}`}
                />
              )}
            </div>
          );
        })}
      </div>

      <div
        className="grid gap-1.5 text-center text-xs text-foreground-muted"
        style={{ gridTemplateColumns: `repeat(${monthly.length}, minmax(0, 1fr))` }}
      >
        {monthly.map((m) => (
          <span key={m.month} className="truncate">
            {label(m.month)}
          </span>
        ))}
      </div>

      <figcaption className="text-sm text-foreground-muted">
        {t('energy.chartCaption', { unit })}
      </figcaption>

      {/* The record, always. */}
      <table className="w-full text-sm">
        <caption className="sr-only">{t('energy.chartLabel', { unit })}</caption>
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-foreground-muted">
            <th scope="col" className="py-1 font-medium">{t('energy.month')}</th>
            <th scope="col" className="py-1 text-right font-medium">{unit}</th>
          </tr>
        </thead>
        <tbody>
          {[...monthly].reverse().map((m) => (
            <tr key={m.month} className="border-t border-border">
              <td className="py-1">
                {format.dateTime(new Date(`${m.month}-01T00:00:00`), 'month')}
              </td>
              <td className="py-1 text-right tabular-nums">
                {m.consumed === null ? '—' : number(m.consumed)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
