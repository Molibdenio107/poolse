'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Ban, ClipboardCheck } from 'lucide-react';
import type { ClassGroup, GridBooking, GridLane, GridSlot } from '@/lib/api';
import { slotKey } from '@/lib/slot-key';
import { startTimeOf } from '@/lib/calendar-scale';
import { CalendarGrid, type CalendarLevel } from './calendar-grid';
import { CancelSessionDialog, type CancelTarget } from './calendar-forms';
import { LessonPlanPanel } from './lesson-plan-panel';
import type { SessionControls } from '../classes/schedule-board';
import { moveBookingAction, moveOccurrenceAction } from '../classes/classes.actions';

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

  const [planning, setPlanning] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<CancelTarget | null>(null);

  const controlsFor = useCallback(
    (booking: GridBooking): SessionControls | undefined =>
      booking.classGroupId === null
        ? undefined
        : controls[slotKey(booking.classGroupId, booking.weekday, booking.startTime)],
    [controls],
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
        { label: t('grid.lane'), value: String(booking.laneIds.length) },
        {
          label: t('calendar.time'),
          value: `${booking.startTime.slice(0, 5)} · ${booking.durationMinutes} min`,
        },
      ];
      if (booking.subtitle !== null) {
        facts.unshift({ label: t('classes.level'), value: booking.subtitle });
      }
      if (booking.instructorName !== null) {
        facts.push({ label: t('roles.instructor'), value: booking.instructorName });
      }

      const actions =
        session === undefined ? undefined : (
          <div className="flex flex-wrap items-center gap-2">
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

      return {
        title: booking.name,
        detail: { facts, people: [], peopleEmpty: t('classes.nobodyEnrolled') },
        ...(actions === undefined ? {} : { actions }),
      };
    },
    [controlsFor, t],
  );

  /** A click on a block opens that lesson's plan, exactly as it did before. */
  const onOpenPlan = useCallback(
    (booking: GridBooking) => {
      const session = controlsFor(booking);
      if (session?.sessionId === undefined) return;
      setPlanning(session.sessionId);
    },
    [controlsFor],
  );

  /*
   * A click on empty space.
   *
   * The turma is created on its own screen, which is where the level, the
   * capacity and the instructor are decided; this carries the day, the time and
   * the pista over so nobody has to retype what they just pointed at.
   */
  const onCreate = useCallback(
    (weekday: number, laneId: string, startMinutes: number) => {
      const query = new URLSearchParams({
        weekday: String(weekday),
        startTime: startTimeOf(Math.round(startMinutes / 5) * 5),
        laneId,
        from: `/dashboard/calendar?week=${weekStart}`,
      });
      router.push(`/dashboard/classes/new?${query.toString()}`);
    },
    [router, weekStart],
  );

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
        const moved = await moveOccurrenceAction(
          organizationId,
          session.sessionId,
          weekStart,
          startTime,
        );
        if (!moved.ok) return moved.errorKey;
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
      if (!result.ok) return result.errorKey;
      router.refresh();
      return null;
    },
    [controlsFor, organizationId, router, weekStart],
  );

  return (
    <>
      <CalendarGrid
        organizationId={organizationId}
        weekStart={weekStart}
        dayNames={dayNames}
        todayWeekday={todayWeekday}
        closures={closures}
        slots={slots}
        lanes={lanes}
        pools={pools}
        bookings={bookings}
        levels={levels}
        groups={groups}
        canManage={canManage}
        renderDetail={renderDetail}
        onOpenPlan={onOpenPlan}
        onCreate={onCreate}
        onMove={onMove}
      />

      {planning !== null && (
        <LessonPlanPanel sessionId={planning} onClose={() => setPlanning(null)} />
      )}

      <CancelSessionDialog
        organizationId={organizationId}
        target={cancelling}
        onClose={() => setCancelling(null)}
      />
    </>
  );
}
