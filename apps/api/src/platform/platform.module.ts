import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PlatformAuditInterceptor } from './platform-audit.interceptor.js';
import { PlatformController } from './platform.controller.js';
import { PlatformAdminGuard } from './platform.guard.js';
import { TrialClockService } from './trial-clock.service.js';

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
 *
 * `TrialClockService` is the one thing here that is not a controller. It belongs
 * to this module because it moves the same columns the platform endpoints do and
 * reads through the same login — and because the second rule above is the one it
 * would be most tempting to break. It obeys neither guard nor interceptor, and
 * cannot: there is no request and no person, which is exactly why its
 * transitions go to `trial_event` rather than to `platform_audit_log`.
 */
@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [PlatformController],
  providers: [PlatformAdminGuard, PlatformAuditInterceptor, TrialClockService],
})
export class PlatformModule {}
