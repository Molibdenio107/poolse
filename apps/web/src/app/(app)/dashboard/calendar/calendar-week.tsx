'use client';

import { useCallback, useEffect, useState } from 'react';
import { FromLink } from '@/components/from-link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ui/toast';
import { Ban, ClipboardCheck, NotebookPen, Waves } from 'lucide-react';
import { TextField } from '@/components/ui/field';
import type {
  CalendarClosure,
  ClassGroup,
  FacilityDay,
  GridBooking,
  GridLane,
  GridSlot,
} from '@/lib/api';
import { bookingKey, slotKey } from '@/lib/slot-key';
import { startTimeOf } from '@/lib/calendar-scale';
import { slotsFor, toMinutes } from '@/lib/grid-layout';
import { Dialog } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { CalendarGrid, SEP, type CalendarLevel } from './calendar-grid';
import { StandInPicker } from './stand-in-picker';
import { CancelSessionDialog, type CancelTarget } from './calendar-forms';
import { LessonPlanPanel } from './lesson-plan-panel';
import type { SessionControls } from '../classes/schedule-board';
import {
  moveBookingAction,
  moveOccurrenceAction,
  placeSlotAction,
  createFreeSwimAction,
  bookPartnerDaysAction,
} from '../classes/classes.actions';
import { partnerClashSentence } from '@/lib/partner-days';

/**
 * What the calendar's week needs a browser for — round 6.
 *
 * The page stays a server component and keeps doing the fetching; this owns the
 * three things a grid cannot: the lesson plan sheet, the cancel confirmation,
 * and the writes a drag settles on.
 *
 * **One dialog for the whole week, asked about by id.** Round 5's cancel form
 * was rendered inside the cell it belonged to, which put a form in a box a
 * seventh of a column wide; round 6 moved it out and this keeps that shape.
 */
