import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PUBLIC_WATER } from '../common/throttle.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireRole } from '../tenant/roles.js';
import {
  getPublicLink,
  issuePublicLink,
  NoSuchPoolError,
  readPublicWaterPage,
  revokePublicLink,
  type PublicLink,
  type PublicWaterPage,
} from './public-link.repository.js';

/**
 * Who may put a tank's readings on the wall — POOLSE-71.
 *
 * The roles that may record an analysis: the people who look after the water
 * decide whether its readings are public. Not instructors.
 */
const CAN_PUBLISH = ['owner', 'admin', 'maintenance'] as const;

function notFoundOnMissingPool(error: unknown): never {
  if (error instanceof NoSuchPoolError) throw new NotFoundException();
  throw error;
}

/** The tenant half: turn a tank's public page on, replace its link, switch it off. */
@Controller('pools/:poolId/public-link')
export class PoolPublicLinkController {
  @Get()
  async get(@Param('poolId', new ParseUUIDPipe()) poolId: string): Promise<PublicLink> {
    requireRole(...CAN_PUBLISH);
    return getPublicLink(currentTenant().organizationId, poolId).catch(notFoundOnMissingPool);
  }

  /** `{ replace: true }` kills the live link and issues a new one; otherwise idempotent. */
  @Post()
  async issue(
    @Param('poolId', new ParseUUIDPipe()) poolId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<PublicLink> {
    requireRole(...CAN_PUBLISH);
    const { organizationId, membershipId } = currentTenant();
    return issuePublicLink(
      organizationId,
      membershipId ?? null,
      poolId,
      body['replace'] === true,
    ).catch(notFoundOnMissingPool);
  }

  @Delete()
  async revoke(@Param('poolId', new ParseUUIDPipe()) poolId: string): Promise<{ ok: true }> {
    requireRole(...CAN_PUBLISH);
    await revokePublicLink(currentTenant().organizationId, poolId).catch(notFoundOnMissingPool);
    return { ok: true };
  }
}

/**
 * The public half — no session, no tenant.
 *
 * In `PUBLIC_ROUTES`, so neither Clerk nor the tenant middleware runs. Every
 * kind of miss — an unknown token, a revoked one, a tank switched off, a club
 * closed — is the same 404 with the same body: a page that said "this link was
 * revoked" would tell a stranger the token once existed.
 */
@Controller('public/water')
export class PublicWaterController {
  @Get(':token')
  @Throttle(PUBLIC_WATER)
  async page(@Param('token') token: string): Promise<PublicWaterPage> {
    const page = await readPublicWaterPage(token);
    if (page === null) throw new NotFoundException();
    return page;
  }
}
