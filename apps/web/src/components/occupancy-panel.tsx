import { getLocale, getTranslations } from 'next-intl/server';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import type { Occupancy, OccupancyDayBand } from '@/lib/api';
import { formatDateRange } from '@/lib/date-format';
import { FromLink } from '@/components/from-link';
import { cn } from '@/lib/utils';

/**
 * Ocupação — a site's season, as three questions. POOLSE-93, option B
 * (Rui, 22-10-2026); the figures are POOLSE-52's and unchanged.
 *
 * The tab used to put three numbers with three different units beside a table,
 * a time-of-day split and a weekday chart, and say nowhere which answered what.
 * Now it reads top to bottom as the questions a manager has:
 *
 * 1. **How full is the site?** Two gauges, each with a sentence that says what
 *    the percentage is *of*: the water (lane-hours) and the places (swimmers).
 *    The capacity gap sits inside the second, where it applies.
 * 2. **Where is there room to sell?** The five day-and-part-of-day cells with the
 *    most free lane-hours a week, ranked by the server, closed cells never.
 * 3. **Who uses the water, and when?** A bar a weekday: turmas, parcerias and
 *    what is left, with the day's percentage at the end.
 *
 * **The figures arrive computed by Postgres** and are formatted here for the
 * locale. The one thing worked out on this side is how wide to draw a share of
 * a bar, and the season's split for the legend — proportions of two figures
 * the server sent, for drawing, never a figure of their own.
 *
 * **Colour never carries meaning alone.** Each bar ends with its percentage,
 * the legend names each colour, and every gauge and bar has an `aria-label`
 * with its numbers. Turmas and parcerias keep `--chart-1` / `--chart-2`.
 */

