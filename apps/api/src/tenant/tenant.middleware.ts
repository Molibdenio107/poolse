import { ForbiddenException, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { currentAuth } from '../auth/auth.context.js';
import { listMemberships } from '../identity/identity.repository.js';
import { tenantStorage, type TenantContext } from './tenant.context.js';

/**
 * Resolves the tenant for every request and installs it into AsyncLocalStorage.
 *
 * The important rule here: the organization is NOT taken from the request body,
 * a query parameter or a client-supplied header — it is derived from the verified
 * session (ClerkAuthMiddleware, which has already run), then confirmed against a
 * live membership row. A client that can name its own tenant has no tenant
 * isolation at all, however good the RLS policies are.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const { clerkUserId } = currentAuth();

    // Which organization, when a person belongs to several. The header is a
    // *request* for an org, never an assertion of one — the membership lookup
    // below is what actually grants it.
    const requestedOrgId = req.header('x-poolse-organization');

    const memberships = await listMemberships(clerkUserId);
    const membership = requestedOrgId
      ? memberships.find((candidate) => candidate.organizationId === requestedOrgId)
      : memberships[0];

    if (!membership) {
      throw new ForbiddenException(
        requestedOrgId
          ? 'No active membership for this organization'
          : 'This account belongs to no organization',
      );
    }

    const context: TenantContext = {
      organizationId: membership.organizationId,
      membershipId: membership.membershipId,
      appUserId: membership.appUserId,
      roles: membership.roles,
    };

    tenantStorage.run(context, () => next());
  }
}
