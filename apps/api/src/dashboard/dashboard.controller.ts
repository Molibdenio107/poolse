import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Put,
  Query,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireRole } from '../tenant/roles.js';
import { composeDashboard, type Dashboard } from './compose.js';
import { readDashboardShape, rememberDashboardFacility } from './dashboard.repository.js';
import { ROLES_WITH_DERIVED_FACILITIES, SELECTOR_ROLES } from './widget-registry.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `GET /dashboard` — the home page, as data — POOLSE-66, slice 1.
 *
 * **Every signed-in member may call it**, and what comes back is decided by what
 * they hold: an owner gets the management band, an instructor gets their own
 * work, somebody with neither gets `bands: []`. There is no `requireRole` here
 * because there is no single role this page is for — which is the whole reason
 * it is a union of bands rather than four screens.
 *
 * The permission work is in `widgetsFor`, ahead of every resolver, so a widget
 * the reader may not see is **absent from this payload**. A client that renders
 * whatever it is given cannot leak anything, because nothing was sent.
 */
@Controller('dashboard')
export class DashboardController {
  @Get()
  async read(@Query('facility') facility?: string): Promise<Dashboard> {
    const { organizationId, membershipId, roles } = currentTenant();

    const shape = await readDashboardShape(organizationId, membershipId);

    /*
     * The selector, in two readings that are deliberately different.
     *
     * A **malformed** value is no filter at all — it arrives from a link or a
     * bookmark, and a mistyped one should show the club rather than an error
     * page, which is the reading `/platform/tenants` already takes for its own
     * filter. A **well-formed uuid this club does not have** is a 404: that is
     * not a typo, it is a question about somebody else's site, and answering it
     * with "here is everything instead" would quietly widen what was asked for.
     */
    const asked = (facility ?? '').trim();
    /*
     * Asked for in the URL, or remembered — AC 10. A link that names a site wins
     * over the remembered one, so a shared link shows what it says; with no
     * site asked for, the reader's last choice applies, and a remembered site
     * that has since been archived has already been read as "every site".
     */
    const named = UUID.test(asked) ? asked : shape.rememberedFacilityId;

    if (named !== null && !shape.facilities.some((site) => site.id === named)) {
      throw new NotFoundException('No such facility');
    }

    /*
     * The reader's own sites.
     *
     * For an owner, an admin or maintenance that is every site in the club —
     * maintenance is assigned to no site in this schema (slice 4). For
     * everybody else it is empty, and that is enforced rather than hoped:
     * `assertRegistryIsSound` refuses to register a facility-scoped widget for a
     * role whose sites are not derived. The instructor band (slice 3) is
     * self-scoped and needed none.
     *
     * Two lists leave here: `facilityIds` follows the selector and is what the
     * management band reads; `ownFacilityIds` does not, and is what the
     * operational band reads (AC 10). The selector itself is owner and admin.
     */
    const derived = hasRole(...ROLES_WITH_DERIVED_FACILITIES);
    const manages = hasRole(...SELECTOR_ROLES);
    const own = derived ? shape.facilities.map((site) => site.id) : [];

    return composeDashboard(
      {
        organizationId,
        membershipId,
        roles,
        facilityIds: named === null ? own : own.filter((id) => id === named),
        ownFacilityIds: own,
        scope: named === null ? { mode: 'all', facilityId: null } : { mode: 'facility', facilityId: named },
        locale: shape.locale,
      },
      {
        kind: shape.kind,
        // The club's own sites, whoever is asking: this is what decides whether
        // the club is bare, and that is a fact about the club.
        sites: shape.facilities,
        // The selector is the management band's control. Nobody else is offered
        // it, so nobody else is sent its list.
        selector: manages ? shape.facilities : [],
      },
    );
  }

  /**
   * `PUT /dashboard/scope` — remember the selector's choice. `{ facilityId }`,
   * a uuid or null for every site.
   *
   * Owner and admin, because the selector is the management band's control and
   * nobody else is offered it. The site must be one of this club's live ones:
   * an unknown uuid is a 404 for the reason the GET gives one, and anything that
   * is not a uuid or null is a 400 rather than a quiet "every site".
   */
  @Put('scope')
  @HttpCode(204)
  async rememberScope(@Body() body: Record<string, unknown>): Promise<void> {
    requireRole(...SELECTOR_ROLES);
    const { organizationId, membershipId } = currentTenant();

    const value = body['facilityId'];
    if (value !== null && (typeof value !== 'string' || !UUID.test(value))) {
      throw new BadRequestException({ message: 'facilityId must be a uuid or null' });
    }

    if (value !== null) {
      const shape = await readDashboardShape(organizationId, membershipId);
      if (!shape.facilities.some((site) => site.id === value)) {
        throw new NotFoundException('No such facility');
      }
    }

    await rememberDashboardFacility(organizationId, membershipId, value);
  }
}
