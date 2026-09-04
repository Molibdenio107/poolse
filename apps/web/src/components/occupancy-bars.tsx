import { getTranslations } from 'next-intl/server';
import type { Occupancy } from '@/lib/api';

/**
 * Lane-hours sold, by day of the week — POOLSE-52 on the dashboard.
 *
 * **Part-to-whole, so a stacked bar; horizontal, because the categories are
 * named days.** Two series — turmas and parcerias — against a track showing the
 * water that was available. Three questions a manager actually has, answered in
 * one picture: which days are full, how much of it is sold to organisations, and
 * how much is left.
 *
 * ---------------------------------------------------------------------------
 * HTML and CSS, not SVG. This was rebuilt, and the reason is worth keeping.
 * ---------------------------------------------------------------------------
 *
 * The first version was inline SVG on a 100-unit `viewBox` with a label rail of
 * 46 and a value rail of 92 — which leaves a plot **38 units wide in the
 * negative**. Every bar had a negative width. On top of that,
 * `preserveAspectRatio="none"` stretched the viewBox to the column, so the
 * labels were scaled about eight times horizontally and twice vertically: the
 * text came out as smears.
 *
 * Both faults are the same fault — hand-maintaining a coordinate system for a
 * chart whose bars are *percentages of a row*. A `div` with `width: 62%` needs
 * no coordinate system, cannot go negative, reflows on a phone for free, and
 * renders its labels as real text at the real size. `progress-chart.tsx` uses
 * SVG because it draws a *path* through points, which HTML genuinely cannot do;
 * this draws rectangles, which is all HTML does.
 *
 * ---------------------------------------------------------------------------
 * The colours were validated, not chosen
 * ---------------------------------------------------------------------------
 *
 * `--chart-1` and `--chart-2` rather than `--primary`: the brand teal fails a
 * categorical palette's chroma floor (0.069 — it reads grey beside a saturated
 * neighbour) and sits at 2.65:1 against white, under the 3:1 a mark needs. These
 * two clear every check on Poolse's own surfaces in both themes, with a
 * colour-blind separation of ΔE 24.7 against a target of 8.
 *
 * **And colour still is not the signal.** Both series are named in the legend,
 * and every row carries "18 de 27" as text on its right. A reader who sees no
 * colour at all gets every number.
 */
export async function OccupancyBars({
  occupancy,
  locale,
}: {
  occupancy: Occupancy;
  locale: string;
}): Promise<React.ReactElement | null> {
  const t = await getTranslations();

  const number = (value: number): string =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);

  /*
   * Only the days the club actually opens. A row of zeroes for a Sunday the pool
   * is shut is a seventh of the chart spent saying nothing — the same rule the
   * lane grid follows about not drawing a closed column.
   */
  const days = occupancy.byDay
    .map((day) => ({
      weekday: day.weekday,
      turma: Number(day.turmaLaneHours),
      parceria: Number(day.parceriaLaneHours),
      available: Number(day.availableLaneHours),
    }))
    .filter((day) => day.available > 0 || day.turma + day.parceria > 0)
    .sort((a, b) => a.weekday - b.weekday);

  if (days.length === 0) return null;

  /*
   * One scale for every row, so two days are comparable by length.
   *
   * The busiest day's *available* hours set it, not its sold hours: bars are
   * read against capacity. Guarded above zero because a club with a season but
   * no slot grid has no capacity to divide by, and every width would be NaN.
   */
  const scale = Math.max(
    ...days.map((day) => Math.max(day.available, day.turma + day.parceria)),
    0,
  );
  if (scale <= 0) return null;

  /** A share of the widest row, as a CSS width. Never over 100, never NaN. */
  const share = (value: number): string =>
    `${Math.max(0, Math.min(100, (value / scale) * 100))}%`;

  return (
    <figure className="m-0 flex flex-col gap-3">
      <figcaption className="text-sm text-foreground-muted">
        {t('occupancy.byDayChart')}
      </figcaption>

      <ul className="flex flex-col gap-2">
        {days.map((day) => {
          const sold = day.turma + day.parceria;

          return (
            <li key={day.weekday} className="flex items-center gap-3">
              <span className="w-10 shrink-0 text-sm text-foreground-muted">
                {t(`week.${day.weekday}`).slice(0, 3)}
              </span>

              {/*
                The track is the water that was available; the fills are what was
                sold. `aria-hidden` because the figures to its right say the same
                thing in words — the bar is the shape of the answer, never the
                only copy of it.
              */}
              <span
                aria-hidden
                className="relative h-4 flex-1 overflow-hidden rounded-full border border-border bg-surface-muted"
              >
                <span className="absolute inset-y-0 left-0 flex w-full">
                  <span
                    className="h-full rounded-l-full bg-chart-1"
                    style={{ width: share(day.turma) }}
                  />
                  {/*
                    A 2px surface gap between the two fills, so they never meet
                    and the boundary stays readable at a glance. Only where both
                    are present — a lone fill keeps its whole width.
                  */}
                  {day.turma > 0 && day.parceria > 0 && (
                    <span className="h-full w-0.5 shrink-0 bg-surface" />
                  )}
                  <span
                    className="h-full bg-chart-2"
                    style={{ width: share(day.parceria) }}
                  />
                </span>
              </span>

              <span className="w-28 shrink-0 text-right text-sm tabular-nums text-foreground-muted">
                {day.available > 0
                  ? t('occupancy.ofHours', {
                      sold: number(sold),
                      available: number(day.available),
                    })
                  : t('occupancy.closed')}
              </span>
            </li>
          );
        })}
      </ul>

      {/* Two series, so a legend is always present — and it names them in words. */}
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-foreground-muted">
        <Key className="bg-chart-1" label={t('occupancy.turmas')} />
        <Key className="bg-chart-2" label={t('occupancy.parcerias')} />
        <Key className="border border-border bg-surface-muted" label={t('occupancy.free')} />
      </ul>
    </figure>
  );
}

function Key({ className, label }: { className: string; label: string }): React.ReactElement {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden className={`size-3 rounded-sm ${className}`} />
      {label}
    </li>
  );
}
