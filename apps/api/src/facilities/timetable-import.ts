import {
  evaluate,
  overlaps,
  placeLaneCount,
  type HeldLanes,
  verdictOf,
  type Reason,
  type RuleBooking,
  type RuleContext,
  type Verdict,
} from '@poolse/rules';

/**
 * A timetable arriving as a file, judged before anything is written — POOLSE-57.
 *
 * The layer between "the sheet says Masters is on lanes 1–3 at 06:30 on Monday"
 * and a row in `class_schedule`. Pure: no database, no HTTP, no spreadsheet. The
 * web app reads the file and the layout reader turns a grid into these rows;
 * this says what each one resolves to and what it collides with.
 *
 * ---------------------------------------------------------------------------
 * The two decisions this module exists to enforce
 * ---------------------------------------------------------------------------
 *
 * **Nothing is written while a conflict is unresolved.** Not partially applied,
 * not applied with warnings. A half-imported timetable is worse than none,
 * because the operator cannot tell which half arrived — so `blocked` on the
 * summary is what the commit refuses on, and it refuses the whole file.
 *
 * **A clash is never resolved by overwriting.** Every conflict is reported with
 * both sides named — what is arriving, what is already there, and why they
 * collide — so the dialog can list them specifically and the operator can decide
 * each one. "Last row wins" is the one behaviour this must never have.
 *
 * ---------------------------------------------------------------------------
 * The thing most likely to be got wrong
 * ---------------------------------------------------------------------------
 *
 * **Rows collide with each other, not only with the grid.** Two lines of one
 * file both wanting lane 2 at 19:15 is the commonest clash there is, and
 * evaluating each row against the database alone would miss every one of them.
 * So the context grows as the file is read: each row is judged against the
 * existing bookings *plus every earlier row of the same file*.
 *
 * The conflicts themselves come from `packages/rules` rather than from a second
 * implementation here — the same `evaluate` the grid runs when a block is
 * dragged. A preview that disagreed with the grid about what collides would be
 * worse than no preview.
 */

/** One candidate booking, as the reader hands it over: names, never ids. */
export interface RawTimetableRow {
  /** ISO weekday, Monday 1 … Sunday 7. */
  weekday: number;
  /** `HH:MM`, wall-clock at the facility. */
  startTime: string;
  durationMinutes: number;
  /** The cell's text — a turma's name, a partner group's, or an event's title. */
  name: string;
  /** Lane names as the sheet wrote them: `Pista 2`, `2`, `1-3`. Already split. */
  laneNames: string[];
  instructorName?: string | null;
  headcount?: number | null;
  /** Which line of the sheet this came from, for the preview to point at. */
  line: number;
  /**
   * The Poolse pool this row was mapped to (POOLSE-223). Absent: the request's
   * pool. Lane names and counts resolve inside this pool only.
   */
  poolId?: string | null;
  /** What the row becomes (POOLSE-223): an evento (default) or a free-swim lane hold. */
  kind?: TimetableKind;
  /** The lane count the reader found ("3 pistas"); placed on the pool's free lanes. */
  laneCount?: number | null;
}

/** `turma`: rows by name and start time become turmas (POOLSE-224, reversing POOLSE-57). */
export type TimetableKind = 'evento' | 'free_swim' | 'turma';

export type TimetableProblemCode =
  /** A free-swim block holds lanes, as one made by hand must (POOLSE-68). */
  | 'freeSwimNeedsLane'
  /** A turma of that name exists in another season or pool: never merged, never renamed silently (POOLSE-224). */
  | 'turmaNameTaken'
  | 'nameRequired'
  | 'badTime'
  | 'badDuration'
  | 'noLanes'
  | 'laneNotFound'
  | 'unknownSubject';

/**
 * `noLanes`: imported into *Sem pista* (Rui, 11-11-2026), no longer refused.
 * `lanesPlaced`: "3 pistas" placed on named lanes. `lanesShort`: fewer free lanes than asked.
 */
