import { withOrg } from '@poolse/db';

/**
 * A turma without a teacher — POOLSE-211, the one definition the dashboard tile,
 * the Turmas filter, the dots and the bell read: a turma the Turmas page lists
 * (its season not archived, a draft one included: staffing next season is work
 * to do now, Rui 10-11-2026), not archived, whose own teacher is empty (the
 * turma cards' rule). Its
 * sport is its recinto's, swimming when it has none. A parceria is never one:
 * it lives in its own table and brings its own teacher.
 */
export async function turmasWithoutInstructor(
  organizationId: string,
): Promise<{ id: string; sport: string; facilityId: string }[]> {
  return withOrg(organizationId, async (tx) =>
    (
      await tx.query<{ id: string; sport: string; facilityId: string }>(
        `SELECT cg.id, coalesce(pa.sport_id, 'pool') AS sport, cg.facility_id AS "facilityId"
           FROM class_group cg
           JOIN season s ON s.id = cg.season_id AND s.organization_id = cg.organization_id
           LEFT JOIN playing_area pa ON pa.id = cg.playing_area_id AND pa.organization_id = cg.organization_id
          WHERE cg.archived_at IS NULL
            AND cg.instructor_membership_id IS NULL
            AND s.archived_at IS NULL`,
      )
    ).rows,
  );
}
