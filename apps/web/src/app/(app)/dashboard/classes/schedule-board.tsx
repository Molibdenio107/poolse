'use client';

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from 'react';
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
import type {
  ClassGroup,
  FacilityDay,
  GridBooking,
  GridLane,
  GridSlot,
} from '@/lib/api';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';
import { slotKey } from '@/lib/slot-key';
import { cn } from '@/lib/utils';
import { addDays } from '@/lib/dates';
import { moveOccurrenceAction, moveSlotAction, placeSlotAction } from './classes.actions';

/**
 * The week: what is happening, and how to change it — POOLSE-49.
 *
 * **The grid's rows are the facility's slots, subdivided by lane.** That is what
 * this ticket changed, and it is the whole point. The board used to draw one row
 * per fifteen minutes and one cell per day, which cannot show that Sandra is
 * running Cadetes, Infantis and Absolutos at the same time on lanes 2, 3 and 4 —
 * and that is not an exotic case, it is what the club's printed sheet looks like
 * every morning. The drop target is now `(day, slot, lane)`.
 *
 * `STEP_MINUTES`, `GRID_EARLIEST` and `GRID_LATEST` are gone with the lattice
 * they scaffolded. The rule they carried — that a 06:30 class widened the grid
 * rather than disappearing — is now **"fora da grelha"**, a named block under the
 * grid, which is the honest successor: the class is visible, and the grid is
 * still the club's own grid rather than one stretched by an exception.
 *
 * **One grid, not two.** This screen carried a drag board for the weekly pattern
 * and, below it, a read-only grid of the week's real sessions. The same class
 * appeared twice and the two answers to "what happens on Tuesday" were a screen
 * apart. This is both: the columns are dated, the chips are real bookings, and
 * dragging one edits the pattern behind it.
 *
 * **What a drag changes is still the pattern.** A class on screen is one
 * Tuesday; the row you move belongs to every Tuesday. That is stated on the
 * board rather than left to be discovered.
 *
 * **A closed day is locked and named.** Feriados and encerramentos are dated, so
 * they lock the column for the week being looked at and say which closure did
 * it. Page to another week and the day is open again.
 *
 * **Keyboard parity.** Every chip is a real button: Space picks it up, arrows
 * move, Space drops, Escape cancels, and dnd-kit announces each step. Every cell
 * carries a label naming its day, slot and lane, so moving through the grid with
 * a screen reader says where you are rather than reading eighty-four blanks.
 */

/** One lane row, in rem, at each density. A chip's height is computed from it. */
const ROW_REM = { compacta: 1.125, confortavel: 1.75 } as const;

type Density = keyof typeof ROW_REM;

/** Only used for a turma with no slot to copy a length from. */
const FALLBACK_DURATION = 45;

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** The weekday block is 2ª–6ª; Saturday and Sunday have their own slots. */
const WEEKDAY_DAYS = [1, 2, 3, 4, 5] as const;

/** Rail widths, in rem. Shared by the sticky offsets and the column template. */
const TIME_COL = 3.75;
const LANE_COL = 4.5;

function toMinutes(time: string): number {
  const [h, m] = time.split(':');
  return Number(h) * 60 + Number(m);
}

function toTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * The category palette, as design tokens rather than literal colour.
 *
 * `category_colour` is a closed enum in the schema; this is its only mapping to
 * something a browser can paint. Tokens, not hex — CLAUDE.md's rule — so both
 * themes are handled by the token layer and a cell stays legible in dark mode
 * without a second table of colours here.
 *
 * **Colour never carries meaning alone.** Every cell prints its group name, and
 * the legend names each category in words beside its swatch. This is the cue that
 * makes a full grid scannable, not the cue that makes it readable.
 */
const CATEGORY_TINT: Record<string, string> = {
  slate: 'border-border bg-surface-muted',
  blue: 'border-primary/40 bg-primary/10',
  green: 'border-success/40 bg-success/10',
  amber: 'border-warning/40 bg-warning/10',
  red: 'border-danger/40 bg-danger/10',
  violet: 'border-accent/40 bg-accent/10',
};

const DEFAULT_TINT = 'border-primary/40 bg-primary/10';

/**
 * What the page hands over for one slot in the week on screen.
 *
 * Keyed by `groupId|weekday|startTime` rather than by session id, because the
 * grid is drawn from the *pattern* and looks the session up — see the note on
 * `placed`.
 */
export interface SessionControls {
  /**
   * This week's occurrence, when one has been generated.
   *
   * It is what makes "only this week" answerable: the pattern has no date and
   * a session does. Absent on the turma screen, which draws the pattern alone.
   */
  sessionId?: string | undefined;
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
  /** Null for anything that is not a turma. A parceria takes no register. */
  groupId: string | null;
  name: string;
  subtitle: string | null;
  instructorName: string | null;
  instructorStatus: 'assigned' | 'unassigned' | 'external';
  headcount: number | null;
  categoryId: string | null;
  categoryColour: string | null;
  /** Hex, for a parceria. Beats the category's colour where it is present. */
  partnerColour: string | null;
  partnerId: string | null;
  levelId: string | null;
  instructorId: string | null;
  weekday: number;
  startMinutes: number;
  durationMinutes: number;
  /** Null means fora da grelha — drawn under the grid, never lost. */
  slotId: string | null;
  laneIds: string[];
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
      /** This week's session, when there is a week on screen and one exists. */
      occurrence: { sessionId: string; date: string } | null;
    };

type Optimistic =
  | { kind: 'place'; groupId: string; weekday: number; startMinutes: number; durationMinutes: number }
  | { kind: 'move'; scheduleId: string; weekday: number; startMinutes: number };

