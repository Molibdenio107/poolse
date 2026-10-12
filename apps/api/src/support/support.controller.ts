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
  RequestNotPendingError,
  approveRequest,
  declineRequest,
  listGrants,
  openGrant,
  pendingRequests,
  revokeGrant,
  supportStatus,
  type GrantHours,
  type SupportGrant,
  type SupportRequest,
} from './support.repository.js';

function readHours(body: { hours?: unknown } | undefined): GrantHours {
  const hours = Number(body?.hours);
  if (!GRANT_HOURS.includes(hours as GrantHours)) {
    throw new BadRequestException({ message: 'support.badHours', allowed: [...GRANT_HOURS] });
  }
  return hours as GrantHours;
}

function liveConflict(error: GrantAlreadyLiveError): ConflictException {
  return new ConflictException({
    code: 'grant_live',
    message: 'A support window is already open',
    expiresAt: error.expiresAt,
  });
}

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
    const hours = readHours(body);

    const { organizationId, membershipId } = currentTenant();
    try {
      return { grant: await openGrant(organizationId, membershipId, hours) };
    } catch (error) {
      if (error instanceof GrantAlreadyLiveError) throw liveConflict(error);
      throw error;
    }
  }

  /**
   * The club's own strip: is support in, until when, and has it asked. The
   * Owner and the Admins read it, because an Admin who sees an unfamiliar name
   * in the log should be able to tell it is Poolse.
   */
  @Get('status')
  async status(): Promise<Awaited<ReturnType<typeof supportStatus>>> {
    requireRole('owner', 'admin');
    return supportStatus(currentTenant().organizationId);
  }

  @Get('requests')
  async requests(): Promise<{ requests: SupportRequest[] }> {
    requireRole('owner');
    return { requests: await pendingRequests(currentTenant().organizationId) };
  }

  @Post('requests/:id/approve')
  async approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { hours?: unknown },
  ): Promise<{ grant: SupportGrant }> {
    requireRole('owner');
    const hours = readHours(body);
    const { organizationId, membershipId } = currentTenant();
    try {
      return { grant: await approveRequest(organizationId, membershipId, id, hours) };
    } catch (error) {
      if (error instanceof GrantAlreadyLiveError) throw liveConflict(error);
      if (error instanceof RequestNotPendingError) {
        throw new NotFoundException({ message: 'support.noPendingRequest' });
      }
      throw error;
    }
  }

  @Post('requests/:id/decline')
  async decline(@Param('id', new ParseUUIDPipe()) id: string): Promise<{ declined: true }> {
    requireRole('owner');
    const { organizationId, membershipId } = currentTenant();
    if (!(await declineRequest(organizationId, membershipId, id))) {
      throw new NotFoundException({ message: 'support.noPendingRequest' });
    }
    return { declined: true };
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
