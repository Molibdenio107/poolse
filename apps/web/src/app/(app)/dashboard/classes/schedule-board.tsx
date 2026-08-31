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
import { GripVertical, Lock } from 'lucide-react';
import type { ClassGroup, FacilityDay } from '@/lib/api';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';
import { slotKey } from '@/lib/slot-key';
import { cn } from '@/lib/utils';
import { moveSlotAction, placeSlotAction } from './classes.actions';

/**
 * The week: what is happening, and how to change it — round 5.
 *
 * **One grid, not two.** This screen carried a drag board for the weekly pattern
 * and, below it, a read-only grid of the week's real sessions with the register
 * and cancel controls on them. The same class appeared twice, and the two
 * answers to "what happens on Tuesday" were a screen apart. This is both: the
 * columns are dated, the chips are the sessions that actually exist, and
 * dragging one edits the pattern behind it.
 *
 * **What a drag changes is still the pattern.** A class on screen is one
 * Tuesday; the row you move belongs to every Tuesday. That is stated on the
 * board rather than left to be discovered, because it is the one thing here
 * somebody could reasonably get wrong.
 *
 * **A closed day is locked and named.** Feriados and encerramentos are dated, so
 * they lock the column for the week being looked at and say which closure did
 * it. Page to another week and the day is open again — which is true, and is why
 * the name matters more than the shading.
 *
 * **Rows come from the site's own opening hours**, clamped to 06:00–24:00 and
 * widened by any class outside them. That last rule is not tidiness: a 06:30
 * class at a site whose grid began at 07:00 was invisible, which is how a turma
 * with two slots showed one.
 *
 * **Keyboard parity.** Every chip is a real button: Space picks it up, arrows
 * move, Space drops, Escape cancels, and dnd-kit announces each step.
 */

/** See the header — one constant until the per-organization setting exists. */
const STEP_MINUTES = 15;
const GRID_EARLIEST = 6 * 60;
const GRID_LATEST = 24 * 60;

/** One row, in rem. A chip's height is computed from it, so it is a number. */
const ROW_REM = 1.5;

/** Only used for a turma with no slot to copy a length from. */
const FALLBACK_DURATION = 45;

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

function toMinutes(time: string): number {
  const [h, m] = time.split(':');
  return Number(h) * 60 + Number(m);
}

function toTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * What the page hands over for one slot in the week on screen.
 *
 * Keyed by `groupId|weekday|startTime` rather than by session id, because the
 * grid is drawn from the *pattern* and looks the session up — see the note on
 * `placed`.
 */
export interface SessionControls {
  /** "Take the register", already pointed at the right week. */
  mark?: { href: string; label: string } | undefined;
  /** The cancel/restore form — a client component the page renders. */
  cancel?: React.ReactNode;
  /** Whether this week's occurrence is cancelled, and why. */
  cancelled?: boolean;
  note?: string | null;
}


interface Placed {
  key: string;
  /** Null when nothing in the pattern matches — a session that cannot be dragged. */
  scheduleId: string | null;
  groupId: string;
  name: string;
  subtitle: string | null;
  weekday: number;
  startMinutes: number;
  durationMinutes: number;
  cancelled: boolean;
  note: string | null;
  controls: SessionControls;
}

/**
 * What a drop is asking for, before anybody has agreed to it.
 *
 * `from` on a move is what an undo needs afterwards, kept here so the two
 * halves — confirm, then undo — read off the same object.
 */
type Proposal =
  | {
      kind: 'place';
      groupId: string;
      name: string;
      weekday: number;
      startTime: string;
      durationMinutes: number;
    }
  | {
      kind: 'move';
      groupId: string;
      scheduleId: string;
      name: string;
      weekday: number;
      startTime: string;
      from: { weekday: number; startTime: string };
    };