export type TimetableWarningCode =
  | 'instructorNotFound'
  | 'headcountMissing'
  | 'noLanes'
  | 'lanesPlaced'
  | 'lanesShort'
  /** "6 pistas, a piscina tem 4": took every lane (POOLSE-223 rule 5). Value `asked/has`. */
  | 'lanesOverPool';

export interface TimetableProblem {
  code: TimetableProblemCode;
  /** What was in the cell, so the message can quote it back. */
  value?: string;
}

export interface TimetableWarning {
  code: TimetableWarningCode;
  value?: string;
}

/**
 * A collision, with **both sides named**.
 *
 * `with` is what is already there — an existing booking's name, or an earlier
 * line of this same file. Without it the dialog can only say "this conflicts",
 * which sends the operator hunting across a six-lane grid to find out with what.
 */
export interface TimetableClash {
  code: Reason['code'];
  verdict: Verdict;
  /** The booking already holding the slot. Null for reasons with no other party. */
  with: string | null;
  /** Set when the other party is an earlier row of this file rather than the grid. */
  withLine: number | null;
  /** The lane, where the reason is about one. */
  lane: string | null;
  /**
   * The reason's own figures from `packages/rules` — the lane, the holder, the
   * headcount and the capacity — so the sentence quotes what was counted rather
   * than a placeholder. Names and numbers only; never an id.
   */
  detail: Record<string, string | number>;
}

export interface TimetableRow {
  index: number;
  line: number;

  /** The pool the row resolves in; null when neither the row nor the request named one. */
  poolId: string | null;
  kind: TimetableKind;
  /** The planned turma it is a slot of (POOLSE-224); null for any other kind. */
  turmaKey: string | null;
  name: string;
  weekday: number;
  startMinutes: number;
  durationMinutes: number;
  /** Resolved against the site's own lanes. Empty when a name matched nothing. */
  laneIds: string[];
  laneNames: string[];
  instructorId: string | null;
  instructorName: string | null;
  headcount: number | null;

  problems: TimetableProblem[];
  warnings: TimetableWarning[];
  /** Everything it collides with — the grid's bookings and this file's earlier rows. */
  clashes: TimetableClash[];

  /** Nothing wrong with the row itself. A clash does not clear this. */
  readable: boolean;
  /**
   * Whether a commit could write this row as it stands.
   *
   * False while it carries a problem *or* a blocking clash — the operator has to
   * decide the clash first. A warning never clears it.
   */
  importable: boolean;
}

export interface TimetableSummary {
  total: number;
  importable: number;
  /** Rows the reader could not make sense of at all. */
  refused: number;
  /** Rows held up by a clash somebody has to decide. */
  blocked: number;
  flagged: number;
}

export interface TimetablePreview {
  rows: TimetableRow[];
  summary: TimetableSummary;
  /**
   * Whether a commit may proceed — decision 1, in one boolean.
   *
   * The commit path reads this and nothing else, so "refuse the whole file until
   * clean" cannot be partially implemented by a caller that forgot a case.
   */
  committable: boolean;
  /** Days whose hours keep rows out, and what would let them in (11-11-2026: *Alargar horário*). */
  hoursNeeded: TimetableHoursNeeded[];
  /** The turmas the `turma` rows become, new or existing (POOLSE-224). */
  turmas: PlannedTurma[];
}

