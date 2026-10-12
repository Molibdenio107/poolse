import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireRole } from '../tenant/roles.js';
import {
  GRANT_HOURS,
  GrantAlreadyLiveError,
  listGrants,
  openGrant,
  revokeGrant,
  type GrantHours,
  type SupportGrant,
} from './support.repository.js';

/**
 * Acesso de suporte — POOLSE-79.
 *
 * **Owner only.** It is the club's decision about its own data, and an Admin is
 * not the controller. That includes a support session itself, which is an
 * Admin: support cannot extend its own window.
 */
@Controller('support-grants')
export class SupportGrantsController {
  @Get()
  async list(): Promise<{ grants: SupportGrant[] }> {
    requireRole('owner');
    return { grants: await listGrants(currentTenant().organizationId) };
  }

  @Post()
  async open(@Body() body: { hours?: unknown }): Promise<{ grant: SupportGrant }> {
    requireRole('owner');
    const hours = Number(body?.hours);
    if (!GRANT_HOURS.includes(hours as GrantHours)) {
      throw new BadRequestException({ message: 'support.badHours', allowed: [...GRANT_HOURS] });
    }

    const { organizationId, membershipId } = currentTenant();
    try {
      return { grant: await openGrant(organizationId, membershipId, hours as GrantHours) };
    } catch (error) {
      if (error instanceof GrantAlreadyLiveError) {
        throw new ConflictException({
          code: 'grant_live',
          message: 'A support window is already open',
          expiresAt: error.expiresAt,
        });
      }
      throw error;
    }
  }

  @Post(':id/revoke')
  async revoke(@Param('id', new ParseUUIDPipe()) id: string): Promise<{ revoked: true }> {
    requireRole('owner');
    if (!(await revokeGrant(currentTenant().organizationId, id))) {
      throw new NotFoundException({ message: 'support.noLiveGrant' });
    }
    return { revoked: true };
  }
}
