import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { currentTenant } from '../tenant/tenant.context.js';

export type Stroke = 'freestyle' | 'backstroke' | 'breaststroke' | 'butterfly' | 'medley';
export const STROKES: Stroke[] = [
  'freestyle',
  'backstroke',
  'breaststroke',
  'butterfly',
  'medley',
];

/**
 * The pool a time was swum in — POOLSE-81. `scm` is 25 m, `lcm` 50 m. Times
 * from the two are never converted, so every best is per course; null is
 * "piscina não indicada" and is never counted as either.
 */
export type Course = 'scm' | 'lcm';
export const COURSES: Course[] = ['scm', 'lcm'];

export interface SwimRecord {
  id: string;
  stroke: Stroke;
  distanceM: number;
  course: Course | null;
  /** Integer milliseconds. Formatted for display on the web side, never here. */
  timeMs: number;
  swumOn: string;
  note: string | null;
  recordedByName: string | null;
  /** The meet it was swum at, if any — POOLSE-81. */
  meetId: string | null;
  meetName: string | null;
  /** Swum at an official meet: what the qualifying slice will read. */
  official: boolean;
  /** True when this is the student's best over this stroke, distance and course. */
  isPersonalBest: boolean;
}

export interface PersonalBest {
  stroke: Stroke;
  distanceM: number;
  course: Course | null;
  timeMs: number;
  swumOn: string;
  /** The best itself was swum at an official meet. */
  official: boolean;
  /**
   * The best *at an official meet*, when it is not the overall best — POOLSE-81.
   * Null when there is none, or when the overall best already is one.
   */
  officialBest: { timeMs: number; swumOn: string; meetName: string } | null;
}

/** A meet a typed time may name — every live one, newest first (a picker is whole). */
export interface MeetChoice {
  id: string;
  name: string;
  startsOn: string;
  official: boolean;
}

export interface Progression {
  records: SwimRecord[];
  bests: PersonalBest[];
  /**
   * The stroke this student swims fastest, over the distance they have raced
   * most often. Read the note on `fastestStroke` below before using it for
   * anything: it is a raw fact, not a coaching judgement.
   */
  fastestStroke: Stroke | null;
  favouriteStroke: Stroke | null;
  /**
   * The course the time form starts on — POOLSE-81: the length of the pool the
   * student's turma swims in, when it is 25 or 50 m. Null leaves it unsaid.
   */
  defaultCourse: Course | null;
  meets: MeetChoice[];
}

/**
 * Everything one student has swum, plus their bests.
 *
 * One round trip for both, because every screen that shows one shows the other,
 * and the "is this a personal best" flag on each record needs the bests anyway.
 */