/** What the site holds, for names to resolve against. */
export interface TimetableContext {
  /** The site's lanes, with the pool and position `packages/rules` needs. */
  lanes: { id: string; name: string; poolId: string; position: number; defaultCapacity: number | null }[];
  instructors: { id: string; name: string }[];
  /**
   * Everything already on the grid for this season.
   *
   * `RuleBooking` already carries a `name` — the package added it "for naming
   * what is in the way", which is precisely what the conflict dialog needs, so
   * there is nothing to wrap.
   */
  existing: RuleBooking[];
  openWeekdays: number[];
  closures: { weekday: number; reason: string }[];
  laneLevelCapacity: Record<string, number>;
  maxConcurrentGroupsPerInstructor: number | null;
  /**
   * Each day's hours at the site (11-11-2026), for the preview to check a row's
   * times as the database will at commit. HH:MM; `24:00` is the end of the day.
   */
  hours?: { weekday: number; available: boolean; opens: string; closes: string }[];
  /** The club's live turmas, for an import not to duplicate one (POOLSE-224). */
  turmas?: ExistingTurma[];
  /** The site's pools by name, for telling apart one name in two pools. */
  pools?: { id: string; name: string }[];
}

/** What the file needs of the site's hours, where it asks for more than the site keeps (11-11-2026). */
export interface TimetableHoursNeeded {
  weekday: number;
  /** The day as the site keeps it now; null when it has no row. */
  current: { available: boolean; opens: string; closes: string } | null;
  /** The day as the file needs it: open, from the earlier start to the later end. */
  needed: { opens: string; closes: string };
  /** How many rows that day it would let in. */
  rows: number;
}

const MAX_NAME = 120;

/** "Hidroginástica (3 pistas)" — a lane count, not lane names (11-11-2026). */
const LANE_COUNT = /\(?\s*(\d{1,2})\s*pistas?\s*\)?/i;
/** "Pista 2", "pista 1-3": a lane named, which is not a count. */
const LANE_NAMED = /pista\s*\d/i;

/** A name with its lane count taken out, and the count; null when it states none. */
export function readLaneCount(
  name: string,
  laneNames: readonly string[],
): { name: string; count: number | null; laneNames: string[] } {
  const isCount = (text: string): boolean => LANE_COUNT.test(text) && !LANE_NAMED.test(text);
  const named = laneNames.filter((lane) => !isCount(lane));
  const fromLanes = laneNames.find(isCount);
  const inName = isCount(name) ? LANE_COUNT.exec(name) : null;
  const raw = inName?.[1] ?? (fromLanes === undefined ? undefined : LANE_COUNT.exec(fromLanes)?.[1]);
  const count = raw === undefined ? null : Number(raw);
  return {
    name: inName === null ? name : name.replace(inName[0], '').replace(/\s{2,}/g, ' ').trim(),
    count: count !== null && count > 0 ? count : null,
    laneNames: named,
  };
}

function clockOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * The largest timetable one import may carry.
 *
 * Fourteen slots by seven days by six lanes is 588 cells at the theoretical
 * limit, and no club fills one. Two thousand is the inventory's number and is
 * comfortably past anything real, which is the point of a cap — it stops a
 * runaway file, not a big club.
 */
export const MAX_TIMETABLE_ROWS = 2_000;

/**
 * Reasons the **database** refuses, whatever verdict the grid gives them.
 *
 * `packages/rules` marks `weekdayDisabled` a *warning*, and that is right for
 * the grid: a person is watching one drag, and a soft edge lets them place a
 * block on a day they are about to open. An import cannot afford it. The
 * facility-hours trigger raises `facility_closed_on_weekday` and
 * `outside_facility_hours` as check violations, so a preview that called such a
 * row committable would promise a commit the transaction then refuses — the
 * half-imported timetable decision 1 exists to prevent, arrived at from the
 * other side.
 *
 * So the import escalates them. The two contexts genuinely differ: the grid can
 * warn because a human is the next step, and an import cannot because the
 * database is.
 */
const REFUSED_BY_DATABASE: ReadonlySet<Reason['code']> = new Set([
  'weekdayDisabled',
  'outsideHours',
]);

/** Whether a clash stops this row being written, for an import specifically. */
function blocksImport(clash: { code: Reason['code']; verdict: Verdict }): boolean {
  return clash.verdict === 'block' || REFUSED_BY_DATABASE.has(clash.code);
}

