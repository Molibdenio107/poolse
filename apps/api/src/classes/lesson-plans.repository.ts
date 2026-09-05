import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';

/**
 * The plan for one lesson — round 6, ticket 4.3.
 *
 * What an instructor writes before Tuesday: the drills, the distances, the skill
 * the group is working on. It used to live in a notebook, which meant the club
 * had no record that a level was actually being taught.
 *
 * **Addressed by session, stored by turma and date.** The calendar knows a
 * session id, so that is what the endpoints take; the row is keyed on
 * `(class_group_id, on_date)`, because sessions are regenerated when a turma
 * moves and a plan hanging off a rebuilt row is a plan that vanishes when
 * somebody changes the pool. The migration says more.
 *
 * **Reading is open; writing is not.** Anyone in the club may read a plan — an
 * instructor covering for a colleague needs to know what the group was doing.
 * Writing is the turma's own instructor, the owner and the admin, which
 * `canWrite` decides and the controller turns into a 403.
 */

export interface LessonPlan {
  /** The session this was asked about — what the client addressed. */
  sessionId: string;
  classGroupId: string;
  /** ISO date. Cast to text in SQL: a `date` parsed by pg is a day early in UTC. */
  onDate: string;
  /** Empty string when nothing has been written yet. */
  body: string;
  updatedAt: string | null;
  /** Who last wrote it, composed by the server. Null when nobody has. */
  updatedBy: string | null;
  /** Whether the reader may change it — the same answer the write guard gives. */
  canEdit: boolean;
  /** Hidden with the class, per the ticket. Stored either way. */
  cancelled: boolean;
  /** The level's skills, in their own order, for the suggestions strip. */
  skills: string[];
  /** The same turma's previous lesson, for "copy from the previous lesson". */
  previous: { onDate: string; body: string } | null;
}

interface Occurrence {
  class_group_id: string;
  on_date: string;
  level_id: string | null;
  instructor_membership_id: string | null;
  substitute_instructor_membership_id: string | null;
  cancelled: boolean;
}

/**
 * Which lesson a session id means, and who is entitled to plan it.
 *
 * Null when the session does not exist in this organization — which RLS makes
 * the same answer as "belongs to another club", and deliberately so: a caller
 * probing ids learns nothing from a 404 they could not learn from a 403.
 */
async function occurrenceOf(
  organizationId: string,
  sessionId: string,
): Promise<Occurrence | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<Occurrence>(
      `SELECT cs.class_group_id,
              cs.occurs_on::text AS on_date,
              cg.level_id,
              cg.instructor_membership_id,
              cs.substitute_instructor_membership_id,
              (cs.status = 'cancelled') AS cancelled
         FROM class_session cs
         JOIN class_group cg
           ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
        WHERE cs.id = $1`,
      [sessionId],
    );
    return rows[0] ?? null;
  });
}

/**
 * Who may write this lesson's plan.
 *
 * The turma's own instructor, plus owner and admin. A **substitute** counts too:
 * somebody covering Tuesday is the person who will teach it, and a plan they
 * cannot edit is a plan they will keep somewhere else.
 *
 * Where a turma has no instructor at all, only owner and admin can write — which
 * is the ticket's own rule, and the honest one: there is nobody else to name.
 */
function canWrite(
  occurrence: Occurrence,
  roles: readonly string[],
  membershipId: string,
): boolean {
  if (roles.includes('owner') || roles.includes('admin')) return true;

  return (
    membershipId !== '' &&
    (occurrence.instructor_membership_id === membershipId ||
      occurrence.substitute_instructor_membership_id === membershipId)
  );
}