export async function progressionFor(
  organizationId: string,
  studentId: string,
): Promise<Progression | null> {
  return withOrg(organizationId, async (tx) => {
    const student = await tx.query<{ favourite_stroke: Stroke | null }>(
      'SELECT favourite_stroke FROM student WHERE id = $1 AND archived_at IS NULL',
      [studentId],
    );
    // No such student in this tenant. RLS makes "not ours" and "not there" the
    // same answer, which is the right amount to reveal.
    if (!student.rows[0]) return null;

    const { rows } = await tx.query<{
      id: string;
      stroke: Stroke;
      distance_m: number;
      course: Course | null;
      time_ms: number;
      swum_on: Date;
      note: string | null;
      recorded_by_name: string | null;
      meet_id: string | null;
      meet_name: string | null;
      official: boolean;
      is_personal_best: boolean;
    }>(
      `
      SELECT r.id,
             r.stroke,
             r.distance_m,
             r.course,
             r.time_ms,
             r.swum_on,
             r.note,
             display_name(u.cached_first_name, u.cached_last_name) AS recorded_by_name,
             r.meet_id,
             sm.name AS meet_name,
             coalesce(sm.official, false) AS official,
             -- The best over this stroke, distance and course, decided in the
             -- same pass. A 25 m and a 50 m time are two different bests, and a
             -- time with no course is its own group, never folded into either.
             -- row_number rather than a min() comparison so that two identical
             -- times do not both light up — the tie goes to the earlier swim.
             row_number() OVER (
               PARTITION BY r.stroke, r.distance_m, r.course
               ORDER BY r.time_ms ASC, r.swum_on ASC, r.recorded_at ASC
             ) = 1 AS is_personal_best
        FROM student_record r
        -- A result whose meet was archived leaves with it (POOLSE-81 QA 14).
        LEFT JOIN swim_meet sm
               ON sm.id = r.meet_id AND sm.organization_id = r.organization_id
        LEFT JOIN membership m
               ON m.id = r.recorded_by_membership_id AND m.organization_id = r.organization_id
        LEFT JOIN app_user u ON u.id = m.app_user_id
       WHERE r.student_id = $1
         AND r.archived_at IS NULL
         AND (r.meet_id IS NULL OR sm.archived_at IS NULL)
       ORDER BY r.swum_on DESC, r.recorded_at DESC
      `,
      [studentId],
    );

    const records: SwimRecord[] = rows.map((row) => ({
      id: row.id,
      stroke: row.stroke,
      distanceM: row.distance_m,
      course: row.course,
      timeMs: row.time_ms,
      swumOn: isoDate(row.swum_on),
      note: row.note,
      recordedByName: row.recorded_by_name,
      meetId: row.meet_id,
      meetName: row.meet_name,
      official: row.official,
      isPersonalBest: row.is_personal_best,
    }));

    const personalBests = bestsOf(records);
    const defaultCourse = await courseOfTurma(tx, studentId);
    const meets = await meetChoices(tx);

    return {
      records,
      bests: personalBests,
      fastestStroke: fastestStroke(personalBests),
      favouriteStroke: student.rows[0].favourite_stroke,
      defaultCourse,
      meets,
    };
  });
}

/**
 * The bests, from the records already read with their PB flags — so the list
 * and the flags cannot disagree. Per stroke, distance and course; beside each,
 * the best at an official meet where that is a different swim.
 */
