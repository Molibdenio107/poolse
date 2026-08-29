'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import type { ClassGroup, FacilityDay } from '@/lib/api';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { moveSlotAction, placeSlotAction } from './classes.actions';

/**
 * Building a week by dragging — round 5.
 *
 * **Why a time grid and not the seven stacked columns next door.** `WeekGrid`
 * answers "what happens on Tuesday" and stacks whatever it finds; you cannot
 * drop onto it, because a column has no notion of *when*. A drop target has to
 * be a day *and* a time, so this is weekday columns crossed with half-hour rows,
 * and the empty cells are the point — they are the open slots an operator is
 * looking for when they ask "where can this turma go".
 *
 * **Half-hour rows, for now.** CLAUDE.md settles that the grid step is a
 * per-organization setting of 15, 30 or 60 minutes; that column does not exist
 * yet, so this uses 30 and reads it from one constant. When the setting lands it
 * feeds `STEP_MINUTES` and nothing else here changes.
 *
 * **The drop writes immediately and offers an undo.** That is the round-5
 * decision, and it is the right one for the job this screen does: setting up a
 * season is twenty drops, and a confirmation dialog on each would make dragging
 * slower than the form it replaces. The undo removes exactly the row the drop
 * created, by id, so it cannot delete a slot somebody else added meanwhile.
 *
 * **Keyboard parity is not optional here.** CLAUDE.md is explicit that a control
 * only a mouse can reach is a control half the staff cannot use, so every chip
 * is a real button: `KeyboardSensor` picks it up with Space, arrows move between
 * cells, Space drops, Escape cancels. dnd-kit announces each step. That is the
 * whole reason a library went in rather than more hand-rolled pointer maths.
 *
 * **A drop cannot get round a constraint.** The facility-hours trigger fires on
 * both the insert and the move, so dropping onto a closed day or a time that
 * would run past closing is refused exactly as typing it would be, and the grid
 * says so rather than silently doing nothing.
 */

/**
 * Fifteen minutes — round 5.
 *
 * CLAUDE.md settles that the step is a per-organization setting of 15, 30 or 60;
 * that column does not exist yet, so this is the finest of the three. It is the
 * finest deliberately: at 30 minutes a class starting at 06:15 had no row to
 * live in and simply did not appear, which is how a Masters turma with two slots
 * showed only one. A row too many is a longer grid; a row too few loses data.
 */
const STEP_MINUTES = 15;

/**
 * The hours the grid will draw, at most — round 5 follow-up.
 *
 * A site whose hours are the default 00:00–24:00 produced 96 rows, which is a
 * board you scroll past rather than read. Nothing in a swimming club happens
 * between midnight and six, so the grid is clamped to 06:00–24:00 and the empty
 * third of the night stops being drawn.
 *
 * **It is a clamp, not a replacement.** The window is still the site's own
 * opening hours; this only stops them running wider than the part of the day
 * anybody uses. And a class already scheduled outside it still widens the grid
 * to include itself — the 06:30 Masters class that went missing is exactly what
 * that rule exists for, and a tidier grid must not bring it back.
 */
const GRID_EARLIEST = 6 * 60;
const GRID_LATEST = 24 * 60;

/**
 * One 15-minute row, in rem — and the reason it is a number rather than a class.
 *
 * A chip has to be as tall as its class is long: 45 minutes is three rows, not
 * one. That means computing a height, which means the row height has to exist as
 * a value here rather than only as Tailwind on the cell.
 */
const ROW_REM = 1.5;

/** 45 minutes is what the slot form defaults to; only used for a turma with no slots. */
const FALLBACK_DURATION = 45;

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

function toMinutes(time: string): number {
  const [h, m] = time.split(':');
  return Number(h) * 60 + Number(m);
}

function toTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

interface Placed {
  scheduleId: string;
  groupId: string;
  name: string;
  weekday: number;
  startMinutes: number;
  durationMinutes: number;
}

