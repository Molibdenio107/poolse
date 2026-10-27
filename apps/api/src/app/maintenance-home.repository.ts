import { withOrg } from '@poolse/db';
import { listMyTasks, type MaintenanceTask } from '../maintenance/maintenance.repository.js';
import {
  readOpenFaults,
  readOverdueSpaces,
  type OpenFault,
  type OverdueSpace,
} from '../dashboard/maintenance-band.repository.js';

/**
 * The maintenance home — POOLSE-90 slice 3. A to-do list, not a calendar, over
 * every site the reader works at (maintenance is assigned to no site, so that is
 * every live site — the dashboard's `ownFacilityIds` rule).
 *
 * **Nothing is re-derived here.** Due-ness is `listMyTasks`' (the four ordered
 * branches in `maintenance.repository.ts`), overdue cleaning is `OVERDUE` through
 * the band's own read, and the open issues are the band's read with reposições
 * added. The writes are the backoffice's own endpoints; this only gathers.
 */

export interface MaintenanceHome {
  /** Due or overdue, assigned to the reader or to nobody, worst first. */
  tasks: MaintenanceTask[];
  overdueSpaces: (OverdueSpace & { facilityName: string })[];
  issues: OpenFault[];
  /** Where an issue can be reported — every live, in-service space. */
  spaces: { id: string; name: string; facilityName: string }[];
  /** Where an analysis can be recorded. */
  pools: { id: string; name: string; facilityName: string }[];
}

export async function readMaintenanceHome(organizationId: string, membershipId: string): Promise<MaintenanceHome> {
  const { facilities, spaces, pools } = await withOrg(organizationId, async (tx) => {
    const facilities = (
      await tx.query<{ id: string; name: string }>(
        `SELECT id, name FROM facility WHERE archived_at IS NULL ORDER BY name, id`,
      )
    ).rows;
    const spaces = (
      await tx.query<{ id: string; name: string; facilityName: string }>(
        `SELECT s.id, s.name, f.name AS "facilityName"
           FROM space s
           JOIN facility f ON f.id = s.facility_id AND f.organization_id = s.organization_id AND f.archived_at IS NULL
          WHERE s.archived_at IS NULL AND s.active
          ORDER BY f.name, s.name, s.id`,
      )
    ).rows;
    const pools = (
      await tx.query<{ id: string; name: string; facilityName: string }>(
        `SELECT p.id, p.name, f.name AS "facilityName"
           FROM pool p
           JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id AND f.archived_at IS NULL
          WHERE p.archived_at IS NULL
          ORDER BY f.name, p.name, p.id`,
      )
    ).rows;
    return { facilities, spaces, pools };
  });

  const own = facilities.map((site) => site.id);
  const siteName = new Map(facilities.map((site) => [site.id, site.name]));
  const [tasks, overdue, issues] = await Promise.all([
    listMyTasks(organizationId, membershipId, true),
    readOverdueSpaces(organizationId, own, { limit: null }),
    readOpenFaults(organizationId, membershipId, own, { limit: null, restock: true }),
  ]);

  return {
    tasks: tasks.filter((task) => task.state === 'due' && siteName.has(task.facilityId)),
    overdueSpaces: overdue.spaces.map((space) => ({ ...space, facilityName: siteName.get(space.facilityId) ?? '' })),
    issues: issues.faults,
    spaces,
    pools,
  };
}