export function ScheduleBoard({
  organizationId,
  groups,
  facilities,
  closures,
  controls,
  dayNames,
  canManage,
}: {
  organizationId: string;
  groups: ClassGroup[];
  facilities: { id: string; name: string; hours: FacilityDay[] }[];
  /** Closed days in the week on screen, by ISO weekday, with the reason. */
  closures: { weekday: number; reason: string }[];
  /** Register and cancel controls, keyed by `slotKey`. */
  controls: Record<string, SessionControls>;
  /** Dated headers — "Ter · 25 ago". */
  dayNames: Record<number, string>;
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [pending, startPending] = useTransition();

  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  /*
   * What a drop proposed, waiting to be confirmed — round 5.
   *
   * A drag used to save the moment the pointer was released, which made a
   * mis-aimed drop a real change to a real timetable that the operator then had
   * to notice and undo. Asking first costs one click and removes a whole class
   * of accident; the undo afterwards stays, for the drop that was deliberate and
   * wrong.
   */
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [undo, setUndo] = useState<{ groupId: string; scheduleId: string } | null>(null);
  const undoTarget = useRef<{ weekday: number; startTime: string } | null>(null);

  const [facilityId, setFacilityId] = useState(facilities[0]?.id ?? '');
  const facility = facilities.find((site) => site.id === facilityId) ?? facilities[0];

  // A turma with no pool has no site either, and is exactly the one somebody is
  // about to place — so it belongs to whichever site is being looked at.
  const mine = useMemo(
    () => groups.filter((group) => group.facilityId === null || group.facilityId === facility?.id),
    [groups, facility],
  );

  const unscheduled = useMemo(
    () => mine.filter((group) => group.schedules.length === 0),
    [mine],
  );

  /*
   * Drawn from the pattern, not from the generated sessions.
   *
   * This was the other way round for one commit and it was wrong. The chips were
   * `class_session` rows, and a drag edits `class_schedule` — so moving a class
   * updated the pattern and left the chip exactly where it was, because the
   * session for that week had not moved. It looked like the drag did nothing.
   *
   * Regenerating after each drag is not the fix either: `generate_sessions`
   * inserts what the pattern implies and does not remove a session whose slot
   * has moved away, so the class would appear twice — once where it used to be
   * and once where it now is.
   *
   * So the weekly pattern is what the grid draws, which is also the thing a drag
   * changes, and the session for the week on screen is looked up to supply the
   * register link, the cancel control and the cancelled state. A slot with no
   * session yet is still a real class on a real day; it simply has nothing to
   * mark until the season is generated.
   */
  const placed = useMemo<Placed[]>(
    () =>
      mine.flatMap((group) =>
        group.schedules.map((slot) => {
          const extra = controls[slotKey(group.id, slot.weekday, slot.startTime)] ?? {};

          return {
            key: slot.id,
            scheduleId: slot.id,
            groupId: group.id,
            name: group.name,
            subtitle:
              [
                group.poolName,
                group.lane === null ? null : t('classes.laneN', { lane: group.lane }),
                group.instructorName,
              ]
                .filter(Boolean)
                .join(' · ') || null,
            weekday: slot.weekday,
            startMinutes: toMinutes(slot.startTime),
            durationMinutes: slot.durationMinutes,
            cancelled: extra.cancelled === true,
            note: extra.note ?? null,
            controls: extra,
          };
        }),
      ),
    [mine, controls, t],
  );

  const closedOn = (day: number): string | null =>
    closures.find((closure) => closure.weekday === day)?.reason ?? null;

  const openOn = (day: number): boolean =>
    facility?.hours.find((hour) => hour.weekday === day)?.available ?? true;

  // Open days, plus any day that already holds a class: closing a day does not
  // delete what is on it, and a grid that hid those would hide real classes.
  const days = WEEKDAYS.filter(
    (day) => openOn(day) || placed.some((slot) => slot.weekday === day),
  );

  const bounds = useMemo(() => {
    const opens: number[] = [];
    const closes: number[] = [];

    for (const day of days) {
      const hour = facility?.hours.find((candidate) => candidate.weekday === day);
      if (hour === undefined) continue;
      opens.push(Math.max(toMinutes(hour.opensAt), GRID_EARLIEST));
      closes.push(Math.min(toMinutes(hour.closesAt), GRID_LATEST));
    }

    // A class already outside those hours widens the grid to itself, or the bug
    // this replaced comes straight back.
    for (const slot of placed) {
      opens.push(slot.startMinutes);
      closes.push(slot.startMinutes + slot.durationMinutes);
    }

    if (opens.length === 0) return { from: GRID_EARLIEST, to: GRID_LATEST };

    const from = Math.floor(Math.min(...opens) / STEP_MINUTES) * STEP_MINUTES;
    const to = Math.ceil(Math.max(...closes) / STEP_MINUTES) * STEP_MINUTES;
    return { from, to: Math.max(to, from + STEP_MINUTES) };
  }, [days, facility, placed]);

  const rows = useMemo(() => {
    const out: number[] = [];
    for (let m = bounds.from; m < bounds.to; m += STEP_MINUTES) out.push(m);
    return out;
  }, [bounds]);

  const sensors = useSensors(
    // A distance, so a click on a control inside a chip is a click and not a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  function onDragStart(event: DragStartEvent): void {
    setDragging(String(event.active.id));
    setError(null);
  }

  /*
   * A drop describes what it would do, and nothing is written yet.
   *
   * Both kinds of drop go through the same proposal — placing an unscheduled
   * turma and moving one already on the grid — because the question is the same
   * question and two dialogs would eventually word it differently.
   */
  function onDragEnd(event: DragEndEvent): void {
    setDragging(null);

    const over = event.over;
    if (over === null) return;

    const [, weekdayText, minutesText] = String(over.id).split(':');
    const weekday = Number(weekdayText);
    const startTime = toTime(Number(minutesText));
    const active = String(event.active.id);

    if (active.startsWith('group:')) {
      const groupId = active.slice('group:'.length);
      const group = mine.find((candidate) => candidate.id === groupId);
      if (group === undefined) return;

      setProposal({
        kind: 'place',
        groupId,
        name: group.name,
        weekday,
        startTime,
        durationMinutes: group.schedules[0]?.durationMinutes ?? FALLBACK_DURATION,
      });
      return;
    }

    const scheduleId = active.slice('slot:'.length);
    const slot = placed.find((candidate) => candidate.scheduleId === scheduleId);
    if (slot === undefined || slot.scheduleId === null) return;

    // A drop back where it started is not a move, and asking about it would be
    // asking whether to do nothing.
    if (slot.weekday === weekday && toTime(slot.startMinutes) === startTime) return;

    setProposal({
      kind: 'move',
      groupId: slot.groupId,
      scheduleId: slot.scheduleId,
      name: slot.name,
      weekday,
      startTime,
      from: { weekday: slot.weekday, startTime: toTime(slot.startMinutes) },
    });
  }

  /** The proposal, carried out. Nothing before this writes anything. */
  function confirm(): void {
    const asked = proposal;
    if (asked === null) return;

    setProposal(null);
    setError(null);

    startPending(async () => {
      if (asked.kind === 'place') {
        const result = await placeSlotAction(
          organizationId,
          asked.groupId,
          asked.weekday,
          asked.startTime,
          asked.durationMinutes,
        );
        if (!result.ok) setError(result.errorKey);
        else setUndo(null);
        return;
      }

      const result = await moveSlotAction(
        organizationId,
        asked.groupId,
        asked.scheduleId,
        asked.weekday,
        asked.startTime,
      );
      if (!result.ok) {
        setError(result.errorKey);
        return;
      }

      // Kept after the save, and this is the second half of what was asked for:
      // a move that was confirmed on purpose and is still wrong goes back in one
      // click, to the exact day and time it came from.
      setUndo({ groupId: asked.groupId, scheduleId: asked.scheduleId });
      undoTarget.current = asked.from;
    });
  }

  const draggingLabel =
    dragging === null
      ? null
      : dragging.startsWith('group:')
        ? (mine.find((group) => group.id === dragging.slice('group:'.length))?.name ?? null)
        : (placed.find((slot) => slot.scheduleId === dragging.slice('slot:'.length))?.name ?? null);

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex flex-col gap-4">
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

        {canManage && (
          <section className="flex flex-col gap-2 rounded border border-dashed border-border bg-surface-muted p-4">
            <h3 className="text-sm font-medium">{t('classes.unscheduled')}</h3>

            {unscheduled.length === 0 ? (
              <p className="text-sm text-foreground-muted">{t('classes.allScheduled')}</p>
            ) : (
              <>
                <p className="text-sm text-foreground-muted">{t('classes.dragHint')}</p>
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
        )}

        {error !== null && (
          <p role="status" className="text-sm text-danger">
            {t(error)}
          </p>
        )}

        {/*
          Asked in place rather than in a modal over the grid: the answer depends
          on where the class landed, and covering the timetable to ask about the
          timetable would hide the evidence.

          Both buttons are real buttons, so the keyboard and a screen reader get
          the same two choices as the pointer.
        */}
        {proposal !== null && (
          <div
            role="alertdialog"
            aria-labelledby="move-question"
            className="flex flex-wrap items-center gap-3 rounded border border-primary/40 bg-primary/5 p-4"
          >
            <p id="move-question" className="text-sm">
              {t(proposal.kind === 'move' ? 'classes.confirmMove' : 'classes.confirmPlace', {
                name: proposal.name,
                day: dayNames[proposal.weekday] ?? '',
                time: proposal.startTime.slice(0, 5),
              })}
            </p>
            <span className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={confirm}
                disabled={pending}
                className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
              >
                {t(proposal.kind === 'move' ? 'classes.doMove' : 'classes.doPlace')}
              </button>
              <button
                type="button"
                onClick={() => setProposal(null)}
                className="rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-muted"
              >
                {t('common.undo')}
              </button>
            </span>
          </div>
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

        {/* The grid scrolls sideways inside itself, never the page. */}
        <div className="overflow-x-auto">
          <div
            className="grid min-w-[52rem]"
            style={{ gridTemplateColumns: `4rem repeat(${days.length}, minmax(0, 1fr))` }}
          >
            <div aria-hidden />
            {days.map((day) => {
              const closed = closedOn(day);
              return (
                <div
                  key={day}
                  className="border-b border-border pb-2 text-center text-sm font-medium uppercase tracking-wider text-foreground-muted"
                >
                  {dayNames[day]}
                  {/*
                    The closure's name, not just a shade. A dim column says
                    something is different; "Natal" says what, which is the
                    question the operator actually has.
                  */}
                  {closed !== null && (
                    <span className="mt-0.5 flex items-center justify-center gap-1 text-xs font-normal normal-case text-warning">
                      <Lock aria-hidden className="size-3" />
                      {closed}
                    </span>
                  )}
                </div>
              );
            })}

            {rows.map((minutes) => (
              <Row
                key={minutes}
                minutes={minutes}
                days={days}
                placed={placed}
                dragging={dragging !== null}
                hours={facility?.hours ?? []}
                closedOn={closedOn}
                canManage={canManage}
              />
            ))}
          </div>
        </div>
      </div>

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
  closedOn,
  canManage,
}: {
  minutes: number;
  days: readonly number[];
  placed: Placed[];
  dragging: boolean;
  hours: FacilityDay[];
  closedOn: (day: number) => string | null;
  canManage: boolean;
}): React.ReactElement {
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

      {days.map((day) => (
        <Cell
          key={`${day}-${minutes}`}
          day={day}
          minutes={minutes}
          slot={placed.find((s) => s.weekday === day && s.startMinutes === minutes)}
          onTheHour={onTheHour}
          dragging={dragging}
          open={isOpen(hours, day, minutes) && closedOn(day) === null}
          canManage={canManage}
        />
      ))}
    </>
  );
}

/**
 * Whether the site is open on this weekday at this minute.
 *
 * A cell outside its own day's hours is still drawn — the grid has to be
 * rectangular to be scannable — but it never registers as a drop target. The
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
  canManage,
}: {
  day: number;
  minutes: number;
  slot: Placed | undefined;
  onTheHour: boolean;
  dragging: boolean;
  open: boolean;
  canManage: boolean;
}): React.ReactElement {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell:${day}:${minutes}`,
    disabled: !open || !canManage,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'relative h-6 border-l border-border px-0.5',
        onTheHour ? 'border-t border-border' : 'border-t border-border/40',
        !open && 'bg-surface-muted/60',
        dragging && open && slot === undefined && 'bg-primary/5',
        isOver && 'bg-primary/25 outline outline-2 outline-primary',
      )}
    >
      {slot !== undefined && (
        // Out of flow, so it can cover the rows its class actually occupies.
        <div
          className="absolute inset-x-1 top-0 z-10"
          style={{
            height: `calc(${(slot.durationMinutes / STEP_MINUTES) * ROW_REM}rem - 1px)`,
          }}
        >
          <SessionChip slot={slot} canManage={canManage} />
        </div>
      )}
    </div>
  );
}

/**
 * A class on the grid: what it is, and the two things you do to it.
 *
 * The register and cancel controls live inside the chip, and the drag must not
 * start from them — a pointer landing on "Cancelar" has to cancel, not pick the
 * class up. `stopPropagation` on pointer-down is what separates the two; the 6px
 * activation distance means an ordinary click never starts a drag anyway.
 *
 * A cancelled class is struck through and keeps its reason: "why is there no
 * class on the 15th" is the question this grid exists to answer.
 */
function SessionChip({
  slot,
  canManage,
}: {
  slot: Placed;
  canManage: boolean;
}): React.ReactElement {
  const draggable = canManage && slot.scheduleId !== null && !slot.cancelled;

  return (
    <div
      className={cn(
        'flex h-full w-full flex-col overflow-hidden rounded border px-1.5 py-0.5 text-xs',
        slot.cancelled
          ? 'border-dashed border-border bg-surface-muted'
          : 'border-primary/40 bg-primary/10',
      )}
    >
      <Chip
        id={slot.scheduleId === null ? `static:${slot.key}` : `slot:${slot.scheduleId}`}
        label={slot.name}
        time={toTime(slot.startMinutes)}
        subtitle={slot.subtitle}
        cancelled={slot.cancelled}
        draggable={draggable}
        bare
      />

      {slot.note !== null && (
        <span className="truncate text-[0.65rem] font-medium text-warning">{slot.note}</span>
      )}

      {(slot.controls.mark !== undefined || slot.controls.cancel !== undefined) && (
        <div
          className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-0.5 pt-0.5"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {slot.controls.mark !== undefined && (
            <a
              href={slot.controls.mark.href}
              className="rounded text-[0.65rem] font-medium text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
            >
              {slot.controls.mark.label}
            </a>
          )}
          {slot.controls.cancel}
        </div>
      )}
    </div>
  );
}

/**
 * A thing you can pick up — with a pointer or a keyboard.
 *
 * A real `<button>`, so Tab reaches it and Space picks it up; the grip is the
 * second cue, because "this is draggable" carried only by a cursor change is
 * information a touch user never receives.
 */
function Chip({
  id,
  label,
  time,
  subtitle,
  cancelled,
  placed,
  bare,
  draggable = true,
}: {
  id: string;
  label: string;
  time?: string;
  subtitle?: string | null;
  cancelled?: boolean;
  placed?: boolean;
  /** Inside a session chip, which already draws the border and the background. */
  bare?: boolean;
  draggable?: boolean;
}): React.ReactElement {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    disabled: !draggable,
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...(draggable ? listeners : {})}
      {...attributes}
      className={cn(
        'flex w-full items-start gap-1 text-left text-xs font-medium',
        draggable ? 'cursor-grab' : 'cursor-default',
        bare === true
          ? ''
          : cn(
              'rounded border px-1.5 py-0.5',
              placed === true
                ? 'border-primary/40 bg-primary/10'
                : 'border-border bg-surface hover:border-primary/50',
            ),
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
        isDragging && 'opacity-40',
      )}
    >
      {draggable && (
        <GripVertical aria-hidden className="mt-0.5 size-3 shrink-0 text-foreground-muted" />
      )}
      <span className="min-w-0 flex-1 leading-tight">
        <span className={cn('line-clamp-2 break-words', cancelled === true && 'line-through')}>
          {label}
        </span>
        {time !== undefined && (
          <span className="block font-mono text-[0.65rem] font-normal text-foreground-muted">
            {time}
          </span>
        )}
        {subtitle !== undefined && subtitle !== null && (
          <span className="block truncate text-[0.65rem] font-normal text-foreground-muted">
            {subtitle}
          </span>
        )}
      </span>
    </button>
  );
}
