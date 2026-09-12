import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { readPageQuery, type Paginated } from '../common/pagination.js';
import { readSearch } from '../common/search.js';
import { PlatformAction, PlatformAuditInterceptor } from './platform-audit.interceptor.js';
import { PlatformAdminGuard } from './platform.guard.js';
import { listTenants, type TenantRow } from './platform.repository.js';

/**
 * `GET /platform/tenants` — every tenant, one row each.
 *
 * The guard and the interceptor are declared here rather than only on the
 * module, so that a controller lifted out of `PlatformModule` by mistake takes
 * its protection with it. Nest runs a guard once even when it is bound twice.
 *
 * Authenticated but **not** tenant-scoped: `platform/(.*)` sits in
 * `IDENTITY_ONLY_ROUTES`, so `TenantMiddleware` never runs. That is not a
 * loosening — it is the requirement. An operator who belongs to no organization
 * must be able to open this, and under `TenantMiddleware` they would be turned
 * away with `no_organization` before the guard ever saw them.
 */
@Controller('platform')
@UseGuards(PlatformAdminGuard)
@UseInterceptors(PlatformAuditInterceptor)
export class PlatformController {
  @Get('tenants')
  @PlatformAction('tenants.listed')
  async tenants(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ): Promise<Paginated<TenantRow>> {
    // The same two helpers every other list in the API uses. A broken `page`
    // gives page 1 rather than a 400, and a one-letter search is no search —
    // an operator's list should not behave differently from a club's.
    return listTenants({ search: readSearch(search) }, readPageQuery(page, limit));
  }
}
