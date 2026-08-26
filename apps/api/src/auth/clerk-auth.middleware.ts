import { Injectable, Logger, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { authStorage } from './auth.context.js';
import { bearerToken, verifySessionToken } from './clerk.js';

/**
 * Establishes *who* is calling, and nothing else.
 *
 * Runs before TenantMiddleware and covers a wider set of routes: `GET /me` needs
 * an identity but has no tenant yet, because a person who has just signed up has
 * no membership until someone invites them (slice 0.5).
 */
@Injectable()
export class ClerkAuthMiddleware implements NestMiddleware {
  private readonly logger = new Logger(ClerkAuthMiddleware.name);

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const token = bearerToken(req.header('authorization'));
    if (!token) throw new UnauthorizedException('Missing bearer token');

    let session;
    try {
      session = await verifySessionToken(token);
    } catch (error) {
      // The reason is logged but not returned: "expired" versus "signature does
      // not match" is useful in a log and is free information to an attacker.
      this.logger.debug(
        `Rejected session token: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new UnauthorizedException('Invalid or expired session token');
    }

    authStorage.run(session, () => next());
  }
}
