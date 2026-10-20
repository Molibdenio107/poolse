import {
  ForbiddenException,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
  type Type,
} from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { isPoolseModule, type PoolseModule as ModuleName } from '@poolse/rules';
import { tenantStorage } from './tenant.context.js';

/**
 * Modules per club — POOLSE-87.
 *
 * Every tenant route says which module it belongs to, or that it is core. A
 * class decorator covers its handlers, and a handler's own decorator overrides
 * it — the water routes inside `FacilitiesController` are `water_quality` in a
 * core controller.
 *
 * **Not a role guard.** Roles stay in each handler's first line; this answers a
 * different question — whether this club has the module at all — and it answers
 * it before the handler runs, from the membership the request already resolved.
 */
const MODULE_KEY = 'poolse:module';

/** The value `@CoreRoute()` stores: present, and naming no module. */
const CORE = 'core';

/** This route belongs to a switchable module, and is refused while it is off. */
export const PoolseModule = (module: ModuleName): ClassDecorator & MethodDecorator =>
  SetMetadata(MODULE_KEY, module);

/** This route is core: no club ever has it switched off. Said out loud, never assumed. */
export const CoreRoute = (): ClassDecorator & MethodDecorator => SetMetadata(MODULE_KEY, CORE);

/**
 * Refuses a route whose module this club has switched off: 403
 * `module_disabled`, naming the module, for a GET as much as a write — a hidden
 * module is hidden, not read-only.
 *
 * A request with no tenant context (public, identity-only, platform) passes:
 * there is no club to ask, and those routes are exempt from tagging by the same
 * lists that exempt them from the tenant middleware.
 */
@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const tenant = tenantStorage.getStore();
    if (!tenant) return true;

    const module = this.reflector.getAllAndOverride<string | undefined>(MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (module === undefined || module === CORE) return true;

    if (tenant.disabledModules?.includes(module)) {
      throw new ForbiddenException({
        code: 'module_disabled',
        module,
        message: 'This module is not active for this organization',
      });
    }
    return true;
  }
}

/**
 * Whether the club of this request has `module` on — for a core route that
 * carries a module's data beside its own (the pool page and its water log).
 * Outside a tenant request everything is on: a background job asks per club.
 */
export function moduleIsOn(module: ModuleName): boolean {
  return !(tenantStorage.getStore()?.disabledModules ?? []).includes(module);
}

/** A Nest route pattern (`me/(.*)`) as an anchored regex over a joined path. */
function patternToRegex(pattern: string): RegExp {
  return new RegExp(`^${pattern}$`);
}

function pathsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return [typeof value === 'string' ? value : ''];
}

function join(...parts: string[]): string {
  return parts
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter((part) => part !== '')
    .join('/');
}

/**
 * Every tenant route that carries neither `@PoolseModule` nor `@CoreRoute`.
 *
 * Routes matching an exempt pattern (public, identity-only, platform) are
 * skipped: they run with no club, so there is nothing to switch off.
 */
export function untaggedRoutes(
  controllers: readonly Type[],
  exemptPatterns: readonly string[],
): string[] {
  const exempt = exemptPatterns.map(patternToRegex);
  const missing: string[] = [];

  for (const controller of controllers) {
    const classTag: unknown = Reflect.getMetadata(MODULE_KEY, controller);
    const classPaths = pathsOf(Reflect.getMetadata(PATH_METADATA, controller));
    const proto = controller.prototype as Record<string, unknown>;

    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue;
      const handler = proto[name];
      if (typeof handler !== 'function') continue;
      if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;

      const handlerTag: unknown = Reflect.getMetadata(MODULE_KEY, handler);
      const tag = handlerTag ?? classTag;
      if (tag === CORE || isPoolseModule(tag)) continue;

      const handlerPaths = pathsOf(Reflect.getMetadata(PATH_METADATA, handler));
      for (const base of classPaths) {
        for (const sub of handlerPaths) {
          const path = join(base, sub);
          if (exempt.some((pattern) => pattern.test(path))) continue;
          missing.push(`${controller.name}.${name} (/${path})`);
        }
      }
    }
  }
  return missing;
}

/**
 * Refuse to boot with an untagged tenant route — the `assertPlatformRoleIsNarrow`
 * pattern. The first endpoint written tired would otherwise belong to no module,
 * and stay reachable in a club that switched its module off.
 */
export function assertEveryRouteHasAModule(
  controllers: readonly Type[],
  exemptPatterns: readonly string[],
): void {
  const missing = untaggedRoutes(controllers, exemptPatterns);
  if (missing.length > 0) {
    throw new Error(
      `Tenant routes with neither @PoolseModule nor @CoreRoute (POOLSE-87):\n  ${missing.join('\n  ')}`,
    );
  }
}