function bestsOf(records: SwimRecord[]): PersonalBest[] {
  const groups = new Map<string, SwimRecord[]>();
  for (const record of records) {
    const key = `${record.stroke}|${record.distanceM}|${record.course ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }

  const earliestFastest = (a: SwimRecord, b: SwimRecord): number =>
    a.timeMs - b.timeMs || a.swumOn.localeCompare(b.swumOn);

  const bests: PersonalBest[] = [];
  for (const group of groups.values()) {
    const best = group.find((record) => record.isPersonalBest) ?? [...group].sort(earliestFastest)[0]!;
    const official = group.filter((record) => record.official).sort(earliestFastest)[0];
    bests.push({
      stroke: best.stroke,
      distanceM: best.distanceM,
      course: best.course,
      timeMs: best.timeMs,
      swumOn: best.swumOn,
      official: best.official,
      officialBest:
        official === undefined || official.id === best.id
          ? null
          : { timeMs: official.timeMs, swumOn: official.swumOn, meetName: official.meetName ?? '' },
    });
  }

  // Stroke in the enum's order, then distance, then 25 m before 50 m before unsaid.
  const courseRank = (course: Course | null): number =>
    course === 'scm' ? 0 : course === 'lcm' ? 1 : 2;
  return bests.sort(
    (a, b) =>
      STROKES.indexOf(a.stroke) - STROKES.indexOf(b.stroke) ||
      a.distanceM - b.distanceM ||
      courseRank(a.course) - courseRank(b.course),
  );
}

/** The length of the pool the student's turma swims in, as a course — or null. */
async function courseOfTurma(tx: Tx, studentId: string): Promise<Course | null> {
  const { rows } = await tx.query<{ length_m: string | null }>(
    `SELECT p.length_m::text AS length_m
       FROM enrollment e
       JOIN class_group cg ON cg.id = e.class_group_id AND cg.organization_id = e.organization_id
       JOIN pool p ON p.id = cg.pool_id AND p.organization_id = cg.organization_id
      WHERE e.student_id = $1 AND e.status = 'active' AND cg.archived_at IS NULL
        AND p.length_m IN (25, 50)
      ORDER BY e.created_at DESC
      LIMIT 1`,
    [studentId],
  );
  const length = Number(rows[0]?.length_m ?? NaN);
  return length === 25 ? 'scm' : length === 50 ? 'lcm' : null;
}

async function meetChoices(tx: Tx): Promise<MeetChoice[]> {
  const { rows } = await tx.query<{ id: string; name: string; starts_on: Date; official: boolean }>(
    `SELECT id, name, starts_on, official FROM swim_meet
      WHERE archived_at IS NULL
      ORDER BY starts_on DESC, name`,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    startsOn: isoDate(row.starts_on),
    official: row.official,
  }));
}

/**
 * The stroke this swimmer is quickest at, over whichever distance they have the
 * most strokes recorded for.
 *
 * Called `fastestStroke` rather than "best stroke" on purpose, and the
 * difference is not pedantry. A genuine best stroke — "this swimmer is unusually
 * strong at backstroke" — is a comparison against reference times for their age
 * and sex, and Poolse holds no such reference. Without one, comparing a
 * swimmer's own butterfly to their own freestyle answers "freestyle" for very
 * nearly everybody, because freestyle is the fastest stroke for very nearly
 * everybody.
 *
 * So this returns the honest raw fact and is labelled as such in the interface.
 * Adding federation reference times later would turn it into the real thing;
 * inventing a formula now would produce a number that looks like insight and is
 * not. Since POOLSE-81 it compares within one course only — the course with the
 * most bests — because a 25 m time is not comparable with a 50 m one.
 */
function fastestStroke(bests: PersonalBest[]): Stroke | null {
  const known = bests.filter((best) => best.course !== null);
  const pool = known.length > 0 ? known : bests;
  if (pool.length === 0) return null;

  const byCourse = new Map<string, PersonalBest[]>();
  for (const best of pool) {
    const key = best.course ?? '';
    byCourse.set(key, [...(byCourse.get(key) ?? []), best]);
  }
  let course: PersonalBest[] = [];
  for (const group of byCourse.values()) {
    if (group.length > course.length) course = group;
  }

  // The distance with the most strokes recorded is the fairest comparison
  // available — comparing a 50 m butterfly to a 400 m freestyle says nothing.
  const byDistance = new Map<number, PersonalBest[]>();
  for (const best of course) {
    byDistance.set(best.distanceM, [...(byDistance.get(best.distanceM) ?? []), best]);
  }

  let chosen: PersonalBest[] = [];
  for (const group of byDistance.values()) {
    if (group.length > chosen.length) chosen = group;
  }

  return chosen.reduce((fastest, current) =>
    current.timeMs < fastest.timeMs ? current : fastest,
  ).stroke;
}

export interface NewRecord {
  stroke: Stroke;
  distanceM: number;
  course: Course | null;
  timeMs: number;
  swumOn: string;
  note: string | null;
  /**
   * The meet it was swum at — an existing one, or one named here (Rui,
   * 19-10-2026: a coach may mark a typed time official by naming a meet). Null
   * for a training time.
   */
  meet: { id: string } | { name: string; official: boolean } | null;
}

/** Raised when a typed time names a meet this club does not have. */
export class NoSuchMeetError extends Error {}

export async function addRecord(
  organizationId: string,
  studentId: string,
  input: NewRecord,
): Promise<string | null> {
  const { membershipId } = currentTenant();

  return withOrg(organizationId, async (tx) => {
    const student = await tx.query(
      'SELECT 1 FROM student WHERE id = $1 AND archived_at IS NULL',
      [studentId],
    );
    if (student.rows.length === 0) return null;

    const meetId = await meetFor(tx, organizationId, membershipId, input);

    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO student_record (
         organization_id, student_id, stroke, distance_m, course, time_ms, swum_on,
         note, recorded_by_membership_id, meet_id
       )
       VALUES ($1, $2, $3::swim_stroke, $4, $5::swim_course, $6, $7::date, $8, $9, $10)
       RETURNING id`,
      [
        organizationId,
        studentId,
        input.stroke,
        input.distanceM,
        input.course,
        input.timeMs,
        input.swumOn,
        input.note,
        membershipId,
        meetId,
      ],
    );

    const id = rows[0]?.id;
    if (!id) throw new Error('Could not create the record');

    await recordAudit(tx, {
      action: 'student_record.created',
      entityType: 'student',
      entityId: studentId,
      data: {
        stroke: input.stroke,
        distanceM: input.distanceM,
        timeMs: input.timeMs,
        course: input.course,
        ...(meetId === null ? {} : { meetId }),
      },
    });

    return id;
  });
}

