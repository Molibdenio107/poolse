/**
 * Conflict rules for the lane grid — POOLSE-51, criterion 10.
 *
 * **Its own package because the alternative does not work.** The ticket's Dev
 * note says to share these "the way `lib/sheet.ts` is shared" — but `sheet.ts`
 * lives in the web app and the API cannot import it. There is no sharing
 * mechanism between the two apps except a workspace package, so this is one.
 *
 * The criterion it exists for is worth restating: *a client that thinks a drop
 * is fine and a server that refuses it is the worst version of this feature.*
 * The operator drags a block, the cell says "fine", they let go, and the screen
 * takes it back. So both halves import these functions and `rules.test.ts` runs
 * the same fixture the API's integration tests use.
 *
 * **Pure.** No database, no fetch, no clock. Everything these need is passed in,
 * which is what makes them runnable in a browser mid-drag and in a request
 * handler, and testable without either.
 *
 * ---------------------------------------------------------------------------
 * What is a block, and what is a warning
 * ---------------------------------------------------------------------------
 *
 * The distinction is the whole ticket, and it is not a matter of severity.
 *
 * A **block** is something the pool cannot physically honour: two groups in one
 * lane, one instructor in two buildings. These are refused by the database, and
 * these functions only predict what it will say so the screen can say it first.
 *
 * A **warning** is a decision somebody may legitimately be making: twelve
 * children in a lane rated ten, four concurrent groups on one instructor, a
 * class on a weekday the club has since disabled. A club doing any of those for
 * a term is not making a mistake, and a scheduler that refused them would be
 * wrong about the club rather than the club being wrong.
 */

export type Verdict = 'ok' | 'warn' | 'block';

/** Machine keys. The web app translates them; nothing here builds a sentence. */
export type ReasonCode =
  | 'laneTaken'
  | 'instructorElsewhere'
  | 'lanesNotContiguous'
  | 'dayClosed'
  | 'outsideHours'
  | 'overCapacity'
  | 'overConcurrency'
  | 'weekdayDisabled';

export interface Reason {
  code: ReasonCode;
  verdict: Verdict;
  /**
   * Whatever makes the message actionable — the lane, the booking in the way,
   * the two numbers. "Pista 3 já tem Infantis" is useful; "conflito" is not.
   */
  detail: Record<string, string | number>;
}

/** One booking, in the only terms these rules need to know about it. */
export interface RuleBooking {
  id: string;
  weekday: number;
  /** Minutes from midnight, wall-clock at the facility. */
  startMinutes: number;
  durationMinutes: number;
  laneIds: string[];
  poolId: string | null;
  instructorId: string | null;
  levelId: string | null;
  headcount: number | null;
  /** A cancelled booking holds nothing — it is not happening. */
  cancelled: boolean;
  /** For naming what is in the way. */
  name: string;
}

export interface RuleLane {
  id: string;
  poolId: string;
  name: string;
  position: number;
  defaultCapacity: number | null;
}

export interface RuleContext {
  lanes: RuleLane[];
  /** Everything already on the grid, including the booking being moved. */
  bookings: RuleBooking[];
  /** Per (lane, level) overrides of `defaultCapacity`. Keyed `laneId:levelId`. */
  laneLevelCapacity: Record<string, number>;
  /** ISO weekdays the facility is open. A day not listed is disabled. */
  openWeekdays: number[];
  /** Closed dates in the week on screen, by ISO weekday, with a reason. */
  closures: { weekday: number; reason: string }[];
  /** Null means the club has no opinion — criterion 4. */
  maxConcurrentGroupsPerInstructor: number | null;
}

/** Where a booking is being put. */
export interface Placement {
  weekday: number;
  startMinutes: number;
  durationMinutes: number;
  laneIds: string[];
}

