'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { FacilityDay, GridBooking, GridLane, GridSlot } from '@/lib/api';

/** Only what a colour and a legend need; the API sends them already ordered. */
export type CalendarLevel = { id: string; name: string };
import {
  dayRange,
  hourMarks,
  levelOrder,
  levelTint,
  minutesToPx,
  MIN_BLOCK_HEIGHT,
  pxToMinutes,
  snapDuration,
  snapStart,
  snapStep,
  startTimeOf,
  TIME_VISIBLE_MIN_HEIGHT,
} from '@/lib/calendar-scale';
import { toMinutes } from '@/lib/grid-layout';
import { cn } from '@/lib/utils';
import { TurmaHoverCard, type TurmaDetail } from '@/components/turma-card';

/**
 * The dated week, drawn on a pixel scale — round 6.
 *
 * **Its own component, not the turma board.** The board next door
 * (`classes/schedule-board.tsx`) draws the recurring *pattern* and stays exactly
 * as it is; this draws a particular week. They were one component told apart by
 * whether a `weekStart` was passed, which meant every change to the calendar was
 * a change to the turma screen as well.
 *
 * **Absolute positioning from minutes, not table rows.** The board makes a slot
 * a row, so a 45-minute class in a 60-minute slot fills the row and reads as an
 * hour — a lie the operator has to know to discount. Here `top` and `height`
 * come from the block's own minutes, so it is three-quarters of the slot and two
 * classes that overlap by ten minutes look like it.
 *
 * **Columns are day × lane, at a fixed width.** The axis the ticket settled:
 * seven days, each subdivided by pista, time down the left. Fixed rather than
 * fractional because a block spanning three lanes is `3 × --col` wide, and
 * `minmax(…, 1fr)` would make that arithmetic depend on the container — which is
 * exactly the sort of thing that is right on a laptop and wrong on a projector.
 *
 * **One droppable per column, not per cell.** Measured on a real club: the board
 * mounts 2,256 droppables (26 slot rows × 24 lanes × the week), each running a
 * rules `evaluate()` when a drag starts, and `pointerWithin` walks all of them
 * on every pointer move. This mounts 168 — one per day-and-lane — and works out
 * the minute from how far the pointer has travelled. That is the whole of why
 * the old one felt clunky.
 */

/**
 * One lane column.
 *
 * Narrowed twice in round 6. Once the header stopped repeating "Pista" on every
 * column there was nothing left that had to be read in full: the widest thing a
 * column carries is a turma's name, and a name truncates. At 64px a six-lane pool
 * fits a week across a laptop without sideways scrolling, which is worth more
 * than the tail of "Iniciados A" — the full name is on the block's hover card.
 */
const COL_WIDTH = 64;

/** The time gutter down the left. */
const GUTTER = 56;

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export interface CalendarGridProps {
  /** Monday of the week on screen, ISO. */
  weekStart: string;
  /** Dated headers — "Ter · 25 ago". */
  dayNames: Record<number, string>;
  /** Set only on the week containing today. Drives the now-line and the fade. */
  todayWeekday?: number | undefined;
  closures: { weekday: number; reason: string }[];
  /**
   * The site's opening hours, one row per weekday.
   *
   * A day the pool does not open is not drawn — seven columns of which two are
   * empty is two columns of nothing on a screen that is short of width.
   */
  hours: FacilityDay[];
  slots: GridSlot[];
  lanes: GridLane[];
  pools: { id: string; name: string }[];
  bookings: GridBooking[];
  levels: CalendarLevel[];
  canManage: boolean;
  /** Hover-card content and actions for one booking, built by the page. */
  renderDetail: (booking: GridBooking) => {
    title: string;
    detail: TurmaDetail;
    actions?: React.ReactNode;
  };
  /** Click a block: open that lesson's plan. */
  onOpenPlan: (booking: GridBooking) => void;
  /** Click empty space: start creating something there. */
  onCreate: (weekday: number, laneId: string, startMinutes: number) => void;
  /**
   * A settled move. The grid has already drawn it; this writes it.
   *
   * Returns the failure key when the server refused, so the grid can put the
   * block back where it came from and say why.
   */
  onMove: (
    booking: GridBooking,
    to: { weekday: number; laneIds: string[]; startMinutes: number; durationMinutes: number },
    scope: 'series' | 'week',
  ) => Promise<string | null>;
}

/** What the grid is drawing that the server has not confirmed yet. */
interface Pending {
  bookingId: string;
  weekday: number;
  laneIds: string[];
  startMinutes: number;
  durationMinutes: number;
}

/** The question a drop cannot answer on its own, asked where it was dropped. */
interface ScopeAsk extends Pending {
  booking: GridBooking;
  x: number;
  y: number;
  /**
   * A lane change, which has only one possible answer.
   *
   * Lanes live on the recurring booking: `moveOccurrenceAction` carries a start
   * time and nothing else, so "this week only" is not a thing the data can
   * express. The popover says so and offers the one button, rather than offering
   * a choice that would silently do the same thing either way.
   */
  seriesOnly?: boolean;
}

