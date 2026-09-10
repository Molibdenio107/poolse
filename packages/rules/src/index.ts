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

// ---------------------------------------------------------------------------
// The Portuguese NIF — F-02
// ---------------------------------------------------------------------------
//
// Here rather than in either app, for the reason everything else in this file
// is here: **the client and the server have to agree.** A form that accepts a
// number the API then refuses is the same failure the conflict rules exist to
// prevent, one field smaller.
//
// **This reverses a written decision.** `students.controller.ts` carried the
// comment "never validated as a real NIF — an operator copying a number off a
// form should not be stopped by a checksum", and `membership.tax_number` says
// the same. The argument was that a wrong-but-plausible number is a correction
// rather than a crash. QA showed the cost of that: `134167211` was accepted on
// a student *and* on their guardian in one submit, and the duplicate guard that
// is supposed to catch a NIF twice in a club is keyed on that number — so a bad
// one silently defeats it. A checksum is the cheapest way to keep the key
// meaningful, and it rejects only numbers that cannot exist.
//
// An **empty** NIF stays allowed everywhere it is allowed today. Most students
// have none recorded, and requiring one would be a different decision entirely.

/**
 * Whether a string is a possible Portuguese NIF.
 *
 * Nine digits, and the ninth is a mod-11 check digit over the first eight
 * weighted 9…2. A remainder of 0 or 1 means the check digit is 0, which is the
 * rule people get wrong when they implement this from memory.
 *
 * Deliberately *not* a check on the leading digit. The valid prefixes have been
 * extended more than once by the AT — 1, 2, 3 for individuals, 5 for companies,
 * 45 for non-residents, 70/74/75/77/79, 90/91/98/99 — and a list of them in
 * this file would be a list that ages badly and starts refusing real numbers.
 * The checksum is the part that is stable.
 *
 * Whitespace is tolerated because operators paste from spreadsheets; anything
 * else that is not a digit is a no.
 */
export function isValidNif(nif: string): boolean {
  const digits = nif.replace(/\s/g, '');
  if (!/^\d{9}$/.test(digits)) return false;

  let sum = 0;
  for (let index = 0; index < 8; index += 1) {
    sum += Number(digits[index]) * (9 - index);
  }

  const remainder = sum % 11;
  const check = remainder < 2 ? 0 : 11 - remainder;
  return check === Number(digits[8]);
}

// ---------------------------------------------------------------------------
// Water quality — slice 4.2
// ---------------------------------------------------------------------------
//
// The metrics, their units and the bands a reading is judged against. Its own
// file rather than more of this one: the conflict rules above are about where a
// booking may go, and a reader looking for what a safe pH is should not have to
// scroll past lane arithmetic to find it. Re-exported here so `@poolse/rules`
// stays one entry point.
export * from './water.js';
