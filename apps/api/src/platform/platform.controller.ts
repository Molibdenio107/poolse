import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { readPageQuery, type Paginated } from '../common/pagination.js';
import { readSearch } from '../common/search.js';
import { PlatformAction, PlatformAuditInterceptor } from './platform-audit.interceptor.js';
import { PlatformAdminGuard } from './platform.guard.js';
import {
  extendTrial,
  listTenants,
  readTenant,
  readTenantRequests,
  setPlanLimits,
  setSubscriptionStatus,
  setSuspension,
  type TenantChangeResult,
  type TenantRequests,
  type TenantRow,
} from './platform.repository.js';
import {
  readMaxFacilities,
  readMaxManagementUsers,
  readSubscriptionStatus,
  readSuspensionReason,
  readTrialEndsAt,
} from './platform-actions.js';

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
   * One tenant, in the same shape as a row of the list — slice 3.
   *
   * The detail page needs the plan, the seat count and the suspension state to
   * seed its forms, and it gets them from the same statement the list uses so
   * the two can never describe a tenant differently.
   */
  @Get('tenants/:id')
  @PlatformAction('tenant.read')
  async tenant(@Param('id') id: string): Promise<TenantRow> {
    const tenant = await readTenant(id);
    if (tenant === null) throw new NotFoundException('No such tenant');
    return tenant;
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

  /*
   * The actions — slice 3.
   *
   * One endpoint per thing an operator changes, rather than a single PATCH over
   * the tenant. Three reasons and all of them showed up while writing it: the
   * audit action name is meaningful (`tenant.suspended`, not `tenant.patched`),
   * each body has its own validation with its own field names, and suspending is
   * not something anybody should be able to do by including one more key in a
   * request that was about a trial date.
   *
   * **None of these is logged by `PlatformAuditInterceptor`.** It records reads;
   * a write records itself inside the transaction that performed it, because an
   * entry on a separate connection can commit while the change rolls back. Hence
   * no `@PlatformAction` on any of the four.
   */

  @Post('tenants/:id/trial')
  async trial(
    @Param('id') id: string,
    @Body() body: { endsAt?: unknown },
  ): Promise<TenantChangeResult> {
    return found(await extendTrial(id, readTrialEndsAt(body.endsAt)));
  }

  @Post('tenants/:id/subscription')
  async subscription(
    @Param('id') id: string,
    @Body() body: { status?: unknown },
  ): Promise<TenantChangeResult> {
    return found(await setSubscriptionStatus(id, readSubscriptionStatus(body.status)));
  }

  @Post('tenants/:id/plan')
  async plan(
    @Param('id') id: string,
    @Body() body: { maxFacilities?: unknown; maxManagementUsers?: unknown },
  ): Promise<TenantChangeResult> {
    return found(
      await setPlanLimits(id, {
        maxFacilities: readMaxFacilities(body.maxFacilities),
        maxManagementUsers: readMaxManagementUsers(body.maxManagementUsers),
      }),
    );
  }

  /**
   * Suspend, or restore.
   *
   * One endpoint for both directions rather than a `/suspend` and an
   * `/unsuspend`: they write the same two columns and they must stay each
   * other's exact inverse, which is easier to keep true in one handler than in
   * two. `suspended: false` restores; `suspended: true` requires a reason,
   * because the schema does and because a closed door with no sentence on it is
   * a support call starting from nothing.
   */
  @Post('tenants/:id/suspension')
  async suspension(
    @Param('id') id: string,
    @Body() body: { suspended?: unknown; reason?: unknown },
  ): Promise<TenantChangeResult> {
    const suspended = body.suspended === true || body.suspended === 'true';
    return found(
      await setSuspension(id, suspended ? { reason: readSuspensionReason(body.reason) } : null),
    );
  }
}

/**
 * A tenant that does not exist is a 404, not a successful change of nothing.
 *
 * One place, because four handlers each writing the same three lines is four
 * chances for the fourth to return `null` to a client that will read it as
 * success.
 */
function found(result: TenantChangeResult | null): TenantChangeResult {
  if (result === null) throw new NotFoundException('No such tenant');
  return result;
}
