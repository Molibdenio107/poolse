import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, seconds, type ThrottlerModuleOptions } from '@nestjs/throttler';
import type { Request } from 'express';
import { authStorage } from '../auth/auth.context.js';

/**
 * Request limits — the ceiling that was missing.
 *
 * Every endpoint in this API was unbounded. Nothing here is a *vulnerability* in
 * the sense of a way in: the routes are authenticated, the queries are
 * parameterised and RLS scopes them. It is the other half — a signed-in account
 * could walk a tenant's whole register one page at a time as fast as the network
 * allowed, and the weather proxy would happily spend our Open-Meteo quota on
 * whoever asked most often. A ceiling turns "as fast as the network allows" into
 * something a person could not do without being noticed.
 *
 * **Two limits, not one.** A generous ceiling for ordinary use, and a much
 * lower one for the handful of routes where a request is an *attempt* at
 * something — redeeming an invitation token, above all.
 *
 * The second one is applied per route with `@Throttle`, not registered here
 * beside the first. Every throttler in this array is enforced on *every* route,
 * so a "strict" entry sitting next to the default would quietly cap the whole
 * API at ten requests a minute — the grid would stop loading on the second drag
 * and it would look like a network fault.
 *
 * **What this does not cover, deliberately.** Nest runs middleware before
 * guards, so a flood of requests carrying a *bad* token is refused by
 * ClerkAuthMiddleware before this guard ever sees it — those requests are
 * rejected, but they are not counted. That is the right trade at this size:
 * Clerk verifies a token against a cached JWKS without a network call, so the
 * cost of refusing one is small and bounded, and the platform edge is where a
 * volumetric flood is supposed to stop. What this guard is for is the case the
 * edge cannot see — a legitimately signed-in account walking a tenant's whole
 * register, or spending the Open-Meteo quota. If unauthenticated floods ever
 * become a real problem, the fix is a throttle *middleware* registered ahead of
 * ClerkAuthMiddleware, not a change here.
 */

/**
 * The ordinary ceiling: 300 requests a minute.
 *
 * Sized from what the app actually does rather than from a round number. The
 * heaviest real page is the scheduling grid, which fires roughly a dozen
 * requests as it opens and a few more per drag; an operator working quickly for
 * a full minute lands somewhere near fifty. Three hundred leaves a wide margin
 * over the worst honest minute and still refuses a script.
 *
 * If this ever starts firing on real use, the answer is to look at what is
 * making the requests before raising the number — an infinite render loop
 * reaches it long before a person does.
 */
export const DEFAULT_LIMIT = 300;

/**
 * The strict ceiling: 10 attempts a minute, for routes where a request is a
 * guess.
 *
 * Invitation redemption is the one that matters. The token is 32 random bytes
 * and is not going to be guessed at any rate — but "the secret is long enough"
 * is a reason not to worry, not a reason to leave the door swinging. Ten a
 * minute is more than any person redeeming an invitation will ever need and
 * removes online guessing as a thing anybody has to reason about.
 */
export const STRICT_LIMIT = 10;

export const throttlerOptions: ThrottlerModuleOptions = {
  throttlers: [{ name: 'default', ttl: seconds(60), limit: DEFAULT_LIMIT }],
};

/**
 * The strict ceiling, ready to hang on a handler:
 *
 *     @Throttle(STRICT)
 *     @Post(':token')
 *     async redeem(...) {}
 *
 * It overrides the default for that route rather than adding a second limit on
 * top of it, which is what the `default` key means here — the name of the
 * throttler being overridden, not "the ordinary limit".
 */
export const STRICT = { default: { ttl: seconds(60), limit: STRICT_LIMIT } };

/**
 * What counts as "the same caller".
 *
 * **This is the part that matters, more than either number.** The stock guard
 * keys on the IP address, and for this product that is close to the worst
 * possible choice: a municipal pool's staff sit behind one office NAT, so the
 * fourth person to open the grid after lunch would be throttled by the first
 * three. Worse, the API runs behind a platform proxy — Railway, Fly, Vercel —
 * where every request arrives from the proxy's address, so *one* bucket would
 * be shared by every customer we have and one busy tenant would lock out the
 * rest.
 *
 * So the key is the authenticated Clerk user when there is one, and the IP only
 * for the handful of routes that run before a session exists. One person's
 * enthusiasm cannot then cost their colleague anything, and the limit means what
 * it says.
 *
 * `main.ts` sets `trust proxy` so the IP half is the real client address rather
 * than the proxy's, which is what makes the fallback worth having at all.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(request: Request): Promise<string> {
    const clerkUserId = authStorage.getStore()?.clerkUserId;
    if (clerkUserId) return `user:${clerkUserId}`;

    // Public routes only: health, and the Clerk webhook. The webhook is verified
    // by signature rather than by session, so an unsigned flood is refused
    // before it reaches anything expensive — but it still gets a bucket.
    return `ip:${request.ip ?? 'unknown'}`;
  }

  /**
   * The platform's own health check is not a caller.
   *
   * Railway and Fly poll `/health` continuously to decide whether the instance
   * is alive. Throttling that would take a healthy instance out of the load
   * balancer under exactly the load it was meant to survive — the failure mode
   * where a rate limiter turns a busy afternoon into an outage.
   */
  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    return request.path === '/health' || request.path === '/health/';
  }
}
