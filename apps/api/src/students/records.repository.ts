import { withOrg } from '@poolse/db';
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

export interface SwimRecord {
  id: string;
  stroke: Stroke;
  distanceM: number;
  /** Integer milliseconds. Formatted for display on the web side, never here. */
  timeMs: number;
  swumOn: string;
  note: string | null;
  recordedByName: string | null;
  /** True when this is the student's best over this stroke and distance. */
  isPersonalBest: boolean;
}

export interface PersonalBest {
  stroke: Stroke;
  distanceM: number;
  timeMs: number;
  swumOn: string;
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
      time_ms: number;
      swum_on: Date;
      note: string | null;
      recorded_by_name: string | null;
      is_personal_best: boolean;
    }>(
      `
      SELECT r.id,
             r.stroke,
             r.distance_m,
             r.time_ms,
             r.swum_on,
             r.note,
             display_name(u.cached_first_name, u.cached_last_name) AS recorded_by_name,
             -- The best over this stroke and distance, decided in the same pass
             -- rather than by comparing in JavaScript afterwards. row_number
             -- rather than a min() comparison so that two identical times do not
             -- both light up as the record — the tie goes to the earlier swim,
             -- because you set the record the first time you swam it.
             row_number() OVER (
               PARTITION BY r.stroke, r.distance_m
               ORDER BY r.time_ms ASC, r.swum_on ASC, r.recorded_at ASC
             ) = 1 AS is_personal_best
        FROM student_record r
        LEFT JOIN membership m
               ON m.id = r.recorded_by_membership_id AND m.organization_id = r.organization_id
        LEFT JOIN app_user u ON u.id = m.app_user_id
       WHERE r.student_id = $1
         AND r.archived_at IS NULL
       ORDER BY r.swum_on DESC, r.recorded_at DESC
      `,
      [studentId],
    );

    const bests = await tx.query<{
      stroke: Stroke;
      distance_m: number;
      time_ms: number;
      swum_on: Date;
    }>(
      `
      SELECT DISTINCT ON (stroke, distance_m)
             stroke, distance_m, time_ms, swum_on
        FROM student_record
       WHERE student_id = $1 AND archived_at IS NULL
       ORDER BY stroke, distance_m, time_ms ASC, swum_on ASC
      `,
      [studentId],
    );

    const personalBests = bests.rows.map((row) => ({
      stroke: row.stroke,
      distanceM: row.distance_m,
      timeMs: row.time_ms,
      swumOn: isoDate(row.swum_on),
    }));

    return {
      records: rows.map((row) => ({
        id: row.id,
        stroke: row.stroke,
        distanceM: row.distance_m,
        timeMs: row.time_ms,
        swumOn: isoDate(row.swum_on),
        note: row.note,
        recordedByName: row.recorded_by_name,
        isPersonalBest: row.is_personal_best,
      })),
      bests: personalBests,
      fastestStroke: fastestStroke(personalBests),
      favouriteStroke: student.rows[0].favourite_stroke,
    };
  });
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
 * not.
 */
function fastestStroke(bests: PersonalBest[]): Stroke | null {
  if (bests.length === 0) return null;

  // The distance with the most strokes recorded is the fairest comparison
  // available — comparing a 50 m butterfly to a 400 m freestyle says nothing.
  const byDistance = new Map<number, PersonalBest[]>();
  for (const best of bests) {
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
  timeMs: number;
  swumOn: string;
  note: string | null;
}

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

    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO student_record (
         organization_id, student_id, stroke, distance_m, time_ms, swum_on,
         note, recorded_by_membership_id
       )
       VALUES ($1, $2, $3::swim_stroke, $4, $5, $6::date, $7, $8)
       RETURNING id`,
      [
        organizationId,
        studentId,
        input.stroke,
        input.distanceM,
        input.timeMs,
        input.swumOn,
        input.note,
        membershipId,
      ],
    );

    const id = rows[0]?.id;
    if (!id) throw new Error('Could not create the record');

    await recordAudit(tx, {
      action: 'student_record.created',
      entityType: 'student',
      entityId: studentId,
      data: { stroke: input.stroke, distanceM: input.distanceM, timeMs: input.timeMs },
    });

    return id;
  });
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
