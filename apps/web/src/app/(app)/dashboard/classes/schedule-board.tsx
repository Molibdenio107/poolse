'use client';

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { AlertTriangle, Ban, Download, GripVertical, Lock, Printer } from 'lucide-react';
import {
  concurrentGroups,
  evaluate,
  verdictOf,
  type Reason,
  type RuleBooking,
  type RuleContext,
  type RuleLane,
  type Verdict,
} from '@poolse/rules';
import type {
  ClassGroup,
  DayGroup,
  FacilityDay,
  GridBooking,
  GridLane,
  GridSlot,
  GridStaffing,
} from '@/lib/api';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';
import { slotKey } from '@/lib/slot-key';
import { cn } from '@/lib/utils';
import { addDays } from '@/lib/dates';
import {
  applyGridFilters,
  FILTER_PARAM,
  gridFilterQuery,
  parseStaffing,
  staffingParam,
  type GridFilters,
} from '@/lib/grid-filters';
import {
  cellAt,
  groupOf,
  instructorDisplay,
  type InstructorState,
  rowTimes,
  slotAt as slotAtTime,
  slotsCovered,
  slotsFor,
  toMinutes,
  toTime,
} from '@/lib/grid-layout';
import {
  duplicateBookingAction,
  moveBookingAction,
  moveOccurrenceAction,
  moveSlotAction,
  placeSlotAction,
  setInstructorStatusAction,
} from './classes.actions';

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
/**
 * One lane row, in rem, at each density — a tenth taller than it was.
 *
 * The first pass was drawn to the reference sheet's density, which is what a
 * printer achieves and a screen does not: at 18px a row the group name, the
 * instructor and the headcount were all technically present and none of them
 * were comfortable. Everything in the grid went up by roughly ten percent
 * together — rows, rails, columns and type — because scaling one of them
 * alone is what makes a grid look wrong rather than small.
 */
const ROW_REM = { compacta: 1.25, confortavel: 1.9375 } as const;

type Density = keyof typeof ROW_REM;

/** Only used for a turma with no slot to copy a length from. */
const FALLBACK_DURATION = 45;

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** Rail widths, in rem. Shared by the sticky offsets and the column template. */
const TIME_COL = 4.125;
const LANE_COL = 5;

/**
 * Where the cursor is, and only then where the box is.
 *
 * dnd-kit's default is `rectIntersection`, which asks which droppable the
 * *dragged element* overlaps most. That is right for a block the size of a cell
 * and wrong for a 12px resize grip: the grip overlaps several lane rows at once
 * and the winner is decided by arithmetic the operator cannot see, so the lane
 * they land on is not reliably the one under their finger.
 *
 * `pointerWithin` answers the question they are actually asking — which cell am
 * I pointing at — and `rectIntersection` remains the fallback for the keyboard,
 * where there is no pointer to be within anything.
 */
const collisionDetection: CollisionDetection = (args) => {
  const byPointer = pointerWithin(args);
  return byPointer.length > 0 ? byPointer : rectIntersection(args);
};

/**
 * The booking a drag id refers to, whichever grip started it.
 *
 * Three prefixes point at the same block — `slot:` is the block itself, `edge:`
 * is its lane grip and `dur:` its length grip — and every reader of a drag id
 * has to agree about that. They did not: the overlay label and the live cell
 * preview both parsed `slot:` only, so a resize drag showed no label, no
 * highlighted cells and no conflict warning. It worked and looked broken, which
 * is indistinguishable from broken.
 */
function draggedScheduleId(dragId: string): string | null {
  for (const prefix of ['slot:', 'edge:', 'dur:']) {
    if (dragId.startsWith(prefix)) return dragId.slice(prefix.length);
  }
  return null;
}

