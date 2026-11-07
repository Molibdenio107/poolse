import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  /** The organization every query in this request is scoped to. */
  organizationId: string;
  /** The membership acting — roles are read from it, never from the JWT. */
  membershipId: string;
  appUserId: string;
  roles: readonly string[];
  /**
   * A Poolse support session (POOLSE-79). Its admin role came from a grant, and
   * it must not mint access that outlives that grant.
   */
  support?: boolean;
  /**
   * The modules this club has switched off (POOLSE-87), read by `ModuleGuard`.
   * Absent is the full product, which is what a background job's context means.
   */
  disabledModules?: readonly string[];
  /**
   * The sports this person belongs to (POOLSE-145), read by `requireSport`.
   * Absent is every sport, which is what a background job's context means.
   */
  mySports?: readonly string[];
  /** The sports this club has on — what `mySports` is compared with (`sportScope`). */
  clubSports?: readonly string[];
  /**
   * A live view — POOLSE-188. While it lasts `membershipId`, `appUserId`, `roles`
   * and `mySports` above are **the person viewed**, so every read answers as they
   * would and a read that forgets the view can only answer as them, never as the
   * owner. `actor` is who is really there, and `recordAudit` is the one reader of it.
   */
  viewing?: { id: string; hat: string };
  actor?: { membershipId: string; appUserId: string };
}

/**
 * Request-scoped tenant context.
 *
 * AsyncLocalStorage rather than a Nest request-scoped provider: request scoping
 * in Nest forces the whole injection chain to become request-scoped, which is
 * easy to break accidentally by injecting one singleton in the wrong place. This
 * cannot be bypassed by accident.
 */
export const tenantStorage = new AsyncLocalStorage<TenantContext>();

export function currentTenant(): TenantContext {
  const context = tenantStorage.getStore();
  if (!context) {
    // Reaching here means a handler ran outside the tenant middleware — either a
    // route that should be public and isn't marked so, or a background job that
    // should be using withoutTenantScope explicitly.
    throw new Error('No tenant context: this code path ran outside a scoped request');
  }
  return context;
}

/**
 * Runs a job's work for one tenant as *the system* — POOLSE-112's nightly
 * apply, which writes through the same repository functions a request does
 * (`setStudentLevelIn`, `recordAudit`). No membership, no roles: a function that
 * calls `requireRole` inside it refuses, which is right — a job is not a person
 * and must not inherit one's permissions. `recordAudit` writes a null actor.
 */
export function asSystem<T>(organizationId: string, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run(
    { organizationId, membershipId: '', appUserId: '', roles: [] },
    fn,
  );
}

export function currentOrganizationId(): string {
  return currentTenant().organizationId;
}
