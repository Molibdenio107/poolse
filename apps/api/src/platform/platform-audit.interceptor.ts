import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { withPlatform } from '@poolse/db';
import { Observable, tap } from 'rxjs';
import { currentAuth } from '../auth/auth.context.js';

const PLATFORM_ACTION = 'platform:action';

/**
 * Names what a platform endpoint does, in the dotted style `audit_log` uses:
 * `tenants.listed`, `tenant.read`.
 *
 * Optional. An endpoint without one is still logged, under its method and path —
 * the trail should be complete because nobody had to remember, and a decorator
 * somebody forgot should cost legibility rather than coverage.
 */
export const PlatformAction = (action: string): MethodDecorator =>
  SetMetadata(PLATFORM_ACTION, action);

/**
 * One line per platform request, reads included.
 *
 * **Reads, from the first day.** There is nothing to *do* on this side of the
 * product yet — slice 1 is a table and nothing else — and logging a read costs a
 * single insert on a screen one person opens. The habit has to exist before the
 * actions do: a trail that begins the day somebody can suspend a tenant begins
 * one day too late, and nobody adds it retroactively.
 *
 * **The request, never the response.** The search term and the page number say
 * what was asked for, which is the question an audit answers. Writing back what
 * came out would put a second copy of every tenant's figures in a table nobody
 * is watching.
 *
 * Logged after the handler settles, success or failure, so the row records what
 * actually happened rather than what was attempted. A refusal by
 * `PlatformAdminGuard` never reaches here — guards run first — which is why that
 * guard writes its own.
 *
 * Its own transaction, not the handler's, and deliberately swallowing its own
 * errors: unlike `recordAudit`, which must fail the mutation it describes
 * because a change nobody can account for is worse than no change, this
 * describes a *read*. Turning a working screen into a 500 because a log insert
 * lost a race would be the wrong trade in every direction.
 */
@Injectable()
export class PlatformAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(PlatformAuditInterceptor.name);

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();

    const action =
      this.reflector.get<string | undefined>(PLATFORM_ACTION, context.getHandler()) ??
      `${request.method.toLowerCase()}.${request.route?.path ?? request.path}`;

    const { clerkUserId } = currentAuth();

    /*
     * Which tenant this was about, when the route names one. Read from the route
     * parameter rather than from the body, and only when it parses as a uuid —
     * the column is a uuid with a foreign key, so a malformed path segment would
     * otherwise turn a clean 404 into a failed insert.
     */
    const routeId: unknown = request.params['id'];
    const organizationId = typeof routeId === 'string' && isUuid(routeId) ? routeId : null;

    const detail = {
      query: request.query,
      ...(request.route?.path === undefined ? {} : { route: request.route.path }),
    };

    const record = (outcome: 'ok' | 'error'): void => {
      void withPlatform(async (tx) => {
        await tx.query(
          `INSERT INTO platform_audit_log (clerk_user_id, action, organization_id, detail)
                VALUES ($1, $2, $3, $4::jsonb)`,
          [clerkUserId, action, organizationId, JSON.stringify({ ...detail, outcome })],
        );
      }).catch((error: unknown) => {
        this.logger.error(
          `Could not record platform action "${action}": ` +
            (error instanceof Error ? error.message : String(error)),
        );
      });
    };

    return next
      .handle()
      .pipe(tap({ next: () => record('ok'), error: () => record('error') }));
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
