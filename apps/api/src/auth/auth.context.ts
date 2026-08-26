import { AsyncLocalStorage } from 'node:async_hooks';

export interface AuthContext {
  /** Clerk's user id (the JWT subject). The only identity claim we trust. */
  clerkUserId: string;
  /** Clerk session id, for audit entries later. Null if the token omits `sid`. */
  sessionId: string | null;
}

/**
 * Who is calling, separate from which tenant they are calling as.
 *
 * Two storages rather than one because the two questions have different answers
 * at different moments: `GET /me` runs with an identity and no tenant, and the
 * Clerk webhook runs with neither. Folding them together would force every
 * identity-only route to invent a fake organization.
 */
export const authStorage = new AsyncLocalStorage<AuthContext>();

export function currentAuth(): AuthContext {
  const context = authStorage.getStore();
  if (!context) {
    // Reaching here means a handler ran outside the auth middleware — a route
    // excluded from it that should not have been.
    throw new Error('No auth context: this code path ran outside an authenticated request');
  }
  return context;
}
