import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';

/**
 * Seasons — POOLSE-07.
 *
 * A season is the year a club runs: September to the end of August, because a
 * swimming school's year starts when school does and stops for the August
 * holidays.
 *
 * Resetting one archives it and creates a new empty one. Nothing is deleted —
 * the old turmas stay attached to the old season with every session, enrolment
 * and register intact, and simply stop appearing in the new one. That is the
 * whole trick, and it is why the reset is a two-row change rather than a
 * cascade.
 */

export interface Season {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  /**
   * `published` is the season the club is running — exactly one, enforced by a
   * partial unique index. `draft` is a plan: any number, and no dated session is
   * ever generated from one. `archived` is a year that happened.
   */
  status: 'draft' | 'published' | 'archived';
  /** True for the published season. Kept because every existing caller reads it. */
  active: boolean;
  /** So the confirmation can say what is about to be retired. */
  classGroups: number;
}

/**
 * A `date` column as a plain calendar day.
 *
 * **Not `toISOString()`** — node-pg hands a `date` back as a JS Date at *local*
 * midnight, and in Europe/Lisbon summer time that is 23:00 UTC the day before.
 * A season starting on 1 September would read as 31 August for half the year.
 * `getFullYear`/`getMonth`/`getDate` read the local fields the driver actually
 * set, which is the day Postgres sent.
 *
 * Strings pass through: some drivers and some queries already hand back text.
 */
function isoDate(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

/**
 * Every season, newest first.
 *
 * Archived ones stay in the list because they stay selectable in reporting —
 * "archived" here means "no longer current", not "gone".
 */
export async function listSeasons(organizationId: string): Promise<Season[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      name: string;
      starts_on: Date;
      ends_on: Date;
      status: Season['status'];
      active: boolean;
      class_groups: string;
    }>(`
      SELECT s.id,
             s.name,
             s.starts_on,
             s.ends_on,
             s.status,
             s.status = 'published' AS active,
             (
               SELECT count(*)
                 FROM class_group cg
                WHERE cg.season_id = s.id
                  AND cg.organization_id = s.organization_id
                  AND cg.archived_at IS NULL
             ) AS class_groups
        FROM season s
       ORDER BY s.starts_on DESC
    `);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      startsOn: isoDate(row.starts_on),
      endsOn: isoDate(row.ends_on),
      status: row.status,
      active: row.active,
      classGroups: Number(row.class_groups),
    }));
  });
}

export interface ResetOutcome {
  archived: Season;
  created: Season;
}

/**
 * Archives the current season and opens a new one — POOLSE-07.
 *
 * One transaction, and the order matters: the old season must be archived before
 * the new one is inserted, or `season_one_active` refuses the second row. That
 * index is doing real work here rather than being belt and braces — it is what
 * stops a half-finished reset leaving a club with two current seasons.
 *
 * Nothing is deleted and nothing cascades. The old turmas keep pointing at the
 * old season, so every session, enrolment and register they carry stays exactly
 * where it was and stays readable. The new season is empty because no turma
 * points at it yet — not because anything was emptied.
 *
 * Students, levels, pools and staff are tenant data and are not touched. They
 * belong to the club rather than to a year of it.
 */
export async function resetSeason(
  organizationId: string,
  name: string,
  startsOn: string,
  endsOn: string,
): Promise<ResetOutcome | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows: current } = await tx.query<{ id: string; name: string }>(
      /*
       * Only the published one — POOLSE-45.
       *
       * This read `WHERE archived_at IS NULL`, which was every unarchived
       * season. Once drafts exist that is the published season *and* every plan
       * for next year, so a reset would have quietly retired somebody's June
       * planning along with the year they meant to close.
       */
      `UPDATE season SET status = 'archived', archived_at = now()
        WHERE status = 'published'
      RETURNING id, name`,
    );

    const archived = current[0];
    // No current season to reset. Not an error worth a stack trace — the caller
    // turns it into a 404.
    if (!archived) return null;

    const { rows: created } = await tx.query<{
      id: string;
      name: string;
      starts_on: Date;
      ends_on: Date;
    }>(
      `INSERT INTO season (organization_id, name, starts_on, ends_on, status)
       VALUES ($1, $2, $3::date, $4::date, 'published')
       RETURNING id, name, starts_on, ends_on`,
      [organizationId, name, startsOn, endsOn],
    );

    const fresh = created[0]!;

    await recordAudit(tx, {
      action: 'season.reset',
      entityType: 'season',
      entityId: fresh.id,
      data: { archivedSeasonId: archived.id, archivedName: archived.name, name },
    });

    return {
      archived: {
        id: archived.id,
        name: archived.name,
        startsOn: '',
        endsOn: '',
        status: 'archived',
        active: false,
        classGroups: 0,
      },
      created: {
        id: fresh.id,
        name: fresh.name,
        startsOn: isoDate(fresh.starts_on),
        endsOn: isoDate(fresh.ends_on),
        status: 'published',
        active: true,
        classGroups: 0,
      },
    };
  });
}