/** Accents and case only — the same fold every name match in this app uses. */
export function normaliseName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/** `HH:MM` to minutes from midnight, or null when it is not a time. */
export function readClock(raw: string): number | null {
  const match = /^\s*(\d{1,2})\s*[:hH.]\s*(\d{2})\s*$/.exec(raw);
  if (match === null) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59) return null;
  // 24:00 is a real end time in this schema and a nonsensical start; the caller
  // only ever passes a start, so the upper bound is exclusive of midnight.
  if (hours === 24 && minutes > 0) return null;

  return hours * 60 + minutes;
}

/**
 * A lane cell as a club writes it: `1-3`, `1,2,3`, `Pista 2`, `Pista 1 a 3`.
 *
 * Ranges are expanded here rather than by the reader, because expanding `1-3`
 * needs to know which lanes the pool actually has — `Pista 1` to `Pista 3` is
 * three lanes at one site and might be nothing at all at another.
 */
export function expandLanes(
  written: readonly string[],
  lanes: TimetableContext['lanes'],
): { ids: string[]; names: string[]; missing: string[] } {
  const byName = new Map(lanes.map((lane) => [normaliseName(lane.name), lane]));
  const byPosition = new Map(lanes.map((lane) => [lane.position, lane]));

  const ids: string[] = [];
  const names: string[] = [];
  const missing: string[] = [];

  const take = (lane: TimetableContext['lanes'][number] | undefined, wrote: string): void => {
    if (lane === undefined) {
      missing.push(wrote);
      return;
    }
    if (ids.includes(lane.id)) return;
    ids.push(lane.id);
    names.push(lane.name);
  };

  for (const raw of written) {
    const wrote = raw.trim();
    if (wrote === '') continue;

    // A range: "1-3", "1 a 3", "Pista 1 - Pista 3".
    const range = /^(?:pista\s*)?(\d+)\s*(?:-|–|a|to|\.\.)\s*(?:pista\s*)?(\d+)$/i.exec(
      normaliseName(wrote),
    );
    if (range !== null) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from <= to && to - from < 24) {
        for (let position = from; position <= to; position += 1) {
          take(byPosition.get(position), `${position}`);
        }
        continue;
      }
    }

    // A bare number is a position; anything else is a name.
    const bare = /^(?:pista\s*)?(\d+)$/i.exec(normaliseName(wrote));
    take(
      bare !== null ? byPosition.get(Number(bare[1])) : byName.get(normaliseName(wrote)),
      wrote,
    );
  }

  return { ids, names, missing };
}

/**
 * The whole preview, from rows the reader has already extracted.
 *
 * Called once for the preview and again by the commit, with the same inputs, so
 * what an operator approved is what gets written — the arrangement all four
 * importers in this codebase share.
 */