/**
 * Half-open overlap, matching `tstzrange`'s `&&` exactly.
 *
 * Back-to-back is free with no special case: 10:00–10:45 and 10:45–11:30 do not
 * overlap. Every message the grid shows has to agree with the database, so this
 * comparison is the same one the constraint makes.
 */
export function overlaps(
  aStart: number,
  aDuration: number,
  bStart: number,
  bDuration: number,
): boolean {
  return aStart < bStart + bDuration && bStart < aStart + aDuration;
}

/**
 * Whether a set of lanes is one unbroken run within a single pool.
 *
 * A span across two tanks is never contiguous however the positions happen to
 * number — POOLSE-51 settled that a booking occupies lanes in one pool, which is
 * also what lets the lane exclusion stay a single index.
 */
export function isContiguous(laneIds: readonly string[], lanes: readonly RuleLane[]): boolean {
  if (laneIds.length < 2) return true;

  const chosen = laneIds
    .map((id) => lanes.find((lane) => lane.id === id))
    .filter((lane): lane is RuleLane => lane !== undefined);

  if (chosen.length !== laneIds.length) return false;
  if (new Set(chosen.map((lane) => lane.poolId)).size > 1) return false;

  const positions = chosen.map((lane) => lane.position).sort((a, b) => a - b);
  return positions.every((position, index) => index === 0 || position === positions[index - 1]! + 1);
}

/**
 * How many groups an instructor is running at that moment.
 *
 * **Bookings, not lanes** — the thing the ticket names as most likely to be got
 * wrong. An instructor on one booking that spans three lanes is running *one*
 * group, and badging that `×3` would tell a club its best-staffed hour is its
 * worst one.
 */
export function concurrentGroups(
  instructorId: string,
  at: { weekday: number; startMinutes: number; durationMinutes: number },
  bookings: readonly RuleBooking[],
): number {
  return bookings.filter(
    (booking) =>
      !booking.cancelled &&
      booking.instructorId === instructorId &&
      booking.weekday === at.weekday &&
      overlaps(at.startMinutes, at.durationMinutes, booking.startMinutes, booking.durationMinutes),
  ).length;
}

/** What one lane holds at one level: the override, else the lane's own default. */
export function capacityOf(
  lane: RuleLane,
  levelId: string | null,
  overrides: Record<string, number>,
): number | null {
  if (levelId !== null) {
    const override = overrides[`${lane.id}:${levelId}`];
    if (override !== undefined) return override;
  }
  return lane.defaultCapacity;
}

/**
 * Everything wrong with putting `subject` at `placement` — blocks and warnings.
 *
 * Returns every reason rather than the first, because a drop can be both over
 * capacity and on a disabled weekday, and telling somebody one thing at a time
 * makes them fix it twice.
 *
 * `subject.id` is excluded from every comparison: a booking never conflicts with
 * itself, and forgetting that makes every move look like a collision.
 */
