import { getFormatter, getTranslations } from 'next-intl/server';
import { cn } from '@/lib/utils';

/**
 * Twelve months, stacked by series — POOLSE-106's Energia chart.
 *
 * HTML and CSS rather than a chart library, as `ConsumptionBars` is: the bars
 * are real boxes, so the text beside them is real text and a phone gets the
 * layout for free. Drawn to the dataviz marks: a bar no wider than 24px, a 2px
 * surface gap between segments (never a stroke), a 4px rounded top and a square
 * baseline, a recessive axis, and a legend that names every series — colour is
 * never the only way to tell them apart.
 *
 * **Every month is a focusable column with a tooltip** listing its figures, on
 * hover and on keyboard focus alike, and **the figures are a table one click
 * away**: the third series' colour sits under 3:1 on a light card, and the
 * table is what makes that legal (the relief rule). A month with nothing is a
 * labelled gap, never a zero-height bar that reads as "free".
 */

export interface StackedSeries {
  key: string;
  label: string;
  /** A `bg-*` class from the chart tokens. */
  fill: string;
}

export interface StackedMonth {
  /** `YYYY-MM`. */
  month: string;
  /** Per series key; null when the month has no figure for it. */
  values: Record<string, number | null>;
}

export async function StackedMonthBars({
  months,
  series,
  formatValue,
  caption,
  emptyLabel,
}: {
  months: StackedMonth[];
  series: StackedSeries[];
  /** A figure in its unit, already in the reader's locale. */
  formatValue: (value: number) => string;
  caption: string;
  /** What a month with no figure says, in its tooltip and the table. */
  emptyLabel: string;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const format = await getFormatter();
  const monthOf = (month: string): Date => new Date(`${month}-01T12:00:00Z`);

  const totals = months.map((m) =>
    series.reduce((sum, s) => sum + (m.values[s.key] ?? 0), 0),
  );
  const max = Math.max(...totals, 0);

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="text-sm text-foreground-muted">{caption}</figcaption>

      {/* The legend: always present for two or more series, names in text ink. */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span aria-hidden className={cn('inline-block size-3 rounded-sm', s.fill)} />
            {s.label}
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-1">
        {/* The scale's one figure, recessive: the tallest month's total. */}
        <p className="text-xs text-foreground-muted">
          {max > 0 ? t('energy.dashboard.chartMax', { value: formatValue(max) }) : emptyLabel}
        </p>
        <div className="flex h-48 items-end justify-between gap-1 border-b border-border" aria-hidden={max === 0}>
          {months.map((m, index) => {
            const total = totals[index]!;
            const present = series.filter((s) => (m.values[s.key] ?? 0) > 0);
            const name = format.dateTime(monthOf(m.month), 'month');
            const summary =
              total === 0
                ? `${name}: ${emptyLabel}`
                : `${name}: ${series
                    .map((s) => `${s.label} ${m.values[s.key] === null ? '—' : formatValue(m.values[s.key]!)}`)
                    .join(', ')}`;
            return (
              <div
                key={m.month}
                tabIndex={0}
                aria-label={summary}
                className="group relative flex h-full flex-1 flex-col items-center justify-end rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {/* The tooltip — hover and keyboard focus both. */}
                <div
                  role="presentation"
                  className="pointer-events-none absolute bottom-full z-10 mb-1 hidden w-max max-w-56 rounded border border-border bg-surface p-2 text-xs shadow-sm group-hover:block group-focus-visible:block"
                >
                  <p className="font-medium">{name}</p>
                  {total === 0 ? (
                    <p className="text-foreground-muted">{emptyLabel}</p>
                  ) : (
                    series.map((s) => (
                      <p key={s.key} className="flex items-center gap-1.5 tabular-nums">
                        <span aria-hidden className={cn('inline-block size-2 rounded-sm', s.fill)} />
                        {s.label}: {m.values[s.key] === null ? '—' : formatValue(m.values[s.key]!)}
                      </p>
                    ))
                  )}
                </div>

                {total === 0 ? (
                  // A gap that says it is one, rather than a bar of nothing.
                  <span className="mb-1 text-xs text-foreground-muted">–</span>
                ) : (
                  <div
                    className="flex w-full max-w-6 flex-col-reverse gap-[2px]"
                    style={{ height: `${(total / max) * 100}%` }}
                  >
                    {present.map((s, at) => (
                      <span
                        key={s.key}
                        className={cn('block w-full', s.fill, at === present.length - 1 && 'rounded-t')}
                        style={{ flexGrow: m.values[s.key]!, flexBasis: 0, minHeight: 2 }}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex justify-between gap-1 text-[0.6875rem] text-foreground-muted" aria-hidden>
          {months.map((m) => (
            <span key={m.month} className="flex-1 text-center">
              {format.dateTime(monthOf(m.month), 'monthShort')}
            </span>
          ))}
        </div>
      </div>

      {/* The figures as a table — the relief for a series under 3:1, and a reader's own way in. */}
      <details className="group text-sm">
        <summary className="inline-flex cursor-pointer items-center gap-1 rounded text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          {t('energy.dashboard.showTable')}
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="table-stack w-full text-sm">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr className="border-b border-border text-left text-foreground-muted">
                <th scope="col" className="py-1 pr-3 font-medium">
                  {t('energy.dashboard.month')}
                </th>
                {series.map((s) => (
                  <th key={s.key} scope="col" className="py-1 pr-3 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {months.map((m) => (
                <tr key={m.month}>
                  <th scope="row" className="py-1 pr-3 text-left font-normal">
                    {format.dateTime(monthOf(m.month), 'month')}
                  </th>
                  {series.map((s) => (
                    <td key={s.key} data-label={s.label} className="py-1 pr-3 text-right tabular-nums">
                      {m.values[s.key] === null ? '—' : formatValue(m.values[s.key]!)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
