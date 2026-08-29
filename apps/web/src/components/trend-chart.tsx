import { cn } from '@/lib/utils';

export interface TrendPoint {
  /** ISO instant. Only used for the accessible table and the tooltip. */
  at: string;
  value: number;
}

/**
 * One metric's movement between analyses, as inline SVG.
 *
 * The same reasoning `ProgressChart` sets out, and it applies more strongly
 * here: CLAUDE.md names ECharts or Recharts for the energy and sensor
 * time-series in phases 4 and 5 — thousands of points, zoom, brush, live feeds —
 * and this is a club's pH readings, which is a dozen points a season. Shipping a
 * charting bundle to draw twelve points would be paying a phase-5 cost on a
 * phase-4 screen. Server-rendered, no client JavaScript, a couple of kilobytes,
 * and it follows dark mode because every colour is a token.
 *
 * **The line is never the only copy of the numbers.** The caller lists them
 * underneath, and the `<title>` names the series — a chart that is the sole
 * home of a value is unreadable to anybody using a screen reader, which is the
 * same rule the icons and tooltips in this app follow.
 *
 * **The band is what makes it a water-quality chart rather than a line.** A pH
 * of 7.4 means nothing to most people; 7.4 drawn inside a shaded 7.2–7.6 is
 * immediately "fine". Callers that have no recommended range pass none and get
 * a plain line, which is honest — an invented band would be worse than no band.
 */
export function TrendChart({
  points,
  label,
  unit,
  band,
  className,
}: {
  /** Oldest first. A single point is drawn as a dot rather than hidden. */
  points: TrendPoint[];
  label: string;
  unit: string;
  /** The healthy range, if this metric has one. */
  band?: { from: number; to: number } | undefined;
  className?: string;
}): React.ReactElement | null {
  // One reading draws a dot, not nothing — round 4 follow-up.
  //
  // Hiding the chart until the second analysis meant a club that had just
  // recorded its first one saw the panel it had been promised stay empty, which
  // reads as a feature that did not work. A single point with its band around it
  // still answers "is this reading where it should be", which is most of what
  // the chart is for.
  if (points.length === 0) return null;

  const width = 480;
  const height = 120;
  const pad = 8;

  const values = points.map((point) => point.value);
  // The band is part of the extent, or a reading inside a band drawn off the top
  // of the plot would look like an excursion.
  const all = band === undefined ? values : [...values, band.from, band.to];

  const low = Math.min(...all);
  const high = Math.max(...all);
  // A flat series has zero range and would divide by zero; give it a nominal
  // spread so the line sits in the middle rather than on an edge.
  const span = high - low === 0 ? Math.max(Math.abs(high), 1) * 0.1 : high - low;

  // A lone point sits in the middle rather than at the left edge, where it would
  // read as the start of a line that failed to draw.
  const x = (index: number): number =>
    points.length === 1
      ? width / 2
      : pad + (index / (points.length - 1)) * (width - pad * 2);
  const y = (value: number): number =>
    height - pad - ((value - low) / span) * (height - pad * 2);

  const line = points.map((point, index) => `${x(index)},${y(point.value)}`).join(' ');

  return (
    <figure className={cn('flex flex-col gap-1', className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${label} (${unit})`}
        className="h-28 w-full"
        preserveAspectRatio="none"
      >
        <title>{`${label} (${unit})`}</title>

        {band !== undefined && (
          <rect
            x={pad}
            y={Math.min(y(band.from), y(band.to))}
            width={width - pad * 2}
            height={Math.abs(y(band.from) - y(band.to))}
            className="fill-primary/10"
          />
        )}

        {points.length > 1 && (
        <polyline
          points={line}
          fill="none"
          // `currentColor` through a token class, so the line is one colour in
          // light mode and another in dark without a second definition.
          className="stroke-primary"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        )}

        {points.map((point, index) => (
          <circle
            key={point.at}
            cx={x(index)}
            cy={y(point.value)}
            r={3}
            className="fill-primary"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      <figcaption className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">
          {label} <span className="text-foreground-muted">({unit})</span>
        </span>
        {/*
          The two numbers somebody actually wants off a trend: where it started
          and where it is now. Visible text, so the graphic is a summary of the
          figures rather than the only place they exist.
        */}
        <span className="text-foreground-muted">
          {values.length === 1
            ? values[0]
            : `${values[0]} → ${values[values.length - 1]}`}
        </span>
      </figcaption>
    </figure>
  );
}
