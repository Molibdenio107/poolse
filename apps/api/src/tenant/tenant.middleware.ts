import { ForbiddenException, Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { withoutTenantScope } from '@poolse/db';
import { tenantStorage, type TenantContext } from './tenant.context.js';

/**
 * Resolves the tenant for every request and installs it into AsyncLocalStorage.
 *
 * The important rule here: the organization is NOT taken from the request body,
 * a query parameter or a client-supplied header — it is derived from the verified
 * session, then confirmed against a live membership row. A client that can name
 * its own tenant has no tenant isolation at all, however good the RLS policies are.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const clerkUserId = getVerifiedClerkUserId(req);
    if (!clerkUserId) throw new UnauthorizedException();

    // Which organization, when a person belongs to several. The header is a
    // *request* for an org, never an assertion of one — the membership lookup
    // below is what actually grants it.
    const requestedOrgId = req.header('x-poolse-organization');

    const context = await resolveMembership(clerkUserId, requestedOrgId);
    if (!context) throw new ForbiddenException('No active membership for this organization');

    tenantStorage.run(context, () => next());
  }
}

/**
 * Placeholder for slice 0.4. Replace with Clerk's verified session claims —
 * `clerkClient.verifyToken` or the Express middleware, whichever the SDK version
 * favours. Deliberately throws rather than returning a fake user, so an
 * unfinished auth wiring fails loudly instead of authorising everyone.
 */
function getVerifiedClerkUserId(_req: Request): string | null {
  throw new Error('TODO slice 0.4: verify the Clerk session and return its user id');
}

async function resolveMembership(
  clerkUserId: string,
  requestedOrgId: string | undefined,
): Promise<TenantContext | null> {
  // Runs unscoped by necessity: we are working out which tenant applies, so there
  // is no tenant to scope to yet. This is the reason withoutTenantScope exists,
  // and close to the only legitimate use of it in a request path.
  return withoutTenantScope(async (tx) => {
    const { rows } = await tx.query<{
      organization_id: string;
      membership_id: string;
      app_user_id: string;
      roles: string[];
    }>(
      `
      SELECT m.organization_id,
             m.id   AS membership_id,
             u.id   AS app_user_id,
             coalesce(
               array_agg(mr.role::text) FILTER (WHERE mr.archived_at IS NULL),
               '{}'
             ) AS roles
        FROM app_user u
        JOIN membership m       ON m.app_user_id = u.id
                               AND m.archived_at IS NULL
                               AND m.status = 'active'
   LEFT JOIN membership_role mr ON mr.membership_id = m.id
       WHERE u.clerk_user_id = $1
         AND ($2::uuid IS NULL OR m.organization_id = $2::uuid)
    GROUP BY m.organization_id, m.id, u.id
    ORDER BY m.created_at
       LIMIT 1
      `,
      [clerkUserId, requestedOrgId ?? null],
    );

    const row = rows[0];
    if (!row) return null;

    return {
      organizationId: row.organization_id,
      membershipId: row.membership_id,
      appUserId: row.app_user_id,
      roles: row.roles,
    };
  });
}