export async function OccupancyPanel({
  occupancy,
  facilityId,
}: {
  occupancy: Occupancy;
  /** The site, for the capacity link; null where the caller has none. */
  facilityId?: string | null;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();

  const hours = (value: string | number): string =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Number(value));
  const percent = (value: number): string =>
    new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value / 100);

  const available = Number(occupancy.total.availableLaneHours);
  const hasGrid = occupancy.laneHourOccupancy !== null && available > 0;

  return (
    <div className="flex flex-col gap-6">
      {/* 0 — which season these are. */}
      <p className="text-sm font-medium">
        {t('occupancy.seasonLine', {
          season: occupancy.seasonName,
          period: formatDateRange(occupancy.seasonStartsOn, occupancy.seasonEndsOn, locale),
        })}
      </p>

      {/* 1 — how full. */}
      <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
        <h2 className="font-medium">{t('occupancy.q1')}</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Gauge
            title={t('occupancy.water.title')}
            value={occupancy.laneHourOccupancy}
            label={(shown) => t('occupancy.water.aria', { percent: shown })}
            percent={percent}
          >
            {hasGrid ? (
              <>
                <p className="text-sm">
                  {t('occupancy.water.sentence', { percent: percent(occupancy.laneHourOccupancy!) })}
                </p>
                <p className="text-sm text-foreground-muted">
                  {t('occupancy.water.hours', {
                    sold: hours(occupancy.total.soldLaneHours),
                    available: hours(occupancy.total.availableLaneHours),
                  })}
                </p>
              </>
            ) : (
              <p className="text-sm text-foreground-muted">{t('occupancy.noGrid')}</p>
            )}
          </Gauge>

          <Gauge
            title={t('occupancy.seats.title')}
            value={occupancy.seatOccupancy}
            label={(shown) => t('occupancy.seats.aria', { percent: shown })}
            percent={percent}
          >
            {occupancy.seatOccupancy !== null ? (
              <p className="text-sm">
                {t('occupancy.seats.sentence', { percent: percent(occupancy.seatOccupancy) })}
              </p>
            ) : (
              // No lane has a capacity: the whole figure is missing, so say that
              // and where to fix it — "partial" would be the wrong word.
              <p className="flex flex-wrap items-start gap-x-2 gap-y-1 text-sm text-foreground-muted">
                <span>{t('occupancy.noCapacity')}</span>
                {facilityId !== undefined && facilityId !== null && (
                  <FromLink
                    href={`/dashboard/facilities/${facilityId}`}
                    className="rounded text-primary underline underline-offset-4 coarse:-my-3 coarse:py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    {t('occupancy.seats.define')}
                  </FromLink>
                )}
              </p>
            )}
            {/*
              The asterisk, where it applies — POOLSE-52 criterion 3. A lane
              nobody has sized is outside this percentage, and it says so here
              rather than in a block of its own the reader has to connect.
            */}
            {occupancy.seatOccupancy !== null && occupancy.lanesWithoutCapacity > 0 && (
              <p className="flex flex-wrap items-start gap-x-2 gap-y-1 text-sm">
                <AlertTriangle aria-hidden className="attention mt-0.5 size-4 shrink-0 text-warning" />
                <span>{t('occupancy.seats.partial', { count: occupancy.lanesWithoutCapacity })}</span>
                {facilityId !== undefined && facilityId !== null && (
                  <FromLink
                    href={`/dashboard/facilities/${facilityId}`}
                    className="rounded text-primary underline underline-offset-4 coarse:-my-3 coarse:py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    {t('occupancy.seats.define')}
                  </FromLink>
                )}
              </p>
            )}
          </Gauge>
        </div>
      </section>

      {/* 2 and 3, side by side on a desk and in order on a phone. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
          <h2 className="font-medium">{t('occupancy.q2')}</h2>
          {!hasGrid ? (
            <p className="text-sm text-foreground-muted">{t('occupancy.unavailable')}</p>
          ) : occupancy.mostFree.length === 0 ? (
            <p className="text-sm text-foreground-muted">{t('occupancy.free.none')}</p>
          ) : (
            <ol className="flex flex-col divide-y divide-border">
              {occupancy.mostFree.map((cell) => (
                <FreeRow key={`${cell.weekday}-${cell.band}`} cell={cell} hours={hours} percent={percent} />
              ))}
            </ol>
          )}
          {hasGrid && (
            <FromLink
              href="/dashboard/calendar"
              className="inline-flex items-center gap-1.5 self-start rounded text-sm text-primary hover:underline coarse:-my-3 coarse:py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {t('occupancy.free.openGrid')}
              <ArrowRight aria-hidden className="size-4" />
            </FromLink>
          )}
        </section>

        <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
          <h2 className="font-medium">{t('occupancy.q3')}</h2>
          {!hasGrid ? (
            <p className="text-sm text-foreground-muted">{t('occupancy.unavailable')}</p>
          ) : (
            <WeekBars occupancy={occupancy} hours={hours} percent={percent} />
          )}
        </section>
      </div>

      {/* 4 — what the figures count. */}
      <p className="text-sm text-foreground-muted">{t('occupancy.note')}</p>
    </div>
  );
}

