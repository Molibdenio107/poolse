import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { currentAuth } from '../auth/auth.context.js';
import { PLATFORM } from '../common/throttle.js';
import { PlatformAction, PlatformAuditInterceptor } from './platform-audit.interceptor.js';
import { PlatformAdminGuard } from './platform.guard.js';
import {
  SupportAskRefused,
  SupportSessionRefused,
  listOpenGrants,
  overrideAccess,
  requestAccess,
  supportSession,
  tenantSupport,
  type OpenSupportGrant,
  type TenantSupport,
} from './support.repository.js';

/**
 * Support access, the operator's side — POOLSE-79.
 *
 * Behind the same guard, throttle and audit interceptor as the rest of
 * `/platform`. Entering and leaving are recorded by `support_session` itself,
 * in the same transaction, on both trails — the reads are what the interceptor
 * logs, as it does everywhere here.
 */
@Controller('platform/support')
@Throttle(PLATFORM)
@UseGuards(PlatformAdminGuard)
@UseInterceptors(PlatformAuditInterceptor)
export class PlatformSupportController {
  @Get()
  @PlatformAction('support.listed')
  async open(): Promise<{ grants: OpenSupportGrant[] }> {
    return { grants: await listOpenGrants() };
  }

  @Get('tenants/:id')
  @PlatformAction('support.tenant.read')
  async tenant(@Param('id', new ParseUUIDPipe()) id: string): Promise<TenantSupport> {
    return tenantSupport(id);
  }

  /** *Pedir acesso* — asks the Owner; opens nothing by itself. */
  @Post('tenants/:id/request')
  async request(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { reason?: unknown },
  ): Promise<{ requestId: string }> {
    return asked(() => requestAccess(currentAuth().clerkUserId, id, body?.reason));
  }

  /** *Acesso de emergência* — a reason, the club's name typed back, 4 hours. */
  @Post('tenants/:id/override')
  async override(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { reason?: unknown; confirmName?: unknown },
  ): Promise<{ grantId: string; expiresAt: string }> {
    const confirmName = typeof body?.confirmName === 'string' ? body.confirmName : undefined;
    return asked(() => overrideAccess(currentAuth().clerkUserId, id, body?.reason, confirmName));
  }

  @Post(':grantId/enter')
  async enter(
    @Param('grantId', new ParseUUIDPipe()) grantId: string,
  ): Promise<{ membershipId: string; organizationId: string }> {
    return session(grantId, 'enter');
  }

  @Post(':grantId/leave')
  async leave(
    @Param('grantId', new ParseUUIDPipe()) grantId: string,
  ): Promise<{ membershipId: string; organizationId: string }> {
    return session(grantId, 'leave');
  }
}

async function asked<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!(error instanceof SupportAskRefused)) throw error;
    switch (error.reason) {
      case 'not_platform_admin':
        throw new ForbiddenException({ code: 'not_platform_admin', message: 'Not a platform admin' });
      case 'no_such_tenant':
        throw new NotFoundException({ message: 'No such tenant' });
      case 'reason_required':
        throw new BadRequestException({ fields: { reason: 'admin.support.reasonRequired' } });
      case 'name_mismatch':
        throw new BadRequestException({ fields: { confirmName: 'admin.error.nameMismatch' } });
      case 'request_pending':
        throw new ConflictException({ code: 'request_pending', message: 'A request is already waiting' });
      case 'grant_live':
        throw new ConflictException({ code: 'grant_live', message: 'A support window is already open' });
    }
  }
}

async function session(
  grantId: string,
  action: 'enter' | 'leave',
): Promise<{ membershipId: string; organizationId: string }> {
  try {
    return await supportSession(currentAuth().clerkUserId, grantId, action);
  } catch (error) {
    if (!(error instanceof SupportSessionRefused)) throw error;
    switch (error.reason) {
      case 'not_platform_admin':
        throw new ForbiddenException({ code: 'not_platform_admin', message: 'Not a platform admin' });
      case 'already_member':
        throw new ConflictException({ code: 'already_member', message: 'Already a member of this club' });
      case 'grant_not_live':
        throw new NotFoundException({ code: 'grant_not_live', message: 'No live support grant' });
      case 'not_entered':
        throw new NotFoundException({ code: 'not_entered', message: 'Not in this support session' });
    }
  }
}
