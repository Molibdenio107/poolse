import { REQUEST_WAITING } from '../classes/lesson-requests.repository.js';
import { turmasWithoutInstructor } from '../classes/turmas-without-instructor.js';
import { withOrg } from '@poolse/db';
import { excursions, gradeLabResult, isMultiSport, resolveBands } from '@poolse/rules';
import { readPoolWater } from '../dashboard/management.repository.js';
import { labValues, type LabParameter } from '../facilities/lab-results.repository.js';
import { TASK_STATE } from '../maintenance/maintenance.repository.js';
import { readLeadsWidget, waitingLeadsBySport } from '../leads/leads.repository.js';
import { studentsToReview } from '../students/students.repository.js';
import { countExpiringCategories } from '../billing/person-categories.repository.js';
import { JOINS as LESSON_JOINS, TZ as LESSON_TZ } from '../dashboard/instructor.repository.js';
import { supportStatus } from '../support/support.repository.js';

/**
 * Where something needs doing — POOLSE-120 (Rui, 28-10-2026).
 *
 * One read the layout asks for once per page, answering the small circles on
 * the menu, on a site's card, on a pool's or a space's name and on a lesson.
 * **A circle means "needs doing" and clears when it is done** — there is no
 * per-person *seen* record — and **only who can act is told**, in modules that
 * are on: the caller passes what this reader may see, and nothing else is
 * counted.
 *
 * Every verdict is an existing one, never a second definition: water is
 * `excursions` against `resolveBands` over `readPoolWater` (the dashboard's
 * read), a lab report is `gradeLabResult`, a task is the maintenance module's
 * `TASK_STATE`, a pre-registration is the Pedidos count, a student to review is
 * `studentsToReview`. Each kind is one statement whatever the number of sites.
 */

export interface Attention {
  /** By menu key: `leads`, `facilities`, `calendar`, `students`. Absent means nothing. */
  menu: Record<string, number>;
  facilities: Record<string, number>;
  pools: Record<string, number>;
  spaces: Record<string, number>;
  /** Lessons a family answered for — *Não vou* to come, or feedback this week. */
  sessions: Record<string, number>;
  /** Students the office has something to review on — POOLSE-190. */
  students: Record<string, number>;
  /** Turmas with no teacher of their own — POOLSE-211. */
  classGroups: Record<string, number>;
  /**
   * What the site circles stand for, named (Rui, 11-11-2026): a bell line that
   * said only "1 coisa por tratar nas instalações" sent people to the site's
   * settings, where nothing was wrong. One entry per kind and place, so the bell
   * can say *Piscina principal: água fora dos limites* and open that tab.
   */
  places: AttentionPlace[];
  /**
   * The lessons behind the calendar's count, named and dated, soonest first —
   * so the bell opens the lesson rather than this week's calendar (Rui, 11-11-2026).
   */
  lessons: AttentionLesson[];
}

export interface AttentionLesson {
  sessionId: string;
  /** The turma's name, or the partnership's. */
  name: string;
  /** A partnership's hour has no phone screen of its own. */
  partner: boolean;
  /** On the site's clock: `YYYY-MM-DD`, `HH:MM`, and that week's Monday for the calendar link. */
  localDate: string;
  localTime: string;
  weekStart: string;
  count: number;
}

/** `water` an analysis out of its bands, `lab` a non-conforming lab report, `task` a recurring job due, `fault` an open serious fault. */
export type AttentionPlaceKind = 'water' | 'lab' | 'task' | 'fault';

export interface AttentionPlace {
  kind: AttentionPlaceKind;
  facilityId: string;
  poolId: string | null;
  spaceId: string | null;
  /** The pool's or space's name, or the site's when the thing sits on the site itself. */
  name: string;
  count: number;
}

