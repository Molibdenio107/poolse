'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Ban, ClipboardCheck, NotebookPen } from 'lucide-react';
import type { ClassGroup, FacilityDay, GridBooking, GridLane, GridSlot } from '@/lib/api';
import { bookingKey, slotKey } from '@/lib/slot-key';
import { startTimeOf } from '@/lib/calendar-scale';
import { slotsFor, toMinutes } from '@/lib/grid-layout';
import { Dialog } from '@/components/ui/dialog';
import { CalendarGrid, SEP, type CalendarLevel } from './calendar-grid';
import { StandInPicker } from './stand-in-picker';
import { CancelSessionDialog, type CancelTarget } from './calendar-forms';
import { LessonPlanPanel } from './lesson-plan-panel';
import type { SessionControls } from '../classes/schedule-board';
import {
  moveBookingAction,
  moveOccurrenceAction,
  placeSlotAction,
} from '../classes/classes.actions';

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
  weekStart,
  dayNames,
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
}: {
  organizationId: string;
  weekStart: string;
  dayNames: Record<number, string>;
  todayWeekday?: number | undefined;
  closures: { weekday: number; reason: string }[];
  hours: FacilityDay[];
  slots: GridSlot[];
  lanes: GridLane[];
  pools: { id: string; name: string }[];
  bookings: GridBooking[];
  levels: CalendarLevel[];
  groups: ClassGroup[];
  controls: Record<string, SessionControls>;
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const router = useRouter();

  const [planning, setPlanning] = useState<{ sessionId: string; booking: GridBooking } | null>(
    null,
  );
  const [cancelling, setCancelling] = useState<CancelTarget | null>(null);
  const [placing, setPlacing] = useState<{ weekday: number; startMinutes: number } | null>(null);
  const [placeError, setPlaceError] = useState<string | null>(null);
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
                className="inline-flex items-center gap-1.5 rounded border border-primary/40 px-2 py-1 text-sm font-medium text-primary hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
              >
                <NotebookPen className="size-4" aria-hidden="true" />
                {t('calendar.plan.title')}
              </button>
            )}

            {session.mark !== undefined && (
              <Link
                href={session.mark.href}
                className="inline-flex items-center gap-1.5 rounded border border-primary/40 px-2 py-1 text-sm font-medium text-primary hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
              >
                <ClipboardCheck className="size-4" aria-hidden="true" />
                {session.mark.label}
              </Link>
            )}

            {session.cancel !== undefined && session.sessionId !== undefined && (
              <button
                type="button"
                onClick={() =>
                  setCancelling({
                    sessionId: session.sessionId!,
                    className: session.cancel!.className,
                    when: session.cancel!.when,
                  })
                }
                className="inline-flex items-center gap-1.5 rounded border border-border-strong px-2 py-1 text-sm hover:border-danger hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
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
  const onCreate = useCallback((weekday: number, _laneId: string, startMinutes: number) => {
    setPlaceError(null);
    setPlacing({ weekday, startMinutes });
  }, []);

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
        );
        if (!moved.ok) {
          return moved.detail === undefined || moved.detail === ''
            ? moved.errorKey
            : `${moved.errorKey}${SEP}${moved.detail}`;
        }
        router.refresh();
        return null;
      }

      const result = await moveBookingAction(organizationId, booking.id, {
        weekday: to.weekday,
        slotId: null,
        startTime,
        laneIds: to.laneIds,
        durationMinutes: to.durationMinutes,
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
      router.refresh();
      return null;
    },
    [controlsFor, organizationId, router, weekStart],
  );

  return (
    <>
      <CalendarGrid
        weekStart={weekStart}
        dayNames={dayNames}
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

        {unscheduled.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t('calendar.nothingToPlace')}</p>
        ) : (
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
          The lane is not set here, and that is a limitation rather than a
          choice: `placeSlotAction` does not hand back the schedule it created,
          so there is no id to give the lane to without a second round trip that
          would have to guess which row it had just made. Dragging the block one
          column across is the answer for now, and it costs a gesture the rest of
          this slice made cheap.
        */}
        <p className="mt-3 text-sm text-foreground-muted">{t('calendar.laneAfterwards')}</p>

        <Link
          href="/dashboard/classes/new"
          className="mt-3 inline-block text-sm text-primary underline-offset-4 hover:underline"
        >
          {t('calendar.createTurma')}
        </Link>
      </Dialog>
    </>
  );
}
