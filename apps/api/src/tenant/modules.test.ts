import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Controller, ForbiddenException, Get, Post, type ExecutionContext, type Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppModule, IDENTITY_ONLY_ROUTES, PUBLIC_ROUTES } from '../app.module.js';
import {
  assertEveryRouteHasAModule,
  CoreRoute,
  ModuleGuard,
  PoolseModule,
  untaggedRoutes,
} from './modules.js';
import { tenantStorage, type TenantContext } from './tenant.context.js';

/**
 * Modules per club — POOLSE-87, QA 2 and 4 without a database.
 *
 * Run: pnpm api:test
 */

const EXEMPT = [...PUBLIC_ROUTES, ...IDENTITY_ONLY_ROUTES];

test('every tenant route in the app names its module or says it is core', () => {
  const controllers = Reflect.getMetadata('controllers', AppModule) as Type[];
  assert.ok(controllers.length > 50);
  assert.deepEqual(untaggedRoutes(controllers, EXEMPT), []);
});

@Controller('forgotten')
class ForgottenController {
  @Get()
  list(): void {}
}

@Controller('me/forgotten')
class IdentityController {
  @Get()
  list(): void {}
}

@CoreRoute()
@Controller('facilities')
class MixedController {
  @Get()
  list(): void {}

  @PoolseModule('water_quality')
  @Post('pools/:poolId/analyses')
  record(): void {}
}

test('QA 4: an untagged tenant route refuses to boot, naming it', () => {
  assert.deepEqual(untaggedRoutes([ForgottenController], EXEMPT), [
    'ForgottenController.list (/forgotten)',
  ]);
  assert.throws(
    () => assertEveryRouteHasAModule([ForgottenController], EXEMPT),
    /ForgottenController\.list/,
  );
});

test('an identity-only route needs no tag', () => {
  assert.deepEqual(untaggedRoutes([IdentityController], EXEMPT), []);
});

function contextFor(controller: Type, handler: string): ExecutionContext {
  return {
    getHandler: () => (controller.prototype as Record<string, unknown>)[handler],
    getClass: () => controller,
  } as unknown as ExecutionContext;
}

function tenant(disabledModules: string[]): TenantContext {
  return {
    organizationId: 'org',
    membershipId: 'm',
    appUserId: 'u',
    roles: ['owner'],
    disabledModules,
  };
}

const guard = new ModuleGuard(new Reflector());

test('QA 2: a route whose module is off is refused with module_disabled and its name', () => {
  tenantStorage.run(tenant(['water_quality']), () => {
    assert.throws(
      () => guard.canActivate(contextFor(MixedController, 'record')),
      (error: unknown) => {
        assert.ok(error instanceof ForbiddenException);
        assert.deepEqual(error.getResponse(), {
          code: 'module_disabled',
          module: 'water_quality',
          message: 'This module is not active for this organization',
        });
        return true;
      },
    );
  });
});

test('a handler tag overrides its class: the core route stays open', () => {
  tenantStorage.run(tenant(['water_quality']), () => {
    assert.equal(guard.canActivate(contextFor(MixedController, 'list')), true);
  });
});

test('a module that is on, and a request with no club, both pass', () => {
  tenantStorage.run(tenant(['energy']), () => {
    assert.equal(guard.canActivate(contextFor(MixedController, 'record')), true);
  });
  assert.equal(guard.canActivate(contextFor(MixedController, 'record')), true);
});