export interface AttentionScope {
  leads: boolean;
  /** What families sent and dates of birth to confirm: the office's to decide. */
  review: boolean;
  water: boolean;
  maintenance: boolean;
  /** Person categories expiring within 30 days — POOLSE-202, the office's at reception. */
  categories?: boolean;
  /** Turmas with no teacher — POOLSE-211: the office's to staff. */
  classes?: boolean;
  /** Families' answers: `all` for the office, `mine` for a teacher, or none. */
  families: 'all' | 'mine' | null;
  /**
   * The staff roles this reader may grant (Rui, 10-11-2026): a pending staff
   * invitation is counted only when every role on it is one of these, the
   * same test as Reenviar and Revogar. Empty or absent counts nothing.
   */
  invitations?: readonly string[];
  /** Poolse support asked to come in and nobody answered — the Owner's to decide (11-11-2026). */
  supportRequests?: boolean;
  membershipId: string;
}

export const NOTHING: Attention = {
  menu: {},
  facilities: {},
  pools: {},
  spaces: {},
  sessions: {},
  students: {},
  classGroups: {},
  places: [],
  lessons: [],
};

function addPlace(
  places: AttentionPlace[],
  entry: Omit<AttentionPlace, 'count'>,
): void {
  const found = places.find(
    (one) => one.kind === entry.kind && one.facilityId === entry.facilityId && one.poolId === entry.poolId && one.spaceId === entry.spaceId,
  );
  if (found !== undefined) found.count += 1;
  else places.push({ ...entry, count: 1 });
}


function add(map: Record<string, number>, key: string | null, by = 1): void {
  if (key === null) return;
  map[key] = (map[key] ?? 0) + by;
}

