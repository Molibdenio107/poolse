import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { cascadeAt, restorableKind } from '../archive/restorable.js';
import { displayName } from '../people/names.js';
import { TOTAL_COUNT, windowed, type PageQuery, type Paginated } from '../common/pagination.js';
import { updateRecordTimeIn } from '../students/records.repository.js';
import { inboxRowIsLive, markImportedIn } from './meet-inbox.repository.js';
import {
  bestKey,
  matchAthlete,
  skipReason,
  SKIP_REASONS,
  type CandidateStudent,
  type Course,
  type IncomingAthlete,
  type SkipReason,
  type Stroke,
} from './meet-import.js';

/**
 * Meets and their results — POOLSE-81, slice 2.
 *
 * **One path for preview and commit.** `importMeet` reads the club, plans every
 * row and, only when `commit` is set, writes the plan in the same transaction —
 * so what the operator was shown is what is written, as every importer here.
 * A half-imported meet is a set of bests nobody can trust, so a commit is all of
 * the file or none of it.
 */

export interface ImportInput {
  fileName: string;
  /** The club in the file that is this one, remembered for next time. */
  clubCode: string;
  official: boolean;
  meet: {
    name: string;
    city: string | null;
    course: Course | null;
    startsOn: string;
    endsOn: string;
  };
  /** The chosen club's athletes only. */
  athletes: IncomingAthlete[];
  /** Proposed matches the operator confirmed: athlete key → student id. */
  confirmed: Record<string, string>;
  /** Proposed matches whose licence should be written to the student. */
  writeLicence: Record<string, boolean>;
  /**
   * The *Recebidos por email* row the file came from (POOLSE-114), or null for a
   * file dropped on the page. A commit marks it imported in this transaction.
   */
  inboxId: string | null;
}

/** The inbox row named by an import is not there, or was discarded — a 404. */
export class InboxRowGone extends Error {
  constructor() {
    super('No such inbox file');
  }
}

export type RowAction = 'new' | 'update' | 'unchanged';

export interface PreviewResult {
  eventNumber: number;
  round: string;
  stroke: Stroke;
  distanceM: number;
  course: Course | null;
  swumOn: string;
  timeMs: number;
  action: RowAction;
  /** The time it replaces, for an update. */
  previousMs: number | null;
  /** Beats the swimmer's best for this stroke, distance and course — derived here. */
  newBest: boolean;
}

export interface PreviewAthlete {
  key: string;
  name: string;
  birthDate: string | null;
  licence: string | null;
  match: 'licence' | 'proposed' | 'none';
  studentId: string | null;
  studentName: string | null;
  /** A proposal whose student has no licence yet and the file has one: offered, ticked. */
  canWriteLicence: boolean;
  results: PreviewResult[];
}

export interface ImportPreview {
  meet: { name: string; startsOn: string; existingMeetId: string | null };
  /** The club code remembered from the last import, for the club picker. */
  rememberedClubCode: string | null;
  athletes: PreviewAthlete[];
  skipped: Record<SkipReason, number>;
  totals: { new: number; update: number; unchanged: number; unmatched: number; newBests: number };
  /** Set when committed. */
  meetId?: string;
}

export async function rememberedClubCode(organizationId: string): Promise<string | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ code: string | null }>(
      `SELECT federation_club_code AS code FROM organization WHERE id = $1`,
      [organizationId],
    );
    return rows[0]?.code ?? null;
  });
}