/**
 * What a reset is about to retire, so the confirmation can be specific.
 *
 * The dialog names real numbers rather than saying "your data will be archived",
 * because an operator typing RESET deserves to know it is nineteen turmas and
 * two hundred registers rather than an empty season they set up by mistake.
 */
export interface ResetPreview {
  seasonName: string;
  classGroups: number;
  enrollments: number;
  sessions: number;
  attendance: number;
}

export async function previewReset(organizationId: string): Promise<ResetPreview | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      season_name: string;
      class_groups: string;
      enrollments: string;
      sessions: string;
      attendance: string;
    }>(`
      WITH current_season AS (
        -- Published, not merely unarchived — a draft is unarchived too.
        SELECT id, name FROM season WHERE status = 'published'
      ),
      groups AS (
        SELECT cg.id
          FROM class_group cg
          JOIN current_season s ON s.id = cg.season_id
         WHERE cg.archived_at IS NULL
      )
      SELECT (SELECT name FROM current_season) AS season_name,
             (SELECT count(*) FROM groups) AS class_groups,
             (SELECT count(*) FROM enrollment e
               WHERE e.class_group_id IN (SELECT id FROM groups)
                 AND e.status <> 'ended') AS enrollments,
             (SELECT count(*) FROM class_session cs
               WHERE cs.class_group_id IN (SELECT id FROM groups)) AS sessions,
             (SELECT count(*) FROM attendance a
               WHERE a.class_session_id IN (
                 SELECT cs.id FROM class_session cs
                  WHERE cs.class_group_id IN (SELECT id FROM groups)
               )) AS attendance
    `);

    const row = rows[0];
    if (!row?.season_name) return null;

    return {
      seasonName: row.season_name,
      classGroups: Number(row.class_groups),
      enrollments: Number(row.enrollments),
      sessions: Number(row.sessions),
      attendance: Number(row.attendance),
    };
  });
}

// ---------------------------------------------------------------------------
// Drafts — POOLSE-45
//
// A club builds next year's grid while this year runs. A draft is a plan: any
// number of them may exist, they own their own slot grid and bookings, and no
// dated session is ever generated from one — `generate_sessions` refuses a
// season that is not published.
// ---------------------------------------------------------------------------

/** Raised when a draft is asked to copy a season that is not there. */
export class NoSuchSeasonError extends Error {}

/** Raised when publishing something that has already been retired. */
export class SeasonArchivedError extends Error {}

export interface DraftInput {
  name: string;
  startsOn: string;
  endsOn: string;
  /**
   * The season whose grid and bookings to copy, or null for an empty draft.
   *
   * "Duplicar época" is this with the current season named. An empty draft is
   * the other half of the same control: a club rebuilding its timetable from
   * scratch should not have to delete last year's first.
   */
  copyFrom: string | null;
}

/**
 * Creates a draft, optionally as a copy of another season.
 *
 * **What is copied and what is not.** The slot grid and the bookings, because
 * those are the plan. Not turmas, enrolments, sessions or attendance — those
 * belong to the year that happened, and a draft that carried them would be a
 * second copy of a club's register with no way to tell which was real.
 *
 * One transaction. A half-copied grid is worse than none: the operator cannot
 * tell which half, and running it again doubles what landed.
 */