/** The plan for one lesson, everything the panel needs to render itself. */
export async function readLessonPlan(
  organizationId: string,
  sessionId: string,
  roles: readonly string[],
  membershipId: string,
): Promise<LessonPlan | null> {
  const occurrence = await occurrenceOf(organizationId, sessionId);
  if (occurrence === null) return null;

  return withOrg(organizationId, async (tx) => {
    const plan = await tx.query<{
      body: string;
      updated_at: Date;
      updated_by: string | null;
    }>(
      /*
       * The name from Clerk's cache, falling back to the membership's own.
       *
       * `display_name(m.first_name, m.last_name)` alone is null for anybody who
       * signs in: an owner's membership carries no name of its own, because
       * Clerk owns it and `app_user` holds the cache — CLAUDE.md, decision 2.
       * The first version of this read the membership columns and reported that
       * nobody had written the plan they had just saved.
       */
      `SELECT p.body,
              p.updated_at,
              nullif(btrim(concat_ws(' ',
                coalesce(u.cached_first_name, m.first_name),
                coalesce(u.cached_last_name,  m.last_name))), '') AS updated_by
         FROM lesson_plan p
         LEFT JOIN membership m
                ON m.id = p.updated_by AND m.organization_id = p.organization_id
         LEFT JOIN app_user u ON u.id = m.app_user_id
        WHERE p.class_group_id = $1 AND p.on_date = $2 AND p.archived_at IS NULL`,
      [occurrence.class_group_id, occurrence.on_date],
    );

    /*
     * The one before this one, for "copy from the previous lesson".
     *
     * Strictly earlier, so pressing it on a lesson that already has a plan does
     * not copy that plan onto itself. It looks at plans rather than at sessions:
     * what somebody wants is the last thing they actually wrote, not the last
     * Tuesday the club happened to open.
     */
    const previous = await tx.query<{ on_date: string; body: string }>(
      `SELECT p.on_date::text AS on_date, p.body
         FROM lesson_plan p
        WHERE p.class_group_id = $1 AND p.on_date < $2 AND p.archived_at IS NULL
        ORDER BY p.on_date DESC
        LIMIT 1`,
      [occurrence.class_group_id, occurrence.on_date],
    );

    /*
     * The level's skills, for the suggestions strip.
     *
     * Their own `sort_order`, which is the order a club teaches them in — the
     * same order the progression grid draws. Archived skills are left out: a
     * suggestion to teach something the club has retired is a suggestion nobody
     * wants.
     */
    const skills =
      occurrence.level_id === null
        ? { rows: [] as { name: string }[] }
        : await tx.query<{ name: string }>(
            `SELECT s.name
               FROM skill s
              WHERE s.level_id = $1 AND s.archived_at IS NULL
              ORDER BY s.sort_order, lower(strip_accents(s.name))`,
            [occurrence.level_id],
          );

    const row = plan.rows[0];

    return {
      sessionId,
      classGroupId: occurrence.class_group_id,
      onDate: occurrence.on_date,
      body: row?.body ?? '',
      updatedAt: row?.updated_at.toISOString() ?? null,
      updatedBy: row?.updated_by ?? null,
      canEdit: canWrite(occurrence, roles, membershipId),
      cancelled: occurrence.cancelled,
      skills: skills.rows.map((skill) => skill.name),
      previous:
        previous.rows[0] === undefined
          ? null
          : { onDate: previous.rows[0].on_date, body: previous.rows[0].body },
    };
  });
}

export type SavePlanOutcome = 'saved' | 'cleared' | 'notFound' | 'refused';

/**
 * Writes the plan, or removes it when the box is emptied.
 *
 * **An empty plan is a deleted plan.** A row of whitespace would be a plan that
 * exists, shows as written and says nothing — worse than none, because a
 * colleague would stop looking. The schema refuses one either way.
 *
 * The upsert is a single statement against the partial unique index, so two
 * people saving Tuesday's plan at once end with one plan and a known winner
 * rather than a duplicate nobody reads.
 */
export async function saveLessonPlan(
  organizationId: string,
  sessionId: string,
  body: string,
  roles: readonly string[],
  membershipId: string,
): Promise<SavePlanOutcome> {
  const occurrence = await occurrenceOf(organizationId, sessionId);
  if (occurrence === null) return 'notFound';
  if (!canWrite(occurrence, roles, membershipId)) return 'refused';

  const text = body.trim();

  return withOrg(organizationId, async (tx) => {
    if (text === '') {
      const { rowCount } = await tx.query(
        `DELETE FROM lesson_plan
          WHERE class_group_id = $1 AND on_date = $2 AND archived_at IS NULL`,
        [occurrence.class_group_id, occurrence.on_date],
      );

      if ((rowCount ?? 0) > 0) {
        await recordAudit(tx, {
          action: 'lessonPlan.cleared',
          entityType: 'class_session',
          entityId: sessionId,
          data: { classGroupId: occurrence.class_group_id, onDate: occurrence.on_date },
        });
      }
      return 'cleared';
    }

    await tx.query(
      `INSERT INTO lesson_plan (organization_id, class_group_id, on_date, body, updated_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (organization_id, class_group_id, on_date) WHERE archived_at IS NULL
       DO UPDATE SET body = EXCLUDED.body, updated_by = EXCLUDED.updated_by`,
      [organizationId, occurrence.class_group_id, occurrence.on_date, text, membershipId],
    );

    await recordAudit(tx, {
      action: 'lessonPlan.saved',
      entityType: 'class_session',
      entityId: sessionId,
      data: { classGroupId: occurrence.class_group_id, onDate: occurrence.on_date },
    });

    return 'saved';
  });
}
