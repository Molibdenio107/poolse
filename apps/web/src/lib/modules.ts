import 'server-only';
import { cache } from 'react';
import { POOLSE_MODULES, type PoolseModule } from '@poolse/rules';
import { apiFetch, type Me } from './api';

/**
 * The modules the active club has on — POOLSE-87, once per request.
 *
 * `memberships[0]` is the club being acted in (`/me` puts it first). Null when
 * it cannot be told — `/me` failed, or the reader belongs to no club: the page
 * then loads as it would have and says its own sentence ("no organization"),
 * and the API's 403 `module_disabled` is what stands between a reader and a
 * hidden module.
 */
export const enabledModules = cache(async (): Promise<readonly PoolseModule[] | null> => {
  try {
    const me = await apiFetch<Me>('/me');
    const membership = me.memberships[0];
    if (membership === undefined) return null;
    return modulesOf(membership);
  } catch {
    return null;
  }
});

/** Whether `module` is on — true when it could not be told, for the same reason. */
export async function moduleIsOn(module: PoolseModule): Promise<boolean> {
  const modules = await enabledModules();
  return modules === null || modules.includes(module);
}

/**
 * A membership's enabled modules. **An absent field is every module**, not
 * none — sweep 20-10-2026: a web deploy that lands before the API's would
 * otherwise read every club as having everything switched off.
 */
export function modulesOf(membership: { modules?: readonly PoolseModule[] | undefined }): readonly PoolseModule[] {
  return membership.modules ?? POOLSE_MODULES;
}