/** Same lanes, same order — used to tell a real move from a drop that went home. */
function sameLanes(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * Whether a set of lanes is one unbroken run of the grid's own order — AC6.
 *
 * Lanes 2 and 4 with 3 free between them is not a booking a pool can honour and
 * is not something the reference sheet ever does. Refused at the gesture so the
 * dialog never asks about it; the API refuses it too, because the gesture is a
 * convenience and the API is the rule.
 */
function isContiguous(laneIds: readonly string[], lanes: readonly GridLane[]): boolean {
  if (laneIds.length < 2) return true;

  const positions = laneIds
    .map((id) => lanes.findIndex((lane) => lane.id === id))
    .sort((a, b) => a - b);

  if (positions[0] === -1) return false;
  return positions.every((position, index) => index === 0 || position === positions[index - 1]! + 1);
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
 *
 * **All seven enum values are here, and that is a POOLSE-55 fix.** Two were
 * missing in a way nothing failed on: `teal` had no entry and fell through to
 * `DEFAULT_TINT`, which is blue, and `violet` pointed at `--accent` — the same
 * near-grey as `slate`'s `--surface-muted`. A club colour-coding Competição and
 * Hidroginástica saw one colour, and the reference seed is what made it visible.
 * Anything added to the enum needs a line here; the fallback hides the omission.
 *
 * **The fill is 15%, and the number was measured rather than chosen.** At 10%
 * every ratio passed comfortably and the seven tints were 4 RGB units apart at
 * their closest — invisible, so the colour was doing no work and the `/40`
 * borders carried the whole signal. 15% roughly doubles the separation (8.0 in
 * light, 5.5 in dark) and the worst pairing, the instructor line on the palest
 * tint, is 4.65:1 light and 4.99:1 dark. That is the ceiling: going further
 * would take the muted text under AA, so anything darker has to move the text
 * token first.
 */
const CATEGORY_TINT: Record<string, string> = {
  slate: 'border-border bg-surface-muted',
  blue: 'border-primary/40 bg-primary/15',
  teal: 'border-category-teal/40 bg-category-teal/15',
  green: 'border-success/40 bg-success/15',
  amber: 'border-warning/40 bg-warning/15',
  red: 'border-danger/40 bg-danger/15',
  violet: 'border-category-violet/40 bg-category-violet/15',
};

const DEFAULT_TINT = 'border-primary/40 bg-primary/15';

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
  instructorStatus: InstructorState;
  /** The partner group's own teacher, for an `external` booking — POOLSE-53. */
  ownInstructorName: string | null;
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
      groupId: string | null;
      scheduleId: string;
      name: string;
      weekday: number;
      startTime: string;
      slotId: string | null;
      laneIds: string[];
      /** Explicit length when the edge was dragged; null takes the slot's. */
      durationMinutes: number | null;
      from: { weekday: number; startTime: string };
      /** This week's session, when there is a week on screen and one exists. */
      occurrence: { sessionId: string; date: string } | null;
    }
  /**
   * Another one of these, on another day — POOLSE-50.
   *
   * Its own kind rather than a flag on `move`, because the dialog has to say
   * something different and the two are different writes: a move leaves one
   * block, a duplicate leaves two. A flag would eventually be read wrong in one
   * of the four places that branch on it.
   */
  | {
      kind: 'duplicate';
      scheduleId: string;
      name: string;
      weekday: number;
      startTime: string;
      slotId: string | null;
      laneIds: string[];
    };

type Optimistic =
  | { kind: 'place'; groupId: string; weekday: number; startMinutes: number; durationMinutes: number }
  | {
      kind: 'move';
      scheduleId: string;
      weekday: number;
      startMinutes: number;
      slotId: string | null;
      laneIds: string[];
      durationMinutes: number;
    }
  /** The copy, drawn where it was dropped while the dialog asks about it. */
  | {
      kind: 'duplicate';
      scheduleId: string;
      weekday: number;
      startMinutes: number;
      slotId: string | null;
      laneIds: string[];
    };

/**
 * Where a block ended up — the one shape every gesture produces.
 *
 * Pointer and keyboard both build one of these and hand it to `propose`, which
 * is the Dev note's "same reducer" and the reason a keyboard move cannot quietly
 * behave differently from a dragged one. Adding a gesture means adding a caller,
 * never a second copy of the rules.
 */
interface Landing {
  weekday: number;
  slotId: string | null;
  startTime: string;
  laneIds: string[];
  /** True when the copy modifier was held **at the drop**, not at the start. */
  duplicate: boolean;
  /** An explicit length, when the bottom edge was dragged. Null takes the slot's. */
  durationMinutes?: number | null;
}

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
  laneLevelCapacity,
  maxConcurrentGroups,
  staffing,
  seasonId,
  seasonName,
  seasonStatus,
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
  /** `laneId:levelId` to capacity — POOLSE-51's per-level override. */
  laneLevelCapacity: Record<string, number>;
  /** Null means the club has no opinion about concurrent groups. */
  maxConcurrentGroups: number | null;
  /** The season's two staffing gaps — POOLSE-53. Both zero means say nothing. */
  staffing: GridStaffing;
  /** The season the grid was drawn for, so an export link names the same one. */
  seasonId: string | null;
  /** Named in the counter, because "7 aulas" without a season is 7 of what. */
  seasonName: string | null;
  /** `draft` marks the counter as next year's plan rather than this year's wall. */
  seasonStatus: string | null;
}): React.ReactElement {
  const t = useTranslations();
  const [pending, startPending] = useTransition();

  // The staffing filter is URL state — see `filterStaffing` below for why this
  // one filter travels differently from the other five.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navigating, startNavigation] = useTransition();

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
   * Whether the copy modifier is down **right now** — AC3.
   *
   * Read at the drop rather than at the drag start, because that is the natural
   * gesture: somebody picks a block up, moves it to Thursday, and *then* decides
   * they meant to copy it. dnd-kit's end event carries the activator event from
   * the start, so the modifier has to be tracked here instead.
   *
   * A ref and not state: nothing renders differently while Alt is held, and
   * re-rendering the whole grid on a keypress mid-drag is a jank nobody asked
   * for. The same ref serves the keyboard, where holding Alt and pressing Space
   * to drop is exactly the same question asked with different fingers.
   */
  const altHeld = useRef(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      altHeld.current = event.altKey;
    };
    // `blur` matters: alt-tabbing away leaves the key logically down forever,
    // and the next drop would silently duplicate.
    const onBlur = (): void => {
      altHeld.current = false;
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

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
        ownInstructorName: booking.ownInstructorName,
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
        target.slotId = optimistic.slotId;
        target.laneIds = optimistic.laneIds;
        target.durationMinutes = optimistic.durationMinutes;
      }
    }

    /*
     * A copy, drawn beside the original while the dialog asks about it.
     *
     * The original deliberately stays where it is — that is the whole difference
     * between duplicating and moving, and seeing both is how somebody knows
     * which one they are about to agree to.
     */
    if (optimistic?.kind === 'duplicate') {
      const source = rows.find((row) => row.scheduleId === optimistic.scheduleId);
      if (source !== undefined) {
        rows.push({
          ...source,
          key: `copy:${source.key}`,
          // No schedule id: it does not exist yet, so it cannot be dragged again
          // or confused for the row it was copied from.
          scheduleId: null,
          weekday: optimistic.weekday,
          startMinutes: optimistic.startMinutes,
          slotId: optimistic.slotId,
          laneIds: optimistic.laneIds,
          // A note names a date or a reason and does not travel — the API leaves
          // it behind too, and the overlay has to agree or the copy would appear
          // to carry something it will not have.
          note: null,
          controls: {},
        });
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
          // The overlay is a block that does not exist yet, so it makes no
          // claim about staffing — `to_define` is the state a real booking will
          // arrive in, and drawing an alert on it would report a gap the club
          // has not got.
          instructorStatus: 'to_define',
          ownInstructorName: null,
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
   * The staffing filter lives in the URL, and the other five do not — AC5.
   *
   * The difference is what each one is for. Density and "which tank" are the
   * viewer's own habits, so they belong in `localStorage` and follow the person
   * between screens. "Show me the seven with nobody on them" is a *finding* —
   * the thing somebody wants to send to a colleague, or come back to after
   * lunch, or reach with the browser's back button — so the URL is the state,
   * exactly as `FilterSelect` does it for the register.
   */
  const staffingFilter = useMemo<InstructorState | null>(
    () => parseStaffing(searchParams.get(FILTER_PARAM.staffing)),
    [searchParams],
  );

  function filterStaffing(next: InstructorState | null): void {
    const query = new URLSearchParams(searchParams.toString());
    const value = staffingParam(next);

    // Clicking the counter that is already on turns it off. A filter with no way
    // back that is not the browser's back button is a trap.
    if (value === null || next === staffingFilter) query.delete(FILTER_PARAM.staffing);
    else query.set(FILTER_PARAM.staffing, value);

    const href = query.size > 0 ? `${pathname}?${query}` : pathname;
    startNavigation(() => router.replace(href, { scroll: false }));
  }

  /*
   * The filters, applied to the chips rather than to the rows.
   *
   * Hiding a *lane* because nothing on it survived a filter would tell the
   * reader the lane does not exist; hiding the chip leaves the grid's shape
   * intact and the hole visible, which is what a planner is looking for.
   */
  /**
   * Everything the grid is filtered by, in one object.
   *
   * Five of these live in `localStorage` and one in the URL, and that split is
   * about where each belongs rather than about what they are — so they are
   * gathered here before anything acts on them. The export links below send this
   * same object down the wire, which is what makes an exported sheet contain
   * exactly the blocks that were on screen.
   */
  const filters = useMemo<GridFilters>(
    () => ({
      poolId: prefs.poolId,
      instructorId: prefs.instructorId,
      categoryId: prefs.categoryId,
      partnerId: prefs.partnerId,
      levelId: prefs.levelId,
      staffing: staffingFilter,
    }),
    [prefs, staffingFilter],
  );

  const visible = useMemo(() => applyGridFilters(placed, filters), [placed, filters]);

  const closedOn = (day: number): string | null =>
    closures.find((closure) => closure.weekday === day)?.reason ?? null;

  const openOn = (day: number): boolean =>
    facility?.hours.find((hour) => hour.weekday === day)?.available ?? true;

  /**
   * Every day the grid actually draws.
   *
   * Only the days the club opens — a club that is shut on Sunday should not be
   * shown a Sunday column every time it opens the calendar. Anything left on a
   * day this list omits is caught by `outOfGrid` below, so hiding a column is
   * never a way of losing what was on it.
   */
  const shownDays = useMemo(
    () => [1, 2, 3, 4, 5, 6, 7].filter((day) => openOn(day)),
    [facility],
  );

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

  /**
   * Everything the grid cannot draw — named and timed, never dropped.
   *
   * Two reasons a booking ends up here, and both are honest states rather than
   * errors: its time matches no row of the grid, or it sits on a day the club
   * does not open. The second is new: hiding a closed column must not be a way
   * of losing what was on it.
   */
  const outOfGrid = useMemo(
    () =>
      visible.filter(
        (row) =>
          row.scheduleId !== null &&
          (row.slotId === null || !shownDays.includes(row.weekday)),
      ),
    [visible, shownDays],
  );

  /*
   * Only the days the club actually opens.
   *
   * This used to keep a closed day whenever something was still booked on it,
   * on the argument that hiding a column would hide real classes. That argument
   * was right about the risk and wrong about the remedy: a club that does not
   * open on Sunday was made to look at a Sunday column every time it opened the
   * calendar, to protect a case that almost never happens.
   *
   * So the column goes, and the classes do not: anything left on a day the grid
   * no longer draws is listed underneath with the bookings that match no slot.
   * Nothing disappears; it just stops taking up a fifth of the screen.
   */


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
  /**
   * Where a block landed, applied — the one reducer both hands call.
   *
   * Pointer and keyboard end up here with the same `Landing`, which is what
   * stops a keyboard move behaving differently from a dragged one. It draws the
   * block in its new place immediately and then asks; nothing is written until
   * the dialog is answered.
   *
   * **A hard-blocked target is refused here, before the dialog** — AC8. Asking
   * "move Cadetes to Christmas Day?" and then refusing the answer wastes the
   * question; the drop simply does not take, and the block stays where it was.
   */
  function propose(subject: Placed, landing: Landing): void {
    if (closedOn(landing.weekday) !== null || !openOn(landing.weekday)) {
      setError('grid.dayClosed');
      return;
    }

    // Non-contiguous is refused at the gesture as well as at the API — AC6. The
    // API is the rule; this is what stops the dialog asking about a span the
    // pool cannot honour.
    if (!isContiguous(landing.laneIds, lanes)) {
      setError('grid.lanesNotContiguous');
      return;
    }

    setError(null);
    const startMinutes = toMinutes(landing.startTime);
    const duration = landing.durationMinutes ?? subject.durationMinutes;

    if (landing.duplicate) {
      if (subject.scheduleId === null) return;
      setOptimistic({
        kind: 'duplicate',
        scheduleId: subject.scheduleId,
        weekday: landing.weekday,
        startMinutes,
        slotId: landing.slotId,
        laneIds: landing.laneIds,
      });
      setProposal({
        kind: 'duplicate',
        scheduleId: subject.scheduleId,
        name: subject.name,
        weekday: landing.weekday,
        startTime: landing.startTime,
        slotId: landing.slotId,
        laneIds: landing.laneIds,
      });
      return;
    }

    if (subject.scheduleId === null) return;

    // A drop back where it started is not a move, and asking about it would be
    // asking whether to do nothing.
    const sameSpot =
      subject.weekday === landing.weekday &&
      subject.slotId === landing.slotId &&
      sameLanes(subject.laneIds, landing.laneIds);
    if (sameSpot) return;

    setOptimistic({
      kind: 'move',
      scheduleId: subject.scheduleId,
      weekday: landing.weekday,
      startMinutes,
      slotId: landing.slotId,
      laneIds: landing.laneIds,
      durationMinutes: duration,
    });

    /*
     * The occurrence being dragged — this week's, not next week's.
     *
     * Only a turma has one: a parceria generates dated sessions but takes no
     * register, and "only this week" is answered by the session machinery that
     * belongs to a class group.
     */
    const sessionId = subject.controls.sessionId;
    const occurrence =
      subject.groupId !== null && weekStart !== undefined && sessionId !== undefined && !subject.cancelled
        ? { sessionId, date: addDays(weekStart, landing.weekday - 1) }
        : null;

    setProposal({
      kind: 'move',
      groupId: subject.groupId,
      scheduleId: subject.scheduleId,
      name: subject.name,
      weekday: landing.weekday,
      startTime: landing.startTime,
      slotId: landing.slotId,
      laneIds: landing.laneIds,
      durationMinutes: landing.durationMinutes ?? null,
      from: { weekday: subject.weekday, startTime: toTime(subject.startMinutes) },
      occurrence,
    });
  }

  /**
   * Grow or shrink a block's lane span from the keyboard — AC2, AC9.
   *
   * `Shift`+arrow on a focused block, which is the gesture the edge handle makes
   * with a pointer. Both call `propose`, so the confirm dialog, the refusals and
   * the undo are the same in either hand.
   */
  function spanBy(subject: Placed, delta: number): void {
    const ordered = lanes.filter((lane) => subject.laneIds.includes(lane.id));
    if (ordered.length === 0) return;

    const first = lanes.findIndex((lane) => lane.id === ordered[0]?.id);
    const size = Math.max(1, ordered.length + delta);
    const next = lanes.slice(first, first + size);

    // Growing past the last lane of the pool is not a span, it is nothing.
    if (next.length !== size) return;
    if (sameLanes(next.map((lane) => lane.id), subject.laneIds)) return;

    propose(subject, {
      weekday: subject.weekday,
      slotId: subject.slotId,
      startTime: toTime(subject.startMinutes),
      laneIds: next.map((lane) => lane.id),
      duplicate: false,
    });
  }

  /**
   * Lengthen or shorten from the keyboard — the bottom edge, without a pointer.
   *
   * `Ctrl` because `Shift` is already the lane span and `Alt` is already
   * duplicate. Steps to the next slot boundary rather than by a fixed number of
   * minutes, so the block always lands on a row the club actually runs.
   */
  /**
   * "This one has nobody" — and the way back — POOLSE-53.
   *
   * The only thing on this screen that writes `instructor_status` by hand.
   * Everything else about it is the database's: assigning somebody sets
   * `assigned`, a partner's own teacher sets `external`, and taking an
   * instructor away returns the booking to `to_define`. What a person decides is
   * whether an empty slot has become a problem, and that is one click.
   *
   * **No confirmation, and no optimistic chip.** Unlike a drag, this changes
   * nothing about where anything is and is undone by clicking the same control
   * again — a dialog for a reversible one-click label would be ceremony. It does
   * not paint the new state ahead of the server either, because the answer can
   * legitimately differ from the request: escalating a booking that turns out to
   * be staffed comes back `assigned`, and a chip that had already gone red would
   * flick back and look like a bug.
   */
  function setStaffing(subject: Placed, next: 'to_define' | 'uncovered'): void {
    if (subject.scheduleId === null) return;
    setError(null);

    startPending(async () => {
      const result = await setInstructorStatusAction(
        organizationId,
        subject.scheduleId as string,
        next,
      );
      if (!result.ok) setError(result.errorKey);
    });
  }

  function resizeBy(subject: Placed, delta: number): void {
    const covered = slotsCovered(subject.startMinutes, subject.durationMinutes, slots);
    const last = covered[covered.length - 1];
    if (last === undefined) return;

    const index = slots.findIndex((candidate) => candidate.id === last.id);
    const next = slots[index + delta];
    if (next === undefined) return;

    const minutes = toMinutes(next.endTime) - subject.startMinutes;
    if (minutes < 5) return;

    propose(subject, {
      weekday: subject.weekday,
      slotId: subject.slotId,
      startTime: toTime(subject.startMinutes),
      laneIds: subject.laneIds,
      duplicate: false,
      durationMinutes: minutes,
    });
  }

  function onDragEnd(event: DragEndEvent): void {
    setDragging(null);

    const over = event.over;
    if (over === null) return;

    const [, weekdayText, slotId, laneId] = String(over.id).split(':');
    const weekday = Number(weekdayText);
    const slot = slots.find((candidate) => candidate.id === slotId);
    if (slot === undefined || laneId === undefined) return;

    const active = String(event.active.id);
    // Read now, at the drop — see `altHeld`. Holding Alt and pressing Space to
    // drop is the keyboard's version of the same decision.
    const duplicate = altHeld.current;

    /*
     * The tray: an unscheduled turma being placed for the first time.
     *
     * Still goes through `placeSlotAction`, which creates the schedule row; the
     * lane it landed on is applied straight afterwards by the move endpoint,
     * because creating a schedule and giving it lanes are two different writes
     * today and merging them is POOLSE-51's business, not this ticket's.
     */
    if (active.startsWith('group:')) {
      const groupId = active.slice('group:'.length);
      const group = mine.find((candidate) => candidate.id === groupId);
      if (group === undefined) return;

      if (closedOn(weekday) !== null || !openOn(weekday)) {
        setError('grid.dayClosed');
        return;
      }

      const durationMinutes =
        toMinutes(slot.endTime) - toMinutes(slot.startTime) ||
        group.schedules[0]?.durationMinutes ||
        FALLBACK_DURATION;

      setError(null);
      setOptimistic({
        kind: 'place',
        groupId,
        weekday,
        startMinutes: toMinutes(slot.startTime),
        durationMinutes,
      });
      setProposal({
        kind: 'place',
        groupId,
        name: group.name,
        weekday,
        startTime: slot.startTime,
        durationMinutes,
      });
      return;
    }

    /*
     * The edge handle: a lane span, and nothing else moves.
     *
     * The block keeps its day and its slot; only the run of lanes changes, from
     * its first lane down to whichever row the edge was dropped on. Dragging the
     * edge *up* past the first lane is a shrink, which is why the run is built
     * from the two endpoints rather than by appending.
     */
    /*
     * The bottom edge: the class runs to the end of the row it was dropped on.
     *
     * Its day, its slot and its lanes are all untouched — only the length
     * changes. Dragging it *up* onto its own row shortens it back to that row,
     * which is how a 90-minute class becomes 45 again.
     */
    if (active.startsWith('dur:')) {
      const scheduleId = active.slice('dur:'.length);
      const subject = placed.find((candidate) => candidate.scheduleId === scheduleId);
      if (subject === undefined) return;

      const minutes = toMinutes(slot.endTime) - subject.startMinutes;
      // Dropping above the block's own start would be a negative length.
      if (minutes < 5) return;

      propose(subject, {
        weekday: subject.weekday,
        slotId: subject.slotId,
        startTime: toTime(subject.startMinutes),
        laneIds: subject.laneIds,
        duplicate: false,
        durationMinutes: minutes,
      });
      return;
    }

    if (active.startsWith('edge:')) {
      const scheduleId = active.slice('edge:'.length);
      const subject = placed.find((candidate) => candidate.scheduleId === scheduleId);
      if (subject === undefined) return;

      const target = lanes.findIndex((lane) => lane.id === laneId);
      if (target === -1) return;

      /*
       * A booking with no lane yet anchors on wherever the handle was dropped.
       *
       * This returned early before, which is why the corner grip did nothing on
       * most turmas: `class_group.lane_id` has always been optional, so a club's
       * older classes have no lane at all, `laneIds[0]` was undefined, and the
       * anchor lookup failed. Treating the drop as both ends of the run gives
       * that first lane, which is the only sensible reading of "make this one
       * lane wide, here".
       */
      const first = subject.laneIds[0];
      const anchor = first === undefined ? target : lanes.findIndex((lane) => lane.id === first);
      if (anchor === -1) return;

      const from = Math.min(anchor, target);
      const to = Math.max(anchor, target);
      const run = lanes.slice(from, to + 1).map((lane) => lane.id);

      propose(subject, {
        weekday: subject.weekday,
        slotId: subject.slotId,
        startTime: toTime(subject.startMinutes),
        laneIds: run,
        duplicate: false,
      });
      return;
    }

    const scheduleId = active.slice('slot:'.length);
    const subject = placed.find((candidate) => candidate.scheduleId === scheduleId);
    if (subject === undefined) return;

    /*
     * The block keeps the width it had, landing on the lane it was dropped on.
     *
     * A three-lane squad dragged to Thursday is still a three-lane squad; making
     * a move silently narrow it to one lane would be the drag quietly editing
     * something nobody touched.
     */
    const width = Math.max(1, subject.laneIds.length);
    const target = lanes.findIndex((lane) => lane.id === laneId);
    if (target === -1) return;
    const run = lanes.slice(target, target + width).map((lane) => lane.id);

    propose(subject, {
      weekday,
      slotId: slot.id,
      startTime: slot.startTime,
      laneIds: run,
      duplicate,
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

      if (asked.kind === 'duplicate') {
        const made = await duplicateBookingAction(organizationId, asked.scheduleId, {
          weekday: asked.weekday,
          slotId: asked.slotId,
          startTime: asked.slotId === null ? asked.startTime : null,
          laneIds: asked.laneIds,
        });
        setOptimistic(null);
        if (!made.ok) setError(made.detail ?? made.errorKey);
        // No undo banner: the copy is a new block sitting on the grid, and
        // removing it is the same gesture as removing any other.
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

      /*
       * The booking endpoint, not the turma one — POOLSE-50.
       *
       * It carries the lanes and works for any subject, which is what lets a
       * school's booking be moved by the same gesture as a class. `moveSlotAction`
       * stays for the undo below, which puts a *pattern* back and only ever
       * applies to a turma.
       */
      const result = await moveBookingAction(organizationId, asked.scheduleId, {
        weekday: asked.weekday,
        slotId: asked.slotId,
        startTime: asked.slotId === null ? asked.startTime : null,
        laneIds: asked.laneIds,
        durationMinutes: asked.durationMinutes,
      });
      setOptimistic(null);
      if (!result.ok) {
        setError(result.detail ?? result.errorKey);
        return;
      }

      // Kept after the save, and this is the second half of what was asked for:
      // a move that was confirmed on purpose and is still wrong goes back in one
      // click, to the exact day and time it came from. Only a turma has a
      // pattern to put back, so only a turma offers it.
      if (asked.groupId !== null) {
        setUndo({ groupId: asked.groupId, scheduleId: asked.scheduleId });
        undoTarget.current = asked.from;
      }
    });
  }

  const draggingLabel = (() => {
    if (dragging === null) return null;
    if (dragging.startsWith('group:')) {
      return mine.find((group) => group.id === dragging.slice('group:'.length))?.name ?? null;
    }

    const id = draggedScheduleId(dragging);
    if (id === null) return null;

    const row = placed.find((candidate) => candidate.scheduleId === id);
    if (row === undefined) return null;

    /*
     * A resize says what it is resizing, not just what it is holding.
     *
     * Dragging a 12px grip with no label and no moving block looked like
     * nothing was happening at all — the commonest reason somebody concludes a
     * gesture does not work is that it gave them no evidence it started.
     */
    if (dragging.startsWith('edge:')) return t('grid.resizingLanes', { name: row.name });
    if (dragging.startsWith('dur:')) return t('grid.resizingLength', { name: row.name });
    return row.name;
  })();

  const rowRem = ROW_REM[prefs.density];

  /*
   * The rules, in the shape `@poolse/rules` wants — POOLSE-51, criterion 10.
   *
   * The same functions the API calls at the drop. That is the whole point: a
   * cell that says "fine" while the pointer is over it, followed by a server
   * that refuses the drop, is the worst version of this feature, and the only
   * way to be sure they agree is for there to be one implementation.
   *
   * Memoised because it is rebuilt from every booking on the grid and is read
   * once per cell during a drag — 420 cells on a full grid.
   */
  const ruleLanes = useMemo<RuleLane[]>(
    () =>
      lanes.map((lane) => ({
        id: lane.id,
        poolId: lane.poolId,
        name: lane.name,
        position: lane.position,
        defaultCapacity: lane.defaultCapacity,
      })),
    [lanes],
  );

  const ruleBookings = useMemo<RuleBooking[]>(
    () =>
      placed
        .filter((row) => row.scheduleId !== null)
        .map((row) => ({
          id: row.scheduleId ?? row.key,
          weekday: row.weekday,
          startMinutes: row.startMinutes,
          durationMinutes: row.durationMinutes,
          laneIds: row.laneIds,
          poolId:
            lanes.find((lane) => lane.id === row.laneIds[0])?.poolId ?? null,
          instructorId: row.instructorId,
          levelId: row.levelId,
          headcount: row.headcount,
          cancelled: row.cancelled,
          name: row.name,
        })),
    [placed, lanes],
  );

  const ruleContext = useMemo<RuleContext>(
    () => ({
      lanes: ruleLanes,
      bookings: ruleBookings,
      laneLevelCapacity,
      openWeekdays: WEEKDAYS.filter((day) => openOn(day)),
      closures,
      maxConcurrentGroupsPerInstructor: maxConcurrentGroups,
    }),
    // `openOn` closes over `facility`, which is why that is the dependency.
    [ruleLanes, ruleBookings, laneLevelCapacity, facility, closures, maxConcurrentGroups],
  );

  /** The block being dragged, in rule terms — null unless a drag is in flight. */
  const draggingSubject = useMemo<RuleBooking | null>(() => {
    if (dragging === null) return null;
    const id = draggedScheduleId(dragging);
    if (id === null) return null;
    return ruleBookings.find((booking) => booking.id === id) ?? null;
  }, [dragging, ruleBookings]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
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
            <ExportLinks
              facilityId={facility?.id ?? ''}
              seasonId={seasonId}
              filters={filters}
            />

            <StaffingCounter
              staffing={staffing}
              seasonName={seasonName}
              seasonStatus={seasonStatus}
              active={staffingFilter}
              busy={navigating}
              onFilter={filterStaffing}
            />

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
              slots={slots}
              days={shownDays}
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
              onSpan={spanBy}
              onResize={resizeBy}
              onStaffing={setStaffing}
              ruleContext={ruleContext}
              draggingSubject={draggingSubject}
            />

            {legend.length > 0 && (
              <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.825rem] text-foreground-muted">
                {legend.map((category) => (
                  <li key={category.id} className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className={cn(
                        'size-3.5 rounded-sm border',
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
                      <span className="font-mono text-[0.825rem]">{toTime(row.startMinutes)}</span>
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
 * The two ways the timetable leaves the screen — POOLSE-54, criterion 9.
 *
 * **Ordinary links, not buttons.** One opens a page laid out for paper, the
 * other is a file the browser downloads; neither needs JavaScript, and both are
 * reproducible from the URL they point at, which is what makes a filtered
 * export shareable — 54.15.
 *
 * They carry every filter, including the five the screen keeps in
 * `localStorage`. That is the whole reason `gridFilterQuery` exists: a sheet
 * printed from a filtered grid must contain what was on screen, and must say so
 * in its header rather than leaving somebody to notice.
 */
function ExportLinks({
  facilityId,
  seasonId,
  filters,
}: {
  facilityId: string;
  seasonId: string | null;
  filters: GridFilters;
}): React.ReactElement | null {
  const t = useTranslations();

  // No site means no grid to export. The empty-grid message already says so.
  if (facilityId === '') return null;

  const query = gridFilterQuery(filters, {
    [FILTER_PARAM.facility]: facilityId,
    [FILTER_PARAM.season]: seasonId,
  });

  const style =
    'inline-flex h-control items-center gap-1.5 rounded border border-border px-2.5 text-sm hover:border-primary/50 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/*
        A new tab, because the print page replaces the whole screen and somebody
        who has spent ten minutes arranging a grid should still have it when the
        printing is done.
      */}
      <a href={`/dashboard/calendar/print?${query}`} target="_blank" rel="noopener" className={style}>
        <Printer aria-hidden className="size-4" />
        {t('grid.export.print')}
      </a>

      <a href={`/dashboard/calendar/export?${query}`} className={style}>
        <Download aria-hidden className="size-4" />
        {t('grid.export.excel')}
      </a>
    </div>
  );
}

/**
 * "7 aulas sem professor em 2026/2027" — POOLSE-53.
 *
 * The club named this as its main problem, and the whole feature is one number
 * and one filter: **how many, and which ones.**
 *
 * **Two counts, never one.** `to_define` sits beside `uncovered`, quieter.
 * Hiding it would make the two states feel like one, which is the distinction
 * this whole ticket exists to preserve — and a club that cannot see its twelve
 * undecided slots will read the seven uncovered ones as the whole problem.
 *
 * **Absent, not zero.** A club with nothing to report gets no banner rather than
 * a green "0 aulas sem professor" — criterion 8. A counter that is always there
 * is furniture, and furniture does not get looked at. The one exception is a
 * filter that is on: then the way back has to stay on screen even when the count
 * behind it has just reached zero.
 *
 * **The alert is a chip with its own background**, and the same shape as its
 * quieter neighbour, because it sits above a grid full of category and partner
 * colours — the Dev note's failure mode is a red "Sem professor" on a red
 * partner block. Colour is never alone here either: an icon and a full sentence.
 */
function StaffingCounter({
  staffing,
  seasonName,
  seasonStatus,
  active,
  busy,
  onFilter,
}: {
  staffing: GridStaffing;
  seasonName: string | null;
  seasonStatus: string | null;
  active: InstructorState | null;
  busy: boolean;
  onFilter: (next: InstructorState | null) => void;
}): React.ReactElement | null {
  const t = useTranslations();

  if (staffing.uncovered === 0 && staffing.toDefine === 0 && active === null) return null;

  // A season with no name is a club that has not opened one; the sentence drops
  // to the plain count rather than printing "em null".
  const season = seasonName ?? '';

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {staffing.uncovered > 0 && (
        <button
          type="button"
          onClick={() => onFilter('uncovered')}
          aria-pressed={active === 'uncovered'}
          disabled={busy}
          className={cn(
            'inline-flex items-center gap-2 rounded px-2.5 py-1 font-medium',
            /*
              A solid fill, not `bg-danger/10` with red text on it. The tinted
              version measures 4.40:1 in the light theme at 14px, which is under
              4.5 and is not large text — so it fails 1.4.3 by a whisker. The
              solid pair is 5.05:1 light and 5.92:1 dark, and it matches the chip
              the cell itself draws, so the same thing looks the same in both
              places.
            */
            'bg-destructive text-destructive-foreground',
            'hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger',
            active === 'uncovered' && 'ring-2 ring-foreground/40 ring-offset-2 ring-offset-surface',
            busy && 'opacity-60',
          )}
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {season === ''
            ? t('grid.staffing.uncoveredBare', { count: staffing.uncovered })
            : t('grid.staffing.uncovered', { count: staffing.uncovered, season })}
        </button>
      )}

      {staffing.toDefine > 0 && (
        <button
          type="button"
          onClick={() => onFilter('to_define')}
          aria-pressed={active === 'to_define'}
          disabled={busy}
          className={cn(
            'inline-flex items-center gap-2 rounded border border-border px-2.5 py-1 text-foreground-muted',
            'hover:border-border-strong hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
            active === 'to_define' && 'ring-2 ring-primary/40',
            busy && 'opacity-60',
          )}
        >
          {/*
            `???` is a symbol, not a string — criterion 11. It is what the club
            already writes on its own printed sheet, and it means the same thing
            in both locales, so it never goes through the catalogue.
          */}
          <span aria-hidden className="font-mono">
            ???
          </span>
          {t('grid.staffing.toDefine', { count: staffing.toDefine })}
        </button>
      )}

      {/*
        Which season these figures are about, when it is not the one on the wall.
        A draft is next year's plan, and "7 aulas sem professor" read off next
        year's draft as though it were September is the one way this counter can
        actively mislead — 53.13.
      */}
      {seasonStatus === 'draft' && (
        <span className="rounded border border-border px-2 py-1 text-[0.8125rem] text-foreground-muted">
          {t('grid.staffing.draftSeason')}
        </span>
      )}

      {active !== null && (
        <button
          type="button"
          onClick={() => onFilter(null)}
          disabled={busy}
          className="rounded px-1 text-foreground-muted underline-offset-2 hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t('grid.staffing.showAll')}
        </button>
      )}
    </div>
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
          {/*
            Three questions, not two — POOLSE-50. A duplicate has to say it
            leaves the original where it is, because the block the operator just
            let go of looks identical either way and the difference is the whole
            decision.
          */}
          {t(
            proposal.kind === 'duplicate'
              ? 'grid.confirmDuplicate'
              : proposal.kind === 'move'
                ? 'classes.confirmMove'
                : 'classes.confirmPlace',
            {
              name: proposal.name,
              day: dayNames[proposal.weekday] ?? '',
              time: proposal.startTime.slice(0, 5),
            },
          )}
        </h2>

        {/*
          The one thing here somebody could reasonably get wrong: a class on
          screen is one Thursday, and the row being moved belongs to every
          Thursday. Said in the dialog rather than only on the board above,
          because this is the moment the decision is actually made.
        */}
        {/*
          How many lanes it will take, when that is more than one — QA 50.5.
          A three-lane span and a one-lane block are the same shape in a dialog
          that does not say so, and the span is exactly what an edge-drag changed.
        */}
        {(proposal.kind === 'move' || proposal.kind === 'duplicate') &&
          proposal.laneIds.length > 1 && (
            <p className="text-sm text-foreground-muted">
              {t('grid.spanNote', { count: proposal.laneIds.length })}
            </p>
          )}

        <p className="text-sm text-foreground-muted">
          {t(
            proposal.kind === 'duplicate'
              ? 'grid.duplicateNote'
              : canScope
                ? 'classes.moveScopeNote'
                : 'classes.patternNote',
          )}
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
  onSpan,
  onResize,
  onStaffing,
  ruleContext,
  draggingSubject,
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
  /** `Shift`+arrow on a focused block. The keyboard's edge handle. */
  onSpan: (booking: Placed, delta: number) => void;
  /** `Ctrl`+arrow: lengthen or shorten the class by one slot. */
  onResize: (booking: Placed, delta: number) => void;
  /** The operator escalates a slot to "sem professor", or takes it back. */
  onStaffing: (booking: Placed, next: 'to_define' | 'uncovered') => void;
  ruleContext: RuleContext;
  /** The block in flight, so every cell can say what dropping it here would do. */
  draggingSubject: RuleBooking | null;
}): React.ReactElement {
  const t = useTranslations();

  if (lanes.length === 0) {
    return (
      <p className="rounded border border-dashed border-border p-4 text-sm text-foreground-muted">
        {t('grid.noLanes')}
      </p>
    );
  }

  /** Which lanes are actually drawn, so a span is clipped to what is on screen. */
  const laneKeys = new Set(lanes.map((lane) => lane.id));

  /*
   * A row is a start time, not a slot — which is what lets one grid hold the
   * whole week.
   *
   * The weekend was a separate grid because its slots differ, and the fix was
   * never more width: it was to stop assuming every column draws from the same
   * list. Rows are the union of the start times the shown days offer between
   * them; a day with no slot at that time gets a cell that says so instead of a
   * droppable one.
   */
  const times = rowTimes(slots, days);

  /** That day's own slot at this time, if it has one. */
  const slotAt = (day: number, startTime: string): GridSlot | undefined =>
    slotAtTime(slots, day, startTime);

  const columns = `${TIME_COL}rem ${LANE_COL}rem repeat(${days.length}, minmax(6.625rem, 1fr))`;

  /*
   * A running row cursor rather than `slotIndex * lanes.length`.
   *
   * Every cell is placed with an explicit `gridRow`, and a slot is no longer a
   * fixed height: one carrying a laneless booking is a row taller. Multiplying
   * by the index would overlap the slot below it the moment that happened.
   */
  let rowStart = 2;

  return (
    <section className="flex flex-col gap-2">
      {heading !== null && <h3 className="text-sm font-medium">{heading}</h3>}

      {/* The grid scrolls sideways and up inside itself, never the page. */}
      <div className="max-h-[70vh] overflow-auto rounded border border-border">
        <div
          className="grid min-w-max"
          style={{ gridTemplateColumns: columns }}
          role="grid"
          aria-label={heading ?? t('grid.wholeWeek')}
        >
          {/* Header row: the two rail labels, then the days. */}
          <div
            className="sticky left-0 top-0 z-30 border-b border-border bg-surface px-2 py-1 text-left text-[0.825rem] font-medium uppercase tracking-wider text-foreground-muted"
            style={{ gridColumn: 1, gridRow: 1 }}
          >
            {t('grid.time')}
          </div>
          <div
            className="sticky top-0 z-30 border-b border-l border-border bg-surface px-2 py-1 text-left text-[0.825rem] font-medium uppercase tracking-wider text-foreground-muted"
            style={{ gridColumn: 2, gridRow: 1, left: `${TIME_COL}rem` }}
          >
            {t('grid.lane')}
          </div>

          {days.map((day, index) => {
            const closed = closedOn(day);
            return (
              <div
                key={day}
                className="sticky top-0 z-20 border-b border-l border-border bg-surface px-2 py-1 text-center text-[0.825rem] font-medium uppercase tracking-wider text-foreground-muted"
                style={{ gridColumn: 3 + index, gridRow: 1 }}
              >
                {dayNames[day] ?? t(`week.${day}`)}
                {/*
                  The closure's name, not just a shade. A dim column says
                  something is different; "Natal" says what, which is the
                  question the operator actually has.
                */}
                {closed !== null && (
                  <span className="mt-0.5 flex items-center justify-center gap-1 text-[0.715rem] font-normal normal-case text-warning">
                    <Lock aria-hidden className="size-3.5" />
                    {closed}
                  </span>
                )}
              </div>
            );
          })}

          {times.map((startTime) => {
            /*
             * Every slot at this time, across the days on screen. Usually one —
             * two when a weekday and a Saturday both start at 09:30 and are
             * therefore the same row of the grid.
             */
            const rowSlots = days
              .map((day) => slotAt(day, startTime))
              .filter((slot): slot is GridSlot => slot !== undefined);

            const rowSlotIds = new Set(rowSlots.map((slot) => slot.id));

            const laneless = placed.filter(
              (row) => row.slotId !== null && rowSlotIds.has(row.slotId) && row.laneIds.length === 0,
            );

            // Row 1 is the header. Each time takes its lanes, plus one more row
            // when something on it has no lane — so the offset is a running
            // total rather than `index * lanes.length`.
            const firstRow = rowStart;
            rowStart += lanes.length + (laneless.length > 0 ? 1 : 0);

            /*
             * The end time, only when every day that offers this row agrees.
             *
             * A Saturday 07:30–08:00 beside a weekday 07:30–08:15 would be one
             * row with two different ends, and printing one of them would be
             * the rail quietly lying about the other. Blank is honest; each
             * block still draws its own real length.
             */
            const ends = new Set(rowSlots.map((slot) => slot.endTime));
            const endTime = ends.size === 1 ? [...ends][0] : null;

            return (
              <Fragment key={startTime}>
                {/*
                  The slot's hours, spanning its lanes. A real row span rather
                  than a repeated label: repeating it six times is six times the
                  ink for one fact, and the eye stops reading it.
                */}
                <div
                  className="sticky left-0 z-20 flex items-start justify-end border-t-2 border-border bg-surface px-2 pt-1 text-right font-mono text-[0.775rem] leading-tight text-foreground-muted"
                  style={{
                    gridColumn: 1,
                    gridRow: `${firstRow} / span ${lanes.length + (laneless.length > 0 ? 1 : 0)}`,
                  }}
                >
                  <span>
                    {startTime}
                    {endTime !== null && (
                      <span className="block text-foreground-muted/60">{endTime}</span>
                    )}
                  </span>
                </div>

                {lanes.map((lane, laneOffset) => {
                  const row = firstRow + laneOffset;
                  const firstOfSlot = laneOffset === 0;

                  return (
                    <Fragment key={`${startTime}:${lane.id}`}>
                      <div
                        className={cn(
                          'sticky z-10 flex items-center gap-1 border-l border-border bg-surface px-2 text-[0.775rem] text-foreground-muted',
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
                        /*
                         * This day's own slot at this row's time. Absent means
                         * the club does not run anything at 07:30 on a Tuesday
                         * even though it does on a Saturday — a real gap, drawn
                         * as unavailable rather than as an empty target.
                         */
                        const slot = slotAt(day, startTime);

                        if (slot === undefined) {
                          return (
                            <div
                              key={`${day}:${startTime}:${lane.id}`}
                              aria-hidden
                              className={cn(
                                'border-l border-border bg-surface-muted/70',
                                firstOfSlot ? 'border-t-2' : 'border-t border-border/40',
                              )}
                              style={{
                                gridColumn: 3 + dayIndex,
                                gridRow: row,
                                height: `${rowRem}rem`,
                              }}
                            />
                          );
                        }

                        // Only the slots this day actually offers, or a booking
                        // would be judged against a Saturday row on a Tuesday.
                        const daySlots = slotsFor(slots, day);

                        /*
                         * What sits here, and how much of the grid it takes.
                         *
                         * One call, into `lib/grid-layout.ts`, which the printed
                         * sheet uses too — POOLSE-54, criterion 8. Two copies of
                         * "which slots does a 90-minute class cover" would be
                         * two answers to the one question the wall and the
                         * screen have to agree about.
                         */
                        const cell = cellAt(placed, day, lane.id, slot, daySlots, laneKeys);
                        const here = cell?.booking;
                        const continues = cell?.continues ?? false;
                        const span = cell?.span ?? 1;

                        return (
                          <Cell
                            key={`${day}:${startTime}:${lane.id}`}
                            day={day}
                            slot={slot}
                            lane={lane}
                            column={3 + dayIndex}
                            row={row}
                            booking={here}
                            continues={continues}
                            span={span}
                            rowRem={rowRem}
                            density={density}
                            firstOfSlot={firstOfSlot}
                            dragging={dragging}
                            open={openOn(day) && closedOn(day) === null}
                            canManage={canManage}
                            dayName={dayNames[day] ?? String(day)}
                            onSpan={onSpan}
                            onResize={onResize}
                            onStaffing={onStaffing}
                            ruleContext={ruleContext}
                            draggingSubject={draggingSubject}
                          />
                        );
                      })}
                    </Fragment>
                  );
                })}

                {/*
                  Bookings on this slot that have no lane — the row that stops a
                  class disappearing.

                  A turma is not required to name a lane, and most clubs' older
                  ones do not: `class_group.lane_id` was optional long before
                  lanes were rows. When the grid became lanes-down, every one of
                  those had no cell to be drawn in and silently vanished — the
                  whole calendar looked empty. This is the honest place for them:
                  present, on the right slot and day, and saying that the lane is
                  the thing nobody has decided.

                  Rendered only for slots that actually have one, so a club that
                  has assigned every lane never sees this row at all.
                */}
                {laneless.length > 0 && (
                  <NoLaneRow
                    startTime={startTime}
                    row={firstRow + lanes.length}
                    days={days}
                    placed={laneless}
                    rowRem={rowRem}
                    density={density}
                    canManage={canManage}
                    onSpan={onSpan}
                    onResize={onResize}
                    onStaffing={onStaffing}
                  />
                )}
              </Fragment>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/**
 * One row per slot for the bookings that name no lane.
 *
 * Not a droppable: there is nothing to drop *into* "no lane" — moving one of
 * these onto a real lane is what the grid is for, and it is done by dragging the
 * block up into a lane cell, which POOLSE-50 already handles. So this row shows
 * and hands over, and does not pretend to be a target.
 */
function NoLaneRow({
  startTime,
  row,
  days,
  placed,
  rowRem,
  density,
  canManage,
  onSpan,
  onResize,
  onStaffing,
}: {
  startTime: string;
  row: number;
  days: readonly number[];
  placed: Placed[];
  rowRem: number;
  density: Density;
  canManage: boolean;
  onSpan: (booking: Placed, delta: number) => void;
  /** `Ctrl`+arrow: lengthen or shorten the class by one slot. */
  onResize: (booking: Placed, delta: number) => void;
  /** The operator escalates a slot to "sem professor", or takes it back. */
  onStaffing: (booking: Placed, next: 'to_define' | 'uncovered') => void;
}): React.ReactElement {
  const t = useTranslations();

  return (
    <>
      <div
        className="sticky z-10 flex items-center border-l border-t border-border/40 bg-surface px-2 text-[0.775rem] italic text-foreground-muted"
        style={{ gridColumn: 2, gridRow: row, left: `${TIME_COL}rem`, height: `${rowRem}rem` }}
      >
        <span className="truncate">{t('grid.noLane')}</span>
      </div>

      {days.map((day, dayIndex) => {
        const here = placed.find((candidate) => candidate.weekday === day);

        return (
          <div
            key={`${day}:${startTime}:nolane`}
            role="gridcell"
            aria-label={
              here === undefined
                ? t('grid.emptyCell', {
                    day: String(day),
                    time: startTime,
                    lane: t('grid.noLane'),
                  })
                : t('grid.filledCell', {
                    day: String(day),
                    time: startTime,
                    lane: t('grid.noLane'),
                    what: here.name,
                  })
            }
            className="relative border-l border-t border-border/40 bg-surface-muted/40 px-0.5"
            style={{ gridColumn: 3 + dayIndex, gridRow: row, height: `${rowRem}rem` }}
          >
            {here !== undefined && (
              <div
                className="absolute inset-x-0.5 top-0 z-10"
                style={{ height: `calc(${rowRem}rem - 1px)` }}
              >
                <BookingChip
                  booking={here}
                  canManage={canManage}
                  density={density}
                  continues={false}
                  onSpan={onSpan}
                  onResize={onResize}
                  onStaffing={onStaffing}
                  concurrency={1}
                />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function Cell({
  day,
  slot,
  lane,
  column,
  row,
  booking,
  continues,
  span,
  rowRem,
  density,
  firstOfSlot,
  dragging,
  open,
  canManage,
  dayName,
  onSpan,
  onResize,
  onStaffing,
  ruleContext,
  draggingSubject,
}: {
  day: number;
  slot: GridSlot;
  lane: GridLane;
  column: number;
  row: number;
  booking: Placed | undefined;
  /** True for the second and later rows of a class that runs past one slot. */
  continues: boolean;
  span: number;
  rowRem: number;
  density: Density;
  firstOfSlot: boolean;
  dragging: boolean;
  open: boolean;
  canManage: boolean;
  dayName: string;
  onSpan: (booking: Placed, delta: number) => void;
  /** `Ctrl`+arrow: lengthen or shorten the class by one slot. */
  onResize: (booking: Placed, delta: number) => void;
  /** The operator escalates a slot to "sem professor", or takes it back. */
  onStaffing: (booking: Placed, next: 'to_define' | 'uncovered') => void;
  ruleContext: RuleContext;
  draggingSubject: RuleBooking | null;
}): React.ReactElement {
  const t = useTranslations();

  /*
   * What dropping the block in flight here would do — AC8.
   *
   * Computed while the pointer is still moving, so the answer arrives *before*
   * release rather than as a refusal afterwards. Only during a drag: evaluating
   * 420 cells on every render of a static grid would be work nobody sees.
   */
  const preview = useMemo<Reason[]>(() => {
    if (draggingSubject === null) return [];
    return evaluate(
      draggingSubject,
      {
        weekday: day,
        startMinutes: toMinutes(slot.startTime),
        durationMinutes: draggingSubject.durationMinutes,
        laneIds: [lane.id],
      },
      ruleContext,
    );
  }, [draggingSubject, day, slot.startTime, lane.id, ruleContext]);

  const verdict: Verdict = draggingSubject === null ? 'ok' : verdictOf(preview);
  const headline = preview[0];

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
        dragging && open && booking === undefined && verdict === 'ok' && 'bg-primary/5',
        /*
          Three states, and never colour alone — AC8. A tint says "something",
          the icon says which, and the title says why in words. The blocked
          pattern is a diagonal hatch as well as a tint, so the two states are
          distinguishable without relying on hue at all.
        */
        dragging && verdict === 'warn' && 'bg-warning/20',
        dragging && verdict === 'block' && 'bg-danger/20',
        isOver && verdict === 'ok' && 'bg-primary/25 outline outline-2 outline-primary',
        isOver && verdict === 'warn' && 'outline outline-2 outline-warning',
        isOver && verdict === 'block' && 'outline outline-2 outline-danger',
      )}
      /*
        The reason as text, on hover and on focus. "Pista 3 já tem Infantis" is
        actionable; a red cell is not — and a title is what a pointer user reads
        without having to drop first to find out.
      */
      title={
        headline === undefined
          ? undefined
          : t(`grid.reason.${headline.code}`, headline.detail as Record<string, string>)
      }
      style={{ gridColumn: column, gridRow: row, height: `${rowRem}rem` }}
    >
      {/*
        The icon, for the case where the tint is invisible — a colour-blind
        reader, a dim screen, a printed page. It sits in the corner so it never
        covers a block already in the cell.
      */}
      {dragging && verdict !== 'ok' && (
        <span className="pointer-events-none absolute right-0 top-0 z-20">
          {verdict === 'block' ? (
            <Ban aria-hidden className="size-3.5 text-danger" />
          ) : (
            <AlertTriangle aria-hidden className="size-3.5 text-warning" />
          )}
        </span>
      )}

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
          <BookingChip
            booking={booking}
            canManage={canManage}
            density={density}
            continues={continues}
            onSpan={onSpan}
            onResize={onResize}
            onStaffing={onStaffing}
            /*
              Bookings, not lanes — the thing POOLSE-51 names as most likely to
              be got wrong. An instructor on one three-lane booking is running
              one group, and badging that ×3 would tell a club its best-staffed
              hour is its worst.
            */
            concurrency={
              booking.instructorId === null
                ? 1
                : concurrentGroups(
                    booking.instructorId,
                    {
                      weekday: booking.weekday,
                      startMinutes: booking.startMinutes,
                      durationMinutes: booking.durationMinutes,
                    },
                    ruleContext.bookings,
                  )
            }
          />
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
  continues,
  onSpan,
  onResize,
  onStaffing,
  concurrency,
}: {
  booking: Placed;
  canManage: boolean;
  density: Density;
  /** A later row of a class that runs past one slot: no label, no handles. */
  continues: boolean;
  onSpan: (booking: Placed, delta: number) => void;
  /** `Ctrl`+arrow: lengthen or shorten the class by one slot. */
  onResize: (booking: Placed, delta: number) => void;
  /** The operator escalates a slot to "sem professor", or takes it back. */
  onStaffing: (booking: Placed, next: 'to_define' | 'uncovered') => void;
  /** How many groups this instructor is running at this moment. 1 is silent. */
  concurrency: number;
}): React.ReactElement {
  const t = useTranslations();

  // Only a turma's pattern is draggable from here — POOLSE-50 gives the others
  // their own gesture. A parceria with a grip that refused on drop would be a
  // control that lies about what it does.
  /*
   * Anything with a real booking behind it can be moved — POOLSE-50.
   *
   * This used to demand `groupId !== null`, which meant only a turma. That was
   * right while the only move was `moveSlotAction`, which edits a class group's
   * pattern; it stopped being right the moment moves went through
   * `moveBookingAction`, which takes any subject. The stale half of the
   * condition survived, so a parceria rendered with no grip and no edge handle
   * while the API was perfectly willing to move it.
   *
   * `scheduleId === null` is the optimistic overlay — a block that does not
   * exist yet cannot be picked up again. A cancelled class stays put because
   * moving something that is not happening is not a thing to offer.
   */
  const draggable = canManage && booking.scheduleId !== null && !booking.cancelled;

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
      /*
       * `Shift`+arrow grows and shrinks the lane span — AC2 and AC9, the
       * keyboard's version of the edge handle below.
       *
       * On the wrapper rather than on the grip, because the grip belongs to
       * dnd-kit's keyboard sensor: Space there starts a drag, and arrows during
       * one are how a block is moved. Shift+arrow is a different question asked
       * of the same block, so it is handled before dnd-kit sees it.
       */
      onKeyDown={(event) => {
        if (!canManage) return;
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        const step = event.key === 'ArrowDown' ? 1 : -1;

        /*
         * Shift grows the lane span, Ctrl grows the length, and plain arrows
         * belong to dnd-kit — they move a block once it has been picked up with
         * Space. Three gestures on one key, separated by modifier, and each one
         * is the keyboard twin of a grip on the block.
         */
        if (event.shiftKey) {
          event.preventDefault();
          event.stopPropagation();
          onSpan(booking, step);
          return;
        }
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          event.stopPropagation();
          onResize(booking, step);
        }
      }}
      className={cn(
        'relative flex h-full w-full flex-col overflow-hidden border pl-1 pr-1 text-[0.775rem] leading-tight',
        tint,
        /*
          Joined across the hour line. The first part loses its bottom corners
          and its bottom border, the continuation loses its top ones — so two
          elements read as one block that happens to cross a row boundary.
        */
        continues ? 'rounded-b-sm border-t-0' : 'rounded-t-sm',
      )}
      style={
        booking.partnerColour === null
          ? undefined
          : { borderLeftColor: booking.partnerColour, borderLeftWidth: '4px' }
      }
    >
      {continues ? (
        /*
          The name again, dimmed. Not nothing: at compact density a reader
          scanning the 10:15 row has to be able to see *what* is still in that
          lane without looking up a row. Not the whole card either, or one class
          would look like two.
        */
        <span className="truncate italic text-foreground-muted">{booking.name}</span>
      ) : (
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
        <span className="flex shrink-0 items-center gap-0.5">
          {/*
            ×3 — how many groups this instructor has in the water right now.
            Only above one, because ×1 on every block is noise that hides the
            three that matter. Allowed and badged, never blocked: this is the
            club's ordinary Tuesday.
          */}
          {concurrency > 1 && (
            <span
              title={t('grid.concurrentGroups', { count: concurrency })}
              className={cn(
                'rounded-sm border border-primary/50 px-1 tabular-nums text-primary',
                compact ? 'text-[0.66rem]' : 'text-[0.715rem]',
              )}
            >
              ×{concurrency}
            </span>
          )}

          {booking.headcount !== null && (
            <span
              className={cn(
                'rounded-sm border border-border px-1 tabular-nums',
                compact ? 'text-[0.66rem]' : 'text-[0.715rem]',
              )}
            >
              {booking.headcount}
            </span>
          )}
        </span>
      </div>
      )}

      {!continues && (
        <InstructorLine
          booking={booking}
          compact={compact}
          canManage={canManage}
          onStaffing={onStaffing}
        />
      )}

      {booking.note !== null && !continues && (
        <span className="truncate font-medium text-warning">{booking.note}</span>
      )}

      {/*
        The edge handle — AC2.

        Dragged down or up across lane rows to set the span. It stops
        propagation on pointer-down for the reason the Dev note names: without
        it, the block's own draggable and this one fight over the pointer and
        the block simply moves instead of growing. The same trick the register
        and cancel controls already use.

        Four pixels tall and the full width, which is a real target at compact
        density; the keyboard equivalent is `Shift`+arrow on the block itself,
        so this is never the only way.
      */}
      {draggable && !continues && (
        <>
          {/*
            Two handles, because the grid has two downward axes and one edge
            cannot mean both.

            The **bottom edge** changes the class's length, which is what a
            bottom edge means in every calendar anybody has used. The **corner**
            changes how many lanes it takes, which is Poolse's own idea and
            therefore the one that has to be learned rather than assumed.

            Both stop propagation on pointer-down, or the block's own draggable
            claims the gesture and the class simply moves instead of resizing.
          */}
          <DurationHandle scheduleId={booking.scheduleId ?? ''} />
          <SpanHandle scheduleId={booking.scheduleId ?? ''} />
        </>
      )}

      {!continues &&
        (booking.controls.mark !== undefined || booking.controls.cancel !== undefined) && (
        <div
          className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-0.5"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {booking.controls.mark !== undefined && (
            <a
              href={booking.controls.mark.href}
              className="rounded text-[0.715rem] font-medium text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
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
 * The grip that sets how long the class runs.
 *
 * The bottom edge, because that is what a bottom edge does in every calendar
 * anybody has used — and this ticket's whole point is that a 90-minute class
 * should look 90 minutes long. Dragging it onto a lower slot row makes the class
 * run to the end of that row.
 *
 * The keyboard equivalent is `Ctrl`+arrow on the block: `Shift` is already the
 * lane span and `Alt` is already duplicate, and a third modifier that collided
 * with either would make one of them unreachable.
 */
/**
 * Who is teaching this, in four states that never look like each other — POOLSE-53.
 *
 * The states carry the same absence of data and opposite meanings, so each one
 * gets its own words and, where it matters, its own icon. **Colour is never the
 * signal**: `Sem professor` says "sem professor" and `???` prints the symbol the
 * club already writes on its printed sheet, so a screen reader and a monochrome
 * print-out both read the same thing the grid does — 53.12.
 *
 * **The alert is a chip with its own background, not coloured text.** The Dev
 * note names the failure mode precisely: a red `Sem professor` on a partner
 * block tinted red is unreadable, and a partner colour is an arbitrary hex an
 * operator typed. A chip carries its own ground with it and can be contrast-
 * checked once, against itself, in both themes.
 *
 * **At compact density the two gaps still render.** Compact drops names, because
 * a 1.4rem row cannot hold one — but dropping the alert as well would mean the
 * density toggle silently hides the thing this whole screen is for.
 */
function InstructorLine({
  booking,
  compact,
  canManage,
  onStaffing,
}: {
  booking: Placed;
  compact: boolean;
  canManage: boolean;
  onStaffing: (booking: Placed, next: 'to_define' | 'uncovered') => void;
}): React.ReactElement | null {
  const t = useTranslations();

  const status = booking.instructorStatus;

  /*
   * The two states an operator may set, and the toggle between them. Anything
   * else is a fact the database maintains, so the control is simply absent —
   * a button that would be refused is worse than no button.
   */
  const settable = status === 'to_define' || status === 'uncovered';
  const escalates = canManage && settable && booking.scheduleId !== null && !booking.cancelled;

  if (status === 'assigned') {
    // A staffed class at compact density shows nothing here: the row cannot hold
    // a name, and "somebody is teaching this" is the ordinary case that needs no
    // marker. The other three all leave a mark at both densities.
    if (compact) return null;
    return <span className="truncate text-foreground-muted">{booking.instructorName}</span>;
  }

  if (status === 'external') {
    /*
     * The partner's own teacher — 53.8 and 53.9. Their name where the group gave
     * one, and the partner's own name where it did not, because "a school is
     * sending somebody" is still more than the club knows about an empty slot.
     */
    const who = instructorDisplay(booking).name;

    return (
      <span className="flex min-w-0 items-center gap-1 text-foreground-muted">
        {!compact && who !== null && <span className="truncate">{who}</span>}
        <span
          className={cn(
            'shrink-0 rounded-sm border border-border px-1',
            compact ? 'text-[0.66rem]' : 'text-[0.715rem]',
          )}
        >
          {t('grid.staffing.ownTeacher')}
        </span>
      </span>
    );
  }

  const uncovered = status === 'uncovered';

  const body = uncovered ? (
    <>
      <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{t('grid.noInstructor')}</span>
    </>
  ) : (
    <>
      {/* A symbol, not a string — criterion 11. It means the same in both locales. */}
      <span aria-hidden className="shrink-0 font-mono">
        ???
      </span>
      <span className="truncate">{t('grid.staffing.pending')}</span>
    </>
  );

  /*
   * Both fills are opaque, and that is the whole trick — criterion 10.
   *
   * The first version was `bg-danger/15` with `text-danger` on it, which lets
   * the cell's own tint through and lands between 3.61:1 and 4.05:1 depending on
   * which category the block belongs to. At 10–11px that is not large text, so
   * it fails 1.4.3 on every colour — worst on the red category, which is exactly
   * the case the Dev note warns about.
   *
   * Solid fills measure once and hold everywhere: 5.05:1 light and 5.92:1 dark
   * for the alert, 5.22:1 and 6.01:1 for the quiet one, on any cell colour,
   * because no cell colour reaches them.
   */
  const chip = cn(
    'flex min-w-0 items-center gap-1 rounded-sm px-1',
    compact ? 'text-[0.66rem]' : 'text-[0.715rem]',
    uncovered
      ? 'bg-destructive font-medium text-destructive-foreground'
      : 'border border-border bg-surface-muted text-foreground-muted',
  );

  if (!escalates) return <span className={chip}>{body}</span>;

  return (
    <button
      type="button"
      /*
       * The block underneath is draggable, and dnd-kit's pointer sensor claims
       * the gesture unless this says otherwise — the same guard the register and
       * cancel controls in this cell already use. The sensor's 6px activation
       * distance means a click still reads as a click; this is for the drag that
       * starts because somebody's finger moved seven pixels.
       */
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => onStaffing(booking, uncovered ? 'to_define' : 'uncovered')}
      // The visible words say which state it is *in*; the accessible name has to
      // say what the button will *do*, or a screen reader hears a label that
      // contradicts the action.
      aria-label={uncovered ? t('grid.staffing.clearAlert') : t('grid.staffing.raiseAlert')}
      title={uncovered ? t('grid.staffing.clearAlert') : t('grid.staffing.raiseAlert')}
      className={cn(
        chip,
        'text-left hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
      )}
    >
      {body}
    </button>
  );
}

function DurationHandle({ scheduleId }: { scheduleId: string }): React.ReactElement {
  const t = useTranslations();
  const { attributes, listeners, setNodeRef } = useDraggable({ id: `dur:${scheduleId}` });

  return (
    <span
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      aria-hidden
      tabIndex={-1}
      title={t('grid.durationHandle')}
      // See `SpanHandle` — a second `onPointerDown` would replace dnd-kit's.
      className="absolute inset-x-2 bottom-0 h-1.5 cursor-ns-resize rounded-t bg-foreground/15 hover:bg-primary/70"
    />
  );
}

/**
 * The grip that sets how many lanes a block takes.
 *
 * Its own draggable with its own id prefix, so the drop handler can tell "this
 * block goes to Thursday" from "this block now covers lanes 2 to 4" without a
 * mode. `stopPropagation` on pointer-down is what stops the block's own
 * draggable claiming the gesture first.
 *
 * Not focusable: `Shift`+arrow on the block is the keyboard path, and a second
 * tab stop per block would put eighty-four extra stops in the grid for a gesture
 * that already has one.
 */
function SpanHandle({ scheduleId }: { scheduleId: string }): React.ReactElement {
  const t = useTranslations();
  const { attributes, listeners, setNodeRef } = useDraggable({ id: `edge:${scheduleId}` });

  return (
    <span
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      aria-hidden
      tabIndex={-1}
      title={t('grid.spanHandle')}
      /*
        No `onPointerDown` of its own, and that is the whole fix.

        `{...listeners}` from dnd-kit *is* an `onPointerDown`. Declaring another
        one after the spread replaces it, so the sensor never saw the press and
        neither grip did anything at all — for three commits.

        The `stopPropagation` that used to be here came from the ticket's Dev
        note, which assumed the handle sits inside the block's own draggable. It
        does not: `Chip` carries that draggable and is a *sibling* of these
        grips, and events bubble up rather than sideways. So there was nothing to
        stop, and stopping it cost the gesture.
      */
      /*
        The corner, so it does not fight the duration grip along the edge — and
        big enough to hit. Eight pixels was a target nobody found at compact
        density; this is twelve with a visible notch, which is still small
        against an 18px row but is at least aimable.
      */
      className="absolute bottom-0 right-0 flex size-3.5 cursor-ns-resize items-end justify-end rounded-tl border-l border-t border-foreground/30 bg-foreground/20 hover:border-primary hover:bg-primary/70"
    >
      <span className="mb-px mr-px block h-px w-1.5 bg-foreground/50" />
    </span>
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
        'flex w-full items-start gap-1 text-left text-[0.825rem] font-medium',
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
        <GripVertical aria-hidden className="mt-0.5 size-3.5 shrink-0 text-foreground-muted" />
      )}
      <span className="min-w-0 flex-1 leading-tight">
        <span className={cn('line-clamp-2 break-words', cancelled === true && 'line-through')}>
          {label}
        </span>
        {time !== undefined && (
          <span className="block font-mono text-[0.715rem] font-normal text-foreground-muted">
            {time}
          </span>
        )}
        {subtitle !== undefined && subtitle !== null && (
          <span className="block truncate text-[0.715rem] font-normal text-foreground-muted">
            {subtitle}
          </span>
        )}
      </span>
    </button>
  );
}