/**
 * The meet a typed time names: an existing one of this club's, or one made now
 * from its name on the swim's day. A meet of that name already on that day is
 * the same meet and is reused, as a re-import would.
 */
async function meetFor(
  tx: Tx,
  organizationId: string,
  membershipId: string | undefined,
  input: NewRecord,
): Promise<string | null> {
  if (input.meet === null) return null;

  if ('id' in input.meet) {
    const { rows } = await tx.query<{ id: string }>(
      `SELECT id FROM swim_meet WHERE id = $1 AND archived_at IS NULL`,
      [input.meet.id],
    );
    if (!rows[0]) throw new NoSuchMeetError();
    return rows[0].id;
  }

  const { rows: existing } = await tx.query<{ id: string }>(
    `SELECT id FROM swim_meet
      WHERE lower(btrim(name)) = lower(btrim($1)) AND starts_on = $2::date AND archived_at IS NULL`,
    [input.meet.name, input.swumOn],
  );
  if (existing[0]) return existing[0].id;

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO swim_meet (organization_id, name, course, starts_on, ends_on, official,
                            created_by_membership_id)
     VALUES ($1, btrim($2), $3::swim_course, $4::date, $4::date, $5, $6)
     RETURNING id`,
    [organizationId, input.meet.name, input.course, input.swumOn, input.meet.official, membershipId ?? null],
  );
  await recordAudit(tx, {
    action: 'swim_meet.created',
    entityType: 'swim_meet',
    entityId: rows[0]!.id,
    data: { name: input.meet.name, startsOn: input.swumOn, official: input.meet.official },
  });
  return rows[0]!.id;
}

/**
 * Archived rather than deleted, like everything else an operator can see.
 *
 * A mistyped time that has already been shown to a parent as a personal best is
 * worth being able to look back at, and a season's history with holes in it is
 * hard to trust.
 */
export async function archiveRecord(
  organizationId: string,
  studentId: string,
  recordId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE student_record SET archived_at = now()
        WHERE id = $1 AND student_id = $2 AND archived_at IS NULL
      RETURNING id`,
      [recordId, studentId],
    );
    if (!rows[0]) return false;

    await recordAudit(tx, {
      action: 'student_record.archived',
      entityType: 'student',
      entityId: studentId,
      data: { recordId },
    });
    return true;
  });
}

export async function setFavouriteStroke(
  organizationId: string,
  studentId: string,
  stroke: Stroke | null,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE student SET favourite_stroke = $2::swim_stroke
        WHERE id = $1 AND archived_at IS NULL
      RETURNING id`,
      [studentId, stroke],
    );
    if (!rows[0]) return false;

    await recordAudit(tx, {
      action: 'student.favourite_stroke_set',
      entityType: 'student',
      entityId: studentId,
      data: { stroke },
    });
    return true;
  });
}

/** A plain calendar date, with no timezone to shift it across midnight. */
function isoDate(value: Date): string {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}
