'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FromLink } from '@/components/from-link';
import { Reveal } from '@/components/ui/reveal';
import type { TodayLesson } from '@/lib/api';
import { cn } from '@/lib/utils';

const CHART_FROM = 7;
const CHART_TO = 21; // inclusive: 15 bars, the handoff's

const clock = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * *Hoje, hora a hora* — what the bars mean, said (Rui, 02-11-2026: "seems
 * pointless and not much description going on").
 *
 * Each bar is how many people are expected in lessons in that hour — a turma's
 * active enrolments, or a partnership group's headcount — counted by the same
 * statement as the rest of the *Hoje* card. A sentence above says the day's
 * total and its busiest hour; a bar is a button, and opening it lists that
 * hour's lessons with their place, instructor and number, linked to the
 * calendar. The hours gone are muted, this hour solid, the hours to come at
 * half strength, and the legend says so in words.
 */
export function HourChart({
  hours,
  nowHour,
  lessons,
  swimmers,
}: {
  hours: number[];
  nowHour: number;
  lessons: TodayLesson[];
  /** The day's people in lessons, as the *Hoje* card counts them. */
  swimmers: number;
}): React.ReactElement {
  const t = useTranslations();
  const range = Array.from({ length: CHART_TO - CHART_FROM + 1 }, (_, i) => CHART_FROM + i);
  const max = Math.max(1, ...range.map((h) => hours[h] ?? 0));
  const peakHour = range.reduce((best, h) => ((hours[h] ?? 0) > (hours[best] ?? 0) ? h : best), range[0]!);
  const peak = hours[peakHour] ?? 0;
  const [open, setOpen] = useState<number | null>(null);
  const inHour = (h: number): TodayLesson[] =>
    lessons.filter((lesson) => lesson.startMin < (h + 1) * 60 && lesson.endMin > h * 60);
  const shown = open === null ? [] : inHour(open);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        {peak === 0
          ? t('dashboard.summary.byHourNone')
          : t('dashboard.summary.byHourLine', { people: swimmers, hour: String(peakHour).padStart(2, '0'), peak })}
      </p>
      <p className="text-xs text-foreground-muted">{t('dashboard.summary.byHourHint')}</p>

      <ol aria-label={t('dashboard.summary.byHour')} className="flex h-40 items-end gap-1">
        {range.map((h) => {
          const people = hours[h] ?? 0;
          const when = h < nowHour ? 'past' : h === nowHour ? 'now' : 'next';
          const label = t('dashboard.summary.hourLine', { hour: h, people });
          return (
            <li key={h} className="flex h-full min-w-0 flex-1">
              <button
                type="button"
                aria-label={label}
                aria-pressed={open === h}
                aria-controls="hour-chart-lessons"
                onClick={() => setOpen(open === h ? null : h)}
                className={cn(
                  'flex h-full w-full flex-col items-center justify-end gap-1 rounded-sm hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
                  open === h && 'bg-surface-muted',
                )}
              >
                {people > 0 && (
                  <span aria-hidden className="text-[10px] tabular-nums text-foreground-muted">
                    {people}
                  </span>
                )}
                <span
                  aria-hidden
                  style={{ height: `${Math.max(people > 0 ? 4 : 1, (people / max) * 100)}%` }}
                  className={cn(
                    'w-full rounded-t-[2px]',
                    when === 'past' ? 'bg-foreground/15' : when === 'now' ? 'bg-[rgb(var(--primary-ink))]' : 'bg-primary/45',
                  )}
                />
                <span aria-hidden className="text-[10px] tabular-nums text-foreground-muted">
                  {String(h).padStart(2, '0')}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[2px] bg-foreground/15" />
          {t('dashboard.summary.legendPast')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[2px] bg-[rgb(var(--primary-ink))]" />
          {t('dashboard.summary.legendNow')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[2px] bg-primary/45" />
          {t('dashboard.summary.legendNext')}
        </span>
      </p>

      <Reveal open={open !== null}>
        <div id="hour-chart-lessons" className="flex flex-col gap-2 border-t border-border pt-3">
          <h4 className="text-sm font-medium">
            {t('dashboard.summary.hourLessons', { hour: String(open ?? 0).padStart(2, '0') })}
          </h4>
          {shown.length === 0 ? (
            <p className="text-sm text-foreground-muted">{t('dashboard.summary.hourEmpty')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border text-sm">
              {shown.map((lesson) => (
                <li key={lesson.sessionId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-1.5">
                  <span className="flex flex-col">
                    <span className="font-medium">
                      <span className="tabular-nums">
                        {clock(lesson.startMin)}–{clock(lesson.endMin)}
                      </span>{' '}
                      {lesson.title ?? t('dashboard.summary.untitled')}
                    </span>
                    <span className="text-foreground-muted">
                      {[lesson.place, lesson.instructor ?? t('dashboard.summary.noInstructor')]
                        .filter((part) => part !== null)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="tabular-nums text-foreground-muted">
                    {t('dashboard.summary.lessonPeople', { count: lesson.swimmers })}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <FromLink
            href="/dashboard/calendar"
            className="self-start text-sm text-primary underline-offset-4 hover:underline coarse:-my-3 coarse:py-3"
          >
            {t('dashboard.summary.openCalendar')}
          </FromLink>
        </div>
      </Reveal>
    </div>
  );
}