export function previewTimetable(
  raw: readonly RawTimetableRow[],
  context: TimetableContext,
  /** The pool for rows that name none (the dialog's step zero); null reads the site's lanes. */
  defaultPoolId: string | null = null,
): TimetablePreview {
  const instructors = new Map(
    context.instructors.map((person) => [normaliseName(person.name), person]),
  );

  /*
   * The growing context — the thing this module exists to get right.
   *
   * Seeded with what is already on the grid, and each readable row is added as
   * it is judged, so row 12 collides with row 4 of the same file exactly as it
   * would with a booking made last September.
   */
  const judged: (RuleBooking & { line: number | null })[] = context.existing.map((booking) => ({
    ...booking,
    // Null means "already on the grid" rather than "an earlier row of this
    // file" — a different sentence for the operator, so it is carried rather
    // than inferred.
    line: null,
  }));

  /*
   * Lanes held, for placing "3 pistas" (`placeLaneCount` in @poolse/rules): what
   * is on the grid and what earlier rows of this file took, so two activities
   * sharing an hour take side-by-side lanes rather than the same ones.
   */
  const held: HeldLanes[] = context.existing.map((booking) => ({
    weekday: booking.weekday,
    from: booking.startMinutes,
    to: booking.startMinutes + booking.durationMinutes,
    laneIds: [...booking.laneIds],
  }));
  const hoursOf = new Map((context.hours ?? []).map((day) => [day.weekday, day]));

  const rows = raw.map((row, index) => {
    const problems: TimetableProblem[] = [];
    const warnings: TimetableWarning[] = [];
    const kind: TimetableKind = row.kind === 'free_swim' || row.kind === 'turma' ? row.kind : 'evento';

    /*
     * The row's own pool, never the site's (the POOLSE-57 trap of 02-11-2026):
     * lane names and counts resolve inside it. No pool anywhere reads the site.
     */
    const poolId = row.poolId ?? defaultPoolId;
    const poolLanes = poolId === null ? context.lanes : context.lanes.filter((lane) => lane.poolId === poolId);

    const counted = readLaneCount(row.name.trim(), row.laneNames);
    const laneCount = row.laneCount ?? counted.count;
    const name = counted.name;
    if (name === '') problems.push({ code: 'nameRequired' });
    else if (name.length > MAX_NAME) problems.push({ code: 'nameRequired', value: name });

    const startMinutes = readClock(row.startTime);
    if (startMinutes === null) problems.push({ code: 'badTime', value: row.startTime });

    const durationMinutes = Math.floor(row.durationMinutes);
    if (!Number.isFinite(durationMinutes) || durationMinutes < 5 || durationMinutes > 480) {
      problems.push({ code: 'badDuration', value: String(row.durationMinutes) });
    }

    /*
     * Lanes: an unmatched name refuses the row — criterion 6.
     *
     * Deliberately harsher than the instructor below. A booking with no lane is
     * legal in this schema and invisible on the grid, so importing one because
     * "Pista 7" matched nothing would put a class somewhere nobody can see it.
     */
    /*
     * A lane count is placed on free lanes of that hour, and a row with no lane
     * at all goes to *Sem pista* (Rui, 11-11-2026): the calendar draws that
     * column, so the class is seen and dragged onto lanes later. A lane name
     * that matches nothing still refuses the row, because it names a lane that
     * is not there.
     */
    let written = counted.laneNames;
    if (written.length === 0 && laneCount !== null && startMinutes !== null) {
      const placed = placeLaneCount(
        laneCount,
        { weekday: row.weekday, from: startMinutes, to: startMinutes + durationMinutes },
        poolLanes,
        held,
      );
      written = placed.lanes.map((lane) => lane.name);
      if (placed.outcome === 'placed') warnings.push({ code: 'lanesPlaced', value: written.join(', ') });
      else if (placed.outcome === 'short') warnings.push({ code: 'lanesShort', value: `${laneCount}` });
      else warnings.push({ code: 'lanesOverPool', value: `${laneCount}/${poolLanes.length}` });
    }
    const lanes = expandLanes(written, poolLanes);
    for (const wrote of lanes.missing) {
      problems.push({ code: 'laneNotFound', value: wrote });
    }
    if (lanes.ids.length === 0 && lanes.missing.length === 0) {
      // A free-swim block holds lanes or it is nothing (POOLSE-68); a class goes to *Sem pista*.
      if (kind === 'free_swim') problems.push({ code: 'freeSwimNeedsLane' });
      else warnings.push({ code: 'noLanes' });
    }

    /*
     * The instructor: a name Poolse does not know is a warning — criterion 6.
     *
     * The opposite call from lanes, and for a reason: the club's timetable is
     * still true without it. Losing "Sandra" costs a name that can be set from
     * the grid in one click; losing the class costs the class.
     */
    // Nobody teaches a free-swim block, and it counts nobody (POOLSE-68).
    const wrote = kind === 'free_swim' ? '' : (row.instructorName ?? '').trim();
    const found = wrote === '' ? undefined : instructors.get(normaliseName(wrote));
    if (wrote !== '' && found === undefined) {
      warnings.push({ code: 'instructorNotFound', value: wrote });
    }

    const headcount = kind === 'free_swim' ? null : (row.headcount ?? null);
    // A turma counts its enrolments; only an evento states a headcount.
    if (headcount === null && kind === 'evento') warnings.push({ code: 'headcountMissing' });

    const readable = problems.length === 0;

    /*
     * The clashes, from `packages/rules` — the same evaluation the grid runs
     * when a block is dragged, so the preview and the grid can never disagree.
     */
    const clashes: TimetableClash[] = [];

    if (readable && startMinutes !== null) {
      const subject: RuleBooking = {
        id: `import:${index}`,
        name,
        weekday: row.weekday,
        startMinutes,
        durationMinutes,
        laneIds: lanes.ids,
        poolId: context.lanes.find((lane) => lane.id === lanes.ids[0])?.poolId ?? poolId,
        instructorId: found?.id ?? null,
        levelId: null,
        headcount,
        cancelled: false,
      };

      const ruleContext: RuleContext = {
        lanes: context.lanes,
        bookings: judged,
        laneLevelCapacity: context.laneLevelCapacity,
        openWeekdays: context.openWeekdays,
        closures: context.closures,
        maxConcurrentGroupsPerInstructor: context.maxConcurrentGroupsPerInstructor,
      };

      for (const reason of evaluate(subject, subject, ruleContext)) {
        clashes.push({
          code: reason.code,
          verdict: reason.verdict,
          detail: reason.detail,
          ...namesOfOther(reason, subject, judged, context),
        });
      }

      /*
       * The site's hours, checked here because the grid rules do not and the
       * database trigger will (11-11-2026): a preview that said "clean" then
       * failed at the commit, with nothing imported. A closed day is the rules'
       * `weekdayDisabled`, already escalated above.
       */
      const day = hoursOf.get(row.weekday);
      if (day !== undefined && day.available) {
        const opens = readClock(day.opens) ?? 0;
        const closes = readClock(day.closes) ?? 24 * 60;
        if (startMinutes < opens || startMinutes + durationMinutes > closes) {
          clashes.push({
            code: 'outsideHours',
            verdict: 'block',
            detail: { opens: day.opens, closes: day.closes },
            with: null,
            withLine: null,
            lane: null,
          });
        }
      }

      judged.push({ ...subject, line: row.line });
      held.push({ weekday: row.weekday, from: startMinutes, to: startMinutes + durationMinutes, laneIds: lanes.ids });
    }

    const blocked = clashes.some(blocksImport);

    return {
      index,
      line: row.line,
      poolId,
      kind,
      turmaKey: null as string | null,
      name,
      weekday: row.weekday,
      startMinutes: startMinutes ?? 0,
      durationMinutes,
      laneIds: lanes.ids,
      laneNames: lanes.names,
      instructorId: found?.id ?? null,
      instructorName: found?.name ?? (wrote === '' ? null : wrote),
      headcount,
      problems,
      warnings,
      clashes,
      readable,
      importable: readable && !blocked,
    } satisfies TimetableRow;
  });

  /*
   * Turmas by name and start time (POOLSE-224, decided 2), after every row is
   * judged: a name another season or pool already uses refuses its rows here.
   */
  const turmas = groupIntoTurmas(rows, context.turmas ?? [], context.pools ?? []);
  for (const turma of turmas) {
    for (const index of turma.slots) {
      const row = rows[index]!;
      row.turmaKey = turma.key;
      if (turma.taken) {
        row.problems.push({ code: 'turmaNameTaken', value: turma.name });
        row.readable = false;
        row.importable = false;
      }
    }
  }

  const summary: TimetableSummary = {
    total: rows.length,
    importable: rows.filter((row) => row.importable).length,
    refused: rows.filter((row) => !row.readable).length,
    blocked: rows.filter((row) => row.readable && !row.importable).length,
    flagged: rows.filter((row) => row.warnings.length > 0).length,
  };

  /*
   * What the site's hours would need to be for the rows they keep out (Rui,
   * 11-11-2026: one click, *Alargar horário*). Per day, from the earlier of its
   * opening and the file's first start to the later of its closing and the file's
   * last end. Only days with such a row.
   */
  const needed = new Map<number, { from: number; to: number; rows: number }>();
  for (const row of rows) {
    if (!row.clashes.some((clash) => clash.code === 'outsideHours' || clash.code === 'weekdayDisabled')) continue;
    const end = row.startMinutes + row.durationMinutes;
    const was = needed.get(row.weekday);
    needed.set(row.weekday, {
      from: Math.min(was?.from ?? row.startMinutes, row.startMinutes),
      to: Math.max(was?.to ?? end, end),
      rows: (was?.rows ?? 0) + 1,
    });
  }
  const hoursNeeded: TimetableHoursNeeded[] = [...needed.entries()]
    .sort(([a], [b]) => a - b)
    .map(([weekday, span]) => {
      const current = hoursOf.get(weekday) ?? null;
      const opensNow = current !== null && current.available ? (readClock(current.opens) ?? span.from) : span.from;
      const closesNow = current !== null && current.available ? (readClock(current.closes) ?? span.to) : span.to;
      return {
        weekday,
        current: current === null ? null : { available: current.available, opens: current.opens, closes: current.closes },
        needed: { opens: clockOf(Math.min(opensNow, span.from)), closes: clockOf(Math.max(closesNow, span.to)) },
        rows: span.rows,
      };
    });

  return {
    rows,
    summary,
    hoursNeeded,
    turmas,
    /*
     * Decision 1, in one boolean. The commit reads this and nothing else, so
     * "refuse the whole file until clean" cannot be half-implemented by a caller
     * that forgot a case. An empty file is not committable either — there is
     * nothing to write and saying so beats a silent success.
     */
    committable: rows.length > 0 && summary.refused === 0 && summary.blocked === 0,
  };
}

