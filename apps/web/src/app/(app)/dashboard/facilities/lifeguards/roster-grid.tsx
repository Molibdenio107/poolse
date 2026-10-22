'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Plus, TriangleAlert } from 'lucide-react';
import type { LifeguardDuty, RosterGap } from '@/lib/api';
import { APP_TIME_ZONE, formatDateLong, formatDayMonth, wallClockNow } from '@/lib/date-format';
import { isoWeekday } from '@/lib/dates';
import { Dialog } from '@/components/ui/dialog';
import { SelectField } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { AddDutyForm } from './add-duty';
import { DutyDialog, type DutyView } from './remove-duty';

/**
 * The week of one tank as a grid — POOLSE-96 (Rui, 22-10-2026: "as a grid…
 * scroll as little as possible").
 *
 * **Days are columns, hours are rows, and a block is placed to the minute.**
 * The rows are hourly; a duty from 08:30 to 13:15 starts half-way down the
 * 08:00 row. `hourPx` is the one scale — the blocks, the hour lines and the
 * hour a click lands on are all read from it, the calendar's lesson
 * (`lib/calendar-scale.ts`) applied to a smaller, read-mostly grid.
 *
 * **The hour fits the window** (Rui: "scroll as little as possible"). From
 * `md`, `hourPx` is what is left below the grid's top divided by the hours,
 * kept between `MIN_HOUR_PX` and `MAX_HOUR_PX`, so a 07:00–22:00 tank fits a
 * 1080p screen whole and a short day is not stretched. Below `md` it is a
 * finger's `PHONE_HOUR_PX`, and the day scrolls as a list would.
 *
 * **The hours shown are the hours the tank is open that week**, from the
 * earliest duty or gap to the latest. There is no opening-hours field on the
 * page and none is needed: the gaps *are* the open hours nobody covers, so
 * duties and gaps together cover every open minute. A week with neither is
 * closed throughout, and shows the working day so a duty can still be added.
 *
 * **A day with no duty and no gap is closed** — the rule this page has always
 * used — and is drawn greyed and said *Fechado*. Today's column is tinted.
 *
 * **Clicking** an empty hour opens *Acrescentar* for that day and hour; a gap
 * opens it with the gap's own window, so covering it is one name away; a duty
 * opens what its block cannot fit, and *Remover*. The hour cells are a mouse
 * shortcut and take no focus — the keyboard's way is *Acrescentar turno* in the
 * header, and every gap and duty is a button.
 *
 * **On a phone, one day at a time** (POOLSE-88's pattern): ‹ › move the day,
 * the hour column stays, and the other six columns are hidden by CSS — the
 * grid is rendered once.
 */

/** Height of one hour's row before the window is measured, and its bounds. */
const HOUR_PX = 28;
const MIN_HOUR_PX = 22;
const MAX_HOUR_PX = 40;
const PHONE_HOUR_PX = 40;
/** A breath kept at the bottom of the window. */
const SLACK_PX = 8;
/** A block shorter than this still has to be clickable and say who it is. */
const MIN_BLOCK_PX = 18;
/** What a fully closed week shows, so a duty can still be added to it. */
const DEFAULT_HOURS = { from: 8, to: 20 } as const;

interface Segment {
  day: string;
  /** Minutes from the day's midnight on the club's clock. */
  start: number;
  end: number;
}

/** "YYYY-MM-DDTHH:mm" on the club's clock → its day and minute. */
function wall(instant: string): { day: string; minute: number } {
  const clock = wallClockNow(APP_TIME_ZONE, new Date(instant));
  return { day: clock.slice(0, 10), minute: Number(clock.slice(11, 13)) * 60 + Number(clock.slice(14, 16)) };
}

/** An interval cut at midnight, so a duty that runs into the next day is drawn on both. */
function segments(from: string, to: string, days: readonly string[]): Segment[] {
  const a = wall(from);
  const b = wall(to);
  if (a.day === b.day) return [{ day: a.day, start: a.minute, end: b.minute }];
  const out: Segment[] = [{ day: a.day, start: a.minute, end: 24 * 60 }];
  for (const day of days) if (day > a.day && day < b.day) out.push({ day, start: 0, end: 24 * 60 });
  if (b.minute > 0) out.push({ day: b.day, start: 0, end: b.minute });
  return out.filter((one) => days.includes(one.day));
}

