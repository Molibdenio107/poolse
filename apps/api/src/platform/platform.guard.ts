import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { platformConfigured, withPlatform } from '@poolse/db';
import { currentAuth } from '../auth/auth.context.js';

/**
 * The only thing standing between a signed-in person and every tenant's numbers.
 *
 * **Platform administration is not a tenant role.** `member_role` says what
 * somebody may do inside one club; this says whether they may look at all of
 * them. Nothing in `membership_role` grants it, `requireRole` cannot express it,
 * and being owner of an organization — including a demo one anybody can create
 * in thirty seconds — grants exactly nothing here. That separation is the whole
 * design, and it is why the check reads `currentAuth()` rather than
 * `currentTenant()`: this guard has to work for an operator who belongs to no
 * organization at all.
 *
 * **Applied to the module, not to a method.** A `/platform` endpoint added next
 * month is covered because nobody had to remember it — the same default-deny
 * shape as `ClerkAuthMiddleware` and for the same reason. There is no decorator
 * to opt out with.
 *
 * **No cache.** One round trip per request, against a table with a unique index
 * on the key, for a screen one person opens. Caching would buy nothing
 * measurable and would cost the property that revoking access takes effect on
 * the next request rather than on the next restart.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  private readonly logger = new Logger(PlatformAdminGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    /*
     * Not configured is a different answer from not allowed, and a developer
     * deserves to be told which. 503 with a `code` rather than 403: nothing the
     * caller does will fix it, and a "forbidden" here would send somebody
     * hunting for a permission that is not the problem.
     */
    if (!platformConfigured()) {
      throw new ServiceUnavailableException({
        code: 'platform_not_configured',
        message:
          'The platform admin area has no database connection. Set DATABASE_PLATFORM_URL ' +
          'and run `pnpm db:bootstrap` — see docs/features/platform.md.',
      });
    }

    const { clerkUserId } = currentAuth();

    const allowed = await withPlatform(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM platform_admin
          WHERE clerk_user_id = $1 AND archived_at IS NULL`,
        [clerkUserId],
      );
      if (rows.length > 0) return true;

      /*
       * A refusal is recorded here rather than by the interceptor, because a
       * guard runs before every interceptor in Nest — so a 403 would otherwise
       * be the one thing that reached the platform area and left no trace, which
       * is precisely the request worth having a trace of.
       *
       * In the same transaction as the check that produced it, and the insert
       * cannot fail the way `recordRefusedAttempt` guards against: the refusal
       * is the outcome, so there is no clean response for a failed write to turn
       * into a 500.
       */
      await tx.query(
        `INSERT INTO platform_audit_log (clerk_user_id, action, detail)
              VALUES ($1, 'platform.denied', $2::jsonb)`,
        [
          clerkUserId,
          JSON.stringify({
            path: context.switchToHttp().getRequest<{ originalUrl?: string }>().originalUrl ?? null,
          }),
        ],
      );

      return false;
    });

    if (!allowed) {
      this.logger.warn(`Refused platform access to ${clerkUserId}`);
      /*
       * Its own code, distinct from `forbidden_role` and `no_organization`.
       * Those two send somebody somewhere — to an admin, or to create an
       * organization. This one sends them nowhere, and the client needs to tell
       * them apart to know that.
       */
      throw new ForbiddenException({
        code: 'not_platform_admin',
        message: 'This area is for Poolse platform administrators',
      });
    }

    return true;
  }
}
