import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { displayName } from '../people/names.js';
import type { Course, Stroke } from '../students/records.repository.js';

/**
 * Gap to qualify — POOLSE-85.
 *
 * FPN age groups and qualifying standards are the club's own copy of tables the
 * FPN publishes (Rui, 19-10-2026: the club enters both). What counts as a valid
 * time, and the gap, are `qualifying_gaps()` in SQL — this file reads it and
 * never subtracts a time itself.
 */

export type Gender = 'male' | 'female';

export interface AgeGroup {
  id: string;
  name: string;
  /** Null admits both. */
  gender: Gender | null;
  bornFrom: number | null;
  bornTo: number | null;
}

export interface AgeGroupInput {
  name: string;
  gender: Gender | null;
  bornFrom: number | null;
  bornTo: number | null;
}

export interface StandardSummary {
  id: string;
  name: string;
  windowFrom: string | null;
  windowTo: string | null;
  timeCount: number;
}

export interface StandardInput {
  name: string;
  windowFrom: string | null;
  windowTo: string | null;
}

export interface SeasonChoice {
  id: string;
  name: string;
  status: 'draft' | 'published' | 'archived';
}

export interface QualifyingOverview {
  seasons: SeasonChoice[];
  /** The season shown — the one asked for, else the published one. Null: the club has none. */
  seasonId: string | null;
  ageGroups: AgeGroup[];
  standards: StandardSummary[];
}

export interface EntryTime {
  ageGroupId: string;
  stroke: Stroke;
  distanceM: number;
  course: Course;
  timeMs: number;
}

export interface StandardDetail extends StandardSummary {
  seasonId: string;
  seasonName: string;
  /** The season's own dates, which an empty window falls back to. */
  seasonStartsOn: string;
  seasonEndsOn: string;
  ageGroups: AgeGroup[];
  times: EntryTime[];
}

/** One event on a gap table — what `qualifying_gaps()` answered, named. */
export interface GapRow {
  ageGroup: string;
  stroke: Stroke;
  distanceM: number;
  course: Course;
  entryMs: number;
  /** The best valid time; null is "no valid time", which is not a gap. */
  bestMs: number | null;
  bestSwumOn: string | null;
  bestMeet: string | null;
  /** best − entry; ≤ 0 is qualified. Null with `bestMs`. */
  gapMs: number | null;
}

export interface StudentQualifying {
  seasonName: string;
  /** The FPN age groups this swimmer is in this season, by name. */
  ageGroups: string[];
  /** Why there are none: no birth date, or none of the season's bands fits. */
  noBand: 'birthDate' | 'none' | null;
  standards: { id: string; name: string; rows: GapRow[] }[];
}

export interface BoardSwimmer {
  studentId: string;
  name: string;
  ageGroup: string;
  competitive: boolean;
  qualified: GapRow[];
  /** Still to find, but within the margin. */
  close: GapRow[];
  /** Events with a valid time further away than the margin. */
  further: number;
  /** Events with no valid time at all. */
  noTime: number;
}

export interface Board {
  standard: { id: string; name: string; seasonName: string };
  marginMs: number;
  swimmers: BoardSwimmer[];
  /** Swimmers in a competitive level whom no band of the season admits. */
  unplaced: { studentId: string; name: string; reason: 'birthDate' | 'none' }[];
}

export class NameTakenError extends Error {}
export class NoSuchSeasonError extends Error {}
export class NoSuchAgeGroupError extends Error {}

const day = (column: string): string => `to_char(${column}, 'YYYY-MM-DD')`;

