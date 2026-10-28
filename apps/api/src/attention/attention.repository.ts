import { withOrg } from '@poolse/db';
import { excursions, gradeLabResult, resolveBands } from '@poolse/rules';
import { readPoolWater } from '../dashboard/management.repository.js';
import { labValues, type LabParameter } from '../facilities/lab-results.repository.js';
import { TASK_STATE } from '../maintenance/maintenance.repository.js';
import { readLeadsWidget } from '../leads/leads.repository.js';

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
 * `TASK_STATE`, a pre-registration is the Pedidos count. Each kind is one
 * statement whatever the number of sites.
 */

export interface Attention {
  /** By menu key: `leads`, `facilities`, `calendar`. Absent means nothing. */
  menu: Record<string, number>;
  facilities: Record<string, number>;
  pools: Record<string, number>;
  spaces: Record<string, number>;
  /** Lessons a family answered for — *Não vou* to come, or feedback this week. */
  sessions: Record<string, number>;
}

export interface AttentionScope {
  leads: boolean;
  water: boolean;
  maintenance: boolean;
  /** Families' answers: `all` for the office, `mine` for a teacher, or none. */
  families: 'all' | 'mine' | null;
  membershipId: string;
}

export const NOTHING: Attention = { menu: {}, facilities: {}, pools: {}, spaces: {}, sessions: {} };

function add(map: Record<string, number>, key: string | null, by = 1): void {
  if (key === null) return;
  map[key] = (map[key] ?? 0) + by;
}

export async function readAttention(organizationId: string, scope: AttentionScope): Promise<Attention> {
  const out: Attention = { menu: {}, facilities: {}, pools: {}, spaces: {}, sessions: {} };

  if (scope.leads) {
    const waiting = (await readLeadsWidget(organizationId)).waiting;
    if (waiting > 0) out.menu['leads'] = waiting;
  }

  if (scope.water || scope.maintenance) {
    const facilityIds = await withOrg(organizationId, async (tx) =>
      (await tx.query<{ id: string }>(`SELECT id FROM facility WHERE archived_at IS NULL`)).rows.map((row) => row.id),
    );

    if (scope.water && facilityIds.length > 0) {
      const pools = await readPoolWater(organizationId, facilityIds);
      const flagged = new Set<string>();
      for (const pool of pools) {
        if (excursions(pool.values, resolveBands(pool.overrides, pool.pool)).length > 0) flagged.add(pool.poolId);
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
      }
    }

    if (scope.maintenance && facilityIds.length > 0) {
      // Recurring tasks due, and open high-severity faults — where each sits.
      const rows = await withOrg(organizationId, async (tx) =>
        (
          await tx.query<{ facility_id: string; pool_id: string | null; space_id: string | null }>(
            `SELECT t.facility_id, t.pool_id, t.space_id
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
             SELECT mr.facility_id, mr.pool_id, mr.space_id
               FROM maintenance_request mr
              WHERE mr.archived_at IS NULL AND mr.status = 'open' AND mr.severity = 'high'
                AND mr.type = 'fault'`,
          )
        ).rows,
      );
      for (const row of rows) {
        add(out.facilities, row.facility_id);
        add(out.pools, row.pool_id);
        add(out.spaces, row.space_id);
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
    if (total > 0) out.menu['calendar'] = total;
  }

  return out;
}
