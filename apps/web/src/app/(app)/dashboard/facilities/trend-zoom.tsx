'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Maximize2 } from 'lucide-react';
import { TrendChart, type TrendPoint } from '@/components/trend-chart';
import { Dialog } from '@/components/ui/dialog';
import { formatStamp } from '@/lib/date-format';
import { formatReading } from '@/lib/pool-metrics';
import { cn } from '@/lib/utils';
import type { MetricSummary } from '@/lib/water-period';

export interface ZoomPoint extends TrendPoint {
  /** Outside this tank's limits, judged on the server with `excursions`. */
  outside: 'low' | 'high' | null;
  recordedBy: string | null;
}

/**
 * One metric on Tendências, opened — Rui, 12-11-2026.
 *
 * The card is the small chart and *Ver mais*. The dialog shows the period's
 * five figures and a large chart where each dot tells its own reading: hovered
 * or tapped, the nearest dot shows its value, date and time, limit judgement and
 * who recorded it. The keyboard reaches the chart once and walks the readings
 * with the arrow keys (Home / End for the ends), each one read aloud — one tab
 * stop, not eighty-six.
 *
 * No visible list (Rui's call): the readings are listed, in full, on Histórico.
 * A table only a screen reader sees keeps every value reachable without the
 * pointer, because a chart is never the only copy of the numbers.
 */