function nameTaken(error: unknown, index: string): unknown {
  const { code, constraint } = error as { code?: string; constraint?: string };
  return code === '23505' && constraint === index ? new NameTakenError(index) : error;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export async function overview(organizationId: string, seasonId: string | null): Promise<QualifyingOverview> {
  return withOrg(organizationId, async (tx) => {
    const { rows: seasons } = await tx.query<SeasonChoice>(
      `SELECT id, name, status FROM season
        ORDER BY (status = 'published') DESC, starts_on DESC`,
    );
    const chosen =
      seasons.find((season) => season.id === seasonId) ??
      seasons.find((season) => season.status === 'published') ??
      seasons[0];
    if (chosen === undefined) return { seasons, seasonId: null, ageGroups: [], standards: [] };

    return {
      seasons,
      seasonId: chosen.id,
      ageGroups: await ageGroupsOf(tx, chosen.id),
      standards: await standardsOf(tx, chosen.id),
    };
  });
}

async function ageGroupsOf(tx: Tx, seasonId: string): Promise<AgeGroup[]> {
  const { rows } = await tx.query<{
    id: string;
    name: string;
    gender: Gender | null;
    born_from: number | null;
    born_to: number | null;
  }>(
    // Youngest first, as the FPN lists them; girls before boys within a name.
    `SELECT id, name, gender, born_from, born_to FROM federation_age_group
      WHERE season_id = $1 AND archived_at IS NULL
      ORDER BY coalesce(born_to, born_from) DESC NULLS LAST, lower(name), gender NULLS LAST`,
    [seasonId],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    gender: row.gender,
    bornFrom: row.born_from,
    bornTo: row.born_to,
  }));
}

async function standardsOf(tx: Tx, seasonId: string): Promise<StandardSummary[]> {
  const { rows } = await tx.query<{
    id: string;
    name: string;
    window_from: string | null;
    window_to: string | null;
    time_count: number;
  }>(
    `SELECT q.id, q.name, ${day('q.window_from')} AS window_from, ${day('q.window_to')} AS window_to,
            (SELECT count(*)::int FROM qualifying_time t
              WHERE t.standard_id = q.id AND t.archived_at IS NULL) AS time_count
       FROM qualifying_standard q
      WHERE q.season_id = $1 AND q.archived_at IS NULL
      ORDER BY lower(q.name)`,
    [seasonId],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    windowFrom: row.window_from,
    windowTo: row.window_to,
    timeCount: row.time_count,
  }));
}

// ---------------------------------------------------------------------------
// Age groups
// ---------------------------------------------------------------------------

export async function createAgeGroup(
  organizationId: string,
  seasonId: string,
  input: AgeGroupInput,
): Promise<string> {
  return withOrg(organizationId, async (tx) => {
    const season = await tx.query('SELECT 1 FROM season WHERE id = $1', [seasonId]);
    if (season.rowCount === 0) throw new NoSuchSeasonError();
    let id: string;
    try {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO federation_age_group (organization_id, season_id, name, gender, born_from, born_to)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [organizationId, seasonId, input.name, input.gender, input.bornFrom, input.bornTo],
      );
      id = rows[0]!.id;
    } catch (error) {
      throw nameTaken(error, 'federation_age_group_name_uq');
    }
    await recordAudit(tx, {
      action: 'federation_age_group.created',
      entityType: 'federation_age_group',
      entityId: id,
      data: { ...input },
    });
    return id;
  });
}

/** False when there is no such live group. */
export async function updateAgeGroup(
  organizationId: string,
  id: string,
  input: AgeGroupInput,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    let updated: number;
    try {
      const result = await tx.query(
        `UPDATE federation_age_group SET name = $2, gender = $3, born_from = $4, born_to = $5
          WHERE id = $1 AND archived_at IS NULL`,
        [id, input.name, input.gender, input.bornFrom, input.bornTo],
      );
      updated = result.rowCount ?? 0;
    } catch (error) {
      throw nameTaken(error, 'federation_age_group_name_uq');
    }
    if (updated === 0) return false;
    await recordAudit(tx, {
      action: 'federation_age_group.updated',
      entityType: 'federation_age_group',
      entityId: id,
      data: { ...input },
    });
    return true;
  });
}

