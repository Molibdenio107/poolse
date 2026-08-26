import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  /** The organization every query in this request is scoped to. */
  organizationId: string;
  /** The membership acting — roles are read from it, never from the JWT. */
  membershipId: string;
  appUserId: string;
  roles: readonly string[];
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

export function currentOrganizationId(): string {
  return currentTenant().organizationId;
}