/** A live turma of the club, as the import sees it (POOLSE-224). */
export interface ExistingTurma {
  id: string;
  name: string;
  poolId: string | null;
  /** In the published season — the only season an import writes into. */
  published: boolean;
}

/** What a set of `turma` rows becomes: one turma per pool, name and start time. */
export interface PlannedTurma {
  /** Stable within one preview: pool, folded name and start. */
  key: string;
  name: string;
  poolId: string | null;
  /** Set when the slots go into a turma that already exists (rule 7). */
  existingId: string | null;
  /** True when the name belongs to a turma the import may not add to. */
  taken: boolean;
  /** The rows (preview indexes) that are its weekly slots. */
  slots: number[];
  /** The one teacher every slot names, else null. */
  instructorId: string | null;
}

/**
 * Turma rows grouped by name and start time — POOLSE-224, decided 2.
 *
 * - Same pool, same name, same start, any days: one turma, a slot per day.
 * - A name at more than one start in a pool is named *Nome · HH:MM*.
 * - The same final name in two pools gets the pool's name too, so two pools are
 *   never merged into one turma (the ticket's trap) and the club-wide unique
 *   name never collides inside one import.
 * - A live turma of that name, in the published season and the same pool (or
 *   none), takes the slots (rule 7). Any other turma of that name refuses the
 *   rows: merging it or renaming around it silently would both be guesses.
 *
 * Pure, and the same function for the preview and the commit, so a confirmed
 * import is grouped exactly as it was shown.
 */