export async function importMeet(
  organizationId: string,
  membershipId: string,
  input: ImportInput,
  commit: boolean,
): Promise<ImportPreview> {
  return withOrg(organizationId, async (tx) => {
    // A row discarded since the dialog opened is gone, and so is the import.
    if (input.inboxId !== null && !(await inboxRowIsLive(tx, input.inboxId))) throw new InboxRowGone();

    const { rows: meetRows } = await tx.query<{ id: string }>(
      `SELECT id FROM swim_meet
        WHERE lower(btrim(name)) = lower(btrim($1)) AND starts_on = $2::date AND archived_at IS NULL`,
      [input.meet.name, input.meet.startsOn],
    );
    let meetId = meetRows[0]?.id ?? null;

    const { rows: remembered } = await tx.query<{ code: string | null }>(
      `SELECT federation_club_code AS code FROM organization WHERE id = $1`,
      [organizationId],
    );

    const { rows: studentRows } = await tx.query<{
      id: string;
      first_name: string;
      last_name: string;
      birth_date: string | null;
      licence: string | null;
      name: string;
    }>(
      `SELECT s.id, s.first_name, s.last_name, to_char(s.birth_date, 'YYYY-MM-DD') AS birth_date,
              s.federation_licence AS licence, ${displayName('s')} AS name
         FROM student s WHERE s.archived_at IS NULL`,
    );
    const students: CandidateStudent[] = studentRows.map((row) => ({
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      birthDate: row.birth_date,
      licence: row.licence,
    }));
    const nameOf = new Map(studentRows.map((row) => [row.id, row.name]));
    const licenceOf = new Map(studentRows.map((row) => [row.id, row.licence]));

    // This meet's results already in Poolse, by the re-import key.
    const existing = new Map<string, { id: string; timeMs: number }>();
    if (meetId !== null) {
      const { rows } = await tx.query<{
        id: string;
        student_id: string;
        event: number;
        round: string;
        time_ms: number;
      }>(
        `SELECT id, student_id, lenex_event_number AS event, lenex_round AS round, time_ms
           FROM student_record
          WHERE meet_id = $1 AND archived_at IS NULL AND lenex_event_number IS NOT NULL`,
        [meetId],
      );
      for (const row of rows) {
        existing.set(`${row.student_id}|${row.event}|${row.round}`, { id: row.id, timeMs: row.time_ms });
      }
    }

    // Every student's best by stroke, distance and course — outside this meet,
    // so a re-import does not measure a result against itself.
    const { rows: bestRows } = await tx.query<{
      student_id: string;
      stroke: Stroke;
      distance_m: number;
      course: Course | null;
      best: number;
    }>(
      `SELECT r.student_id, r.stroke, r.distance_m, r.course, min(r.time_ms)::int AS best
         FROM student_record r
         LEFT JOIN swim_meet sm ON sm.id = r.meet_id AND sm.organization_id = r.organization_id
        WHERE r.archived_at IS NULL
          AND (r.meet_id IS NULL OR sm.archived_at IS NULL)
          AND r.meet_id IS DISTINCT FROM $1::uuid
        GROUP BY 1, 2, 3, 4`,
      [meetId],
    );
    const priorBest = new Map(
      bestRows.map((row) => [`${row.student_id}|${bestKey(row.stroke, row.distance_m, row.course)}`, row.best]),
    );

    const skipped = Object.fromEntries(SKIP_REASONS.map((reason) => [reason, 0])) as Record<SkipReason, number>;
    const athletes: PreviewAthlete[] = [];
    const unmatched: { name: string; results: number }[] = [];

    for (const athlete of input.athletes) {
      const match = matchAthlete(athlete, students);
      const studentId =
        match.kind === 'licence'
          ? match.studentId
          : match.kind === 'proposed'
            ? match.studentId
            : null;

      const results: PreviewResult[] = [];
      for (const result of athlete.results) {
        const reason = skipReason(result);
        if (reason !== null) {
          skipped[reason] += 1;
          continue;
        }
        const swumOn = result.swumOn ?? input.meet.startsOn;
        const found =
          studentId === null ? undefined : existing.get(`${studentId}|${result.eventNumber}|${result.round}`);
        results.push({
          eventNumber: result.eventNumber,
          round: result.round,
          stroke: result.stroke!,
          distanceM: result.distanceM,
          course: result.course,
          swumOn,
          timeMs: result.timeMs!,
          action: found === undefined ? 'new' : found.timeMs === result.timeMs ? 'unchanged' : 'update',
          previousMs: found !== undefined && found.timeMs !== result.timeMs ? found.timeMs : null,
          newBest: false,
        });
      }

      // A new best: the fastest of this file's swims at a stroke, distance and
      // course, when it beats what the swimmer had before (or there was nothing).
      if (studentId !== null) {
        const fastest = new Map<string, PreviewResult>();
        for (const result of results) {
          const key = bestKey(result.stroke, result.distanceM, result.course);
          const current = fastest.get(key);
          if (current === undefined || result.timeMs < current.timeMs) fastest.set(key, result);
        }
        for (const [key, result] of fastest) {
          const before = priorBest.get(`${studentId}|${key}`);
          result.newBest = before === undefined || result.timeMs < before;
        }
      }

      if (match.kind === 'none' && results.length > 0) {
        unmatched.push({ name: `${athlete.firstName} ${athlete.lastName}`.trim(), results: results.length });
      }

      athletes.push({
        key: athlete.key,
        name: `${athlete.firstName} ${athlete.lastName}`.trim(),
        birthDate: athlete.birthDate,
        licence: athlete.licence,
        match: match.kind,
        studentId,
        studentName: studentId === null ? null : (nameOf.get(studentId) ?? null),
        canWriteLicence:
          match.kind === 'proposed' &&
          athlete.licence !== null &&
          (licenceOf.get(match.studentId) ?? null) === null,
        results,
      });
    }

    // What the commit writes: licence matches, and proposals the operator confirmed.
    const written = athletes.filter(
      (athlete) =>
        athlete.studentId !== null &&
        (athlete.match === 'licence' || input.confirmed[athlete.key] === athlete.studentId),
    );
    const count = (action: RowAction): number =>
      written.reduce((sum, athlete) => sum + athlete.results.filter((r) => r.action === action).length, 0);
    const preview: ImportPreview = {
      meet: { name: input.meet.name, startsOn: input.meet.startsOn, existingMeetId: meetId },
      rememberedClubCode: remembered[0]?.code ?? null,
      athletes,
      skipped,
      totals: {
        new: commit ? count('new') : sumAll(athletes, 'new'),
        update: commit ? count('update') : sumAll(athletes, 'update'),
        unchanged: commit ? count('unchanged') : sumAll(athletes, 'unchanged'),
        unmatched: unmatched.length,
        newBests: athletes.reduce((sum, athlete) => sum + athlete.results.filter((r) => r.newBest).length, 0),
      },
    };
    if (!commit) return preview;

    // ---- the write ------------------------------------------------------
    if (meetId === null) {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO swim_meet (organization_id, name, city, course, starts_on, ends_on, official,
                                source_file_name, imported_by_membership_id, imported_at, unmatched)
         VALUES ($1, btrim($2), $3, $4::swim_course, $5::date, $6::date, $7, $8, $9, now(), $10::jsonb)
         RETURNING id`,
        [
          organizationId,
          input.meet.name,
          input.meet.city,
          input.meet.course,
          input.meet.startsOn,
          input.meet.endsOn,
          input.official,
          input.fileName,
          membershipId,
          JSON.stringify(unmatched),
        ],
      );
      meetId = rows[0]!.id;
    } else {
      await tx.query(
        `UPDATE swim_meet
            SET official = $2, source_file_name = $3, imported_by_membership_id = $4,
                imported_at = now(), unmatched = $5::jsonb
          WHERE id = $1`,
        [meetId, input.official, input.fileName, membershipId, JSON.stringify(unmatched)],
      );
    }

    await tx.query(`UPDATE organization SET federation_club_code = $2 WHERE id = $1`, [
      organizationId,
      input.clubCode,
    ]);

    let licences = 0;
    for (const athlete of written) {
      const studentId = athlete.studentId!;
      // A confirmed proposal gains the file's licence, where nobody holds it.
      if (
        athlete.match === 'proposed' &&
        athlete.canWriteLicence &&
        input.writeLicence[athlete.key] !== false
      ) {
        const { rowCount } = await tx.query(
          `UPDATE student SET federation_licence = $2
            WHERE id = $1 AND federation_licence IS NULL
              AND NOT EXISTS (SELECT 1 FROM student o
                               WHERE o.federation_licence = $2 AND o.archived_at IS NULL)`,
          [studentId, athlete.licence],
        );
        licences += rowCount ?? 0;
      }

      for (const result of athlete.results) {
        if (result.action === 'unchanged') continue;
        const found = existing.get(`${studentId}|${result.eventNumber}|${result.round}`);
        if (found !== undefined) {
          // A corrected time goes through the record's own path, audited.
          await updateRecordTimeIn(tx, found.id, studentId, result.timeMs);
          continue;
        }
        await tx.query(
          `INSERT INTO student_record (organization_id, student_id, stroke, distance_m, course,
                                       time_ms, swum_on, recorded_by_membership_id, meet_id,
                                       lenex_event_number, lenex_round)
           VALUES ($1, $2, $3::swim_stroke, $4, $5::swim_course, $6, $7::date, $8, $9, $10, $11)`,
          [
            organizationId,
            studentId,
            result.stroke,
            result.distanceM,
            result.course,
            result.timeMs,
            result.swumOn,
            membershipId,
            meetId,
            result.eventNumber,
            result.round,
          ],
        );
      }
    }

    await recordAudit(tx, {
      action: 'swim_meet.imported',
      entityType: 'swim_meet',
      entityId: meetId,
      data: {
        name: input.meet.name,
        file: input.fileName,
        official: input.official,
        new: preview.totals.new,
        updated: preview.totals.update,
        unmatched: unmatched.length,
        licences,
      },
    });

    if (input.inboxId !== null) await markImportedIn(tx, input.inboxId, meetId, membershipId);

    return { ...preview, meetId };
  });
}

function sumAll(athletes: PreviewAthlete[], action: RowAction): number {
  return athletes
    .filter((athlete) => athlete.studentId !== null)
    .reduce((sum, athlete) => sum + athlete.results.filter((r) => r.action === action).length, 0);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface MeetSummary {
  id: string;
  name: string;
  city: string | null;
  course: Course | null;
  startsOn: string;
  endsOn: string;
  official: boolean;
  imported: boolean;
  resultCount: number;
}

export async function listMeets(
  organizationId: string,
  page: PageQuery,
): Promise<Paginated<MeetSummary>> {
  return withOrg(organizationId, (tx) =>
    windowed(
      page,
      (limit, offset) =>
        tx.query<{
          total_count: number;
          id: string;
          name: string;
          city: string | null;
          course: Course | null;
          starts_on: string;
          ends_on: string;
          official: boolean;
          imported: boolean;
          result_count: number;
        }>(
          `SELECT ${TOTAL_COUNT}, m.id, m.name, m.city, m.course,
                  to_char(m.starts_on, 'YYYY-MM-DD') AS starts_on,
                  to_char(m.ends_on, 'YYYY-MM-DD') AS ends_on,
                  m.official, m.source_file_name IS NOT NULL AS imported,
                  (SELECT count(*)::int FROM student_record r
                    WHERE r.meet_id = m.id AND r.organization_id = m.organization_id
                      AND r.archived_at IS NULL) AS result_count
             FROM swim_meet m
            WHERE m.archived_at IS NULL
            ORDER BY m.starts_on DESC, m.name, m.id
            LIMIT $1 OFFSET $2`,
          [limit, offset],
        ),
      (row) => ({
        id: row.id,
        name: row.name,
        city: row.city,
        course: row.course,
        startsOn: row.starts_on,
        endsOn: row.ends_on,
        official: row.official,
        imported: row.imported,
        resultCount: row.result_count,
      }),
    ),
  );
}

export interface MeetResult {
  recordId: string;
  studentId: string;
  studentName: string;
  stroke: Stroke;
  distanceM: number;
  course: Course | null;
  round: string | null;
  eventNumber: number | null;
  timeMs: number;
  swumOn: string;
  /** Still the swimmer's best for this stroke, distance and course. */
  isPersonalBest: boolean;
  /** In a competitive level with no FPN licence — the ticket's warning, here too. */
  licenceMissing: boolean;
  /**
   * The live standards whose entry time this swim met, by name — POOLSE-115's
   * *Mín.* Read from `qualifying_attempts()`, the one definition of a time
   * that counts, so a friendly or a 25 m swim is never marked.
   */
  qualifies: string[];
  /**
   * The FPN age groups that admit the swimmer in the season the meet falls in,
   * derived by `federation_age_group_admits()` and never stored. Empty when the
   * club has not set that season's groups, or the swimmer has no birth date.
   */
  ageGroups: string[];
}

export interface MeetDetail extends MeetSummary {
  sourceFileName: string | null;
  importedAt: string | null;
  results: MeetResult[];
  unmatched: { name: string; results: number }[];
}

export async function findMeet(organizationId: string, meetId: string): Promise<MeetDetail | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      name: string;
      city: string | null;
      course: Course | null;
      starts_on: string;
      ends_on: string;
      official: boolean;
      source_file_name: string | null;
      imported_at: Date | null;
      unmatched: { name: string; results: number }[];
    }>(
      `SELECT id, name, city, course, to_char(starts_on, 'YYYY-MM-DD') AS starts_on,
              to_char(ends_on, 'YYYY-MM-DD') AS ends_on, official, source_file_name,
              imported_at, unmatched
         FROM swim_meet WHERE id = $1 AND archived_at IS NULL`,
      [meetId],
    );
    const meet = rows[0];
    if (meet === undefined) return null;

    const { rows: results } = await tx.query<{
      id: string;
      student_id: string;
      student_name: string;
      stroke: Stroke;
      distance_m: number;
      course: Course | null;
      round: string | null;
      event: number | null;
      time_ms: number;
      swum_on: string;
      is_best: boolean;
      licence_missing: boolean;
      qualifies: string[];
      age_groups: string[];
    }>(
      `WITH bests AS (
         SELECT r.id,
                row_number() OVER (
                  PARTITION BY r.student_id, r.stroke, r.distance_m, r.course
                  ORDER BY r.time_ms, r.swum_on, r.recorded_at
                ) = 1 AS is_best
           FROM student_record r
           LEFT JOIN swim_meet sm ON sm.id = r.meet_id AND sm.organization_id = r.organization_id
          WHERE r.archived_at IS NULL
            AND (r.meet_id IS NULL OR sm.archived_at IS NULL)
            AND r.student_id IN (SELECT student_id FROM student_record WHERE meet_id = $1)
       ),
       -- One call per swimmer in this meet, never per row and never per club.
       made AS (
         SELECT a.record_id, array_agg(DISTINCT qs.name ORDER BY qs.name) AS qualifies
           FROM (SELECT DISTINCT student_id FROM student_record
                  WHERE meet_id = $1 AND archived_at IS NULL) m
          CROSS JOIN LATERAL qualifying_attempts(NULL, m.student_id) a
           JOIN qualifying_standard qs ON qs.id = a.standard_id
          WHERE a.time_ms <= a.entry_ms
          GROUP BY a.record_id
       )
       SELECT r.id, r.student_id, ${displayName('s')} AS student_name, r.stroke, r.distance_m,
              r.course, r.lenex_round AS round, r.lenex_event_number AS event, r.time_ms,
              to_char(r.swum_on, 'YYYY-MM-DD') AS swum_on, b.is_best,
              (coalesce(l.competitive, false) AND s.federation_licence IS NULL) AS licence_missing,
              coalesce(made.qualifies, '{}') AS qualifies,
              coalesce((
                SELECT array_agg(DISTINCT g.name ORDER BY g.name)
                  FROM federation_age_group g
                 -- One season: the meet's, and where a draft overlaps the one
                 -- running, the published one, else the latest (sweep 27-10).
                 WHERE g.season_id = (
                         SELECT se.id FROM season se
                          WHERE se.organization_id = r.organization_id
                            AND (SELECT starts_on FROM swim_meet WHERE id = $1) BETWEEN se.starts_on AND se.ends_on
                          ORDER BY (se.status = 'published') DESC, se.starts_on DESC
                          LIMIT 1)
                   AND g.archived_at IS NULL
                   AND federation_age_group_admits(g.gender, g.born_from, g.born_to, s.birth_date, s.gender)
              ), '{}') AS age_groups
         FROM student_record r
         JOIN bests b ON b.id = r.id
         LEFT JOIN made ON made.record_id = r.id
         JOIN student s ON s.id = r.student_id AND s.organization_id = r.organization_id
         LEFT JOIN student_level l ON l.id = s.level_id AND l.organization_id = s.organization_id
        WHERE r.meet_id = $1 AND r.archived_at IS NULL AND s.archived_at IS NULL
        ORDER BY r.lenex_event_number NULLS LAST, r.stroke, r.distance_m, r.time_ms`,
      [meetId],
    );

    return {
      id: meet.id,
      name: meet.name,
      city: meet.city,
      course: meet.course,
      startsOn: meet.starts_on,
      endsOn: meet.ends_on,
      official: meet.official,
      imported: meet.source_file_name !== null,
      resultCount: results.length,
      sourceFileName: meet.source_file_name,
      importedAt: meet.imported_at?.toISOString() ?? null,
      unmatched: meet.unmatched,
      results: results.map((row) => ({
        recordId: row.id,
        studentId: row.student_id,
        studentName: row.student_name,
        stroke: row.stroke,
        distanceM: row.distance_m,
        course: row.course,
        round: row.round,
        eventNumber: row.event,
        timeMs: row.time_ms,
        swumOn: row.swum_on,
        isPersonalBest: row.is_best,
        licenceMissing: row.licence_missing,
        qualifies: row.qualifies,
        ageGroups: row.age_groups,
      })),
    };
  });
}

/**
 * Archived with its results, which leave the bests and the chart with it; the
 * bin brings back exactly those (`data.cascade`, POOLSE-78).
 */
export async function archiveMeet(
  organizationId: string,
  meetId: string,
): Promise<{ archiveEntryId: string } | null> {
  return withOrg(organizationId, async (tx: Tx) => {
    const { rows } = await tx.query<{ name: string }>(
      `UPDATE swim_meet SET archived_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING name`,
      [meetId],
    );
    if (!rows[0]) return null;
    await tx.query(
      `UPDATE student_record SET archived_at = now() WHERE meet_id = $1 AND archived_at IS NULL`,
      [meetId],
    );
    const entryId = await recordAudit(tx, {
      action: 'swim_meet.archived',
      entityType: 'swim_meet',
      entityId: meetId,
      data: {
        name: rows[0].name,
        cascade: await cascadeAt(tx, restorableKind('swim_meet'), meetId),
      },
    });
    return { archiveEntryId: entryId };
  });
}