/** Side by side where duties overlap: lane and lane count within each overlapping cluster. */
function lanes<T extends Segment>(items: T[]): (T & { lane: number; of: number })[] {
  const sorted = [...items].sort((x, y) => x.start - y.start || x.end - y.end);
  const placed: (T & { lane: number; of: number })[] = [];
  let cluster: (T & { lane: number; of: number })[] = [];
  let clusterEnd = -1;
  const close = (): void => {
    const of = Math.max(1, ...cluster.map((one) => one.lane + 1));
    for (const one of cluster) one.of = of;
    cluster = [];
  };
  for (const item of sorted) {
    if (item.start >= clusterEnd) {
      close();
      clusterEnd = item.end;
    } else {
      clusterEnd = Math.max(clusterEnd, item.end);
    }
    const busy = new Set(cluster.filter((one) => one.end > item.start).map((one) => one.lane));
    let lane = 0;
    while (busy.has(lane)) lane += 1;
    const one = { ...item, lane, of: 1 };
    cluster.push(one);
    placed.push(one);
  }
  close();
  return placed;
}

/** A wall-clock minute as HH:mm. The end of a day is 24:00, which is what "until midnight" says. */
const hhmm = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** The same, for a `time` input, which has no 24:00. */
const inputTime = (minute: number): string => hhmm(minute % (24 * 60));