export async function createDraft(
  organizationId: string,
  input: DraftInput,
): Promise<Season | null> {
  return withOrg(organizationId, async (tx) => {
    if (input.copyFrom !== null) {
      const { rows } = await tx.query(`SELECT 1 FROM season WHERE id = $1`, [input.copyFrom]);
      if (rows.length === 0) throw new NoSuchSeasonError(input.copyFrom);
    }

    const { rows: created } = await tx.query<{
      id: string;
      name: string;
      starts_on: Date;
      ends_on: Date;
    }>(
      `INSERT INTO season (organization_id, name, starts_on, ends_on, status)
       VALUES ($1, $2, $3::date, $4::date, 'draft')
       RETURNING id, name, starts_on, ends_on`,
      [organizationId, input.name, input.startsOn, input.endsOn],
    );

    const draft = created[0];
    if (!draft) return null;

    let slots = 0;

    if (input.copyFrom !== null) {
      /*
       * The slot grid, verbatim. Facility ids carry over unchanged because a
       * facility is the club's, not the season's — only the season moves.
       */
      const { rowCount } = await tx.query(
        `INSERT INTO facility_time_slot
           (organization_id, facility_id, season_id, day_group, start_time, end_time)
         SELECT organization_id, facility_id, $2, day_group, start_time, end_time
           FROM facility_time_slot
          WHERE season_id = $1 AND archived_at IS NULL`,
        [input.copyFrom, draft.id],
      );
      slots = rowCount ?? 0;
    }

    await recordAudit(tx, {
      action: 'season.draft.created',
      entityType: 'season',
      entityId: draft.id,
      data: { name: input.name, copiedFrom: input.copyFrom, slots },
    });

    return {
      id: draft.id,
      name: draft.name,
      startsOn: isoDate(draft.starts_on),
      endsOn: isoDate(draft.ends_on),
      status: 'draft',
      active: false,
      classGroups: 0,
    };
  });
}

/**
 * Makes a draft the season the club is running.
 *
 * The ordering — retire the incumbent, then promote the draft — is the
 * correctness here, and it lives in `publish_season` in the database rather than
 * in two statements up here. The partial unique index refuses the second update
 * if they happen the other way round, and a moment with two published seasons,
 * or none, is a moment where every screen that filters by the current season is
 * wrong.
 */
export async function publishSeason(
  organizationId: string,
  seasonId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    let published: boolean;
    try {
      const { rows } = await tx.query<{ publish_season: boolean }>(
        `SELECT publish_season($1, $2)`,
        [organizationId, seasonId],
      );
      published = rows[0]?.publish_season ?? false;
    } catch (error) {
      // The function raises on an archived season; everything else is a real
      // failure and is left to travel.
      if (error instanceof Error && error.message.includes('cannot be published')) {
        throw new SeasonArchivedError(seasonId);
      }
      throw error;
    }

    if (!published) return false;

    await recordAudit(tx, {
      action: 'season.published',
      entityType: 'season',
      entityId: seasonId,
    });

    return true;
  });
}

/**
 * Deletes a draft.
 *
 * A genuine delete, and the one place in this schema where that is right: a
 * draft is a plan nobody acted on, it has no sessions, no registers and no
 * history, and "history is never destroyed" is a rule about what happened rather
 * than about what somebody considered. The published and archived seasons are
 * refused here — those are years, and years are archived.
 */
export async function discardDraft(
  organizationId: string,
  seasonId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ name: string }>(
      `SELECT name FROM season WHERE id = $1 AND status = 'draft'`,
      [seasonId],
    );
    const draft = rows[0];
    if (!draft) return false;

    // A draft that somebody has already parked turmas in is not a scrap of
    // paper any more, and deleting it would take them with it.
    const { rows: groups } = await tx.query<{ count: string }>(
      `SELECT count(*)::text FROM class_group WHERE season_id = $1 AND archived_at IS NULL`,
      [seasonId],
    );
    if (Number(groups[0]?.count ?? '0') > 0) return false;

    await tx.query(`DELETE FROM facility_time_slot WHERE season_id = $1`, [seasonId]);

    await recordAudit(tx, {
      action: 'season.draft.discarded',
      entityType: 'season',
      entityId: seasonId,
      data: { name: draft.name },
    });

    await tx.query(`DELETE FROM season WHERE id = $1`, [seasonId]);

    return true;
  });
}
