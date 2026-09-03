import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  ApiError,
  apiFetch,
  type Calendar,
  type Classes,
  type Closure,
  type FacilityGrid,
} from '@/lib/api';
import { WeekGrid, type WeekEntry } from '@/components/week-grid';
import {
  addDays,
  isDate,
  isoWeekday,
  longDate,
  mediumDate,
  mondayOf,
  seasonOf,
  shortDate,
  today,
} from '@/lib/dates';
import { ScheduleBoard, type SessionControls } from '../classes/schedule-board';
import { slotKey } from '@/lib/slot-key';
import { CancelSession, GenerateSeason } from './calendar-forms';
import { PageShell } from '@/components/page-shell';

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

  /*
    Today's column, but only on the week that actually contains today — round 5.
    `mondayOf(today())` is the cheapest way to ask "is this that week", and it
    compares two ISO strings rather than two Dates, so no timezone gets involved.
  */
  const thisWeek = mondayOf(today()) === monday;
  const todayWeekday = thisWeek ? isoWeekday(today()) : undefined;
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

  /*
    The turmas, for the drag-and-drop board — round 5.

    A second request rather than widening `/calendar`, which answers a question
    about *dated sessions* and would otherwise start carrying the recurring
    pattern too. Best-effort: the board is an extra on this screen, and losing it
    must not cost the week.

    What a drop here edits is the weekly pattern, not this particular Tuesday —
    the same thing the Turmas screen edits, because the pattern is the only place
    a repeating class exists. The sessions on the grid below catch up when the
    season is regenerated.
  */
  let classes: Classes | null = null;
  if (calendar !== null) {
    try {
      classes = await apiFetch<Classes>('/class-groups');
    } catch {
      classes = null;
    }
  }

  /*
    The lane grid — POOLSE-49.

    The rows the board draws itself on, and everything sitting in them. Asked for
    per facility because slots and lanes are properties of a building, and the
    board shows one site at a time; the first site is the one it opens on, which
    is the same choice the board's own selector defaults to.

    Best-effort, like the turmas above: losing the grid must not cost the week,
    and a club with no slots yet gets an empty one that says so.
  */
  let grid: FacilityGrid | null = null;
  if (classes !== null) {
    const first = classes.facilities[0]?.id;
    if (first !== undefined) {
      grid = await apiFetch<FacilityGrid>(`/facilities/${first}/grid`).catch(() => null);
    }
  }

  /*
    The closures covering this week — round 5.

    Fetched for the year and narrowed here rather than asked for per week: the
    endpoint is a year at a time because Encerramentos draws a year, and a club
    has a few dozen closures, so filtering seven days out of them costs nothing.

    A repeating closure is a pattern, so it is projected onto the year on screen
    before being compared — the same thing the closures calendar does.
  */
  let closedDays: { weekday: number; reason: string }[] = [];
  if (calendar !== null) {
    try {
      const { closures } = await apiFetch<{ closures: Closure[] }>(
        `/closures?year=${monday.slice(0, 4)}`,
      );

      closedDays = [0, 1, 2, 3, 4, 5, 6].flatMap((offset) => {
        const date = addDays(monday, offset);
        const hit = closures.find((closure) => {
          const from = closure.repeatsAnnually
            ? `${date.slice(0, 4)}-${closure.startsOn.slice(5)}`
            : closure.startsOn;
          const to = closure.repeatsAnnually
            ? `${date.slice(0, 4)}-${closure.endsOn.slice(5)}`
            : closure.endsOn;
          return date >= from && date <= to;
        });

        return hit === undefined ? [] : [{ weekday: offset + 1, reason: hit.reason }];
      });
    } catch {
      // A closure list that will not load costs the locks, not the calendar.
      closedDays = [];
    }
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

  /*
    The two things you do to a session, rendered here and handed to the board.

    They are server-rendered because `CancelSession` needs the formatted date and
    the locale, and the board is a client component that has neither. Passing
    finished nodes keeps the board ignorant of what a cancel form is, which is
    why it can stay a grid rather than becoming the calendar's controller.
  */
  /*
    The two controls, keyed by the slot they belong to.

    Keyed by turma + weekday + time rather than by session id, because the grid
    is drawn from the weekly pattern and looks its session up. A slot with no
    session generated yet simply finds nothing here and shows no controls, which
    is honest: there is no occurrence to mark or cancel.
  */
  const controls: Record<string, SessionControls> = Object.fromEntries(
    (calendar?.sessions ?? []).map((session) => {
      const cancelled = session.status === 'cancelled';

      return [
        slotKey(session.classGroupId, session.weekday, session.localTime),
        {
          // What "move only this week" moves. The board has the pattern and
          // the week; this is the one occurrence where the two meet.
          sessionId: session.id,
          // Nothing to mark on a class that is not happening.
          mark: cancelled
            ? undefined
            : {
                href: `/dashboard/calendar/sessions/${session.id}?week=${monday}`,
                label: t('attendance.mark'),
              },
          cancel:
            calendar?.canManage === true ? (
              <CancelSession
                organizationId={calendar.organizationId}
                sessionId={session.id}
                className={session.className}
                when={`${longDate(session.localDate, locale)}, ${session.localTime}`}
                cancelled={cancelled}
                byClosure={session.byClosure}
                compact
              />
            ) : undefined,
          cancelled,
          note: cancelled
            ? (session.cancellationReason ?? t('calendar.cancelledNoReason'))
            : null,
        },
      ];
    }),
  );

  return (
    <PageShell
      title={t('calendar.title')}
      subtitle={t('calendar.subtitle')}
    >

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
              The arrows sit at the two ends of the block — round 5.

              They were beside the label in the middle, which is the arrangement
              most calendars use and was right while the label was small. Round 4
              made the label the largest thing in the row, and a `text-xl` date
              with two buttons pressed against it reads as one crowded object;
              worse, the arrows moved horizontally as the date's length changed
              between locales, so the target was never in the same place twice.

              At the ends they are fixed: previous is always hard left, next is
              always hard right, and the date has the whole middle. `justify-self`
              on a three-column grid rather than `justify-between`, so the label
              is centred in the *card* and not merely between the two buttons —
              the difference is visible the moment "Hoje" is a different width.

              "Hoje" is not an arrow and does not join them. It is a way out of a
              sequence rather than a step in one, so it sits under the row where
              it cannot be hit by somebody paging quickly.
            */}
            <nav
              aria-label={t('calendar.weekNav')}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-3"
            >
              <WeekArrow
                week={addDays(monday, -7)}
                label={t('calendar.previousWeek')}
                direction="previous"
              />

              {/*
                Always dated, and never wrapped. "Esta semana" alone cannot say
                which week once you have moved off it, which is the moment the
                label matters most — so the narrow form shortens the month rather
                than breaking across two lines.
              */}
              <p className="text-center text-lg font-semibold tracking-tight text-foreground sm:text-xl">
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
            </nav>

            <div className="flex justify-center">
              <WeekLink week={today()} label={t('calendar.today')} />
            </div>

            {classes !== null ? (
              <ScheduleBoard
                organizationId={classes.organizationId}
                groups={classes.groups}
                facilities={classes.facilities}
                closures={closedDays}
                controls={controls}
                dayNames={dayNames}
                canManage={calendar.canManage}
                weekStart={monday}
                slots={grid?.slots ?? []}
                lanes={grid?.lanes ?? []}
                pools={grid?.pools ?? []}
                bookings={grid?.bookings ?? []}
                categories={grid?.categories ?? []}
                instructors={grid?.instructors ?? []}
                partners={grid?.partners ?? []}
                levels={classes.options.levels}
              />
            ) : (
              // The turmas would not load. The week is still worth showing, and
              // the read-only grid is what this page was before the board.
              <WeekGrid
                entries={[]}
                dayNames={dayNames}
                emptyLabel={t('calendar.emptyWeek')}
                todayWeekday={todayWeekday}
              />
            )}

            {/*
              The same range again, under the grid — round 5.

              Seven columns of classes is taller than the viewport on a laptop,
              so by the time you have read Friday the heading that says which
              week you are in has scrolled off. Repeating it costs one line and
              removes a scroll back up. `aria-hidden`, because it is the same
              information twice and a screen reader should hear it once.
            */}
            <p
              aria-hidden
              className="text-center text-sm font-medium text-foreground-muted"
            >
              {t('calendar.range', {
                from: longDate(monday, locale),
                to: longDate(sunday, locale),
              })}
            </p>

            {/*
              An empty week is ambiguous on its own — the pool might be shut, or
              nobody might have built the season yet. Only the second is a
              problem, and only the operator can tell them apart, so the hint
              names both rather than guessing.
            */}
            {calendar.sessions.length === 0 && calendar.canManage && (
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
    </PageShell>
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