export function ScheduleBoard({
  organizationId,
  groups,
  facilities,
  dayNames,
  canManage,
}: {
  organizationId: string;
  groups: ClassGroup[];
  /** Every site with its weekly hours. The picker chooses one; the grid follows it. */
  facilities: { id: string; name: string; hours: FacilityDay[] }[];
  /**
   * Indexed by ISO weekday. Supplied translated — and, on the Calendar page,
   * carrying the real date as well ("Ter · 25 ago").
   */
  dayNames: Record<number, string>;
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [pending, startPending] = useTransition();

  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ groupId: string; scheduleId: string } | null>(null);

  // Where the moved slot came from. A ref rather than state because nothing
  // renders from it — it is only read when Undo is pressed, and putting it in
  // state would re-render the grid on every drop for no visible reason.
  const undoTarget = useRef<{ weekday: number; startTime: string } | null>(null);

  /*
    One site at a time — round 5.

    Turmas from every site used to share one grid, which meant the rows had to
    span the widest hours of any of them and a class could be drawn against a day
    its own building is shut. Picking a site makes the grid mean something: these
    are that pool's hours, and these are the turmas that can go in them.
  */
  const [facilityId, setFacilityId] = useState(facilities[0]?.id ?? '');
  const facility = facilities.find((site) => site.id === facilityId) ?? facilities[0];

  const mine = useMemo(
    // A turma with no pool has no site either, and belongs to whichever site is
    // being looked at — it is exactly the turma somebody is about to place.
    () =>
      groups.filter(
        (group) => group.facilityId === null || group.facilityId === facility?.id,
      ),
    [groups, facility],
  );

  const unscheduled = useMemo(
    () => mine.filter((group) => group.schedules.length === 0),
    [mine],
  );

  const placed = useMemo<Placed[]>(
    () =>
      mine.flatMap((group) =>
        group.schedules.map((slot) => ({
          scheduleId: slot.id,
          groupId: group.id,
          name: group.name,
          weekday: slot.weekday,
          startMinutes: toMinutes(slot.startTime),
          durationMinutes: slot.durationMinutes,
        })),
      ),
    [mine],
  );

  /*
    The days this site opens — plus any day that already holds a class.

    The second half matters: closing Sunday does not delete the classes already
    on it (that is the round-4 decision), so a grid that showed only open days
    would hide them. A day that is closed but occupied is drawn, and the trigger
    still refuses anything new on it.
  */
  const openOn = (day: number): boolean =>
    facility?.hours.find((hour) => hour.weekday === day)?.available ?? true;

  const days = WEEKDAYS.filter(
    (day) => openOn(day) || placed.some((slot) => slot.weekday === day),
  );

  /*
    The rows, from the earliest opening to the latest closing across the days on
    screen — round 5.

    Per-day rows would be the truthful thing and produce a ragged grid no eye can
    scan across, so the window is the union and a cell outside its own day's
    hours is simply not a drop target. `24:00` is 1440, which is why the closing
    time is parsed rather than assumed to be a clock face.
  */
  const window = useMemo(() => {
    const opens: number[] = [];
    const closes: number[] = [];

    for (const day of days) {
      const hour = facility?.hours.find((candidate) => candidate.weekday === day);
      if (hour === undefined) continue;
      // Clamped, so a site "open" from midnight does not draw six empty hours.
      opens.push(Math.max(toMinutes(hour.opensAt), GRID_EARLIEST));
      closes.push(Math.min(toMinutes(hour.closesAt), GRID_LATEST));
    }

    // Any class already outside those hours still has to be on the grid, or the
    // bug this replaced comes straight back. Its whole length, not just its
    // start, so a class that ends after the window does not have its tail cut.
    for (const slot of placed) {
      opens.push(slot.startMinutes);
      closes.push(slot.startMinutes + slot.durationMinutes);
    }

    if (opens.length === 0) return { from: GRID_EARLIEST, to: GRID_LATEST };

    // Rounded outwards to whole steps so the first and last rows are not a
    // fraction of the others.
    const from = Math.floor(Math.min(...opens) / STEP_MINUTES) * STEP_MINUTES;
    const to = Math.ceil(Math.max(...closes) / STEP_MINUTES) * STEP_MINUTES;
    return { from, to: Math.max(to, from + STEP_MINUTES) };
  }, [days, facility, placed]);

  const rows = useMemo(() => {
    const out: number[] = [];
    for (let m = window.from; m < window.to; m += STEP_MINUTES) out.push(m);
    return out;
  }, [window]);

  const sensors = useSensors(
    // A small distance so a click on a chip's own link is still a click and not
    // the start of a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  function onDragStart(event: DragStartEvent): void {
    setDragging(String(event.active.id));
    setError(null);
  }

  function onDragEnd(event: DragEndEvent): void {
    setDragging(null);

    const over = event.over;
    if (over === null) return;

    const [, weekdayText, minutesText] = String(over.id).split(':');
    const weekday = Number(weekdayText);
    const startTime = toTime(Number(minutesText));

    const active = String(event.active.id);

    startPending(async () => {
      if (active.startsWith('group:')) {
        const groupId = active.slice('group:'.length);
        const group = mine.find((candidate) => candidate.id === groupId);
        if (group === undefined) return;

        // The turma's own length, so a second day matches the first.
        const duration = group.schedules[0]?.durationMinutes ?? FALLBACK_DURATION;

        const result = await placeSlotAction(
          organizationId,
          groupId,
          weekday,
          startTime,
          duration,
        );
        if (!result.ok) {
          setError(result.errorKey);
          return;
        }
        // The undo cannot name the new row's id — the action revalidates rather
        // than returning it — so it is offered only for the move, where the id
        // is already known. Placing is undone by removing the slot on the grid,
        // which is one click away and unambiguous.
        setUndo(null);
        return;
      }

      const scheduleId = active.slice('slot:'.length);
      const slot = placed.find((candidate) => candidate.scheduleId === scheduleId);
      if (slot === undefined) return;

      const before = { weekday: slot.weekday, startTime: toTime(slot.startMinutes) };

      const result = await moveSlotAction(
        organizationId,
        slot.groupId,
        scheduleId,
        weekday,
        startTime,
      );
      if (!result.ok) {
        setError(result.errorKey);
        return;
      }

      setUndo({ groupId: slot.groupId, scheduleId });
      // Remembered on the closure so the undo puts it back exactly, rather than
      // guessing from a grid that has already re-rendered.
      undoTarget.current = before;
    });
  }

  const draggingLabel =
    dragging === null
      ? null
      : dragging.startsWith('group:')
        ? (mine.find((group) => group.id === dragging.slice('group:'.length))?.name ?? null)
        : (placed.find((slot) => slot.scheduleId === dragging.slice('slot:'.length))?.name ?? null);

  if (!canManage) {
    return <p className="text-sm text-foreground-muted">{t('students.readOnly')}</p>;
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex flex-col gap-4">
        {/*
          The turmas with nowhere to be, at the top — round 5. They are the work
          in front of somebody setting up a season, and they were below a grid
          that is taller than the screen.
        */}
        {facilities.length > 1 && (
          <div className={`${FIELD_COLUMN} sm:w-64`}>
            <label htmlFor="board-facility" className={FIELD_LABEL}>
              {t('classes.boardFacility')}
            </label>
            <select
              id="board-facility"
              value={facilityId}
              onChange={(event) => setFacilityId(event.target.value)}
              className={CONTROL_LINE}
            >
              {facilities.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <section className="flex flex-col gap-2 rounded border border-dashed border-border bg-surface-muted p-4">
          <h3 className="text-sm font-medium">{t('classes.unscheduled')}</h3>

          {unscheduled.length === 0 ? (
            <p className="text-sm text-foreground-muted">{t('classes.allScheduled')}</p>
          ) : (
            <>
              <p className="text-sm text-foreground-muted">{t('classes.dragHint')}</p>
              {/*
                Said on both screens, and it matters most on the Calendar one,
                where the headers carry real dates: a drop changes the weekly
                pattern, so it changes every Tuesday and not the 25th.
              */}
              <p className="text-sm text-foreground-muted">{t('classes.patternNote')}</p>
              <ul className="flex flex-wrap gap-2">
                {unscheduled.map((group) => (
                  <li key={group.id}>
                    <Chip id={`group:${group.id}`} label={group.name} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {error !== null && (
          <p role="status" className="text-sm text-danger">
            {t(error)}
          </p>
        )}

        {undo !== null && (
          <p role="status" className="flex flex-wrap items-center gap-3 text-sm">
            {t('classes.slotMoved')}
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                const target = undoTarget.current;
                if (target === null) return;
                startPending(async () => {
                  await moveSlotAction(
                    organizationId,
                    undo.groupId,
                    undo.scheduleId,
                    target.weekday,
                    target.startTime,
                  );
                  setUndo(null);
                });
              }}
              className="rounded border border-border px-2 py-1 text-sm hover:border-primary/50 hover:text-primary"
            >
              {t('common.undo')}
            </button>
          </p>
        )}

        {/*
          `overflow-x-auto` on the grid, never on the page: CLAUDE.md's rule, and
          on a laptop seven columns of half-hours genuinely does not fit.
        */}
        <div className="overflow-x-auto">
          <div
            className="grid min-w-[48rem]"
            style={{ gridTemplateColumns: `4rem repeat(${days.length}, minmax(0, 1fr))` }}
          >
            <div aria-hidden />
            {days.map((day) => (
              <div
                key={day}
                className="border-b border-border pb-2 text-center text-sm font-medium uppercase tracking-wider text-foreground-muted"
              >
                {dayNames[day]}
              </div>
            ))}

            {rows.map((minutes) => (
              <Row
                key={minutes}
                minutes={minutes}
                days={days}
                placed={placed}
                dragging={dragging !== null}
                hours={facility?.hours ?? []}
              />
            ))}
          </div>
        </div>
      </div>

      {/*
        The thing under the pointer. Without it the chip vanishes at the moment
        it matters most — dnd-kit moves the original out of flow — and a drag
        with nothing following the cursor reads as a page that has broken.
      */}
      <DragOverlay>
        {draggingLabel === null ? null : (
          <span className="rounded border border-primary bg-surface px-2 py-1 text-sm font-medium shadow">
            {draggingLabel}
          </span>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function Row({
  minutes,
  days,
  placed,
  dragging,
  hours,
}: {
  minutes: number;
  days: readonly number[];
  placed: Placed[];
  dragging: boolean;
  hours: FacilityDay[];
}): React.ReactElement {
  // The hour label only on the hour: a label every half hour is a column of
  // numbers you read instead of a grid you scan.
  const onTheHour = minutes % 60 === 0;

  return (
    <>
      <div
        className={cn(
          'h-6 pr-2 text-right font-mono text-xs leading-6',
          onTheHour ? 'text-foreground-muted' : 'text-transparent',
        )}
      >
        {toTime(minutes)}
      </div>

      {days.map((day) => {
        const here = placed.find(
          (slot) => slot.weekday === day && slot.startMinutes === minutes,
        );
        return (
          <Cell
            key={`${day}-${minutes}`}
            day={day}
            minutes={minutes}
            slot={here}
            onTheHour={onTheHour}
            dragging={dragging}
            open={isOpen(hours, day, minutes)}
          />
        );
      })}
    </>
  );
}

/**
 * Whether the site is open on this weekday at this minute.
 *
 * A cell outside its own day's hours is drawn — the grid has to be rectangular
 * to be scannable — but it is not a drop target and it says so by being dim. The
 * facility-hours trigger would refuse the write anyway; this is the difference
 * between a control that refuses and one that never invited you.
 */
function isOpen(hours: FacilityDay[], day: number, minutes: number): boolean {
  const hour = hours.find((candidate) => candidate.weekday === day);
  if (hour === undefined) return true;
  if (!hour.available) return false;
  return minutes >= toMinutes(hour.opensAt) && minutes < toMinutes(hour.closesAt);
}

function Cell({
  day,
  minutes,
  slot,
  onTheHour,
  dragging,
  open,
}: {
  day: number;
  minutes: number;
  slot: Placed | undefined;
  onTheHour: boolean;
  dragging: boolean;
  open: boolean;
}): React.ReactElement {
  // A closed cell is still rendered, so the grid stays rectangular — it just
  // never registers as somewhere to drop.
  const { setNodeRef, isOver } = useDroppable({
    id: `cell:${day}:${minutes}`,
    disabled: !open,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        // `relative` and a fixed height: a spanning chip is positioned against
        // this cell, and its height is computed from the row height.
        'relative h-6 border-l border-border px-0.5',
        onTheHour ? 'border-t border-border' : 'border-t border-border/40',
        // Open slots only light up while something is being dragged — a grid
        // that is permanently striped with "you could drop here" is noise for
        // the 99% of the time nobody is dragging.
        !open && 'bg-surface-muted/60',
        dragging && open && slot === undefined && 'bg-primary/5',
        isOver && 'bg-primary/25 outline outline-2 outline-primary',
      )}
    >
      {slot !== undefined && (
        /*
          As tall as the class is long — round 5 follow-up.

          Every chip used to occupy one 15-minute row whatever its duration, so a
          45-minute class and a 15-minute one looked identical and the grid said
          nothing about how much of the morning was actually taken. Absolutely
          positioned out of the cell's flow so it can cover the rows beneath it,
          which are the rows that class genuinely occupies; `-1px` keeps a
          hairline between one chip and the next.
        */
        <div
          className="absolute inset-x-1 top-0 z-10"
          style={{
            height: `calc(${(slot.durationMinutes / STEP_MINUTES) * ROW_REM}rem - 1px)`,
          }}
        >
          <Chip
            id={`slot:${slot.scheduleId}`}
            label={slot.name}
            time={toTime(slot.startMinutes)}
            placed
          />
        </div>
      )}
    </div>
  );
}

/**
 * A turma you can pick up — with a pointer or with a keyboard.
 *
 * A real `<button>`, so Tab reaches it and Space picks it up; the grip is a
 * second, visual cue that it moves, because "this is draggable" carried only by
 * a cursor change is information a touch user never receives.
 */
function Chip({
  id,
  label,
  time,
  placed,
}: {
  id: string;
  label: string;
  /** Shown on a placed chip, so the exact start is on the grid and not only implied by the row. */
  time?: string;
  placed?: boolean;
}): React.ReactElement {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
      className={cn(
        'flex h-full w-full cursor-grab items-start gap-1 overflow-hidden rounded border px-1.5 py-0.5 text-left text-xs font-medium',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
        placed
          ? 'border-primary/40 bg-primary/10'
          : 'border-border bg-surface hover:border-primary/50',
        isDragging && 'opacity-40',
      )}
    >
      <GripVertical aria-hidden className="mt-0.5 size-3 shrink-0 text-foreground-muted" />
      <span className="min-w-0 flex-1 leading-tight">
        <span className="line-clamp-2 break-words">{label}</span>
        {time !== undefined && (
          <span className="block font-mono text-[0.65rem] font-normal text-foreground-muted">
            {time}
          </span>
        )}
      </span>
    </button>
  );
}
