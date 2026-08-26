import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Calendar } from '@/lib/api';
import { WeekGrid, type WeekEntry } from '@/components/week-grid';
import { addDays, isDate, longDate, mondayOf, seasonOf, shortDate, today } from '@/lib/dates';
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
      action:
        calendar?.canManage === true ? (
          <CancelSession
            organizationId={calendar.organizationId}
            sessionId={session.id}
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
            <nav
              aria-label={t('calendar.weekNav')}
              className="flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2">
                <WeekLink week={addDays(monday, -7)} label={t('calendar.previousWeek')} />
                <WeekLink week={today()} label={t('calendar.thisWeek')} />
                <WeekLink week={addDays(monday, 7)} label={t('calendar.nextWeek')} />
              </div>
              <p className="text-sm text-foreground-muted">
                {t('calendar.range', {
                  from: longDate(monday, locale),
                  to: longDate(sunday, locale),
                })}
              </p>
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
      className="rounded border border-border px-3 py-1.5 text-sm transition-colors hover:border-primary/50 hover:text-primary"
    >
      {label}
    </Link>
  );
}
