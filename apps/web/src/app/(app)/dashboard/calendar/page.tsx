import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Calendar } from '@/lib/api';
import { WeekGrid, type WeekEntry } from '@/components/week-grid';
import {
  addDays,
  isDate,
  longDate,
  mediumDate,
  mondayOf,
  seasonOf,
  shortDate,
  today,
} from '@/lib/dates';
import { CancelSession, GenerateSeason } from './calendar-forms';

/**
 * The dated calendar — slices 1.5 and 1.6.
 *
 * The turma screen next door shows the weekly *pattern*: "Tuesdays at 18:00".
 * This shows what actually happens: Tuesday the 15th, at 18:00, unless the pool
 * is shut — in which case it says so and names the reason. That difference is
 * the whole of these two slices, and it is why both screens exist rather than
 * one pretending to be the other.
 *
 * A week at a time. A month grid was the obvious alternative and is worse for
 * the job: a pool runs five to fifteen classes a day, and a month cell that fits
 * three of them is a calendar you cannot read. Moving by week is one click.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  const { week } = await searchParams;

  // Whatever lands in the query string, the grid gets a Monday. Someone pasting
  // a link to a Thursday should see that Thursday's week, not a week starting
  // on Thursday.
  const anchor = isDate(week) ? week : today();
  const monday = mondayOf(anchor);
  const sunday = addDays(monday, 6);
  const season = seasonOf(today());

  let calendar: Calendar | null = null;
  let failure: string | null = null;
  let noOrganization = false;

  try {
    calendar = await apiFetch<Calendar>(`/calendar?from=${monday}&to=${sunday}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) noOrganization = true;
    else failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
  }

  // "Terça · 15 dez" — the same seven columns as the turma timetable, but
  // naming real days. The dot is what tells a reader at a glance which of the
  // two weeks they are looking at.
  const dayNames = Object.fromEntries(
    [0, 1, 2, 3, 4, 5, 6].map((offset) => [
      offset + 1,
      `${t(`week.${offset + 1}`)} · ${shortDate(addDays(monday, offset), locale)}`,
    ]),
  );

  const entries: WeekEntry[] = (calendar?.sessions ?? []).map((session): WeekEntry => {
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
        t('calendar.enrolled', { count: session.enrolled }),
      ]
        .filter(Boolean)
        .join(' · '),
      href: `/dashboard/classes/${session.classGroupId}`,
      cancelled,
      muted: cancelled,
      note: cancelled
        ? // A cancellation with no reason still has to read as a cancellation.
          session.cancellationReason ?? t('calendar.cancelledNoReason')
        : null,
      // Marking is the thing an instructor opens the calendar to do, so it sits
      // on the slot itself rather than two clicks away behind the turma. The
      // week travels with it so "back" returns to the week being worked
      // through, not to today's.
      /*
        The full roll on hover — POOLSE-15.
        
        Only for a class that is actually happening. A cancelled slot already
        says why in its note, and a panel listing the students who are not
        coming would be noise on the one screen that explains itself.
      */
      detail: cancelled
        ? undefined
        : {
            facts: [
              session.levelName === null
                ? null
                : { label: t('classes.level'), value: session.levelName },
              session.substituteName ?? session.instructorName
                ? {
                    label: t('classes.instructor'),
                    value: (session.substituteName ?? session.instructorName) as string,
                  }
                : null,
              {
                label: t('classes.when'),
                value: `${session.localDate} · ${session.localTime} · ${session.durationMinutes}′`,
              },
              session.poolName === null
                ? null
                : {
                    label: t('classes.pool'),
                    value: [
                      session.poolName,
                      session.lane === null
                        ? null
                        : t('classes.laneN', { lane: session.lane }),
                    ]
                      .filter(Boolean)
                      .join(' · '),
                  },
            ].filter((fact): fact is { label: string; value: string } => fact !== null),
            people: session.students,
            peopleEmpty: t('classes.noStudents'),
          },
      mark: cancelled
        ? undefined
        : {
            href: `/dashboard/calendar/sessions/${session.id}?week=${monday}`,
            label: t('attendance.mark'),
          },
      action:
        calendar?.canManage === true ? (
          <CancelSession
            organizationId={calendar.organizationId}
            sessionId={session.id}
            className={session.className}
            // Formatted here rather than in the form: this component has the
            // locale, and a client component would have to be handed it anyway.
            when={`${longDate(session.localDate, locale)}, ${session.localTime}`}
            cancelled={cancelled}
            byClosure={session.byClosure}
          />
        ) : undefined,
    };
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-16">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{t('calendar.title')}</h1>
          <p className="text-foreground-muted">{t('calendar.subtitle')}</p>
        </div>
      </header>

      {noOrganization && (
        <section className="rounded border border-border bg-surface p-5">
          <p>{t('account.noOrganizations')}</p>
        </section>
      )}

      {failure !== null && (
        <section className="rounded border border-danger/40 bg-danger/10 p-5">
          <p className="font-medium text-danger">{t('account.unavailable')}</p>
          <p className="mt-1 font-mono text-sm text-foreground-muted">{failure}</p>
        </section>
      )}

      {calendar !== null && (
        <>
          <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
            {/*
              Backlog round 3, story 4. The arrows now sit either side of the
              label they move, which is the arrangement everybody has learned
              from every other calendar — the old row put three buttons on the
              left and the dates on the right, so the control and the thing it
              changed were at opposite ends of the screen.

              "Hoje" is separate and stays put. It is not a step in a sequence,
              it is a way out of one, and someone eleven weeks into next term
              should not have to find it among the arrows.
            */}
            {/*
              Three columns rather than `justify-between` — POOLSE-02.
              
              The middle column is centred in the block itself, so the range sits
              in the middle of the header regardless of how wide "Hoje" is in the
              current language. With `justify-between` the label was centred only
              between the arrows, which put it left of centre on the page.
            */}
            <nav
              aria-label={t('calendar.weekNav')}
              className="grid grid-cols-[1fr_auto_1fr] items-center gap-3"
            >
              <span />

              <div className="flex items-center justify-center gap-2">
                <WeekArrow
                  week={addDays(monday, -7)}
                  label={t('calendar.previousWeek')}
                  direction="previous"
                />

                {/*
                  Always dated, and never wrapped. "Esta semana" alone cannot say
                  which week once you have moved off it, which is the moment the
                  label matters most — so the narrow form shortens the month
                  rather than breaking across two lines.
                */}
                <p className="text-center text-sm font-medium">
                  <span className="hidden sm:inline">
                    {t('calendar.range', {
                      from: longDate(monday, locale),
                      to: longDate(sunday, locale),
                    })}
                  </span>
                  <span className="whitespace-nowrap sm:hidden">
                    {t('calendar.range', {
                      from: mediumDate(monday, locale),
                      to: mediumDate(sunday, locale),
                    })}
                  </span>
                </p>

                <WeekArrow
                  week={addDays(monday, 7)}
                  label={t('calendar.nextWeek')}
                  direction="next"
                />
              </div>

              <span className="justify-self-end">
                <WeekLink week={today()} label={t('calendar.today')} />
              </span>
            </nav>

            <WeekGrid
              entries={entries}
              dayNames={dayNames}
              emptyLabel={t('calendar.emptyWeek')}
            />

            {/*
              An empty week is ambiguous on its own — the pool might be shut, or
              nobody might have built the season yet. Only the second is a
              problem, and only the operator can tell them apart, so the hint
              names both rather than guessing.
            */}
            {entries.length === 0 && calendar.canManage && (
              <p className="text-sm text-foreground-muted">{t('calendar.emptyWeekHint')}</p>
            )}
          </section>

          {calendar.canManage && (
            <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
              <div>
                <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                  {t('calendar.season')}
                </h2>
                <p className="mt-1 text-sm text-foreground-muted">
                  {t('calendar.seasonHint', {
                    from: longDate(season.from, locale),
                    to: longDate(season.to, locale),
                  })}
                </p>
              </div>

              <GenerateSeason
                organizationId={calendar.organizationId}
                from={season.from}
                to={season.to}
              />

              <Link
                href="/dashboard/calendar/closures"
                className="self-start text-sm text-primary hover:underline"
              >
                {t('calendar.manageClosures')}
              </Link>
            </section>
          )}
        </>
      )}
    </main>
  );
}

/**
 * A plain link, not a button.
 *
 * Which means every week has its own URL: bookmarkable, shareable, and workable
 * with the browser's back button. A client-side stepper would have been fewer
 * lines and none of that.
 */
function WeekLink({ week, label }: { week: string; label: string }): React.ReactElement {
  return (
    <Link
      href={`/dashboard/calendar?week=${week}`}
      className="rounded border border-border px-3 py-1.5 text-sm transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {label}
    </Link>
  );
}

/**
 * The same link, drawn as an arrow.
 *
 * The label does not disappear when the text does — it becomes the accessible
 * name. An arrow with no name is announced as "link" and leaves somebody
 * listening to the page guessing which direction they are about to travel, and
 * the story asks for these by name for exactly that reason.
 */
function WeekArrow({
  week,
  label,
  direction,
}: {
  week: string;
  label: string;
  direction: 'previous' | 'next';
}): React.ReactElement {
  const Arrow = direction === 'previous' ? ChevronLeft : ChevronRight;

  return (
    <Link
      href={`/dashboard/calendar?week=${week}`}
      aria-label={label}
      className="rounded border border-border p-1.5 transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <Arrow className="size-5" aria-hidden />
    </Link>
  );
}