export function RosterGrid({
  days,
  today,
  facilityId,
  poolId,
  duties,
  gaps,
  canManage,
}: {
  /** Monday to Sunday, `YYYY-MM-DD`. */
  days: string[];
  today: string;
  facilityId: string;
  poolId: string;
  /** This tank's duties and gaps, this week. */
  duties: LifeguardDuty[];
  gaps: RosterGap[];
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();

  const dutySegments = useMemo(
    () => duties.flatMap((duty) => segments(duty.startsAt, duty.endsAt, days).map((one) => ({ ...one, duty }))),
    [duties, days],
  );
  const gapSegments = useMemo(
    () => gaps.flatMap((gap) => segments(gap.from, gap.to, days).map((one) => ({ ...one, gap }))),
    [gaps, days],
  );

  // The open hours of the week, rounded out to whole hours.
  const all = [...dutySegments, ...gapSegments];
  const firstHour = all.length === 0 ? DEFAULT_HOURS.from : Math.floor(Math.min(...all.map((one) => one.start)) / 60);
  const lastHour = all.length === 0 ? DEFAULT_HOURS.to : Math.ceil(Math.max(...all.map((one) => one.end)) / 60);
  const hours = Array.from({ length: Math.max(1, lastHour - firstHour) }, (_, i) => firstHour + i);
  // Measured once mounted and on every resize; the server's render uses HOUR_PX.
  const gridRef = useRef<HTMLDivElement>(null);
  const [hourPx, setHourPx] = useState(HOUR_PX);
  useLayoutEffect(() => {
    const fit = (): void => {
      const grid = gridRef.current;
      if (grid === null) return;
      if (!window.matchMedia('(min-width: 768px)').matches) {
        setHourPx(PHONE_HOUR_PX);
        return;
      }
      // Everything on the page that is not an hour row stays as it is; the rows
      // take what is left of the window. Measured from the page as drawn, so
      // the card's padding and the page's own bottom margin are counted too.
      const rows = grid.querySelector<HTMLElement>('[role=group]')?.getBoundingClientRect().height ?? 0;
      const rest = document.documentElement.scrollHeight - rows;
      const room = window.innerHeight - rest - SLACK_PX;
      setHourPx(Math.min(MAX_HOUR_PX, Math.max(MIN_HOUR_PX, Math.floor(room / hours.length))));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [hours.length]);
  const pxPerMinute = hourPx / 60;
  const height = hours.length * hourPx;
  const top = (minute: number): number => (minute - firstHour * 60) * pxPerMinute;

  // On a phone, the day shown: today if it is in this week, else Monday.
  const [phoneDay, setPhoneDay] = useState(days.includes(today) ? today : days[0]!);
  const phoneIndex = days.indexOf(phoneDay);

  const [adding, setAdding] = useState<{ day: string; from: string; to: string } | null>(null);
  const [openDuty, setOpenDuty] = useState<DutyView | null>(null);
  const closeAdding = useCallback(() => setAdding(null), []);

  const dutyTimes = (duty: LifeguardDuty): string => {
    const from = wall(duty.startsAt);
    const to = wall(duty.endsAt);
    return t('roster.dutyTimes', { from: hhmm(from.minute), to: hhmm(to.day === from.day ? to.minute : 24 * 60 + to.minute) });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 basis-64 text-sm text-foreground-muted">{t('roster.hint')}</p>
        {canManage && (
          <button
            type="button"
            onClick={() => {
              const day = days.includes(today) ? today : phoneDay;
              setAdding({ day, from: '', to: '' });
            }}
            className="inline-flex h-control shrink-0 items-center justify-center gap-2 rounded bg-primary px-4 text-control text-primary-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Plus aria-hidden className="size-4" />
            {t('roster.addDuty')}
          </button>
        )}
      </div>

      {/* The phone's day: one at a time, as Turmas and the calendar do below md. */}
      <div className="flex items-center justify-between gap-2 md:hidden">
        <button
          type="button"
          disabled={phoneIndex <= 0}
          onClick={() => setPhoneDay(days[phoneIndex - 1]!)}
          aria-label={t('roster.previousDay')}
          className="inline-flex h-control w-control items-center justify-center rounded border border-border disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <ChevronLeft aria-hidden className="size-4" />
        </button>
        <p className="text-center text-sm font-medium" aria-live="polite">
          {formatDateLong(phoneDay, locale)}
          {phoneDay === today && <span className="font-normal text-foreground-muted"> · {t('roster.today')}</span>}
        </p>
        <button
          type="button"
          disabled={phoneIndex >= days.length - 1}
          onClick={() => setPhoneDay(days[phoneIndex + 1]!)}
          aria-label={t('roster.nextDay')}
          className="inline-flex h-control w-control items-center justify-center rounded border border-border disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <ChevronRight aria-hidden className="size-4" />
        </button>
      </div>

      <div
        ref={gridRef}
        className="grid grid-cols-[3rem_minmax(0,1fr)] md:grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]"
        data-roster-grid
      >
        {/* Header row: the corner, then a weekday over its date, in words. */}
        <div aria-hidden className="border-b border-border" />
        {days.map((day) => {
          const closed = !dutySegments.some((one) => one.day === day) && !gapSegments.some((one) => one.day === day);
          return (
            <div
              key={day}
              className={cn(
                'flex flex-col items-center border-b border-l border-border px-1 pb-1.5 text-center max-md:hidden',
                day === phoneDay && 'max-md:flex',
                day === today && 'bg-primary/10',
              )}
            >
              <span className={cn('text-sm font-medium', day === today && 'text-primary')}>
                {t(`weekShort.${isoWeekday(day)}` as never)}
              </span>
              <span className="text-xs text-foreground-muted">{formatDayMonth(day, locale)}</span>
              {closed && <span className="text-xs text-foreground-muted">{t('roster.closed')}</span>}
            </div>
          );
        })}

        {/* The hours, pinned at the left on every width. */}
        <div aria-hidden className="relative" style={{ height }}>
          {hours.map((hour, i) => (
            <span
              key={hour}
              // At the top of its own row, so two labels cannot meet however short the hour.
              className="absolute right-2 pt-0.5 text-xs leading-none tabular-nums text-foreground-muted"
              style={{ top: i * hourPx }}
            >
              {hhmm(hour * 60)}
            </span>
          ))}
        </div>

        {days.map((day) => {
          const dayDuties = lanes(dutySegments.filter((one) => one.day === day));
          const dayGaps = gapSegments.filter((one) => one.day === day);
          const closed = dayDuties.length === 0 && dayGaps.length === 0;
          return (
            <div
              key={day}
              role="group"
              aria-label={formatDateLong(day, locale)}
              className={cn(
                'relative border-l border-border max-md:hidden',
                day === phoneDay && 'max-md:block',
                day === today && 'bg-primary/5',
                closed && 'bg-surface-muted',
              )}
              style={{
                height,
                // One line a hour, drawn by the column rather than by a row of elements.
                backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${hourPx - 1}px, rgb(var(--border)) ${hourPx - 1}px, rgb(var(--border)) ${hourPx}px)`,
              }}
            >
              {/* An hour cell per row: a mouse shortcut to add at that hour. */}
              {canManage &&
                hours.map((hour, i) => (
                  <div
                    key={hour}
                    aria-hidden
                    onClick={() => setAdding({ day, from: inputTime(hour * 60), to: inputTime((hour + 1) * 60) })}
                    className="absolute inset-x-0 cursor-pointer hover:bg-primary/10"
                    style={{ top: i * hourPx, height: hourPx }}
                  />
                ))}

              {closed && (
                <span className="pointer-events-none absolute inset-x-0 top-2 text-center text-xs text-foreground-muted md:hidden">
                  {t('roster.closed')}
                </span>
              )}

              {dayGaps.map((one) => {
                const label = t('roster.gap', { from: hhmm(one.start), to: hhmm(one.end) });
                const style = {
                  top: top(one.start),
                  height: Math.max(MIN_BLOCK_PX, (one.end - one.start) * pxPerMinute),
                  backgroundImage:
                    // 15 %: the warning ink stays 4.6:1 over a stripe in light mode (22 % was 4.3).
                    'repeating-linear-gradient(135deg, rgb(var(--warning) / 0.15) 0 6px, transparent 6px 12px)',
                };
                const body = (
                  <span className="flex items-start gap-1 text-xs font-medium text-warning">
                    <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
                    <span className="min-w-0 break-words">{label}</span>
                  </span>
                );
                const box =
                  'absolute inset-x-0.5 flex flex-col justify-start overflow-hidden rounded border border-dashed border-warning bg-surface px-1.5 py-0.5 text-left';
                return canManage ? (
                  <button
                    key={`gap-${one.start}`}
                    type="button"
                    aria-label={t('roster.coverGap', { gap: label })}
                    onClick={(event) => {
                      // Enter or Space has no pointer: offer the whole gap.
                      if (event.detail === 0) {
                        setAdding({ day, from: inputTime(one.start), to: inputTime(one.end) });
                        return;
                      }
                      const y = event.clientY - event.currentTarget.getBoundingClientRect().top;
                      const minute = one.start + Math.floor(y / pxPerMinute / 60) * 60;
                      const from = Math.max(one.start, Math.floor(minute / 60) * 60);
                      const to = Math.min(one.end, from + 60);
                      setAdding({ day, from: inputTime(from), to: inputTime(to) });
                    }}
                    className={cn(box, 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary')}
                    style={style}
                  >
                    {body}
                  </button>
                ) : (
                  <div key={`gap-${one.start}`} className={box} style={style}>
                    {body}
                  </div>
                );
              })}

              {dayDuties.map((one) => {
                const name = one.duty.name ?? t('roster.unknownPerson');
                const times = dutyTimes(one.duty);
                return (
                  <button
                    key={`${one.duty.id}-${one.start}`}
                    type="button"
                    aria-label={t(one.duty.licensed ? 'roster.dutyLabel' : 'roster.dutyLabelUnlicensed', {
                      name,
                      times,
                    })}
                    onClick={() =>
                      setOpenDuty({
                        id: one.duty.id,
                        name,
                        when: t('roster.dutyWhen', { day: formatDateLong(wall(one.duty.startsAt).day, locale), times }),
                        licensed: one.duty.licensed,
                        fromPeriod: one.duty.periodId !== null,
                      })
                    }
                    className={cn(
                      'absolute flex flex-col justify-start overflow-hidden rounded border border-primary/40 border-l-4 border-l-primary bg-surface px-1.5 py-0.5 text-left text-xs shadow-sm',
                      'hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
                    )}
                    style={{
                      top: top(one.start),
                      height: Math.max(MIN_BLOCK_PX, (one.end - one.start) * pxPerMinute),
                      left: `calc(${(one.lane / one.of) * 100}% + 2px)`,
                      width: `calc(${100 / one.of}% - 4px)`,
                    }}
                  >
                    <span className="flex items-start gap-1 font-medium">
                      {!one.duty.licensed && <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0 text-warning" />}
                      <span className="min-w-0 truncate">{name}</span>
                    </span>
                    <span className="block truncate tabular-nums text-foreground-muted">
                      {hhmm(one.start)}–{hhmm(one.end)}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {canManage && (
        <Dialog
          open={adding !== null}
          onClose={closeAdding}
          title={t('roster.addDuty')}
          description={adding === null ? undefined : formatDateLong(adding.day, locale)}
          closeLabel={t('common.close')}
        >
          {adding !== null && (
            <div className="flex flex-col gap-3">
              {/* The day can still change — the header's button opens on today. */}
              <SelectField
                name="rosterDay"
                label={t('roster.field.day')}
                options={days.map((day) => ({ value: day, label: formatDateLong(day, locale) }))}
                initial={adding.day}
                onValueChange={(day: string) => setAdding({ ...adding, day })}
              />
              <AddDutyForm
                // A new day is a new bound action: remount rather than post to the old one.
                key={adding.day}
                facilityId={facilityId}
                poolId={poolId}
                day={adding.day}
                initialFrom={adding.from}
                initialTo={adding.to}
                onClose={closeAdding}
              />
            </div>
          )}
        </Dialog>
      )}

      <DutyDialog duty={openDuty} canManage={canManage} onClose={() => setOpenDuty(null)} />
    </div>
  );
}
