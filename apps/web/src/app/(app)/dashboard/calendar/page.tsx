import { FromLink } from '@/components/from-link';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  ApiError,
  apiFetch,
  type Calendar,
  type CalendarClosure,
  type Classes,
  type Closures,
  type FacilityGrid,
} from '@/lib/api';
import { WeekGrid, type WeekEntry } from '@/components/week-grid';
import {
  addDays,
  isDate,
  isoWeekday,
  mondayOf,
  seasonOf,
  today,
} from '@/lib/dates';
import type { SessionControls } from '../classes/schedule-board';
import { CalendarWeek } from './calendar-week';
import { CalendarAgenda } from './calendar-agenda';
import { bookingKey, slotKey } from '@/lib/slot-key';
import { GenerateSeason } from './calendar-forms';
import { PageError, PageShell } from '@/components/page-shell';
import { TimetableImport } from './import/import-panel';
import { moduleIsOn } from '@/lib/modules';
import { formatDate, formatDateRange, formatDayMonth, formatDayMonthShort } from '@/lib/date-format';
import { backProp, originBack } from '@/lib/back';
import { readAttention } from '@/lib/attention';
import { addonSportAsked } from '@/lib/modules';
import { SportPending } from '../sport-pending';

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
  searchParams: Promise<{ week?: string; plan?: string; day?: string; from?: string; sport?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  const { week, plan, day, from, sport } = await searchParams;
  // POOLSE-125: another sport's calendar — what exists of it, in words.
  const other = await addonSportAsked(sport);
  if (other !== null) return <SportPending sport={other} page="calendar" from={from} />;
  const back = originBack(from);

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
  // The phone agenda's day: the one asked for if it is in this week, else today
  // if it is, else the Monday (POOLSE-88 phone views).
  const agendaDay =
    isDate(day) && day >= monday && day <= sunday
      ? day
      : today() >= monday && today() <= sunday
        ? today()
        : monday;
  const season = seasonOf(today());

  let calendar: Calendar | null = null;
  let failure: LoadFailure | null = null;
  let noOrganization = false;

  try {
    calendar = await apiFetch<Calendar>(`/calendar?from=${monday}&to=${sunday}`);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'no_organization') noOrganization = true;
    else failure = describeLoad(error);
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
  /*
    What failed to load, said above the week — October 2026 sweep. Each of
    these used to fail into an empty value, and an empty week with no pistas,
    no classes and no closed days is indistinguishable from a quiet one — or,
    for the closures, from a holiday nobody can drop a class onto.
  */
  const unread: string[] = [];
  const failedNot403 = (error: unknown): boolean =>
    !(error instanceof ApiError && error.status === 403);
  if (calendar !== null) {
    try {
      classes = await apiFetch<Classes>('/class-groups');
    } catch (error) {
      classes = null;
      if (failedNot403(error)) unread.push('calendar.unread.classes');
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
      grid = await apiFetch<FacilityGrid>(`/facilities/${first}/grid`).catch((error: unknown) => {
        if (failedNot403(error)) unread.push('calendar.unread.grid');
        return null;
      });
    }
  }

  /*
    Partnership groups with no day yet — POOLSE-117, for *Colocar aqui*. The
    office's question, so asked only for the office; best-effort, because
    losing it costs one list in a dialog, never the week.
  */
  // POOLSE-120: lessons a family answered for, for who may act on them.
  const attention = await readAttention();

  let partnerGroups: { id: string; name: string; partnerName: string }[] = [];
  const placedGroups = new Set((grid?.bookings ?? []).map((booking) => booking.partnerGroupId).filter(Boolean));
  const site = classes?.facilities[0]?.id;
  if (grid !== null && site !== undefined && calendar?.canManage === true) {
    const bookable = await apiFetch<{ partners: { name: string; groups: { id: string; name: string }[] }[] }>(
      `/facilities/${site}/partners/bookable`,
    ).catch(() => ({ partners: [] }));
    partnerGroups = bookable.partners.flatMap((partner) =>
      partner.groups
        .filter((group) => !placedGroups.has(group.id))
        .map((group) => ({ id: group.id, name: group.name, partnerName: partner.name })),
    );
  }

  /*
    The closures covering this week — round 5.

    Fetched for the year and narrowed here rather than asked for per week: the
    endpoint is a year at a time because Encerramentos draws a year, and a club
    has a few dozen closures, so filtering seven days out of them costs nothing.

    A repeating closure is a pattern, so it is projected onto the year on screen
    before being compared — the same thing the closures calendar does.
  */
  let closedDays: CalendarClosure[] = [];
  if (calendar !== null) {
    try {
      const { closures, halfDayCut } = await apiFetch<Closures>(
        `/closures?year=${monday.slice(0, 4)}`,
      );
      /*
        POOLSE-84: only the closures of the site on screen (and the holidays,
        which are every site's), each with its tank and, for a half day, the
        window it shuts. A closure at another site used to grey this one's day.
      */
      const site = classes?.facilities[0]?.id ?? null;
      const [cutHours, cutMinutes] = halfDayCut.split(':').map(Number);
      const cut = (cutHours ?? 13) * 60 + (cutMinutes ?? 0);

      closedDays = [0, 1, 2, 3, 4, 5, 6].flatMap((offset) => {
        const date = addDays(monday, offset);
        return closures
          .filter((closure) => {
            const from = closure.repeatsAnnually
              ? `${date.slice(0, 4)}-${closure.startsOn.slice(5)}`
              : closure.startsOn;
            const to = closure.repeatsAnnually
              ? `${date.slice(0, 4)}-${closure.endsOn.slice(5)}`
              : closure.endsOn;
            // An annual closure across New Year (24-12 to 02-01) wraps.
            const covers =
              closure.repeatsAnnually && from > to
                ? date >= from || date <= to
                : date >= from && date <= to;
            return (
              covers &&
              closure.blocksGeneration &&
              (closure.facilityId === null || closure.facilityId === site)
            );
          })
          .map((closure) => ({
            weekday: offset + 1,
            reason: closure.reason,
            poolId: closure.poolId,
            window:
              closure.partOfDay === null
                ? null
                : closure.partOfDay === 'morning'
                  ? { from: 0, to: cut }
                  : { from: cut, to: 24 * 60 },
          }));
      });
    } catch (error) {
      // A closure list that will not load costs the locks, not the calendar —
      // and the page says so, because the locks are what stop a drop onto a
      // closed day.
      closedDays = [];
      if (failedNot403(error)) unread.push('calendar.unread.closures');
    }
  }

  // "Seg, 16 de novembro" — the same seven columns as the turma timetable,
  // but naming real days, written out (POOLSE-107). A day only a few pistas
  // wide takes a shorter form — "Seg 16 nov.", "Seg 16", "16" — and the grid
  // chooses the widest that fits.
  const dayNames = Object.fromEntries(
    [0, 1, 2, 3, 4, 5, 6].map((offset) => [
      offset + 1,
      t('calendar.dayHeading', {
        day: t(`weekShort.${offset + 1}`),
        date: formatDayMonth(addDays(monday, offset), locale),
      }),
    ]),
  );
  const dayNamesNarrow = Object.fromEntries(
    [0, 1, 2, 3, 4, 5, 6].map((offset) => {
      const date = addDays(monday, offset);
      const day = t(`weekShort.${offset + 1}`);
      const dayNumber = String(Number(date.slice(8, 10)));
      return [
        offset + 1,
        [
          t('calendar.dayHeadingShort', { day, date: formatDayMonthShort(date, locale) }),
          t('calendar.dayHeadingShort', { day, date: dayNumber }),
          dayNumber,
        ],
      ];
    }),
  );
  // "16 a 22 de novembro de 2026" — the week in words, POOLSE-107.
  const weekInWords = formatDateRange(monday, sunday, locale);

  /*
    The two controls, keyed by the slot they belong to.

    Keyed by turma + weekday + time rather than by session id, because the grid
    is drawn from the weekly pattern and looks its session up. A slot with no
    session generated yet simply finds nothing here and shows no controls, which
    is honest: there is no occurrence to mark or cancel.

    **Data, not rendered controls** — round 6, ticket 4.1. Round 5 built one
    `CancelSession` node per session here and handed them to the grid, on the
    reasoning that only the server can format a date in the reader's locale.
    That part is still true and is why `when` is computed here. What was wrong
    was shipping the whole *form*: it rendered in place of its own trigger, which
    on this screen is a box a seventh of a column wide with `overflow-hidden` on
    it. The board now owns one dialog and this passes it the two strings it needs.
  */
  const controls: Record<string, SessionControls> = Object.fromEntries(
    (calendar?.sessions ?? []).map((session) => {
      const cancelled = session.status === 'cancelled';

      return [
        /*
          Keyed by the booking, not by the slot it happens to sit in this week.

          A session moved for one week keeps its booking and changes its day and
          hour, so a key made of turma-weekday-hour stops matching the block that
          is still drawn at the pattern's slot — and the controls vanish from
          exactly the classes somebody has been rearranging. The composite is the
          fallback for a session with no booking behind it.
        */
        session.scheduleId === null
          ? slotKey(session.classGroupId, session.weekday, session.localTime)
          : bookingKey(session.scheduleId),
        {
          // What "move only this week" moves. The board has the pattern and
          // the week; this is the one occurrence where the two meet.
          sessionId: session.id,
          /*
            Nothing to mark on a class that is not happening — and nothing to
            mark on a parceria at all, whoever runs its lessons. A partner group
            carries a `participant_count` and no people, so there is no roll to
            take: `attendance` needs a real student on every row. A partnership
            the club runs gets the plan and Cancelar aula, and stops there.
          */
          // And nothing to mark before it starts (Rui, 28-10-2026).
          mark: cancelled ||
            session.classGroupId === null ||
            calendar?.canTakeRegister !== true ||
            Date.parse(session.startsAt) > Date.now()
            ? undefined
            : {
                href: `/dashboard/calendar/sessions/${session.id}?week=${monday}`,
                label: t('attendance.mark'),
              },
          // Nothing to call off twice, and nothing for somebody who may not.
          cancel:
            calendar?.canManage === true && !cancelled
              ? {
                  className: session.className,
                  when: `${formatDate(session.localDate)}, ${session.localTime}`,
                  classGroupId: session.classGroupId ?? null,
                  date: formatDate(session.localDate),
                }
              : undefined,
          cancelled,
          byClosure: session.byClosure,
          registerTaken: session.registerTaken,
          familyAnswers: attention.sessions[session.id] ?? 0,
          standIn: session.substituteName !== null,
          note: cancelled
            ? (session.cancellationReason ?? t('calendar.cancelledNoReason'))
            : null,
        },
      ];
    }),
  );

  /*
   * The week as it actually is, not as the pattern says it should be.
   *
   * `readGrid` draws `class_schedule` — the recurring pattern — because that is
   * what a timetable is. But this screen is a *dated* week, and a class moved
   * for one week only lives on `class_session`, which the grid never reads. So
   * a one-week move was written correctly, refused correctly, and then vanished:
   * the block sprang back to the pattern's slot on the next refresh, which
   * looks exactly like a drag that did not work.
   *
   * Overlaid here rather than in `readGrid` because the sessions for this week
   * are already loaded — the controls above are built from them — and the grid
   * endpoint takes no date range at all. A booking with no session this week is
   * left where the pattern puts it, which is right: nothing has said otherwise.
   */
  const movedThisWeek = new Map(
    (calendar?.sessions ?? [])
      .filter((session) => session.scheduleId !== null)
      .map((session) => [session.scheduleId!, session]),
  );

  const bookings = (grid?.bookings ?? []).map((booking) => {
    const session = movedThisWeek.get(booking.id);
    if (session === undefined) return booking;

    return {
      ...booking,
      weekday: session.weekday,
      startTime: session.localTime,
      durationMinutes: session.durationMinutes,
      /*
       * The pattern's pistas stand when the session has none of its own — a
       * booking whose lanes were never copied onto its sessions would otherwise
       * lose them the moment this overlay touched it.
       */
      /*
       * Except a week moved by hand — October 2026. Dragged into "s/ pista"
       * with "Só esta semana", a week is deliberately in no pista; falling back
       * to the pattern drew it straight back in its old pistas, so the move was
       * saved and looked as if nothing had happened.
       */
      laneIds:
        session.laneIds.length > 0 || session.moved === true ? session.laneIds : booking.laneIds,
      /*
       * And the person actually teaching it this week.
       *
       * A stand-in lives on the session; the block was drawing the booking's
       * instructor, so recording that Bruno covers Tuesday changed the hover
       * card and left Ana's name on the block. The same reasoning as the hour:
       * this screen is a dated week, so it shows what is true that week.
       *
       * Only when there *is* a stand-in. Without one the booking's own name is
       * the better answer — it already resolves the booking's override over the
       * turma's instructor, which the session's column does not.
       */
      instructorName: session.substituteName ?? booking.instructorName,
    };
  });

  return (
    <PageShell
      back={backProp(back, t)}
      title={t('calendar.title')}
      subtitle={t('calendar.subtitle')}
      width="wide"
      /*
        Importing the wall timetable — POOLSE-57, moved to the header in round
        5, ticket 9.0.

        It sat above the grid, which put a page-level action inside the page's
        content and left it competing with the week for attention. The drop
        target is unaffected: it has always been the whole window rather than
        the button, so dragging the club's spreadsheet anywhere on the calendar
        still works from up here.
      */
      actions={
        classes?.facilities[0] === undefined ? undefined : (
          <TimetableImport
            facilityId={classes.facilities[0].id}
            canManage={calendar?.canManage ?? false}
            compact
          />
        )
      }
    >

      {noOrganization && (
        <section className="rounded border border-border bg-surface p-5">
          <p>{t('account.noOrganizations')}</p>
        </section>
      )}

      {failure !== null && (
        <PageError
          message={t(failure.key)}
          {...(failure.detail === '' ? {} : { detail: failure.detail })}
        />
      )}

      {unread.map((key) => (
        <PageError key={key} message={t(key as never)} />
      ))}

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
                Always dated. "Esta semana" alone cannot say which week once you
                have moved off it, which is the moment the label matters most.
                Written out since POOLSE-107 — "16 a 22 de novembro de 2026",
                with the month and year said once when the ends share them.
              */}
              {/* On a phone it may break onto two lines: between two 44px arrows a
                  week across two months is wider than 360px allows. */}
              <p className="text-center text-base font-semibold tracking-tight text-foreground sm:text-xl">
                <span className="sm:whitespace-nowrap">{weekInWords}</span>
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

            {/*
              On a phone, the week is a day at a time — POOLSE-88 phone views.
              Below `md` the lane grid is seven unreadable slivers, so the agenda
              stands in for it and the grid is not shown. They are two different
              components, so nothing is rendered twice: the agenda is read-only
              links, and the grid keeps every control it has on a desk.
            */}
            {calendar !== null && (
              <CalendarAgenda
                className="md:hidden"
                monday={monday}
                day={agendaDay}
                sessions={calendar.sessions}
                closures={closedDays}
              />
            )}

            <div className="hidden md:contents">
            {classes !== null ? (
              /*
                The dated week — round 6.

                Its own grid, not the turma board. Blocks are placed from their
                minutes on a pixel scale, columns are day × pista, and a drag
                costs a transform rather than a reflow. The board next door goes
                on drawing the recurring pattern, untouched.
              */
              <CalendarWeek
                organizationId={classes.organizationId}
                facilityId={classes.facilities[0]?.id ?? null}
                // Free swim is offered on the published season only — the
                // generator gives a non-turma booking that season's dates, so a
                // block placed in a draft would land in this year (POOLSE-68).
                seasonId={grid?.seasonStatus === 'published' ? (grid.seasonId ?? null) : null}
                weekStart={monday}
                dayNames={dayNames}
                dayNamesNarrow={dayNamesNarrow}
                todayWeekday={todayWeekday}
                closures={closedDays}
                /*
                  The site's own opening hours. The grid draws only the weekdays
                  the pool opens on — plus any that still carry a class, which is
                  round 5's rule and stays.
                */
                hours={classes.facilities[0]?.hours ?? []}
                slots={grid?.slots ?? []}
                lanes={grid?.lanes ?? []}
                pools={grid?.pools ?? []}
                bookings={bookings}
                levels={classes.options.levels}
                groups={classes.groups}
                controls={controls}
                canManage={calendar.canManage}
                freeSwimOn={await moduleIsOn('reception')}
                messagesOn={await moduleIsOn('messages')}
                partnerGroups={partnerGroups}
                // The dashboard's plan card links here with the lesson to open.
                openPlanFor={
                  typeof plan === 'string' && /^[0-9a-f-]{36}$/i.test(plan) ? plan : undefined
                }
              />
            ) : (
              // The turmas would not load. The week is still worth showing, and
              // the read-only grid is what this page was before the board.
              <WeekGrid
                entries={[]}
                dayNames={dayNames}
                // Not "nothing this week" when the classes did not load — the
                // error above says what happened.
                emptyLabel={unread.length > 0 ? '' : t('calendar.emptyWeek')}
                todayWeekday={todayWeekday}
              />
            )}
            </div>

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
              {weekInWords}
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
                    from: formatDate(season.from),
                    to: formatDate(season.to),
                  })}
                </p>
              </div>

              <GenerateSeason
                organizationId={calendar.organizationId}
                from={season.from}
                to={season.to}
              />

              <FromLink
                href="/dashboard/calendar/closures"
                className="self-start text-sm text-primary hover:underline"
              >
                {t('calendar.manageClosures')}
              </FromLink>
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
    <FromLink
      href={`/dashboard/calendar?week=${week}`}
      className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-border transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {label}
    </FromLink>
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
    <FromLink
      href={`/dashboard/calendar?week=${week}`}
      aria-label={label}
      className="inline-flex size-9 coarse:size-11 items-center justify-center rounded border border-border transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <Arrow className="size-5" aria-hidden />
    </FromLink>
  );
}