export function evaluate(
  subject: RuleBooking,
  placement: Placement,
  context: RuleContext,
): Reason[] {
  const reasons: Reason[] = [];
  const others = context.bookings.filter(
    (booking) => booking.id !== subject.id && !booking.cancelled,
  );

  // ---- blocks ------------------------------------------------------------

  if (!isContiguous(placement.laneIds, context.lanes)) {
    reasons.push({ code: 'lanesNotContiguous', verdict: 'block', detail: {} });
  }

  for (const laneId of placement.laneIds) {
    const holder = others.find(
      (booking) =>
        booking.weekday === placement.weekday &&
        booking.laneIds.includes(laneId) &&
        overlaps(
          placement.startMinutes,
          placement.durationMinutes,
          booking.startMinutes,
          booking.durationMinutes,
        ),
    );

    if (holder !== undefined) {
      const lane = context.lanes.find((candidate) => candidate.id === laneId);
      reasons.push({
        code: 'laneTaken',
        verdict: 'block',
        detail: { lane: lane?.name ?? '?', holder: holder.name },
      });
      // One lane is enough to say. Listing all six of a blocked span would be
      // six versions of the same sentence.
      break;
    }
  }

  /*
   * The instructor, in a different pool, at an overlapping time.
   *
   * The same person across several lanes of *one* pool is deliberately absent
   * from this list: it is the club's ordinary Tuesday, and the database allows
   * it too. Whether it is worth a badge is `concurrentGroups`' business.
   */
  if (subject.instructorId !== null) {
    const targetPool = poolOf(placement.laneIds, context.lanes) ?? subject.poolId;

    const elsewhere = others.find(
      (booking) =>
        booking.instructorId === subject.instructorId &&
        booking.weekday === placement.weekday &&
        booking.poolId !== null &&
        targetPool !== null &&
        booking.poolId !== targetPool &&
        overlaps(
          placement.startMinutes,
          placement.durationMinutes,
          booking.startMinutes,
          booking.durationMinutes,
        ),
    );

    if (elsewhere !== undefined) {
      reasons.push({
        code: 'instructorElsewhere',
        verdict: 'block',
        detail: { holder: elsewhere.name },
      });
    }
  }

  const closure = context.closures.find((entry) => entry.weekday === placement.weekday);
  if (closure !== undefined) {
    reasons.push({ code: 'dayClosed', verdict: 'block', detail: { reason: closure.reason } });
  }

  // ---- warnings ----------------------------------------------------------

  /*
   * A weekday the club has since disabled.
   *
   * A *warning*, not a block, and the asymmetry is deliberate: disabling a
   * weekday keeps the classes already on it and refuses new ones. So an existing
   * booking here warns (criterion 6) while a new drop is refused at the drop by
   * POOLSE-50, which checks this before it ever asks.
   */
  if (!context.openWeekdays.includes(placement.weekday)) {
    reasons.push({ code: 'weekdayDisabled', verdict: 'warn', detail: {} });
  }

  if (subject.headcount !== null) {
    for (const laneId of placement.laneIds) {
      const lane = context.lanes.find((candidate) => candidate.id === laneId);
      if (lane === undefined) continue;

      const capacity = capacityOf(lane, subject.levelId, context.laneLevelCapacity);
      if (capacity === null) continue;

      /*
       * Capacity is per lane, and a span shares its headcount across its lanes.
       * A squad of 24 on three lanes is 8 a lane, not 24 in each — comparing the
       * whole headcount against one lane would warn about every multi-lane
       * booking a club ever makes.
       */
      const perLane = Math.ceil(subject.headcount / Math.max(1, placement.laneIds.length));
      if (perLane > capacity) {
        reasons.push({
          code: 'overCapacity',
          verdict: 'warn',
          detail: { lane: lane.name, headcount: perLane, capacity },
        });
        break;
      }
    }
  }

  const limit = context.maxConcurrentGroupsPerInstructor;
  if (limit !== null && subject.instructorId !== null) {
    // The subject counts itself, since it is about to be there.
    const concurrent =
      concurrentGroups(subject.instructorId, placement, others) + 1;

    if (concurrent > limit) {
      reasons.push({
        code: 'overConcurrency',
        verdict: 'warn',
        detail: { count: concurrent, limit },
      });
    }
  }

  return reasons;
}

/** The strongest verdict in a list. Nothing said means nothing wrong. */
export function verdictOf(reasons: readonly Reason[]): Verdict {
  if (reasons.some((reason) => reason.verdict === 'block')) return 'block';
  if (reasons.some((reason) => reason.verdict === 'warn')) return 'warn';
  return 'ok';
}

/** The pool a set of lanes belongs to, or null if they disagree or are unknown. */
export function poolOf(laneIds: readonly string[], lanes: readonly RuleLane[]): string | null {
  const pools = new Set(
    laneIds
      .map((id) => lanes.find((lane) => lane.id === id)?.poolId)
      .filter((poolId): poolId is string => poolId !== undefined),
  );
  return pools.size === 1 ? [...pools][0]! : null;
}
