import 'server-only';
import { cache } from 'react';
import type { PoolseModule } from '@poolse/rules';
import { apiFetch, type Me } from './api';

/**
 * The modules the active club has on — POOLSE-87, once per request.
 *
 * `memberships[0]` is the club being acted in (`/me` puts it first). Null when
 * `/me` could not be read: the page then loads as it would have, and the API's
 * own 403 `module_disabled` is what stands between a reader and a hidden module.
 */
export const enabledModules = cache(async (): Promise<readonly PoolseModule[] | null> => {
  try {
    const me = await apiFetch<Me>('/me');
    return me.memberships[0]?.modules ?? [];
  } catch {
    return null;
  }
});

/** Whether `module` is on — true when it could not be told, for the same reason. */
export async function moduleIsOn(module: PoolseModule): Promise<boolean> {
  const modules = await enabledModules();
  return modules === null || modules.includes(module);
}
