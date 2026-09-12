import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { readPageQuery, type Paginated } from '../common/pagination.js';
import { readSearch } from '../common/search.js';
import { PlatformAction, PlatformAuditInterceptor } from './platform-audit.interceptor.js';
import { PlatformAdminGuard } from './platform.guard.js';
import {
  listTenants,
  readTenantRequests,
  type TenantRequests,
  type TenantRow,
} from './platform.repository.js';

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

  /**
   * One tenant's request health — slice 2.
   *
   * Audited like every other platform read, and this is the first route that
   * names a tenant, so its audit row carries `organization_id`. That is why
   * slice 1 put `platform_audit_log` in the harness teardown list: without it
   * the first integration test to call this would fail teardown on a foreign key
   * that had nothing to do with the change.
   *
   * A tenant that does not exist is a 404; a tenant that exists and has made no
   * requests is a 200 with an empty week. Collapsing the two would make a
   * mistyped id look like a quiet club.
   */
  @Get('tenants/:id/requests')
  @PlatformAction('tenant.requests.read')
  async requests(@Param('id') id: string): Promise<TenantRequests> {
    const requests = await readTenantRequests(id);
    if (requests === null) throw new NotFoundException('No such tenant');
    return requests;
  }
}