export function CalendarWeek({
  organizationId,
  facilityId,
  seasonId,
  weekStart,
  dayNames,
  dayNamesNarrow,
  todayWeekday,
  closures,
  hours,
  slots,
  lanes,
  pools,
  bookings,
  levels,
  groups,
  controls,
  canManage,
  openPlanFor,
  freeSwimOn = true,
  messagesOn = true,
  partnerGroups = [],
}: {
  organizationId: string;
  /** The site and season on screen — what a free-swim block is created in. */
  facilityId: string | null;
  seasonId: string | null;
  weekStart: string;
  dayNames: Record<number, string>;
  /** Shorter names for the same days, widest first, for a narrow column (POOLSE-107). */
  dayNamesNarrow?: Record<number, string[]> | undefined;
  todayWeekday?: number | undefined;
  closures: CalendarClosure[];
  hours: FacilityDay[];
  slots: GridSlot[];
  lanes: GridLane[];
  pools: { id: string; name: string }[];
  bookings: GridBooking[];
  levels: CalendarLevel[];
  groups: ClassGroup[];
  controls: Record<string, SessionControls>;
  canManage: boolean;
  /**
   * A session whose plan sheet opens on arrival — `?plan=` from the dashboard's
   * plan card (POOLSE-66 slice 3). Matched to the block drawn for it, so the
   * sheet carries the same title and facts as when opened from the hover card;
   * a session not on this week's grid opens nothing.
   */
  openPlanFor?: string | undefined;
  /** POOLSE-87 sweep: reception on — free swim is offered on an empty cell. */
  freeSwimOn?: boolean;
  /** POOLSE-87 sweep: messages on — a cancellation offers to tell the families. */
  messagesOn?: boolean;
  /**
   * Partnership groups with no day yet — POOLSE-117. *Colocar aqui* offers them
   * beside the turmas, each named with its partnership.
   */
  partnerGroups?: { id: string; name: string; partnerName: string }[];
}): React.ReactElement {
  const t = useTranslations();
  const { show } = useToast();
  const router = useRouter();

  const [planning, setPlanning] = useState<{ sessionId: string; booking: GridBooking } | null>(
    null,
  );
  const [cancelling, setCancelling] = useState<CancelTarget | null>(null);
  const [placing, setPlacing] = useState<{
    weekday: number;
    startMinutes: number;
    laneId: string;
  } | null>(null);
  const [freeSwimTitle, setFreeSwimTitle] = useState('');
  const [placeError, setPlaceError] = useState<string | null>(null);
  /** The partnership group chosen in *Colocar aqui*, and the days ticked for it. */
  const [partnerChoice, setPartnerChoice] = useState<string | null>(null);
  const [partnerDays, setPartnerDays] = useState<number[]>([]);
  const [partnerClashes, setPartnerClashes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  /** Turmas the club has created and never put on the grid. */
  const unscheduled = groups.filter((group) => group.schedules.length === 0);

  const controlsFor = useCallback(
    (booking: GridBooking): SessionControls | undefined =>
      /*
        A parceria has controls only when the club runs its lessons.
        
        POOLSE-46 settled that a school's hour takes no register and has no plan,
        and that is still the default — `managedLessons` is the partnership's own
        switch, set on its detail screen, and it is off unless somebody turns it
        on. What it grants is the plan and Cancelar aula; the register stays out
        for a reason the schema enforces rather than this file: a partner group
        has a headcount and no students to mark.

        The guard matters beyond the buttons. Widening it to *every* booking sent
        a partnership drag down the one-week path, which writes the session and
        leaves the booking where it was — so the block snapped back on the next
        refresh and the drag looked broken.

        Then the booking's own key — see `bookingKey` — with the slot composite
        as the fallback for a session with no booking behind it.
      */
      booking.classGroupId === null
        ? (booking.managedLessons ? controls[bookingKey(booking.id)] : undefined)
        : (controls[bookingKey(booking.id)] ??
          controls[slotKey(booking.classGroupId, booking.weekday, booking.startTime)]),
    [controls],
  );

  // Once, on arrival. A refresh after a save re-renders without remounting, so
  // closing the sheet keeps it closed.
  useEffect(() => {
    if (openPlanFor === undefined) return;
    const booking = bookings.find((one) => controlsFor(one)?.sessionId === openPlanFor);
    if (booking !== undefined) setPlanning({ sessionId: openPlanFor, booking });
  }, []);

  /**
   * Who is teaching this one lesson, built once and placed twice.
   *
   * The hover card wants it compact and at the top of its actions; the plan
   * sheet wants it full width and directly above Save, so it is plain that
   * pressing Save is not what records it. Same component either way — two
   * copies would be two things that drift.
   */
  const teacherFor = useCallback(
    (booking: GridBooking, compact: boolean): React.ReactNode => {
      const session = controlsFor(booking);
      if (session?.sessionId === undefined) return undefined;
      return <StandInPicker sessionId={session.sessionId} compact={compact} />;
    },
    [controlsFor],
  );

  /**
   * Take the register, Cancel, and the way into the plan.
   *
   * One row, built once and placed twice — the hover card takes all of it, the
   * plan sheet takes it without the plan button, since offering a way into the
   * sheet you are already reading is a control that does nothing.
   *
   * The teacher picker is deliberately *not* in here. It goes above Save in the
   * sheet and at the top of the card, so it is `teacherFor`'s and the two places
   * compose them in the order each one wants.
   */
  const sessionButtons = useCallback(
    (booking: GridBooking, withPlan: boolean): React.ReactNode => {
      const session = controlsFor(booking);
      if (session === undefined) return undefined;
      return (
          <div className="flex flex-wrap items-center gap-2">
            {/*
              The way into the plan, and the only way.

              It used to be a click on the block itself, which put the sheet in
              the way of the gesture the block is actually for: a block on this
              grid is a thing you drag, and every drag ends with a click the
              browser fires underneath it. Guarding that with a timer worked and
              still left the plan one mis-click away from opening mid-move.
              Here it sits beside Take the register and Cancel, which is where
              somebody already looks for what they can do with a class.
            */}
            {withPlan && session.sessionId !== undefined && (
              <button
                type="button"
                onClick={() =>
                  setPlanning({ sessionId: session.sessionId!, booking })
                }
                className="inline-flex h-control items-center justify-center px-4 text-control gap-1.5 rounded border border-primary/40 font-medium text-primary hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
              >
                <NotebookPen className="size-4" aria-hidden="true" />
                {t('calendar.plan.title')}
              </button>
            )}

            {session.mark !== undefined && (
              <FromLink
                href={session.mark.href}
                className="inline-flex h-control items-center justify-center px-4 text-control gap-1.5 rounded border border-primary/40 font-medium text-primary hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
              >
                <ClipboardCheck className="size-4" aria-hidden="true" />
                {session.mark.label}
              </FromLink>
            )}

            {session.cancel !== undefined && session.sessionId !== undefined && (
              <button
                type="button"
                onClick={() =>
                  setCancelling({
                    sessionId: session.sessionId!,
                    className: session.cancel!.className,
                    when: session.cancel!.when,
                    classGroupId: session.cancel!.classGroupId ?? null,
                    date: session.cancel!.date ?? '',
                  })
                }
                className="inline-flex h-control items-center justify-center px-4 text-control gap-1.5 rounded border border-border-strong hover:border-danger hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
              >
                <Ban className="size-4" aria-hidden="true" />
                {t('calendar.cancel')}
              </button>
            )}
        </div>
      );
    },
    [controlsFor, t],
  );

  /*
   * The hover card's contents.
   *
   * Built here rather than in the grid because the two actions are a link and a
   * client component this screen owns, and describing them as data would mean
   * the grid knowing what a register and a cancellation are.
   */
  const renderDetail = useCallback(
    (booking: GridBooking) => {
      const session = controlsFor(booking);

      const facts = [
        // "Pistas ocupadas: 4", not "Pista: 4" — the number is a count of lanes,
        // and the old label read as the name of a single one.
        { label: t('calendar.lanesOccupied'), value: String(booking.laneIds.length) },
        {
          label: t('calendar.time'),
          value: `${booking.startTime.slice(0, 5)} · ${booking.durationMinutes} min`,
        },
      ];
      if (booking.subtitle !== null) {
        facts.unshift({ label: t('classes.level'), value: booking.subtitle });
      }
      if (booking.instructorName !== null) {
        facts.push({
          // "Professor desta aula" when somebody is covering, so a stand-in
          // reads as this week's arrangement rather than as a new instructor.
          label: session?.standIn === true ? t('calendar.standIn.label') : t('roles.instructor'),
          value: booking.instructorName,
        });
      }
      /*
       * Visible text, not a tooltip.
       *
       * A taken register is the reason this class will refuse to be moved, and
       * anything the operator needs is on the card rather than behind a hover
       * inside a hover.
       */
      if (session?.registerTaken === true) {
        facts.push({ label: t('calendar.registerLabel'), value: t('calendar.registerTaken') });
      }

      const actions =
        session === undefined ? undefined : (
          <div className="flex flex-col gap-2">
            {/*
              Who is teaching this one lesson. In the card and in the plan sheet,
              because both are places somebody arrives at a class from — and it
              is one component, so the two cannot drift. The sheet puts it above
              its Save button, which is why it is built by `teacherFor` rather
              than inline here.
            */}
            {teacherFor(booking, true)}

            {sessionButtons(booking, true)}
          </div>
        );

      return {
        title: booking.name,
        detail: { facts, people: [], peopleEmpty: t('classes.nobodyEnrolled') },
        ...(actions === undefined ? {} : { actions }),
      };
    },
    [controlsFor, sessionButtons, teacherFor, t],
  );

  /*
   * A click on empty space: put a turma here.
   *
   * **It places an existing turma rather than opening the new-turma form.** That
   * form deliberately has no day and time on it — a turma with no days is a
   * valid half-finished thing, and asking for the pattern alongside the name and
   * the level makes the first step feel like the whole job. So sending the day
   * and time to it would have sent them nowhere: the fields are not there to
   * receive them. What an operator pointing at an empty Tuesday actually means
   * is "this class goes here", and the club's unscheduled turmas are the answer.
   *
   * A brand-new turma is still one link away, and comes back to the grid to be
   * placed once it has a name.
   */
  const onCreate = useCallback(
    (weekday: number, laneId: string, startMinutes: number) => {
      setPlaceError(null);
      setFreeSwimTitle(t('calendar.subject.free_swim'));
      setPartnerChoice(null);
      setPartnerDays([weekday]);
      setPartnerClashes([]);
      setPlacing({ weekday, startMinutes, laneId });
    },
    [t],
  );

  /*
   * How long the placed class runs.
   *
   * The slot under the click, when the grid has one — its length is what the
   * club decided a lesson is. Otherwise the 45 minutes the board falls back to,
   * which is the commonest pitch in the seed data and is editable afterwards.
   */
  const durationAt = useCallback(
    (weekday: number, startMinutes: number): number => {
      const covering = slotsFor(slots, weekday).find(
        (slot) =>
          toMinutes(slot.startTime) <= startMinutes && toMinutes(slot.endTime) > startMinutes,
      );
      if (covering === undefined) return 45;
      return toMinutes(covering.endTime) - toMinutes(covering.startTime);
    },
    [slots],
  );

  async function place(groupId: string): Promise<void> {
    if (placing === null) return;
    setBusy(true);

    const startTime = startTimeOf(placing.startMinutes);
    const result = await placeSlotAction(
      organizationId,
      groupId,
      placing.weekday,
      startTime,
      durationAt(placing.weekday, placing.startMinutes),
    );

    setBusy(false);
    if (!result.ok) {
      setPlaceError(result.errorKey);
      return;
    }
    setPlacing(null);
    if (result.lessonClash) show('warning', t('grid.lessonsClash'));
    router.refresh();
  }

  /**
   * A partnership group on the clicked day and any others ticked — POOLSE-117.
   * The same hour, length and lane as the click; all or nothing, with every
   * refused day said in words.
   */
  async function placePartner(): Promise<void> {
    if (placing === null || partnerChoice === null || partnerDays.length === 0) return;
    setBusy(true);
    const startTime = startTimeOf(placing.startMinutes).slice(0, 5);
    const result = await bookPartnerDaysAction(organizationId, partnerChoice, {
      weekdays: partnerDays,
      startTime,
      durationMinutes: durationAt(placing.weekday, placing.startMinutes),
      laneIds: [placing.laneId],
    });
    setBusy(false);
    if (!result.ok) {
      setPartnerClashes(
        result.clashes === undefined || result.clashes.length === 0
          ? [t(result.errorKey)]
          : result.clashes.map((clash) => partnerClashSentence(t, clash, startTime)),
      );
      return;
    }
    setPlacing(null);
    if (result.lessonClash) show('warning', t('grid.lessonsClash'));
    router.refresh();
  }

  /** The weekdays the site opens, so a closed day is never offered to tick. */
  const openDays = hours.filter((day) => day.available).map((day) => day.weekday);

  /**
   * This lane, at this hour, every week, for the public — POOLSE-68 slice 2.
   *
   * Unlike a turma, the lane is known: it is the one that was clicked, so the
   * block lands where the operator pointed. Wider is a drag of its edge.
   */
  async function placeFreeSwim(): Promise<void> {
    if (placing === null || facilityId === null || seasonId === null) return;
    setBusy(true);
    const result = await createFreeSwimAction(organizationId, {
      facilityId,
      seasonId,
      title: freeSwimTitle,
      weekday: placing.weekday,
      startTime: startTimeOf(placing.startMinutes).slice(0, 5),
      durationMinutes: durationAt(placing.weekday, placing.startMinutes),
      laneIds: [placing.laneId],
    });
    setBusy(false);
    if (!result.ok) {
      // The calendar's refusals are toasts, said once, with the lane and holder.
      show('danger', result.detail === undefined ? t(result.errorKey) : `${t(result.errorKey)} — ${result.detail}`);
      return;
    }
    setPlacing(null);
    if (result.lessonClash) show('warning', t('grid.lessonsClash'));
    router.refresh();
  }

  /**
   * A settled move, written in the background.
   *
   * Returns the failure key so the grid can put the block back and say why; the
   * grid has already drawn the move, so nothing here has to touch the layout.
   * `router.refresh()` on success rather than a refetch of the grid: the block
   * is already where it belongs, and this quietly brings the rest of the page —
   * the counts, the staffing warnings — back into agreement.
   */
  const onMove = useCallback(
    async (
      booking: GridBooking,
      to: {
        weekday: number;
        laneIds: string[];
        startMinutes: number;
        durationMinutes: number;
      },
      scope: 'series' | 'week',
    ): Promise<string | null> => {
      const startTime = startTimeOf(to.startMinutes);
      const session = controlsFor(booking);

      if (scope === 'week' && session?.sessionId !== undefined) {
        /*
         * The day the block landed on, not the Monday it was dragged inside.
         *
         * This used to send `weekStart` — so "só esta semana" on a class dragged
         * from Tuesday to Wednesday moved it to *Monday* at the new hour, and on
         * a busy Monday that came back as "essa pista já está ocupada" against a
         * lane nobody had touched. `to.weekday` is ISO, Monday 1, and the week
         * starts on the Monday, so the offset is one subtraction.
         */
        const day = new Date(`${weekStart}T00:00:00Z`);
        day.setUTCDate(day.getUTCDate() + to.weekday - 1);

        const moved = await moveOccurrenceAction(
          organizationId,
          session.sessionId,
          day.toISOString().slice(0, 10),
          startTime,
          // The pistas the block landed on. One week can now differ from the
          // pattern, so the lane change no longer has to be thrown away.
          to.laneIds,
          // And its length, for the same reason — round 8. Dragging the bottom
          // edge and answering "só esta semana" used to write the hour and drop
          // the length, so the block sprang back to its old height.
          to.durationMinutes,
        );
        if (!moved.ok) {
          return moved.detail === undefined || moved.detail === ''
            ? moved.errorKey
            : `${moved.errorKey}${SEP}${moved.detail}`;
        }
        router.refresh();
        return null;
      }

      /*
       * The day the block was dragged *from*, in the week on screen — round 8.
       *
       * A series move re-times the weeks still sitting where the pattern put
       * them, and deliberately leaves alone the ones somebody moved by hand.
       * Without naming this week, a block that had been moved by hand earlier
       * stayed exactly where it was picked up: the move landed, three later
       * weeks followed, and the one on screen did not — which looks precisely
       * like a feature that does nothing.
       */
      const draggedFrom = new Date(`${weekStart}T00:00:00Z`);
      draggedFrom.setUTCDate(draggedFrom.getUTCDate() + booking.weekday - 1);

      const result = await moveBookingAction(organizationId, booking.id, {
        weekday: to.weekday,
        slotId: null,
        startTime,
        laneIds: to.laneIds,
        durationMinutes: to.durationMinutes,
        fromDate: draggedFrom.toISOString().slice(0, 10),
      });
      /*
       * The server's own sentence, where it sent one.
       *
       * A refusal here can come from several rules — a lane already taken, an
       * instructor over their concurrent-group limit, the pool's capacity — and
       * they are different problems with different answers. Returning only the
       * generic key made every one of them read as "it did not work", which is
       * the shape of report that cannot be acted on.
       */
      if (!result.ok) {
        return result.detail === undefined || result.detail === ''
          ? result.errorKey
          : `${result.errorKey}${SEP}${result.detail}`;
      }

      /*
       * Weeks that could not follow the pattern — round 8.
       *
       * A series move re-times the sessions still sitting where the pattern put
       * them. One whose new hour is already taken that week stays where it is,
       * which is a success with a caveat rather than a refusal — so it is said
       * as a warning here rather than returned as a failure, which would send
       * the block home from a move that did in fact happen.
       */
      if (result.lessonClash) show('warning', t('grid.lessonsClash'));
      if (result.weeksBlocked > 0) {
        show('warning', t('grid.weeksBlocked', { count: result.weeksBlocked }));
      } else if (result.weeksKept > 0) {
        /*
         * Weeks somebody had moved by hand, which stay by design.
         *
         * Said out loud because its symptom is identical to a failure — some
         * blocks in other weeks do not move — and silence is what made this read
         * as broken. Only when nothing was blocked, so one message is shown
         * rather than two about the same move.
         */
        show('warning', t('grid.weeksKept', { count: result.weeksKept }));
      }
      router.refresh();
      return null;
    },
    [controlsFor, organizationId, router, weekStart, show, t],
  );

  return (
    <>
      <CalendarGrid
        weekStart={weekStart}
        dayNames={dayNames}
        dayNamesNarrow={dayNamesNarrow}
        todayWeekday={todayWeekday}
        closures={closures}
        hours={hours}
        slots={slots}
        lanes={lanes}
        pools={pools}
        bookings={bookings}
        levels={levels}
        canManage={canManage}
        renderDetail={renderDetail}
        onCreate={onCreate}
        onMove={onMove}
      />

      {planning !== null && (
        <LessonPlanPanel
          sessionId={planning.sessionId}
          onClose={() => setPlanning(null)}
          /*
            The class the plan is for, so the sheet is not a text box floating
            free of what it belongs to. The same title and the same facts the
            hover card shows, built by the same function — one definition, two
            places it can be reached from.
          */
          className={renderDetail(planning.booking).title}
          facts={renderDetail(planning.booking).detail.facts}
          {...(teacherFor(planning.booking, false) === undefined
            ? {}
            : { teacher: teacherFor(planning.booking, false) })}
          /*
            The button row without the teacher and without the plan button.

            `renderDetail`'s actions are the card's — they lead with the picker,
            which the sheet already shows above Save, so passing them here put a
            second identical dropdown at the bottom of the same panel. And a way
            into the sheet you are reading is a control that does nothing.
          */
          {...(sessionButtons(planning.booking, false) === undefined
            ? {}
            : { actions: sessionButtons(planning.booking, false) })}
        />
      )}

      <CancelSessionDialog
        organizationId={organizationId}
        target={cancelling}
        onClose={() => setCancelling(null)}
        messagesOn={messagesOn}
      />

      <Dialog
        open={placing !== null}
        onClose={() => setPlacing(null)}
        title={t('calendar.placeHere')}
        {...(placing === null
          ? {}
          : {
              description: `${dayNames[placing.weekday] ?? ''} · ${startTimeOf(
                placing.startMinutes,
              ).slice(0, 5)}`,
            })}
        closeLabel={t('common.close')}
      >
        {placeError !== null && <p className="mb-3 text-sm text-danger">{t(placeError)}</p>}

        {unscheduled.length === 0 && partnerGroups.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t('calendar.nothingToPlace')}</p>
        ) : unscheduled.length === 0 ? null : (
          <ul className="flex max-h-64 flex-col divide-y divide-border overflow-y-auto">
            {unscheduled.map((group) => (
              <li key={group.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void place(group.id)}
                  className="flex w-full flex-col items-start gap-0.5 px-1 py-2 text-left hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
                >
                  <span className="text-sm font-medium">{group.name}</span>
                  {group.levelName !== null && (
                    <span className="text-sm text-foreground-muted">{group.levelName}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {/*
          Partnership groups — POOLSE-117. Choosing one asks which days: the one
          clicked, ticked, and the site's other open days to tick. Same hour,
          length and lane as the click.
        */}
        {partnerGroups.length > 0 && (
          <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
            <p className="text-sm font-medium">{t('partnerDays.groupsHeading')}</p>
            <ul className="flex max-h-48 flex-col divide-y divide-border overflow-y-auto">
              {partnerGroups.map((group) => (
                <li key={group.id}>
                  <button
                    type="button"
                    disabled={busy}
                    aria-pressed={partnerChoice === group.id}
                    onClick={() => {
                      setPartnerChoice(partnerChoice === group.id ? null : group.id);
                      setPartnerClashes([]);
                    }}
                    className={cn(
                      'flex w-full flex-col items-start gap-0.5 px-1 py-2 text-left hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60',
                      partnerChoice === group.id && 'text-primary',
                    )}
                  >
                    <span className="text-sm font-medium">{group.name}</span>
                    <span className="text-sm text-foreground-muted">{group.partnerName}</span>
                  </button>
                </li>
              ))}
            </ul>
            {partnerChoice !== null && placing !== null && (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm text-foreground-muted">{t('partnerDays.whichDays')}</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {openDays.map((day) => (
                    <label key={day} className="inline-flex min-h-control items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={partnerDays.includes(day)}
                        onChange={(event) =>
                          setPartnerDays(
                            event.target.checked
                              ? [...partnerDays, day]
                              : partnerDays.filter((one) => one !== day),
                          )
                        }
                      />
                      {t(`week.${day}`)}
                    </label>
                  ))}
                </div>
                {partnerClashes.length > 0 && (
                  <ul className="flex flex-col gap-1 text-sm text-danger" role="alert">
                    {partnerClashes.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )}
                <div>
                  <button
                    type="button"
                    disabled={busy || partnerDays.length === 0}
                    onClick={() => void placePartner()}
                    className="inline-flex h-control items-center justify-center rounded bg-primary px-4 text-control font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    {t('partnerDays.place', { count: partnerDays.length })}
                  </button>
                </div>
              </fieldset>
            )}
          </div>
        )}

        {/*
          The lane is not set here, and that is a limitation rather than a
          choice: `placeSlotAction` does not hand back the schedule it created,
          so there is no id to give the lane to without a second round trip that
          would have to guess which row it had just made. Dragging the block one
          column across is the answer for now, and it costs a gesture the rest of
          this slice made cheap.
        */}
        <p className="mt-3 text-sm text-foreground-muted">{t('calendar.laneAfterwards')}</p>

        <FromLink
          href="/dashboard/classes/new"
          className="mt-3 inline-block text-sm text-primary underline-offset-4 hover:underline"
        >
          {t('calendar.createTurma')}
        </FromLink>

        {/*
          Or hold this lane for the public — POOLSE-68. The title is the club's
          own words, prefilled in the reader's language.
        */}
        {freeSwimOn && facilityId !== null && seasonId !== null && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void placeFreeSwim();
            }}
            className="mt-4 flex flex-col gap-3 border-t border-border pt-4"
          >
            <p className="text-sm text-foreground-muted">{t('calendar.freeSwimHint')}</p>
            <TextField
              name="freeSwimTitle"
              label={t('calendar.freeSwimTitle')}
              initial={freeSwimTitle}
              onValueChange={setFreeSwimTitle}
              maxLength={60}
              className="max-w-none"
            />
            <div>
              <button
                type="submit"
                disabled={busy || freeSwimTitle.trim() === ''}
                className="inline-flex h-control items-center justify-center gap-2 rounded border border-primary/40 px-4 text-control font-medium text-primary hover:bg-primary/10 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <Waves className="size-4" aria-hidden="true" />
                {t('calendar.freeSwimHere')}
              </button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