/**
 * The viewer's own preferences — density, which pool, what is filtered.
 *
 * `localStorage`, wrapped in try/catch because it throws outright in some
 * privacy modes rather than returning null, and a grid that fails to render
 * because somebody has cookies locked down is worse than a grid that forgets a
 * toggle. Per-viewer convenience, never shared state: two people looking at the
 * same club see the same timetable, and their own density.
 */
const PREFS_KEY = 'poolse.laneGrid.prefs';

interface Prefs {
  density: Density;
  hideEmptyLanes: boolean;
  poolId: string;
  instructorId: string;
  categoryId: string;
  partnerId: string;
  levelId: string;
}

const DEFAULT_PREFS: Prefs = {
  density: 'confortavel',
  hideEmptyLanes: false,
  poolId: '',
  instructorId: '',
  categoryId: '',
  partnerId: '',
  levelId: '',
};

function readPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (raw === null) return DEFAULT_PREFS;
    // Spread over the defaults, so a preference added later does not arrive
    // undefined on a viewer who stored the older shape.
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function ScheduleBoard({
  organizationId,
  groups,
  facilities,
  closures,
  controls,
  dayNames,
  canManage,
  weekStart,
  slots,
  lanes,
  pools,
  bookings,
  categories,
  instructors,
  partners,
  levels,
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
  /**
   * The Monday of the week on screen, when the board is showing one.
   *
   * The calendar passes it and the turma screen does not, and that difference
   * is what decides whether a drop can mean "only this week". Without a date
   * there is no single week to move.
   */
  weekStart?: string | undefined;
  /** The facility's grid rows — POOLSE-44. Empty means no grid has been built. */
  slots: GridSlot[];
  lanes: GridLane[];
  pools: { id: string; name: string }[];
  /** Everything in the season, whatever its subject — POOLSE-49. */
  bookings: GridBooking[];
  categories: { id: string; name: string; colour: string }[];
  instructors: { id: string; name: string }[];
  partners: { id: string; name: string; colour: string }[];
  levels: { id: string; name: string }[];
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
  /** The same drop, drawn on the grid while the dialog asks about it. */
  const [optimistic, setOptimistic] = useState<Optimistic | null>(null);
  const [undo, setUndo] = useState<{ groupId: string; scheduleId: string } | null>(null);
  const undoTarget = useRef<{ weekday: number; startTime: string } | null>(null);

  const [facilityId, setFacilityId] = useState(facilities[0]?.id ?? '');
  const facility = facilities.find((site) => site.id === facilityId) ?? facilities[0];

  /*
   * Preferences load after mount, not during render.
   *
   * `localStorage` does not exist on the server, and reading it in a `useState`
   * initialiser makes the first client render disagree with the server's — a
   * hydration mismatch that React resolves by throwing the markup away. So: the
   * defaults render, and the viewer's own choices arrive a tick later.
   */
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  useEffect(() => setPrefs(readPrefs()), []);

  function update(patch: Partial<Prefs>): void {
    setPrefs((was) => {
      const next = { ...was, ...patch };
      try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        // A viewer with storage blocked keeps the choice for this visit only,
        // which is the right amount of degradation for a convenience.
      }
      return next;
    });
  }

  // A turma with no pool has no site either, and is exactly the one somebody is
  // about to place — so it belongs to whichever site is being looked at.
  const mine = useMemo(
    () => groups.filter((group) => group.facilityId === null || group.facilityId === facility?.id),
    [groups, facility],
  );

  const unscheduled = useMemo(
    () =>
      mine.filter(
        (group) =>
          group.schedules.length === 0 &&
          // Already on the grid, waiting to be confirmed. Leaving it in the tray
          // as well would show the same turma twice and invite a second drop.
          !(optimistic?.kind === 'place' && optimistic.groupId === group.id),
      ),
    [mine, optimistic],
  );

  /*
   * The chips, from the season's bookings.
   *
   * These used to be derived from the turma patterns alone, which is why a
   * parceria could not appear on this screen at all. `bookings` is every subject
   * on the grid — turmas, parcerias, eventos, manutenções — and the register
   * controls are still looked up by `slotKey`, so a turma keeps everything it
   * had and everything else simply has no controls, which is correct: POOLSE-46
   * settled that a parceria takes no register.
   */
  const placed = useMemo(() => {
    const rows: Placed[] = bookings.map((booking) => {
      const startMinutes = toMinutes(booking.startTime);
      const key =
        booking.classGroupId === null
          ? `booking:${booking.id}`
          : slotKey(booking.classGroupId, booking.weekday, booking.startTime);
      const control = controls[key] ?? {};

      return {
        key,
        scheduleId: booking.id,
        groupId: booking.classGroupId,
        name: booking.name,
        subtitle: booking.subtitle,
        instructorName: booking.instructorName,
        instructorStatus: booking.instructorStatus,
        headcount: booking.headcount,
        categoryId: booking.categoryId,
        categoryColour: booking.categoryColour,
        partnerColour: booking.partnerColour,
        partnerId: booking.partnerId,
        levelId: booking.levelId,
        instructorId: booking.instructorId,
        weekday: booking.weekday,
        startMinutes,
        durationMinutes: booking.durationMinutes,
        slotId: booking.slotId,
        laneIds: booking.laneIds,
        cancelled: control.cancelled ?? false,
        note: control.note ?? null,
        controls: control,
      };
    });

    /*
     * The drop being asked about, drawn where it was dropped.
     *
     * Laid over the server's data rather than mixed into it, so answering "no"
     * is just dropping the overlay — nothing has to be un-computed.
     */
    if (optimistic?.kind === 'move') {
      const target = rows.find((row) => row.scheduleId === optimistic.scheduleId);
      if (target !== undefined) {
        target.weekday = optimistic.weekday;
        target.startMinutes = optimistic.startMinutes;
      }
    }

    if (optimistic?.kind === 'place') {
      const group = mine.find((candidate) => candidate.id === optimistic.groupId);
      if (group !== undefined) {
        rows.push({
          key: `optimistic:${group.id}`,
          scheduleId: null,
          groupId: group.id,
          name: group.name,
          subtitle: group.levelName ?? null,
          instructorName: null,
          instructorStatus: 'assigned',
          headcount: null,
          categoryId: null,
          categoryColour: null,
          partnerColour: null,
          partnerId: null,
          levelId: group.levelId ?? null,
          instructorId: null,
          weekday: optimistic.weekday,
          startMinutes: optimistic.startMinutes,
          durationMinutes: optimistic.durationMinutes,
          slotId: null,
          laneIds: [],
          cancelled: false,
          note: null,
          controls: {},
        });
      }
    }

    return rows;
  }, [bookings, controls, optimistic, mine]);

  /*
   * The filters, applied to the chips rather than to the rows.
   *
   * Hiding a *lane* because nothing on it survived a filter would tell the
   * reader the lane does not exist; hiding the chip leaves the grid's shape
   * intact and the hole visible, which is what a planner is looking for.
   */
  const visible = useMemo(
    () =>
      placed.filter(
        (row) =>
          (prefs.instructorId === '' || row.instructorId === prefs.instructorId) &&
          (prefs.categoryId === '' || row.categoryId === prefs.categoryId) &&
          (prefs.partnerId === '' || row.partnerId === prefs.partnerId) &&
          (prefs.levelId === '' || row.levelId === prefs.levelId),
      ),
    [placed, prefs],
  );

  const closedOn = (day: number): string | null =>
    closures.find((closure) => closure.weekday === day)?.reason ?? null;

  const openOn = (day: number): boolean =>
    facility?.hours.find((hour) => hour.weekday === day)?.available ?? true;

  /*
   * The pool being shown, and "todos os tanques" as an explicit choice.
   *
   * The default is one pool on purpose: a four-tank club with six lanes each is
   * 336 rows on first paint, which is a screen nobody can read and a render
   * nobody asked for. Seeing all of them is a decision, and it stacks them with
   * each pool named.
   */
  const poolIds = useMemo(() => {
    if (prefs.poolId === 'all') return pools.map((pool) => pool.id);
    const chosen = pools.find((pool) => pool.id === prefs.poolId)?.id ?? pools[0]?.id;
    return chosen === undefined ? [] : [chosen];
  }, [prefs.poolId, pools]);

  /** Which lanes have anything on them at all, for "esconder pistas vazias". */
  const busyLanes = useMemo(() => {
    const seen = new Set<string>();
    for (const row of visible) for (const laneId of row.laneIds) seen.add(laneId);
    return seen;
  }, [visible]);

  const shownLanes = useMemo(
    () =>
      lanes.filter(
        (lane) =>
          poolIds.includes(lane.poolId) && (!prefs.hideEmptyLanes || busyLanes.has(lane.id)),
      ),
    [lanes, poolIds, prefs.hideEmptyLanes, busyLanes],
  );

  /*
   * The legend is built from what is on screen, not from every category the club
   * has ever defined. A legend listing eight colours for a grid showing two is a
   * legend nobody reads twice.
   */
  const legend = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; colour: string }>();
    for (const row of visible) {
      if (row.categoryId === null) continue;
      const category = categories.find((candidate) => candidate.id === row.categoryId);
      if (category !== undefined) seen.set(category.id, category);
    }
    return [...seen.values()];
  }, [visible, categories]);

  /** Bookings whose own time matches no slot — named and timed, never dropped. */
  const outOfGrid = useMemo(
    () => visible.filter((row) => row.slotId === null && row.scheduleId !== null),
    [visible],
  );

  const weekdaySlots = useMemo(
    () => slots.filter((slot) => slot.dayGroup === 'weekday'),
    [slots],
  );
  const saturdaySlots = useMemo(
    () => slots.filter((slot) => slot.dayGroup === 'saturday'),
    [slots],
  );
  const sundaySlots = useMemo(() => slots.filter((slot) => slot.dayGroup === 'sunday'), [slots]);

  const weekdayDays = WEEKDAY_DAYS.filter(
    (day) => openOn(day) || visible.some((row) => row.weekday === day),
  );

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
   *
   * **The target is now `(day, slot, lane)`.** The lane is carried but not yet
   * written: assigning a booking to the lane it was dropped on is POOLSE-50,
   * and doing half of it here would mean a drop that moves the time and silently
   * ignores where it landed.
   */
  function onDragEnd(event: DragEndEvent): void {
    setDragging(null);

    const over = event.over;
    if (over === null) return;

    const [, weekdayText, slotId] = String(over.id).split(':');
    const weekday = Number(weekdayText);
    const slot = slots.find((candidate) => candidate.id === slotId);
    if (slot === undefined) return;

    const startTime = slot.startTime;
    const startMinutes = toMinutes(startTime);
    const active = String(event.active.id);

    if (active.startsWith('group:')) {
      const groupId = active.slice('group:'.length);
      const group = mine.find((candidate) => candidate.id === groupId);
      if (group === undefined) return;

      /*
       * The slot's own length, where there is one.
       *
       * A grid row is a real span — 09:00 to 09:45 — so a class dropped into it
       * takes that length rather than whatever it happened to have. That is what
       * makes the grid the club's grid instead of a backdrop.
       */
      const durationMinutes =
        toMinutes(slot.endTime) - startMinutes ||
        group.schedules[0]?.durationMinutes ||
        FALLBACK_DURATION;

      setOptimistic({ kind: 'place', groupId, weekday, startMinutes, durationMinutes });
      setProposal({
        kind: 'place',
        groupId,
        name: group.name,
        weekday,
        startTime,
        durationMinutes,
      });
      return;
    }

    const scheduleId = active.slice('slot:'.length);
    const row = placed.find((candidate) => candidate.scheduleId === scheduleId);
    if (row === undefined || row.scheduleId === null) return;

    // Only a turma's pattern can be moved from here. A parceria booking is
    // edited on the grid in POOLSE-50; dragging one now would call an action
    // that expects a class group and get a refusal it cannot explain.
    if (row.groupId === null) return;

    // A drop back where it started is not a move, and asking about it would be
    // asking whether to do nothing.
    if (row.weekday === weekday && toTime(row.startMinutes) === startTime) return;

    setOptimistic({ kind: 'move', scheduleId: row.scheduleId, weekday, startMinutes });
    /*
     * The occurrence being dragged — this week's, not next week's.
     *
     * Both halves have to exist for the question to be worth asking: a week on
     * screen, and a session generated for it. A slot the season has not reached
     * yet has nothing to move on its own, and offering the choice anyway would
     * be offering an answer that cannot be carried out.
     */
    const sessionId = row.controls.sessionId;
    const occurrence =
      weekStart !== undefined && sessionId !== undefined && !row.cancelled
        ? { sessionId, date: addDays(weekStart, weekday - 1) }
        : null;

    setProposal({
      kind: 'move',
      groupId: row.groupId,
      scheduleId: row.scheduleId,
      name: row.name,
      weekday,
      startTime,
      from: { weekday: row.weekday, startTime: toTime(row.startMinutes) },
      occurrence,
    });
  }

  /**
   * The question answered "no": the chip goes back where it came from.
   *
   * Dropping the overlay is the whole revert, because `placed` is the server's
   * data with the overlay laid on top of it. Nothing was written, so there is
   * nothing to undo on the other side.
   */
  function cancel(): void {
    setProposal(null);
    setOptimistic(null);
  }

  /**
   * The proposal, carried out. Nothing before this writes anything.
   *
   * `scope` is the answer to the question a drag cannot answer on its own: a
   * class dropped on Wednesday is either "Wednesday from now on" or "Wednesday
   * this once, the pool is booked". Both are ordinary, so the board asks rather
   * than picking, and `'series'` stays the answer wherever there is no week on
   * screen to move by itself.
   */
  function confirm(scope: 'series' | 'week'): void {
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
        // The overlay is dropped either way. On success the server's own data
        // now says the same thing; on failure the chip has to go back, or the
        // grid would keep showing a class that was never saved.
        setOptimistic(null);
        if (!result.ok) setError(result.errorKey);
        else setUndo(null);
        return;
      }

      if (scope === 'week' && asked.occurrence !== null) {
        const moved = await moveOccurrenceAction(
          organizationId,
          asked.occurrence.sessionId,
          asked.occurrence.date,
          asked.startTime,
        );
        setOptimistic(null);
        if (!moved.ok) setError(moved.errorKey);
        // No undo banner here. The undo it offers puts a *pattern* back, and
        // this changed one week — dragging it back is the honest undo, and it
        // is the same gesture that made the change.
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
      setOptimistic(null);
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
        : (placed.find((row) => row.scheduleId === dragging.slice('slot:'.length))?.name ?? null);

  const rowRem = ROW_REM[prefs.density];

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

        <MoveDialog
          proposal={proposal}
          dayNames={dayNames}
          pending={pending}
          onConfirm={confirm}
          onCancel={cancel}
        />

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
          A facility with no slot grid says so and points at the editor — AC10.
          Eighty-four empty rows would be a screen that looks broken rather than
          one that is simply not set up yet.
        */}
        {slots.length === 0 ? (
          <section className="rounded border border-dashed border-border bg-surface-muted p-6 text-center">
            <p className="text-sm font-medium">{t('grid.noSlots')}</p>
            <p className="mt-1 text-sm text-foreground-muted">{t('grid.noSlotsHint')}</p>
            {facility !== undefined && (
              <a
                href={`/dashboard/facilities/${facility.id}`}
                className="mt-3 inline-block rounded border border-border px-3 py-1.5 text-sm hover:border-primary/50 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {t('grid.buildGrid')}
              </a>
            )}
          </section>
        ) : (
          <>
            <GridToolbar
              prefs={prefs}
              update={update}
              pools={pools}
              instructors={instructors}
              categories={categories}
              partners={partners}
              levels={levels}
            />

            <SlotGrid
              heading={null}
              slots={weekdaySlots}
              days={weekdayDays}
              lanes={shownLanes}
              placed={visible}
              dayNames={dayNames}
              closedOn={closedOn}
              openOn={openOn}
              dragging={dragging !== null}
              canManage={canManage}
              rowRem={rowRem}
              density={prefs.density}
              showPoolName={poolIds.length > 1}
            />

            {/*
              The weekend is its own block, stacked under the weekday one.

              **Provisional, and the ticket asked for a real render.** The
              arithmetic says stacked: at 1280px, side by side gives each grid
              about 34rem, and once two sticky rails (8.25rem each) are paid for
              twice, a five-day block is left with day columns under 5rem —
              narrower than "Hidroterapia". Stacked, both keep full-width columns
              and the rails are paid for once. The reference sheet puts them
              alongside because paper is 42cm wide and a laptop is not.

              That is a calculation, not a measurement. AC2 wants the choice made
              from a real render at 1280px, so it stays provisional until one is
              looked at — if adjacent does fit, this becomes two blocks in a flex
              row and nothing else changes.
            */}
            {saturdaySlots.length > 0 && (
              <SlotGrid
                heading={t('grid.saturday')}
                slots={saturdaySlots}
                days={[6]}
                lanes={shownLanes}
                placed={visible}
                dayNames={dayNames}
                closedOn={closedOn}
                openOn={openOn}
                dragging={dragging !== null}
                canManage={canManage}
                rowRem={rowRem}
                density={prefs.density}
                showPoolName={poolIds.length > 1}
              />
            )}

            {sundaySlots.length > 0 && (
              <SlotGrid
                heading={t('grid.sunday')}
                slots={sundaySlots}
                days={[7]}
                lanes={shownLanes}
                placed={visible}
                dayNames={dayNames}
                closedOn={closedOn}
                openOn={openOn}
                dragging={dragging !== null}
                canManage={canManage}
                rowRem={rowRem}
                density={prefs.density}
                showPoolName={poolIds.length > 1}
              />
            )}

            {legend.length > 0 && (
              <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-foreground-muted">
                {legend.map((category) => (
                  <li key={category.id} className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className={cn(
                        'size-3 rounded-sm border',
                        CATEGORY_TINT[category.colour] ?? DEFAULT_TINT,
                      )}
                    />
                    {category.name}
                  </li>
                ))}
              </ul>
            )}

            {/*
              Fora da grelha — AC11.

              A booking whose own time matches no slot. It used to widen the grid
              to fit; now it is named here with its time, which keeps the club's
              grid the club's grid and still refuses to lose a class.
            */}
            {outOfGrid.length > 0 && (
              <section className="flex flex-col gap-2 rounded border border-warning/40 bg-warning/5 p-4">
                <h3 className="text-sm font-medium">{t('grid.offGrid')}</h3>
                <p className="text-sm text-foreground-muted">{t('grid.offGridHint')}</p>
                <ul className="flex flex-col gap-1 text-sm">
                  {outOfGrid.map((row) => (
                    <li key={row.key} className="flex flex-wrap items-baseline gap-x-3">
                      <span className="font-mono text-xs">{toTime(row.startMinutes)}</span>
                      <span className="font-medium">{row.name}</span>
                      <span className="text-foreground-muted">
                        {dayNames[row.weekday] ?? t(`week.${row.weekday}`)}
                      </span>
                      {row.subtitle !== null && (
                        <span className="text-foreground-muted">{row.subtitle}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
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

/**
 * Density, pool and the four filters.
 *
 * One row of small controls above the grid rather than a panel: every one of
 * them is a thing somebody changes while looking at the grid, and a panel that
 * covers what it filters is a panel you close to see the result of using it.
 */
function GridToolbar({
  prefs,
  update,
  pools,
  instructors,
  categories,
  partners,
  levels,
}: {
  prefs: Prefs;
  update: (patch: Partial<Prefs>) => void;
  pools: { id: string; name: string }[];
  instructors: { id: string; name: string }[];
  categories: { id: string; name: string; colour: string }[];
  partners: { id: string; name: string; colour: string }[];
  levels: { id: string; name: string }[];
}): React.ReactElement {
  const t = useTranslations();

  return (
    <div className="flex flex-wrap items-end gap-3">
      {pools.length > 1 && (
        <Filter
          id="grid-pool"
          label={t('grid.pool')}
          value={prefs.poolId}
          onChange={(value) => update({ poolId: value })}
          // Not "todos" first: the default is one pool, because four tanks of
          // six lanes is 336 rows nobody asked for on first paint.
          options={[
            ...pools.map((pool) => ({ value: pool.id, label: pool.name })),
            { value: 'all', label: t('grid.allPools') },
          ]}
        />
      )}

      <Filter
        id="grid-density"
        label={t('grid.density')}
        value={prefs.density}
        onChange={(value) => update({ density: value === 'compacta' ? 'compacta' : 'confortavel' })}
        options={[
          { value: 'confortavel', label: t('grid.comfortable') },
          { value: 'compacta', label: t('grid.compact') },
        ]}
      />

      {instructors.length > 0 && (
        <Filter
          id="grid-instructor"
          label={t('grid.instructor')}
          value={prefs.instructorId}
          onChange={(value) => update({ instructorId: value })}
          options={[
            { value: '', label: t('grid.anyInstructor') },
            ...instructors.map((person) => ({ value: person.id, label: person.name })),
          ]}
        />
      )}

      {categories.length > 0 && (
        <Filter
          id="grid-category"
          label={t('grid.category')}
          value={prefs.categoryId}
          onChange={(value) => update({ categoryId: value })}
          options={[
            { value: '', label: t('grid.anyCategory') },
            ...categories.map((category) => ({ value: category.id, label: category.name })),
          ]}
        />
      )}

      {partners.length > 0 && (
        <Filter
          id="grid-partner"
          label={t('grid.partner')}
          value={prefs.partnerId}
          onChange={(value) => update({ partnerId: value })}
          options={[
            { value: '', label: t('grid.anyPartner') },
            ...partners.map((partner) => ({ value: partner.id, label: partner.name })),
          ]}
        />
      )}

      {levels.length > 0 && (
        <Filter
          id="grid-level"
          label={t('grid.level')}
          value={prefs.levelId}
          onChange={(value) => update({ levelId: value })}
          options={[
            { value: '', label: t('grid.anyLevel') },
            ...levels.map((level) => ({ value: level.id, label: level.name })),
          ]}
        />
      )}

      <label className="flex h-control items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={prefs.hideEmptyLanes}
          onChange={(event) => update({ hideEmptyLanes: event.target.checked })}
          className="size-4 rounded border-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        />
        {t('grid.hideEmptyLanes')}
      </label>
    </div>
  );
}

function Filter({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}): React.ReactElement {
  return (
    <div className={`${FIELD_COLUMN} w-40`}>
      <label htmlFor={id} className={FIELD_LABEL}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={CONTROL_LINE}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
/**
 * "Move Iniciados 2 to Thursday, 18:00?" — round 6.
 *
 * A centred dialog with a dimmed backdrop, over the grid. The board asked this
 * inline for one round, on the argument that covering the timetable to ask about
 * the timetable hides the evidence; that argument is weaker now the chip has
 * already moved, because the evidence is the new position and the operator saw
 * it happen. What an inline banner did cost was a question somebody could scroll
 * past and leave open on a grid that was quietly lying about where a class is.
 *
 * **Escape is undo, not dismiss.** The two buttons are the only two answers, and
 * a dialog you can close without answering would leave a class drawn somewhere
 * it is not. Every exit from here either saves the move or puts the chip back.
 *
 * Focus goes to the confirm button on open, because confirming is what the drop
 * was for; both are real buttons, so the keyboard and a screen reader get the
 * same two choices as the pointer.
 */
function MoveDialog({
  proposal,
  dayNames,
  pending,
  onConfirm,
  onCancel,
}: {
  proposal: Proposal | null;
  dayNames: Record<number, string>;
  pending: boolean;
  onConfirm: (scope: 'series' | 'week') => void;
  onCancel: () => void;
}): React.ReactElement | null {
  const t = useTranslations();
  const confirmButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (proposal === null) return;

    confirmButton.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !pending) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [proposal, pending, onCancel]);

  if (proposal === null) return null;

  /*
   * Two answers or one.
   *
   * A drag on a dated week is genuinely ambiguous — "the class has moved" and
   * "the pool is booked that morning" are the same gesture — so the dialog puts
   * both on screen and neither is the quiet default. Where there is no week to
   * move on its own, the pattern is the only thing a drop can mean and one
   * button says so.
   */
  const canScope = proposal.kind === 'move' && proposal.occurrence !== null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="move-question"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4"
    >
      <div className="flex w-full max-w-md flex-col gap-4 rounded border border-border bg-surface p-5 shadow-lg">
        <h2 id="move-question" className="text-base font-medium">
          {t(proposal.kind === 'move' ? 'classes.confirmMove' : 'classes.confirmPlace', {
            name: proposal.name,
            day: dayNames[proposal.weekday] ?? '',
            time: proposal.startTime.slice(0, 5),
          })}
        </h2>

        {/*
          The one thing here somebody could reasonably get wrong: a class on
          screen is one Thursday, and the row being moved belongs to every
          Thursday. Said in the dialog rather than only on the board above,
          because this is the moment the decision is actually made.
        */}
        <p className="text-sm text-foreground-muted">
          {t(canScope ? 'classes.moveScopeNote' : 'classes.patternNote')}
        </p>

        <div className="flex flex-wrap justify-end gap-3">
          {canScope && (
            <button
              ref={confirmButton}
              type="button"
              onClick={() => onConfirm('week')}
              disabled={pending}
              className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {pending ? t('common.working') : t('classes.moveThisWeek')}
            </button>
          )}
          <button
            ref={canScope ? undefined : confirmButton}
            type="button"
            onClick={() => onConfirm('series')}
            disabled={pending}
            className={
              canScope
                ? 'rounded border border-primary px-4 py-2 text-sm text-primary hover:bg-surface-muted disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
                : 'rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
            }
          >
            {pending
              ? t('common.working')
              : canScope
                ? t('classes.moveEveryWeek')
                : t(proposal.kind === 'move' ? 'classes.doMove' : 'classes.doPlace')}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded border border-border px-4 py-2 text-sm hover:bg-surface-muted disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('common.undo')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * One block of the grid: a set of slots, a set of days, every lane inside each.
 *
 * **Every cell is placed explicitly.** `gridColumn` and `gridRow` are set on all
 * of them rather than relying on auto-placement, because the `Horário` label
 * spans a slot's lanes and an auto-flowing spanner shifts everything after it by
 * a row in ways that depend on how many lanes there are. Explicit placement is
 * two extra numbers per cell and removes the whole class of bug.
 *
 * **The rail is two sticky columns.** `Horário` at `left: 0`, `Pista` at the
 * first column's width. Fourteen slots by six lanes is eighty-four rows; a grid
 * whose row labels scroll away horizontally is unreadable by the third slot, and
 * one whose labels scroll away vertically is unreadable by the second.
 */
function SlotGrid({
  heading,
  slots,
  days,
  lanes,
  placed,
  dayNames,
  closedOn,
  openOn,
  dragging,
  canManage,
  rowRem,
  density,
  showPoolName,
}: {
  /** Null for the weekday block, which needs no heading of its own. */
  heading: string | null;
  slots: GridSlot[];
  days: readonly number[];
  lanes: GridLane[];
  placed: Placed[];
  dayNames: Record<number, string>;
  closedOn: (day: number) => string | null;
  openOn: (day: number) => boolean;
  dragging: boolean;
  canManage: boolean;
  rowRem: number;
  density: Density;
  showPoolName: boolean;
}): React.ReactElement {
  const t = useTranslations();

  if (lanes.length === 0) {
    return (
      <p className="rounded border border-dashed border-border p-4 text-sm text-foreground-muted">
        {t('grid.noLanes')}
      </p>
    );
  }

  /** Where each lane sits in the block, so a chip can span from its first one. */
  const laneIndex = new Map(lanes.map((lane, index) => [lane.id, index]));

  const columns = `${TIME_COL}rem ${LANE_COL}rem repeat(${days.length}, minmax(6rem, 1fr))`;

  return (
    <section className="flex flex-col gap-2">
      {heading !== null && <h3 className="text-sm font-medium">{heading}</h3>}

      {/* The grid scrolls sideways and up inside itself, never the page. */}
      <div className="max-h-[70vh] overflow-auto rounded border border-border">
        <div
          className="grid min-w-max"
          style={{ gridTemplateColumns: columns }}
          role="grid"
          aria-label={heading ?? t('grid.weekdays')}
        >
          {/* Header row: the two rail labels, then the days. */}
          <div
            className="sticky left-0 top-0 z-30 border-b border-border bg-surface px-2 py-1 text-left text-xs font-medium uppercase tracking-wider text-foreground-muted"
            style={{ gridColumn: 1, gridRow: 1 }}
          >
            {t('grid.time')}
          </div>
          <div
            className="sticky top-0 z-30 border-b border-l border-border bg-surface px-2 py-1 text-left text-xs font-medium uppercase tracking-wider text-foreground-muted"
            style={{ gridColumn: 2, gridRow: 1, left: `${TIME_COL}rem` }}
          >
            {t('grid.lane')}
          </div>

          {days.map((day, index) => {
            const closed = closedOn(day);
            return (
              <div
                key={day}
                className="sticky top-0 z-20 border-b border-l border-border bg-surface px-2 py-1 text-center text-xs font-medium uppercase tracking-wider text-foreground-muted"
                style={{ gridColumn: 3 + index, gridRow: 1 }}
              >
                {dayNames[day] ?? t(`week.${day}`)}
                {/*
                  The closure's name, not just a shade. A dim column says
                  something is different; "Natal" says what, which is the
                  question the operator actually has.
                */}
                {closed !== null && (
                  <span className="mt-0.5 flex items-center justify-center gap-1 text-[0.65rem] font-normal normal-case text-warning">
                    <Lock aria-hidden className="size-3" />
                    {closed}
                  </span>
                )}
              </div>
            );
          })}

          {slots.map((slot, slotIndex) => {
            // Row 1 is the header, so a block's first body row is 2.
            const firstRow = 2 + slotIndex * lanes.length;

            return (
              <Fragment key={slot.id}>
                {/*
                  The slot's hours, spanning its lanes. A real row span rather
                  than a repeated label: repeating it six times is six times the
                  ink for one fact, and the eye stops reading it.
                */}
                <div
                  className="sticky left-0 z-20 flex items-start justify-end border-t-2 border-border bg-surface px-2 pt-1 text-right font-mono text-[0.7rem] leading-tight text-foreground-muted"
                  style={{ gridColumn: 1, gridRow: `${firstRow} / span ${lanes.length}` }}
                >
                  <span>
                    {slot.startTime}
                    <span className="block text-foreground-muted/60">{slot.endTime}</span>
                  </span>
                </div>

                {lanes.map((lane, laneOffset) => {
                  const row = firstRow + laneOffset;
                  const firstOfSlot = laneOffset === 0;

                  return (
                    <Fragment key={`${slot.id}:${lane.id}`}>
                      <div
                        className={cn(
                          'sticky z-10 flex items-center gap-1 border-l border-border bg-surface px-2 text-[0.7rem] text-foreground-muted',
                          firstOfSlot ? 'border-t-2' : 'border-t border-border/40',
                        )}
                        style={{
                          gridColumn: 2,
                          gridRow: row,
                          left: `${TIME_COL}rem`,
                          height: `${rowRem}rem`,
                        }}
                      >
                        <span className="truncate">
                          {showPoolName ? `${lane.poolName} · ${lane.name}` : lane.name}
                        </span>
                      </div>

                      {days.map((day, dayIndex) => {
                        const here = placed.find(
                          (candidate) =>
                            candidate.weekday === day &&
                            candidate.slotId === slot.id &&
                            candidate.laneIds[0] === lane.id,
                        );

                        /*
                         * How many lane rows this booking covers, clipped to the
                         * lanes actually on screen — "esconder pistas vazias"
                         * can hide a lane in the middle of a span, and a block
                         * that kept its original height would then overhang the
                         * slot below it.
                         */
                        const span =
                          here === undefined
                            ? 1
                            : Math.max(
                                1,
                                here.laneIds.filter((id) => laneIndex.has(id)).length,
                              );

                        return (
                          <Cell
                            key={`${day}:${slot.id}:${lane.id}`}
                            day={day}
                            slot={slot}
                            lane={lane}
                            column={3 + dayIndex}
                            row={row}
                            booking={here}
                            span={span}
                            rowRem={rowRem}
                            density={density}
                            firstOfSlot={firstOfSlot}
                            dragging={dragging}
                            open={openOn(day) && closedOn(day) === null}
                            canManage={canManage}
                            dayName={dayNames[day] ?? String(day)}
                          />
                        );
                      })}
                    </Fragment>
                  );
                })}
              </Fragment>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Cell({
  day,
  slot,
  lane,
  column,
  row,
  booking,
  span,
  rowRem,
  density,
  firstOfSlot,
  dragging,
  open,
  canManage,
  dayName,
}: {
  day: number;
  slot: GridSlot;
  lane: GridLane;
  column: number;
  row: number;
  booking: Placed | undefined;
  span: number;
  rowRem: number;
  density: Density;
  firstOfSlot: boolean;
  dragging: boolean;
  open: boolean;
  canManage: boolean;
  dayName: string;
}): React.ReactElement {
  const t = useTranslations();

  const { setNodeRef, isOver } = useDroppable({
    // `(day, slot, lane)` — the change this ticket is about. The lane is carried
    // so POOLSE-50 can write it; nothing reads it as a target yet.
    id: `cell:${day}:${slot.id}:${lane.id}`,
    disabled: !open || !canManage,
  });

  return (
    <div
      ref={setNodeRef}
      role="gridcell"
      /*
       * Named for a screen reader — AC13 and QA 49.14.
       *
       * Eighty-four cells that announce nothing are eighty-four announcements of
       * "blank". Day, slot and lane make the position speakable, and the
       * booking's name makes the content speakable.
       */
      aria-label={
        booking === undefined
          ? t('grid.emptyCell', { day: dayName, time: slot.startTime, lane: lane.name })
          : t('grid.filledCell', {
              day: dayName,
              time: slot.startTime,
              lane: lane.name,
              what: booking.name,
            })
      }
      className={cn(
        'relative border-l border-border px-0.5',
        firstOfSlot ? 'border-t-2 border-t-border' : 'border-t border-border/40',
        !open && 'bg-surface-muted/60',
        dragging && open && booking === undefined && 'bg-primary/5',
        isOver && 'bg-primary/25 outline outline-2 outline-primary',
      )}
      style={{ gridColumn: column, gridRow: row, height: `${rowRem}rem` }}
    >
      {booking !== undefined && (
        /*
         * Out of flow, covering the lane rows this booking actually occupies —
         * AC5. One block across lanes 2–4, never three copies of Cadetes.
         *
         * The lanes it covers stay real droppables underneath: the inset leaves
         * their edges reachable, and the lanes *beside* it are untouched, which
         * is what QA 49.4 is about.
         */
        <div
          className="absolute inset-x-0.5 top-0 z-10"
          style={{ height: `calc(${span * rowRem}rem - 1px)` }}
        >
          <BookingChip booking={booking} canManage={canManage} density={density} />
        </div>
      )}
    </div>
  );
}

/**
 * A booking on the grid: what it is, who is running it, how many, and the two
 * things you do to it.
 *
 * **Group, then instructor, then headcount**, in that order, because that is the
 * order somebody reads a cell on the printed sheet. In `compacta` the headcount
 * becomes a badge and the instructor is dropped to one line — a planner scanning
 * eighty-four rows wants the shape of the week, and reaches for `confortável`
 * when they want the detail.
 *
 * The register and cancel controls live inside the chip, and the drag must not
 * start from them — a pointer landing on "Cancelar" has to cancel, not pick the
 * class up. `stopPropagation` on pointer-down is what separates the two.
 *
 * A cancelled class is struck through and keeps its reason: "why is there no
 * class on the 15th" is the question this grid exists to answer.
 */
function BookingChip({
  booking,
  canManage,
  density,
}: {
  booking: Placed;
  canManage: boolean;
  density: Density;
}): React.ReactElement {
  const t = useTranslations();

  // Only a turma's pattern is draggable from here — POOLSE-50 gives the others
  // their own gesture. A parceria with a grip that refused on drop would be a
  // control that lies about what it does.
  const draggable =
    canManage && booking.scheduleId !== null && booking.groupId !== null && !booking.cancelled;

  const compact = density === 'compacta';

  /*
   * The partner's colour beats the category's, and neither carries meaning
   * alone: the group name is text in every cell, and the legend names each
   * category in words.
   *
   * A partner colour is an arbitrary hex from an operator, so it tints a left
   * edge rather than a background — an inline background cannot be checked for
   * contrast in both themes, and a 4px bar has nothing written on it.
   */
  const tint =
    booking.cancelled
      ? 'border-dashed border-border bg-surface-muted'
      : (CATEGORY_TINT[booking.categoryColour ?? ''] ?? DEFAULT_TINT);

  return (
    <div
      className={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-sm border pl-1 pr-1 text-[0.7rem] leading-tight',
        tint,
      )}
      style={
        booking.partnerColour === null
          ? undefined
          : { borderLeftColor: booking.partnerColour, borderLeftWidth: '4px' }
      }
    >
      <div className="flex items-start justify-between gap-1">
        <Chip
          id={
            booking.scheduleId === null ? `static:${booking.key}` : `slot:${booking.scheduleId}`
          }
          label={booking.name}
          time={toTime(booking.startMinutes)}
          subtitle={compact ? null : booking.subtitle}
          cancelled={booking.cancelled}
          draggable={draggable}
          bare
        />

        {/*
          The headcount as a badge in compact density, spelled out otherwise.
          Zero is a real answer — a group nobody has sized yet — so it prints as
          0 rather than vanishing.
        */}
        {booking.headcount !== null && (
          <span
            className={cn(
              'shrink-0 rounded-sm border border-border px-1 tabular-nums',
              compact ? 'text-[0.6rem]' : 'text-[0.65rem]',
            )}
          >
            {booking.headcount}
          </span>
        )}
      </div>

      {!compact && (
        <span className="truncate text-foreground-muted">
          {/*
            "Sem professor" is a real state and says so in words. POOLSE-53 turns
            it into an alert; here it simply must not read as a blank line that
            might be a rendering fault.
          */}
          {booking.instructorStatus === 'external'
            ? (booking.instructorName ?? t('grid.externalInstructor'))
            : (booking.instructorName ?? t('grid.noInstructor'))}
        </span>
      )}

      {booking.note !== null && (
        <span className="truncate font-medium text-warning">{booking.note}</span>
      )}

      {(booking.controls.mark !== undefined || booking.controls.cancel !== undefined) && (
        <div
          className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-0.5"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {booking.controls.mark !== undefined && (
            <a
              href={booking.controls.mark.href}
              className="rounded text-[0.65rem] font-medium text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
            >
              {booking.controls.mark.label}
            </a>
          )}
          {booking.controls.cancel}
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
