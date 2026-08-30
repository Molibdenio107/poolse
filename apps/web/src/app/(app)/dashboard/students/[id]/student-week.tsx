'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { WeekGrid, type WeekEntry } from '@/components/week-grid';
import { addDays, longDate, mondayOf, shortDate, today } from '@/lib/dates';
import type { CalendarSession, TimetableEntry } from '@/lib/api';
import { studentWeekAction } from '../students.actions';

/**
 * "This student's week", stepping without reloading the page — round 6.
 *
 * The stepper used to be three `<Link>`s to `?week=…`, which is the right idea
 * carried one level too far: the week genuinely belongs in the URL, but a link
 * re-runs the whole route to get it there. The student page fetches five things,
 * so stepping one week re-fetched the record, the register, the timetable and
 * the credits to change one card — and, because a navigation scrolls to the top,
 * threw away the reader's position on a long page every time. Somebody stepping
 * through four weeks looking for a class did that four times.
 *
 * So the week moves into state here and the card fetches only itself. What does
 * *not* move is the URL: `window.history.replaceState` keeps `?week=` truthful,
 * so the address bar still describes what is on screen, a refresh comes back to
 * the same week, and the link is still one you can send to a colleague. That was
 * the reason the week was in the URL to begin with and it survives intact — the
 * only thing given up is the round trip.
 *
 * **`replaceState`, not `pushState`.** Each week used to be its own history
 * entry, so browser Back stepped back a week; now it leaves the page. That is
 * the better of the two: somebody who stepped forward five weeks and wants out
 * pressed Back once rather than six times, and Back leaving a page is what Back
 * does everywhere else in this app.
 *
 * The first week is rendered on the server like everything else, so this
 * component costs nothing until somebody presses a button.
 */
export function StudentWeek({
  studentId,
  initialWeek,
  initialSessions,
  timetable,
}: {
  studentId: string;
  /** The Monday the server rendered. */
  initialWeek: string;
  initialSessions: CalendarSession[];
  /** The recurring pattern, which does not change with the week. */
  timetable: TimetableEntry[];
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();

  const [monday, setMonday] = useState(initialWeek);
  const [sessions, setSessions] = useState<CalendarSession[]>(initialSessions);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const sunday = addDays(monday, 6);

  function go(week: string): void {
    const target = mondayOf(week);
    if (target === monday) return;

    startTransition(async () => {
      const result = await studentWeekAction(studentId, target);

      /*
       * The week on screen only moves once its classes have arrived. A stepper
       * that changed the dates immediately and filled them in afterwards shows a
       * heading from one week over a grid from another, which is a wrong answer
       * rather than a slow one.
       */
      if (result === null) {
        setFailed(true);
        return;
      }

      setFailed(false);
      setSessions(result);
      setMonday(target);
      window.history.replaceState(null, '', `/dashboard/students/${studentId}?week=${target}`);
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('students.week')}
        </h2>
        <p className="text-sm text-foreground-muted">
          {t('calendar.range', { from: longDate(monday, locale), to: longDate(sunday, locale) })}
        </p>
      </div>

      {/*
        Real dates, not a recurring pattern. "When does João swim?" is answered
        by the week he is actually in — including the Tuesday the pool was shut,
        which a pattern has no way to express.

        `disabled` while a week is in flight, so two quick presses cannot leave
        the heading and the grid describing different weeks.
      */}
      <nav aria-label={t('calendar.weekNav')} className="flex flex-wrap items-center gap-2">
        <WeekButton
          label={t('calendar.previousWeek')}
          onGo={() => go(addDays(monday, -7))}
          disabled={pending}
        />
        <WeekButton label={t('calendar.thisWeek')} onGo={() => go(today())} disabled={pending} />
        <WeekButton
          label={t('calendar.nextWeek')}
          onGo={() => go(addDays(monday, 7))}
          disabled={pending}
        />
        {/*
          Visible text, not a spinner alone: "a moment" is information, and the
          buttons going grey does not say why.
        */}
        {pending && <span className="text-sm text-foreground-muted">{t('common.working')}</span>}
      </nav>

      {/*
        A failed week says so and leaves the last good one on screen. Blanking
        the grid would read as "no classes that week", which is the one thing it
        must not say when it does not know.
      */}
      {failed && <p className="text-sm text-danger">{t('students.weekFailed')}</p>}

      <WeekGrid
        entries={sessions.map((session): WeekEntry => {
          const cancelled = session.status === 'cancelled';
          return {
            key: session.id,
            weekday: session.weekday,
            startTime: session.localTime,
            durationMinutes: session.durationMinutes,
            title: session.className,
            subtitle: [
              session.poolName,
              session.lane === null ? null : t('classes.laneN', { lane: session.lane }),
              session.substituteName ?? session.instructorName,
            ]
              .filter(Boolean)
              .join(' · '),
            href: `/dashboard/classes/${session.classGroupId}`,
            cancelled,
            muted: cancelled,
            note: cancelled ? session.cancellationReason ?? t('calendar.cancelledNoReason') : null,
          };
        })}
        dayNames={Object.fromEntries(
          [0, 1, 2, 3, 4, 5, 6].map((offset) => [
            offset + 1,
            `${t(`week.${offset + 1}`)} · ${shortDate(addDays(monday, offset), locale)}`,
          ]),
        )}
        emptyLabel={t('students.noClassesThisWeek')}
      />

      {/*
        A student with a weekly pattern and no dated classes has not been left
        out of the timetable — the season simply has not been built. Saying which
        is which is the difference between a dead end and a next step, and the
        pattern below is shown so the week is not blank while somebody goes and
        presses the button.

        Not while `failed`: an empty grid then means "we do not know", and this
        would send somebody to build a season that is already there.
      */}
      {sessions.length === 0 && !failed && timetable.length > 0 && (
        <div className="flex flex-col gap-3 rounded border border-dashed border-border p-4">
          <p className="text-sm text-foreground-muted">
            {t('students.noSessionsHint')}{' '}
            <Link href="/dashboard/calendar" className="text-primary hover:underline">
              {t('calendar.title')}
            </Link>
          </p>
          <WeekGrid
            entries={timetable.map(
              (entry, index): WeekEntry => ({
                key: `${entry.classGroupId}-${entry.weekday}-${entry.startTime}-${index}`,
                weekday: entry.weekday,
                startTime: entry.startTime,
                durationMinutes: entry.durationMinutes,
                title: entry.className,
                subtitle: [
                  entry.poolName,
                  entry.lane === null ? null : t('classes.laneN', { lane: entry.lane }),
                  entry.instructorName,
                ]
                  .filter(Boolean)
                  .join(' · '),
                href: `/dashboard/classes/${entry.classGroupId}`,
                // A place on the waiting list is not a class to turn up to, so
                // it is drawn as the provisional thing it is.
                muted: entry.status === 'waiting',
              }),
            )}
            dayNames={Object.fromEntries(
              [1, 2, 3, 4, 5, 6, 7].map((day) => [day, t(`week.${day}`)]),
            )}
            emptyLabel={t('students.noClasses')}
          />
        </div>
      )}
    </section>
  );
}

/** Same shape the links had, so the row looks exactly as it did. */
function WeekButton({
  label,
  onGo,
  disabled,
}: {
  label: string;
  onGo: () => void;
  disabled: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onGo}
      disabled={disabled}
      className="rounded border border-border px-3 py-1.5 text-sm transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {label}
    </button>
  );
}
