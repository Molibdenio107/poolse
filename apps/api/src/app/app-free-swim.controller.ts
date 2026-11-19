import { Controller, Get, Header } from '@nestjs/common';
import { MEMBER_ROLES, requireRole } from '../tenant/roles.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { CoreRoute, moduleIsOn } from '../tenant/modules.js';
import { readFreeSwimSchedule, type FreeSwimSchedule } from './free-swim.repository.js';

/**
 * *Horário de nado livre* — POOLSE-237 (Rui, 19-11-2026).
 *
 * **Every member of the club**, refused in the first line for anybody else: it
 * is the club's own timetable and a headcount, nothing about a person. Free
 * swim is the `reception` module's; with it off the answer is no sites, the
 * way `/app/passes` answers, so the page simply shows nothing.
 */
@CoreRoute()
@Controller('app/free-swim')
export class AppFreeSwimController {
  @Get()
  @Header('Cache-Control', 'private, no-store')
  async read(): Promise<FreeSwimSchedule> {
    requireRole(...MEMBER_ROLES);
    const { organizationId } = currentTenant();
    if (!moduleIsOn('reception')) return { sites: [] };
    return readFreeSwimSchedule(organizationId);
  }
}
