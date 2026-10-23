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
