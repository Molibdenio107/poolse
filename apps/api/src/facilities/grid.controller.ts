import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireRole } from '../tenant/roles.js';
import { readGrid, type Grid } from './grid.repository.js';
import { CoreRoute } from '../tenant/modules.js';

/**
 * The lane grid, read — POOLSE-49.
 *
 * **Open to any member, and that is the point of the screen.** The grid is the
 * sheet the club pins to the wall: an instructor needs to see that lane 3 is a
 * school on Tuesday morning, and a maintenance colleague needs to see when the
 * tank is free. Writing to it is POOLSE-50's problem and carries its own role
 * check; nothing here changes anything.
 *
 * `canManage` rides along so the screen can decide whether to render the drag
 * affordances at all. That is a UX detail and never the control — the endpoints
 * that mutate enforce it themselves.
 */
@CoreRoute()
@Controller('facilities/:facilityId/grid')
export class GridController {
  @Get()
  async read(
    @Param('facilityId') facilityId: string,
    @Query('seasonId') seasonId?: string,
  ): Promise<Grid & { canManage: boolean }> {
    // Security review, 12 October 2026: this answered any member, a guardian included.
    requireRole('owner', 'admin', 'instructor', 'maintenance');
    const { organizationId } = currentTenant();

    const grid = await readGrid(organizationId, facilityId, readOptionalId(seasonId));
    if (grid === null) throw new NotFoundException('No such site');

    return { ...grid, canManage: hasRole('owner', 'admin') };
  }
}

/** An absent or blank query parameter means "the published season", not "". */
function readOptionalId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value === '' ? null : value;
}
