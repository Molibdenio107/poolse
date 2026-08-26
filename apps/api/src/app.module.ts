import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { TenantMiddleware } from './tenant/tenant.middleware.js';

@Module({
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Default-deny shape: the middleware applies to everything, and public routes
    // are excluded one at a time. The opposite arrangement — listing the routes
    // that need tenancy — leaves every new endpoint unprotected until someone
    // remembers to add it.
    consumer
      .apply(TenantMiddleware)
      .exclude('health', 'webhooks/(.*)')
      .forRoutes('*');
  }
}
