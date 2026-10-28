import { Controller, Get } from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireRole } from '../tenant/roles.js';
import { CoreRoute, moduleIsOn } from '../tenant/modules.js';
import { NOTHING, readAttention, type Attention } from './attention.repository.js';

/**
 * The circles — POOLSE-120. Asked by the layout for everybody, so a role with
 * nothing to act on gets an empty map rather than a 403: no circle is not a
 * refusal. **Only who can act is counted** (Rui, 28-10-2026): water and
 * maintenance for owner, admin and maintenance; pre-registrations for owner
 * and admin; families' answers for the teacher of the lesson, and every lesson
 * for the office — each in a module that is on.
 */
@CoreRoute()
@Controller('attention')
export class AttentionController {
  @Get()
  async read(): Promise<Attention> {
    requireRole('owner', 'admin', 'instructor', 'maintenance', 'student', 'guardian');
    const { organizationId, membershipId, support } = currentTenant();
    const office = hasRole('owner', 'admin');
    const upkeep = office || hasRole('maintenance');
    const scope = {
      leads: office,
      water: upkeep && moduleIsOn('water_quality'),
      maintenance: upkeep && moduleIsOn('maintenance'),
      families: office ? ('all' as const) : hasRole('instructor') ? ('mine' as const) : null,
      membershipId,
    };
    if (!scope.leads && !scope.water && !scope.maintenance && scope.families === null) return NOTHING;
    // A support session sees the club as an admin would, but is nobody's teacher.
    if (support === true && scope.families === 'mine') scope.families = null;
    return readAttention(organizationId, scope);
  }
}
