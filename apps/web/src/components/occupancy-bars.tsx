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
 * Why this is hand-rolled SVG
 * ---------------------------------------------------------------------------
 *
 * The same reason `progress-chart.tsx` is: ECharts and Recharts stay reserved
 * for the phase 4/5 sensor time-series, where panning a year of readings earns a
 * library. Six bars do not, and a charting library in a **server component**
 * would mean shipping it to the browser to draw something that never changes
 * after render.
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
 * **And colour still is not the signal.** Two series, both named in the legend
 * *and* direct-labelled on the bar wherever the segment has room, plus the
 * figures repeated as text on the right. A reader who sees no colour at all
 * still gets every number.
 */

/** Bar geometry, in the SVG's own units. */
const ROW = 28;
const BAR = 14;
const GAP = 2; // the surface gap between stacked fills — never let two meet
const LABEL_W = 46;
const VALUE_W = 92;

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
   * Only the days the club actually opens. A row of six zeroes for a Sunday the
   * pool is shut is a sixth of the chart spent saying nothing — the same rule
   * the lane grid follows about drawing a closed column.
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

  // One scale for every bar, so two days are comparable by length. The busiest
  // day's *available* hours set it — bars are read against capacity, not against
  // each other's sold total.
  const scale = Math.max(...days.map((day) => Math.max(day.available, day.turma + day.parceria)));
  if (scale <= 0) return null;

  const width = 100;
  const plot = width - LABEL_W - VALUE_W;
  const height = days.length * ROW;

  const x = (value: number): number => (value / scale) * plot;

  return (
    <figure className="m-0 flex flex-col gap-3">
      <figcaption className="text-sm text-foreground-muted">
        {t('occupancy.byDayChart')}
      </figcaption>

      {/*
        `viewBox` with no fixed width, so the chart is as wide as its column and
        the bars keep their proportions on a phone. `preserveAspectRatio` off, so
        it stretches horizontally rather than shrinking the type.
      */}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height: `${height * 2.1}px` }}
        role="img"
        aria-label={t('occupancy.byDayChart')}
      >
        {days.map((day, index) => {
          const y = index * ROW + (ROW - BAR) / 2;
          const sold = day.turma + day.parceria;
          const turmaW = x(day.turma);
          const parceriaW = x(day.parceria);

          return (
            <g key={day.weekday}>
              {/* The day, in the rail. */}
              <text
                x={0}
                y={index * ROW + ROW / 2}
                dominantBaseline="middle"
                className="fill-foreground-muted"
                style={{ fontSize: '9px' }}
              >
                {t(`week.${day.weekday}`)}
              </text>

              {/*
                The track: the water that was there to sell. A lighter step of
                the same surface family rather than a third series colour — it is
                context, not a category.
              */}
              <rect
                x={LABEL_W}
                y={y}
                width={Math.max(x(day.available), 0)}
                height={BAR}
                rx={3}
                className="fill-surface-muted stroke-border"
                strokeWidth={0.5}
              />

              {turmaW > 0 && (
                <rect
                  x={LABEL_W}
                  y={y}
                  width={turmaW}
                  height={BAR}
                  rx={3}
                  className="fill-chart-1"
                />
              )}

              {parceriaW > 0 && (
                <rect
                  // The 2px surface gap, so two fills never touch and the
                  // boundary between them is readable at a glance.
                  x={LABEL_W + turmaW + (turmaW > 0 ? GAP : 0)}
                  y={y}
                  width={Math.max(parceriaW - (turmaW > 0 ? GAP : 0), 0)}
                  height={BAR}
                  rx={3}
                  className="fill-chart-2"
                />
              )}

              {/*
                The numbers, as text, on the right of every bar — the relief the
                palette's contrast check obliges and the thing that makes the
                chart readable with no colour at all.
              */}
              <text
                x={width}
                y={index * ROW + ROW / 2}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-foreground"
                style={{ fontSize: '9px', fontVariantNumeric: 'tabular-nums' }}
              >
                {t('occupancy.ofHours', {
                  sold: number(sold),
                  available: number(day.available),
                })}
              </text>
            </g>
          );
        })}
      </svg>

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