export function TrendZoom({
  label,
  unit,
  points,
  band,
  locale,
  legend,
  summary,
  period,
}: {
  label: string;
  unit: string;
  points: ZoomPoint[];
  band?: { from: number; to: number } | undefined;
  locale: string;
  legend: { typed: string; lab: string };
  summary: MetricSummary | undefined;
  /** "novembro de 2026", for the dialog's description. */
  period: string;
}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const reading = (value: number): string => formatReading(value, locale);

  return (
    <>
      <div className="relative rounded p-2 hover:bg-surface-muted">
        <TrendChart locale={locale} points={points} label={label} unit={unit} band={band} legend={legend} />
        <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-primary">
          <Maximize2 aria-hidden className="size-3.5" />
          {t('facilities.trends.more')}
        </p>
        {/* The whole card is the control; its name says which chart it opens. */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('facilities.trends.openMetric', { metric: label })}
          className="absolute inset-0 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        />
      </div>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`${label} (${unit})`}
        description={period}
        closeLabel={t('common.close')}
        className="max-w-4xl"
      >
        <div className="flex flex-col gap-5">
          {summary !== undefined && (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {(
                [
                  ['records', String(summary.count)],
                  ['min', reading(summary.min)],
                  ['average', formatReading(Math.round(summary.average * 100) / 100, locale)],
                  ['max', reading(summary.max)],
                  ['outside', String(summary.outside)],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="flex flex-col gap-0.5 rounded bg-surface-muted p-3">
                  <dt className="text-xs text-foreground-muted">{t(`facilities.trends.stat.${key}`)}</dt>
                  <dd className="text-base font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          )}

          <ZoomChart points={points} band={band} unit={unit} label={label} locale={locale} legend={legend} />

          {band !== undefined && (
            <p className="text-sm text-foreground-muted">
              {t('facilities.trends.band', { from: reading(band.from), to: reading(band.to), unit })}
            </p>
          )}

          <table className="sr-only">
            <caption>{t('facilities.trends.recordsCaption', { metric: label, period })}</caption>
            <thead>
              <tr>
                <th scope="col">{t('facilities.trends.col.when')}</th>
                <th scope="col">{t('facilities.trends.col.value')}</th>
                <th scope="col">{t('facilities.trends.col.limits')}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point, index) => (
                <tr key={`${point.at}-${index}`}>
                  <td>{formatStamp(new Date(point.at))}</td>
                  <td>{reading(point.value)}</td>
                  <td>{judgement(t, point)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Dialog>
    </>
  );
}

type T = ReturnType<typeof useTranslations>;

function judgement(t: T, point: ZoomPoint): string {
  return point.outside === null
    ? t('facilities.trends.inside')
    : t(point.outside === 'low' ? 'facilities.trends.below' : 'facilities.trends.above');
}

/**
 * The large chart, drawn in real pixels at the dialog's own width so a dot is
 * round (the small chart stretches a fixed viewBox), with the nearest reading
 * shown on hover, tap or arrow key.
 */
function ZoomChart({
  points,
  band,
  unit,
  label,
  locale,
  legend,
}: {
  points: ZoomPoint[];
  band?: { from: number; to: number } | undefined;
  unit: string;
  label: string;
  locale: string;
  legend: { typed: string; lab: string };
}): React.ReactElement | null {
  const t = useTranslations();
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const element = box.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (points.length === 0) return null;

  /*
   * The reading's box has a band of its own above the plot (Rui, 12-11-2026):
   * drawn over the plot it hid the very dots somebody was reading. It follows
   * the dot sideways, and the dashed guide runs down from it to the dot.
   */
  const tipBand = 58;
  const plot = width < 520 ? 200 : 260;
  const height = tipBand + plot;
  const padX = 14;
  const padY = 16;
  const values = points.map((point) => point.value);
  const all = band === undefined ? values : [...values, band.from, band.to];
  const low = Math.min(...all);
  const high = Math.max(...all);
  const span = high - low === 0 ? Math.max(Math.abs(high), 1) * 0.1 : high - low;
  const x = (index: number): number =>
    points.length === 1 ? width / 2 : padX + (index / (points.length - 1)) * (width - padX * 2);
  const y = (value: number): number => height - padY - ((value - low) / span) * (plot - padY * 2);

  const nearest = (clientX: number): number => {
    const left = box.current?.getBoundingClientRect().left ?? 0;
    if (points.length === 1) return 0;
    const ratio = (clientX - left - padX) / (width - padX * 2);
    return Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1))));
  };

  const shown = active === null ? undefined : points[active];
  const words = (point: ZoomPoint): string =>
    `${formatReading(point.value, locale)} ${unit} · ${formatStamp(new Date(point.at))} · ${judgement(t, point)}`;

  // The tooltip box, kept inside the chart's width.
  const tipWidth = 280;
  const tipLeft =
    shown === undefined || active === null ? 0 : Math.min(Math.max(x(active) - tipWidth / 2, 0), width - tipWidth);

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={box}
        role="group"
        tabIndex={0}
        aria-label={t('facilities.trends.chartHelp', { metric: label })}
        onPointerMove={(event) => setActive(nearest(event.clientX))}
        onPointerDown={(event) => setActive(nearest(event.clientX))}
        // A mouse leaving clears it; a finger lifting keeps the tapped reading on screen.
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') setActive(null);
        }}
        onFocus={() => setActive((was) => was ?? points.length - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={(event) => {
          const last = points.length - 1;
          const at = active ?? last;
          const next =
            event.key === 'ArrowRight'
              ? Math.min(last, at + 1)
              : event.key === 'ArrowLeft'
                ? Math.max(0, at - 1)
                : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? last
                    : null;
          if (next === null) return;
          event.preventDefault();
          setActive(next);
        }}
        className="relative w-full touch-pan-y rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        style={{ height }}
      >
        {width > 0 && (
          <svg width={width} height={height} aria-hidden className="block">
            {band !== undefined && (
              <rect
                x={padX}
                y={Math.min(y(band.from), y(band.to))}
                width={width - padX * 2}
                height={Math.abs(y(band.from) - y(band.to))}
                className="fill-primary/10"
              />
            )}
            {points.length > 1 && (
              <polyline
                points={points.map((point, index) => `${x(index)},${y(point.value)}`).join(' ')}
                fill="none"
                className="stroke-primary"
                strokeWidth={2}
                strokeLinejoin="round"
              />
            )}
            {active !== null && (
              <line
                x1={x(active)}
                x2={x(active)}
                y1={tipBand - 4}
                y2={height - padY / 2}
                className="stroke-border-strong"
                strokeDasharray="3 3"
              />
            )}
            {points.map((point, index) => {
              const r = index === active ? 6 : 4;
              // Shape, not colour alone: a lab reading is a ring, an out-of-limit one larger and red.
              return point.fromLab === true ? (
                <circle
                  key={index}
                  cx={x(index)}
                  cy={y(point.value)}
                  r={r + 1}
                  className="fill-surface stroke-primary"
                  strokeWidth={2}
                />
              ) : (
                <circle
                  key={index}
                  cx={x(index)}
                  cy={y(point.value)}
                  r={point.outside === null ? r : r + 1.5}
                  className={point.outside === null ? 'fill-primary' : 'fill-danger'}
                />
              );
            })}
          </svg>
        )}

        {shown !== undefined && active !== null && (
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 z-10 flex flex-col gap-0.5 rounded border border-border bg-surface px-3 py-1.5 text-xs shadow-card"
            style={{ left: tipLeft, width: tipWidth }}
          >
            <span className="flex items-baseline gap-2">
              <span className="text-sm font-semibold tabular-nums">
                {formatReading(shown.value, locale)} {unit}
              </span>
              <span className={cn('truncate', shown.outside !== null && 'font-medium text-danger')}>
                {judgement(t, shown)}
              </span>
            </span>
            <span className="truncate tabular-nums text-foreground-muted">
              {formatStamp(new Date(shown.at))} · {shown.fromLab === true ? legend.lab : (shown.recordedBy ?? legend.typed)}
            </span>
          </div>
        )}
      </div>

      {/* What the pointer shows, said for a screen reader as the arrow keys move. */}
      <p aria-live="polite" className="sr-only">
        {shown === undefined ? '' : words(shown)}
      </p>
      <p className="text-xs text-foreground-muted">{t('facilities.trends.chartHint')}</p>
    </div>
  );
}
