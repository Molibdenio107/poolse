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
  /** Exactly one per organization, enforced by a partial unique index. */
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
      active: boolean;
      class_groups: string;
    }>(`
      SELECT s.id,
             s.name,
             s.starts_on,
             s.ends_on,
             s.archived_at IS NULL AS active,
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
      `UPDATE season SET archived_at = now()
        WHERE archived_at IS NULL
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
      `INSERT INTO season (organization_id, name, starts_on, ends_on)
       VALUES ($1, $2, $3::date, $4::date)
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
        active: false,
        classGroups: 0,
      },
      created: {
        id: fresh.id,
        name: fresh.name,
        startsOn: isoDate(fresh.starts_on),
        endsOn: isoDate(fresh.ends_on),
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
        SELECT id, name FROM season WHERE archived_at IS NULL
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
