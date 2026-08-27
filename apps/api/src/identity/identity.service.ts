import { Logger } from '@nestjs/common';
import { clerk } from '../auth/clerk.js';
import { findAppUser, provisionAppUser, type AppUserSummary } from './identity.repository.js';

const logger = new Logger('Identity');

/**
 * Returns the `app_user` for a Clerk identity, creating it from the Clerk API if
 * the webhook has not delivered yet.
 *
 * The webhook is the normal path and stays the normal path. This fallback exists
 * for two situations that are otherwise indistinguishable from a bug:
 *
 *   - The redirect after sign-up can reach the app before Clerk's `user.created`
 *     is delivered. Without this, a brand-new account sees an error on its very
 *     first screen and a refresh fixes it, which is the worst kind of flake.
 *   - Local development has no public URL for Clerk to call. Requiring a tunnel
 *     before anything works at all is a poor trade on an evening schedule.
 *
 * It is idempotent with the webhook: both call the same upsert, and the event
 * timestamp ordering in `provision_app_user` means whichever arrives second and
 * is older is discarded.
 */
export async function ensureAppUser(clerkUserId: string): Promise<AppUserSummary> {
  const existing = await findAppUser(clerkUserId);
  if (existing) return existing;

  logger.log(`No app_user for ${clerkUserId}; provisioning from the Clerk API`);

  const refreshed = await refreshFromClerk(clerkUserId);
  if (!refreshed) throw new Error(`Provisioned ${clerkUserId} but could not read it back`);
  return refreshed;
}

/**
 * Pulls the identity cache back into step with Clerk, now.
 *
 * The webhook is still the normal path, and this does not replace it — it uses
 * the same upsert with the same event-ordering guard, so the two cannot fight.
 * What it adds is a way to make the cache correct at a moment we choose, which
 * matters in exactly one place: straight after the profile screen writes a name
 * to Clerk.
 *
 * Without it, "save my name" would appear to do nothing on a laptop. Clerk cannot
 * reach localhost without a tunnel, so `user.updated` never arrives, so the cache
 * keeps the old name and every screen that lists people keeps showing it. On
 * staging the webhook would paper over it, which is worse — a bug that only
 * reproduces on the machine where it is hardest to debug.
 *
 * Returns null if Clerk has no such user, which is not this function's problem
 * to solve.
 */
export async function refreshFromClerk(clerkUserId: string): Promise<AppUserSummary | null> {
  const user = await clerk().users.getUser(clerkUserId);
  const primaryEmail =
    user.emailAddresses.find((address) => address.id === user.primaryEmailAddressId)
      ?.emailAddress ??
    user.emailAddresses[0]?.emailAddress ??
    null;

  await provisionAppUser({
    clerkUserId,
    email: primaryEmail,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: user.imageUrl,
    eventAt: new Date(user.updatedAt),
  });

  return findAppUser(clerkUserId);
}

/**
 * Writes a name to Clerk, which owns it, and then makes our cache agree.
 *
 * The order matters and is not interchangeable. Clerk first, because it is the
 * source of truth and a failure there must leave nothing changed anywhere. The
 * cache second, and only by re-reading what Clerk now holds — never by writing
 * the submitted values into `cached_first_name` directly. Those two paths look
 * identical the day you write them and diverge the first time Clerk normalises
 * something, or the write partially fails, or a webhook for an older event
 * arrives late.
 */
export async function updateClerkName(
  clerkUserId: string,
  firstName: string | null,
  lastName: string | null,
): Promise<AppUserSummary | null> {
  await clerk().users.updateUser(clerkUserId, {
    firstName: firstName ?? '',
    lastName: lastName ?? '',
  });

  return refreshFromClerk(clerkUserId);
}
