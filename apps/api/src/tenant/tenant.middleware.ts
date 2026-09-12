import { ForbiddenException, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import * as Sentry from '@sentry/nestjs';
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

    // Two different 403s live in this API and a client cannot act on either
    // without being able to tell them apart: "you are in no organization" sends
    // someone to create one, "your role does not allow this" does not. The HTTP
    // status is the same for both, so the distinction is carried in a stable
    // `code` rather than in prose a translation would break.
    if (!membership) {
      throw new ForbiddenException({
        code: 'no_organization',
        message: requestedOrgId
          ? 'No active membership for this organization'
          : 'This account belongs to no organization',
      });
    }

    /*
     * A suspended tenant is closed — slice 3, and the single most dangerous
     * check in this file.
     *
     * Here rather than in `resolve_memberships`, because a suspended tenant that
     * simply stopped resolving would be indistinguishable from somebody who
     * belongs to no organization at all: the same 403, the same screen, and an
     * owner sent to create a second club rather than told why the first one is
     * shut. The membership resolves; the request does not proceed.
     *
     * **`/me` is unaffected**, and has to be: it is an identity-only route, so
     * this middleware never runs for it, which is what lets the web app draw a
     * screen saying what happened and quoting the reason. The platform area is
     * unaffected for the same reason, so an operator who suspended their own
     * tenant by mistake can still reach `/admin` to undo it.
     *
     * Its own code, like every other refusal in this API. `no_organization`
     * sends somebody to create one and `forbidden_role` sends them to an admin;
     * this one sends them to us, and the client has to tell the three apart.
     */
    if (membership.suspendedAt !== null) {
      throw new ForbiddenException({
        code: 'tenant_suspended',
        message: 'This organization is suspended',
        // The operator's own sentence, verbatim. The schema requires one
        // whenever a tenant is suspended, so this is never an empty banner.
        reason: membership.suspensionReason,
        suspendedAt: membership.suspendedAt,
      });
    }

    const context: TenantContext = {
      organizationId: membership.organizationId,
      membershipId: membership.membershipId,
      appUserId: membership.appUserId,
      roles: membership.roles,
    };

    /*
     * Which tenant an error belongs to — slice 2.
     *
     * Here rather than anywhere else because this is the moment the tenant
     * becomes known, and the isolation scope is per request, so the tag reaches
     * every event raised by the rest of this request and none raised by another.
     *
     * The *id*, never the name: a Sentry issue titled with a club's name is the
     * club's data in a third-party service. The operator can look the id up in
     * `/admin`. Safe to call with no DSN — every Sentry helper no-ops then.
     */
    Sentry.getIsolationScope().setTag('tenant_id', context.organizationId);

    tenantStorage.run(context, () => next());
  }
}