export function groupIntoTurmas(
  rows: readonly Pick<TimetableRow, 'index' | 'kind' | 'name' | 'poolId' | 'startMinutes' | 'instructorId'>[],
  existing: readonly ExistingTurma[],
  pools: readonly { id: string; name: string }[],
): PlannedTurma[] {
  const turmaRows = rows.filter((row) => row.kind === 'turma' && row.name.trim() !== '');

  const startsOf = new Map<string, Set<number>>();
  for (const row of turmaRows) {
    const key = `${row.poolId ?? '-'}|${normaliseName(row.name)}`;
    startsOf.set(key, (startsOf.get(key) ?? new Set()).add(row.startMinutes));
  }

  const groups = new Map<string, PlannedTurma>();
  for (const row of turmaRows) {
    const key = `${row.poolId ?? '-'}|${normaliseName(row.name)}|${row.startMinutes}`;
    const group = groups.get(key);
    if (group !== undefined) {
      group.slots.push(row.index);
      if (group.instructorId !== row.instructorId) group.instructorId = null;
      continue;
    }
    const manyStarts = (startsOf.get(`${row.poolId ?? '-'}|${normaliseName(row.name)}`)?.size ?? 0) > 1;
    groups.set(key, {
      key,
      name: manyStarts ? `${row.name.trim()} · ${clockOf(row.startMinutes)}` : row.name.trim(),
      poolId: row.poolId,
      existingId: null,
      taken: false,
      slots: [row.index],
      instructorId: row.instructorId,
    });
  }

  const planned = [...groups.values()];
  const poolsOfName = new Map<string, Set<string>>();
  for (const turma of planned) {
    const name = normaliseName(turma.name);
    poolsOfName.set(name, (poolsOfName.get(name) ?? new Set()).add(turma.poolId ?? '-'));
  }
  for (const turma of planned) {
    if ((poolsOfName.get(normaliseName(turma.name))?.size ?? 0) > 1) {
      const pool = pools.find((one) => one.id === turma.poolId)?.name;
      if (pool !== undefined) turma.name = `${turma.name} · ${pool}`;
    }
    const same = existing.find((one) => normaliseName(one.name) === normaliseName(turma.name));
    if (same === undefined) continue;
    if (same.published && (same.poolId === null || same.poolId === turma.poolId)) turma.existingId = same.id;
    else turma.taken = true;
  }
  return planned;
}