/** A ring gauge and its words. The ring is the primary ink, its track the border. */
async function Gauge({
  title,
  value,
  label,
  percent,
  children,
}: {
  title: string;
  value: number | null;
  label: (shown: string) => string;
  percent: (value: number) => string;
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const R = 28;
  const C = 2 * Math.PI * R;
  const share = value === null ? 0 : Math.max(0, Math.min(100, value)) / 100;
  return (
    <div className="flex items-start gap-4 rounded border border-border p-4">
      {value !== null && (
        <svg
          viewBox="0 0 72 72"
          className="size-20 shrink-0"
          role="img"
          aria-label={label(percent(value))}
        >
          <circle cx="36" cy="36" r={R} fill="none" strokeWidth="8" className="stroke-border" />
          <circle
            cx="36"
            cy="36"
            r={R}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${share * C} ${C}`}
            transform="rotate(-90 36 36)"
            className="stroke-[rgb(var(--primary-ink))]"
          />
          <text
            x="36"
            y="36"
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-foreground text-[15px] font-semibold tabular-nums"
          >
            {percent(value)}
          </text>
        </svg>
      )}
      <div className="flex min-w-0 flex-col gap-1.5">
        <h3 className="font-medium">{title}</h3>
        {children}
      </div>
    </div>
  );
}

async function FreeRow({
  cell,
  hours,
  percent,
}: {
  cell: OccupancyDayBand;
  hours: (value: string | number) => string;
  percent: (value: number) => string;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5 first:pt-0 last:pb-0">
      <span className="flex flex-col">
        <span className="text-sm font-medium">
          {t('occupancy.free.slot', { day: t(`week.${cell.weekday}` as never), band: cell.band })}
        </span>
        <span className="text-sm tabular-nums text-foreground-muted">
          {t('occupancy.free.window', {
            from: cell.opensAt ?? '',
            to: cell.closesAt ?? '',
            percent: percent(cell.freePercent ?? 0),
          })}
        </span>
      </span>
      <span className="text-sm font-medium tabular-nums">
        {t('occupancy.free.perWeek', { hours: hours(cell.freeLaneHoursPerWeek) })}
      </span>
    </li>
  );
}

/** One bar a weekday — turmas, parcerias, free — and the season's legend. */
async function WeekBars({
  occupancy,
  hours,
  percent,
}: {
  occupancy: Occupancy;
  hours: (value: string | number) => string;
  percent: (value: number) => string;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const sold = Number(occupancy.total.soldLaneHours);
  // The season's split, for the legend: shares of what was sold. A lane held
  // for maintenance is occupied in POOLSE-52's figures and is neither a turma
  // nor a parceria, so it is drawn and named as the other uses rather than
  // left as a gap the percentages cannot explain.
  const turmaShare = sold > 0 ? (Number(occupancy.total.turmaLaneHours) / sold) * 100 : 0;
  const parceriaShare = sold > 0 ? (Number(occupancy.total.parceriaLaneHours) / sold) * 100 : 0;
  const otherShare = Math.max(0, 100 - turmaShare - parceriaShare);
  const hasOther = sold > 0 && otherShare >= 0.5;

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {occupancy.byDay.map((day) => {
          const available = Number(day.availableLaneHours);
          const name = t(`weekShort.${day.weekday}` as never);
          if (available <= 0) {
            return (
              <li key={day.weekday} className="grid grid-cols-[2.5rem_1fr] items-center gap-2 text-sm">
                <span className="font-medium">{name}</span>
                <span className="text-foreground-muted">{t('occupancy.closed')}</span>
              </li>
            );
          }
          // Shares of the day's own available hours, for drawing.
          const turma = (Number(day.turmaLaneHours) / available) * 100;
          const parceria = (Number(day.parceriaLaneHours) / available) * 100;
          const used = Math.min(100, (Number(day.soldLaneHours) / available) * 100);
          const other = Math.max(0, used - turma - parceria);
          return (
            <li key={day.weekday} className="grid grid-cols-[2.5rem_1fr_3rem] items-center gap-2 text-sm">
              <span className="font-medium">{name}</span>
              <span
                role="img"
                aria-label={t('occupancy.dayAria', {
                  day: t(`week.${day.weekday}` as never),
                  percent: percent(used),
                  turmas: hours(day.turmaLaneHours),
                  parcerias: hours(day.parceriaLaneHours),
                  other: hours(Math.max(0, Number(day.soldLaneHours) - Number(day.turmaLaneHours) - Number(day.parceriaLaneHours))),
                  available: hours(day.availableLaneHours),
                })}
                className="flex h-4 overflow-hidden rounded bg-surface-muted"
              >
                <span className="h-full bg-chart-1" style={{ width: `${Math.min(100, turma)}%` }} />
                <span
                  className="h-full bg-chart-2"
                  style={{ width: `${Math.max(0, Math.min(100 - turma, parceria))}%` }}
                />
                <span className="h-full bg-foreground-muted" style={{ width: `${other}%` }} />
              </span>
              <span className="text-right tabular-nums">{percent(used)}</span>
            </li>
          );
        })}
      </ul>
      {/* The legend names each colour; the bars' percentages need no colour at all. */}
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Swatch className="bg-chart-1" label={t('occupancy.legend.turmas', { percent: percent(turmaShare) })} />
        <Swatch className="bg-chart-2" label={t('occupancy.legend.parcerias', { percent: percent(parceriaShare) })} />
        {hasOther && (
          <Swatch className="bg-foreground-muted" label={t('occupancy.legend.other', { percent: percent(otherShare) })} />
        )}
        <Swatch className="bg-surface-muted ring-1 ring-inset ring-border" label={t('occupancy.legend.free')} />
      </p>
    </div>
  );
}

function Swatch({ className, label }: { className: string; label: string }): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cn('inline-block size-3 rounded-sm', className)} />
      {label}
    </span>
  );
}
