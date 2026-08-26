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

  const created = await findAppUser(clerkUserId);
  if (!created) throw new Error(`Provisioned ${clerkUserId} but could not read it back`);
  return created;
}