/** Archives the group and its entry times with it. False when there is no such live group. */
export async function archiveAgeGroup(organizationId: string, id: string): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const result = await tx.query(
      'UPDATE federation_age_group SET archived_at = now() WHERE id = $1 AND archived_at IS NULL',
      [id],
    );
    if ((result.rowCount ?? 0) === 0) return false;
    const times = await tx.query(
      'UPDATE qualifying_time SET archived_at = now() WHERE age_group_id = $1 AND archived_at IS NULL',
      [id],
    );
    await recordAudit(tx, {
      action: 'federation_age_group.archived',
      entityType: 'federation_age_group',
      entityId: id,
      data: { cascade: { qualifyingTimes: times.rowCount ?? 0 } },
    });
    return true;
  });
}

// ---------------------------------------------------------------------------
// Standards
// ---------------------------------------------------------------------------

export async function createStandard(
  organizationId: string,
  seasonId: string,
  input: StandardInput,
): Promise<string> {
  return withOrg(organizationId, async (tx) => {
    const season = await tx.query('SELECT 1 FROM season WHERE id = $1', [seasonId]);
    if (season.rowCount === 0) throw new NoSuchSeasonError();
    let id: string;
    try {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO qualifying_standard (organization_id, season_id, name, window_from, window_to)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [organizationId, seasonId, input.name, input.windowFrom, input.windowTo],
      );
      id = rows[0]!.id;
    } catch (error) {
      throw nameTaken(error, 'qualifying_standard_name_uq');
    }
    await recordAudit(tx, {
      action: 'qualifying_standard.created',
      entityType: 'qualifying_standard',
      entityId: id,
      data: { ...input },
    });
    return id;
  });
}

export async function updateStandard(
  organizationId: string,
  id: string,
  input: StandardInput,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    let updated: number;
    try {
      const result = await tx.query(
        `UPDATE qualifying_standard SET name = $2, window_from = $3, window_to = $4
          WHERE id = $1 AND archived_at IS NULL`,
        [id, input.name, input.windowFrom, input.windowTo],
      );
      updated = result.rowCount ?? 0;
    } catch (error) {
      throw nameTaken(error, 'qualifying_standard_name_uq');
    }
    if (updated === 0) return false;
    await recordAudit(tx, {
      action: 'qualifying_standard.updated',
      entityType: 'qualifying_standard',
      entityId: id,
      data: { ...input },
    });
    return true;
  });
}

export async function archiveStandard(organizationId: string, id: string): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const result = await tx.query(
      'UPDATE qualifying_standard SET archived_at = now() WHERE id = $1 AND archived_at IS NULL',
      [id],
    );
    if ((result.rowCount ?? 0) === 0) return false;
    const times = await tx.query(
      'UPDATE qualifying_time SET archived_at = now() WHERE standard_id = $1 AND archived_at IS NULL',
      [id],
    );
    await recordAudit(tx, {
      action: 'qualifying_standard.archived',
      entityType: 'qualifying_standard',
      entityId: id,
      data: { cascade: { qualifyingTimes: times.rowCount ?? 0 } },
    });
    return true;
  });
}

export async function findStandard(organizationId: string, id: string): Promise<StandardDetail | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      name: string;
      window_from: string | null;
      window_to: string | null;
      season_id: string;
      season_name: string;
      season_starts_on: string;
      season_ends_on: string;
    }>(
      `SELECT q.id, q.name, ${day('q.window_from')} AS window_from, ${day('q.window_to')} AS window_to,
              q.season_id, se.name AS season_name,
              ${day('se.starts_on')} AS season_starts_on, ${day('se.ends_on')} AS season_ends_on
         FROM qualifying_standard q
         JOIN season se ON se.id = q.season_id AND se.organization_id = q.organization_id
        WHERE q.id = $1 AND q.archived_at IS NULL`,
      [id],
    );
    const standard = rows[0];
    if (standard === undefined) return null;

    const { rows: times } = await tx.query<{
      age_group_id: string;
      stroke: Stroke;
      distance_m: number;
      course: Course;
      time_ms: number;
    }>(
      `SELECT t.age_group_id, t.stroke, t.distance_m, t.course, t.time_ms
         FROM qualifying_time t
         JOIN federation_age_group g ON g.id = t.age_group_id AND g.organization_id = t.organization_id
        WHERE t.standard_id = $1 AND t.archived_at IS NULL AND g.archived_at IS NULL`,
      [id],
    );

    return {
      id: standard.id,
      name: standard.name,
      windowFrom: standard.window_from,
      windowTo: standard.window_to,
      timeCount: times.length,
      seasonId: standard.season_id,
      seasonName: standard.season_name,
      seasonStartsOn: standard.season_starts_on,
      seasonEndsOn: standard.season_ends_on,
      ageGroups: await ageGroupsOf(tx, standard.season_id),
      times: times.map((row) => ({
        ageGroupId: row.age_group_id,
        stroke: row.stroke,
        distanceM: row.distance_m,
        course: row.course,
        timeMs: row.time_ms,
      })),
    };
  });
}

