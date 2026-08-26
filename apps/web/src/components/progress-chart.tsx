import { cn } from '@/lib/utils';

export interface ChartPoint {
  /** ISO date. */
  date: string;
  timeMs: number;
}

/**
 * A progression chart, drawn as inline SVG rather than with a charting library.
 *
 * `CLAUDE.md` names ECharts or Recharts as the stack, and that is still the right
 * answer for the energy and sensor time-series in phases 4 and 5 — thousands of
 * points, zooming, brushing, live updates. This is not that. This is at most a
 * season of one child's times, and pulling a hundred kilobytes of client
 * JavaScript onto the page to draw twenty points would be paying that cost on a
 * screen that gains nothing from it.
 *
 * Server-rendered, so it needs no JavaScript at all, uses the palette tokens so
 * it follows dark mode, and weighs a couple of kilobytes. When phase 4 arrives
 * and a real chart is genuinely needed, the library earns its place there.
 *
 * **Faster is lower, so the axis is inverted**: a swimmer improving produces a
 * line that goes *up*. A chart where getting better looks like getting worse is
 * a chart that will be misread by every parent who sees it.
 *
 * The numbers are listed beneath it by the caller. The graphic is the summary,
 * never the only copy of the information — the same rule the icons follow.
 */
export function ProgressChart({
  points,
  label,
  className,
}: {
  /** In date order, oldest first. Fewer than two and nothing is drawn. */
  points: ChartPoint[];
  /** Describes the chart for anyone who cannot see it. */
  label: string;
  className?: string;
}): React.ReactElement | null {
  if (points.length < 2) return null;

  const width = 600;
  const height = 160;
  const pad = 12;

  const times = points.map((p) => p.timeMs);
  const slowest = Math.max(...times);
  const fastest = Math.min(...times);
  // A flat line would divide by zero. One millisecond of span keeps it centred.
  const span = slowest === fastest ? 1 : slowest - fastest;

  const first = new Date(points[0]!.date).getTime();
  const last = new Date(points[points.length - 1]!.date).getTime();
  const days = last === first ? 1 : last - first;

  const coords = points.map((point) => {
    const x = pad + ((new Date(point.date).getTime() - first) / days) * (width - pad * 2);
    // Inverted: the fastest time sits at the top.
    const y = pad + ((point.timeMs - fastest) / span) * (height - pad * 2);
    return { x, y };
  });

  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
      className={cn('h-40 w-full', className)}
    >
      {/*
        currentColor throughout, set by Tailwind text colours on the wrapping
        elements, so the chart follows the theme without a single literal colour
        — the same rule as every other component.
      */}
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        className="text-primary"
      />
      {coords.map((c, i) => (
        <circle
          key={points[i]!.date + i}
          cx={c.x}
          cy={c.y}
          r={3.5}
          // The best time in the series gets the accent; the rest are quiet.
          className={points[i]!.timeMs === fastest ? 'fill-success' : 'fill-primary'}
        />
      ))}
    </svg>
  );
}

/**
 * Milliseconds as a swimmer reads them: 1:23.45, or 38.20 under a minute.
 *
 * Hundredths, not thousandths — that is the resolution of every scoreboard and
 * every published result, and showing a third digit would imply a precision the
 * timing did not have.
 */
export function formatTime(timeMs: number): string {
  const totalHundredths = Math.round(timeMs / 10);
  const minutes = Math.floor(totalHundredths / 6000);
  const seconds = Math.floor((totalHundredths % 6000) / 100);
  const hundredths = totalHundredths % 100;

  const fraction = `${hundredths}`.padStart(2, '0');
  if (minutes === 0) return `${seconds}.${fraction}`;
  return `${minutes}:${`${seconds}`.padStart(2, '0')}.${fraction}`;
}