/**
 * Who the other party is — decision 2's "listing which conflict happens".
 *
 * A reason from `packages/rules` says *what* is wrong; the dialog has to say
 * *with what*. This finds the booking actually holding the slot, and reports
 * whether it is on the grid already or is an earlier line of the same file —
 * which is a different sentence for the operator: one they can change here, and
 * one they have to decide about.
 */
function namesOfOther(
  reason: Reason,
  subject: RuleBooking,
  judged: readonly (RuleBooking & { line: number | null })[],
  context: TimetableContext,
): { with: string | null; withLine: number | null; lane: string | null } {
  const others = judged.filter(
    (booking) => booking.id !== subject.id && !booking.cancelled,
  );

  if (reason.code === 'laneTaken') {
    const holder = others.find(
      (booking) =>
        booking.weekday === subject.weekday &&
        booking.laneIds.some((id) => subject.laneIds.includes(id)) &&
        overlaps(
          subject.startMinutes,
          subject.durationMinutes,
          booking.startMinutes,
          booking.durationMinutes,
        ),
    );
    const laneId = holder?.laneIds.find((id) => subject.laneIds.includes(id));
    return {
      with: holder?.name ?? null,
      withLine: holder?.line ?? null,
      lane: context.lanes.find((lane) => lane.id === laneId)?.name ?? null,
    };
  }

  if (reason.code === 'instructorElsewhere') {
    const holder = others.find(
      (booking) =>
        booking.instructorId !== null &&
        booking.instructorId === subject.instructorId &&
        booking.weekday === subject.weekday &&
        booking.poolId !== subject.poolId &&
        overlaps(
          subject.startMinutes,
          subject.durationMinutes,
          booking.startMinutes,
          booking.durationMinutes,
        ),
    );
    return { with: holder?.name ?? null, withLine: holder?.line ?? null, lane: null };
  }

  // Everything else — a closed day, hours, capacity — has no second party.
  return { with: null, withLine: null, lane: null };
}

/** Whether a preview may be committed. Exported so the API reads one rule. */
export function canCommit(preview: TimetablePreview): boolean {
  return preview.committable;
}

export { verdictOf };