/**
 * Replace one age group's entry times on a standard with `times`: a cell that
 * is new is inserted, a changed one updated, a missing one archived. One
 * transaction, so the grid that was saved is the grid that is read.
 *
 * Null when the standard or the group is not live (or they are in different
 * seasons, which the composite key would refuse anyway).
 */
export async function setEntryTimes(
  organizationId: string,
  standardId: string,
  ageGroupId: string,
  times: Omit<EntryTime, 'ageGroupId'>[],
): Promise<{ added: number; changed: number; cleared: number } | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ season_id: string }>(
      `SELECT q.season_id FROM qualifying_standard q
         JOIN federation_age_group g ON g.season_id = q.season_id AND g.organization_id = q.organization_id
        WHERE q.id = $1 AND g.id = $2 AND q.archived_at IS NULL AND g.archived_at IS NULL
        FOR UPDATE OF q`,
      [standardId, ageGroupId],
    );
    const seasonId = rows[0]?.season_id;
    if (seasonId === undefined) return null;

    const { rows: existing } = await tx.query<{
      id: string;
      stroke: Stroke;
      distance_m: number;
      course: Course;
      time_ms: number;
    }>(
      `SELECT id, stroke, distance_m, course, time_ms FROM qualifying_time
        WHERE standard_id = $1 AND age_group_id = $2 AND archived_at IS NULL`,
      [standardId, ageGroupId],
    );
    const key = (stroke: string, distanceM: number, course: string): string =>
      `${stroke}|${distanceM}|${course}`;
    const before = new Map(existing.map((row) => [key(row.stroke, row.distance_m, row.course), row]));

    let added = 0;
    let changed = 0;
    const kept = new Set<string>();
    for (const time of times) {
      const cell = key(time.stroke, time.distanceM, time.course);
      if (kept.has(cell)) continue;
      kept.add(cell);
      const row = before.get(cell);
      if (row === undefined) {
        await tx.query(
          `INSERT INTO qualifying_time
             (organization_id, season_id, standard_id, age_group_id, stroke, distance_m, course, time_ms)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [organizationId, seasonId, standardId, ageGroupId, time.stroke, time.distanceM, time.course, time.timeMs],
        );
        added += 1;
      } else if (row.time_ms !== time.timeMs) {
        await tx.query('UPDATE qualifying_time SET time_ms = $2 WHERE id = $1', [row.id, time.timeMs]);
        changed += 1;
      }
    }
    const gone = existing.filter((row) => !kept.has(key(row.stroke, row.distance_m, row.course)));
    if (gone.length > 0) {
      await tx.query('UPDATE qualifying_time SET archived_at = now() WHERE id = ANY($1::uuid[])', [
        gone.map((row) => row.id),
      ]);
    }

    if (added + changed + gone.length > 0) {
      await recordAudit(tx, {
        action: 'qualifying_standard.times_set',
        entityType: 'qualifying_standard',
        entityId: standardId,
        data: { ageGroupId, added, changed, cleared: gone.length },
      });
    }
    return { added, changed, cleared: gone.length };
  });
}

// ---------------------------------------------------------------------------
// Reading the gap
// ---------------------------------------------------------------------------

interface GapQueryRow {
  standard_id: string;
  student_id: string;
  age_group: string;
  stroke: Stroke;
  distance_m: number;
  course: Course;
  entry_ms: number;
  best_ms: number | null;
  best_swum_on: string | null;
  best_meet: string | null;
  gap_ms: number | null;
}

const GAP_COLUMNS = `
  q.standard_id, q.student_id, g.name AS age_group, q.stroke, q.distance_m, q.course,
  q.entry_ms, q.best_ms, ${day('q.best_swum_on')} AS best_swum_on, q.best_meet,
  q.best_ms - q.entry_ms AS gap_ms`;

const STROKE_ORDER = `array_position(enum_range(NULL::swim_stroke), q.stroke)`;

function gapRow(row: GapQueryRow): GapRow {
  return {
    ageGroup: row.age_group,
    stroke: row.stroke,
    distanceM: row.distance_m,
    course: row.course,
    entryMs: row.entry_ms,
    bestMs: row.best_ms,
    bestSwumOn: row.best_swum_on,
    bestMeet: row.best_meet,
    gapMs: row.gap_ms,
  };
}

/**
 * The swimmer's gap tables for the published season's standards. Null when the
 * season has no live standard with a time in it — the section is then absent,
 * not empty, because most swim-school students will never see one.
 */
export async function studentQualifying(tx: Tx, studentId: string): Promise<StudentQualifying | null> {
  const { rows: seasons } = await tx.query<{ id: string; name: string }>(
    `SELECT se.id, se.name FROM season se
      WHERE se.status = 'published' AND se.archived_at IS NULL
        AND EXISTS (SELECT 1 FROM qualifying_standard q
                     JOIN qualifying_time t ON t.standard_id = q.id AND t.archived_at IS NULL
                    WHERE q.season_id = se.id AND q.archived_at IS NULL)
      LIMIT 1`,
  );
  const season = seasons[0];
  if (season === undefined) return null;

  const { rows: bands } = await tx.query<{ name: string | null; birth_date: string | null }>(
    `SELECT g.name, s.birth_date::text AS birth_date
       FROM student s
       LEFT JOIN federation_age_group g
              ON g.season_id = $2 AND g.archived_at IS NULL
             AND federation_age_group_admits(g.gender, g.born_from, g.born_to, s.birth_date, s.gender)
      WHERE s.id = $1
      ORDER BY coalesce(g.born_to, g.born_from) DESC NULLS LAST`,
    [studentId, season.id],
  );
  const ageGroups = [...new Set(bands.flatMap((band) => (band.name === null ? [] : [band.name])))];

  const { rows } = await tx.query<GapQueryRow & { standard_name: string }>(
    `SELECT ${GAP_COLUMNS}, st.name AS standard_name
       FROM qualifying_gaps(NULL, $1) q
       JOIN qualifying_standard st ON st.id = q.standard_id
       JOIN federation_age_group g ON g.id = q.age_group_id
      WHERE st.season_id = $2
      ORDER BY lower(st.name), ${STROKE_ORDER}, q.distance_m, q.course`,
    [studentId, season.id],
  );

  const standards: StudentQualifying['standards'] = [];
  for (const row of rows) {
    let standard = standards.find((entry) => entry.id === row.standard_id);
    if (standard === undefined) {
      standard = { id: row.standard_id, name: row.standard_name, rows: [] };
      standards.push(standard);
    }
    standard.rows.push(gapRow(row));
  }

  return {
    seasonName: season.name,
    ageGroups,
    noBand: ageGroups.length > 0 ? null : bands[0]?.birth_date == null ? 'birthDate' : 'none',
    standards,
  };
}

/**
 * The coach's board for one standard: every swimmer in a competitive level or
 * with a valid time, what they have qualified for, and what is within the
 * margin. One statement over `qualifying_gaps()`, never a loop over swimmers.
 */
export async function board(organizationId: string, standardId: string, marginMs: number): Promise<Board | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows: found } = await tx.query<{ id: string; name: string; season_id: string; season_name: string }>(
      `SELECT q.id, q.name, q.season_id, se.name AS season_name
         FROM qualifying_standard q
         JOIN season se ON se.id = q.season_id AND se.organization_id = q.organization_id
        WHERE q.id = $1 AND q.archived_at IS NULL`,
      [standardId],
    );
    const standard = found[0];
    if (standard === undefined) return null;

    const { rows } = await tx.query<GapQueryRow & { name: string; competitive: boolean }>(
      `SELECT * FROM (
         SELECT ${GAP_COLUMNS}, ${displayName('s')} AS name, coalesce(l.competitive, false) AS competitive,
                bool_or(q.best_ms IS NOT NULL) OVER (PARTITION BY q.student_id) AS has_time,
                ${STROKE_ORDER} AS stroke_order
           FROM qualifying_gaps($1, NULL) q
           JOIN federation_age_group g ON g.id = q.age_group_id
           JOIN student s ON s.id = q.student_id
           LEFT JOIN student_level l ON l.id = s.level_id AND l.organization_id = s.organization_id
       ) x
        WHERE x.competitive OR x.has_time
        ORDER BY x.stroke_order, x.distance_m, x.course`,
      [standardId],
    );

    const swimmers = new Map<string, BoardSwimmer>();
    for (const row of rows) {
      const key = `${row.student_id}|${row.age_group}`;
      let swimmer = swimmers.get(key);
      if (swimmer === undefined) {
        swimmer = {
          studentId: row.student_id,
          name: row.name,
          ageGroup: row.age_group,
          competitive: row.competitive,
          qualified: [],
          close: [],
          further: 0,
          noTime: 0,
        };
        swimmers.set(key, swimmer);
      }
      if (row.gap_ms === null) swimmer.noTime += 1;
      else if (row.gap_ms <= 0) swimmer.qualified.push(gapRow(row));
      else if (row.gap_ms <= marginMs) swimmer.close.push(gapRow(row));
      else swimmer.further += 1;
    }

    const { rows: unplaced } = await tx.query<{ student_id: string; name: string; birth_date: string | null }>(
      `SELECT s.id AS student_id, ${displayName('s')} AS name, s.birth_date::text AS birth_date
         FROM student s
         JOIN student_level l ON l.id = s.level_id AND l.organization_id = s.organization_id
        WHERE s.archived_at IS NULL AND l.competitive
          AND NOT EXISTS (
            SELECT 1 FROM federation_age_group g
             WHERE g.season_id = $1 AND g.archived_at IS NULL
               AND federation_age_group_admits(g.gender, g.born_from, g.born_to, s.birth_date, s.gender))
        ORDER BY ${displayName('s')}`,
      [standard.season_id],
    );

    return {
      standard: { id: standard.id, name: standard.name, seasonName: standard.season_name },
      marginMs,
      swimmers: [...swimmers.values()].sort(
        (a, b) =>
          b.qualified.length - a.qualified.length ||
          b.close.length - a.close.length ||
          a.name.localeCompare(b.name, 'pt'),
      ),
      unplaced: unplaced.map((row) => ({
        studentId: row.student_id,
        name: row.name,
        reason: row.birth_date === null ? 'birthDate' : 'none',
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// Importing entry times — slice 2
// ---------------------------------------------------------------------------

export interface ImportCell {
  row: number;
  ageGroupId: string;
  eventLabel: string;
  stroke: Stroke | null;
  distanceM: number | null;
  /** Null when the API could not read the typed time. */
  timeMs: number | null;
  time: string;
}

export type ImportStatus = 'new' | 'changed' | 'unchanged' | 'refused';
export type ImportRefusal = 'event' | 'time' | 'ageGroup' | 'duplicate';

export interface ImportCellResult {
  row: number;
  ageGroupId: string;
  ageGroup: string | null;
  eventLabel: string;
  stroke: Stroke | null;
  distanceM: number | null;
  time: string;
  timeMs: number | null;
  previousMs: number | null;
  status: ImportStatus;
  reason: ImportRefusal | null;
}

export interface ImportResult {
  cells: ImportCellResult[];
  summary: Record<ImportStatus, number>;
  committed: boolean;
}

/**
 * The FPN's table, for one pool length — preview and commit on one path.
 *
 * A cell is new, changed (with the time it replaces), unchanged or refused (an
 * event that is not one, a time that cannot be read, a group not of this
 * season, or the same cell twice in one file). A cell the file leaves empty is
 * never sent, so an import adds and corrects and never clears. The commit
 * writes every new and changed cell in this one transaction, or none.
 *
 * Null when the standard is not live.
 */
export async function importEntryTimes(
  organizationId: string,
  standardId: string,
  course: Course,
  cells: ImportCell[],
  commit: boolean,
): Promise<ImportResult | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows: found } = await tx.query<{ season_id: string }>(
      `SELECT season_id FROM qualifying_standard WHERE id = $1 AND archived_at IS NULL
       ${commit ? 'FOR UPDATE' : ''}`,
      [standardId],
    );
    const seasonId = found[0]?.season_id;
    if (seasonId === undefined) return null;

    const groups = new Map((await ageGroupsOf(tx, seasonId)).map((group) => [group.id, group.name]));
    const { rows: existing } = await tx.query<{
      id: string;
      age_group_id: string;
      stroke: Stroke;
      distance_m: number;
      time_ms: number;
    }>(
      `SELECT id, age_group_id, stroke, distance_m, time_ms FROM qualifying_time
        WHERE standard_id = $1 AND course = $2 AND archived_at IS NULL`,
      [standardId, course],
    );
    const key = (group: string, stroke: string, distanceM: number): string => `${group}|${stroke}|${distanceM}`;
    const before = new Map(existing.map((row) => [key(row.age_group_id, row.stroke, row.distance_m), row]));

    const seen = new Set<string>();
    const results: ImportCellResult[] = cells.map((cell) => {
      const base = {
        row: cell.row,
        ageGroupId: cell.ageGroupId,
        ageGroup: groups.get(cell.ageGroupId) ?? null,
        eventLabel: cell.eventLabel,
        stroke: cell.stroke,
        distanceM: cell.distanceM,
        time: cell.time,
        timeMs: cell.timeMs,
        previousMs: null,
      };
      const refuse = (reason: ImportRefusal): ImportCellResult => ({ ...base, status: 'refused', reason });
      if (!groups.has(cell.ageGroupId)) return refuse('ageGroup');
      if (cell.stroke === null || cell.distanceM === null) return refuse('event');
      if (cell.timeMs === null) return refuse('time');
      const cellKey = key(cell.ageGroupId, cell.stroke, cell.distanceM);
      if (seen.has(cellKey)) return refuse('duplicate');
      seen.add(cellKey);
      const previous = before.get(cellKey);
      if (previous === undefined) return { ...base, status: 'new', reason: null };
      return {
        ...base,
        previousMs: previous.time_ms,
        status: previous.time_ms === cell.timeMs ? 'unchanged' : 'changed',
        reason: null,
      };
    });

    const summary: Record<ImportStatus, number> = { new: 0, changed: 0, unchanged: 0, refused: 0 };
    for (const result of results) summary[result.status] += 1;

    if (commit && summary.new + summary.changed > 0) {
      for (const result of results) {
        if (result.status === 'new') {
          await tx.query(
            `INSERT INTO qualifying_time
               (organization_id, season_id, standard_id, age_group_id, stroke, distance_m, course, time_ms)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [organizationId, seasonId, standardId, result.ageGroupId, result.stroke, result.distanceM, course, result.timeMs],
          );
        } else if (result.status === 'changed') {
          const previous = before.get(key(result.ageGroupId, result.stroke!, result.distanceM!))!;
          await tx.query('UPDATE qualifying_time SET time_ms = $2 WHERE id = $1', [previous.id, result.timeMs]);
        }
      }
      await recordAudit(tx, {
        action: 'qualifying_standard.times_imported',
        entityType: 'qualifying_standard',
        entityId: standardId,
        data: { course, added: summary.new, changed: summary.changed, refused: summary.refused },
      });
    }

    return { cells: results, summary, committed: commit };
  });
}