export function CalendarGrid(props: CalendarGridProps): React.ReactElement {
  const t = useTranslations();
  const {
    dayNames,
    todayWeekday,
    closures,
    slots,
    lanes,
    pools,
    bookings,
    levels,
    canManage,
    hours,
  } = props;

  /*
   * The days actually drawn.
   *
   * Opening hours decide it, with one exception that round 5 settled and this
   * keeps: **a closed day that still has a class on it is drawn anyway**. A club
   * that stops opening on Saturday does not thereby delete its Saturday classes,
   * and a class you cannot see is a class you cannot move. It comes back shaded,
   * with its blocks greyed, which is the screen saying "this should not be here"
   * rather than pretending it is not.
   */
  const days = useMemo(() => {
    const open = new Set(hours.filter((day) => day.available).map((day) => day.weekday));
    const busy = new Set(bookings.map((booking) => booking.weekday));
    const shownDays = ALL_DAYS.filter((weekday) => open.has(weekday) || busy.has(weekday));
    // A facility with no hours recorded at all would otherwise render nothing.
    return shownDays.length === 0 ? [...ALL_DAYS] : shownDays;
  }, [hours, bookings]);

  const openOn = useCallback(
    (weekday: number) => hours.find((day) => day.weekday === weekday)?.available ?? true,
    [hours],
  );

  /*
   * One pool at a time when the club has more than one.
   *
   * Three pools of eight lanes is 168 columns across a week — a first paint
   * nobody can read and a horizontal scrollbar measured in screens. The club
   * with one pool never sees the control.
   */
  const [poolId, setPoolId] = useState<string>(() => pools[0]?.id ?? '');
  const shownLanes = useMemo(
    () =>
      (pools.length > 1 ? lanes.filter((lane) => lane.poolId === poolId) : lanes)
        .slice()
        .sort((a, b) => a.position - b.position),
    [lanes, pools.length, poolId],
  );

  const laneIndex = useMemo(
    () => new Map(shownLanes.map((lane, index) => [lane.id, index])),
    [shownLanes],
  );

  const range = useMemo(() => dayRange(slots, bookings), [slots, bookings]);
  const step = useMemo(() => snapStep(slots), [slots]);
  const order = useMemo(() => levelOrder(levels), [levels]);
  const height = minutesToPx(range.endMinutes - range.startMinutes);

  const closureOf = useCallback(
    (weekday: number) => closures.find((closure) => closure.weekday === weekday) ?? null,
    [closures],
  );

  /*
   * Which days' classes are drawn faded, and why it is only ever cosmetic.
   *
   * A holiday or a shutdown, and any day already past. Both mean "nothing is
   * expected to happen here", which is worth seeing at a glance on a week that is
   * otherwise uniform — and neither is a reason to stop somebody moving the
   * block. Round 5 made past classes undraggable; round 6 reverses that on
   * request. Dragging Monday's class to Thursday is ordinary planning, and the
   * server has always been the thing that refuses an impossible move.
   */
  const dimmed = useCallback(
    (weekday: number) =>
      closureOf(weekday) !== null ||
      !openOn(weekday) ||
      (todayWeekday !== undefined && weekday < todayWeekday),
    [closureOf, openOn, todayWeekday],
  );

  /*
   * What the grid is showing ahead of the server.
   *
   * Keyed by booking id and applied at render, so a refused move is undone by
   * dropping one entry rather than by re-fetching a week. The block never
   * "jumps back and forth" — it moves once on drop and, if the server refuses,
   * once more on the way home.
   */
  const [pending, setPending] = useState<Map<string, Pending>>(new Map());
  const [ask, setAsk] = useState<ScopeAsk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startWrite] = useTransition();

  const shown = useMemo(
    () =>
      bookings.map((booking) => {
        const override = pending.get(booking.id);
        if (override === undefined) return booking;
        return {
          ...booking,
          weekday: override.weekday,
          startTime: startTimeOf(override.startMinutes),
          durationMinutes: override.durationMinutes,
          laneIds: override.laneIds,
        };
      }),
    [bookings, pending],
  );

  // ---------------------------------------------------------------- dragging

  const [dragging, setDragging] = useState<string | null>(null);
  const [ghost, setGhost] = useState<Pending | null>(null);

  /*
   * When the last drag finished.
   *
   * A pointer-up that ends a drag still fires a click on the element underneath,
   * so without this every move would also open the lesson plan of the thing that
   * was moved. The sensor's 4px threshold decides what counts as a drag; this
   * only suppresses the click that follows one.
   */
  const draggedAt = useRef(0);

  /*
   * The pointer sensor needs a little travel before it claims the gesture, or a
   * click that opens the lesson plan would be swallowed as a one-pixel drag.
   */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const bookingById = useCallback(
    (id: string) => shown.find((booking) => booking.id === id) ?? null,
    [shown],
  );

  function onDragStart(event: DragStartEvent): void {
    setError(null);
    setDragging(String(event.active.id));
  }

  /*
   * The ghost, and the only state that changes during a drag.
   *
   * It is set from the *snapped* target, so it changes once per step of travel
   * rather than once per frame — at 15 minutes a step that is one render per
   * 15px, not sixty a second. The block itself is moved by dnd-kit's own
   * transform and needs nothing from here.
   */
  function onDragMove(event: DragMoveEvent): void {
    const booking = bookingById(String(event.active.id));
    if (booking === null) return;

    const target = resolve(event, booking);
    if (target === null) return;

    setGhost((current) =>
      current !== null &&
      current.weekday === target.weekday &&
      current.startMinutes === target.startMinutes &&
      current.laneIds[0] === target.laneIds[0]
        ? current
        : target,
    );
  }

  /** Where a drag currently points, in the grid's own terms. */
  function resolve(
    event: DragMoveEvent | DragEndEvent,
    booking: GridBooking,
  ): Pending | null {
    const over = event.over;
    if (over === null) return null;

    const [, weekdayText, laneId] = String(over.id).split(':');
    const weekday = Number(weekdayText);
    if (laneId === undefined || Number.isNaN(weekday)) return null;

    const from = toMinutes(booking.startTime);
    const moved = from + pxToMinutes(event.delta.y);
    const startMinutes = snapStart(
      Math.max(range.startMinutes, Math.min(moved, range.endMinutes - booking.durationMinutes)),
      weekday,
      slots,
      step,
    );

    /*
     * A block spanning several lanes keeps its width and moves as one thing.
     * The lane it was grabbed by becomes the lane it is dropped on, and the rest
     * follow — dropping a three-lane booking and having it collapse to one lane
     * would be a data change nobody asked for.
     */
    const width = booking.laneIds.length;
    const first = laneIndex.get(laneId);
    if (first === undefined) return null;

    const start = Math.min(first, Math.max(0, shownLanes.length - width));
    const laneIds = shownLanes.slice(start, start + width).map((lane) => lane.id);

    return {
      bookingId: booking.id,
      weekday,
      laneIds,
      startMinutes,
      durationMinutes: booking.durationMinutes,
    };
  }

  function onDragEnd(event: DragEndEvent): void {
    const active = String(event.active.id);
    setDragging(null);
    setGhost(null);
    draggedAt.current = Date.now();

    const booking = bookingById(active);
    if (booking === null) return;

    const target = resolve(event, booking);
    if (target === null) return;

    const unmoved =
      target.weekday === booking.weekday &&
      target.startMinutes === toMinutes(booking.startTime) &&
      target.laneIds.join() === booking.laneIds.join();
    if (unmoved) return;

    if (closureOf(target.weekday) !== null) {
      setError('grid.dayClosed');
      return;
    }

    // The block lands now. The question that follows is about which weeks it
    // lands in, not about whether it moved.
    setPending((current) => new Map(current).set(booking.id, target));

    const rect = event.active.rect.current.translated;
    setAsk({
      ...target,
      booking,
      x: (rect?.left ?? 0) + (rect?.width ?? 0) / 2,
      y: (rect?.top ?? 0) + (rect?.height ?? 0),
    });
  }

  // ---------------------------------------------------------------- resizing

  /** Which edge is being dragged, and where the pointer started. */
  const resizing = useRef<{
    booking: GridBooking;
    edge: 'bottom' | 'left' | 'right';
    from: number;
  } | null>(null);

  // `up` reads the latest ghost without re-subscribing the window listeners each
  // time one arrives — re-binding two listeners per snap step would cost more
  // than the render it is meant to save.
  const ghostRef = useRef<Pending | null>(null);
  ghostRef.current = ghost;

  const onResizeStart = useCallback(
    (booking: GridBooking, edge: 'bottom' | 'left' | 'right', from: number) => {
      resizing.current = { booking, edge, from };
    },
    [],
  );

  useEffect(() => {
    if (!canManage) return undefined;

    function move(event: PointerEvent): void {
      const state = resizing.current;
      if (state === null) return;

      const { booking, edge, from } = state;
      const startMinutes = toMinutes(booking.startTime);

      /*
       * Sideways: the run of lanes changes and nothing else does.
       *
       * A booking occupies a contiguous run — `laneIds` is "every lane it
       * occupies, in position order" — so the right edge moves the end and the
       * left edge moves the start, both clamped inside the lanes on screen. One
       * lane is the floor: a class in no lanes is not a class.
       */
      if (edge !== 'bottom') {
        const firstIndex = laneIndex.get(booking.laneIds[0] ?? '') ?? 0;
        const lastIndex = firstIndex + Math.max(1, booking.laneIds.length) - 1;
        const moved = Math.round((event.clientX - from) / COL_WIDTH);

        const from0 =
          edge === 'left'
            ? Math.max(0, Math.min(firstIndex + moved, lastIndex))
            : firstIndex;
        const to0 =
          edge === 'right'
            ? Math.min(shownLanes.length - 1, Math.max(lastIndex + moved, firstIndex))
            : lastIndex;

        const laneIds = shownLanes.slice(from0, to0 + 1).map((lane) => lane.id);
        if (laneIds.length === 0) return;

        setGhost((current) =>
          current !== null && current.laneIds.join() === laneIds.join()
            ? current
            : {
                bookingId: booking.id,
                weekday: booking.weekday,
                laneIds,
                startMinutes,
                durationMinutes: booking.durationMinutes,
              },
        );
        return;
      }

      const durationMinutes = snapDuration(
        startMinutes,
        startMinutes + booking.durationMinutes + pxToMinutes(event.clientY - from),
        booking.weekday,
        slots,
        step,
      );

      setGhost((current) =>
        current !== null && current.durationMinutes === durationMinutes
          ? current
          : {
              bookingId: booking.id,
              weekday: booking.weekday,
              laneIds: booking.laneIds,
              startMinutes,
              durationMinutes,
            },
      );
    }

    function up(): void {
      const state = resizing.current;
      const target = ghostRef.current;
      resizing.current = null;
      setGhost(null);
      if (state === null || target === null) return;

      const sideways = state.edge !== 'bottom';
      const unchanged = sideways
        ? target.laneIds.join() === state.booking.laneIds.join()
        : target.durationMinutes === state.booking.durationMinutes;
      if (unchanged) return;

      setPending((current) => new Map(current).set(state.booking.id, target));

      // Point at the block that changed, not at the middle of the screen. The
      // element is still on the page at this instant, so its box is the honest
      // anchor; if it has gone, the popover centres itself as it used to.
      const node = document.querySelector<HTMLElement>(
        `[data-booking="${state.booking.id}"]`,
      );
      const box = node?.getBoundingClientRect();

      setAsk({
        ...target,
        booking: state.booking,
        x: box === undefined ? 0 : box.left + box.width / 2,
        y: box === undefined ? 0 : box.bottom,
        ...(sideways ? { seriesOnly: true } : {}),
      });
    }

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [canManage, slots, step, laneIndex, shownLanes]);

  // ------------------------------------------------------------ the decision

  function settle(scope: 'series' | 'week'): void {
    const asked = ask;
    if (asked === null) return;
    setAsk(null);

    startWrite(async () => {
      const failure = await props.onMove(
        asked.booking,
        {
          weekday: asked.weekday,
          laneIds: asked.laneIds,
          startMinutes: asked.startMinutes,
          durationMinutes: asked.durationMinutes,
        },
        scope,
      );

      // Either way the override goes: on success the server's own data now says
      // the same thing, and on failure the block has to go home or the week
      // would keep showing a move that was never saved.
      setPending((current) => {
        const next = new Map(current);
        next.delete(asked.booking.id);
        return next;
      });
      if (failure !== null) setError(failure);
    });
  }

  function abandon(): void {
    const asked = ask;
    setAsk(null);
    if (asked === null) return;
    setPending((current) => {
      const next = new Map(current);
      next.delete(asked.booking.id);
      return next;
    });
  }

  // -------------------------------------------------------------- scrolling

  const scroller = useRef<HTMLDivElement>(null);

  /*
   * Open on the first class of the week rather than at 06:00.
   *
   * A club whose grid runs from six in the morning opens on two hours of empty
   * canvas otherwise, and the first thing anybody does is scroll. Half an hour
   * of headroom above it, so the first block is not glued to the header.
   */
  useEffect(() => {
    const node = scroller.current;
    if (node === null || bookings.length === 0) return;

    /*
     * The window, not the card: the card no longer scrolls vertically.
     *
     * Measured from the card's own position in the document so the first class
     * lands just under the top of the viewport, with half an hour of headroom
     * above it — a club whose grid opens at six otherwise starts on two hours of
     * empty canvas, and the first thing anybody does is scroll past it.
     */
    const earliest = Math.min(...bookings.map((booking) => toMinutes(booking.startTime)));
    const offset = minutesToPx(earliest - range.startMinutes - 30);
    const top = node.getBoundingClientRect().top + window.scrollY + Math.max(0, offset);
    window.scrollTo({ top: Math.max(0, top - 16), behavior: 'auto' });
    // Only when the week changes. Re-running it on every render would yank the
    // page back under somebody who had scrolled away.
  }, [props.weekStart, bookings.length, range.startMinutes]);

  return (
    <section className="flex flex-col gap-2">
      <Toolbar
        pools={pools}
        poolId={poolId}
        onPool={setPoolId}
        levels={levels}
        order={order}
      />

      {error !== null && (
        <p role="status" className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {t(error)}
        </p>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
      >
        {/*
          Horizontal scrolling only — round 6.

          The card used to cap at 70vh and scroll inside itself, which meant a
          pool day was read through a letterbox. It is now as tall as the day, so
          there is nothing to scroll vertically and the page takes over.

          **The day and lane headers scroll away with it, and that is the cost of
          this.** CSS cannot scroll one axis in a container and stick to the
          viewport on the other: `overflow-x: auto` forces `overflow-y` to auto
          too, so a `sticky top` here can only stick to a box that no longer
          moves. What survives is the sideways stickiness — the time gutter stays
          pinned when you scroll across the week, which is the axis that actually
          scrolls now.
        */}
        <div
          ref={scroller}
          className="relative overflow-x-auto rounded border border-border bg-surface"
        >
          <div className="min-w-max">
            <Header
              days={days}
              dayNames={dayNames}
              lanes={shownLanes}
              todayWeekday={todayWeekday}
              closureOf={closureOf}
            />

            <div className="relative flex">
              <Gutter range={range} height={height} />

              {days.map((weekday) => (
                <div
                  key={weekday}
                  className={cn(
                    'flex border-l border-border',
                    (closureOf(weekday) !== null || !openOn(weekday)) && 'bg-surface-muted/60',
                  )}
                >
                  {shownLanes.map((lane) => (
                    <LaneColumn
                      key={lane.id}
                      weekday={weekday}
                      lane={lane}
                      height={height}
                      range={range}
                      disabled={!canManage || closureOf(weekday) !== null || !openOn(weekday)}
                      onCreate={props.onCreate}
                    />
                  ))}

                  {/*
                    The now-line spans the day's lanes rather than one of them:
                    the time is a fact about the day, not about a pista.
                  */}
                  {todayWeekday === weekday && (
                    <NowLine range={range} width={shownLanes.length * COL_WIDTH} />
                  )}
                </div>
              ))}

              {/*
                Blocks are drawn over the columns in one absolutely positioned
                layer — a sibling of the columns and inside the same `relative`
                box, so the layer's origin is the top of the canvas rather than
                the top of the header. A booking spanning three lanes is then one
                element three columns wide, not three elements pretending to be
                one.
              */}
              <BlockLayer
                days={days}
                shown={shown}
                lanes={shownLanes}
                laneIndex={laneIndex}
                range={range}
                order={order}
                dragging={dragging}
                ghost={ghost}
                canManage={canManage}
                todayWeekday={todayWeekday}
                dimmed={dimmed}
                renderDetail={props.renderDetail}
                onOpenPlan={props.onOpenPlan}
                onResizeStart={onResizeStart}
                justDragged={draggedAt}
              />
            </div>
          </div>
        </div>
      </DndContext>

      {ask !== null && (
        <ScopePopover ask={ask} onScope={settle} onCancel={abandon} />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ pieces */

function Toolbar({
  pools,
  poolId,
  onPool,
  levels,
  order,
}: {
  pools: { id: string; name: string }[];
  poolId: string;
  onPool: (id: string) => void;
  levels: CalendarLevel[];
  order: ReadonlyMap<string, number>;
}): React.ReactElement {
  const t = useTranslations();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {pools.length > 1 ? (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-foreground-muted">{t('calendar.pool')}</span>
          <select
            value={poolId}
            onChange={(event) => onPool(event.target.value)}
            className="h-control rounded border border-border-strong bg-background px-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {pools.map((pool) => (
              <option key={pool.id} value={pool.id}>
                {pool.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <span />
      )}

      {/*
        The legend names every level in words. Colour is the cue that makes a
        full week scannable, never the cue that makes it readable.
      */}
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground-muted">
        {levels.map((level) => (
          <li key={level.id} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn('size-2.5 rounded-sm', tintClass(levelTint({ subjectType: 'turma', levelId: level.id } as never, order)))}
            />
            {level.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The two sticky header rows: the day, then its pistas. */
const Header = memo(function Header({
  days,
  dayNames,
  lanes,
  todayWeekday,
  closureOf,
}: {
  days: readonly number[];
  dayNames: Record<number, string>;
  lanes: GridLane[];
  todayWeekday?: number | undefined;
  closureOf: (weekday: number) => { reason: string } | null;
}): React.ReactElement {
  const t = useTranslations();

  return (
    <div className="z-30 flex bg-surface">
      {/*
        The gutter's own two rows: nothing over the dates, and the word the
        numbers beneath belong to. Naming the row once is what lets every column
        below it be a digit instead of "Pista 1" eighty times.
      */}
      <div
        className="sticky left-0 z-40 flex shrink-0 flex-col border-b border-r border-border bg-surface"
        style={{ width: GUTTER }}
      >
        <div className="flex-1 border-b border-border" />
        <div className="px-1.5 py-0.5 text-right text-[0.6875rem] uppercase tracking-wide text-foreground-muted">
          {t('grid.lanes')}
        </div>
      </div>
      {days.map((weekday) => (
        <div key={weekday} className="shrink-0 border-l border-border">
          <div
            className={cn(
              'truncate border-b border-border px-2 py-1 text-center text-[0.8125rem] font-medium',
              todayWeekday === weekday ? 'text-primary' : 'text-foreground-muted',
            )}
            style={{ width: lanes.length * COL_WIDTH }}
            title={closureOf(weekday)?.reason}
          >
            {dayNames[weekday] ?? ''}
            {closureOf(weekday) !== null && ' · ' + closureOf(weekday)!.reason}
          </div>
          <div className="flex">
            {lanes.map((lane, index) => (
              <div
                key={lane.id}
                className="shrink-0 border-b border-l border-border px-1.5 py-0.5 text-center text-[0.6875rem] tabular-nums text-foreground-muted"
                style={{ width: COL_WIDTH }}
                /*
                  The number is the lane's place in the pool, not digits pulled
                  out of whatever the club typed: a club with "Raia A" and
                  "Central" has no digits to pull, and a mix of parsed numbers
                  and positions would be a column headed 4 sitting third. The
                  full name is one hover away and stays the thing the hover card
                  and the printed sheet use.
                */
                title={lane.name}
              >
                {index + 1}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
});

/** Hours down the left, sticky, on the same scale as everything else. */
const Gutter = memo(function Gutter({
  range,
  height,
}: {
  range: { startMinutes: number; endMinutes: number };
  height: number;
}): React.ReactElement {
  return (
    <div
      className="sticky left-0 z-20 shrink-0 border-r border-border bg-surface"
      style={{ width: GUTTER, height }}
    >
      {hourMarks(range).map((minutes) => (
        <span
          key={minutes}
          className="absolute right-1.5 -translate-y-1/2 text-[0.6875rem] tabular-nums text-foreground-muted"
          style={{ top: minutesToPx(minutes - range.startMinutes) }}
        >
          {String(Math.floor(minutes / 60)).padStart(2, '0')}:
          {String(minutes % 60).padStart(2, '0')}
        </span>
      ))}
    </div>
  );
});

/**
 * One droppable column, and the hour rules behind it.
 *
 * The rules are a repeating background gradient rather than a div per hour:
 * seven days of twenty-four lanes is 168 columns, and a DOM node per hour in
 * each of them is fifteen hundred elements that never do anything.
 */
function LaneColumn({
  weekday,
  lane,
  height,
  range,
  disabled,
  onCreate,
}: {
  weekday: number;
  lane: GridLane;
  height: number;
  range: { startMinutes: number };
  disabled: boolean;
  onCreate: (weekday: number, laneId: string, startMinutes: number) => void;
}): React.ReactElement {
  const { setNodeRef, isOver } = useDroppable({
    id: `col:${weekday}:${lane.id}`,
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      onClick={(event) => {
        if (disabled) return;
        const box = event.currentTarget.getBoundingClientRect();
        onCreate(weekday, lane.id, range.startMinutes + pxToMinutes(event.clientY - box.top));
      }}
      className={cn(
        'relative shrink-0 border-l border-border/60 first:border-l-0',
        !disabled && 'cursor-copy',
        isOver && 'bg-primary/5',
      )}
      style={{
        width: COL_WIDTH,
        height,
        backgroundImage:
          'repeating-linear-gradient(to bottom, rgb(var(--border) / 0.55) 0 1px, transparent 1px ' +
          `${minutesToPx(60)}px)`,
      }}
    />
  );
}

/** Where we are in today, on the same pixel scale as the blocks. */
function NowLine({
  range,
  width,
}: {
  range: { startMinutes: number; endMinutes: number };
  width: number;
}): React.ReactElement | null {
  const [minutes, setMinutes] = useState<number | null>(null);

  useEffect(() => {
    const read = (): void => {
      const now = new Date();
      setMinutes(now.getHours() * 60 + now.getMinutes());
    };
    read();
    // A minute is the resolution of the thing being shown; anything faster is
    // work nobody can see.
    const timer = window.setInterval(read, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (minutes === null) return null;
  if (minutes < range.startMinutes || minutes > range.endMinutes) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute left-0 z-20 flex items-center"
      style={{ top: minutesToPx(minutes - range.startMinutes), width }}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-danger" />
      <span className="h-px w-full bg-danger" />
    </div>
  );
}

/** The eight level tints, and the neutral for everything without one. */
function tintClass(tint: number | null): string {
  switch (tint) {
    case 1:
      return 'bg-level-1';
    case 2:
      return 'bg-level-2';
    case 3:
      return 'bg-level-3';
    case 4:
      return 'bg-level-4';
    case 5:
      return 'bg-level-5';
    case 6:
      return 'bg-level-6';
    case 7:
      return 'bg-level-7';
    case 8:
      return 'bg-level-8';
    default:
      return 'bg-level-none';
  }
}

interface LayerProps {
  days: readonly number[];
  shown: GridBooking[];
  lanes: GridLane[];
  laneIndex: ReadonlyMap<string, number>;
  range: { startMinutes: number; endMinutes: number };
  order: ReadonlyMap<string, number>;
  dragging: string | null;
  ghost: Pending | null;
  canManage: boolean;
  todayWeekday?: number | undefined;
  renderDetail: CalendarGridProps['renderDetail'];
  onOpenPlan: CalendarGridProps['onOpenPlan'];
  onResizeStart: (
    booking: GridBooking,
    edge: 'bottom' | 'left' | 'right',
    from: number,
  ) => void;
  justDragged: React.MutableRefObject<number>;
  /** Faded: a holiday, a day the pool is shut, or a day already gone. */
  dimmed: (weekday: number) => boolean;
}

function BlockLayer(props: LayerProps): React.ReactElement {
  const { days, shown, lanes, laneIndex, range, ghost } = props;

  /** Left offset of a (day, lane) column inside the scrolling canvas. */
  const xOf = (weekday: number, laneId: string): number | null => {
    const day = days.indexOf(weekday);
    const lane = laneIndex.get(laneId);
    if (day < 0 || lane === undefined) return null;
    // Each day carries a 1px left border, which the header matches.
    return GUTTER + day * (lanes.length * COL_WIDTH + 1) + 1 + lane * COL_WIDTH;
  };

  return (
    <div className="pointer-events-none absolute inset-0">
      {shown.map((booking) => {
        const left = xOf(booking.weekday, booking.laneIds[0] ?? '');
        if (left === null) return null;

        return (
          <Block
            key={booking.id}
            booking={booking}
            left={left}
            width={Math.max(1, booking.laneIds.length) * COL_WIDTH}
            {...props}
          />
        );
      })}

      {ghost !== null &&
        (() => {
          const left = xOf(ghost.weekday, ghost.laneIds[0] ?? '');
          if (left === null) return null;
          return (
            <div
              aria-hidden="true"
              className="absolute rounded border-2 border-dashed border-primary bg-primary/10"
              style={{
                left: left + 1,
                width: Math.max(1, ghost.laneIds.length) * COL_WIDTH - 3,
                top: minutesToPx(ghost.startMinutes - range.startMinutes),
                height: Math.max(MIN_BLOCK_HEIGHT, minutesToPx(ghost.durationMinutes)),
              }}
            />
          );
        })()}
    </div>
  );
}

function Block({
  booking,
  left,
  width,
  range,
  order,
  dragging,
  canManage,
  todayWeekday,
  renderDetail,
  onOpenPlan,
  onResizeStart,
  justDragged,
  dimmed,
}: LayerProps & { booking: GridBooking; left: number; width: number }): React.ReactElement {
  const t = useTranslations();

  /*
   * Faded, and still draggable — round 6, reversing round 5's 9.1.
   *
   * Round 5 made past classes undraggable on the argument that moving one is
   * rewriting the past. In use that reads as the grid being broken: the block
   * looks like every other block and does not move. Fading says "this has
   * happened" perfectly well on its own, and a club rearranging Monday from
   * Wednesday is doing ordinary planning. The server refuses what is actually
   * impossible; the interface no longer guesses on its behalf.
   */
  const faded = dimmed(booking.weekday);
  const movable = canManage;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: booking.id,
    disabled: !movable,
  });

  const top = minutesToPx(toMinutes(booking.startTime) - range.startMinutes);
  const height = Math.max(MIN_BLOCK_HEIGHT, minutesToPx(booking.durationMinutes));
  const tint =
    booking.subjectType === 'parceria' && booking.partnerColour !== null
      ? undefined
      : tintClass(levelTint(booking, order));

  const anyDrag = dragging !== null;
  const card = renderDetail(booking);

  const block = (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => {
        // The click that follows a drop is not a click on the block.
        if (Date.now() - justDragged.current < 250) return;
        onOpenPlan(booking);
      }}
      data-booking={booking.id}
      className={cn(
        'pointer-events-auto absolute overflow-hidden rounded px-1.5 py-1 text-left text-white',
        'ring-1 ring-black/10',
        tint,
        movable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        // Enough to read as "not today" and still enough to read.
        faded && 'opacity-55 saturate-50',
        // 150ms on hover elevation, and nothing at all while a drag is live.
        isDragging ? 'z-40 shadow-lg' : anyDrag ? '' : 'transition-shadow duration-150 hover:shadow-md',
      )}
      style={{
        left: left + 1,
        width: width - 3,
        top,
        height,
        ...(booking.partnerColour === null || booking.subjectType !== 'parceria'
          ? {}
          : { backgroundColor: booking.partnerColour }),
        // Transform only. Nothing here reads or writes a layout property, so a
        // drag never costs a reflow.
        transform:
          transform === null
            ? undefined
            : `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        willChange: isDragging ? 'transform' : undefined,
      }}
    >
      <p className="truncate text-[0.75rem] font-medium leading-tight">{booking.name}</p>

      {/* The time only when there is room for it under the name. */}
      {height >= TIME_VISIBLE_MIN_HEIGHT && (
        <p className="truncate text-[0.6875rem] leading-tight opacity-90">
          {booking.startTime.slice(0, 5)}
          {booking.instructorName === null ? '' : ` · ${booking.instructorName}`}
        </p>
      )}

      {/*
        Three edges. The bottom changes how long the class runs; the left and
        right change how many pistas it takes. `stopPropagation` keeps the drag
        sensor out of it, so grabbing an edge never also starts a move.
      */}
      {movable && (
        <>
          <span
            role="presentation"
            aria-label={t('calendar.resize')}
            onPointerDown={(event) => {
              event.stopPropagation();
              event.preventDefault();
              onResizeStart(booking, 'bottom', event.clientY);
            }}
            className="absolute inset-x-2 bottom-0 h-2 cursor-ns-resize"
          />
          <span
            role="presentation"
            aria-label={t('calendar.resizeLanes')}
            onPointerDown={(event) => {
              event.stopPropagation();
              event.preventDefault();
              onResizeStart(booking, 'left', event.clientX);
            }}
            className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize"
          />
          <span
            role="presentation"
            aria-label={t('calendar.resizeLanes')}
            onPointerDown={(event) => {
              event.stopPropagation();
              event.preventDefault();
              onResizeStart(booking, 'right', event.clientX);
            }}
            className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize"
          />
        </>
      )}
    </div>
  );

  return (
    <TurmaHoverCard
      title={card.title}
      detail={card.detail}
      side="right"
      /*
        Not 0, and this is a correction — round 6.
        
        The ticket asked for "closes immediately on pointer-out" and it was taken
        literally, which made the card useless: Marcar presenças and Cancelar
        aula live inside it, and the pointer has to cross the gap between the
        block and the card to reach them. At 0ms the card was gone before it got
        there. The delay is the travel time, not a flourish.
      */
      closeDelay={220}
      suppressed={anyDrag}
      {...(card.actions === undefined ? {} : { actions: card.actions })}
    >
      {block}
    </TurmaHoverCard>
  );
}

/**
 * The question, at the cursor.
 *
 * Round 5 settled that a drag on a dated calendar cannot say by itself whether
 * it meant this week or every week, and that the board should ask rather than
 * guess. That stays. What changes is that the block has *already* moved and the
 * question is a small thing at the drop point, not a modal in the middle of the
 * screen with the grid greyed out behind it.
 */
function ScopePopover({
  ask,
  onScope,
  onCancel,
}: {
  ask: ScopeAsk;
  onScope: (scope: 'series' | 'week') => void;
  onCancel: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>('button')?.focus();

    function key(event: KeyboardEvent): void {
      if (event.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onCancel]);

  const anchored = !(ask.x === 0 && ask.y === 0);

  const WIDTH = 240;
  const MARGIN = 12;

  /*
   * Centred over the block, and nudged back inside the window.
   *
   * `clamped` is where the panel actually lands; `tail` is how far the arrow has
   * to slide along its top edge to keep pointing at the block after that nudge.
   * Without the second part a block near the right-hand edge gets a panel that
   * has moved and an arrow that has not, which points at the wrong class.
   */
  const wanted = ask.x - WIDTH / 2;
  const clamped = Math.max(
    MARGIN,
    Math.min(wanted, (typeof window === 'undefined' ? 1024 : window.innerWidth) - WIDTH - MARGIN),
  );
  const tail = Math.max(14, Math.min(ask.x - clamped, WIDTH - 14));

  /*
   * Below the block, unless the block is low on the screen, in which case above
   * it. A panel that opens off the bottom of the window is a question nobody can
   * answer.
   */
  const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight;
  const below = ask.y + 170 < viewportHeight;

  const style: React.CSSProperties = anchored
    ? below
      ? { left: clamped, top: ask.y + 10, width: WIDTH }
      : { left: clamped, top: Math.max(MARGIN, ask.y - 180), width: WIDTH }
    : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: WIDTH };

  return (
    <>
      {/* Dismissing by clicking away puts the block back, same as Escape. */}
      <div className="fixed inset-0 z-40" onClick={onCancel} />
      <div
        ref={box}
        role="dialog"
        aria-label={t('calendar.moveScope')}
        className="fixed z-50 rounded border border-border bg-surface p-3 shadow-lg"
        style={style}
      >
        {/*
          The tail: a square rotated 45°, carrying only the two borders that end
          up on the outside. All four would draw the panel's own edge straight
          through the middle of the arrow, which is the usual way this is got
          wrong. Which two depends on whether the panel sits below the block or
          above it.
        */}
        {anchored && (
          <span
            aria-hidden="true"
            className={cn(
              'absolute size-3 rotate-45 bg-surface',
              below ? 'border-l border-t border-border' : 'border-b border-r border-border',
            )}
            style={below ? { left: tail - 6, top: -6.5 } : { left: tail - 6, bottom: -6.5 }}
          />
        )}
        <p className="text-sm">
          {ask.seriesOnly === true
            ? t('calendar.lanesChanged', { count: ask.laneIds.length })
            : t('calendar.movedTo', { time: startTimeOf(ask.startMinutes).slice(0, 5) })}
        </p>

        {/*
          Said out loud rather than left to be discovered: a lane change lands on
          every week, because lanes belong to the recurring booking and there is
          no per-occurrence field to put them in.
        */}
        {ask.seriesOnly === true && (
          <p className="mt-1 text-sm text-foreground-muted">{t('calendar.lanesEveryWeek')}</p>
        )}

        <div className="mt-2 flex flex-col gap-1.5">
          {ask.seriesOnly !== true && (
            <button
              type="button"
              onClick={() => onScope('week')}
              className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {t('calendar.thisWeekOnly')}
            </button>
          )}
          <button
            type="button"
            onClick={() => onScope('series')}
            className={cn(
              'rounded px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
              ask.seriesOnly === true
                ? 'bg-primary text-primary-foreground hover:opacity-90'
                : 'border border-border-strong hover:border-primary/50',
            )}
          >
            {ask.seriesOnly === true ? t('common.continue') : t('calendar.wholeSeries')}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-sm text-foreground-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </>
  );
}
