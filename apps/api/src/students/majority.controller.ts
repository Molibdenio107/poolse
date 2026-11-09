import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireRole } from '../tenant/roles.js';
import { CoreRoute } from '../tenant/modules.js';
import {
  listTurnedOfAge,
  MAJORITY_ACTIONS,
  removeAcompanhante,
  reviewMajority,
  type MajorityAction,
  type TurnedOfAge,
} from './majority.repository.js';

/**
 * *Fez 18 anos* — POOLSE-207. The office's list of students who came of age
 * with a parent's link, and what it does about each. Owner and admin only: it
 * is the club's decision about a family, as every guardian edit is.
 */
@CoreRoute()
@Controller('students')
export class MajorityController {
  @Get('turned-18')
  async list(): Promise<{ students: TurnedOfAge[] }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();
    return { students: await listTurnedOfAge(organizationId) };
  }

  /**
   * One row acted on. `invited` is recorded after the existing student
   * invitation has gone (the web calls that route first): this never sends.
   */
  @Post(':studentId/majority-review')
  async review(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ reviewed: true }> {
    requireRole('owner', 'admin');
    const { organizationId, membershipId } = currentTenant();
    const action = body['action'];
    if (typeof action !== 'string' || !(MAJORITY_ACTIONS as readonly string[]).includes(action)) {
      throw new BadRequestException({ code: 'bad_action', message: 'action is confirmed, accompanying or invited' });
    }
    const outcome = await reviewMajority(organizationId, membershipId, studentId, action as MajorityAction);
    // Another club's student, a student not pending, and nobody: the same 404.
    if (outcome === 'not_pending') throw new NotFoundException('No such student to review');
    return { reviewed: true };
  }

  /** *Retirar acompanhante* — rule 3. Asks first on the screen; here it only archives. */
  @Post(':studentId/guardians/:linkId/remove-acompanhante')
  async removeAcompanhante(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
  ): Promise<{ removed: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();
    if ((await removeAcompanhante(organizationId, studentId, linkId)) === 'not_found') {
      throw new NotFoundException('No such acompanhante');
    }
    return { removed: true };
  }
}