export async function readAttention(organizationId: string, scope: AttentionScope): Promise<Attention> {
  const out: Attention = {
    menu: {},
    facilities: {},
    pools: {},
    spaces: {},
    sessions: {},
    students: {},
    classGroups: {},
    places: [],
    lessons: [],
  };

  if (scope.supportRequests === true) {
    // The strip's own count, so the bell and the strip cannot disagree.
    const { pendingRequests } = await supportStatus(organizationId);
    if (pendingRequests > 0) out.menu['support'] = pendingRequests;
  }

  if (scope.invitations !== undefined && scope.invitations.length > 0) {
    // Pending staff invitations, as Pessoas › Convites lists them (a family's
    // lives on the student), that this reader could resend or withdraw.
    const pending = await withOrg(organizationId, async (tx) =>
      (
        await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM invitation i
            WHERE i.accepted_at IS NULL AND i.revoked_at IS NULL
              AND NOT i.roles <@ ARRAY['guardian', 'student']::member_role[]
              AND i.roles <@ $1::member_role[]`,
          [scope.invitations],
        )
      ).rows[0]?.n ?? 0,
    );
    if (pending > 0) out.menu['staff'] = pending;
  }

  if (scope.classes === true) {
    // POOLSE-211: each turma dotted, the menu's Turmas counted, each sport's copy its own.
    for (const turma of await turmasWithoutInstructor(organizationId)) {
      out.classGroups[turma.id] = 1;
      add(out.menu, 'classes');
      add(out.menu, `classes:${turma.sport}`);
    }
  }

  if (scope.review) {
    // The menu counts students, each sport's copy its own: `students:<sport>`.
    for (const student of await studentsToReview(organizationId)) {
      out.students[student.id] = student.items;
      add(out.menu, 'students');
      for (const sport of student.sports) add(out.menu, `students:${sport}`);
    }
  }

  if (scope.categories === true) {
    // POOLSE-202: the menu's *Receção* counts the categories about to expire.
    const expiring = await countExpiringCategories(organizationId);
    if (expiring > 0) add(out.menu, 'categories', expiring);
  }

  if (scope.leads) {
    /*
     * POOLSE-143 rule 7: with a second sport on, each sport's *Pedidos* counts
     * its own (`leads:<sport>`) and the shared entry only those with no sport,
     * as POOLSE-125 rule 4 splits the recintos. A pool-only club keeps the one
     * count it had.
     */
    const sports = await withOrg(organizationId, async (tx) =>
      (
        await tx.query<{ enabled_sports: string[] }>(
          'SELECT enabled_sports::text[] AS enabled_sports FROM organization WHERE id = $1',
          [organizationId],
        )
      ).rows[0]?.enabled_sports ?? ['pool'],
    );
    if (isMultiSport(sports as never)) {
      for (const [sport, count] of await waitingLeadsBySport(organizationId)) {
        if (count > 0) out.menu[sport === null ? 'leads' : `leads:${sport}`] = count;
      }
    } else {
      const waiting = (await readLeadsWidget(organizationId)).waiting;
      if (waiting > 0) out.menu['leads'] = waiting;
    }
  }

  if (scope.water || scope.maintenance) {
    const facilityIds = await withOrg(organizationId, async (tx) =>
      (await tx.query<{ id: string }>(`SELECT id FROM facility WHERE archived_at IS NULL`)).rows.map((row) => row.id),
    );

    if (scope.water && facilityIds.length > 0) {
      const pools = await readPoolWater(organizationId, facilityIds);
      const flagged = new Set<string>();
      const outOfBand = new Set<string>();
      for (const pool of pools) {
        if (excursions(pool.values, resolveBands(pool.overrides, pool.pool)).length > 0) {
          flagged.add(pool.poolId);
          outOfBand.add(pool.poolId);
        }
      }
      // The latest lab report of every tank, graded on the national reference.
      const labs = await withOrg(organizationId, async (tx) =>
        (
          await tx.query<{ pool_id: string; values: { parameter: string; value: number; unit: string }[] | null }>(
            `SELECT DISTINCT ON (r.pool_id) r.pool_id,
                    (SELECT json_agg(json_build_object('parameter', v.parameter::text,
                                                       'value', v.value::float8, 'unit', v.unit))
                       FROM lab_result_value v
                      WHERE v.lab_result_id = r.id AND v.organization_id = r.organization_id) AS values
               FROM lab_result r
              WHERE r.archived_at IS NULL
              ORDER BY r.pool_id, r.sampled_at DESC`,
          )
        ).rows,
      );
      const contextOf = new Map(pools.map((pool) => [pool.poolId, pool.pool]));
      for (const lab of labs) {
        const context = contextOf.get(lab.pool_id);
        if (context === undefined) continue;
        const values = (lab.values ?? []).map((v) => ({ parameter: v.parameter as LabParameter, value: v.value, unit: v.unit }));
        if (gradeLabResult(labValues(values), context).grade === 'nao_conforme') flagged.add(lab.pool_id);
      }
      for (const pool of pools) {
        if (!flagged.has(pool.poolId)) continue;
        add(out.pools, pool.poolId);
        add(out.facilities, pool.facilityId);
        // One circle per pool, so one named line: the readings first, as the Água tab's dot does.
        addPlace(out.places, {
          kind: outOfBand.has(pool.poolId) ? 'water' : 'lab',
          facilityId: pool.facilityId,
          poolId: pool.poolId,
          spaceId: null,
          name: pool.poolName,
        });
      }
    }

    if (scope.maintenance && facilityIds.length > 0) {
      // Recurring tasks due, and open high-severity faults — where each sits.
      const rows = await withOrg(organizationId, async (tx) =>
        (
          await tx.query<{
            kind: 'task' | 'fault';
            facility_id: string;
            pool_id: string | null;
            space_id: string | null;
            name: string;
          }>(
            `SELECT x.kind, x.facility_id, x.pool_id, x.space_id,
                    coalesce(p.name, sp.name, f.name) AS name
               FROM (
             SELECT 'task' AS kind, t.facility_id, t.pool_id, t.space_id
               FROM maintenance_task t
               LEFT JOIN LATERAL (
                 SELECT tc.performed_at AS last_done_at
                   FROM maintenance_task_completion tc
                  WHERE tc.task_id = t.id AND tc.archived_at IS NULL
                  ORDER BY tc.performed_at DESC
                  LIMIT 1
               ) c ON true
              WHERE t.archived_at IS NULL AND (${TASK_STATE}) = 'due'
             UNION ALL
             SELECT 'fault' AS kind, mr.facility_id, mr.pool_id, mr.space_id
               FROM maintenance_request mr
              WHERE mr.archived_at IS NULL AND mr.status = 'open' AND mr.severity = 'high'
                AND mr.type = 'fault'
                    ) x
               JOIN facility f ON f.id = x.facility_id
               LEFT JOIN pool p ON p.id = x.pool_id
               LEFT JOIN space sp ON sp.id = x.space_id`,
          )
        ).rows,
      );
      for (const row of rows) {
        add(out.facilities, row.facility_id);
        add(out.pools, row.pool_id);
        add(out.spaces, row.space_id);
        addPlace(out.places, {
          kind: row.kind,
          facilityId: row.facility_id,
          poolId: row.pool_id,
          spaceId: row.space_id,
          name: row.name,
        });
      }
    }

    const sites = Object.values(out.facilities).reduce((sum, n) => sum + n, 0);
    if (sites > 0) out.menu['facilities'] = sites;
  }

  if (scope.families !== null) {
    // *Não vou* on a lesson still to come, and feedback from the last 7 days,
    // on the reader's own lessons (a teacher) or every lesson (the office).
    const rows = await withOrg(organizationId, async (tx) =>
      (
        await tx.query<{ session_id: string; n: number }>(
          `SELECT x.session_id, count(*)::int AS n FROM (
             SELECT n.class_session_id AS session_id
               FROM session_notice n
               JOIN class_session cs ON cs.id = n.class_session_id AND cs.organization_id = n.organization_id
              WHERE NOT n.going AND cs.starts_at > now() AND cs.status <> 'cancelled'
                AND ($1::uuid IS NULL OR cs.resolved_instructor_id = $1)
             UNION ALL
             SELECT f.class_session_id
               FROM lesson_feedback f
               JOIN class_session cs ON cs.id = f.class_session_id AND cs.organization_id = f.organization_id
              WHERE f.archived_at IS NULL AND f.created_at > now() - interval '7 days'
                AND ($1::uuid IS NULL OR cs.resolved_instructor_id = $1)
           ) x GROUP BY x.session_id`,
          [scope.families === 'mine' ? scope.membershipId : null],
        )
      ).rows,
    );
    let total = 0;
    for (const row of rows) {
      out.sessions[row.session_id] = row.n;
      total += row.n;
    }
    // POOLSE-198: what teachers have asked of the office, until it is answered.
    if (scope.families === 'all') {
      const asked = await withOrg(organizationId, async (tx) =>
        (
          await tx.query<{ session_id: string; n: number }>(
            `SELECT r.class_session_id AS session_id, count(*)::int AS n
               FROM lesson_request r WHERE ${REQUEST_WAITING} GROUP BY 1`,
          )
        ).rows,
      );
      for (const row of asked) {
        out.sessions[row.session_id] = (out.sessions[row.session_id] ?? 0) + row.n;
        total += row.n;
      }
    }
    if (total > 0) {
      out.menu['calendar'] = total;
      const ids = Object.keys(out.sessions);
      const named = await withOrg(organizationId, async (tx) =>
        (
          await tx.query<{ id: string; name: string; partner: boolean; local_date: string; local_time: string; week_start: string }>(
            `SELECT cs.id,
                    coalesce(cg.name, pg.name, sch.title, '?') AS name,
                    (cs.class_group_id IS NULL) AS partner,
                    to_char(cs.starts_at AT TIME ZONE ${LESSON_TZ}, 'YYYY-MM-DD') AS local_date,
                    to_char(cs.starts_at AT TIME ZONE ${LESSON_TZ}, 'HH24:MI') AS local_time,
                    to_char(date_trunc('week', cs.starts_at AT TIME ZONE ${LESSON_TZ}), 'YYYY-MM-DD') AS week_start
               ${LESSON_JOINS}
              WHERE cs.id = ANY($1::uuid[])
              ORDER BY cs.starts_at`,
            [ids],
          )
        ).rows,
      );
      out.lessons = named.map((row) => ({
        sessionId: row.id,
        name: row.name,
        partner: row.partner,
        localDate: row.local_date,
        localTime: row.local_time,
        weekStart: row.week_start,
        count: out.sessions[row.id] ?? 0,
      }));
    }
  }

  return out;
}
