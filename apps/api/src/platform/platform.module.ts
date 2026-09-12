import { Module } from '@nestjs/common';
import { PlatformAuditInterceptor } from './platform-audit.interceptor.js';
import { PlatformController } from './platform.controller.js';
import { PlatformAdminGuard } from './platform.guard.js';

/**
 * Platform administration — the operator's side of Poolse.
 *
 * A real Nest module rather than another entry in `AppModule`'s controller list,
 * which is how every other area of this API is wired. The difference is the
 * point: this is the boundary the `PlatformAdminGuard` is applied to, and having
 * a boundary at all is what makes "every controller in PlatformModule" a
 * sentence somebody can check rather than a list somebody maintains.
 *
 * Two standing rules for anything added here:
 *
 *   1. It is guarded by `PlatformAdminGuard` and audited by
 *      `PlatformAuditInterceptor`, reads included. Neither has an opt-out.
 *   2. It reads through `withPlatform` — the narrow, read-only cross-tenant
 *      login — and never through `withOrg` or `pool`. A platform endpoint that
 *      reaches for the tenant connection is a platform endpoint that cannot
 *      work, which is the failure mode you want.
 */
@Module({
  controllers: [PlatformController],
  providers: [PlatformAdminGuard, PlatformAuditInterceptor],
})
export class PlatformModule {}
