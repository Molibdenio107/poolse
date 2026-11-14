import { withOrg } from '@poolse/db';

/**
 * Turmas sharing a lane at an overlapping hour, or one of them with no lane
 * yet — Rui, 14-11-2026. A warning on save and a circle on Calendário, never a
 * refusal. The rule is `turma_lane_overlaps()` in SQL and nowhere else.
 */
export interface LaneOverlap {
  weekday: number;
  startTime: string;
  /** The other turma's name, the club's own word. */
  other: string;
  otherStartTime: string;
}

/** Every overlapping pair in the published season — the bell's count. */
export async function countLaneOverlaps(organizationId: string): Promise<number> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM turma_lane_overlaps($1)`, [organizationId]);
    return rows[0]?.n ?? 0;
  });
}

/** The overlaps one turma takes part in, for the warning its save shows. */
export async function laneOverlapsOf(organizationId: string, groupId: string): Promise<LaneOverlap[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ weekday: number; start_time: string; other: string; other_start_time: string }>(
      `SELECT o.weekday,
              CASE WHEN o.class_group_id = $2 THEN o.start_time ELSE o.other_start_time END AS start_time,
              g.name AS other,
              CASE WHEN o.class_group_id = $2 THEN o.other_start_time ELSE o.start_time END AS other_start_time
         FROM turma_lane_overlaps($1) o
         JOIN class_group g
           ON g.id = CASE WHEN o.class_group_id = $2 THEN o.other_class_group_id ELSE o.class_group_id END
        WHERE $2 IN (o.class_group_id, o.other_class_group_id)
        ORDER BY o.weekday, 2`,
      [organizationId, groupId],
    );
    return rows.map((row) => ({
      weekday: row.weekday,
      startTime: row.start_time,
      other: row.other,
      otherStartTime: row.other_start_time,
    }));
  });
}
